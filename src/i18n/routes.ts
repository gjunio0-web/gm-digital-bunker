// Page addresses per language. The id is what pages and components use; the language switch
// links to the same page in the other language.
export type Lang = 'pt-BR' | 'en';
export const LANGS: Lang[] = ['pt-BR', 'en'];

export const routes = {
  inicio:      { 'pt-BR': '/',                                                 en: '/en' },
  servicos:    { 'pt-BR': '/servicos',                                         en: '/en/services' },
  estrategia:  { 'pt-BR': '/servicos/estrategia-e-plataforma-digital-com-ia',  en: '/en/services/ai-strategy-and-digital-platform' },
  conselho:    { 'pt-BR': '/servicos/conselho-de-ia',                          en: '/en/services/ai-advisory' },
  caso:        { 'pt-BR': '/casos/elite-90-pro',                               en: '/en/cases/elite-90-pro' },
  metodo:      { 'pt-BR': '/metodo',                                           en: '/en/method' },
  livro:       { 'pt-BR': '/metodo/livro',                                     en: '/en/method/book' },
  publicacoes: { 'pt-BR': '/publicacoes',                                      en: '/en/publications' },
  sobre:       { 'pt-BR': '/sobre',                                            en: '/en/about' },
  contato:     { 'pt-BR': '/contato',                                          en: '/en/contact' },
  privacidade: { 'pt-BR': '/privacidade',                                      en: '/en/privacy' },
  naoEncontrada: { 'pt-BR': '/404',                                            en: '/404' },
} as const;

export type PageId = keyof typeof routes;

export const path = (id: PageId, lang: Lang) => routes[id][lang];
export const otherLang = (lang: Lang): Lang => (lang === 'en' ? 'pt-BR' : 'en');
