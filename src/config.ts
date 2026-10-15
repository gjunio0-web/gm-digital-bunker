// Site-wide constants.
// DOMINIO: the site's absolute origin, used for canonical, hreflang, Open Graph and JSON-LD.
// Netlify provides it at build time: DEPLOY_PRIME_URL for the deploy being built (branch deploys
// and previews included) and URL for the site's main address (the custom domain, once configured).
// Set DOMINIO_FIXO to pin it explicitly; the placeholder is the last resort (local builds).
const PLACEHOLDER = 'https://dominio.exemplo';
const semBarra = (u?: string) => (u ? u.replace(/\/+$/, '') : undefined);
export const DOMINIO = semBarra(process.env.DOMINIO_FIXO) ?? semBarra(process.env.DEPLOY_PRIME_URL) ?? semBarra(process.env.URL) ?? PLACEHOLDER;
export const EMAIL_CONTATO = 'contato@dominio.exemplo'; // placeholder until the domain is decided
export const MARCA = 'GM Digital Bunker™';
// External addresses, per the stage-1 content doc
export const AMAZON = 'https://www.amazon.com.br/dp/B0H7QR7DZ7';
export const AMAZON_EN = 'https://www.amazon.com/-/pt/dp/B0H7QR7DZ7/'; // US store, for the English pages
export const LINKEDIN = 'https://www.linkedin.com/in/gjunio0';
export const HUB = 'https://ai-strat-hub.netlify.app';
