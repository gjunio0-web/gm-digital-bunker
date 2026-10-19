// robots.txt generated at build, so the Sitemap line carries the origin of each environment.
// Policy (19/10/2026): every agent may crawl; there is no per-agent rule. Indexing is controlled by
// the noindex tag (see src/lib/origem.mjs), not by Disallow, because a crawler can only obey noindex
// on a page it is allowed to fetch. The Sitemap line appears only when the build is indexable.
import type { APIRoute } from 'astro';
import { DOMINIO, INDEXAVEL } from '../config';

export const GET: APIRoute = () => {
  const linhas = ['User-agent: *', 'Allow: /'];
  if (INDEXAVEL) linhas.push('', `Sitemap: ${DOMINIO}/sitemap-index.xml`);
  return new Response(linhas.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
