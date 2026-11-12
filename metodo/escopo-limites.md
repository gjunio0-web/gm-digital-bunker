---
titulo: Escopo de atuação e limites da GM Digital Bunker™ – critério de aderência para a análise preliminar
arquivo: metodo/escopo-limites.md
versao: 0.1
data: 2026-10-31
fontes:
  - Dossiê institucional GM Digital Bunker™ (30/10/2026), parte 5 "Escopo de atuação" (estudo "Cadeia do Produto Digital e IA"), seções 07 Modelo operacional, 08 Escala de aderência, 11 Síntese e 13 Escopo para clientes
  - Decisões de escopo de 23/10 e 26/10/2026 registradas no projeto AI Strat Hub
uso: carregado na síntese (teste de aderência e enquadramento) e, em versão reduzida (seções 1, 4, 5 e 7), no revisor da etapa de verificação
---

# Escopo de atuação e limites

Este arquivo diz o que a GM Digital Bunker™ faz, o que orienta sem executar e o que não faz. A análise preliminar usa-o para três decisões: se a empresa é cliente aderente; se o pedido declarado cabe no escopo; e qual porta de contratação é plausível. O texto para clientes (seção 13 do dossiê) é a fonte principal; o que vem de outras seções está indicado.

## 1. Cliente aderente

- Empresas de pequeno e médio porte. Referência de porte usada no dossiê: receita anual de R$ 4,8 milhões a R$ 300 milhões (faixa BNDES) ou pequena empresa em crescimento.
- Sem diretor dedicado exclusivamente a tecnologia (sem CIO ou CTO); TI enxuta, terceirizada ou operacional.
- Quem decide é o CEO, um sócio ou um diretor de área.
- Fora desse porte, a aderência cai: o estudo registra que um cliente de grande porte moveria vários cenários de "parcial" para "alta" na assessoria, mas pressupõe contexto que a prática não atende na execução (legado corporativo, equipe de engenharia própria, SaaS de grande porte).

## 2. Dois tipos de trabalho

**Quando a IA é o assunto.** Apoiar a escolha, a contratação, a governança e a avaliação das ferramentas e dos fornecedores de IA do mercado que a empresa usa ou pretende usar; e capacitar a equipe no método do livro "Quando é Melhor com IA", que ensina a decidir quando a IA ajuda e a conferir o que ela produz.

**Quando a IA está no produto.** Plataformas digitais que a própria GM Digital Bunker constrói para a empresa, sob medida, com IA no processo de construção e no funcionamento.

**Regra central.** A execução técnica (construir, configurar e manter) acontece só nas plataformas que a prática constrói. Nas ferramentas de mercado, o papel é de decisão: apoiar a seleção, avaliar e acompanhar. Na equipe do cliente, é capacitar no método.

## 3. O que a prática faz, por porta de contratação

Legenda das portas: **Projeto** = Estratégia e plataforma digital com IA; **Conselho** = Conselho de IA por assinatura; **Workshop** = workshop "Quando é Melhor com IA".

### Estratégia e decisão em IA
- Diagnóstico e plano diretor: onde a IA gera valor no negócio, o que construir e em que ordem, com análise de mercado e da concorrência feita com IA. Projeto · Conselho
- Arquitetura de negócio: capacidades, processos e cadeia de valor da empresa, e onde a IA entra em cada ponto. Projeto · Conselho
- Comprar ou construir: se a empresa deve contratar uma solução de IA pronta ou encomendar uma plataforma própria. Projeto · Conselho
- Caso de negócio da iniciativa de IA, para sócios ou conselho decidirem. Projeto · Conselho
- Segunda opinião independente sobre propostas de IA recebidas pela empresa. Conselho

### Ferramentas de IA do mercado
- Apoio à seleção de ferramentas com IA embutida (CRM, gestão, atendimento): cruza a necessidade com planos, recursos de IA e limites de cada opção, sem comissão de fornecedor; a escolha é da empresa. Conselho
- Avaliação da IA embutida nas ferramentas que a empresa já contrata. Conselho
- Revisão trimestral das ferramentas de IA pagas: manter, cortar, assentos ociosos. Conselho

### Capacitação da equipe
- Método "Quando é Melhor com IA": decidir quando a IA ajuda, conduzir e revisar o trabalho feito com ela e proteger os dados da empresa. Capacitação agnóstica, vale para qualquer ferramenta. O treinamento técnico em cada ferramenta cabe ao fornecedor. Workshop

### Plataforma digital com IA construída pela GM Digital Bunker (Projeto)
- Concepção: protótipos para validar a ideia antes de investir; requisitos (histórias de usuário, critérios de aceite, desempenho e segurança) derivados do plano diretor.
- Construção: por módulos, código produzido com emprego de IA, revisado e testado; integrações por API com os serviços de que a plataforma depende; assistente de IA para os usuários, que responde com base na documentação e encaminha ao atendimento humano o que não souber; segurança e privacidade (varredura automatizada do código, correção dos achados, minimização e anonimização de dados pessoais). Testes de invasão e certificações formais ficam com terceiros especializados.
- Implantação: migração de planilhas e dados para a plataforma, com scripts gerados com IA e conferidos por amostra; guias, vídeos curtos, perguntas frequentes e treinamento da equipe no uso da plataforma.
- Operação e evolução: medição do uso; manutenção mensal opcional (hospedagem, correções e pequenas evoluções, definidas por escrito no contrato).
- Assistente de IA e migração de dados entram conforme as características do negócio.

### Governança da IA (Conselho)
- Política de uso de IA para a empresa.
- Mapa de riscos de cada uso de IA.
- Acompanhamento dos fornecedores de IA: níveis de serviço, renovações, dependência.
- Avaliação dos usos de IA à luz da LGPD (Lei Geral de Proteção de Dados), antes da adoção de ferramenta ou uso novo, do ponto de vista do negócio, em três perguntas: que dados pessoais o uso envolve e para quê; se precisa de todos eles; se o fornecedor retém as interações ou as usa para treinar modelos. Resultado: classificação do uso por nível de exposição. Pontos que exigirem parecer jurídico vão separados, para o advogado ou o encarregado de dados. Ferramentas já adquiridas não são reavaliadas.

## 4. O que a prática orienta, e um especialista executa

A orientação acontece no diagnóstico do Projeto ou, de forma contínua, no Conselho.
- Contratos com fornecedores de IA: aponta cláusulas de dados, saída e propriedade intelectual; o parecer é de advogado.
- Grandes plataformas corporativas com IA embarcada (SAP, Salesforce e similares): ajuda a decidir se vale contratar e a escolher o integrador; a implantação é dele.
- Modernização de sistemas legados com agentes de IA: orienta entre substituir e modernizar; faz a triagem de fornecedores.
- Modelos preditivos de aprendizado de máquina sobre grandes bases de dados: define o que medir e como ler os resultados; a modelagem exige dados e estrutura de outro porte.
- Detecção de incidentes por IA para operações críticas: triagem de fornecedores; a operação é deles.
- Processos formais de compra de soluções de IA: avalia as propostas recebidas; a condução do processo fica com a empresa. A prática não elabora RFPs nem RFIs (decisão de 23/10/2026).

## 5. O que a prática não faz – os seis limites de escopo (26/10/2026)

1. Operação contínua 24 horas ou monitoramento de grandes ambientes de TI.
2. Revenda de ferramentas ou serviços de fornecedores – é o que torna a recomendação independente.
3. Tecnologia sem relação com IA, mesmo com capacidade técnica para executá-la.
4. Execução técnica em software de terceiros: implantar, configurar ou manter plataformas de mercado ou desenvolvidas por terceiros.
5. Treinamento técnico em ferramentas de terceiros, que cabe ao fornecedor.
6. Gestão de grandes equipes de engenharia, como métricas de produtividade de times de desenvolvimento.

Premissa, não limite: "Promessas sem lastro" – ganhos são medidos ou declarados como estimativa. Era listada como limite até 26/10/2026.

Em análise, fora das contagens do estudo: configuração assistida de SaaS contratado e migração de planilhas para SaaS contratado – execução técnica em software de mercado assinado pelo cliente; a incorporação depende de mais análise.

Não induzir clientes a desenvolver assistente de conhecimento interno próprio (para consulta da equipe da empresa) nem mencioná-lo na oferta; se o pedido surgir, é avaliado caso a caso. Essa regra não se aplica ao assistente de IA para os usuários da plataforma, previsto no Projeto (seção 3).

## 6. Escala de aderência (dossiê, seção 08) – para graduar o enquadramento

Duas medidas, com os mesmos cinco graus. Execução: quanto do cenário a prática faz com a estrutura que tem. Assessoria: quanto ela decide, orienta ou avalia para o cliente, mesmo quando outro executa. Dois critérios antecedem o grau: o trabalho envolve IA (como assunto ou no produto) e a execução técnica só acontece nas plataformas que a prática constrói.

| Grau | Execução | Assessoria |
|---|---|---|
| A4 · núcleo | Executável por inteiro pela estrutura atual (sênior + IA), dentro dos serviços | Orienta a decisão por inteiro, com o método publicado ou a experiência declarada |
| A3 · alta | Executável com ressalva de alcance: uma parte do cenário fica fora da estrutura atual | Orienta a maior parte; uma parte delimitada (técnica, jurídica ou de porte) fica com especialista |
| A2 · parcial | Executa só parte: a versão simplificada que cabe numa PME, ou a etapa decisória sem a execução em escala | Orienta só a decisão de alto nível (contratar ou não, que tipo de fornecedor) e faz a triagem |
| A1 · marginal | Apenas tangencia a execução; quem executa é outro profissional ou fornecedor | Só sinaliza riscos ou que o cenário não se aplica, e encaminha |
| A0 · fora | Contraria um limite declarado ou pressupõe contexto que o público-alvo não tem | Nem a orientação cabe: exige especialidade alheia à prática |

"Dentro do escopo" refere-se à execução e vai de A2 a A4. Nenhum cenário do estudo ficou fora por falta de competência: todos os "fora" caem por um dos seis limites, por RFP/RFI ou por contexto corporativo. A assessoria alcança o que a execução não alcança (média 3,5 contra 3,0): onde a prática decide e outros executam, cabe indicar rede de parceiros executores.

Leituras do estudo úteis ao enquadramento: aumentação é a lente mais aderente (quinze de dezoito cenários no núcleo); a lacuna estrutural é o aprendizado de máquina treinado no histórico do cliente (nenhum acima de A2 na execução); agentes aderem quando operam sobre o que a prática construiu; segurança, risco e conformidade estão no núcleo.

## 7. Como o agente aplica este arquivo

1. Aderência do cliente (seção 1): sim, parcial ou não, com a evidência (porte, estrutura de tecnologia, cargo do signatário).
2. Para cada pedido ou dor declarada e para cada hipótese de alavanca: classificar como "faz" (seção 3), "orienta e indica quem executa" (seção 4) ou "não faz" (seção 5), citando o item. Quando houver dúvida, graduar pela escala da seção 6, separando execução de assessoria.
3. Nunca reformular um pedido fora do escopo para fazê-lo caber; registrar que está fora e o que a prática pode oferecer em vez disso (orientação, triagem, segunda opinião).
4. Frases para o cliente seguem o texto da seção 13 do dossiê; o "Em uma frase": a GM Digital Bunker ajuda empresas de pequeno e médio porte a decidir e executar em tecnologia aplicada a IA. Apoia a escolha e governa com elas as ferramentas de IA do mercado, capacita as equipes no método, constrói para elas plataformas digitais com IA, sob medida, e, se a empresa optar, mantém o que construiu. Onde a decisão exige um especialista ou uma operação de grande porte, orienta e indica quem faz.
