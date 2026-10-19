// Site-wide constants.
// DOMINIO (the site's absolute origin) and INDEXAVEL (whether search engines may index the build)
// are decided in src/lib/origem.mjs, which astro.config.mjs also imports.
export { DOMINIO, INDEXAVEL, EM_PRODUCAO } from './lib/origem.mjs';
export const EMAIL_CONTATO = 'contato@dominio.exemplo'; // placeholder until the domain is decided
export const MARCA = 'GM Digital Bunker™';
// External addresses, per the stage-1 content doc
export const AMAZON = 'https://www.amazon.com.br/dp/B0H7QR7DZ7';
export const AMAZON_EN = 'https://www.amazon.com/dp/B0H7QR7DZ7'; // US store, for the English pages
export const LINKEDIN = 'https://www.linkedin.com/in/gjunio0';
export const HUB = 'https://ai-strat-hub.netlify.app';
