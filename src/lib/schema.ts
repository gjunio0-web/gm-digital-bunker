// Structured data (JSON-LD) for every page: one @graph with the entities of the site –
// the practice, its founder, the website and the page – plus the entity each page is about
// (the book, a service, the Hub). Entities are referenced by @id, never repeated.
// No e-mail, legal name or tax number is emitted until those exist (see the site plan).
import { AMAZON, AMAZON_EN, DOMINIO, HUB, LINKEDIN, MARCA } from '../config';
import { home } from '../content/home';
import { path, type Lang, type PageId } from '../i18n/routes';
import { datas } from './datas.mjs';

const ref = (id: string) => ({ '@id': id });
const ID = {
  org: `${DOMINIO}/#organizacao`,
  pessoa: `${DOMINIO}/#pessoa`,
  site: `${DOMINIO}/#site`,
  hub: `${DOMINIO}/#hub`,
};
// Shared across languages: the book and each service are the same entity in Portuguese and English.
const idLivro = `${DOMINIO}${path('livro', 'pt-BR')}#livro`;
const idServico = (id: PageId) => `${DOMINIO}${path(id, 'pt-BR')}#servico`;
const url = (id: PageId, lang: Lang) => `${DOMINIO}${path(id, lang)}`;

const textos = {
  'pt-BR': {
    cargo: 'Estrategista de tecnologia em IA',
    publico: 'Empresas de pequeno e médio porte',
    hub: 'Painel na web que indica a IA mais adequada a cada perfil de trabalho.',
    livroTitulo: 'Aumentação profissional por uso de IA. De Análise Estratégica a Produção Técnica',
  },
  en: {
    cargo: 'AI technology strategist',
    publico: 'Small and medium-sized businesses',
    hub: 'A web dashboard that points to the most suitable AI for each work profile.',
    livroTitulo: 'Aumentação profissional por uso de IA. De Análise Estratégica a Produção Técnica',
  },
} as const;

const tipoDaPagina: Partial<Record<PageId, string>> = { sobre: 'AboutPage', contato: 'ContactPage', publicacoes: 'CollectionPage' };
const paginasComHub: PageId[] = ['inicio', 'metodo', 'publicacoes', 'sobre'];

export function grafo(o: { lang: Lang; pageId: PageId; title: string; description: string }) {
  const { lang, pageId, title, description } = o;
  const tx = textos[lang];
  const nos: Record<string, unknown>[] = [];

  nos.push({
    '@type': 'ProfessionalService',
    '@id': ID.org,
    name: MARCA,
    url: `${DOMINIO}/`,
    description: home[lang].jsonLdDescription,
    areaServed: 'BR',
    address: { '@type': 'PostalAddress', addressLocality: 'São Paulo', addressCountry: 'BR' },
    founder: ref(ID.pessoa),
  });
  nos.push({
    '@type': 'Person',
    '@id': ID.pessoa,
    name: 'Gonçalo Marques',
    jobTitle: tx.cargo,
    url: url('sobre', lang),
    image: `${DOMINIO}/imagens/goncalo-marques.jpg`,
    sameAs: [LINKEDIN],
    worksFor: ref(ID.org),
    alumniOf: [
      { '@type': 'CollegeOrUniversity', name: 'Universidade Estadual de Campinas (Unicamp)' },
      { '@type': 'CollegeOrUniversity', name: 'Fundação Getulio Vargas (FGV)' },
    ],
  });
  nos.push({
    '@type': 'WebSite',
    '@id': ID.site,
    url: `${DOMINIO}/`,
    name: MARCA,
    inLanguage: ['pt-BR', 'en'],
    publisher: ref(ID.org),
  });

  const d = (datas[lang] as Record<string, { publicado: string; atualizado: string }>)[pageId];
  nos.push({
    '@type': tipoDaPagina[pageId] ?? 'WebPage',
    '@id': `${url(pageId, lang)}#pagina`,
    url: url(pageId, lang),
    name: title,
    description,
    inLanguage: lang,
    isPartOf: ref(ID.site),
    ...(d ? { datePublished: d.publicado, dateModified: d.atualizado } : {}),
  });

  if (pageId === 'livro') {
    nos.push({
      '@type': 'Book',
      '@id': idLivro,
      name: 'Quando é Melhor com IA',
      ...(lang === 'en' ? { alternateName: "When it's Better with AI" } : {}),
      alternativeHeadline: tx.livroTitulo,
      url: url('livro', lang),
      image: `${DOMINIO}/imagens/capa-quando-e-melhor-com-ia.jpg`,
      author: ref(ID.pessoa),
      publisher: ref(ID.pessoa), // self-published through Amazon KDP
      isbn: '978-65-02-41615-0',
      bookFormat: 'https://schema.org/EBook',
      inLanguage: 'pt-BR',
      numberOfPages: 166,
      datePublished: '2026-07-06',
      offers: { '@type': 'Offer', url: lang === 'en' ? AMAZON_EN : AMAZON },
    });
  }
  if (pageId === 'estrategia' || pageId === 'conselho') {
    nos.push({
      '@type': 'Service',
      '@id': idServico(pageId),
      name: title.replace(/ – GM Digital Bunker™$/, ''),
      description,
      url: url(pageId, lang),
      inLanguage: lang,
      provider: ref(ID.org),
      areaServed: 'BR',
      audience: { '@type': 'BusinessAudience', audienceType: tx.publico },
    });
  }
  if (paginasComHub.includes(pageId)) {
    nos.push({
      '@type': 'SoftwareApplication',
      '@id': ID.hub,
      name: 'AI Strategy Hub',
      url: HUB,
      description: tx.hub,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'BRL' },
      provider: ref(ID.org),
    });
  }
  return { '@context': 'https://schema.org', '@graph': nos };
}

// BreadcrumbList for the inner pages; the last crumb (the page itself) carries no address.
export function trilha(crumbs: { label: string; href?: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.label,
      ...(c.href ? { item: `${DOMINIO}${c.href === '/' ? '/' : c.href}` } : {}),
    })),
  };
}

// JSON for an inline <script>: "<" is escaped so the text can never close the tag.
export const emJson = (obj: unknown) => JSON.stringify(obj).replace(/</g, '\\u003c');
