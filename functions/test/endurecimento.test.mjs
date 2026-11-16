// Unit tests of phase 6 (hardening before production): stopped fichas, the São Paulo day of the daily ceiling,
// the origin IP from X-Forwarded-For and the calls without a price.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paradas } from '../lib/vigiar.js';
import { diaDeSaoPaulo, viradaDoDia } from '../lib/graduar.js';
import { ipDe } from '../lib/validacao.js';
import { semPreco, detalheSemPreco } from '../lib/uso.js';

const agora = new Date('2026-11-08T15:00:00Z');
const ha = (min) => new Date(agora.getTime() - min * 60_000);

test('paradas: only fichas in coleta_minima, coletando, coletada or sintetizando, past the deadline and without an error', () => {
  const fichas = [
    { id: 'm', estado: 'coleta_minima', estadoEm: ha(45), erro: null },
    { id: 'n', estado: 'coleta_minima', estadoEm: ha(10), erro: null },
    { id: 'o', estado: 'coleta_minima', estadoEm: ha(200), erro: { etapa: 'interrupcao:coleta_minima' } },
    { id: 'a', estado: 'coletando', estadoEm: ha(31), erro: null },
    { id: 'b', estado: 'sintetizando', estadoEm: ha(90), erro: null },
    { id: 'c', estado: 'sintetizando', estadoEm: ha(29), erro: null },
    { id: 'd', estado: 'coletando', estadoEm: ha(120), erro: { etapa: 'interrupcao:coletando' } },
    { id: 'e', estado: 'analise_pronta', estadoEm: ha(500), erro: null },
    { id: 'f', estado: 'coletada', estadoEm: ha(40), erro: null },
    { id: 'g', estado: 'coletada', estadoEm: ha(5), erro: null },
    { id: 'h', estado: 'coletada', estadoEm: ha(300), erro: { etapa: 'interrupcao:coletada' } },
  ];
  assert.deepEqual(paradas(fichas, agora, 30).map((f) => f.id), ['m', 'a', 'b', 'f']);
  assert.deepEqual(paradas(fichas, agora, 100).map((f) => f.id), []);
});

test('diaDeSaoPaulo: the day changes at 03:00 UTC', () => {
  assert.equal(diaDeSaoPaulo(new Date('2026-11-09T02:59:00Z')), '2026-11-08');
  assert.equal(diaDeSaoPaulo(new Date('2026-11-09T03:00:00Z')), '2026-11-09');
});

test('viradaDoDia: midnight in São Paulo that ends the day, when the daily ceiling resets', () => {
  assert.equal(viradaDoDia('2026-11-20').toDate().toISOString(), '2026-11-21T03:00:00.000Z');
  assert.equal(viradaDoDia('2026-12-31').toDate().toISOString(), '2027-01-01T03:00:00.000Z');
  assert.equal(diaDeSaoPaulo(viradaDoDia('2026-11-20').toDate()), '2026-11-21');
});

test('ipDe: the last X-Forwarded-For entry, the one appended by the Google front end; req.ip without the header', () => {
  assert.equal(ipDe('1.1.1.1, 203.0.113.9', '10.0.0.1'), '203.0.113.9');
  assert.equal(ipDe('203.0.113.9', '10.0.0.1'), '203.0.113.9');
  assert.equal(ipDe('forjado, 198.51.100.7 ', undefined), '198.51.100.7');
  assert.equal(ipDe(undefined, '10.0.0.1'), '10.0.0.1');
  assert.equal(ipDe(' , ', '10.0.0.1'), '10.0.0.1');
});

test('semPreco: calls with usdEstimado null become custo_sem_preco warnings; simulated calls do not', () => {
  const avisos = semPreco([
    ['montar', { modelo: 'claude-novo', usdEstimado: null }],
    ['conversa', { modelo: 'claude-sonnet-5-5', usdEstimado: 0.12 }],
    ['revisor', { modelo: 'simulado', usdEstimado: null }],
    ['reparar.s1', { modelo: 'claude-haiku-9', usdEstimado: null }],
  ]);
  assert.deepEqual(avisos, ['custo_sem_preco: montar (claude-novo)', 'custo_sem_preco: reparar.s1 (claude-haiku-9)']);
});

test('detalheSemPreco: event detail only for a priced-out real model, never for a priced call or the simulated model', () => {
  assert.deepEqual(detalheSemPreco('qualificar', 'claude-novo', null), { chamada: 'qualificar', modelo: 'claude-novo' });
  assert.deepEqual(detalheSemPreco('setor', 'claude-haiku-9', null), { chamada: 'setor', modelo: 'claude-haiku-9' });
  assert.equal(detalheSemPreco('qualificar', 'claude-sonnet-5-5', 0.12), null);
  assert.equal(detalheSemPreco('qualificar', 'claude-sonnet-5-5', 0), null);
  assert.equal(detalheSemPreco('mercado', 'simulado', null), null);
  assert.equal(detalheSemPreco('mercado', '', null), null);
  assert.equal(detalheSemPreco('mercado', undefined, null), null);
});
