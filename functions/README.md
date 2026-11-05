# Funções do Firebase – análise preliminar de fichas

Item 1 da spec 01: `receberFicha` (HTTPS, recebe o formulário) e `expurgar` (agendada, diária às 03:00 de São Paulo). Item 3: `qualificar` (gatilho na criação da ficha; regras em código e, quando há mensagem ou o cargo é "other", uma chamada curta ao modelo de `config/pipeline.modeloColeta`).

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
| `src/qualificacao.ts` | Sinais, regras de decisão, esquema e prompt da qualificação (spec 02, seção 1) |
| `src/qualificar.ts` | Gatilho da qualificação: sinais, chamada ao modelo, gravação em transação, evento e métricas |
| `src/claude.ts` | Messages API da Claude por HTTP, com `SISTEMA_BASE` em cache e saída por esquema JSON (no emulador, classificação simulada) |
| `src/custo.ts` | Custo estimado por chamada, pela tabela de preços por modelo |
| `src/configurar.ts` | Grava campos de `config/pipeline` (só com autorização de Gon) |
| `src/seed.ts` | Grava `config/pipeline` e `config/metodo`; rodado de novo, só acrescenta campos ausentes, sem sobrescrever |
| `scripts/textos.mjs` | Copia os textos dos e-mails de `src/i18n/ui.ts` do site para `src/textos.generated.ts` (roda no build) |
| `../firestore.rules`, `../firestore.indexes.json` | Regras (spec 01, seção 5) e índices |

## Testes

```
cd functions
npm ci
npm test            # build + testes de validação, textos, pipeline e regras da qualificação
npm run emulador    # build + emuladores (functions, firestore) + teste de ponta a ponta
```

O emulador precisa de Java e do Firebase CLI e lê os segredos de `functions/.secret.local` (fora do Git):

```
SMTP2GO_API_KEY=emulator-not-used
IP_HASH_SALT=emulator-salt
CLAUDE_API_KEY=emulator-not-used
```

No emulador nenhum e-mail é enviado e a Claude API não é chamada (a qualificação usa uma classificação simulada).

## Segredos (Secret Manager)

Criar um por vez, no terminal; o valor nunca aparece no chat nem na tela.

```
# Generated and stored in one step, never displayed
openssl rand -hex 32 | firebase functions:secrets:set IP_HASH_SALT --data-file=- --project qualidade
# Typed at the masked prompt (API key created in SMTP2GO: Sending → API Keys, permission to send)
firebase functions:secrets:set SMTP2GO_API_KEY --project qualidade
# Typed at the masked prompt (bound to qualificar and the later pipeline functions)
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
npm run seed -- gmdb-qualidade        # re-runnable; only adds missing fields, never overwrites
npm run configurar -- gmdb-qualidade modeloColeta=claude-haiku-5-5 autoAnalisar=false   # only with Gon's authorization
cd ..
firebase deploy --project qualidade --only functions:receberFicha,functions:expurgar,firestore:rules,firestore:indexes
firebase deploy --project gmdb-qualidade --only functions:qualificar
```

Rode os comandos `firebase` a partir da raiz do repositório: o apelido `qualidade` vem do `.firebaserc`; fora dela, use o ID `gmdb-qualidade`.

O deploy roda o build antes (`predeploy`). `--only functions:receberFicha,functions:expurgar` evita que o CLI apague funções que não estão neste código (a antiga `contato`, enquanto existir).

Produção: os mesmos passos com `producao` / `gmdb-producao`, só por pedido explícito de Gon. Depois, `FORMULARIO_EM_PRODUCAO = true` em `src/config.ts` do site.
