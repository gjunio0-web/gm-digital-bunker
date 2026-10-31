# Site da GM Digital Bunker™ – etapa 3 (código navegável)

Site estático em [Astro 5](https://astro.build), pronto para publicação na Netlify. Base visual: prancheta 9 das maquetes (abertura cenário 4 – brutalismo tátil; fundos base e índigo; cartões tingidos; diálogo de contato).

## Como rodar

```bash
npm install
npm run dev       # servidor local em http://localhost:4321
npm run build     # gera a pasta dist/
npm run preview   # serve a pasta dist/ para conferência
```

Requer Node 18.17 ou superior (recomendado: 20 ou 22).

## Publicar na Netlify

1. Criar um repositório com este conteúdo e conectá-lo a um novo site na Netlify.
2. A Netlify lê o `netlify.toml`: comando `npm run build`, pasta `dist`.
3. Depois do primeiro deploy, o formulário "contato" aparece em Site settings → Forms (só passa a receber envios quando for reativado – ver abaixo).

## Pendências marcadas no código

Buscar pelos nomes abaixo:

| Item | Onde | O que fazer |
|---|---|---|
| Formulário desativado | `src/components/ContactForm.astro` (`DESATIVADO = true`) | Mudar para `false` quando a página de Privacidade for publicada. Até lá os campos aparecem desabilitados, com aviso e e-mail alternativo. |
| Página de Privacidade | `src/pages/privacidade.astro` | Texto aprovado por Gon em 15/10/2026, pendente de revisão jurídica. Marcador entre colchetes: razão social e CNPJ. A data de "Última atualização" vem de `src/lib/datas.mjs`. Prazo de guarda: 90 dias (decisão de 31/10/2026). O provedor do formulário é o Firebase (decisão de 30/10/2026). |
| Formatos, prazos e honorários | `src/pages/servicos/index.astro` (comentário) | Fora do lançamento, conforme o documento de conteúdo. |

## Idiomas

Português (padrão, sem prefixo) e inglês americano (`/en/…`), com endereços traduzidos. `src/i18n/routes.ts` mapeia cada página nos dois idiomas e alimenta o link PT/EN do cabeçalho e do rodapé, o canonical e os pares `hreflang`; `src/i18n/ui.ts` guarda os textos de interface (menu, rodapé, formulário, diálogo, barra de ação, 404). A página inicial é um único modelo (`src/templates/Home.astro`) com o conteúdo em `src/content/home.ts`; as páginas internas em inglês ficam em `src/pages/en/`. O AI Strategy Hub é aberto com `?lang=en` a partir das páginas em inglês. A página 404 é uma só, com a linha em inglês abaixo da portuguesa. Textos em inglês traduzidos por Claude e pendentes da revisão de Gon.

## Estrutura

```
src/
  config.ts                 constantes (domínio, e-mail, marca, endereços externos)
  i18n/routes.ts, ui.ts     endereços por idioma e textos de interface
  content/home.ts           conteúdo da página inicial nos dois idiomas
  templates/Home.astro      modelo da página inicial
  styles/global.css         tokens do Design System (temas escuro e claro), tipografia, botões, cartões, abertura animada
  layouts/Base.astro        head, cabeçalho, rodapé, barra de ação (celular) e diálogo de contato
  components/
    Header.astro            cabeçalho fixo, menu no celular, troca de tema (guardada em localStorage)
    Footer.astro
    Opening.astro           abertura das páginas internas (trilha, rótulo, título, grão)
    Invite.astro            convite final em índigo (esconde a barra de ação ao ser alcançado)
    ContactForm.astro       o único formulário (Netlify Forms), usado na página e no diálogo
    ContactDialog.astro     diálogo <dialog> aberto por qualquer "Agendar conversa"
    ActionBar.astro         botão fixo no rodapé da tela em celulares
  pages/                    uma página por endereço em português (12) e, em pages/en/, em inglês (11)
public/imagens/             capa do livro, capturas do site Elite 90 Pro e do AI Strategy Hub, retrato do autor
public/og/                  imagens Open Graph (1200×630), pt e en; regerar com `npm run og` (na primeira vez, `npx playwright install chromium`)
scripts/og/                 fonte da imagem OG (og.html + render.mjs)
```

## Comportamentos conferidos

- Abertura animada com botão "Pausar animação" (WCAG 2.2.2); nada se move com `prefers-reduced-motion`.
- Tema escuro por padrão; o claro é lembrado entre páginas.
- "Agendar conversa" aponta para `/contato`; com JavaScript abre o diálogo na própria página (Esc, clique fora e botão fecham; o foco volta ao botão). A página de Contato não tem diálogo nem barra de ação, e o botão do cabeçalho fica secundário.
- Carrossel da seção 01 no celular: setas, "n de 3", sem barra de rolagem; no desktop, grade de três.
- Contraste conferido em todas as páginas e nos dois temas (texto 4,5:1; texto grande 3:1): sem falhas.
