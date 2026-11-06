// graduar – triagem (spec 01, sections 2 to 4 and 7; spec 04): in code, without AI and without network.
// Called right after qualificar. Writes lead, the "triada" event, the next state (descartada,
// resposta_breve, coletando, or "qualificada" kept when autoAnalisar is off), the 30-day retention in the
// short-retention cases and the metrics by quadrant and grade. The analysis moment comes with phase B.
import { FieldValue, getFirestore, Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { DIA_MS, type Pipeline } from './config.js';
import { entradaTriagem, gradua, guardaCurta, prazoDaTriagem, proximoEstado, type Lead } from './graduacao.js';
import { mesDe } from './qualificar.js';

export async function graduaTriagem(ref: DocumentReference, p: Pipeline): Promise<{ lead: Lead; estado: string } | null> {
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

  await db.runTransaction(async (tx) => {
    const atual = (await tx.get(ref)).data();
    if (!atual || atual.estado !== 'qualificada' || atual.lead || !(atual.estadoEm as Timestamp).isEqual(estadoEmLido)) throw new Error('graduar: ficha changed meanwhile');
    tx.update(ref, {
      lead: { ...lead, acao: { ...lead.acao, prazoEm: prazo ? Timestamp.fromDate(prazo) : null }, calculadoEm: agora },
      ...(estado !== 'qualificada' ? { estado, estadoEm: agora } : {}),
      ...(curta ? { expurgoEm: Timestamp.fromMillis(recebidaEm.toMillis() + p.prazoGuardaDiasBreve * DIA_MS) } : {}),
    });
    tx.create(ref.collection('eventos').doc(), {
      em: agora,
      ator: { tipo: 'sistema', id: 'graduar' },
      tipo: 'triada',
      detalhe: { quadrante: lead.quadrante, grau: lead.grau, pontos: lead.pontos, destino: lead.destino, proximoEstado: estado, versaoPesos: lead.versaoPesos },
    });
    tx.set(
      db.collection('metricas').doc(mesDe(recebidaEm.toDate())),
      { triagem: { quadrante: { [lead.quadrante]: FieldValue.increment(1) }, grau: { [lead.grau]: FieldValue.increment(1) } }, atualizadoEm: agora },
      { merge: true },
    );
  });
  return { lead, estado };
}
