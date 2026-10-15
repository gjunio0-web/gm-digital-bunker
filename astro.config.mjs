// @ts-check
import { defineConfig } from 'astro/config';

// Site origin: pinned by DOMINIO_FIXO, else the Netlify deploy address (DEPLOY_PRIME_URL for the
// deploy being built, URL for the site's main address), else a placeholder for local builds.
const semBarra = (u) => (u ? u.replace(/\/+$/, '') : undefined);
const site = semBarra(process.env.DOMINIO_FIXO) ?? semBarra(process.env.DEPLOY_PRIME_URL) ?? semBarra(process.env.URL) ?? 'https://dominio.exemplo';

export default defineConfig({
  site,
  trailingSlash: 'never',
  build: { format: 'file' },
  i18n: { defaultLocale: 'pt-BR', locales: ['pt-BR', 'en'], routing: { prefixDefaultLocale: false } },
});
