// Claim of a version by verificar (phase 6, item 2): Firestore triggers deliver at least once, so two runs
// of verificar may start for the same analise/vN. The first transaction to mark verificacaoIniciadaEm wins;
// the other one returns without calling the model. The marker stays after a failure: there is no automatic
// re-run, and a manual one creates a new version.
import { Timestamp, type DocumentReference, type Firestore } from 'firebase-admin/firestore';

export async function reivindicaVerificacao(db: Firestore, docVersao: DocumentReference): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const v = (await tx.get(docVersao)).data();
    if (!v || v.verificacao || v.verificacaoIniciadaEm) return false;
    tx.update(docVersao, { verificacaoIniciadaEm: Timestamp.now() });
    return true;
  });
}
