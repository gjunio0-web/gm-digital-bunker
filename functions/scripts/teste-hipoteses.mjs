// Offline tests of the hypotheses raised by round R1g (11/11/2026), on the texts already stored, with no model
// call and no write. Four tests:
//  1. numero_sem_fonte with two candidate exceptions – list numbering "(n)" and inference labels with a comment
//     ("[inferência, …]") – applied to the section bodies of every B2 version: what stops being flagged, sentence
//     by sentence, for review.
//  2. A candidate filter of reviewer issues whose own suggestion says there is nothing to fix ("sem pendência",
//     "manter"): every issue it would drop, with its text, and the borderline ones it would keep.
//  3. Final state of each correction pair (vN → vN+1) recomputed under each change alone and all together.
//     Simplification: the correction text is taken as it is; with fewer issues sent, the real correction could
//     write something else.
//  4. Occurrences of "(n)" numbering in the section bodies per round and design (link with the fixed labels).
// The method files come from ../metodo (the version in the repository). The output carries analysis excerpts of
// the test fichas; it is for the administrator only and is not committed.
// Usage: node scripts/teste-hipoteses.mjs <project id> <output.md>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { FICHAS_B2, ROTULO_RODADA, desenhoDe, rodadaDe } from './b2-rodadas.mjs';
import { numerosSemFonte } from '../lib/verificacao.js';

const [projeto, saida] = process.argv.slice(2);
if (!projeto || !saida) {
  console.error('Usage: node scripts/teste-hipoteses.mjs <project id> <output.md>');
  process.exit(1);
}

// --- Candidate changes (not in the pipeline) ----------------------------------------------------------------
const dirMetodo = new URL('../../metodo/', import.meta.url);
const arquivos = Object.fromEntries(readdirSync(dirMetodo).filter((n) => n.endsWith('.md')).map((n) => [n, readFileSync(new URL(n, dirMetodo), 'utf8')]));
// "(1)" at the start of a line, or after a full stop, colon or semicolon, or after a bold label, followed by a
// space; "(12) vezes" in the middle of a sentence is not numbering.
const NUMERACAO = /(^|[.:;]\s+|\*\*\s+)\(\d{1,2}\)(?=\s)/gm;
const ROTULO_COM_COMENTARIO = /\[inferência,[^\]\n]*\]/gi;
const atual = (t) => numerosSemFonte(t, arquivos);
const proposta = (t) => numerosSemFonte(t.replace(NUMERACAO, '$1 ').replace(ROTULO_COM_COMENTARIO, '[inferência]'), arquivos);
const SEM_PENDENCIA = /^\s*(?:sem\s+(?:pend[êe]ncia|problema|promessa|ressalva)|manter\b|nada a corrigir|n[ãa]o h[áa] pend[êe]ncia)/i;
const mencionaSemPendencia = /sem\s+pend[êe]ncia|manter\b|nada a corrigir/i;

// --- Reading -------------------------------------------------------------------------------------------------
initializeApp({ projectId: projeto });
const db = getFirestore();
db.settings({ preferRest: true });
const corpos = (v) => Object.entries(v.secoes ?? {}).filter(([k, s]) => /^s[1-7]$/.test(k) && !s?.vazia).map(([k, s]) => [k, s.corpo ?? '']);
const curto = (t, n = 300) => String(t ?? '–').replace(/\s+/g, ' ').slice(0, n);

const T1 = [], T2drop = [], T2borda = [], T3 = [], T4 = {};
let nVersoes = 0, falhasAtual = 0, falhasProposta = 0, novasNaProposta = 0;

for (const id of FICHAS_B2) {
  const ref = db.collection('fichas').doc(id);
  const f = await ref.get();
  if (!f.exists) continue;
  const empresa = f.get('original.empresa');
  const versoes = (await ref.collection('analise').get()).docs.map((d) => {
    const x = d.data();
    return { id: d.id, n: Number(d.id.slice(1)), ...x, origem: x.autor?.origem ?? null, criadaEm: x.criadaEm?.toDate?.().toISOString() ?? null };
  }).sort((a, b) => a.n - b.n);
  const deIa = versoes.filter((v) => v.autor?.tipo !== 'humano');
  for (const v of deIa) {
    const base = v.origem === 'correcao' ? versoes.find((x) => x.id === v.baseadaEm) : v;
    const rodada = rodadaDe(id, base, versoes);
    if (!rodada || ['diagnostico', 'anterior'].includes(rodada)) continue;
    const desenho = desenhoDe(base?.uso?.montar_analise?.modelo);
    nVersoes++;
    // Test 1.
    for (const [s, t] of corpos(v)) {
      const a = atual(t), p = proposta(t);
      falhasAtual += a.length; falhasProposta += p.length;
      novasNaProposta += p.filter((x) => !a.some((y) => y.includes(x.trim().slice(0, 40)))).length;
      const sairam = a.filter((x) => !p.some((y) => y.trim().slice(0, 40) === x.trim().slice(0, 40)));
      for (const x of sairam) T1.push(`| ${empresa} | ${ROTULO_RODADA[rodada] ?? rodada} | ${desenho} | ${v.id} | ${s} | ${curto(x, 260).replace(/\|/g, '/')} |`);
      // Test 4.
      const k = `${rodada}|${desenho}`;
      T4[k] ??= { versoes: new Set(), ocorrencias: 0 };
      T4[k].versoes.add(v.id);
      T4[k].ocorrencias += (t.match(NUMERACAO) ?? []).length;
    }
    // Test 2: reviewer issues are stored in the version the reviewer read (not a correction version).
    if (v.origem !== 'correcao') {
      for (const p of (v.verificacao?.pendencias ?? []).filter((x) => x.tipo !== 'mecanica')) {
        const linha = `| ${empresa} | ${ROTULO_RODADA[rodada] ?? rodada} | ${desenho} | ${v.id} | ${p.tipo} | ${p.secao} | ${curto(p.correcaoSugerida, 220).replace(/\|/g, '/')} |`;
        if (SEM_PENDENCIA.test(p.correcaoSugerida ?? '')) T2drop.push(linha);
        else if (mencionaSemPendencia.test(p.correcaoSugerida ?? '')) T2borda.push(linha);
      }
    }
    // Test 3: correction pairs.
    if (v.origem === 'correcao' && base) {
      const pend = v.correcao?.pendencias ?? [];
      const trat = v.correcao?.tratamentos ?? [];
      const mantidas = pend.map((p, i) => ({ ...p, t: trat.find((x) => x.indice === i)?.tratamento ?? 'mantida' })).filter((p) => p.t !== 'corrigida');
      const mecV = (v.verificacao?.pendencias ?? []).filter((x) => x.tipo === 'mecanica');
      const nsfAtual = corpos(v).reduce((t, [, c]) => t + atual(c).length, 0);
      const nsfProp = corpos(v).reduce((t, [, c]) => t + proposta(c).length, 0);
      const outrasMec = mecV.filter((x) => x.regra !== 'numero_sem_fonte').length;
      const nsfGravado = mecV.length - outrasMec;
      const estado = (cfg) => {
        const mec = outrasMec + (cfg.N ? nsfProp : nsfGravado);
        const kept = mantidas.filter((p) => !(cfg.F && SEM_PENDENCIA.test(p.correcaoSugerida ?? '')) && !(cfg.E && p.secao === 'enquadramento'));
        return mec === 0 && kept.length === 0 ? 'pronta' : 'pendências';
      };
      T3.push({
        linha: [empresa, ROTULO_RODADA[rodada] ?? rodada, desenho, `${base.id} → ${v.id}`, v.verificacao?.status ?? '–', estado({}), estado({ N: 1 }), estado({ F: 1 }), estado({ E: 1 }), estado({ N: 1, F: 1, E: 1 })],
        nsf: `${nsfGravado}/${nsfAtual}`,
        rodada,
        desenho,
      });
    }
  }
}

// --- Report ----------------------------------------------------------------------------------------------------
const L = ['# Testes das hipóteses da R1g', '', `Gerado em ${new Date().toISOString()} a partir de ${projeto}. Uso interno. Nenhuma chamada a modelo; nenhuma gravação.`, ''];
L.push(`Versões lidas: ${nVersoes} (todas as rodadas da Fase B2, menos o diagnóstico). Arquivos do método: pasta metodo/ do repositório.`, '');
L.push('## Teste 1 – números sem fonte com as duas exceções candidatas', '');
L.push(`- Frases apontadas pela regra atual: ${falhasAtual}; com as exceções: ${falhasProposta}; frases novas que só a proposta apontaria: ${novasNaProposta}.`);
L.push(`- Frases que deixariam de ser apontadas: ${T1.length}. Cada uma precisa ser lida: se alguma tiver número real sem lastro, a exceção está larga demais.`, '');
L.push('| Ficha | Rodada | Desenho | Versão | Seção | Frase |', '|---|---|---|---|---|---|', ...T1, '');
L.push('## Teste 2 – filtro das pendências do revisor que dizem não haver o que corrigir', '');
L.push(`- Padrão: sugestão que começa com "sem pendência", "sem problema", "sem promessa", "sem ressalva", "manter", "nada a corrigir" ou "não há pendência".`);
L.push(`- Pendências que o filtro descartaria: ${T2drop.length}; pendências que mencionam "sem pendência" ou "manter" no meio e o filtro manteria: ${T2borda.length}.`, '');
L.push('### Descartadas pelo filtro', '', '| Ficha | Rodada | Desenho | Versão | Tipo | Seção | Sugestão do revisor |', '|---|---|---|---|---|---|---|', ...T2drop, '');
L.push('### Mantidas pelo filtro, com a expressão no meio do texto', '', '| Ficha | Rodada | Desenho | Versão | Tipo | Seção | Sugestão do revisor |', '|---|---|---|---|---|---|---|', ...T2borda, '');
L.push('## Teste 3 – estado final de cada par de correção', '');
L.push('N = exceções do teste 1; F = filtro do teste 2; E = pendência do enquadramento não impede o estado pronta. Simplificação: o texto da correção é o gravado; com menos pendências enviadas, a correção real poderia escrever outra coisa. "Números gravados/recalculados" confere que a regra atual, rodada aqui, dá o mesmo que a gravada.', '');
L.push('| Ficha | Rodada | Desenho | Par | Gravado | Recalculado | Só N | Só F | Só E | N + F + E | Números gravados/recalculados |', '|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of T3) L.push(`| ${r.linha.join(' | ')} | ${r.nsf} |`);
const conta = (i, rod) => T3.filter((r) => (!rod || r.rodada === rod) && r.linha[i] === 'pronta');
L.push('');
for (const rod of [...new Set(T3.map((r) => r.rodada))]) {
  const n = T3.filter((r) => r.rodada === rod).length;
  L.push(`- ${ROTULO_RODADA[rod] ?? rod} (${n} pares): prontas gravadas ${conta(4, rod).length}; recalculadas ${conta(5, rod).length}; só N ${conta(6, rod).length}; só F ${conta(7, rod).length}; só E ${conta(8, rod).length}; N + F + E ${conta(9, rod).length}`);
}
L.push('', '## Teste 4 – numeração "(n)" nos corpos das seções', '', '| Rodada | Desenho | Versões | Ocorrências | Por versão |', '|---|---|---|---|---|');
for (const [k, x] of Object.entries(T4)) {
  const [rod, d] = k.split('|');
  L.push(`| ${ROTULO_RODADA[rod] ?? rod} | ${d} | ${x.versoes.size} | ${x.ocorrencias} | ${(x.ocorrencias / x.versoes.size).toFixed(1)} |`);
}
writeFileSync(saida, L.join('\n'));
console.log(`${saida}: ${Math.round(L.join('\n').length / 1024)} KB`);
process.exit(0);
