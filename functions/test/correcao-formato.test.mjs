// Unit tests of the correction without a strict schema (phase B2): the JSON read from the text, and the
// schema carried in the prompt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extraiJson } from '../lib/claude.js';
import { ESQUEMA_CORRIGIR, mensagemCorrigir } from '../lib/correcao.js';

test('extraiJson: plain object, inside a code fence or with text around it', () => {
  assert.deepEqual(extraiJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extraiJson('```json\n{"a":{"b":[1,2]}}\n```'), { a: { b: [1, 2] } });
  assert.deepEqual(extraiJson('Segue:\n{"a":"x}"}\nFim.'), { a: 'x}' });
});

test('extraiJson: no object or a broken one throws', () => {
  assert.throws(() => extraiJson('sem json'));
  assert.throws(() => extraiJson('{"a":1'));
  assert.throws(() => extraiJson('{"a":1,}'));
});

test('mensagemCorrigir: the schema goes in the text, with the instruction to answer only with JSON', () => {
  const [m] = mensagemCorrigir({ s1: {} }, '<fontes-disponiveis>\n</fontes-disponiveis>', []);
  assert.ok(m.texto.includes('Responda somente com um objeto JSON'));
  assert.ok(m.texto.includes(JSON.stringify(ESQUEMA_CORRIGIR)));
  assert.ok(!m.texto.includes('Responda no esquema.'));
});
