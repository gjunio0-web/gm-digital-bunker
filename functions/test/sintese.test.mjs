// Phase B, pure parts: synthesis helpers (spec 02, 3), code checks of the verification (spec 02, 4.1, with
// Gon's decisions of 7/11/2026 on CPF and phone) and the analysis moment of graduar (spec 04).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coletaDe, linkaMarcas, secaoS8, simulaMontar, simulaEnquadrar, simulaConversa, validaEnquadrar, validaMontar, validaConversa,
  mensagemConversa, enquadramentoGravado,
} from '../lib/sintese.js';
import { checagens, cpfValido, cpfs, numerosSemFonte, palavras, siglasSemExtenso, telefonesFora, temPronome, validaRevisor } from '../lib/verificacao.js';
import { entradaAnalise, gradua, noticiaRecente, confianca, PESOS_PADRAO } from '../lib/graduacao.js';

const fonte = (url) => ({ url, titulo: url, tipo: 'busca', consultadoEm: '2026-11-07T10:00:00Z' });
const coleta = coletaDe({
  empresa_registro: { status: 'concluida', conteudo: { confirmado: true }, afirmacoes: [], fontes: [fonte('https://brasilapi.com.br/x')] },
  empresa_digital: { status: 'concluida', conteudo: { canaisDeAtendimento: ['(11) 3333-4444'] }, afirmacoes: [], fontes: [fonte('https://acme.com.br/'), fonte('https://acme.com.br/sobre')] },
  empresa_pessoas: { status: 'falhou', conteudo: {}, afirmacoes: [], fontes: [] },
  empresa_noticias: { status: 'concluida', conteudo: { itens: [] }, afirmacoes: [], fontes: [] },
  setor: { status: 'concluida', conteudo: {}, afirmacoes: [], fontes: [fonte('https://setor.example/a')] },
  mercado: undefined,
});

test('coletaDe: failed or missing stages carry no content and no sources', () => {
  assert.equal(coleta.empresa_pessoas.conteudo, null);
  assert.deepEqual(coleta.empresa_pessoas.fontes, []);
  assert.equal(coleta.mercado.status, null);
});

test('linkaMarcas: valid marks become links labelled with the mark; marks pointing nowhere stay as text', () => {
  const r = linkaMarcas('Fato [F:empresa_digital:1]. Outro [F:setor:3]. Já [F:setor:0](https://x).', coleta);
  assert.equal(r, 'Fato [F:empresa_digital:1](https://acme.com.br/sobre). Outro [F:setor:3]. Já [F:setor:0](https://x).');
});

test('secaoS8: sources by stage with the index the marks use', () => {
  const s = secaoS8(coleta);
  assert.match(s.corpo, /### empresa_digital\n\n- \[F:empresa_digital:0\] \[https:\/\/acme\.com\.br\/\]\(https:\/\/acme\.com\.br\/\) – busca, 2026-11-07/);
  assert.doesNotMatch(s.corpo, /empresa_pessoas/);
});

test('palavras: marks and link targets do not count', () => {
  assert.equal(palavras('Três palavras aqui [F:setor:0](https://a.b/c-d-e) [inferência]'), 3);
});

test('numerosSemFonte: digits need a mark, [inferência] or an estimate label in the same sentence', () => {
  assert.deepEqual(numerosSemFonte('A empresa tem 300 funcionários [F:empresa_digital:0]. Fundada em 2015. Cerca de 40 lojas [inferência].'), []);
  assert.deepEqual(numerosSemFonte('Faturamento estimado de 10 milhões. Tem 12 filiais.'), ['Tem 12 filiais.']);
  assert.deepEqual(numerosSemFonte('Em 12 de março de 2026, ver s3 e A2.\n1. Primeiro item\nO caso Elite 90 Pro mostra isso.'), []);
});

test('numerosSemFonte: initials and abbreviations do not cut the sentence; identifiers and time windows pass', () => {
  assert.deepEqual(numerosSemFonte('O CNPJ 84709955000102 consta como Cia Industrial H. Carlos Schneider [F:empresa_registro:0].'), []);
  assert.deepEqual(numerosSemFonte('Não foram encontradas notícias nos últimos 12 meses.'), []);
  assert.deepEqual(numerosSemFonte('**1. Automação de cotações** (seções 4 e 5).\nFica fora pelo limite 4, na versão 0.7 do Mapa, porta 2.'), []);
  assert.deepEqual(numerosSemFonte('A receita vai de R$ 4,8 milhões a R$ 300 milhões.'), ['A receita vai de R$ 4,8 milhões a R$ 300 milhões.']);
});

test('numerosSemFonte (e): norms, mixed words, book references, numbered hypotheses, "em N meses", placeholders', () => {
  const ok = [
    '- Projeto de Lei (PL) 2338/2023 – marco legal da IA: sem vigência.',
    '- Resolução da Diretoria Colegiada (RDC) 430/2020 da ANVISA, aplicável às operações.',
    'Não foi encontrada fonte sobre empresas digitais no 3PL brasileiro.',
    'Ganhos prometidos seguem o princípio Zero Alucinação (livro, cap. 5, seção 5.6), com limites claros.',
    'O conteúdo é desconhecido (hipótese de alavanca 3 – comparação das propostas).',
    'Em 12 meses, o que a empresa quer ver mudar?',
    'Teria disponibilidade em [data e horário 1] ou [data e horário 2]?',
  ];
  assert.deepEqual(numerosSemFonte(ok.join('\n')), []);
  assert.deepEqual(numerosSemFonte('A página de origem, /casos/elite-90-pro, sugere interesse.\nVer https://gmdigitalbunker.com.br/casos/elite-90-pro para o caso.'), []);
  assert.deepEqual(siglasSemExtenso('- Mercado total endereçável (Total Addressable Market, TAM): não estimado.'), []);
  assert.deepEqual(siglasSemExtenso('O TAM (Total Addressable Market) é amplo. Já o SAM é menor.'), ['SAM']);
  assert.deepEqual(telefonesFora('Código 2936086455 do cadastro.', ''), []);
  assert.deepEqual(numerosSemFonte('O mercado reúne cerca de 1.500 operadores.'), ['O mercado reúne cerca de 1.500 operadores.']);
  assert.deepEqual(numerosSemFonte('Um blog cita reduções de até 15% no custo, sem fonte primária.'), ['Um blog cita reduções de até 15% no custo, sem fonte primária.']);
});

test('temPronome: tu, te, ti, contigo as whole words; TI and words containing them are fine', () => {
  assert.equal(temPronome('Vamos te mostrar'), true);
  assert.equal(temPronome('A equipe de TI é enxuta, até parte do time'), false);
  assert.equal(temPronome('Contigo seguimos'), true);
});

test('siglasSemExtenso: the first occurrence must sit next to a parenthesis', () => {
  assert.deepEqual(siglasSemExtenso('Cadastro Nacional da Pessoa Jurídica (CNPJ) confirmado. O CNPJ é válido. A LGPD incide.'), ['LGPD']);
  assert.deepEqual(siglasSemExtenso('As APIs (interfaces de programação de aplicações) e o som ambiente.'), []);
});

test('CPF: format and check digits', () => {
  assert.equal(cpfValido('529.982.247-25'), true);
  assert.equal(cpfValido('529.982.247-26'), false);
  assert.deepEqual(cpfs('CPF 529.982.247-25 e 111.111.111-11 e CNPJ 11.222.333/0001-81'), ['529.982.247-25']);
});

test('telefonesFora: a phone found in the company data collected raises nothing', () => {
  const digitos = JSON.stringify(coleta.empresa_digital).replace(/\D/g, '');
  assert.deepEqual(telefonesFora('Atendimento pelo (11) 3333-4444.', digitos), []);
  assert.deepEqual(telefonesFora('Celular do sócio: (11) 98765-4321.', digitos), ['(11) 98765-4321']);
  assert.deepEqual(telefonesFora('CNPJ 11222333000181 e ano 2020-2024.', digitos), []);
});

const secao = (corpo, vazia = false) => ({ corpo, vazia });
// Sections open with a label in the format of spec 02 v0.15, so only the rule under test fails.
const longo = (extra = '') => `**Rótulo.** ${'palavra '.repeat(45)}${extra}`;
const analise = (sobrescreve = {}) => ({
  secoes: { s1: secao(longo()), s2: secao(longo()), s3: secao(longo()), s4: secao(longo()), s5: secao('', true), s6: secao(longo()), s7: secao(longo()) },
  rascunhoResposta: { assunto: 'Conversa', corpo: 'Podemos conversar na terça? GM Digital Bunker™' },
  lang: 'pt-BR',
  cnpjConfirmado: true,
  ...sobrescreve,
});

test('checagens: a clean analysis has no issues', () => {
  assert.deepEqual(checagens(analise(), coleta), []);
});

test('checagens: each rule of spec 02, 4.1 raises a "mecanica" issue', () => {
  const a = analise({
    secoes: {
      s1: secao(longo('Ver [F:setor:9].')),
      s2: secao(longo('Tem 12 filiais.')),
      s3: secao('curta demais'),
      s4: secao(longo('texto — com travessão')),
      s5: secao(longo('vamos te ligar')),
      s6: secao(longo('A LGPD incide.')),
      s7: secao(longo('CPF 529.982.247-25 e celular (11) 98765-4321.')),
    },
    rascunhoResposta: { assunto: 'Proposta', corpo: `${'p '.repeat(121)} R$ 5 mil, tu` },
    cnpjConfirmado: false,
  });
  const p = checagens(a, coleta);
  assert.ok(p.every((x) => x.tipo === 'mecanica' && x.correcaoSugerida === null));
  const por = (regra) => p.filter((x) => x.regra === regra).map((x) => [x.secao, x.trecho]);
  assert.deepEqual(por('marca_sem_destino'), [['s1', '[F:setor:9]']]);
  assert.ok(por('numero_sem_fonte').some(([s, t]) => s === 's2' && t.endsWith('Tem 12 filiais.')));
  assert.deepEqual(por('secao_curta'), [['s3', 'seção não vazia com 2 palavras (mínimo 40)']]);
  assert.deepEqual(por('cnpj_a_confirmar').map(([s]) => s), ['s2']);
  // Excerpts are exact substrings of the body, so the hub can find them.
  // Rules renamed in spec 02 v0.12: travessao and pronome are tipografia; cpf and telefone are dados_pessoais.
  const tipografia = por('tipografia');
  assert.deepEqual(tipografia.map(([s]) => s), ['s4', 's5', 'rascunhoResposta']);
  for (const [s, t] of tipografia.slice(0, 2)) assert.ok(a.secoes[s].corpo.includes(t), t);
  assert.ok(tipografia[2][1].includes('tu'));
  const [[s6, t6]] = por('sigla');
  assert.equal(s6, 's6');
  assert.ok(a.secoes.s6.corpo.includes(t6));
  assert.deepEqual(por('dados_pessoais'), [['s7', '529.982.247-25'], ['s7', '(11) 98765-4321']]);
  assert.equal(por('rascunho_longo').length, 1);
  assert.ok(por('rascunho_preco')[0][1].includes('R$'));
});

test('checagens: an English draft is not checked for Portuguese pronouns', () => {
  const p = checagens(analise({ lang: 'en', rascunhoResposta: { assunto: 'Hi', corpo: 'Nice to meet te team. GM Digital Bunker™' } }), coleta);
  assert.deepEqual(p, []);
});

test('simulated analysis: passes the checks, and the "pendência" variant fails on the s2 label and the long dash', () => {
  const ok = simulaMontar(false);
  const a = { secoes: ok, rascunhoResposta: simulaConversa().rascunhoResposta, lang: 'pt-BR', cnpjConfirmado: false };
  assert.deepEqual(checagens(a, coleta), []);
  const p = checagens({ ...a, secoes: simulaMontar(true) }, coleta);
  assert.deepEqual(p.map((x) => [x.secao, x.regra]), [['s2', 'bloco_sem_rotulo'], ['s3', 'tipografia']]);
});

test('output checks: schema mismatches throw; titles are fixed; at most three hypotheses', () => {
  assert.throws(() => validaEnquadrar({}), /enquadrar/);
  assert.throws(() => validaConversa({ perguntas: [] }), /preparar_conversa/);
  assert.throws(() => validaRevisor({ checklist: [], pendencias: [{ tipo: 'outro', secao: 's1', trecho: 'x', correcaoSugerida: 'y' }] }), /revisor/);
  const e = simulaEnquadrar();
  const quatro = validaEnquadrar({ ...e, hipotesesDeAlavanca: [1, 2, 3, 4].map(() => e.hipotesesDeAlavanca[0]) });
  assert.equal(quatro.hipotesesDeAlavanca.length, 3);
  const m = simulaMontar(false);
  assert.throws(() => validaMontar({ ...m, s3: { ...m.s3, titulo: 'Pessoas' } }), /title is not the fixed one in s3/);
  // The API does not guarantee the case of const values: a different case is accepted, the canonical title kept.
  assert.equal(validaMontar({ ...m, s1: { ...m.s1, titulo: 'Qualificação Imediata' } }).s1.titulo, 'Qualificação imediata');
  assert.deepEqual(validaRevisor({ checklist: [], pendencias: [{ tipo: 'lastro', secao: 's6', trecho: 'x', correcaoSugerida: 'y' }] }).pendencias, [{ tipo: 'lastro', secao: 's6', trecho: 'x', correcaoSugerida: 'y' }]);
});

test('preparar_conversa gets only destino and modificadores in <lead>', () => {
  const lead = { destino: 'verificar_aderencia', modificadores: { spam: false, escopo: 'ressalva', confianca: 'media', confiancaMotivo: 'x' }, quadrante: 'qualificar', grau: 'B', pontos: 55 };
  const [, b] = mensagemConversa('dados', {}, lead);
  const bloco = /<lead>\n([\s\S]*?)\n<\/lead>/.exec(b.texto)[1];
  assert.deepEqual(Object.keys(JSON.parse(bloco)), ['destino', 'destinoRotulo', 'modificadores']);
  assert.doesNotMatch(bloco, /quadrante|grau|pontos/);
});

test('enquadramentoGravado: filter fields of spec 01 plus the full output', () => {
  const g = enquadramentoGravado(simulaEnquadrar());
  assert.deepEqual([g.escopo, g.portaProvavel, g.riscos, g.estruturaTecnologia.categoria], ['aprovado', 'conselho', [], 'enxuta']);
  assert.ok(g.detalhe.hipotesesDeAlavanca.length);
});

// --- graduar, analysis moment -------------------------------------------------------------------------

const momento = new Date('2026-11-07T15:00:00Z');
test('noticiaRecente: expansion, fundraising or product dated within 12 months; undated items do not count', () => {
  const n = (itens) => ({ status: 'concluida', conteudo: { itens } });
  assert.equal(noticiaRecente(n([{ data: '2025-11', tema: 'expansao' }]), momento), true);
  assert.equal(noticiaRecente(n([{ data: '2025-10', tema: 'captacao' }]), momento), false);
  assert.equal(noticiaRecente(n([{ data: null, tema: 'produto' }]), momento), false);
  assert.equal(noticiaRecente(n([{ data: '2026-05', tema: 'premio' }]), momento), false);
  assert.equal(noticiaRecente({ status: 'falhou' }, momento), null);
});

const ficha = {
  qualificacao: { decisao: 'prosseguir', nivelCargo: 'decisor', dominioCorporativo: true, temMensagem: true, classificacaoMensagem: { tipoContato: 'empresa', falaDeProblemaOuFerramenta: 'problema', gatilho: 'prazo' } },
  origem: { pagina: '/servicos/conselho-de-ia' },
};
const docs = {
  empresa_registro: { status: 'concluida', confianca: { grau: 'alta' }, conteudo: { confirmado: true, escolhido: { cnpj: '11222333000181', porteLegal: 'demais' } } },
  empresa_digital: { status: 'concluida', confianca: { grau: 'media' }, paginasLidas: ['https://acme.com.br/'], insumosCodigo: { apolloEncontrado: true }, conteudo: { apollo: { funcionariosEstimados: { faixa: '51-200', minimo: 51, maximo: 200 } } } },
  empresa_pessoas: { status: 'concluida', confianca: { grau: 'alta' }, conteudo: { signatario: { coincideComFicha: 'true' }, empresa: { vagasAbertas: [] } } },
  empresa_noticias: { status: 'concluida', confianca: { grau: 'media' }, conteudo: { itens: [{ data: '2026-03', tema: 'expansao' }] } },
};
const enq = (mod = {}) => ({ ...simulaEnquadrar(), ...mod });

test('entradaAnalise + gradua: every item of the analysis scores, no marks', () => {
  const l = gradua(entradaAnalise(ficha, docs, enq(), momento), PESOS_PADRAO);
  assert.equal(l.momento, 'analise');
  // Aderência 18 + 12; Decisão 12 + 4 + 4; Intenção 8 + 8 + 6 + 4 + 4; Clareza 10 + 5 + 5.
  assert.deepEqual([l.eixos.aderencia.pontos, l.eixos.decisao.pontos, l.eixos.intencao.pontos, l.eixos.clareza.pontos], [30, 20, 30, 20]);
  assert.equal(l.pontos, 100);
  assert.ok([...l.eixos.decisao.parcelas, ...l.eixos.intencao.parcelas, ...l.eixos.clareza.parcelas].every((p) => p.marca === null));
  assert.equal(l.modificadores.confianca, 'alta');
  assert.equal(l.modificadores.confiancaMotivo, 'sem ressalvas');
});

test('analysis: deductions with the ceiling, scope modifiers, Pessoas stage failed', () => {
  const riscos = ['curioso_sem_orcamento', 'expectativa_de_revenda', 'outro', 'porte_fora_da_faixa'].map((risco) => ({ risco, origem: 'coleta', sinal: 's' }));
  const l = gradua(entradaAnalise(ficha, docs, enq({ riscosDoLead: riscos, escopo: { resultado: 'ressalva', itensAvaliados: [] } }), momento), PESOS_PADRAO);
  assert.deepEqual(l.deducoes, [{ risco: 'curioso_sem_orcamento', pontos: -8 }, { risco: 'expectativa_de_revenda', pontos: -8 }]);
  assert.equal(l.pontos, 84);
  assert.equal(l.grau, 'B'); // A limited to B by the reservation
  const b = gradua(entradaAnalise(ficha, docs, enq({ escopo: { resultado: 'barrado', itensAvaliados: [] } }), momento), PESOS_PADRAO);
  assert.equal(b.grau, 'D');
  assert.equal(b.quadrante, 'priorizar'); // quadrant kept
  const semPessoas = gradua(entradaAnalise(ficha, { ...docs, empresa_pessoas: { status: 'falhou' } }, enq(), momento), PESOS_PADRAO);
  assert.equal(semPessoas.eixos.decisao.parcelas[1].marca, 'cargo_nao_verificado');
  assert.equal(semPessoas.modificadores.confiancaMotivo, 'Pessoas com confiança baixa');
});

test('analysis (spec 04 v0.15): "outro" never deducts; risks need origin ficha or coleta; direction needs medium or high confidence', () => {
  const base = gradua(entradaAnalise(ficha, docs, enq(), momento), PESOS_PADRAO).pontos;
  // GAT v2 of Phase B: three "outro" risks took 12 points; now none.
  const tresOutros = Array.from({ length: 3 }, () => ({ risco: 'outro', origem: 'coleta', sinal: 's' }));
  assert.equal(gradua(entradaAnalise(ficha, docs, enq({ riscosDoLead: tresOutros }), momento), PESOS_PADRAO).pontos, base);
  // A stored configuration still weighing "outro" (version 1) changes nothing.
  const antigos = { ...PESOS_PADRAO, versao: '1', deducoes: { ...PESOS_PADRAO.deducoes, outro: 4 } };
  assert.deepEqual(gradua(entradaAnalise(ficha, docs, enq({ riscosDoLead: tresOutros }), momento), antigos).deducoes, []);
  // Without origin (versions before v0.12) a risk does not deduct.
  assert.deepEqual(gradua(entradaAnalise(ficha, docs, enq({ riscosDoLead: [{ risco: 'curioso_sem_orcamento', sinal: 's' }] }), momento), PESOS_PADRAO).deducoes, []);
  assert.equal(gradua(entradaAnalise(ficha, docs, enq({ riscosDoLead: [{ risco: 'curioso_sem_orcamento', origem: 'ficha', sinal: 's' }] }), momento), PESOS_PADRAO).pontos, base - 8);
  const direcao = (confianca) => gradua(entradaAnalise(ficha, docs, enq({ leituraDoPotencial: { direcao: 'crescer', confianca, comoOrientaAPorta: 'x' } }), momento), PESOS_PADRAO).eixos.clareza.parcelas.find((p) => p.criterio === 'direcao').pontos;
  assert.deepEqual([direcao('alta'), direcao('media'), direcao('baixa'), direcao(undefined)], [5, 5, 0, 0]);
});

test('analysis: growth signal from news or open jobs turns an EPP into 14', () => {
  const epp = { ...docs, empresa_registro: { ...docs.empresa_registro, conteudo: { confirmado: true, escolhido: { cnpj: '1', porteLegal: 'EPP' } } } };
  const semSinal = { ...epp, empresa_noticias: { status: 'concluida', conteudo: { itens: [] } } };
  assert.equal(gradua(entradaAnalise(ficha, epp, enq(), momento)).eixos.aderencia.porte.pontos, 14);
  assert.equal(gradua(entradaAnalise(ficha, semSinal, enq(), momento)).eixos.aderencia.porte.pontos, 8);
  const comVagas = { ...semSinal, empresa_pessoas: { ...docs.empresa_pessoas, conteudo: { signatario: {}, empresa: { vagasAbertas: [{ titulo: 'x' }] } } } };
  assert.equal(gradua(entradaAnalise(ficha, comVagas, enq(), momento)).eixos.aderencia.porte.pontos, 14);
});

test('confidence at the end of verificar: pending issues make it medium, keeping the low reasons first', () => {
  const e = entradaAnalise(ficha, docs, enq(), momento, true);
  assert.deepEqual(confianca(e), { nivel: 'media', motivo: 'análise com pendências' });
  const baixa = entradaAnalise(ficha, { ...docs, empresa_registro: { status: 'concluida', confianca: { grau: 'baixa' }, conteudo: { confirmado: false } } }, enq(), momento, true);
  assert.deepEqual(confianca(baixa), { nivel: 'baixa', motivo: 'CNPJ não confirmado · análise com pendências · Registro com confiança baixa' });
});
