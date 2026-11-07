# Funções do Firebase – análise preliminar de fichas

Item 1 da spec 01: `receberFicha` (HTTPS, recebe o formulário) e `expurgar` (agendada, diária às 03:00 de São Paulo). Item 5: `publicarMetodo` (HTTPS privada; publica a pasta `metodo/` no bucket privado e grava `config/metodo`). Mudança de método de 6/11/2026 (spec 04): `coletarMinima` (gatilho na criação da ficha; `empresa_digital` sem Apify e `empresa_registro`, depois `qualificar` – chamada ao modelo de `config/pipeline.modeloColeta`, sempre – e `graduar`, a triagem em código, que grava `lead` e define o próximo estado) e `coletar` (gatilho quando a ficha passa a `coletando`; na primeira passagem, as quatro etapas restantes e o Instagram pelo Apify; numa reexecução, as etapas marcadas como pendentes).

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
| `src/qualificacao.ts` | Sinais, nível do cargo, regra de descarte, esquema e prompt da qualificação (spec 02, seção 1) |
| `src/qualificar.ts` | Qualificação chamada ao fim da coleta mínima: chamada ao modelo com a seção 1 de `portas-materiais.md`, gravação em transação, evento e métricas |
| `src/graduacao.ts` | Eixos, parcelas e marcas, quadrante, grau, destino, confiança, guarda, prazo em dias úteis com feriados nacionais (spec 04; funções puras) |
| `src/graduar.ts` | Triagem: grava `lead`, o evento `triada`, o próximo estado, a guarda de 30 dias e as métricas por quadrante e grau |
| `src/coletarMinima.ts` | Coleta mínima para toda ficha, seguida de `qualificar` e `graduar` |
| `src/claude.ts` | Messages API da Claude por HTTP, com `SISTEMA_BASE` em cache e saída por esquema JSON (no emulador, classificação simulada) |
| `src/custo.ts` | Custo estimado por chamada, pela tabela de preços por modelo |
| `src/configurar.ts` | Grava campos de `config/pipeline` (só com autorização de Gon) |
| `src/metodoArquivos.ts` | Ordem fixa dos cinco arquivos do método, resumo (bytes, SHA-256), filtro por seção |
| `src/metodo.ts` | Leitura do método publicado pelas funções, com cache por versão na instância |
| `src/publicarMetodo.ts` | Publicação do método: grava os arquivos em `gs://<projeto>-metodo/metodo/<versao>/`, conta os tokens pela Claude API e grava `config/metodo` |
| `scripts/publicar-metodo.mjs` | Chama `publicarMetodo` com a identidade de quem roda (Cloud Shell) |
| `../storage.rules` | Acesso de cliente ao Storage fechado (vale no emulador e se o Firebase Storage for ativado) |
| `src/coletar.ts` | Coleta restante e reexecuções: trava por transação, orçamento de buscas, ordem das etapas, eventos, custo |
| `src/coleta/motor.ts` | Motor das etapas, comum às duas funções: contexto, tetos por fornecedor, chamada ao modelo, as seis etapas, `insumosCodigo`, gravação de `coleta/{etapa}`, Instagram pelo Apify |
| `src/coleta/rede.ts` | Leitura protegida de endereços vindos do formulário (sem rede interna, até 2 MB, 10 s) e chamadas aos fornecedores |
| `src/coleta/site.ts` | Até seis páginas do site, links, Instagram, tecnologias, CNPJs (privacidade e termos só para o CNPJ) |
| `src/coleta/cnpj.ts` | Padrão e dígitos verificadores do CNPJ; BrasilAPI só pelo número; sócios só com nome e qualificação |
| `src/coleta/fornecedores.ts` | Apollo (empresa pelo domínio), Apify (Instagram da empresa), Hunter (só os campos da tabela 5.1 da spec 03) |
| `src/coleta/claudeColeta.ts` | Chamadas da coleta: busca e leitura de páginas como ferramentas do servidor, JSON validado no código, uma correção |
| `src/coleta/envelope.ts` | Envelope da spec 02 §2: fontes verificadas, índices, regra de preenchimento |
| `src/coleta/etapas.ts`, `textosSpec.ts` | Tetos de busca, arquivos do método, instruções e esquemas de cada etapa (textos da spec 02) |
| `scripts/fichas-teste.mjs` | Fichas de teste gravadas direto no Firestore (sem e-mails), que seguem o pipeline sozinhas; reexecução de etapas (`--reexecutar`, `--etapas=`, `--ficha=`, `--uma-por-vez`); relatório com a triagem e as etapas |
| `src/seed.ts` | Grava `config/pipeline` e `config/metodo`; rodado de novo, só acrescenta campos ausentes, sem sobrescrever |
| `scripts/textos.mjs` | Copia os textos dos e-mails de `src/i18n/ui.ts` do site para `src/textos.generated.ts` (roda no build) |
| `../firestore.rules`, `../firestore.indexes.json` | Regras (spec 01, seção 5) e índices |

## Testes

```
cd functions
npm ci
npm test            # build + testes de validação, textos, pipeline, qualificação, método, coleta e graduação
npm run emulador    # build + emuladores (functions, firestore, storage) + teste de ponta a ponta
```

O emulador precisa de Java e do Firebase CLI e lê os segredos de `functions/.secret.local` (fora do Git):

```
SMTP2GO_API_KEY=emulator-not-used
IP_HASH_SALT=emulator-salt
CLAUDE_API_KEY=emulator-not-used
APOLLO_API_KEY=emulator-not-used
APIFY_TOKEN=emulator-not-used
HUNTER_API_KEY=emulator-not-used
```

No emulador nenhum e-mail é enviado e nenhuma API externa é chamada: a qualificação e a coleta usam respostas simuladas, e o site e os fornecedores não são consultados. Uma empresa com "Média" no nome recebe da coleta mínima simulada um porte médio confirmado, para o teste alcançar todos os quadrantes.

## Segredos (Secret Manager)

Criar um por vez, no terminal; o valor nunca aparece no chat nem na tela.

```
# Generated and stored in one step, never displayed
openssl rand -hex 32 | firebase functions:secrets:set IP_HASH_SALT --data-file=- --project qualidade
# Typed at the masked prompt (API key created in SMTP2GO: Sending → API Keys, permission to send)
firebase functions:secrets:set SMTP2GO_API_KEY --project qualidade
# Typed at the masked prompt (bound to qualificar and the later pipeline functions)
firebase functions:secrets:set CLAUDE_API_KEY --project qualidade
# Enrichment keys (bound to coletar only; the function cannot be deployed before they exist)
firebase functions:secrets:set APOLLO_API_KEY --project gmdb-qualidade
firebase functions:secrets:set APIFY_TOKEN --project gmdb-qualidade
firebase functions:secrets:set HUNTER_API_KEY --project gmdb-qualidade
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
firebase deploy --project gmdb-qualidade --only functions:coletarMinima,functions:coletar
```

Rode os comandos `firebase` a partir da raiz do repositório: o apelido `qualidade` vem do `.firebaserc`; fora dela, use o ID `gmdb-qualidade`.

O deploy roda o build antes (`predeploy`). `--only functions:receberFicha,functions:expurgar` evita que o CLI apague funções que não estão neste código (a antiga `contato`, enquanto existir).

Produção: os mesmos passos com `producao` / `gmdb-producao`, só por pedido explícito de Gon. Depois, `FORMULARIO_EM_PRODUCAO = true` em `src/config.ts` do site.

## Método (`metodo/`)

Os cinco arquivos ficam em `metodo/` na raiz do repositório. Depois de qualquer commit que os altere:

```
cd functions
npm run publicar-metodo -- gmdb-qualidade
```

O script recusa alterações sem commit em `metodo/`; a versão é o hash curto do último commit que alterou a pasta. A função `publicarMetodo` é privada (sem invocação pública) e recebe a identidade de quem roda o script. As versões anteriores ficam no bucket, porque cada ficha registra a versão que usou.

Bucket (uma vez por projeto): privado, com acesso uniforme e bloqueio de acesso público; leitura só pela conta de serviço das funções:

```
gcloud storage buckets create gs://gmdb-qualidade-metodo --project gmdb-qualidade --location southamerica-east1 --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets add-iam-policy-binding gs://gmdb-qualidade-metodo --member serviceAccount:91928500287-compute@developer.gserviceaccount.com --role roles/storage.objectAdmin
```

(`objectAdmin` porque a própria função de publicação grava os arquivos; as demais funções só leem.)

