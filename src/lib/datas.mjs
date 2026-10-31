// Publication and modification dates per page, in ISO 8601, used in the JSON-LD (datePublished, dateModified).
// Maintained by hand: set `atualizado` to the day the page text changes. `arquivos` lists the source files
// that make up each page, so `npm run check:seo` can warn when a file was committed after its date.
// Initial values come from the first and last commit of each source file in the repository (14–19/10/2026).
// Commits up to this day were reviewed and changed no page text (structured data, fonts, images, headers),
// so `check:seo` only warns about commits after it. Move the day forward after each such review.
export const revisadoAte = '2026-10-31';

export const datas = {
  'pt-BR': {
    inicio: { publicado: '2026-10-14', atualizado: '2026-10-26', arquivos: ['src/pages/index.astro', 'src/templates/Home.astro', 'src/content/home.ts'] },
    servicos: { publicado: '2026-10-14', atualizado: '2026-10-26', arquivos: ['src/pages/servicos/index.astro'] },
    estrategia: { publicado: '2026-10-14', atualizado: '2026-10-23', arquivos: ['src/pages/servicos/estrategia-e-plataforma-digital-com-ia.astro'] },
    conselho: { publicado: '2026-10-14', atualizado: '2026-10-23', arquivos: ['src/pages/servicos/conselho-de-ia.astro'] },
    workshop: { publicado: '2026-10-23', atualizado: '2026-10-23', arquivos: ['src/pages/servicos/workshop-quando-e-melhor-com-ia.astro'] },
    caso: { publicado: '2026-10-14', atualizado: '2026-10-16', arquivos: ['src/pages/casos/elite-90-pro.astro'] },
    metodo: { publicado: '2026-10-14', atualizado: '2026-10-23', arquivos: ['src/pages/metodo/index.astro'] },
    livro: { publicado: '2026-10-14', atualizado: '2026-10-16', arquivos: ['src/pages/metodo/livro.astro'] },
    publicacoes: { publicado: '2026-10-14', atualizado: '2026-10-15', arquivos: ['src/pages/publicacoes.astro'] },
    sobre: { publicado: '2026-10-14', atualizado: '2026-10-29', arquivos: ['src/pages/sobre.astro'] },
    contato: { publicado: '2026-10-14', atualizado: '2026-10-15', arquivos: ['src/pages/contato.astro'] },
    privacidade: { publicado: '2026-10-14', atualizado: '2026-10-31', arquivos: ['src/pages/privacidade.astro'] },
  },
  en: {
    inicio: { publicado: '2026-10-15', atualizado: '2026-10-26', arquivos: ['src/pages/en/index.astro', 'src/templates/Home.astro', 'src/content/home.ts'] },
    servicos: { publicado: '2026-10-15', atualizado: '2026-10-26', arquivos: ['src/pages/en/services/index.astro'] },
    estrategia: { publicado: '2026-10-15', atualizado: '2026-10-23', arquivos: ['src/pages/en/services/ai-strategy-and-digital-platform.astro'] },
    conselho: { publicado: '2026-10-15', atualizado: '2026-10-23', arquivos: ['src/pages/en/services/ai-advisory.astro'] },
    workshop: { publicado: '2026-10-23', atualizado: '2026-10-23', arquivos: ['src/pages/en/services/when-its-better-with-ai-workshop.astro'] },
    caso: { publicado: '2026-10-15', atualizado: '2026-10-16', arquivos: ['src/pages/en/cases/elite-90-pro.astro'] },
    metodo: { publicado: '2026-10-15', atualizado: '2026-10-23', arquivos: ['src/pages/en/method/index.astro'] },
    livro: { publicado: '2026-10-15', atualizado: '2026-10-19', arquivos: ['src/pages/en/method/book.astro'] },
    publicacoes: { publicado: '2026-10-15', atualizado: '2026-10-15', arquivos: ['src/pages/en/publications.astro'] },
    sobre: { publicado: '2026-10-15', atualizado: '2026-10-29', arquivos: ['src/pages/en/about.astro'] },
    contato: { publicado: '2026-10-15', atualizado: '2026-10-15', arquivos: ['src/pages/en/contact.astro'] },
    privacidade: { publicado: '2026-10-15', atualizado: '2026-10-31', arquivos: ['src/pages/en/privacy.astro'] },
  },
};
