// Site-wide constants.
// DOMINIO (the site's absolute origin) and INDEXAVEL (whether search engines may index the build)
// are decided in src/lib/origem.mjs, which astro.config.mjs also imports.
import { EM_PRODUCAO } from './lib/origem.mjs';
export { DOMINIO, INDEXAVEL, EM_PRODUCAO } from './lib/origem.mjs';
export const EMAIL_CONTATO = 'contato@gmdigitalbunker.com.br';
// Contact form backend (Firebase function, one project per environment). Production builds post to
// gmdb-producao, every other build to gmdb-qualidade. FORMULARIO_EM_PRODUCAO switches the form off
// in production only (fields disabled, with notice and e-mail); on since 2026-10-31.
const FORMULARIO_EM_PRODUCAO = true;
export const FORMULARIO_ATIVO = EM_PRODUCAO ? FORMULARIO_EM_PRODUCAO : true;
export const ENDPOINT_CONTATO = EM_PRODUCAO
  ? 'https://southamerica-east1-gmdb-producao.cloudfunctions.net/contato'
  : 'https://southamerica-east1-gmdb-qualidade.cloudfunctions.net/contato';
export const MARCA = 'GM Digital Bunker™';
// External addresses, per the stage-1 content doc
export const AMAZON = 'https://www.amazon.com.br/dp/B0H7QR7DZ7';
export const AMAZON_EN = 'https://www.amazon.com/dp/B0H7QR7DZ7'; // US store, for the English pages
export const LINKEDIN = 'https://www.linkedin.com/in/gjunio0';
export const HUB = 'https://ai-strat-hub.netlify.app';
