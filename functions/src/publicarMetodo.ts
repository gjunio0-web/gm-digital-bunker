// publicarMetodo – private HTTPS function (spec 01: config/metodo and publicarMetodo). Called by
// scripts/publicar-metodo.mjs with the caller's Google identity; no public invoker.
// Stores the five files under metodo/{versao}/ in the private bucket <project>-metodo, counts the
// tokens of each with the Claude API (key kept server-side) and writes config/metodo.
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { CLAUDE_API_KEY, REGIAO } from './config.js';
import { contaTokens, noEmulador } from './claude.js';
import { modeloDe } from './modelos.js';
import { lePipeline } from './pipeline.js';
import { resumeArquivos, versaoValida, type ArquivoPublicado } from './metodoArquivos.js';

export const bucketMetodo = () => `${process.env.GCLOUD_PROJECT ?? ''}-metodo`;

export const publicarMetodo = onRequest(
  { region: REGIAO, secrets: [CLAUDE_API_KEY], memory: '512MiB', timeoutSeconds: 120, maxInstances: 1, invoker: 'private' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).set('Allow', 'POST').end();
      return;
    }
    try {
      const { versao, arquivos } = (req.body ?? {}) as { versao?: unknown; arquivos?: { nome: string; conteudo: string }[] };
      if (!versaoValida(versao) || !Array.isArray(arquivos)) {
        res.status(400).json({ motivo: 'versao ou arquivos invalidos' });
        return;
      }
      let lista: ReturnType<typeof resumeArquivos>;
      try {
        lista = resumeArquivos(arquivos);
      } catch (e) {
        res.status(400).json({ motivo: String((e as Error).message) });
        return;
      }
      const p = await lePipeline();
      const modelo = modeloDe(p, 'montar_analise') || modeloDe(p, 'coleta');
      if (!noEmulador() && !modelo) throw new Error('config/pipeline has no model to count tokens with');

      const bucket = getStorage().bucket(bucketMetodo());
      const prefixo = `metodo/${versao}/`;
      const resumo: Record<string, ArquivoPublicado> = {};
      for (const a of lista) {
        await bucket.file(`${prefixo}${a.nome}`).save(a.conteudo, { contentType: 'text/markdown; charset=utf-8', resumable: false });
        const tokensEstimados = noEmulador() ? Math.ceil(a.bytes / 4) : await contaTokens(CLAUDE_API_KEY.value(), modelo, a.conteudo);
        resumo[a.nome] = { bytes: a.bytes, sha256: a.sha256, tokensEstimados };
      }
      const caminhoStorage = `gs://${bucket.name}/${prefixo}`;
      await getFirestore().doc('config/metodo').set({ versao, publicadoEm: Timestamp.now(), arquivos: resumo, caminhoStorage });
      const total = Object.values(resumo).reduce((s, a) => s + a.tokensEstimados, 0);
      logger.info('publicarMetodo: done', { versao, total, modelo });
      res.status(200).json({ versao, caminhoStorage, arquivos: resumo, total, modelo: noEmulador() ? 'simulado' : modelo });
    } catch (e) {
      const mensagem = String((e as Error)?.message ?? e).slice(0, 300);
      logger.error('publicarMetodo failed', { mensagem });
      res.status(500).json({ motivo: mensagem });
    }
  },
);
