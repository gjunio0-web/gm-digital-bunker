// coletarMinima – runs when a ficha is created (spec 01, sections 3 and 4; spec 02, sections 1 and 2;
// spec 04, section 1). Computes dominioCorporativo and siteResolvido, records versaoMetodo, runs
// empresa_digital (without Apify) and then empresa_registro, and in the same invocation calls qualificar
// and graduar (triagem). Every ficha goes through it, spam included. The claim is a transaction on the
// "recebida" state, so a second delivery of the event does nothing.
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { CLAUDE_API_KEY, APOLLO_API_KEY, REGIAO, SMTP2GO_API_KEY } from './config.js';
import { executaColetaMinima } from './coletaMinimaCorpo.js';

// The body lives in coletaMinimaCorpo.ts, shared with retomarRecebida; this function only fires on creation.
export const coletarMinima = onDocumentCreated(
  { document: 'fichas/{id}', region: REGIAO, secrets: [CLAUDE_API_KEY, APOLLO_API_KEY, SMTP2GO_API_KEY], memory: '1GiB', timeoutSeconds: 540, maxInstances: 5, retry: false },
  async (evento) => executaColetaMinima(evento.params.id),
);
