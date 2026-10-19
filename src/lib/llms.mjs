// Astro integration: writes dist/llms.txt (llmstxt.org format) once the pages are built.
// Titles and descriptions are read from the generated HTML, so the file follows the pages by itself;
// the page list and the addresses come from src/i18n/routes.ts.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { routes } from '../i18n/routes.ts';
import { DOMINIO } from './origem.mjs';

const MARCA = 'GM Digital Bunker™';
const decode = (s) => s.replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');

// [section title in each language, page ids]
const GRUPOS = [
  [{ 'pt-BR': 'Serviços', en: 'Services' }, ['servicos', 'estrategia', 'conselho']],
  [{ 'pt-BR': 'Método', en: 'Method' }, ['metodo', 'livro']],
  [{ 'pt-BR': 'Casos', en: 'Cases' }, ['caso']],
  [{ 'pt-BR': 'Sobre', en: 'About' }, ['sobre']],
  [{ 'pt-BR': 'Publicações', en: 'Publications' }, ['publicacoes']],
];
const OPCIONAL = ['contato', 'privacidade'];

export default function llmsTxt() {
  return {
    name: 'llms-txt',
    hooks: {
      'astro:build:done': ({ dir }) => {
        const raiz = fileURLToPath(dir);
        const pagina = (id, lang) => {
          const caminho = routes[id][lang];
          const arquivo = `${raiz}${caminho === '/' ? '/index' : caminho}.html`;
          const html = readFileSync(arquivo, 'utf8');
          const titulo = decode((html.match(/<title>([^<]*)<\/title>/) ?? [])[1] ?? id).replace(` – ${MARCA}`, '');
          const descricao = decode((html.match(/<meta name="description" content="([^"]*)"/) ?? [])[1] ?? '');
          return `- [${titulo}](${DOMINIO}${caminho}): ${descricao}`;
        };
        const resumo = decode((readFileSync(`${raiz}/index.html`, 'utf8').match(/<meta name="description" content="([^"]*)"/) ?? [])[1] ?? '');
        const linhas = [`# ${MARCA}`, '', `> ${resumo}`, '', 'Site em português e em inglês. As páginas em inglês estão na seção "English", com os mesmos assuntos. / Site in Portuguese and English; the English pages are in the "English" section.', ''];
        for (const [nomes, ids] of GRUPOS) linhas.push(`## ${nomes['pt-BR']}`, '', ...ids.map((id) => pagina(id, 'pt-BR')), '');
        linhas.push('## English', '');
        for (const [nomes, ids] of GRUPOS) linhas.push(`### ${nomes.en}`, '', ...ids.map((id) => pagina(id, 'en')), '');
        linhas.push('## Optional', '', ...OPCIONAL.map((id) => pagina(id, 'pt-BR')), ...OPCIONAL.map((id) => pagina(id, 'en')), '');
        writeFileSync(`${raiz}/llms.txt`, linhas.join('\n'));
      },
    },
  };
}
