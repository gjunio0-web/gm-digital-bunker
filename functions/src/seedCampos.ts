// Lists the default fields missing from a stored document, as dotted field paths for update().
// Values already stored are never returned, so applying the result cannot overwrite an edit.
type Mapa = Record<string, unknown>;
const ehMapa = (v: unknown): v is Mapa => typeof v === 'object' && v !== null && !Array.isArray(v);

export function camposAusentes(padrao: Mapa, atual: Mapa, prefixo = ''): Mapa {
  const faltam: Mapa = {};
  for (const [chave, valor] of Object.entries(padrao)) {
    const caminho = prefixo + chave;
    if (!(chave in atual)) faltam[caminho] = valor;
    else if (ehMapa(valor) && ehMapa(atual[chave])) Object.assign(faltam, camposAusentes(valor, atual[chave] as Mapa, `${caminho}.`));
  }
  return faltam;
}
