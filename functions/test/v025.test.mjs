// Spec 02 v0.25 (13/11/2026): the correction also adjusts the passages that repeat a corrected point and gets the
// draft rules in <regras-rascunho>; the draft avoids the analysis' internal terms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUCAO_CONVERSA, REGRAS_RASCUNHO } from '../lib/sintese.js';
import { INSTRUCAO_CORRIGIR, mensagemCorrigir } from '../lib/correcao.js';

test('preparar_conversa: no internal terms in the draft (spec 02 v0.25, 3.2)', () => {
  assert.ok(INSTRUCAO_CONVERSA.includes('Quadrante, grau, pontos, porte numérico e preço nunca aparecem, nem os termos internos da análise – porta, porta provável, destino, aderência, lente e eixo crítico; fale do caminho de trabalho pelo nome do serviço ("o Conselho de IA pode ser o caminho, a confirmar na conversa").'));
});

test('draft rules: from "Rascunho da resposta" to the end of the preparar_conversa instruction (spec 02 v0.25, 4.3)', () => {
  assert.ok(REGRAS_RASCUNHO.startsWith('Rascunho da resposta, seguindo as regras de portas-materiais.md seção 5'));
  assert.ok(INSTRUCAO_CONVERSA.endsWith(REGRAS_RASCUNHO));
  assert.ok(!REGRAS_RASCUNHO.includes('Perguntas: de três a cinco'));
});

test('correction: the exception for repeated passages, and the draft rules in their own block (spec 02 v0.25, 4.3)', () => {
  assert.ok(INSTRUCAO_CORRIGIR.includes('Não altere trechos sem pendência, com uma exceção: quando a correção de um trecho mudar um fato, uma classificação, uma hipótese ou uma recomendação que também apareça em `conversa.pontosDeAtencao`, no `rascunhoResposta`, no `resumoExecutivo` ou na linha correspondente da s1, ajuste também a passagem correspondente desses blocos, para que a análise não se contradiga, e mais nada; no rascunho, siga as regras do rascunho em `<regras-rascunho>`. Devolva a análise completa e a lista de tratamentos.'));
  const [m] = mensagemCorrigir({ analise: {}, enquadramento: {} }, '<fontes-disponiveis>\n</fontes-disponiveis>', [{ tipo: 'tom', secao: 'rascunho', trecho: 'x', correcaoSugerida: 'y' }]);
  assert.ok(m.texto.includes(`<regras-rascunho>\n${REGRAS_RASCUNHO}\n</regras-rascunho>`));
  // The rules come before the instruction that cites them.
  assert.ok(m.texto.indexOf('<regras-rascunho>') < m.texto.indexOf(INSTRUCAO_CORRIGIR));
});
