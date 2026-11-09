// receberFicha – receives the contact form (spec 01, sections 2 and 4).
// Validates, applies the honeypot and the limits per e-mail and per IP hash, writes fichas/{id}
// in state "recebida" with its "recebida" event, then sends the confirmation and the notice.
// An e-mail failure never undoes the write: it is recorded in the ficha's erro field.
import { createHash } from 'node:crypto';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { DIA_MS, IP_HASH_SALT, ORIGENS_POR_PROJETO, REGIAO, SMTP2GO_API_KEY } from './config.js';
import { lePipeline } from './pipeline.js';
import { ehRobo, entradasXff, ipDe, posicaoMarcadorXff, valida } from './validacao.js';
import { aviso, confirmacao } from './email.js';

const HORA_MS = 60 * 60 * 1000;

const projeto = () => process.env.GCLOUD_PROJECT ?? '';
const origensPermitidas = () => ORIGENS_POR_PROJETO[projeto()] ?? [];

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

    // Number of X-Forwarded-For entries only, never an address (phase 6, item 6); logged before the honeypot
    // so the check in qualidade needs no stored ficha.
    // xffMarcador is TEMPORARY (see posicaoMarcadorXff in validacao.ts): remove after the check in qualidade.
    logger.info('receberFicha: x-forwarded-for', {
      xffEntradas: entradasXff(req.get('x-forwarded-for')),
      xffMarcador: posicaoMarcadorXff(req.get('x-forwarded-for')),
    });
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

      // E-mails after the write; a failure is recorded and does not change the response.
      const chave = SMTP2GO_API_KEY.value();
      const resultados = await Promise.allSettled([
        confirmacao(chave, r.original.email, r.original.lang),
        aviso(chave, ref.id, r.original, r.pagina, agora.toDate()),
      ]);
      const etapas = ['email_confirmacao', 'email_aviso'] as const;
      const falhas = resultados.flatMap((x, i) =>
        x.status === 'rejected' ? [{ etapa: etapas[i], motivo: String((x.reason as Error)?.message ?? x.reason) }] : [],
      );
      if (falhas.length) {
        logger.error('E-mail failed', { id: ref.id, falhas });
        await ref.update({
          erro: {
            etapa: falhas.map((f) => f.etapa).join(','),
            mensagem: falhas.map((f) => f.motivo).join(' | ').slice(0, 500),
            em: Timestamp.now(),
          },
        });
      }

      res.status(201).json({ id: ref.id });
    } catch (e) {
      logger.error('receberFicha failed', { motivo: String((e as Error)?.message ?? e) });
      res.status(500).json({ motivo: 'interno' });
    }
  },
);
