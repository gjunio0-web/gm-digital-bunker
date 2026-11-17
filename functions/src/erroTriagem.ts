// Records erro for a failed step (spec 01 v0.39, section 4.1). A failure of a triagem step is recorded only while the
// ficha is still where that step runs: qualificar in coleta_minima; graduar in qualificada and without lead. Otherwise
// another execution already took the ficha forward (the lock error of a duplicated run), and an erro written now would
// have no Reexecutar action to clear it (validaAlvo offers qualificacao in exactly these two states). The read and the
// write are one transaction, so the check cannot go stale between them. Other steps keep the plain write.
import { logger } from 'firebase-functions';
import { getFirestore, Timestamp, type DocumentReference } from 'firebase-admin/firestore';

type Ficha = { estado?: string; lead?: unknown } | undefined;

// Pure condition: may an erro of this step be recorded on a ficha in this state?
export function erroCabe(etapa: string, f: Ficha): boolean {
  if (!f) return false;
  if (etapa === 'qualificar') return f.estado === 'coleta_minima';
  if (etapa === 'graduar') return f.estado === 'qualificada' && !f.lead;
  return true;
}

export async function gravaErro(ref: DocumentReference, etapa: string, mensagem: string): Promise<boolean> {
  const erro = { etapa, mensagem, em: Timestamp.now() };
  try {
    if (etapa !== 'qualificar' && etapa !== 'graduar') {
      await ref.update({ erro });
      return true;
    }
    return await getFirestore().runTransaction(async (tx) => {
      const f = (await tx.get(ref)).data();
      if (!erroCabe(etapa, f)) return false;
      tx.update(ref, { erro });
      return true;
    }).then((gravou) => {
      if (!gravou) logger.error('erro not recorded: the ficha is no longer where the step runs', { id: ref.id, etapa });
      return gravou;
    });
  } catch {
    return false;
  }
}
