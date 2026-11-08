// Phase 3 – closed schema in enquadrar and the draft (spec 02 v0.12, 3.1 to 3.3; spec 04 v0.15): origin of
// items and risks, confidence of the direction, validation in code, recalculated scope, prompts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ESQUEMA_ENQUADRAR, INSTRUCAO_CONVERSA, INSTRUCAO_ENQUADRAR, enquadramentoDoModelo, enquadramentoGravado, instrucaoMontar, listaDeGraus,
  normalizaEnquadramento, resultadoDoEscopo, simulaEnquadrar, validaEnquadrar,
} from '../lib/sintese.js';
import { SISTEMA_BASE } from '../lib/claude.js';
import { nomesDosGraus } from '../lib/metodoRegras.js';
import { avisosDoEnquadramento } from '../lib/verificacao.js';
import { avaliaReparo, camposDaEtapa, jsonDaEtapa } from '../lib/reparo.js';
import { coletaDe } from '../lib/sintese.js';

const item = (classificacao, origem, grauExecucao = 'A4') => ({ pedidoOuDor: `${classificacao}/${origem}`, origem, evidencias: [], classificacao, itemDoEscopo: 'x', grauExecucao, grauAssessoria: 'A4' });
const enq = (itens, resultado = 'aprovado') => ({ ...simulaEnquadrar(), escopo: { resultado, itensAvaliados: itens } });

test('schema: items and risks with origin and evidence, direction with confidence; the check requires them', () => {
  const p = ESQUEMA_ENQUADRAR.properties;
  assert.deepEqual(p.escopo.properties.itensAvaliados.items.properties.origem.enum, ['ficha', 'hipotese', 'coleta']);
  assert.deepEqual(p.riscosDoLead.items.properties.origem.enum, ['ficha', 'coleta']);
  assert.ok(p.riscosDoLead.items.required.includes('evidencias'));
  assert.deepEqual(p.leituraDoPotencial.properties.confianca.enum, ['alta', 'media', 'baixa']);
  assert.ok(validaEnquadrar(simulaEnquadrar()));
  assert.throws(() => validaEnquadrar({ ...simulaEnquadrar(), leituraDoPotencial: { direcao: 'crescer', comoOrientaAPorta: 'x' } }), /enquadrar/);
  assert.throws(() => validaEnquadrar(enq([{ ...item('faz', 'ficha'), origem: undefined }])), /enquadrar/);
  assert.throws(() => validaEnquadrar({ ...simulaEnquadrar(), riscosDoLead: [{ risco: 'outro', origem: 'hipotese', sinal: 's', evidencias: [] }] }), /enquadrar/);
});

test('scope result recalculated from the ficha items only (spec 04 v0.15, decision 11)', () => {
  assert.equal(resultadoDoEscopo([item('faz', 'ficha')]), 'aprovado');
  assert.equal(resultadoDoEscopo([item('faz', 'ficha'), item('orienta', 'ficha')]), 'ressalva');
  assert.equal(resultadoDoEscopo([item('faz', 'ficha', 'A2')]), 'ressalva');
  assert.equal(resultadoDoEscopo([item('faz', 'ficha'), item('nao_faz', 'ficha')]), 'barrado');
  // Items from a hypothesis or the collection do not enter the result (GAT v3 of Phase B).
  assert.equal(resultadoDoEscopo([item('faz', 'ficha'), item('orienta', 'hipotese'), item('faz', 'coleta', 'A1')]), 'aprovado');
});

test('validation in code: nao_faz outside the ficha removed, declared result kept, warnings for verificar', () => {
  const e = normalizaEnquadramento(validaEnquadrar(enq([item('faz', 'ficha'), item('nao_faz', 'hipotese'), item('orienta', 'coleta')], 'ressalva')));
  assert.equal(e.escopo.resultado, 'aprovado');
  assert.equal(e.escopo.resultadoDeclarado, 'ressalva');
  assert.deepEqual(e.escopo.itensAvaliados.map((i) => i.pedidoOuDor), ['faz/ficha', 'orienta/coleta']);
  assert.deepEqual(e.escopo.itensRemovidos.map((i) => i.pedidoOuDor), ['nao_faz/hipotese']);
  assert.deepEqual(avisosDoEnquadramento(e), ['item_removido_por_origem: hipotese – nao_faz/hipotese']);
  // The reduced copy carries the recalculated result and every risk; the prompts see the model's schema only.
  const g = enquadramentoGravado({ ...e, riscosDoLead: [{ risco: 'outro', origem: 'coleta', sinal: 's', evidencias: [] }] });
  assert.equal(g.escopo, 'aprovado');
  assert.deepEqual(g.riscos, ['outro']);
  assert.equal(g.detalhe.escopo.resultadoDeclarado, 'ressalva');
  const m = enquadramentoDoModelo(e);
  assert.ok(!('resultadoDeclarado' in m.escopo) && !('itensRemovidos' in m.escopo));
});

test('repair of enquadrar keeps the recalculated result, the declared one and the removed items', () => {
  const e = normalizaEnquadramento(validaEnquadrar(enq([item('faz', 'ficha'), item('nao_faz', 'hipotese')], 'ressalva')));
  const v = { secoes: {}, resumoExecutivo: '', rascunhoResposta: { assunto: '', corpo: '' }, conversa: { perguntas: [], materiais: [], pontosDeAtencao: [] }, enquadramento: enquadramentoGravado(e) };
  const antes = jsonDaEtapa('enquadrar', v);
  assert.ok(!('resultadoDeclarado' in antes.escopo));
  const r = avaliaReparo('enquadrar', antes, structuredClone(antes), [], 0.02);
  assert.equal(r.aceito, true, r.motivo);
  const campos = camposDaEtapa('enquadrar', r.saida, v, coletaDe({}));
  assert.equal(campos.enquadramento.escopo, 'aprovado');
  assert.equal(campos.enquadramento.detalhe.escopo.resultadoDeclarado, 'ressalva');
  assert.equal(campos.enquadramento.detalhe.escopo.itensRemovidos.length, 1);
  // A changed origin is a changed choice: rejected.
  const outra = structuredClone(antes);
  outra.escopo.itensAvaliados[0].origem = 'coleta';
  assert.equal(avaliaReparo('enquadrar', antes, outra, [], 0.02).aceito, false);
});

test('prompts: SISTEMA_BASE rule 8, enquadrar origin rules, draft markers, grade names from the method', () => {
  assert.match(SISTEMA_BASE, /\(8\) sobre a GM Digital Bunker™, seus serviços, limites e casos, afirme apenas o que consta de escopo-limites\.md e portas-materiais\.md/);
  assert.match(INSTRUCAO_ENQUADRAR, /O risco `outro` exige `sinal` com fonte e não é pontuado\./);
  assert.match(INSTRUCAO_CONVERSA, /saudação com o primeiro nome do signatário \("Olá, Nome,"\)/);
  assert.match(INSTRUCAO_CONVERSA, /`\[opção de horário 1\]` e `\[opção de horário 2\]`, nunca com dia ou hora concretos/);
  assert.match(INSTRUCAO_CONVERSA, /seguindo as regras de portas-materiais\.md seção 5/);
  assert.match(INSTRUCAO_CONVERSA, /'limite 4 – execução técnica em software de terceiros'/);
  const escopo = readFileSync(new URL('../../metodo/escopo-limites.md', import.meta.url), 'utf8');
  const graus = listaDeGraus(nomesDosGraus(escopo));
  assert.equal(graus, 'A0 (fora), A1 (marginal), A2 (parcial), A3 (alta), A4 (núcleo)');
  const m = instrucaoMontar(graus);
  assert.match(m, /na forma "A3 \(alta\)"; os nomes são: A0 \(fora\), A1 \(marginal\), A2 \(parcial\), A3 \(alta\), A4 \(núcleo\)\./);
  assert.match(m, /termina com a marca `\[M:arquivo:seção\]` \(por exemplo `\[M:escopo-limites:1\]`\)/);
});
