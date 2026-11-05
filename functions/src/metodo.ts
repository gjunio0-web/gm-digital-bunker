// Reads the published method for the pipeline functions (spec 02, section 0): files of the
// version in config/metodo, downloaded once per instance (cache keyed by version), returned in
// the fixed order, optionally reduced to some sections of each file.
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { ARQUIVOS_METODO, filtraSecoes, type ArquivoMetodo } from './metodoArquivos.js';

let cache: { versao: string; textos: Map<ArquivoMetodo, string> } | null = null;

export interface Metodo {
  versao: string;
  blocos: { nome: ArquivoMetodo; texto: string }[];
}

// Splits gs://bucket/prefix/ into bucket and prefix.
export function localDe(caminho: string): { bucket: string; prefixo: string } {
  const m = /^gs:\/\/([^/]+)\/(.*)$/.exec(caminho);
  if (!m) throw new Error('config/metodo.caminhoStorage is not a gs:// path');
  return { bucket: m[1], prefixo: m[2] };
}

export async function leMetodo(pedido: Partial<Record<ArquivoMetodo, readonly (number | string)[] | 'tudo'>>): Promise<Metodo> {
  const cfg = (await getFirestore().doc('config/metodo').get()).data();
  if (!cfg?.versao || !cfg.caminhoStorage) throw new Error('config/metodo has no published version');
  if (cache?.versao !== cfg.versao) {
    const { bucket, prefixo } = localDe(cfg.caminhoStorage);
    const b = getStorage().bucket(bucket);
    const textos = new Map<ArquivoMetodo, string>();
    await Promise.all(ARQUIVOS_METODO.map(async (nome) => {
      const [buf] = await b.file(`${prefixo}${nome}`).download();
      textos.set(nome, buf.toString('utf8'));
    }));
    cache = { versao: cfg.versao, textos };
  }
  const textos = cache!.textos;
  const blocos = ARQUIVOS_METODO.filter((n) => pedido[n]).map((nome) => {
    const sel = pedido[nome]!;
    const texto = textos.get(nome)!;
    return { nome, texto: sel === 'tudo' ? texto : filtraSecoes(texto, sel) };
  });
  return { versao: cfg.versao, blocos };
}
