// graduar (spec 04, sections 2 to 5; decisions of Gon of 6/11/2026): axes with items and marks,
// quadrant, grade, destination, confidence, deadline in business days, retention and next state.
import { test } from 'node:test';
import { normalizaFuncionarios } from '../lib/coleta/funcionarios.js';
import assert from 'node:assert/strict';
import {
  PESOS_PADRAO, confianca, diaUtil, entradaTriagem, estimativaFuncionarios, feriados, gradua, guardaCurta, normalizaPagina, pascoa,
  pontosDaPagina, porte, porteLegalDe, prazoDaAnalise, prazoDaTriagem, prazoEmDiasUteis, proximoEstado, siteLido,
} from '../lib/graduacao.js';

// A triagem input with everything neutral; each test changes what it checks.
const base = (o = {}) => ({
  momento: 'triagem', spam: false, tipoContato: 'empresa',
  porteLegal: null, cnpjConfirmado: false, funcionarios: null, fonteFuncionarios: 'apollo', siteLido: true, apolloEncontrado: false, sinalCrescimento: false,
  tecnologia: { categoria: 'sem_sinal', evidencia: 'x' },
  nivelCargo: 'outro', cargoConfirmado: null, dominioCorporativo: false,
  temMensagem: false, problemaOuFerramenta: 'nenhum', gatilho: false, paginaOrigem: null, noticia: null,
  porta: { porta: 'indeterminada', sinais: 0 }, hipotese: null, direcao: null,
  riscos: [], escopo: null, confiancaBlocos: { registro: 'media', digital: 'media', pessoas: null }, comPendencias: false,
  ...o,
});
const w = PESOS_PADRAO;

test('Aderência, size: spec 04 table and the decisions of 6/11 for the uncovered cases', () => {
  const casos = [
    [{ cnpjConfirmado: true, porteLegal: 'demais', funcionarios: 500 }, 'demais_ate_500', 18],
    [{ cnpjConfirmado: true, porteLegal: 'EPP', sinalCrescimento: true }, 'epp_com_crescimento', 14],
    [{ cnpjConfirmado: true, porteLegal: 'EPP' }, 'epp_sem_crescimento', 8],
    [{ cnpjConfirmado: true, porteLegal: 'demais', funcionarios: 501 }, 'de_501_a_1000', 6],
    [{ cnpjConfirmado: true, porteLegal: 'ME' }, 'microempresa', 3],
    [{ cnpjConfirmado: true, porteLegal: 'demais', funcionarios: 1001 }, 'acima_de_1000', 0],
    [{ cnpjConfirmado: true, porteLegal: 'demais' }, 'indeterminado', 9], // decision 2: "Demais" without head count
    [{ funcionarios: 200, apolloEncontrado: true }, 'indeterminado', 9], // decision 1: CNPJ not confirmed, up to 500
    [{ funcionarios: 800, apolloEncontrado: true }, 'de_501_a_1000', 6], // decision 1: 501 to 1,000
    [{ funcionarios: 5000, apolloEncontrado: true }, 'acima_de_1000', 0], // decision 1: above 1,000
    [{}, 'indeterminado', 9], // site read, nothing else
    [{ siteLido: false }, 'nenhuma_empresa', 0], // decision 3: no site read, no Apollo, no confirmed CNPJ
    [{ tipoContato: 'pessoa_fisica', cnpjConfirmado: true, porteLegal: 'demais', funcionarios: 50 }, 'pessoa_fisica', 0],
    [{ tipoContato: 'estudante' }, 'pessoa_fisica', 0],
    [{ tipoContato: 'fornecedor', cnpjConfirmado: true, porteLegal: 'ME' }, 'microempresa', 3], // supplier goes by the axes
    [{ porteLegal: 'demais', funcionarios: 100 }, 'indeterminado', 9], // legal size only counts with a confirmed CNPJ
  ];
  for (const [o, categoria, pontos] of casos) assert.deepEqual(porte(base(o), w), { categoria, pontos }, JSON.stringify(o));
});

test('Aderência, technology: model category in points; 0 without a company', () => {
  const l = (o) => gradua(base(o)).eixos.aderencia.tecnologia;
  assert.equal(l({ tecnologia: { categoria: 'enxuta', evidencia: 'TI terceirizada' } }).pontos, 12);
  assert.equal(l({ tecnologia: { categoria: 'equipe_propria', evidencia: 'x' } }).pontos, 5);
  assert.equal(l({ tecnologia: { categoria: 'executivo', evidencia: 'CTO' } }).pontos, 0);
  assert.equal(l({ tecnologia: null }).pontos, 8);
  assert.deepEqual(l({ siteLido: false, tecnologia: { categoria: 'enxuta', evidencia: 'x' } }), { categoria: 'sem_empresa', pontos: 0, evidencia: null });
});

test('Decisão: role level, external confirmation marked in triagem, corporate domain', () => {
  const d = gradua(base({ nivelCargo: 'decisor', dominioCorporativo: true })).eixos.decisao;
  assert.equal(d.pontos, 16);
  assert.equal(d.maximo, 20);
  assert.deepEqual(d.parcelas.map((p) => [p.criterio, p.pontos, p.marca]), [['nivelCargo', 12, null], ['cargoConfirmado', 0, 'cargo_nao_verificado'], ['dominioCorporativo', 4, null]]);
  assert.equal(gradua(base({ nivelCargo: 'intermediario' })).eixos.decisao.pontos, 4);
  const a = gradua(base({ momento: 'analise', nivelCargo: 'decisor', cargoConfirmado: 'indeterminado' })).eixos.decisao;
  assert.deepEqual(a.parcelas[1], { criterio: 'cargoConfirmado', valor: 'indeterminado', pontos: 2, marca: null });
});

test('Intenção: message, problem or tool, trigger, origin page, news marked in triagem', () => {
  const i = gradua(base({ temMensagem: true, problemaOuFerramenta: 'ambos', gatilho: true, paginaOrigem: '/servicos/conselho-de-ia' })).eixos.intencao;
  assert.equal(i.pontos, 26);
  assert.equal(i.maximo, 30);
  assert.deepEqual(i.parcelas.map((p) => p.criterio), ['mensagem', 'problemaOuFerramenta', 'gatilho', 'paginaOrigem', 'noticia']);
  assert.equal(i.parcelas[4].marca, 'noticias_nao_coletadas');
  assert.equal(gradua(base({ temMensagem: true, problemaOuFerramenta: 'ferramenta' })).eixos.intencao.pontos, 11);
});

test('origin page (spec 01, lead): normalized, then looked up in pesosQualificacao.paginasOrigem', () => {
  const pontos = (p) => pontosDaPagina(normalizaPagina(p), w.paginasOrigem);
  for (const p of ['/servicos/conselho-de-ia', '/servicos/estrategia-e-plataforma-digital-com-ia', '/servicos/workshop-quando-e-melhor-com-ia', '/en/services/ai-advisory', '/en/services/ai-strategy-and-digital-platform', '/en/services/when-its-better-with-ai-workshop']) assert.equal(pontos(p), 4, p);
  // (b) trailing slash; also no leading slash, upper case, query and fragment
  assert.equal(pontos('/servicos/conselho-de-ia/'), 4);
  assert.equal(pontos('servicos/conselho-de-ia'), 4);
  assert.equal(pontos('/EN/Services/AI-Advisory?x=1#y'), 4);
  assert.equal(normalizaPagina('/servicos/conselho-de-ia/'), normalizaPagina('servicos/conselho-de-ia'));
  for (const p of ['/casos/elite-90-pro', '/en/cases/elite-90-pro', '/casos/a/b']) assert.equal(pontos(p), 3, p);
  for (const p of ['/metodo', '/metodo/livro', '/sobre', '/en/method', '/en/method/book', '/en/about']) assert.equal(pontos(p), 1, p);
  for (const p of ['/casos', '/en/cases', '/servicos', '/en/services', '/', '/en', '/contato', '/en/contact', '/publicacoes', '/en/publications', '/privacidade', '/en/privacy', null, '', '/x/y/z']) assert.equal(pontos(p), 0, String(p));
  assert.equal(normalizaPagina('/?utm=1'), null);
});

test('Clareza: single door with two signals 10, combination 7, one signal 4, undetermined 0; hypothesis and direction only in analysis', () => {
  const c = (porta) => gradua(base({ porta })).eixos.clareza;
  assert.equal(c({ porta: 'conselho', sinais: 2 }).pontos, 10);
  assert.equal(c({ porta: 'combinacao', sinais: 3 }).pontos, 7);
  assert.equal(c({ porta: 'projeto', sinais: 1 }).pontos, 4);
  assert.equal(c(null).pontos, 0);
  assert.deepEqual(c({ porta: 'conselho', sinais: 2 }).parcelas.slice(1).map((p) => p.marca), ['so_na_analise', 'so_na_analise']);
  assert.equal(gradua(base({ momento: 'analise', porta: { porta: 'conselho', sinais: 2 }, hipotese: true, direcao: true })).eixos.clareza.pontos, 20);
});

test('triagem maxima: Aderência 30, Decisão 16, Intenção 26, Clareza 10', () => {
  const l = gradua(base({
    cnpjConfirmado: true, porteLegal: 'demais', funcionarios: 100, tecnologia: { categoria: 'enxuta', evidencia: 'x' },
    nivelCargo: 'decisor', dominioCorporativo: true, temMensagem: true, problemaOuFerramenta: 'problema', gatilho: true,
    paginaOrigem: '/servicos/conselho-de-ia', porta: { porta: 'conselho', sinais: 3 },
  }));
  assert.deepEqual([l.eixos.aderencia.pontos, l.eixos.decisao.pontos, l.eixos.intencao.pontos, l.eixos.clareza.pontos], [30, 16, 26, 10]);
  assert.equal(l.pontos, 82);
  assert.equal(l.quadrante, 'priorizar');
  assert.equal(l.grau, 'A');
  assert.equal(l.destino, 'convidar');
});

test('quadrant: threshold 15 on Aderência and Intenção', () => {
  const ad = (n) => (n >= 15 ? { cnpjConfirmado: true, porteLegal: 'demais', funcionarios: 100, tecnologia: { categoria: 'executivo', evidencia: 'x' } } : { cnpjConfirmado: true, porteLegal: 'ME', tecnologia: { categoria: 'equipe_propria', evidencia: 'x' } });
  // Aderência 18 or 8; Intenção 16 (message 8 + problem 8) or 14 (message 8 + trigger 6).
  const alta = { temMensagem: true, problemaOuFerramenta: 'problema' };
  const baixa = { temMensagem: true, gatilho: true };
  assert.equal(gradua(base({ ...ad(18), ...alta })).quadrante, 'priorizar');
  assert.equal(gradua(base({ ...ad(18), ...baixa })).quadrante, 'nutrir');
  assert.equal(gradua(base({ ...ad(8), ...alta })).quadrante, 'qualificar');
  assert.equal(gradua(base({ ...ad(8), ...baixa })).quadrante, 'declinar');
  const borda = gradua(base({ cnpjConfirmado: true, porteLegal: 'ME', tecnologia: { categoria: 'enxuta', evidencia: 'x' }, temMensagem: true, problemaOuFerramenta: 'nenhum', gatilho: true, paginaOrigem: '/metodo' }));
  assert.equal(borda.eixos.aderencia.pontos, 15);
  assert.equal(borda.eixos.intencao.pontos, 15);
  assert.equal(borda.quadrante, 'priorizar');
  assert.deepEqual(['priorizar', 'qualificar', 'nutrir', 'declinar'].map((q) => ({ priorizar: 'convidar', qualificar: 'verificar_aderencia', nutrir: 'nutrir', declinar: 'encerrar' })[q]), ['convidar', 'verificar_aderencia', 'nutrir', 'encerrar']);
});

test('grade bands 29/30, 49/50, 69/70 and deadlines 5, 4, 3, 2 business days', () => {
  // Points built from Aderência (porte 9 + tecnologia 12 = 21) plus Decisão and Intenção items.
  const com = (extra) => gradua(base({ tecnologia: { categoria: 'enxuta', evidencia: 'x' }, ...extra }));
  const casos = [
    [{}, 21 + 0, 'D', 5],
    [{ nivelCargo: 'intermediario', dominioCorporativo: true }, 29, 'D', 5],
    [{ temMensagem: true, problemaOuFerramenta: 'nenhum', paginaOrigem: '/metodo' }, 30, 'C', 4],
    [{ nivelCargo: 'decisor', dominioCorporativo: true, temMensagem: true, paginaOrigem: '/metodo', porta: { porta: 'projeto', sinais: 1 } }, 50, 'B', 3],
    [{ nivelCargo: 'decisor', dominioCorporativo: true, temMensagem: true, problemaOuFerramenta: 'ferramenta', paginaOrigem: '/metodo', porta: { porta: 'projeto', sinais: 1 } }, 53, 'B', 3],
  ];
  for (const [o, pontos, grau, prazo] of casos) {
    const l = com(o);
    assert.equal(l.pontos, pontos, JSON.stringify(o));
    assert.equal(l.grau, grau, JSON.stringify(o));
    assert.equal(l.acao.prazoDiasUteis, prazo);
  }
  const a = gradua(base({ momento: 'analise', cnpjConfirmado: true, porteLegal: 'demais', funcionarios: 100, tecnologia: { categoria: 'enxuta', evidencia: 'x' }, nivelCargo: 'decisor', dominioCorporativo: true, cargoConfirmado: 'false', temMensagem: true, problemaOuFerramenta: 'nenhum', paginaOrigem: '/sobre', noticia: false, porta: { porta: 'conselho', sinais: 0 }, hipotese: false, direcao: false }));
  assert.equal(a.pontos, 30 + 16 + 9 + 4);
  assert.equal(a.grau, 'B');
  const b = gradua(base({ momento: 'analise', cnpjConfirmado: true, porteLegal: 'demais', funcionarios: 100, tecnologia: { categoria: 'enxuta', evidencia: 'x' }, nivelCargo: 'decisor', dominioCorporativo: true, cargoConfirmado: 'false', temMensagem: true, problemaOuFerramenta: 'nenhum', paginaOrigem: '/sobre', noticia: true, porta: { porta: 'conselho', sinais: 2 }, hipotese: false, direcao: false }));
  assert.equal(b.pontos, 69);
  assert.equal(b.grau, 'B');
  const c = gradua(base({ momento: 'analise', cnpjConfirmado: true, porteLegal: 'demais', funcionarios: 100, tecnologia: { categoria: 'enxuta', evidencia: 'x' }, nivelCargo: 'decisor', dominioCorporativo: true, cargoConfirmado: 'false', temMensagem: true, problemaOuFerramenta: 'nenhum', paginaOrigem: '/casos/x', noticia: true, porta: { porta: 'conselho', sinais: 2 }, hipotese: false, direcao: false }));
  assert.equal(c.pontos, 71);
  assert.equal(c.grau, 'A');
  assert.equal(c.acao.prazoDiasUteis, 2);
});

test('analysis: deductions with ceiling; scope barred caps at D, with reservation at B', () => {
  const forte = { momento: 'analise', cnpjConfirmado: true, porteLegal: 'demais', funcionarios: 100, tecnologia: { categoria: 'enxuta', evidencia: 'x' }, nivelCargo: 'decisor', dominioCorporativo: true, cargoConfirmado: 'true', temMensagem: true, problemaOuFerramenta: 'problema', gatilho: true, paginaOrigem: '/servicos/conselho-de-ia', noticia: true, porta: { porta: 'conselho', sinais: 2 }, hipotese: true, direcao: true };
  assert.equal(gradua(base(forte)).pontos, 100);
  const d = gradua(base({ ...forte, riscos: ['curioso_sem_orcamento', 'expectativa_de_revenda', 'outro', 'porte_fora_da_faixa'] }));
  assert.deepEqual(d.deducoes, [{ risco: 'curioso_sem_orcamento', pontos: -8 }, { risco: 'expectativa_de_revenda', pontos: -8 }]);
  assert.equal(d.pontos, 84);
  assert.equal(gradua(base({ ...forte, escopo: 'ressalva' })).grau, 'B');
  const barrado = gradua(base({ ...forte, escopo: 'barrado' }));
  assert.equal(barrado.grau, 'D');
  assert.equal(barrado.quadrante, 'priorizar');
  assert.equal(guardaCurta(barrado), true);
  assert.deepEqual(gradua(base({ riscos: ['outro'], escopo: 'barrado' })).deducoes, []); // triagem: none of it applies
  assert.equal(gradua(base({ escopo: 'barrado' })).modificadores.escopo, null);
});

test('confidence (spec 04, 2.5; spec 01, recording rules): level and every applicable reason', () => {
  const b = (registro, digital, pessoas = null, momento = 'triagem') => ({ momento, confiancaBlocos: { registro, digital, pessoas } });
  const ok = { cnpjConfirmado: true, porteLegal: 'demais', funcionarios: 100 };
  assert.deepEqual(confianca(base({ cnpjConfirmado: false, ...b('alta', 'alta') })), { nivel: 'baixa', motivo: 'CNPJ não confirmado' });
  assert.deepEqual(confianca(base({ cnpjConfirmado: true, porteLegal: 'demais', funcionarios: null, ...b('alta', 'alta') })), { nivel: 'baixa', motivo: 'porte sem estimativa de funcionários' });
  assert.equal(confianca(base({ cnpjConfirmado: true, porteLegal: 'EPP', funcionarios: null, ...b('alta', 'alta') })).nivel, 'alta'); // only "Demais" needs the head count
  assert.deepEqual(confianca(base({ ...ok, ...b('media', 'alta') })), { nivel: 'alta', motivo: 'sem ressalvas' });
  assert.deepEqual(confianca(base({ ...ok, ...b('alta', 'baixa') })), { nivel: 'media', motivo: 'Presença digital com confiança baixa' });
  assert.deepEqual(confianca(base({ ...ok, ...b('baixa', 'baixa') })), { nivel: 'baixa', motivo: 'Registro e Presença digital com confiança baixa' });
  assert.deepEqual(confianca(base({ ...ok, ...b('baixa', 'baixa', 'baixa', 'analise') })), { nivel: 'baixa', motivo: 'Registro, Presença digital e Pessoas com confiança baixa' });
  assert.deepEqual(confianca(base({ ...ok, ...b('alta', 'alta', 'baixa', 'analise') })), { nivel: 'media', motivo: 'Pessoas com confiança baixa' });
  assert.deepEqual(confianca(base({ ...ok, comPendencias: true, ...b('alta', 'alta', 'alta', 'analise') })), { nivel: 'media', motivo: 'análise com pendências' });
  // Several reasons: the one that sets the level first, the others after " · ".
  assert.deepEqual(confianca(base({ cnpjConfirmado: false, ...b('alta', 'baixa') })), { nivel: 'baixa', motivo: 'CNPJ não confirmado · Presença digital com confiança baixa' });
  assert.deepEqual(
    confianca(base({ cnpjConfirmado: true, porteLegal: 'demais', funcionarios: null, comPendencias: true, ...b('baixa', 'baixa', 'alta', 'analise') })),
    { nivel: 'baixa', motivo: 'porte sem estimativa de funcionários · Registro e Presença digital com confiança baixa · análise com pendências' },
  );
  const l = gradua(base({ ...ok, ...b('alta', 'alta') }));
  assert.deepEqual([l.modificadores.confianca, l.modificadores.confiancaMotivo], ['alta', 'sem ressalvas']);
  assert.deepEqual(l.eixos.aderencia.porte, { categoria: 'demais_ate_500', pontos: 18, fonteFuncionarios: 'apollo' });
  assert.equal(gradua(base({})).eixos.aderencia.porte.fonteFuncionarios, null); // no head count, no source
});

// Stored documents for the head-count cases (spec 02 v0.10: {faixa, minimo, maximo}).
const dig = (faixa) => ({ status: 'concluida', paginasLidas: ['https://x.com.br/'], conteudo: { apollo: faixa === undefined ? null : { funcionariosEstimados: normalizaFuncionarios(faixa) } } });
const pes = (faixa) => ({ status: 'concluida', conteudo: { empresa: { funcionariosEstimados: { ...normalizaFuncionarios(faixa), fonte: 'site da empresa' } } } });
const analise = (o) => base({ momento: 'analise', confiancaBlocos: { registro: 'alta', digital: 'alta', pessoas: 'alta' }, ...o });
const comEstimativa = (d, p, momento, o) => {
  const e = { ...(momento === 'analise' ? analise(o) : base({ confiancaBlocos: { registro: 'alta', digital: 'alta', pessoas: null }, ...o })), ...estimativaFuncionarios(d, p, momento) };
  return gradua(e);
};
const demais = { cnpjConfirmado: true, porteLegal: 'demais', siteLido: true };

test('changes document, section 3: the seven cases', () => {
  // 1. "Demais", no Apollo estimate, triagem → 9; low confidence for the size; no source.
  let l = comEstimativa(dig(undefined), undefined, 'triagem', demais);
  assert.deepEqual(l.eixos.aderencia.porte, { categoria: 'indeterminado', pontos: 9, fonteFuncionarios: null });
  assert.deepEqual([l.modificadores.confianca, l.modificadores.confiancaMotivo], ['baixa', 'porte sem estimativa de funcionários']);
  // 2. "Demais", Apollo without estimate, Pessoas "300", analysis → 18 from Pessoas; the size no longer lowers the confidence.
  l = comEstimativa(dig(null), pes('300'), 'analise', demais);
  assert.deepEqual(l.eixos.aderencia.porte, { categoria: 'demais_ate_500', pontos: 18, fonteFuncionarios: 'pessoas' });
  assert.deepEqual([l.modificadores.confianca, l.modificadores.confiancaMotivo], ['alta', 'sem ressalvas']);
  // 3. Pessoas "501-800" → 6 (upper bound 800).
  assert.equal(comEstimativa(dig(null), pes('501-800'), 'analise', demais).eixos.aderencia.porte.pontos, 6);
  // 4. Pessoas "2000" → 0.
  assert.equal(comEstimativa(dig(null), pes('2000'), 'analise', demais).eixos.aderencia.porte.pontos, 0);
  // 5. "Demais", no estimate from either source, analysis → 9, low confidence.
  l = comEstimativa(dig(null), pes(null), 'analise', demais);
  assert.deepEqual([l.eixos.aderencia.porte.pontos, l.eixos.aderencia.porte.fonteFuncionarios, l.modificadores.confianca], [9, null, 'baixa']);
  // 6. CNPJ not confirmed, no Apollo, site read, Pessoas "1500", analysis → 0 (precedence), not 9.
  assert.equal(comEstimativa(dig(undefined), pes('1500'), 'analise', { siteLido: true }).eixos.aderencia.porte.pontos, 0);
  // 7. "Demais", Apollo "200", Pessoas "1500", analysis → 18: Apollo prevails when it exists.
  l = comEstimativa(dig(200), pes('1500'), 'analise', demais);
  assert.deepEqual(l.eixos.aderencia.porte, { categoria: 'demais_ate_500', pontos: 18, fonteFuncionarios: 'apollo' });
});

test('cases (a) and (h) and the triagem ignoring Pessoas', () => {
  // (a) EPP or micro company with more than 1,000 employees → 0.
  assert.equal(comEstimativa(dig(1500), undefined, 'triagem', { cnpjConfirmado: true, porteLegal: 'EPP', sinalCrescimento: true }).eixos.aderencia.porte.pontos, 0);
  assert.equal(comEstimativa(dig('1001-5000'), undefined, 'triagem', { cnpjConfirmado: true, porteLegal: 'ME' }).eixos.aderencia.porte.pontos, 0);
  // (h) analysis, CNPJ not confirmed, no Apollo, Pessoas "800" → 6 (confirmed by spec 04 v0.14).
  const h = comEstimativa(dig(undefined), pes('800'), 'analise', { siteLido: true });
  assert.deepEqual(h.eixos.aderencia.porte, { categoria: 'de_501_a_1000', pontos: 6, fonteFuncionarios: 'pessoas' });
  // Triagem uses only Apollo, even when a Pessoas document exists.
  assert.deepEqual(estimativaFuncionarios(dig(null), pes('300'), 'triagem'), { funcionarios: null, fonteFuncionarios: null });
  // A failed Pessoas stage is not used.
  assert.deepEqual(estimativaFuncionarios(dig(null), { ...pes('300'), status: 'falhou' }, 'analise'), { funcionarios: null, fonteFuncionarios: null });
  // Documents from before the normalization: the raw Apollo number in insumosCodigo.
  assert.deepEqual(estimativaFuncionarios({ conteudo: { apollo: { funcionariosEstimados: '51-200' } }, insumosCodigo: { apolloFuncionarios: 120 } }, undefined, 'triagem'), { funcionarios: 120, fonteFuncionarios: 'apollo' });
});

test('head-count normalization (spec 02 v0.10): faixa, minimo, maximo', () => {
  assert.deepEqual(normalizaFuncionarios('300'), { faixa: '300', minimo: 300, maximo: 300 });
  assert.deepEqual(normalizaFuncionarios('51-200'), { faixa: '51-200', minimo: 51, maximo: 200 }); // (f)
  assert.deepEqual(normalizaFuncionarios('51 a 200'), { faixa: '51 a 200', minimo: 51, maximo: 200 });
  assert.deepEqual(normalizaFuncionarios('1.001–5.000'), { faixa: '1.001–5.000', minimo: 1001, maximo: 5000 });
  assert.deepEqual(normalizaFuncionarios('7.500'), { faixa: '7.500', minimo: 7500, maximo: 7500 });
  assert.deepEqual(normalizaFuncionarios(7500), { faixa: '7500', minimo: 7500, maximo: 7500 });
  // (g) unrecognized format: both null, the original faixa kept.
  for (const f of ['mais de 8 mil', '1,5 mil', '10001+', 'cerca de 200', '200-51']) assert.deepEqual(normalizaFuncionarios(f), { faixa: f, minimo: null, maximo: null }, f);
  assert.deepEqual(normalizaFuncionarios(null), { faixa: null, minimo: null, maximo: null });
  assert.deepEqual(normalizaFuncionarios(''), { faixa: null, minimo: null, maximo: null });
});

test('(e) site down: empty paginasLidas means no site read', () => {
  assert.equal(siteLido({ paginasLidas: [] }), false);
  assert.equal(siteLido({ paginasLidas: ['https://x.com.br/'] }), true);
  assert.equal(siteLido({ paginasLidas: [], insumosCodigo: { siteLido: true } }), false); // the field wins
  assert.equal(siteLido({ insumosCodigo: { siteLido: true } }), true); // documents from before the field
  // No site read, no Apollo, no confirmed CNPJ → no company identified.
  assert.equal(comEstimativa({ status: 'concluida', paginasLidas: [], conteudo: { apollo: null } }, undefined, 'triagem', { siteLido: false }).eixos.aderencia.porte.categoria, 'nenhuma_empresa');
});

test('next state and retention: spam discarded, Declinar brief reply, others to collection or kept qualified', () => {
  const declinar = gradua(base({ siteLido: false }));
  assert.equal(declinar.quadrante, 'declinar');
  assert.equal(proximoEstado(declinar, true), 'resposta_breve');
  assert.equal(guardaCurta(declinar), true);
  const spam = gradua(base({ spam: true, cnpjConfirmado: true, porteLegal: 'demais', funcionarios: 100, temMensagem: true, problemaOuFerramenta: 'problema' }));
  assert.equal(spam.quadrante, 'priorizar'); // quadrant and grade still computed
  assert.equal(proximoEstado(spam, true), 'descartada');
  assert.equal(guardaCurta(spam), true);
  assert.equal(prazoDaTriagem(spam, new Date()), null);
  const p = gradua(base({ cnpjConfirmado: true, porteLegal: 'demais', funcionarios: 100, temMensagem: true, problemaOuFerramenta: 'problema' }));
  assert.equal(proximoEstado(p, true), 'coletando');
  assert.equal(proximoEstado(p, false), 'qualificada');
  assert.equal(guardaCurta(p), false);
  assert.equal(prazoDaTriagem(p, new Date()), null); // "prazo após a análise"
  assert.equal(p.versaoPesos, '2');
});

test('business days: Easter, movable holidays (Carnival, Good Friday, Corpus Christi), fixed ones, weekends', () => {
  assert.equal(pascoa(2026).toISOString().slice(0, 10), '2026-04-05');
  assert.equal(pascoa(2027).toISOString().slice(0, 10), '2027-03-28');
  assert.deepEqual([...feriados(2026)].filter((d) => ['2026-02-16', '2026-02-17', '2026-04-03', '2026-06-04', '2026-11-20', '2026-11-02'].includes(d)).length, 6);
  assert.equal(diaUtil(new Date('2026-11-20T00:00:00Z')), false); // Friday, national holiday
  assert.equal(diaUtil(new Date('2026-11-21T00:00:00Z')), false); // Saturday
  assert.equal(diaUtil(new Date('2026-11-23T00:00:00Z')), true);
  // Received Thursday 19/11/2026 at 16:00 (São Paulo): 20/11 holiday, weekend → 2 business days end on Tuesday 24/11.
  const fim = prazoEmDiasUteis(new Date('2026-11-19T19:00:00Z'), 2);
  assert.equal(fim.toISOString(), '2026-11-25T02:59:59.000Z');
  // Received Friday 13/02/2026 at 22:30 (São Paulo, 01:30Z on the 14th): Carnival 16 and 17 → 5 days end on 24/02.
  assert.equal(prazoEmDiasUteis(new Date('2026-02-14T01:30:00Z'), 5).toISOString(), '2026-02-25T02:59:59.000Z');
  const declinar = gradua(base({ siteLido: false }));
  assert.equal(prazoDaTriagem(declinar, new Date('2026-11-19T19:00:00Z')).toISOString(), '2026-11-28T02:59:59.000Z'); // grade D: 5 business days, Friday 27/11
});

test('legal size from BrasilAPI text', () => {
  assert.equal(porteLegalDe('MICRO EMPRESA'), 'ME');
  assert.equal(porteLegalDe('EMPRESA DE PEQUENO PORTE'), 'EPP');
  assert.equal(porteLegalDe('DEMAIS'), 'demais');
  assert.equal(porteLegalDe(null), null);
});

test('triagem input from the stored documents: code facts, chosen CNPJ size, blocks confidence', () => {
  const ficha = {
    origem: { pagina: '/casos/elite-90-pro' },
    qualificacao: {
      decisao: 'prosseguir', nivelCargo: 'decisor', dominioCorporativo: true, temMensagem: true,
      estruturaTecnologia: { categoria: 'enxuta', evidencia: 'x' }, portaIndicada: { porta: 'projeto', sinais: ['a', 'b'] },
      classificacaoMensagem: { tipoContato: 'empresa', falaDeProblemaOuFerramenta: 'problema', gatilho: 'prazo de fim de ano' },
    },
  };
  const digital = { status: 'concluida', confianca: { grau: 'media' }, paginasLidas: ['https://x.com.br/'], conteudo: { vagasNoSite: { ha: 'true' }, apollo: { funcionariosEstimados: { faixa: '350', minimo: 350, maximo: 350 } } }, insumosCodigo: { apolloEncontrado: true, apolloFuncionarios: 350 } };
  const registro = { status: 'concluida', confianca: { grau: 'baixa' }, conteudo: { confirmado: true, escolhido: { cnpj: '11.222.333/0001-81', porteLegal: 'demais' } }, insumosCodigo: { registros: [{ cnpj: '11222333000181', porte: 'EMPRESA DE PEQUENO PORTE' }] } };
  const e = entradaTriagem(ficha, digital, registro);
  assert.equal(e.porteLegal, 'EPP'); // the stored BrasilAPI record wins over the model field
  assert.equal(e.funcionarios, 350);
  assert.equal(e.fonteFuncionarios, 'apollo');
  assert.equal(e.siteLido, true);
  assert.equal(e.sinalCrescimento, true);
  assert.equal(e.gatilho, true);
  assert.deepEqual(e.porta, { porta: 'projeto', sinais: 2 });
  assert.deepEqual(e.confiancaBlocos, { registro: 'baixa', digital: 'media', pessoas: null });
  const l = gradua(e);
  assert.equal(l.eixos.aderencia.porte.categoria, 'epp_com_crescimento');
  assert.equal(l.modificadores.confianca, 'media');
  assert.equal(entradaTriagem(ficha, { ...digital, conteudo: { vagasNoSite: { ha: true } } }, registro).sinalCrescimento, true);
  assert.equal(entradaTriagem(ficha, { ...digital, conteudo: { vagasNoSite: { ha: 'indeterminado' } } }, registro).sinalCrescimento, false);
  const falhou = entradaTriagem(ficha, { status: 'falhou' }, undefined);
  assert.equal(falhou.cnpjConfirmado, false);
  assert.deepEqual(falhou.confiancaBlocos, { registro: null, digital: 'baixa', pessoas: null });
});

test('(c) spam has no deadline; (d) a deadline across Carnival 2027; analysis deadline from the moment it is ready', () => {
  const spam = gradua(base({ spam: true, siteLido: false }));
  assert.equal(prazoDaTriagem(spam, new Date('2027-02-05T19:00:00Z')), null);
  assert.equal(prazoDaAnalise(spam, new Date('2027-02-05T19:00:00Z')), null);
  // Easter 2027 is 28/3: Carnival on Monday 8/2 and Tuesday 9/2.
  assert.ok(feriados(2027).has('2027-02-08') && feriados(2027).has('2027-02-09'));
  // Friday 5/2/2027 at 16:00 (São Paulo), 2 business days: the start day does not count, the weekend and
  // Carnival are skipped, so Wednesday 10/2 is day 1 and Thursday 11/2 is day 2 (ends 23:59:59 local).
  assert.equal(prazoEmDiasUteis(new Date('2027-02-05T19:00:00Z'), 2).toISOString(), '2027-02-12T02:59:59.000Z');
  const a = gradua(base({ momento: 'analise', cnpjConfirmado: true, porteLegal: 'demais', funcionarios: 100, nivelCargo: 'decisor', dominioCorporativo: true, cargoConfirmado: 'true', temMensagem: true, problemaOuFerramenta: 'problema', gatilho: true, paginaOrigem: '/servicos/conselho-de-ia', noticia: true, porta: { porta: 'conselho', sinais: 2 }, hipotese: true, direcao: true }));
  assert.equal(a.grau, 'A');
  assert.equal(prazoDaAnalise(a, new Date('2027-02-05T19:00:00Z')).toISOString(), '2027-02-12T02:59:59.000Z');
});
