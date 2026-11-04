# Funções do Firebase – recepção e expurgo de fichas

Item 1 da spec 01 (análise preliminar de fichas): `receberFicha` (HTTPS, recebe o formulário) e `expurgar` (agendada, diária às 03:00 de São Paulo). Nenhuma chamada a IA neste item.

**Ramos:** trabalho só em `quality-env`. `main` (produção) só avança por pedido explícito de Gon.

## Projetos e região

| Alias | Projeto | Uso |
|---|---|---|
| `qualidade` | `gmdb-qualidade` | site de qualidade e builds locais |
| `producao` | `gmdb-producao` | gmdigitalbunker.com.br |

Região de todas as funções: `REGIAO` em `src/config.ts` (`southamerica-east1`). Origens aceitas por projeto: `ORIGENS_POR_PROJETO`, no mesmo arquivo.

## Estrutura

| Arquivo | Conteúdo |
|---|---|
| `src/config.ts` | Região, origens, segredos, valores padrão de `config/pipeline` |
| `src/validacao.ts` | Validação dos campos (mesmas regras do formulário) |
| `src/receberFicha.ts` | Recepção: CORS, campo-isca, limites, gravação, evento, e-mails |
| `src/email.ts` | E-mails pela API HTTP do SMTP2GO (no emulador, só registra no log) |
| `src/expurgar.ts` | Expurgo diário da árvore de cada ficha vencida |
| `src/seed.ts` | Grava `config/pipeline` e `config/metodo` uma única vez |
| `scripts/textos.mjs` | Copia os textos dos e-mails de `src/i18n/ui.ts` do site para `src/textos.generated.ts` (roda no build) |
| `../firestore.rules`, `../firestore.indexes.json` | Regras (spec 01, seção 5) e índices |

## Testes

```
cd functions
npm ci
npm test            # build + testes de validação e dos textos
npm run emulador    # build + emuladores (functions, firestore) + teste de ponta a ponta
```

O emulador precisa de Java e do Firebase CLI e lê os segredos de `functions/.secret.local` (fora do Git):

```
SMTP2GO_API_KEY=emulator-not-used
IP_HASH_SALT=emulator-salt
```

No emulador nenhum e-mail é enviado.

## Segredos (Secret Manager)

Criar um por vez, no terminal; o valor nunca aparece no chat nem na tela.

```
# Generated and stored in one step, never displayed
openssl rand -hex 32 | firebase functions:secrets:set IP_HASH_SALT --data-file=- --project qualidade
# Typed at the masked prompt (API key created in SMTP2GO: Sending → API Keys, permission to send)
firebase functions:secrets:set SMTP2GO_API_KEY --project qualidade
# Typed at the masked prompt (used by later items; not bound to receberFicha)
firebase functions:secrets:set CLAUDE_API_KEY --project qualidade
```

Conferir só a existência, sem imprimir o valor:

```
gcloud secrets versions list IP_HASH_SALT --project gmdb-qualidade
```

(`firebase functions:secrets:access` imprime o valor: não usar.)

## Configuração inicial e deploy

```
cd functions && npm ci
npm run seed -- gmdb-qualidade        # once; does not overwrite existing documents
cd ..
firebase deploy --project qualidade --only functions:receberFicha,functions:expurgar,firestore:rules,firestore:indexes
```

O deploy roda o build antes (`predeploy`). `--only functions:receberFicha,functions:expurgar` evita que o CLI apague funções que não estão neste código (a antiga `contato`, enquanto existir).

Produção: os mesmos passos com `producao` / `gmdb-producao`, só por pedido explícito de Gon. Depois, `FORMULARIO_EM_PRODUCAO = true` em `src/config.ts` do site.
