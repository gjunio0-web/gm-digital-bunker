// sondarCache – private HTTPS function for the cache probe of phase B2 (spec/alteracoes-specs-01-02-
// portoes-correcao.md, item 9.3; decision of Gon, 8/11/2026). Called by scripts/sondar-cache.mjs with the
// caller's Google identity; the API key stays server-side. For one ficha, three calls to the enquadrar model
// with the synthesis prefix (SISTEMA_BASE and the five method files) and the data block marked for cache:
// (1) and (2) with the same output schema (ESQUEMA_ENQUADRAR), (3) with another one (ESQUEMA_CONVERSA). If (2)
// reads the data block and (3) reads only the system prefix, the hypothesis of 9.3 holds (the schema breaks
// the message-level cache); if not even the system prefix is read, the cause is another. Low effort and a short
// output budget: the answer is not used (a call cut by max_tokens still reports its usage). Returns the usage
// of each call only – no text of the ficha or of the answers.
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getFirestore } from 'firebase-admin/firestore';
import { CLAUDE_API_KEY, REGIAO } from './config.js';
import { chamaClaude, ErroComUso, noEmulador } from './claude.js';
import { lePipeline } from './pipeline.js';
import { lePrecos } from './precos.js';
import { modeloDe } from './modelos.js';
import { leMetodo } from './metodo.js';
import { usoChamada } from './uso.js';
import { dominioDe } from './qualificacao.js';
import { CARGOS_ROTULO } from './textos.generated.js';
import { ESQUEMA_CONVERSA, ESQUEMA_ENQUADRAR, ETAPAS_COLETA, blocoDados, coletaDe } from './sintese.js';

const INSTRUCAO = 'Sondagem de cache: responda no esquema com valores mínimos, sem analisar a ficha.';

export const sondarCache = onRequest(
  { region: REGIAO, secrets: [CLAUDE_API_KEY], memory: '512MiB', timeoutSeconds: 300, maxInstances: 1, invoker: 'private' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).set('Allow', 'POST').end();
      return;
    }
    if (noEmulador()) {
      res.status(400).json({ motivo: 'a sondagem chama o modelo e não roda no emulador' });
      return;
    }
    try {
      const fichaId = (req.body ?? {}).fichaId;
      if (typeof fichaId !== 'string' || !/^[A-Za-z0-9]{10,40}$/.test(fichaId)) {
        res.status(400).json({ motivo: 'fichaId invalido' });
        return;
      }
      const ref = getFirestore().collection('fichas').doc(fichaId);
      const f = (await ref.get()).data();
      if (!f) {
        res.status(404).json({ motivo: 'ficha inexistente' });
        return;
      }
      const p = await lePipeline();
      const precos = await lePrecos();
      const modelo = modeloDe(p, 'enquadrar');
      if (!modelo) throw new Error('config/pipeline.modelos.enquadrar is empty');
      const snaps = await Promise.all(ETAPAS_COLETA.map((e) => ref.collection('coleta').doc(e).get()));
      const coleta = coletaDe(Object.fromEntries(ETAPAS_COLETA.map((e, i) => [e, snaps[i].data()])));
      const o = f.original ?? {};
      const dados = blocoDados({
        nome: o.nome, empresa: o.empresa, cargo: o.cargo, rotuloCargo: CARGOS_ROTULO[o.cargo] ?? o.cargo, dominioEmail: dominioDe(f.normalizado?.email ?? ''),
        site: f.normalizado?.site ?? null, mensagem: o.mensagem ?? null, pagina: f.origem?.pagina ?? null, lang: o.lang ?? 'pt-BR',
      }, f.qualificacao ?? null, coleta);
      const metodo = await leMetodo({ 'glossario.md': 'tudo', 'escopo-limites.md': 'tudo', 'portas-materiais.md': 'tudo', 'mapa-alavancas.md': 'tudo', 'livro-selecao.md': 'tudo' });
      const blocos = metodo.blocos.map((b) => ({ nome: b.nome, texto: b.texto }));
      const chamadas = [['1', 'enquadrar', ESQUEMA_ENQUADRAR], ['2', 'enquadrar', ESQUEMA_ENQUADRAR], ['3', 'conversa', ESQUEMA_CONVERSA]] as const;
      const r = [];
      for (const [n, esquemaNome, esquema] of chamadas) {
        const inicio = Date.now();
        let uso;
        let fim = 'end_turn';
        try {
          uso = (await chamaClaude({
            chave: CLAUDE_API_KEY.value(), modelo, metodo: blocos, usuario: [{ texto: dados, cache: true }, { texto: INSTRUCAO }], esquema,
            maxTokens: 2_000, timeoutMs: 120_000, esforco: 'low',
          })).uso;
        } catch (e) {
          if (!(e instanceof ErroComUso)) throw e;
          uso = e.uso;
          fim = e.message;
        }
        const k = usoChamada(precos, modelo, 'baixo', uso, Date.now() - inicio);
        r.push({ chamada: n, esquema: esquemaNome, fim, tokensEntrada: k.tokensEntrada, cacheLidos: k.cacheLidos, cacheEscritos: k.cacheEscritos, tokensSaida: k.tokensSaida, duracaoMs: k.duracaoMs, usdEstimado: k.usdEstimado });
      }
      logger.info('sondarCache: done', { fichaId, chamadas: r.map((x) => [x.cacheLidos, x.cacheEscritos]) });
      res.json({ modelo, versaoMetodo: metodo.versao, chamadas: r });
    } catch (e) {
      const mensagem = String((e as Error)?.message ?? e).slice(0, 300);
      logger.error('sondarCache failed', { mensagem });
      res.status(500).json({ motivo: mensagem });
    }
  },
);
