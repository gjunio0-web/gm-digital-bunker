// Firestore reading for the Leads list (spec 05 §5.2): fichas in real time, plus the escopo and porta of the
// current analysis version for the two enquadramento filters. Read-only; the client never writes (spec 01).
import {
  collection, doc, getDoc, onSnapshot, orderBy, query, type DocumentData, type Firestore, type Timestamp,
} from 'firebase/firestore';
import type { FichaVM, Quadrante } from './regras';
import { CARGO } from './regras';

const data = (t: unknown): Date | null => (t && typeof (t as Timestamp).toDate === 'function' ? (t as Timestamp).toDate() : null);
const eixo = (e: any): [number, number] | null =>
  e && typeof e.pontos === 'number' && typeof e.maximo === 'number' && e.maximo > 0 ? [e.pontos, e.maximo] : null;

/** Maps a fichas/{id} document to the list view model. */
export function paraVM(id: string, f: DocumentData, enq: FichaVM['enq']): FichaVM {
  const o = f.original ?? {};
  const l = f.lead;
  return {
    id,
    nome: String(o.nome ?? ''),
    empresa: String(o.empresa ?? ''),
    cargo: CARGO[o.cargo] ?? String(o.cargo ?? ''),
    recebidaEm: data(f.recebidaEm) ?? new Date(0),
    estado: String(f.estado ?? ''),
    erro: f.erro && f.erro.etapa ? { etapa: String(f.erro.etapa) } : null,
    retencao: f.retencao && f.retencao.motivo ? { motivo: String(f.retencao.motivo) } : null,
    respondidaEm: data(f.respondidaEm),
    expurgoEm: data(f.expurgoEm),
    lead: l && l.quadrante && l.grau
      ? {
          momento: l.momento === 'analise' ? 'analise' : 'triagem',
          quadrante: l.quadrante as Quadrante,
          grau: l.grau,
          pontos: Number(l.pontos ?? 0),
          confianca: l.modificadores?.confianca ?? null,
          spam: !!l.modificadores?.spam,
          eixos: { a: eixo(l.eixos?.aderencia), d: eixo(l.eixos?.decisao), i: eixo(l.eixos?.intencao), c: eixo(l.eixos?.clareza) },
          prazoEm: data(l.acao?.prazoEm),
        }
      : null,
    enq,
  };
}

/**
 * Listens to all fichas, newest first (single-field index; no composite index needed), and keeps the
 * enquadramento copy of each ficha's current analysis, read once per analiseAtual value.
 * Returns the unsubscribe function.
 */
export function ouvirFichas(db: Firestore, aoMudar: (fichas: FichaVM[]) => void, aoErrar: (e: Error) => void): () => void {
  const enqPorFicha = new Map<string, { versao: string; enq: FichaVM['enq'] }>();
  let docs: { id: string; d: DocumentData }[] = [];
  let ativo = true;

  const emitir = () => {
    if (!ativo) return;
    aoMudar(docs.map(({ id, d }) => paraVM(id, d, enqPorFicha.get(id)?.enq ?? null)));
  };

  const pare = onSnapshot(
    query(collection(db, 'fichas'), orderBy('recebidaEm', 'desc')),
    (snap) => {
      docs = snap.docs.map((s) => ({ id: s.id, d: s.data() }));
      emitir();
      for (const { id, d } of docs) {
        const versao = typeof d.analiseAtual === 'string' ? d.analiseAtual : null;
        if (!versao) { enqPorFicha.delete(id); continue; }
        if (enqPorFicha.get(id)?.versao === versao) continue;
        enqPorFicha.set(id, { versao, enq: null });
        getDoc(doc(db, 'fichas', id, 'analise', versao))
          .then((a) => {
            const e = a.data()?.enquadramento;
            if (enqPorFicha.get(id)?.versao !== versao) return;
            enqPorFicha.set(id, { versao, enq: { escopo: (typeof e?.escopo === 'object' ? e?.escopo?.resultado : e?.escopo) ?? null, porta: e?.portaProvavel ?? null } });
            emitir();
          })
          .catch(() => undefined);
      }
    },
    (e) => aoErrar(e),
  );
  return () => { ativo = false; pare(); };
}

/** Version of the qualification weights in config/pipeline (for the method window check). */
export async function versaoPesos(db: Firestore): Promise<string | null> {
  try {
    const s = await getDoc(doc(db, 'config', 'pipeline'));
    const v = s.data()?.pesosQualificacao?.versao;
    return v == null ? null : String(v);
  } catch {
    return null;
  }
}
