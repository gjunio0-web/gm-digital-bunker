// Counts consecutive taps (or clicks) on one element and calls `aoCompletar` on the last of `total`, as long as
// each tap comes within `intervaloMs` of the previous one. A longer pause restarts the count from that tap.
// Used by the hidden admin shortcut in the footer; it has no visible state, so nothing on the page changes.
export interface OpcoesToques {
  total?: number;
  intervaloMs?: number;
  agora?: () => number;
}

export function contarToques(el: HTMLElement, aoCompletar: () => void, opcoes: OpcoesToques = {}): void {
  const { total = 5, intervaloMs = 1500, agora = () => performance.now() } = opcoes;
  let seguidos = 0;
  let ultimo = Number.NEGATIVE_INFINITY;
  el.addEventListener('click', () => {
    const t = agora();
    seguidos = t - ultimo <= intervaloMs ? seguidos + 1 : 1;
    ultimo = t;
    if (seguidos >= total) {
      seguidos = 0;
      ultimo = Number.NEGATIVE_INFINITY;
      aoCompletar();
    }
  });
}
