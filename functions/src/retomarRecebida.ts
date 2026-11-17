// retomarRecebida – runs when acaoAdmin clears the erro of a ficha that stayed in recebida (spec 01 v0.41, section
// 4.1, item 3, alvo "coleta_minima"): the collection starts again from the beginning, with the same body as
// coletarMinima (coletaMinimaCorpo.ts). coletarMinima keeps firing only on creation. The claim is the one of the
// body (transaction on estado and estadoEm), so a second delivery of the event does nothing.
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { APOLLO_API_KEY, CLAUDE_API_KEY, REGIAO, SMTP2GO_API_KEY } from './config.js';
import { executaColetaMinima } from './coletaMinimaCorpo.js';

type Ficha = { estado?: string; erro?: unknown } | undefined;

// Pure trigger condition: erro went from filled to null while the ficha is still in recebida.
export function deveRetomarRecebida(antes: Ficha, depois: Ficha): boolean {
  return Boolean(antes?.erro) && Boolean(depois) && !depois?.erro && depois?.estado === 'recebida';
}

export const retomarRecebida = onDocumentUpdated(
  { document: 'fichas/{id}', region: REGIAO, secrets: [CLAUDE_API_KEY, APOLLO_API_KEY, SMTP2GO_API_KEY], memory: '1GiB', timeoutSeconds: 540, maxInstances: 3, retry: false },
  async (evento) => {
    if (!deveRetomarRecebida(evento.data?.before.data(), evento.data?.after.data())) return;
    await executaColetaMinima(evento.params.id);
  },
);
