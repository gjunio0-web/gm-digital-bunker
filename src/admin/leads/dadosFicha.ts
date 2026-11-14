// Firestore reading for the ficha detail (spec 05 §5.4; guide v1.3 §5.2): the ficha, its analysis versions,
// its events and its collection stages, all in real time, so a stage that finishes or a new version appears
// without reloading. Read-only; the client never writes (spec 01).
import { collection, doc, onSnapshot, orderBy, query, Timestamp, type Firestore } from 'firebase/firestore';
import type { Analise, DadosFicha, Evento } from './detalhe';

/** Firestore timestamps to Date, recursively (the detail's pure functions only see Date). */
export function semTimestamps<T>(v: T): T {
  if (v instanceof Timestamp) return v.toDate() as unknown as T;
  if (Array.isArray(v)) return v.map(semTimestamps) as unknown as T;
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = semTimestamps(x);
    return o as T;
  }
  return v;
}
const numVersao = (id: string) => Number(/^v(\d+)$/.exec(id)?.[1] ?? 0);

/**
 * Listens to fichas/{id} and its analise, eventos and coleta subcollections. Calls aoMudar with null when the
 * ficha does not exist, and with the whole data each time any part changes (after all four first arrived).
 * Returns the unsubscribe function.
 */
export function ouvirFicha(db: Firestore, id: string, aoMudar: (d: DadosFicha | null) => void, aoErrar: (e: Error) => void): () => void {
  const ref = doc(db, 'fichas', id);
  let f: Record<string, any> | null | undefined;
  let analises: Analise[] | undefined;
  let eventos: Evento[] | undefined;
  let coleta: Record<string, Record<string, any>> | undefined;
  let ativo = true;
  const emitir = () => {
    if (!ativo || f === undefined) return;
    if (f === null) { aoMudar(null); return; }
    if (!analises || !eventos || !coleta) return;
    aoMudar({ id, f, analises, eventos, coleta });
  };
  const erro = (e: Error) => { if (ativo) aoErrar(e); };
  const pares = [
    onSnapshot(ref, (s) => { f = s.exists() ? semTimestamps(s.data()) : null; emitir(); }, erro),
    onSnapshot(collection(ref, 'analise'), (s) => {
      analises = s.docs.map((x) => ({ id: x.id, num: numVersao(x.id), d: semTimestamps(x.data()) })).sort((a, b) => b.num - a.num);
      emitir();
    }, erro),
    onSnapshot(query(collection(ref, 'eventos'), orderBy('em', 'asc')), (s) => {
      eventos = s.docs.map((x) => { const d = semTimestamps(x.data()); return { em: d.em instanceof Date ? d.em : null, tipo: String(d.tipo ?? ''), detalhe: d.detalhe ?? {} }; });
      emitir();
    }, erro),
    onSnapshot(collection(ref, 'coleta'), (s) => {
      coleta = Object.fromEntries(s.docs.map((x) => [x.id, semTimestamps(x.data())]));
      emitir();
    }, erro),
  ];
  return () => { ativo = false; pares.forEach((p) => p()); };
}
