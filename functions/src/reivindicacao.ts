// Claim of a version by verificar (phase 6, item 2): Firestore triggers deliver at least once, so two runs
// of verificar may start for the same analise/vN. The first transaction to mark verificacaoIniciadaEm wins;
// the other one returns without calling the model. The marker stays after a failure: there is no automatic
// re-run, and a manual one creates a new version.
import { FieldValue, Timestamp, type DocumentReference, type Firestore } from 'firebase-admin/firestore';

// `metrica`, only for v1 (spec 01 v0.35): the winner of the claim also counts the ficha once in
// metricas.portaProvavel.{porta}, in the same transaction; later versions (re-run, edit, correction) never count again.
export async function reivindicaVerificacao(db: Firestore, docVersao: DocumentReference, metrica?: { ref: DocumentReference; porta: string }): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const v = (await tx.get(docVersao)).data();
    if (!v || v.verificacao) return false;
    // A marker older than the version itself was copied from another version (an edit that spreads the
    // previous one) and does not count as a claim of this one.
    const marca = v.verificacaoIniciadaEm as Timestamp | undefined;
    const criada = v.criadaEm as Timestamp | undefined;
    if (marca && (!criada || marca.toMillis() >= criada.toMillis())) return false;
    tx.update(docVersao, { verificacaoIniciadaEm: Timestamp.now() });
    if (metrica) tx.set(metrica.ref, { portaProvavel: { [metrica.porta]: FieldValue.increment(1) }, atualizadoEm: Timestamp.now() }, { merge: true });
    return true;
  });
}
