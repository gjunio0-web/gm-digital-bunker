// Contact form backend: validates the submission, applies the honeypot and a per-IP rate limit,
// stores it in Firestore (kept 90 days via a TTL policy on `expiraEm`) and sends a notification
// e-mail through SMTP2GO. Accepts JSON-style replies for fetch() and a 303 redirect for plain posts.
import { createHash } from 'node:crypto';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import nodemailer from 'nodemailer';
import { valida, ehRobo, retornoPara } from './valida.js';

initializeApp();
const db = getFirestore();

const SMTP_SENHA = defineSecret('SMTP2GO_PASSWORD');
const SMTP_USUARIO = defineString('SMTP2GO_USER', { default: 'gmdigitalbunker.com.br' });
const EMAIL_CONTATO = 'contato@gmdigitalbunker.com.br';

const RETENCAO_DIAS = 90;
const LIMITE_ENVIOS = 5; // per IP...
const JANELA_MS = 60 * 60 * 1000; // ...per hour

// Role labels for the notification e-mail (the form sends stable English values)
const CARGOS_PT = {
  owner: 'Sócio(a) ou proprietário(a)', ceo: 'CEO ou presidente', director: 'Diretor(a)',
  manager: 'Gerente ou coordenador(a)', specialist: 'Analista ou especialista',
  external: 'Consultor(a) externo(a)', other: 'Outro',
};

const origensPermitidas = () =>
  (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

const querJson = (req) => (req.get('accept') || '').includes('application/json');

const ipDe = (req) => (req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();

// The IP is never stored: only a salted hash, used as the rate-limit key.
const chaveDe = (ip) =>
  createHash('sha256').update(`${process.env.GCLOUD_PROJECT}:${ip}`).digest('hex').slice(0, 32);

// Fixed one-hour window per IP. Returns true when the submission may go through.
async function dentroDoLimite(chave) {
  const ref = db.collection('limites').doc(chave);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const agora = Date.now();
    const atual = snap.exists ? snap.data() : null;
    const novaJanela = !atual || agora - atual.inicio.toMillis() >= JANELA_MS;
    if (!novaJanela && atual.contagem >= LIMITE_ENVIOS) return false;
    tx.set(ref, {
      inicio: novaJanela ? Timestamp.fromMillis(agora) : atual.inicio,
      contagem: novaJanela ? 1 : atual.contagem + 1,
      expiraEm: Timestamp.fromMillis(agora + 2 * JANELA_MS),
    });
    return true;
  });
}

async function notifica(d, id) {
  const transporte = nodemailer.createTransport({
    host: 'mail.smtp2go.com',
    port: 2525,
    secure: false,
    requireTLS: true,
    auth: { user: SMTP_USUARIO.value(), pass: SMTP_SENHA.value() },
  });
  const linhas = [
    `Nome: ${d.nome}`,
    `Empresa: ${d.empresa}`,
    `Cargo: ${CARGOS_PT[d.cargo] ?? d.cargo}`,
    `E-mail: ${d.email}`,
    `Site: ${d.site || '–'}`,
    `Idioma da página: ${d.lang}`,
    '',
    'Mensagem:',
    d.mensagem || '–',
    '',
    `Registro no Firestore: contatos/${id}`,
  ];
  await transporte.sendMail({
    from: `GM Digital Bunker – site <${EMAIL_CONTATO}>`,
    to: EMAIL_CONTATO,
    replyTo: d.email,
    subject: `Pedido de conversa – ${d.nome} (${d.empresa})`,
    text: linhas.join('\n'),
  });
}

export const contato = onRequest(
  {
    region: 'southamerica-east1',
    secrets: [SMTP_SENHA],
    memory: '256MiB',
    timeoutSeconds: 30,
    maxInstances: 2,
    invoker: 'public',
  },
  async (req, res) => {
    const origem = req.get('origin') || '';
    const permitida = origensPermitidas().includes(origem);
    if (permitida) {
      res.set('Access-Control-Allow-Origin', origem);
      res.set('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      if (!permitida) return res.status(403).end();
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Accept');
      res.set('Access-Control-Max-Age', '3600');
      return res.status(204).end();
    }
    if (req.method !== 'POST') return res.status(405).set('Allow', 'POST, OPTIONS').end();
    if (!permitida) return res.status(403).json({ ok: false, motivo: 'origem' });

    const corpo = req.body || {};
    const json = querJson(req);
    const retorno = `${origem}${retornoPara(corpo.lang)}`;
    const responde = (status, payload, sucesso) =>
      json ? res.status(status).json(payload) : res.redirect(303, sucesso ? `${retorno}?enviado=1` : retorno);

    // Honeypot filled: answer as if accepted, store nothing.
    if (ehRobo(corpo)) return responde(200, { ok: true }, true);

    const r = valida(corpo);
    if (!r.ok) return responde(400, { ok: false, motivo: 'campos', erros: r.erros }, false);

    try {
      if (!(await dentroDoLimite(chaveDe(ipDe(req))))) {
        return responde(429, { ok: false, motivo: 'limite' }, false);
      }
      const doc = await db.collection('contatos').add({
        ...r.dados,
        origem,
        criadoEm: FieldValue.serverTimestamp(),
        expiraEm: Timestamp.fromMillis(Date.now() + RETENCAO_DIAS * 24 * 60 * 60 * 1000),
        notificado: false,
      });
      // The submission is already stored; an e-mail failure is logged, not shown to the visitor.
      try {
        await notifica(r.dados, doc.id);
        await doc.update({ notificado: true });
      } catch (e) {
        logger.error('Notification e-mail failed', { id: doc.id, erro: String(e?.message || e) });
      }
      return responde(200, { ok: true }, true);
    } catch (e) {
      logger.error('Contact submission failed', { erro: String(e?.message || e) });
      return responde(500, { ok: false, motivo: 'interno' }, false);
    }
  },
);
