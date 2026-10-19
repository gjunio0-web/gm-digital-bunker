// Single source of truth for the site origin and for the indexing switch.
// Imported by astro.config.mjs and src/config.ts so the two can never disagree.
//
// Origin (DOMINIO), in order of precedence:
//   1. DOMINIO_FIXO – pins the origin explicitly (set it, in the production context only, once the domain exists).
//   2. Production deploy on Netlify (CONTEXT === 'production') – URL, the site's main address.
//   3. Any other Netlify build (branch deploys, previews) – DEPLOY_PRIME_URL, the address of that deploy, then URL.
//   4. A placeholder, for local builds.
//
// Indexing (INDEXAVEL): the site is open to search engines only in a production deploy that also has
// DOMINIO_FIXO set. Until the domain exists, every environment is built with noindex.
const PLACEHOLDER = 'https://dominio.exemplo';
const semBarra = (u) => (u ? u.replace(/\/+$/, '') : undefined);

const env = process.env;
const fixo = semBarra(env.DOMINIO_FIXO);
export const EM_PRODUCAO = env.CONTEXT === 'production';

export const DOMINIO =
  fixo ??
  (EM_PRODUCAO ? semBarra(env.URL) : semBarra(env.DEPLOY_PRIME_URL) ?? semBarra(env.URL)) ??
  PLACEHOLDER;

export const INDEXAVEL = EM_PRODUCAO && Boolean(fixo);
