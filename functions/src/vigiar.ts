// vigiar – every 30 minutes (phase 6, item 3c; decision of Gon, 8/11/2026): fichas in coletando or sintetizando
// (the verification runs with the ficha still in sintetizando) without an error and with estadoEm older than
// config/pipeline.prazoParadaMin get erro {etapa: "interrupcao:<estado>"} and the "parada" event, and one e-mail
// lists them. Nothing is run again by itself. It also covers events dropped with maxInstances and retry false
// (a ficha that never got its trigger stays in the state and is caught here).
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { REGIAO, SMTP2GO_API_KEY, URL_BASE_POR_PROJETO } from './config.js';
import { lePipeline } from './pipeline.js';
import { avisoParadas } from './email.js';

export const ESTADOS_EM_CURSO = ['coletando', 'sintetizando'] as const;

// Fichas stopped beyond the deadline; filtered in code (few fichas in progress), so no composite index.
export function paradas(fichas: { id: string; estado: string; estadoEm: Date; erro: unknown }[], agora: Date, prazoMin: number) {
  return fichas.filter((f) => (ESTADOS_EM_CURSO as readonly string[]).includes(f.estado) && !f.erro && agora.getTime() - f.estadoEm.getTime() > prazoMin * 60_000);
}

export async function marcaParadas(agora = new Date()): Promise<{ empresa: string; estado: string; minutos: number; link: string }[]> {
  const db = getFirestore();
  const p = await lePipeline();
  const q = await db.collection('fichas').where('estado', 'in', [...ESTADOS_EM_CURSO]).get();
  const lista = q.docs.map((d) => ({ id: d.id, estado: d.get('estado'), estadoEm: (d.get('estadoEm') as Timestamp).toDate(), erro: d.get('erro') ?? null }));
  const base = URL_BASE_POR_PROJETO[process.env.GCLOUD_PROJECT ?? ''];
  const marcadas: { empresa: string; estado: string; minutos: number; link: string }[] = [];
  for (const f of paradas(lista, agora, p.prazoParadaMin)) {
    const ref = db.collection('fichas').doc(f.id);
    const minutos = Math.round((agora.getTime() - f.estadoEm.getTime()) / 60_000);
    // Only if nothing changed since the read (the function may have finished meanwhile).
    const ok = await db.runTransaction(async (tx) => {
      const atual = (await tx.get(ref)).data();
      if (!atual || atual.estado !== f.estado || atual.erro || (atual.estadoEm as Timestamp).toMillis() !== f.estadoEm.getTime()) return false;
      const em = Timestamp.fromDate(agora);
      tx.update(ref, { erro: { etapa: `interrupcao:${f.estado}`, mensagem: `parada em ${f.estado} há ${minutos} min, além do prazo de ${p.prazoParadaMin} min`, em } });
      tx.create(ref.collection('eventos').doc(), { em, ator: { tipo: 'sistema', id: 'vigiar' }, tipo: 'parada', detalhe: { estado: f.estado, minutos, prazoMin: p.prazoParadaMin } });
      return true;
    });
    if (ok) marcadas.push({ empresa: (await ref.get()).get('original.empresa') ?? '', estado: f.estado, minutos, link: base ? `${base}/admin/leads/${f.id}` : `fichas/${f.id}` });
  }
  return marcadas;
}

export const vigiar = onSchedule(
  { region: REGIAO, schedule: '*/30 * * * *', timeZone: 'America/Sao_Paulo', secrets: [SMTP2GO_API_KEY], memory: '256MiB', timeoutSeconds: 120, maxInstances: 1 },
  async () => {
    const marcadas = await marcaParadas();
    if (marcadas.length) {
      await avisoParadas(process.env.FUNCTIONS_EMULATOR === 'true' ? '' : SMTP2GO_API_KEY.value(), marcadas).catch((e) =>
        logger.error('vigiar: notice failed', { mensagem: String((e as Error)?.message ?? e).slice(0, 300) }));
    }
    logger.info('vigiar: done', { paradas: marcadas.length });
  },
);
