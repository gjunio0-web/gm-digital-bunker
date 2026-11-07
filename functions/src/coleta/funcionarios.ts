// Head-count estimate as {faixa, minimo, maximo} (spec 02 v0.10, sections 2.2 and 2.3): faixa is a number or
// a numeric interval ("300", "51-200"); the code fills minimo and maximo, and graduar reads maximo. An
// unrecognized format keeps the original faixa and leaves both numbers null. Pure function.

export interface Funcionarios {
  faixa: string | null;
  minimo: number | null;
  maximo: number | null;
}

// One number, with optional thousands separators ("7.500", "1,200").
const NUM = String.raw`(\d{1,3}(?:[.,]\d{3})+|\d+)`;
const UNICO = new RegExp(`^${NUM}$`);
const INTERVALO = new RegExp(`^${NUM}\\s*(?:-|–|—|a|até|to)\\s*${NUM}$`, 'i');
const valor = (s: string) => Number(s.replace(/[.,]/g, ''));

export function normalizaFuncionarios(faixa: unknown): Funcionarios {
  if (typeof faixa === 'number' && Number.isFinite(faixa) && faixa >= 0) return { faixa: String(faixa), minimo: faixa, maximo: faixa };
  if (typeof faixa !== 'string' || !faixa.trim()) return { faixa: null, minimo: null, maximo: null };
  const t = faixa.trim();
  const u = UNICO.exec(t);
  if (u) return { faixa: t, minimo: valor(u[1]), maximo: valor(u[1]) };
  const i = INTERVALO.exec(t);
  if (i && valor(i[1]) <= valor(i[2])) return { faixa: t, minimo: valor(i[1]), maximo: valor(i[2]) };
  return { faixa: t, minimo: null, maximo: null };
}
