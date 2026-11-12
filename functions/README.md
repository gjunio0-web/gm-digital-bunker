# Funções do Firebase – análise preliminar de fichas

Item 1 da spec 01: `receberFicha` (HTTPS, recebe o formulário) e `expurgar` (agendada, diária às 03:00 de São Paulo). Item 5: `publicarMetodo` (HTTPS privada; publica a pasta `metodo/` no bucket privado e grava `config/metodo`). Mudança de método de 6/11/2026 (spec 04): `coletarMinima` (gatilho na criação da ficha; `empresa_digital` sem Apify e `empresa_registro`, depois `qualificar` – chamada ao modelo de `config/pipeline.modelos.qualificar`, sempre – e `graduar`, a triagem em código, que grava `lead` e define o próximo estado) e `coletar` (gatilho quando a ficha passa a `coletando`; na primeira passagem, as quatro etapas restantes e o Instagram pelo Apify; numa reexecução, as etapas marcadas como pendentes). Fase B: `sintetizar` (gatilho quando a ficha passa a `coletada`; `enquadrar` → `graduar` no momento análise → `preparar_conversa` → `montar_analise`, com o modelo e o esforço de cada etapa em `config/pipeline.modelos` e `config/pipeline.esforco` (spec 02 v0.12), e grava `analise/vN` com o uso por chamada) e `verificar` (gatilho na criação de `analise/vN`; checagens em código sempre e revisor com `config/pipeline.modelos.revisor` só em versão da IA; estado final, confiança, prazo e segundo e-mail ao administrador, com o link `{URL base}/admin/leads/{fichaId}` da spec 05).

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
| `src/graduar.ts` | Triagem: grava `lead`, o evento `triada`, o próximo estado (com o teto diário `maxAnalisesPorDia`, contado em `controle/analises-{dia}`: além dele, a ficha fica em `qualificada` com o evento `teto_diario`, e o primeiro excesso do dia gera um e-mail), a guarda de 30 dias e as métricas por quadrante e grau; análise: `lead` no momento análise, evento `graduada`, guarda de 30 dias no grau D; ao fim de `verificar`, só a confiança e o prazo |
| `src/sintese.ts` | Síntese (spec 02, seção 3): instruções, esquemas e conferência das saídas de `enquadrar`, `preparar_conversa` e `montar_analise`, bloco de dados em cache, bloco `<fontes-disponiveis>` (spec 02 v0.12, 1.2), com a instrução comum repetida ao fim da mensagem das três chamadas (v0.16), seções `s0` e `s8`, marcas de fonte em link, simulações do emulador; desde a v0.17, rótulos fixos por seção (`ROTULOS`) na instrução de `montar_analise`, `porta.combinacao` conferida e `portaCombinacao` gravada (funções puras) |
| `src/sintetizar.ts` | Gatilho da síntese: trava por transação, três chamadas, `graduar` entre a primeira e a segunda, gravação de `analise/vN`; após cada chamada, o progresso em `sinteseEmCurso` e o custo na ficha; `enquadrar` repetido uma vez quando `porta.combinacao` foge da regra da spec 02 v0.17, 3.1 (uso da chamada recusada em `uso.enquadrar_recusada`) |
| `src/verificacao.ts` | Checagens em código da spec 02 v0.12, 4.1 (na v0.16: `sigla` aceita a forma por extenso na mesma frase; "CNPJ a confirmar." acrescentado pelo código à s2, sem pendência), sobre todo texto gerado (seções, resumo, rascunho, enquadramento e conversa), com pendências `{tipo, regra, secao, trecho, correcaoSugerida, local}`; regra `bloco_sem_rotulo` da spec 02 v0.15 (rótulo `**Rótulo.**` no primeiro parágrafo de s2 a s7; rótulo em negrito fora do formato em qualquer parágrafo), que vai ao reparo; na v0.17, `bloco_sem_rotulo` também na s1, regra `rotulo_fora_da_lista` (lista fixa por seção, na ordem) e "CNPJ a confirmar." dentro de **Cadastro.**; e prompt, esquema e conferência do revisor, com `regraNome` nos itens do checklist e nas pendências que deles derivam (v0.18 e v0.19; `null` nas pendências mecânicas e de leitura); na v0.20, exceções de `numero_sem_fonte` para "(n)" e "[inferência, …]", frase do revisor sobre não apontar trecho correto e arquivos do método do revisor e da correção (`METODO_REVISOR`, `METODO_CORRECAO`) (funções puras) |
| `src/reparo.ts` | Reparo da spec 02 v0.12, 3.4: itens por etapa, mensagem, aceite pelo código (escolhas iguais e mudança fora dos trechos até `limiarReparo`) e simulação do emulador (funções puras) |
| `src/sondarCache.ts`, `scripts/sondar-cache.mjs` | Sondagem de cache da Fase B2 (item 9.3): função privada com três chamadas (mesmo esquema duas vezes, depois outro) e o script que a chama e imprime só o uso; preparada, roda só por ordem de Gon |
| `src/correcao.ts` | Correção da spec 02 v0.12, 4.3: esquema (pedido no texto, sem esquema estrito: o esquema combinado passa do limite de gramática da API – Fase B2, decisão de Gon de 9/11/2026), mensagem, conferência dos tratamentos, versão `vN+1` e estado final; desde a spec 02 v0.16, sem `enquadramento` no esquema (vai à mensagem só como contexto, e `vN+1` o copia de `vN`) e com as pendências do enquadramento mantidas pelo código (funções puras) |
| `src/metodoRegras.ts` | O que as checagens leem do método publicado: termos vetados (glossário, Parte C), nomes dos graus (escopo-limites, seção 6) seção citada por `[M:arquivo:seção]` e checklist do revisor, com o `regraNome` de cada identificador (spec 02 v0.19, 4.2) e a lista de rótulos nos itens `secao-s1` a `secao-s7` (funções puras) |
| `src/verificar.ts` | Gatilho da verificação na criação de `analise/vN`: checagens; em versão da IA, revisor, confiança, estado final, prazo e segundo e-mail; em edição humana, só as checagens; custo de cada chamada na ficha logo após a chamada; aviso `custo_sem_preco` em `verificacao.avisos` |
| `src/reivindicacao.ts` | Reivindicação da versão por transação (`verificacaoIniciadaEm`): de duas execuções de `verificar` para a mesma versão, só uma segue |
| `src/vigiar.ts` | Agendada a cada 30 minutos: ficha parada em `coletando` ou `sintetizando` além de `prazoParadaMin` recebe `erro` (`interrupcao:<estado>`) e o evento `parada`, e o administrador recebe um e-mail; nenhuma reexecução automática |
| `src/coletarMinima.ts` | Coleta mínima para toda ficha, seguida de `qualificar` e `graduar` |
| `src/claude.ts` | Messages API da Claude por HTTP, com cache no último bloco do método (a API aceita até 4 pontos de cache por chamada) e no bloco de dados da síntese, e saída por esquema JSON (no emulador, classificação simulada) |
| `src/custo.ts` | Custo estimado por chamada, pela tabela de preços por modelo |
| `src/configurar.ts` | Grava campos de `config/pipeline` (só com autorização de Gon) |
| `src/metodoArquivos.ts` | Ordem fixa dos cinco arquivos do método, resumo (bytes, SHA-256), filtro por seção |
| `src/metodo.ts` | Leitura do método publicado pelas funções, com cache por versão na instância |
| `src/publicarMetodo.ts` | Publicação do método: grava os arquivos em `gs://<projeto>-metodo/metodo/<versao>/`, conta os tokens pela Claude API e grava `config/metodo` |
| `scripts/publicar-metodo.mjs` | Chama `publicarMetodo` com a identidade de quem roda (Cloud Shell) |
| `../storage.rules` | Acesso de cliente ao Storage fechado (vale no emulador e se o Firebase Storage for ativado) |
| `src/coletar.ts` | Coleta restante e reexecuções: trava por transação, orçamento de buscas, ordem das etapas, eventos, custo |
| `src/coleta/funcionarios.ts` | Normalização da estimativa de funcionários em faixa, mínimo e máximo (spec 02 v0.10) |
| `src/coleta/motor.ts` | Motor das etapas, comum às duas funções: contexto, tetos por fornecedor, chamada ao modelo, as seis etapas, `insumosCodigo`, gravação de `coleta/{etapa}`, Instagram pelo Apify |
| `src/coleta/rede.ts` | Leitura protegida de endereços vindos do formulário (sem rede interna, até 2 MB, 10 s): endereços classificados pelo `ipaddr.js` (IPv4 em qualquer notação, IPv6 com IPv4 embutido, só `unicast` aceito), conexão presa ao endereço verificado (undici, sem segunda resolução) e verificação a cada redirecionamento; chamadas aos fornecedores |
| `src/coleta/site.ts` | Até seis páginas do site, links, Instagram, tecnologias, CNPJs (privacidade e termos só para o CNPJ) |
| `src/coleta/cnpj.ts` | Padrão e dígitos verificadores do CNPJ; BrasilAPI só pelo número; sócios só com nome e qualificação |
| `src/coleta/fornecedores.ts` | Apollo (empresa pelo domínio), Apify (Instagram da empresa), Hunter (só os campos da tabela 5.1 da spec 03) |
| `src/coleta/claudeColeta.ts` | Chamadas da coleta: busca e leitura de páginas como ferramentas do servidor, JSON validado no código, uma correção |
| `src/coleta/envelope.ts` | Envelope da spec 02 §2: fontes verificadas, índices, regra de preenchimento |
| `src/coleta/etapas.ts`, `textosSpec.ts` | Tetos de busca, arquivos do método, instruções e esquemas de cada etapa (textos da spec 02) |
| `scripts/fichas-teste.mjs` | Fichas de teste gravadas direto no Firestore (sem e-mails), que seguem o pipeline sozinhas; reexecução de etapas (`--reexecutar`, `--etapas=`, `--ficha=`, `--uma-por-vez`) ou só da síntese (`--sintese`); relatório com a triagem, a análise, as etapas, as pendências e o custo |
| `scripts/comparar-analises.mjs`, `scripts/relatorio-b2.mjs`, `scripts/b2-rodadas.mjs` | Página de comparação lado a lado das versões das fichas de teste e relatório em Markdown da Fase B2 (medidas da seção 7, itens 5 e 6, do documento de alterações), com cada versão marcada pela rodada e pelo desenho e, no relatório, as chamadas de reparo rejeitadas pelo `limiarReparo` (eventos `reparo`); somente leitura, saídas só para o administrador, fora do Git |
| `src/seed.ts` | Grava `config/pipeline` e `config/metodo`; rodado de novo, só acrescenta campos ausentes, sem sobrescrever; cria `config/precos` só se ausente |
| `src/migrarPipeline.ts`, `src/migracao.ts` | Migração única de `config/pipeline` para modelos e esforço por etapa (spec 01 v0.11); sem `--aplicar`, só mostra o plano |
| `src/modelos.ts`, `src/uso.ts`, `src/precos.ts`, `src/precosIniciais.ts` | Modelo e esforço por etapa; uso por chamada; leitura de `config/precos`; tabela inicial (só semente) |
| `scripts/textos.mjs` | Copia os textos dos e-mails de `src/i18n/ui.ts` do site para `src/textos.generated.ts` (roda no build) |
| `../firestore.rules`, `../firestore.indexes.json` | Regras (spec 01, seção 5) e índices |

## Testes

```
cd functions
npm ci
npm test            # build + testes de validação, textos, pipeline, qualificação, método, coleta, graduação, síntese, portões, correção, rede e endurecimento
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

No emulador nenhum e-mail é enviado e nenhuma API externa é chamada: a qualificação, a coleta, a síntese e o revisor usam respostas simuladas ("pendência" na mensagem leva a análise simulada a uma pendência mecânica), e o site e os fornecedores não são consultados. Uma empresa com "Média" no nome recebe da coleta mínima simulada um porte médio confirmado, para o teste alcançar todos os quadrantes.

## Segredos (Secret Manager)

Criar um por vez, no terminal; o valor nunca aparece no chat nem na tela.

```
# Generated and stored in one step, never displayed
openssl rand -hex 32 | firebase functions:secrets:set IP_HASH_SALT --data-file=- --project qualidade
# Typed at the masked prompt (API key created in SMTP2GO: Sending → API Keys, permission to send)
firebase functions:secrets:set SMTP2GO_API_KEY --project qualidade
# Typed at the masked prompt (bound to coletarMinima, coletar, sintetizar and verificar; SMTP2GO_API_KEY also to verificar)
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
npm run configurar -- gmdb-qualidade modelos.coleta=claude-haiku-5-5 esforco.revisor=baixo   # only with Gon's authorization
npm run migrar-pipeline -- gmdb-qualidade [--aplicar]   # one-off, spec 01 v0.11; plan only without --aplicar
npm run fichas-teste -- gmdb-qualidade --sintese --desenho=C --ficha=<id>   # phase B2: design for this run only
npm run sondar-cache -- gmdb-qualidade <fichaId>   # phase B2 cache probe, only by Gon's order
cd ..
firebase deploy --project qualidade --only functions:receberFicha,functions:expurgar,firestore:rules,firestore:indexes
firebase deploy --project gmdb-qualidade --only functions:coletarMinima,functions:coletar
npm --prefix functions run configurar -- gmdb-qualidade modeloSintese=claude-sonnet-5-5 modeloRevisor=claude-sonnet-5-5   # authorized by Gon, 7/11/2026
# esforcoSintese (output_config.effort of the synthesis calls) stays empty – the model default – except in authorized measurements
firebase deploy --project gmdb-qualidade --only functions:sintetizar,functions:verificar
firebase deploy --project gmdb-qualidade --only functions:vigiar   # phase 6
```

Rode os comandos `firebase` a partir da raiz do repositório: o apelido `qualidade` vem do `.firebaserc`; fora dela, use o ID `gmdb-qualidade`.

O deploy roda o build antes (`predeploy`). `--only functions:receberFicha,functions:expurgar` evita que o CLI apague funções que não estão neste código (a antiga `contato`, enquanto existir).

Produção: só por pedido explícito de Gon, na ordem da lista abaixo.

## Lista de entrada em produção (`gmdb-producao`)

Na ordem; cada passo só depois do anterior. Comandos a partir da raiz do repositório.

1. **Segredos**, um por vez, no campo mascarado (o valor nunca aparece no chat nem na tela; conferir só com `gcloud secrets versions list <NOME> --project gmdb-producao`):
   `SMTP2GO_API_KEY`, `IP_HASH_SALT` (`openssl rand -hex 32 | firebase functions:secrets:set IP_HASH_SALT --data-file=- --project producao`), `CLAUDE_API_KEY`, `APOLLO_API_KEY`, `APIFY_TOKEN`, `HUNTER_API_KEY`.
2. **Configuração:** `npm --prefix functions run seed -- gmdb-producao` (grava `config/pipeline`, `config/metodo` e `config/precos`); em seguida, com autorização de Gon, `configurar` com `autoAnalisar=false` e os modelos de cada etapa (IDs conferidos na documentação atual da Claude API; `configurar` recusa modelo ausente de `config/precos`). `autoAnalisar` só passa a `true` depois do passo 13.
3. **Bucket do método** `gs://gmdb-producao-metodo` (comandos da seção Método, com a conta de serviço de produção e o papel `roles/storage.objectAdmin`), deploy de `publicarMetodo` e `npm --prefix functions run publicar-metodo -- gmdb-producao`.
4. **Storage:** `firebase deploy --project producao --only storage` (`storage.rules`, acesso de cliente fechado).
5. **Firestore:** `firebase deploy --project producao --only firestore:rules,firestore:indexes`.
6. **Política de expiração das imagens das funções** (Artifact Registry): `firebase functions:artifacts:setpolicy --project producao` (o padrão apaga imagens com mais de 3 dias; `--days` muda o prazo). O deploy de funções também a oferece, quando ausente.
7. **Deploy de todas as funções:** `firebase deploy --project producao --only functions:receberFicha,functions:expurgar,functions:publicarMetodo,functions:coletarMinima,functions:coletar,functions:sintetizar,functions:verificar,functions:vigiar` (sem `sondarCache`, que é só da Fase B2 em qualidade).
8. **Dependência do hub (spec 05):** o link do e-mail ao administrador (`{URL base}/admin/leads/{fichaId}`) só funciona com o módulo de administração publicado. A entrada em produção espera esse módulo; não há link provisório para o console do Firebase (decisão de Gon, 8/11/2026).
9. **Limites de gasto** configurados (lista abaixo).
10. **Promoção de `quality-env` para `main` com `FORMULARIO_EM_PRODUCAO = true`** em `src/config.ts` do site, na mesma alteração: em `quality-env` o valor é `false`, e uma promoção sem a troca desliga o formulário em produção até o deploy seguinte.
11. **Conferência do formulário novo em produção:** um envio pelo site grava a ficha em `gmdb-producao` e os dois e-mails chegam. Até aqui, a antiga `contato` continua publicada, e o site anterior a usa.
12. **Remoção da antiga `contato`:** `firebase functions:delete contato --project producao`, só depois do passo 11 (ação de Gon). Antes disso, apagá-la derruba o formulário que está no ar.
13. Teste com uma ficha real gravada por script e, então, `autoAnalisar=true`.

Notas: o build do site depende do AI Strategy Hub; se o build falhar, a Netlify mantém publicada a versão anterior.

## Desligamento rápido

Pelo `configurar`, sem deploy (cada campo só com autorização de Gon, salvo emergência):

| Campo | Efeito |
|---|---|
| `autoAnalisar=false` | A ficha mandada à análise pela triagem fica em `qualificada`; a recepção, a coleta mínima e a qualificação seguem |
| `fontes.apollo.ativo=false` (e `apify`, `hunter`, `brasilapi`) | A etapa deixa de chamar o fornecedor |
| `maxAnalisesPorDia=<n>` (`0` corta todas; `null` tira o teto) | Teto diário de fichas que passam à análise |

Corte total da recepção: `FORMULARIO_EM_PRODUCAO = false` no site, com novo build.

## Limites de gasto a configurar (Gon)

- Anthropic: limite mensal de gasto da organização no Console da Claude.
- Apollo, Apify e Hunter: limite de uso ou de créditos de cada plano, no painel de cada fornecedor (no Apify, o limite mensal de uso).
- Google Cloud: orçamento com alertas por e-mail no faturamento do projeto (o orçamento avisa, não corta o gasto).

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

