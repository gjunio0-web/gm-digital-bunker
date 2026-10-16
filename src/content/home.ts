// Home page content per language. Strings with inline markup are marked `html` and rendered with set:html.
import type { Lang } from '../i18n/routes';

export interface HomeContent {
  title: string; description: string; jsonLdDescription: string;
  hero: { meta: string; whoHtml: string; titleHtml: string; lead: string; services: string; method: string; pause: string; resume: string };
  s1: {
    eyebrow: string; title: string; lead: string; carouselLabel: string; prev: string; next: string; of: string;
    stats: { figure: string; text: string; source: string }[]; footnote: string;
    altTitle: string; alts: { title: string; tag: string; text: string }[];
    mapTitle: string; mapNote: string; axisY: string; yTop: string; yBottom: string; axisX: string; xLeft: string; xRight: string;
    cells: { title: string; text: string; us?: boolean }[];
    statement: [string, string];
  };
  s2: { eyebrow: string; title: string; steps: { title: string; text: string }[]; lead: string; statement: [string, string] };
  s3: { eyebrow: string; title: string; label: string; more: string; services: { id: 'estrategia' | 'conselho'; title: string; text: string }[] };
  s4: {
    eyebrow: string; title: string; caseLabel: string; caseTitle: string; caseText: string; caseMore: string; caseAlt: string;
    bookLabel: string; bookTitleHtml: string; bookText: string; bookMore: string; bookAlt: string;
    hubLabel: string; hubTitle: string; hubText: string; hubMore: string; hubAlt: string; external: string;
    bridgeHtml: string; evidenceTitle: string; evidence: { figure: string; text: string }[]; evidenceLead: string; evidenceSource: string; statement: [string, string];
  };
  s5: { eyebrow: string; title: string; criteria: { term: string; text: string }[]; note: string; notTitle: string; nots: { title: string; text: string }[] };
  rail: { label: string; items: string[] };
}

export const home: Record<Lang, HomeContent> = {
  'pt-BR': {
    title: 'GM Digital Bunker™',
    description: 'Estratégia de tecnologia em IA para o mundo real. Decisão sênior, executada com IA, até o artefato pronto, para empresas de pequeno e médio porte.',
    jsonLdDescription: 'Prática independente de estratégia tecnológica voltada à aplicação avançada de inteligência artificial, da análise estratégica à produção de artefatos técnicos e de comunicação.',
    hero: {
      meta: 'Estratégia · Tecnologia · IA · 2026',
      whoHtml: '<a href="/sobre">Gonçalo Marques</a> · São Paulo',
      titleHtml: 'Estratégia de tecnologia em IA para o <span>mundo real</span>.',
      lead: 'Para empresas de pequeno e médio porte que precisam decidir e executar em tecnologia para IA, da análise estratégica ao artefato pronto.',
      services: 'Ver serviços', method: 'Conhecer o método', pause: 'Pausar animação', resume: 'Retomar animação',
    },
    s1: {
      eyebrow: '01 · A oportunidade',
      title: 'A IA já chegou à operação. O critério para usá-la ainda é frágil.',
      lead: 'Por que a empresa média usa IA sem uma regra para decidir onde ela compensa, e sem uma opção de apoio adequada. Os dados abaixo mostram o mesmo quadro nos dois extremos do porte.',
      carouselLabel: 'Três números sobre a oportunidade', prev: 'Número anterior', next: 'Próximo número', of: 'de',
      stats: [
        { figure: '65%', text: 'das empresas de pequeno porte já usam IA, na maioria ferramentas de texto como ChatGPT, Gemini e Copilot', source: 'Sebrae, 2025' },
        { figure: '74,3%', text: 'citam o custo alto como principal barreira às tecnologias digitais avançadas', source: 'IBGE, Pintec Semestral 2024*' },
        { figure: '60,6%', text: 'citam a falta de pessoal qualificado, a barreira que mais cresceu desde 2022', source: 'IBGE, Pintec Semestral 2024*' },
      ],
      footnote: '* Indústrias com 100 ou mais funcionários que não adotam tecnologias digitais avançadas.',
      altTitle: 'O que a empresa média tem hoje, e por que não basta',
      alts: [
        { title: 'Grandes consultorias', tag: 'Formato de grande conta', text: 'Equipe em pirâmide, programa de meses e honorário dimensionado para grandes corporações. O menor projeto que essas casas aceitam já é maior do que a empresa média precisa, ou pode pagar.' },
        { title: 'Fornecedores de ferramenta de IA', tag: 'Vendem a ferramenta, não a decisão', text: 'Entregam a ferramenta; raramente a decisão sobre usar ou não usar IA, onde e como. A recomendação tende a partir do que o fornecedor tem para vender, e não do problema do negócio.' },
        { title: 'Cada um com a sua ferramenta', tag: 'Esforço sem direção', text: 'Funcionários adotam IA por conta própria, sem orientação da empresa. O risco é gastar sem retorno ou expor dados sem perceber.' },
      ],
      mapTitle: 'O espaço vazio: decisão sênior para empresas médias', mapNote: 'Mapa qualitativo, não medido: mostra zonas.',
      axisY: 'Escopo ↑', yTop: 'Estratégia e decisão', yBottom: 'Implantação e operação', axisX: 'Porte do cliente →', xLeft: 'Pequena e média empresa', xRight: 'Grande corporação e governo',
      cells: [
        { title: 'GM Digital Bunker™', text: 'Estratégia sênior até o artefato pronto, sem pirâmide de equipe', us: true },
        { title: 'Consultorias de estratégia pura', text: 'Decisão e plano, sem construção' },
        { title: 'Fornecedores de ferramenta e de execução', text: 'Fornecedores de ferramenta de IA, agências e desenvolvedores' },
        { title: 'Integradoras e grandes consultorias', text: 'Programas plurianuais para grandes corporações e governo' },
      ],
      statement: ['Critério antes da ferramenta.', 'Decisão sênior, executada com IA, até o artefato pronto.'],
    },
    s2: {
      eyebrow: '02 · A proposta', title: 'Do diagnóstico ao artefato pronto',
      steps: [
        { title: 'Diagnóstico', text: 'Entender o negócio, a operação e onde a IA de fato ajuda – e onde atrapalha.' },
        { title: 'Decisão', text: 'Critério claro para escolher prioridades e ferramentas, sem vínculo com fornecedor.' },
        { title: 'Artefato', text: 'Documento técnico, protótipo, aplicação ou material para a equipe, pronto para uso.' },
      ],
      lead: 'A entrega termina em algo utilizável, no formato em que será usado.',
      statement: ['Sem pirâmide. Com entrega.', 'Quem diagnostica é quem entrega: um sênior que decide, com a IA na produção.'],
    },
    s3: {
      eyebrow: '03 · Serviços', title: 'O que a empresa pode contratar', label: 'Serviço', more: 'Ver o serviço',
      services: [
        { id: 'estrategia', title: 'Estratégia e plataforma digital com IA', text: 'Projeto sob medida, do diagnóstico à plataforma em produção; Elite 90 Pro como caso.' },
        { id: 'conselho', title: 'Conselho de IA por assinatura', text: 'Executivo de IA em tempo parcial: revisão trimestral, triagem de fornecedores e teto de horas.' },
      ],
    },
    s4: {
      eyebrow: '04 · As provas', title: 'Um caso real, o método publicado e a evidência externa',
      caseLabel: 'Caso', caseTitle: 'Elite 90 Pro', caseText: 'Programa de 90 dias de transformação física para executivos, conduzido pelo Coach Ruiz. A GM Digital Bunker desenhou o ecossistema digital do programa e conduz sua construção por módulos.', caseMore: 'Ler o caso', caseAlt: 'Página inicial do site do programa Coach Ruiz: Construa um corpo de atleta em 90 dias',
      bookLabel: 'O livro', bookTitleHtml: 'Quando é Melhor com&nbsp;IA', bookText: 'Como aplicar IA com rigor e método na produção técnica, na análise complexa e no apoio à decisão estratégica.', bookMore: 'Conhecer o livro', bookAlt: 'Capa do livro Quando é Melhor com IA, de Gonçalo Marques',
      hubLabel: 'Aplicativo gratuito', hubTitle: 'AI Strategy Hub', hubText: 'Painel na web que indica a IA mais adequada a cada perfil de trabalho.', hubMore: 'Abrir o AI Strategy Hub', hubAlt: 'Tela do AI Strategy Hub: perfil profissional "Cirurgião de Código" selecionado e classificação recomendada com o gráfico de capacidades', external: 'site externo',
      bridgeHtml: 'Os textos sobre o método estão em <a href="/publicacoes">Publicações <span aria-hidden="true">→</span></a>',
      evidenceTitle: 'A IA amplia o trabalho de consultoria, quando se sabe onde usá-la',
      evidence: [
        { figure: '+12,2%', text: 'de tarefas concluídas' }, { figure: '+25,1%', text: 'de rapidez na execução' },
        { figure: '+40%', text: 'de qualidade avaliada' }, { figure: '−19', text: 'pontos percentuais de acerto em tarefa fora do alcance da IA' },
      ],
      evidenceLead: 'O ganho depende de saber quando a IA ajuda e quando atrapalha. É a pergunta que dá nome ao método: quando é melhor com IA.',
      evidenceSource: "Estudo de campo da Harvard Business School com a BCG, 758 consultores (Dell'Acqua et al., SSRN, 2023)",
      statement: ['Quando é melhor com IA?', 'Responder a essa pergunta, caso a caso, é o trabalho.'],
    },
    s5: {
      eyebrow: '05 · O encaixe e o próximo passo', title: 'Uma prática desenhada para empresas sem executivo exclusivamente dedicado a tecnologia',
      criteria: [
        { term: 'Porte', text: 'Média empresa (receita anual de R$ 4,8 mi a R$ 300 mi) e pequena empresa em crescimento' },
        { term: 'Tecnologia', text: 'Sem diretor dedicado a tecnologia (CIO ou CTO); TI enxuta, terceirizada ou operacional' },
        { term: 'Decisor', text: 'CEO, sócio ou diretor de área, que compra resultado de negócio' },
        { term: 'Momento', text: 'IA ainda não adotada ou já usada por conta própria pela equipe, sem uma regra comum para decidir onde e quando investir' },
        { term: 'Expectativa', text: 'Decisão fundamentada e algo utilizável no fim do projeto' },
      ],
      note: 'Faixa de porte pela classificação do BNDES.',
      notTitle: 'O que a GM Digital Bunker não faz',
      nots: [
        { title: 'Operação em larga escala', text: 'Implantações com dezenas de pessoas ou operação 24 horas pedem outro tipo de fornecedor.' },
        { title: 'Revenda de ferramentas', text: 'Sem vínculo comercial com fornecedores: a recomendação parte do problema do negócio.' },
        { title: 'Promessas sem fonte', text: 'Ganhos são medidos ou declarados como estimativa, nunca apresentados como garantia.' },
      ],
    },
    rail: { label: 'Seções desta página', items: ['A oportunidade', 'A proposta', 'Serviços', 'As provas', 'O encaixe'] },
  },

  en: {
    title: 'GM Digital Bunker™',
    description: 'AI technology strategy for the real world. Senior decisions, executed with AI, through to the finished artifact, for small and mid-sized companies.',
    jsonLdDescription: 'Independent technology strategy practice focused on the advanced application of artificial intelligence, from strategic analysis to the production of technical and communication artifacts.',
    hero: {
      meta: 'Strategy · Technology · AI · 2026',
      whoHtml: '<a href="/en/about">Gonçalo Marques</a> · São Paulo',
      titleHtml: 'AI technology strategy for the <span>real world</span>.',
      lead: 'For small and mid-sized companies that need to decide and execute on AI technology, from strategic analysis to the finished artifact.',
      services: 'See services', method: 'Learn the method', pause: 'Pause animation', resume: 'Resume animation',
    },
    s1: {
      eyebrow: '01 · The opportunity',
      title: 'AI has already reached operations. The judgment for using it is still fragile.',
      lead: 'Why the mid-sized company uses AI with no rule for deciding where it pays off, and no suitable source of support. The figures below show the same picture at both ends of the size range.',
      carouselLabel: 'Three figures on the opportunity', prev: 'Previous figure', next: 'Next figure', of: 'of',
      stats: [
        { figure: '65%', text: 'of small businesses in Brazil already use AI, mostly text tools such as ChatGPT, Gemini and Copilot', source: 'Sebrae (Brazilian small-business agency), 2025' },
        { figure: '74.3%', text: 'cite high cost as the main barrier to advanced digital technologies', source: 'IBGE (Brazilian statistics bureau), Pintec innovation survey 2024*' },
        { figure: '60.6%', text: 'cite the lack of qualified staff, the barrier that has grown the most since 2022', source: 'IBGE, Pintec innovation survey 2024*' },
      ],
      footnote: '* Manufacturers with 100 or more employees that do not adopt advanced digital technologies.',
      altTitle: 'What the mid-sized company has today, and why it is not enough',
      alts: [
        { title: 'Large consultancies', tag: 'Built for large accounts', text: 'Pyramid-shaped teams, months-long programs and fees sized for large corporations. The smallest project these firms take on is already bigger than the mid-sized company needs, or can afford.' },
        { title: 'AI tool vendors', tag: 'They sell the tool, not the decision', text: 'They deliver the tool; rarely the decision on whether to use AI at all, where and how. The recommendation tends to start from what the vendor has to sell, not from the business problem.' },
        { title: 'Everyone with their own tool', tag: 'Effort without direction', text: 'Employees adopt AI on their own, with no guidance from the company. The risk is spending without return or exposing data without noticing.' },
      ],
      mapTitle: 'The empty space: senior decisions for mid-sized companies', mapNote: 'Qualitative map, not measured: it shows zones.',
      axisY: 'Scope ↑', yTop: 'Strategy and decision', yBottom: 'Deployment and operations', axisX: 'Client size →', xLeft: 'Small and mid-sized company', xRight: 'Large corporation and government',
      cells: [
        { title: 'GM Digital Bunker™', text: 'Senior strategy through to the finished artifact, with no team pyramid', us: true },
        { title: 'Pure-strategy consultancies', text: 'Decision and plan, no construction' },
        { title: 'Tool vendors and builders', text: 'AI tool vendors, agencies and developers' },
        { title: 'Integrators and large consultancies', text: 'Multi-year programs for large corporations and government' },
      ],
      statement: ['Judgment before the tool.', 'Senior decisions, executed with AI, through to the finished artifact.'],
    },
    s2: {
      eyebrow: '02 · The proposal', title: 'From diagnosis to the finished artifact',
      steps: [
        { title: 'Diagnosis', text: 'Understand the business, the operation and where AI actually helps – and where it gets in the way.' },
        { title: 'Decision', text: 'Clear judgment for choosing priorities and tools, with no ties to vendors.' },
        { title: 'Artifact', text: 'Technical document, prototype, application or material for the team, ready to use.' },
      ],
      lead: 'The engagement ends in something usable, in the format in which it will be used.',
      statement: ['No pyramid. With delivery.', 'Whoever diagnoses is whoever delivers: a senior who decides, with AI in production.'],
    },
    s3: {
      eyebrow: '03 · Services', title: 'What the company can hire', label: 'Service', more: 'See the service',
      services: [
        { id: 'estrategia', title: 'AI strategy and digital platform', text: 'A tailored project, from diagnosis to a platform in production; Elite 90 Pro as the case.' },
        { id: 'conselho', title: 'AI advisory by subscription', text: 'Part-time AI executive: quarterly review, vendor screening and a cap on hours.' },
      ],
    },
    s4: {
      eyebrow: '04 · The proof', title: 'A real case, the published method and external evidence',
      caseLabel: 'Case', caseTitle: 'Elite 90 Pro', caseText: 'A 90-day physical transformation program for executives, led by Coach Ruiz. GM Digital Bunker designed the program\'s digital ecosystem and leads its construction module by module.', caseMore: 'Read the case', caseAlt: 'Home page of the Coach Ruiz program website: Build an athlete\'s body in 90 days',
      bookLabel: 'The book', bookTitleHtml: 'When it\'s Better with&nbsp;AI', bookText: 'How to apply AI with rigor and method in technical production, complex analysis and support for strategic decisions.', bookMore: 'About the book', bookAlt: 'Cover of the book Quando é Melhor com IA (When it\'s Better with AI), by Gonçalo Marques',
      hubLabel: 'Free application', hubTitle: 'AI Strategy Hub', hubText: 'A web dashboard that points to the most suitable AI for each work profile.', hubMore: 'Open the AI Strategy Hub', hubAlt: 'AI Strategy Hub screen: the "Code Surgeon" professional profile selected and the recommended ranking with the capability chart', external: 'external site',
      bridgeHtml: 'The articles on the method are in <a href="/en/publications">Publications <span aria-hidden="true">→</span></a>',
      evidenceTitle: 'AI amplifies consulting work, when you know where to use it',
      evidence: [
        { figure: '+12.2%', text: 'tasks completed' }, { figure: '+25.1%', text: 'speed of execution' },
        { figure: '+40%', text: 'assessed quality' }, { figure: '−19', text: 'percentage points of accuracy on a task beyond AI\'s reach' },
      ],
      evidenceLead: 'The gain depends on knowing when AI helps and when it gets in the way. That is the question that names the method: when it\'s better with AI.',
      evidenceSource: "Harvard Business School field study with BCG, 758 consultants (Dell'Acqua et al., SSRN, 2023)",
      statement: ['When is it better with AI?', 'Answering that question, case by case, is the work.'],
    },
    s5: {
      eyebrow: '05 · The fit and the next step', title: 'A practice designed for companies without an executive dedicated exclusively to technology',
      criteria: [
        { term: 'Size', text: 'Mid-sized company (annual revenue of R$ 4.8 million to R$ 300 million) and growing small company' },
        { term: 'Technology', text: 'No dedicated technology director (CIO or CTO); lean, outsourced or operational IT' },
        { term: 'Decision-maker', text: 'CEO, partner or area director, who buys business results' },
        { term: 'Moment', text: 'AI not yet adopted or already used by the team on its own, with no shared rule for deciding where and when to invest' },
        { term: 'Expectation', text: 'A well-founded decision and something usable at the end of the project' },
      ],
      note: 'Size bands per the classification of BNDES, Brazil\'s development bank.',
      notTitle: 'What GM Digital Bunker does not do',
      nots: [
        { title: 'Large-scale operations', text: 'Rollouts with dozens of people or 24-hour operations call for another kind of supplier.' },
        { title: 'Tool resale', text: 'No commercial ties to vendors: the recommendation starts from the business problem.' },
        { title: 'Promises without a source', text: 'Gains are measured or declared as estimates, never presented as guarantees.' },
      ],
    },
    rail: { label: 'Sections of this page', items: ['The opportunity', 'The proposal', 'Services', 'The proof', 'The fit'] },
  },
};
