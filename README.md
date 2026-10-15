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

Buscar por `[dominio]` ou pelos nomes abaixo:

| Item | Onde | O que fazer |
|---|---|---|
| Domínio | `src/config.ts` (`DOMINIO`, `EMAIL_CONTATO`) e `astro.config.mjs` (`site`) | Trocar `dominio.exemplo` pelo domínio definitivo. Afeta canonical, hreflang, dados estruturados, o e-mail de contato e o endereço absoluto da imagem Open Graph (sem domínio real, as prévias de link não aparecem). |
| Formulário desativado | `src/components/ContactForm.astro` (`DESATIVADO = true`) | Mudar para `false` quando a página de Privacidade for publicada. Até lá os campos aparecem desabilitados, com aviso e e-mail alternativo. |
| Página de Privacidade | `src/pages/privacidade.astro` | Só a estrutura das seções; o texto depende de revisão jurídica e da pessoa jurídica responsável pelos dados. |
| Versão em inglês | `Header.astro`/`Footer.astro` (link `/en/`) e `hreflang` em `Base.astro` | Os links existem; as páginas `/en/...` entram depois da aprovação do conteúdo em português. |
| Formatos, prazos e honorários | `src/pages/servicos/index.astro` (comentário) | Fora do lançamento, conforme o documento de conteúdo. |

## Estrutura

```
src/
  config.ts                 constantes (domínio, e-mail, marca, endereços externos)
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
  pages/                    uma página por endereço (12 páginas, inclusive 404 e privacidade)
public/imagens/             capa do livro, capturas do site Elite 90 Pro e do AI Strategy Hub, retrato do autor
public/og/og-image.jpg      imagem Open Graph (1200×630) para prévias de link; regerar com `npm run og` (na primeira vez, `npx playwright install chromium`)
scripts/og/                 fonte da imagem OG (og.html + render.mjs)
```

## Comportamentos conferidos

- Abertura animada com botão "Pausar animação" (WCAG 2.2.2); nada se move com `prefers-reduced-motion`.
- Tema escuro por padrão; o claro é lembrado entre páginas.
- "Agendar conversa" aponta para `/contato`; com JavaScript abre o diálogo na própria página (Esc, clique fora e botão fecham; o foco volta ao botão). A página de Contato não tem diálogo nem barra de ação, e o botão do cabeçalho fica secundário.
- Carrossel da seção 01 no celular: setas, "n de 3", sem barra de rolagem; no desktop, grade de três.
- Contraste conferido em todas as páginas e nos dois temas (texto 4,5:1; texto grande 3:1): sem falhas.
