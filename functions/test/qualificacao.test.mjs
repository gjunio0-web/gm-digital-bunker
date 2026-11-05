// qualificar rules (spec 02, section 1): signals, when the model is called, and the decision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, ehProvedorGratuito, precisaModelo, sinais, validaClassificacao, ESQUEMA_CLASSIFICACAO, promptQualificacao } from '../lib/qualificacao.js';
import { custoDe } from '../lib/custo.js';

const ficha = (o = {}, site = null) => {
  const original = { nome: 'Ana', empresa: 'ACME', cargo: 'ceo', email: 'ana@acme.com.br', site, mensagem: null, lang: 'pt-BR', ...o };
  return { original, normalizado: { email: original.email.toLowerCase(), site: site ? `https://${site}` : null } };
};
const classe = (tipoContato) => ({
  tipoContato, pedido: null, dor: null, ferramentasCitadas: [], gatilho: null,
  falaDeProblemaOuFerramenta: 'nenhum', idiomaMensagem: 'pt', observacao: null,
});

test('free providers, including Brazilian suffixes; corporate domains are not', () => {
  for (const d of ['gmail.com', 'hotmail.com.br', 'outlook.com', 'yahoo.com.br', 'uol.com.br', 'bol.com.br', 'terra.com.br', 'ig.com.br', 'icloud.com', 'proton.me']) {
    assert.equal(ehProvedorGratuito(d), true, d);
  }
  for (const d of ['acme.com.br', 'gmdigitalbunker.com.br', 'terra.agr.br', 'mail.acme.com']) assert.equal(ehProvedorGratuito(d), false, d);
});

test('corporate e-mail with message: model called, analisar', () => {
  const { original, normalizado } = ficha({ mensagem: 'Queremos sair das planilhas.' });
  const s = sinais(original, normalizado);
  assert.deepEqual(s, { dominioCorporativo: true, cargoDecisor: true, temMensagem: true, siteInformado: false, siteResolvido: 'https://acme.com.br' });
  assert.equal(precisaModelo(original, s), true);
  assert.equal(decide(s, classe('empresa')).decisao, 'analisar');
});

test('free e-mail without message: no model, responder_breve', () => {
  const { original, normalizado } = ficha({ email: 'ana@gmail.com', cargo: 'manager' });
  const s = sinais(original, normalizado);
  assert.equal(s.dominioCorporativo, false);
  assert.equal(s.cargoDecisor, false);
  assert.equal(s.siteResolvido, null);
  assert.equal(precisaModelo(original, s), false);
  assert.deepEqual(decide(s, null), { decisao: 'responder_breve', motivo: 'e-mail gratuito sem mensagem' });
});

test('spam: descartar', () => {
  const { original, normalizado } = ficha({ mensagem: 'Compre seguidores' });
  assert.deepEqual(decide(sinais(original, normalizado), classe('spam')), { decisao: 'descartar', motivo: 'tipoContato = spam' });
});

test('role "other" without message: model called', () => {
  const { original, normalizado } = ficha({ cargo: 'other' });
  const s = sinais(original, normalizado);
  assert.equal(s.temMensagem, false);
  assert.equal(precisaModelo(original, s), true);
  assert.equal(decide(s, classe('indeterminado')).decisao, 'analisar');
});

test('student: responder_breve', () => {
  const { original, normalizado } = ficha({ mensagem: 'Sou estudante e faço um TCC.' });
  assert.deepEqual(decide(sinais(original, normalizado), classe('estudante')), { decisao: 'responder_breve', motivo: 'tipoContato = estudante' });
});

test('informed site wins over the e-mail domain; whitespace-only message counts as none', () => {
  const { original, normalizado } = ficha({ mensagem: '   ' }, 'outra.com.br');
  const s = sinais(original, normalizado);
  assert.equal(s.siteInformado, true);
  assert.equal(s.siteResolvido, 'https://outra.com.br');
  assert.equal(s.temMensagem, false);
});

test('output check rejects values outside the schema; schema objects are closed', () => {
  assert.throws(() => validaClassificacao({ ...classe('cliente') }));
  assert.throws(() => validaClassificacao({ ...classe('empresa'), ferramentasCitadas: [1] }));
  assert.deepEqual(validaClassificacao(classe('empresa')), classe('empresa'));
  assert.equal(ESQUEMA_CLASSIFICACAO.additionalProperties, false);
  assert.equal(ESQUEMA_CLASSIFICACAO.required.length, 8);
});

test('prompt sends only the e-mail domain', () => {
  const { original, normalizado } = ficha({ mensagem: 'Oi' });
  const p = promptQualificacao(original, normalizado, 'CEO ou presidente');
  assert.match(p, /<ficha>[\s\S]*acme\.com\.br[\s\S]*<\/ficha>/);
  assert.doesNotMatch(p, /ana@/);
});

test('cost: Haiku 5.5 prices; unknown model gives null', () => {
  const c = custoDe('claude-haiku-5-5', { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500 });
  assert.deepEqual(c, { tokensEntrada: 1500, tokensSaida: 200, buscas: 0, usdEstimado: 0.000205 });
  assert.equal(custoDe('outro', { input_tokens: 1, output_tokens: 1 }).usdEstimado, null);
});
