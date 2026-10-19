// @ts-check
import { defineConfig } from 'astro/config';

import sitemap from '@astrojs/sitemap';
import { DOMINIO as site } from './src/lib/origem.mjs';
import { routes } from './src/i18n/routes.ts';

// Page address -> id, so each sitemap entry can list its translation. The translated pages have
// different addresses (/sobre and /en/about), which the integration's own i18n pairing does not cover.
const idPorEndereco = new Map();
for (const [id, r] of Object.entries(routes)) for (const lang of ['pt-BR', 'en']) idPorEndereco.set(r[lang], id);

export default defineConfig({
  site,
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [
    sitemap({
      filter: (url) => new URL(url).pathname !== '/404',
      serialize(item) {
        const caminho = new URL(item.url).pathname.replace(/\/+$/, '') || '/';
        const id = idPorEndereco.get(caminho);
        if (!id) return item;
        const r = routes[id];
        item.links = [
          { url: `${site}${r['pt-BR']}`, lang: 'pt-BR' },
          { url: `${site}${r.en}`, lang: 'en' },
          { url: `${site}${r['pt-BR']}`, lang: 'x-default' },
        ];
        return item;
      },
    }),
  ],
  i18n: { defaultLocale: 'pt-BR', locales: ['pt-BR', 'en'], routing: { prefixDefaultLocale: false } },
});
