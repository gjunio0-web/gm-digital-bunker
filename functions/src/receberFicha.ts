// receberFicha – receives the contact form (spec 01, sections 2 and 4).
// Validates, applies the honeypot and the limits per e-mail and per IP hash, writes fichas/{id}
// in state "recebida" with its "recebida" event, then sends the confirmation and the notice.
// An e-mail failure never undoes the write: it becomes an "email_falhou" event (spec 01 v0.42), never an erro.
import { createHash } from 'node:crypto';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { FieldValue, getFirestore, Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { DIA_MS, IP_HASH_SALT, ORIGENS_POR_PROJETO, REGIAO, SMTP2GO_API_KEY } from './config.js';
import { lePipeline } from './pipeline.js';
import { ehRobo, ipDe, valida, type Original } from './validacao.js';
import { aviso, confirmacao } from './email.js';
import { mesDe } from './mes.js';

const HORA_MS = 60 * 60 * 1000;

const projeto = () => process.env.GCLOUD_PROJECT ?? '';
const origensPermitidas = () => ORIGENS_POR_PROJETO[projeto()] ?? [];

// The two senders, injectable so a test can make one fail (in the emulator the real ones always succeed).
export type EnviosDeEmail = { confirmacao: typeof confirmacao; aviso: typeof aviso };

// Sends the confirmation to the person and the notice to the administrator. Each failure is logged and recorded as an
// "email_falhou" event with detalhe {destino} (one event per destination that failed); the ficha gets no erro and keeps
// its state, and nothing is sent again. Never throws. Returns the destinations that failed.
export async function enviaEmailsDaFicha(
  ref: DocumentReference, chave: string, original: Original, pagina: string | null, recebidaEm: Date, envios: EnviosDeEmail = { confirmacao, aviso },
): Promise<('interessado' | 'administrador')[]> {
  const destinos = ['interessado', 'administrador'] as const;
  const resultados = await Promise.allSettled([
    envios.confirmacao(chave, original.email, original.lang),
    envios.aviso(chave, ref.id, original, pagina, recebidaEm),
  ]);
  const falhas: ('interessado' | 'administrador')[] = [];
  for (const [i, x] of resultados.entries()) {
    if (x.status !== 'rejected') continue;
    falhas.push(destinos[i]);
    logger.error('E-mail failed', { id: ref.id, destino: destinos[i], motivo: String((x.reason as Error)?.message ?? x.reason).slice(0, 300) });
    await ref.collection('eventos').doc().create({ em: Timestamp.now(), ator: { tipo: 'sistema', id: 'receberFicha' }, tipo: 'email_falhou', detalhe: { destino: destinos[i] } })
      .catch((e) => logger.error('email_falhou event not written', { id: ref.id, destino: destinos[i], motivo: String((e as Error)?.message ?? e).slice(0, 200) }));
  }
  return falhas;
}

const hashIp = (sal: string, ip: string) => createHash('sha256').update(`${sal}:${ip}`).digest('hex');

export const receberFicha = onRequest(
  {
    region: REGIAO,
    secrets: [SMTP2GO_API_KEY, IP_HASH_SALT],
    memory: '256MiB',
    timeoutSeconds: 30,
    maxInstances: 2,
    invoker: 'public',
  },
  async (req, res) => {
    const origem = req.get('origin') ?? '';
    const permitida = origensPermitidas().includes(origem);
    if (permitida) {
      res.set('Access-Control-Allow-Origin', origem);
      res.set('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      if (!permitida) {
        res.status(403).end();
        return;
      }
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      res.set('Access-Control-Max-Age', '3600');
      res.status(204).end();
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).set('Allow', 'POST, OPTIONS').end();
      return;
    }
    if (!permitida) {
      res.status(403).json({ motivo: 'origem' });
      return;
    }
    if (!req.is('application/json')) {
      res.status(415).json({ motivo: 'formato' });
      return;
    }

    const corpo = req.body ?? {};
    // Honeypot filled: answer as accepted, store nothing.
    if (ehRobo(corpo)) {
      res.status(200).json({});
      return;
    }

    const r = valida(corpo);
    if (!r.ok) {
      res.status(400).json({ motivo: 'campos', erros: r.erros });
      return;
    }

    try {
      const db = getFirestore();
      const fichas = db.collection('fichas');
      const p = await lePipeline();
      const agora = Timestamp.now();
      const ip = hashIp(IP_HASH_SALT.value(), ipDe(req.get('x-forwarded-for'), req.ip));

      // Limits counted on the fichas themselves: no personal data outside fichas (spec 01, principle 1).
      const [porIp, porEmail] = await Promise.all([
        fichas.where('origem.ip', '==', ip).where('recebidaEm', '>=', Timestamp.fromMillis(agora.toMillis() - HORA_MS)).count().get(),
        fichas.where('normalizado.email', '==', r.normalizado.email).where('recebidaEm', '>=', Timestamp.fromMillis(agora.toMillis() - DIA_MS)).count().get(),
      ]);
      if (porIp.data().count >= p.limiteFichasPorIpPorHora || porEmail.data().count >= p.limiteFichasPorEmailPorDia) {
        res.status(429).json({ motivo: 'limite' });
        return;
      }

      const ref = fichas.doc();
      const lote = db.batch();
      lote.create(ref, {
        original: r.original,
        normalizado: r.normalizado,
        recebidaEm: agora,
        origem: { ip, userAgent: (req.get('user-agent') ?? '').slice(0, 200), pagina: r.pagina },
        estado: 'recebida',
        estadoEm: agora,
        expurgoEm: Timestamp.fromMillis(agora.toMillis() + p.prazoGuardaDias * DIA_MS),
        erro: null,
      });
      lote.create(ref.collection('eventos').doc(), {
        em: agora,
        ator: { tipo: 'sistema', id: 'receberFicha' },
        tipo: 'recebida',
        detalhe: {},
      });
      await lote.commit();

      // metricas.recebidas (spec 01 v0.35): every ficha created counts, spam included. Written after the ficha and never
      // blocks the form: a failure is logged and the count is one short.
      await db.collection('metricas').doc(mesDe(agora.toDate())).set({ recebidas: FieldValue.increment(1), atualizadoEm: agora }, { merge: true })
        .catch((e) => logger.error('metricas.recebidas not written', { id: ref.id, motivo: String((e as Error)?.message ?? e).slice(0, 200) }));

      // E-mails after the write; a failure is recorded as an event and does not change the response.
      await enviaEmailsDaFicha(ref, SMTP2GO_API_KEY.value(), r.original, r.pagina, agora.toDate());

      res.status(201).json({ id: ref.id });
    } catch (e) {
      logger.error('receberFicha failed', { motivo: String((e as Error)?.message ?? e) });
      res.status(500).json({ motivo: 'interno' });
    }
  },
);
