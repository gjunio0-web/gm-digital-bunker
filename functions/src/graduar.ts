// graduar (spec 01, sections 2 to 4 and 7; spec 04): in code, without AI and without network.
// - triagem, right after qualificar: lead, the "triada" event, the next state (descartada, resposta_breve,
//   coletando, or "qualificada" kept when autoAnalisar is off), the 30-day retention in the short-retention
//   cases and the metrics by quadrant and grade;
// - analysis, at the end of enquadrar (sintetizar): lead with momento "analise", the "graduada" event, the
//   retention (30 days for grade D) and, on the first analysis, the metrics; prazoEm stays null;
// - at the end of verificar: only the confidence (pending issues) and, when the analysis is ready, prazoEm.
import { FieldValue, getFirestore, Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { DIA_MS, type Pipeline } from './config.js';
import { confianca, entradaAnalise, entradaTriagem, gradua, guardaCurta, prazoDaAnalise, prazoDaTriagem, proximoEstado, type EnquadramentoGraduacao, type Lead } from './graduacao.js';
import { mesDe } from './qualificar.js';

// Day in São Paulo (UTC-3, no daylight saving time since 2019), for the daily ceiling of analyses.
export const diaDeSaoPaulo = (d: Date) => new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);

// Daily ceiling (phase 6, item 4; decision of Gon, 8/11/2026): config/pipeline.maxAnalisesPorDia fichas a day go
// from the triagem to coletando; beyond it the ficha stays in qualificada with a teto_diario event. Counted in
// controle/analises-{aaaa-mm-dd}, inside the triagem transaction; the first ficha over the ceiling asks for the
// notice (avisarTeto), once a day.
export async function graduaTriagem(ref: DocumentReference, p: Pipeline): Promise<{ lead: Lead; estado: string; avisarTeto: { teto: number; dia: string } | null } | null> {
  const db = getFirestore();
  const f = (await ref.get()).data();
  if (!f || f.estado !== 'qualificada' || f.lead) return null;
  const estadoEmLido = f.estadoEm as Timestamp;
  const [digital, registro] = await Promise.all(['empresa_digital', 'empresa_registro'].map((e) => ref.collection('coleta').doc(e).get()));

  const lead = gradua(entradaTriagem(f, digital.data(), registro.data()), p.pesosQualificacao);
  const estado = proximoEstado(lead, p.autoAnalisar);
  const recebidaEm = f.recebidaEm as Timestamp;
  const prazo = prazoDaTriagem(lead, recebidaEm.toDate());
  const curta = guardaCurta(lead);
  const agora = Timestamp.now();
  const dia = diaDeSaoPaulo(agora.toDate());
  const contador = db.collection('controle').doc(`analises-${dia}`);
  let estadoFinal: string = estado;
  let avisarTeto: { teto: number; dia: string } | null = null;

  await db.runTransaction(async (tx) => {
    const atual = (await tx.get(ref)).data();
    const conta = estado === 'coletando' && p.maxAnalisesPorDia !== null ? (await tx.get(contador)).data() ?? {} : null;
    if (!atual || atual.estado !== 'qualificada' || atual.lead || !(atual.estadoEm as Timestamp).isEqual(estadoEmLido)) throw new Error('graduar: ficha changed meanwhile');
    estadoFinal = estado;
    avisarTeto = null;
    if (conta) {
      if ((conta.n ?? 0) >= (p.maxAnalisesPorDia ?? 0)) {
        estadoFinal = 'qualificada';
        if (!conta.avisado) avisarTeto = { teto: p.maxAnalisesPorDia ?? 0, dia };
        tx.set(contador, { dia, retidas: FieldValue.increment(1), avisado: true, atualizadoEm: agora }, { merge: true });
        tx.create(ref.collection('eventos').doc(), { em: agora, ator: { tipo: 'sistema', id: 'graduar' }, tipo: 'teto_diario', detalhe: { teto: p.maxAnalisesPorDia, dia } });
      } else {
        tx.set(contador, { dia, n: FieldValue.increment(1), atualizadoEm: agora }, { merge: true });
      }
    }
    tx.update(ref, {
      lead: { ...lead, acao: { ...lead.acao, prazoEm: prazo ? Timestamp.fromDate(prazo) : null }, calculadoEm: agora },
      ...(estadoFinal !== 'qualificada' ? { estado: estadoFinal, estadoEm: agora } : {}),
      ...(curta ? { expurgoEm: Timestamp.fromMillis(recebidaEm.toMillis() + p.prazoGuardaDiasBreve * DIA_MS) } : {}),
    });
    tx.create(ref.collection('eventos').doc(), {
      em: agora,
      ator: { tipo: 'sistema', id: 'graduar' },
      tipo: 'triada',
      detalhe: { quadrante: lead.quadrante, grau: lead.grau, pontos: lead.pontos, destino: lead.destino, proximoEstado: estadoFinal, versaoPesos: lead.versaoPesos },
    });
    tx.set(
      db.collection('metricas').doc(mesDe(recebidaEm.toDate())),
      { triagem: { quadrante: { [lead.quadrante]: FieldValue.increment(1) }, grau: { [lead.grau]: FieldValue.increment(1) } }, atualizadoEm: agora },
      { merge: true },
    );
  });
  return { lead, estado: estadoFinal, avisarTeto };
}

const docsDaColeta = async (ref: DocumentReference) => {
  const nomes = ['empresa_digital', 'empresa_registro', 'empresa_pessoas', 'empresa_noticias'] as const;
  const snaps = await Promise.all(nomes.map((e) => ref.collection('coleta').doc(e).get()));
  return Object.fromEntries(nomes.map((e, i) => [e, snaps[i].data()])) as Record<(typeof nomes)[number], Record<string, any> | undefined>;
};

// Analysis moment, called by sintetizar after enquadrar; requires the "sintetizando" state.
export async function graduaAnalise(ref: DocumentReference, p: Pipeline, enq: EnquadramentoGraduacao, versao: string): Promise<Lead> {
  const db = getFirestore();
  const f = (await ref.get()).data();
  if (!f || f.estado !== 'sintetizando') throw new Error('graduar: ficha is not in sintetizando');
  const agora = Timestamp.now();
  const lead = gradua(entradaAnalise(f, await docsDaColeta(ref), enq, agora.toDate()), p.pesosQualificacao);
  const recebidaEm = f.recebidaEm as Timestamp;
  const primeira = f.lead?.momento !== 'analise';

  await db.runTransaction(async (tx) => {
    const atual = (await tx.get(ref)).data();
    if (!atual || atual.estado !== 'sintetizando') throw new Error('graduar: ficha changed meanwhile');
    // Retention: 30 days for grade D (spec 04, section 5); otherwise back to the 90-day rule when a previous
    // version had shortened it and nobody answered yet.
    const curta = guardaCurta(lead);
    const normal = Timestamp.fromMillis(recebidaEm.toMillis() + p.prazoGuardaDias * DIA_MS);
    const expurgo = curta
      ? Timestamp.fromMillis(recebidaEm.toMillis() + p.prazoGuardaDiasBreve * DIA_MS)
      : !atual.respondidaEm && (atual.expurgoEm?.toMillis?.() ?? 0) < normal.toMillis() ? normal : null;
    tx.update(ref, {
      lead: { ...lead, destinoAlterado: atual.lead?.destinoAlterado === true, acao: { ...lead.acao, prazoEm: null }, calculadoEm: agora },
      ...(expurgo ? { expurgoEm: expurgo } : {}),
    });
    tx.create(ref.collection('eventos').doc(), {
      em: agora,
      ator: { tipo: 'sistema', id: 'graduar' },
      tipo: 'graduada',
      detalhe: { versao, quadrante: lead.quadrante, grau: lead.grau, pontos: lead.pontos, destino: lead.destino, escopo: lead.modificadores.escopo, versaoPesos: lead.versaoPesos },
    });
    if (primeira) {
      tx.set(
        db.collection('metricas').doc(mesDe(recebidaEm.toDate())),
        { analise: { quadrante: { [lead.quadrante]: FieldValue.increment(1) }, grau: { [lead.grau]: FieldValue.increment(1) } }, atualizadoEm: agora },
        { merge: true },
      );
    }
  });
  return lead;
}

// End of verificar: confidence with the pending issues (spec 04, 2.5), without touching quadrant, grade or
// destination; prazoEm from the moment the analysis is ready (only when prontaEm is given, i.e. not on a
// human edit). Returns the updated lead fields, written by the caller inside its transaction.
export async function confiancaFinal(ref: DocumentReference, f: Record<string, any>, comPendencias: boolean, prontaEm: Date | null) {
  const lead = f.lead as Lead;
  const enq: EnquadramentoGraduacao = {
    estruturaTecnologia: { categoria: 'sem_sinal', evidencia: '' }, escopo: { resultado: lead.modificadores.escopo ?? 'aprovado' },
    porta: { provavel: 'indeterminada', sinais: [] }, hipotesesDeAlavanca: [], riscosDoLead: [], leituraDoPotencial: { direcao: 'indeterminado' },
  };
  const c = confianca(entradaAnalise(f, await docsDaColeta(ref), enq, new Date(), comPendencias));
  const prazo = prontaEm ? prazoDaAnalise(lead, prontaEm) : undefined;
  return {
    'lead.modificadores.confianca': c.nivel,
    'lead.modificadores.confiancaMotivo': c.motivo,
    ...(prazo !== undefined ? { 'lead.acao.prazoEm': prazo ? Timestamp.fromDate(prazo) : null } : {}),
  };
}
