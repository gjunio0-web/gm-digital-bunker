// qualificar rules (spec 02, section 1; spec 04): signals of the coleta mínima and of qualificar, the
// output schema with estruturaTecnologia and portaIndicada, and the decision descartar or prosseguir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decide, ehProvedorGratuito, sinais, sinaisIniciais, validaClassificacao, ESQUEMA_CLASSIFICACAO, NIVEL_CARGO, promptQualificacao,
} from '../lib/qualificacao.js';
import { custoDe } from '../lib/custo.js';
import { PRECOS_INICIAIS as T } from '../lib/precosIniciais.js';

const ficha = (o = {}, site = null) => {
  const original = { nome: 'Ana', empresa: 'ACME', cargo: 'ceo', email: 'ana@acme.com.br', site, mensagem: null, lang: 'pt-BR', ...o };
  return { original, normalizado: { email: original.email.toLowerCase(), site: site ? `https://${site}` : null } };
};
const classe = (tipoContato, extra = {}) => ({
  tipoContato, pedido: null, dor: null, ferramentasCitadas: [], gatilho: null,
  falaDeProblemaOuFerramenta: 'nenhum', idiomaMensagem: 'pt', observacao: null,
  estruturaTecnologia: { categoria: 'sem_sinal', evidencia: 'nenhum sinal no site' },
  portaIndicada: { porta: 'indeterminada', sinais: [] },
  ...extra,
});

test('free providers, including Brazilian suffixes; corporate domains are not', () => {
  for (const d of ['gmail.com', 'hotmail.com.br', 'outlook.com', 'yahoo.com.br', 'uol.com.br', 'bol.com.br', 'terra.com.br', 'ig.com.br', 'icloud.com', 'proton.me']) {
    assert.equal(ehProvedorGratuito(d), true, d);
  }
  for (const d of ['acme.com.br', 'gmdigitalbunker.com.br', 'terra.agr.br', 'mail.acme.com']) assert.equal(ehProvedorGratuito(d), false, d);
});

test('coleta mínima signals: corporate domain resolves the site; informed site wins; free e-mail without site gives none', () => {
  assert.deepEqual(sinaisIniciais(ficha().normalizado), { dominioCorporativo: true, siteResolvido: 'https://acme.com.br' });
  assert.deepEqual(sinaisIniciais(ficha({}, 'outra.com.br').normalizado), { dominioCorporativo: true, siteResolvido: 'https://outra.com.br' });
  assert.deepEqual(sinaisIniciais(ficha({ email: 'ana@gmail.com' }).normalizado), { dominioCorporativo: false, siteResolvido: null });
});

test('role level (spec 04, Decisão axis): decisor, intermediario, outro; cargoDecisor derived', () => {
  assert.deepEqual(NIVEL_CARGO, { owner: 'decisor', ceo: 'decisor', director: 'decisor', manager: 'intermediario', specialist: 'outro', external: 'outro', other: 'outro' });
  const { original, normalizado } = ficha({ cargo: 'manager', mensagem: '   ' }, 'outra.com.br');
  assert.deepEqual(sinais(original, normalizado), { nivelCargo: 'intermediario', cargoDecisor: false, temMensagem: false, siteInformado: true });
  assert.equal(sinais(ficha({ cargo: 'director' }).original, ficha().normalizado).cargoDecisor, true);
});

test('decision: only spam is discarded; person, student and supplier go on to the triagem', () => {
  assert.deepEqual(decide(classe('spam')), { decisao: 'descartar', motivo: 'tipoContato = spam' });
  for (const t of ['empresa', 'pessoa_fisica', 'estudante', 'fornecedor', 'indeterminado']) assert.equal(decide(classe(t)).decisao, 'prosseguir', t);
});

test('output check: the two new fields are required and closed; values outside the schema are rejected', () => {
  assert.deepEqual(validaClassificacao(classe('empresa')), classe('empresa'));
  assert.throws(() => validaClassificacao({ ...classe('empresa'), estruturaTecnologia: { categoria: 'grande', evidencia: 'x' } }));
  assert.throws(() => validaClassificacao({ ...classe('empresa'), portaIndicada: { porta: 'projeto', sinais: [1] } }));
  assert.throws(() => validaClassificacao({ ...classe('cliente') }));
  const { portaIndicada, ...semPorta } = classe('empresa');
  assert.throws(() => validaClassificacao(semPorta));
  assert.equal(ESQUEMA_CLASSIFICACAO.additionalProperties, false);
  assert.equal(ESQUEMA_CLASSIFICACAO.required.length, 10);
  assert.equal(ESQUEMA_CLASSIFICACAO.properties.estruturaTecnologia.additionalProperties, false);
  assert.deepEqual(ESQUEMA_CLASSIFICACAO.properties.portaIndicada.properties.porta.enum, ['projeto', 'conselho', 'workshop', 'combinacao', 'indeterminada']);
});

test('prompt: only the e-mail domain, the origin page and the two coleta mínima blocks', () => {
  const { original, normalizado } = ficha({ mensagem: 'Oi' });
  const p = promptQualificacao(original, normalizado, 'CEO ou presidente', '/servicos/conselho-de-ia', { oQueVende: 'parafusos' }, { confirmado: false });
  assert.match(p, /<ficha>[\s\S]*acme\.com\.br[\s\S]*página de origem: \/servicos\/conselho-de-ia[\s\S]*<\/ficha>/);
  assert.match(p, /<coleta etapa="empresa_digital">[\s\S]*parafusos[\s\S]*<\/coleta>/);
  assert.match(p, /<coleta etapa="empresa_registro">[\s\S]*"confirmado": false[\s\S]*<\/coleta>/);
  assert.doesNotMatch(p, /ana@/);
});

test('cost: Haiku 5.5 prices; unknown model gives null', () => {
  const c = custoDe(T, 'claude-haiku-5-5', { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500 });
  assert.deepEqual(c, { tokensEntrada: 1000, cacheLidos: 500, cacheEscritos: 0, tokensSaida: 200, buscas: 0, usdEstimado: 0.000205, usdSemCache: 0.00025, versaoPrecos: '1' });
  // Without config/precos the cost is null, never a constant in code.
  assert.equal(custoDe(null, 'claude-haiku-5-5', { input_tokens: 1, output_tokens: 1 }).usdEstimado, null);
  assert.equal(custoDe(T, 'outro', { input_tokens: 1, output_tokens: 1 }).usdEstimado, null);
  // Haiku tier above 100,000 prompt tokens (input + cache writes + cache reads), the whole request at the
  // higher rate; summed responses priced one by one; Sonnet single tier.
  assert.equal(custoDe(T, 'claude-haiku-5-5', { input_tokens: 100_000, output_tokens: 1000 }).usdEstimado, 0.0105);
  assert.equal(custoDe(T, 'claude-haiku-5-5', { input_tokens: 90_000, cache_read_input_tokens: 20_000, output_tokens: 1000 }).usdEstimado, 0.0485);
  const partes = [{ input_tokens: 100_000, output_tokens: 1000 }, { input_tokens: 110_000, output_tokens: 1000 }];
  assert.equal(custoDe(T, 'claude-haiku-5-5', { input_tokens: 210_000, output_tokens: 2000, partes }).usdEstimado, 0.0105 + 0.0575);
  assert.equal(custoDe(T, 'claude-sonnet-5-5', { input_tokens: 150_000, output_tokens: 1000 }).usdEstimado, 0.31);
});
