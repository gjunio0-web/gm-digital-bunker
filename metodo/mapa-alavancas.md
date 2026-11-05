---
titulo: Mapa de Alavancas de IA – framework da prática, sem o exemplo fictício
arquivo: metodo/mapa-alavancas.md
versao: 0.1 (do arquivo) · framework na versão 0.7, outubro de 2026, nome provisório, proposto e sujeito a validação em campo
data: 2026-10-31
fontes:
  - Dossiê institucional GM Digital Bunker™ (30/10/2026), parte 4 "Método aplicado – Mapa de Alavancas de IA", seções 01 a 10
  - Livro "Quando é Melhor com IA": seções citadas em cada conceito (5.1–5.3, 5.6, 5.7, 7.2, 8.1, 8.5, 8.9, 9.3, 4.6)
uso: carregado na síntese (hipóteses de alavanca, leitura do potencial e da maturidade) e, só a taxonomia de alavancas e os critérios de escolha, na etapa de coleta "setor"
---

# Mapa de Alavancas de IA

Um método para decidir onde investir em otimização, automação e aumentação com IA, a partir da estrutura da organização, da exigência que cada rotina impõe à ferramenta e de estimativas explícitas de investimento e retorno. Cada conceito indica a origem: **[livro]** com a seção, ou **[proposta]** quando é elemento novo do framework, ainda a validar. O exemplo fictício do dossiê (distribuidora de materiais elétricos, 36 rotinas) ficou fora deste arquivo; seus números são inventados e servem só para mostrar o funcionamento dos mapas.

Na análise preliminar, o Mapa não é aplicado por inteiro (exige levantamento com a empresa). Ele fornece: o vocabulário das alavancas, os critérios de escolha entre elas, a lógica de rotina e arquétipo, e o modo de falar de retorno em faixas com confiança declarada.

## 1. Cinco camadas, uma unidade de análise

A unidade de análise em todas as camadas é a **rotina**: atividade recorrente, com gatilho, entregável e responsável identificáveis [proposta]. Cargos, unidades, capacidades e arquétipos são agregações de rotinas; um único levantamento alimenta todas as vistas.

| Camada | Pergunta | Insumo |
|---|---|---|
| 1. Estrutura | Onde o trabalho acontece? | Cadeia de valor, mapa de capacidades, organograma sobreposto |
| 2. Perfil | Que exigência a rotina impõe à IA? | Arquétipos do livro, espectro Artesão–Operador, mix por cargo |
| 3. Alavanca | Que tipo de intervenção cabe? | Otimização, automação ou aumentação |
| 4. Estimativa | Quanto custa e quanto devolve? | Faixas de investimento e retorno, grau de confiança |
| 5. Decisão | Onde investir primeiro e com que proposta? | Mapas de calor em duas camadas, carteira por quadrantes, ficha de solução |

## 2. Camada 1 – Estrutura

- Cadeia de valor: atividades primárias (tocam produto e cliente) e de apoio. O livro trata a cadeia no nível setorial, identificando fornecedores, produtores, distribuidores, parceiros e clientes [livro, 7.2]; aqui ela é lida no nível de uma organização.
- Mapa de capacidades: o que a organização precisa saber fazer, independentemente de quem faz [livro, 7.2]. Essa independência permite sobrepor o organograma: qual unidade responde por cada capacidade e quais outras a executam.
- Capacidade executada por várias unidades é ponto de atenção: hipótese, a verificar rotina a rotina, de que cada passagem entre unidades envolva troca de arquivos e reformatação – terreno do glue work [livro, 5.2].

## 3. Camada 2 – Perfil

- Arquétipo profissional: identidade de uso que pondera os cinco domínios de competência e ocupa um ponto do espectro Artesão–Operador [livro, 8.1]. O valor da galeria não está em rotular pessoas, mas em dar vocabulário para a exigência que uma tarefa impõe à ferramenta [livro, 8.9].
- Regra do framework: o arquétipo é atribuído à rotina, nunca à pessoa, e à rotina como existe hoje, não à solução proposta. O cargo recebe uma composição de arquétipos pelas horas mensais dedicadas a cada rotina; o organograma exibe o arquétipo predominante e o mix completo [proposta]. Rotinas que nenhum dos sete descreve ficam como "sem arquétipo no livro" [livro, 8.1].
- Sete arquétipos, na ordem do espectro Artesão → Operador que o framework adota a partir do texto do Cap. 8 (o livro posiciona cada um em palavras, sem quantificar [livro, 8.9]; a expressão entre aspas é a do capítulo): Oráculo de Cenários, "no extremo mais puro do Artesão" [8.4]; Cirurgião de Código, "próximo ao extremo do Artesão" [8.2]; Prototipador Ágil, "pende discretamente para o Artesão" [8.7]; Showrunner Corporativo, "uma posição equilibrada" [8.3]; Analista de Legado, "inclina-se para o Operador" [8.8]; Caçador de Sinais, "inclina-se fortemente para o Operador" [8.6]; Burocrata de Elite, "o Operador em sua forma mais extrema" [8.5]. Oitava posição do framework: "Sem arquétipo no livro" [8.1]. Nota do dossiê sobre 8.8: a seção remete leitura massiva de documentos ao 6.4; o conteúdo corresponde ao 6.5, usado no framework.

## 4. Camada 3 – Alavancas

As três alavancas descrevem o tipo de intervenção, não a ferramenta, e valem com ou sem IA. Definições adotadas pela prática em 30/10/2026 (texto completo e regra de desempate em `glossario.md`):
- **Otimização** – a pessoa executa; a IA encurta e qualifica o fluxo. Ataca o glue work [livro, 5.2]. Neutra em relação ao espectro.
- **Automação** – a IA executa; a pessoa supervisiona. Exige integração ao fluxo: ferramenta de prateleira operada por uma pessoa não automatiza. Combina com rotinas próximas do polo Operador [livro, 5.7].
- **Aumentação** – a pessoa decide e monta; a IA amplia. Combina com rotinas próximas do polo Artesão [livro, 5.7].

### Critérios de escolha [proposta]

| Critério | Aponta para automação | Aponta para aumentação | Aponta para otimização |
|---|---|---|---|
| Volume e recorrência | Alto e estável | Baixo ou episódico | Alto, com muitas etapas |
| Variabilidade da entrada | Baixa, padronizável | Alta, cada caso é único | Média; a variação vem do processo, não do conteúdo |
| Custo do erro | Baixo ou detectável por regra | Alto ou difícil de detectar | Erro nasce na transcrição entre etapas |
| Verificabilidade exigida | Atendida por ancoragem em fontes e trilha de auditoria | Exige julgamento humano sobre a evidência | Atendida ao reduzir cópias manuais |
| Posição do arquétipo | Polo Operador | Polo Artesão | Indiferente |
| Transferências manuais | Poucas | Poucas | Muitas, entre sistemas ou unidades |

Dois casos evitam a aplicação mecânica: o Burocrata de Elite é o Operador na forma mais extrema [livro, 8.5]; com custo de erro alto (conformidade), a automação continua indicada, desde que a validação humana obrigatória entre no investimento. O Caçador de Sinais inclina-se ao Operador, mas é o arquétipo em que o Zero Alucinação pesa mais [livro, Cap. 8], o que puxa para validação e ancoragem.

Caminho de maturidade: aumentação → otimização → automação, à medida que o critério de qualidade fica explícito o bastante para ser verificado por máquina. A IA agrega mais onde o critério de qualidade já é explícito e o custo do erro é baixo ou reversível; nos elos de decisão (estratégia, descoberta, arquitetura) o ganho é real, mas de aumentação.

## 5. Camada 4 – Estimativa [proposta]

Sempre em faixas e com grau de confiança declarado. Referência: o retorno real não se mede pelo custo nominal da licença, mas pelo custo de oportunidade que a fricção introduz [livro, 5.6]; por isso o retorno é líquido, descontado o tempo em que a fricção remanesce.

### Componentes do investimento

| Componente | O que inclui | Eixo de habilitação [livro, 5.3] |
|---|---|---|
| Licenças e consumo | Assinaturas e uso por volume durante 12 meses | – |
| Integração | Conectores entre sistemas e orquestração do fluxo; zero por definição nas soluções de prateleira | Gravidade de Dados |
| Preparo e acesso a dados | Limpeza de dados, acesso a repositórios, base de conhecimento | Gravidade de Dados |
| Formato e modelos | Templates e saídas no formato nativo em que o entregável é consumido | Continuidade de Formato |
| Validação e governança | Revisão humana, trilha de auditoria, ancoragem em fontes | Confiabilidade & Verificabilidade |
| Capacitação e mudança | Treinamento, redesenho de papéis, comunicação | – |

### Retorno anual líquido

retorno anual líquido = horas liberadas × custo-hora × taxa de captura + redução de erro, retrabalho e custo operacional direto + efeito em receita comprovado − horas de validação e correção × custo-hora

- Taxa de captura: fração das horas liberadas que a organização de fato realoca para outro trabalho; sem ela, a soma das horas superestima o retorno.
- O último termo é o imposto da fricção [livro, 5.6] trazido para a conta.
- Efeito em receita só entra quando comprovado.

### Parâmetros do exemplo, a substituir pelos da organização (hipótese)
Custo-hora único; taxa de captura 70%; fração das horas liberada 60% (automação), 40% (otimização), 30% (aumentação); horas de validação 10% na automação, zero nas outras (já estão no trabalho da pessoa); largura das faixas ±15%, ±30%, ±50% para confiança alta, média e baixa.

### Confiança e agregação
- Alta: medição histórica da própria rotina. Média: amostra, piloto ou referência interna comparável. Baixa: julgamento de especialista, sem medição.
- Valor de uma célula do mapa: soma dos pontos médios das faixas das rotinas; confiança da célula: a mais baixa entre elas.
- Prazo de retorno pelo fluxo acumulado: no primeiro ano, investimento (com 12 meses de licença) e retorno; a partir do segundo, retorno menos renovação de licença.
- Dependência de fornecedor e opacidade [livro, 5.6] entram como alertas na ficha, não nos números.

## 6. Instrumento – ficha de levantamento de rotina [proposta]

Cada rotina é uma linha da planilha de levantamento; os campos alimentam as cinco camadas. O preenchimento rende mais em oficinas curtas por unidade, com quem executa a rotina; a atribuição de arquétipo e de alavanca fica com quem conduz o framework, para manter o critério entre unidades.

Códigos de entrada: dados estruturados de sistema; documento eletrônico estruturado; documento não estruturado; imagem ou foto; texto livre; fontes externas; documentos internos; código-fonte; planilha.
Códigos de entregável: dados ou previsão; relatório ou laudo; planilha ou base; registro em sistema; documento; apresentação; texto curto; plano operacional; análise estratégica; classificação; código ou aplicação; decisão registrada.

## 7. Camada 5 – Decisão

### Mapas de calor
Cruzam as capacidades, agrupadas pelos elos da cadeia, com as unidades do organograma ou com os arquétipos: camada de investimento (onde gastar), de retorno (onde colher) e vista de quadrante; filtro por alavanca.

### Carteira por quadrantes [proposta]
Dois critérios: tamanho do investimento e prazo de retorno. Os limites vêm da política da organização (alçada de aprovação; exigência de retorno da área financeira). Rotina exatamente sobre um limite conta como investimento grande ou retorno rápido. Rotina fronteiriça (faixa atravessa um limite) pede piloto antes de decidir.
- **Ganhos rápidos** – investimento abaixo do limite, retorno dentro do prazo: candidatos ao primeiro ciclo.
- **Apostas estruturantes** – investimento acima, retorno dentro do prazo: pedem caso de negócio próprio e piloto antes da escala.
- **Ajustes táticos** – investimento abaixo, retorno além do prazo: cabem em capacitação e uso individual, sem programa dedicado.
- **Reavaliar** – investimento acima, retorno além do prazo: revisar alavanca, escopo ou estimativa.

### Ficha de solução [proposta]
A carteira diz onde investir; a ficha diz o quê. O primeiro campo decide o resto: a natureza da solução.
- (a) ferramenta generativa de prateleira: cabe nos casos de uso do livro e na escolha de ferramenta pelo motor do AI Strat Hub, consultado com o perfil do arquétipo da rotina;
- (b) ferramenta generativa integrada ao fluxo: modelo consumido por API dentro de fluxo automatizado; a nota do Hub vale como indicação de capacidade do modelo;
- (c) IA não generativa ou sistema dedicado (previsão de demanda, roteirização, classificação em escala): fora do escopo do livro e do Hub; seleção de fornecedor ou projeto de dados;
- (d) automação sem IA: quando a entrada já é estruturada e uma regra resolve.

| Campo | O que define | Fonte |
|---|---|---|
| Natureza | (a), (b), (c) ou (d) | Levantamento da rotina |
| Descrição da solução | O que faz, com que dados, o que entrega | Desenho da solução |
| Arquitetura | Ponto de IA, integração, sistemas de origem e destino | Desenho da solução |
| Caso do livro | Caso dos Caps. 6 e 7 e metacasos envolvidos | Livro, Caps. 4, 6 e 7 |
| Eixo crítico | Gravidade de Dados, Continuidade de Formato ou Confiabilidade & Verificabilidade | Livro, 5.3 |
| Ferramenta | (a) motor do Hub com perfil do arquétipo; (b) modelo por API; (c) e (d) seleção de fornecedor ou projeto | AI Strat Hub |
| Fluxo e validação | Onde a IA entra e onde a pessoa revisa | Livro, 9.3 |
| Piloto e métrica | O que medir para confirmar o retorno e elevar a confiança | Camada 4 |

Regras de coerência: a rotina é nomeada pelo trabalho que existe hoje, nunca pela solução; cada ficha descreve uma única hipótese de solução vigente; natureza (a) não tem integração e nunca é automação; natureza (b) tem integração maior que zero; (c) e (d) não têm caso do livro. Metacasos derivam do caso, pelo Cap. 4.6 do livro: A com 6.4; B com 6.5; C com 6.6; D com 6.7; os quatro com 7.1. Indicação de ferramenta pelo motor do Hub recomendada sob a condição de que a atualização das notas esteja concluída.

Dependências e licenças: a proposta olha a carteira inteira – ordem de implantação quando uma rotina alimenta outra; licença compartilhada registrada na ficha para não superestimar o investimento.

## 8. Governança – riscos identificados e limites

- Precisão aparente: mapas coloridos comunicam mais certeza do que estimativas por rotina sustentam; rotinas de confiança baixa são hipóteses a medir em piloto, não compromissos de orçamento.
- Granularidade: se a rotina não tem um entregável que caiba em uma frase, provavelmente reúne várias.
- Organograma lido como avaliação de pessoas: o arquétipo descreve a exigência do trabalho, não a pessoa [livro, 8.9]; a comunicação deve deixar isso explícito.
- Riscos fora dos números: dependência de fornecedor e opacidade [livro, 5.6], sobretudo nas apostas estruturantes.
- Envelhecimento: ciclo trimestral; rotinas implantadas passam a retorno medido e recalibram as semelhantes.

## 9. Pendências do framework (dossiê, apêndice)
Validação em campo do framework e do nome provisório; decisões sobre dupla contagem de documentação e integração compartilhada, ganho único num modelo anual e capacidade em uma unidade executada por outra.

## 10. Como o agente usa este arquivo na análise preliminar
- Hipóteses de alavanca por área da empresa (seção 6 da análise): formuladas com os critérios da camada 3, sempre rotuladas como hipótese e sem número de retorno.
- Potencial e maturidade: ler os sinais públicos (planilhas, atendimento manual, sistemas desconectados) como indícios de glue work e transferências manuais, que apontam para otimização; critério de qualidade explícito e volume alto apontam para automação; decisão e análise apontam para aumentação.
- Linguagem de estimativa, quando houver qualquer número: faixa, método e confiança declarados; nunca ponto único.
- Nunca atribuir arquétipo a pessoas da empresa; só a rotinas, e só quando a rotina estiver descrita.
