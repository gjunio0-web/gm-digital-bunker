// qualificar – called at the end of the coleta mínima (spec 01, sections 3 and 4; spec 02, section 1).
// Code signals plus one Haiku call, always: the ficha, the origin page, the content of the two
// coleta mínima stages and portas-materiais.md section 1 of the published method. Writes qualificacao
// (decision descartar or prosseguir), the cost and the state "qualificada"; the final state and the
// retention are graduar's (spec 04). The write is a transaction that requires the "coleta_minima" state.
import { FieldValue, getFirestore, Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import type { Pipeline } from './config.js';
import { chamaClaude, noEmulador, simulaClassificacao } from './claude.js';
import { custoDe, type Custo } from './custo.js';
import { leMetodo } from './metodo.js';
import { CARGOS_ROTULO } from './textos.generated.js';
import { decide, ESQUEMA_CLASSIFICACAO, promptQualificacao, sinais, validaClassificacao, type Decisao } from './qualificacao.js';
import type { Normalizado, Original } from './validacao.js';

// Month key of metricas in São Paulo time (aaaa-mm).
export const mesDe = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);

export async function qualifica(ref: DocumentReference, p: Pipeline, chaveClaude: string): Promise<Decisao | null> {
  const db = getFirestore();
  const f = (await ref.get()).data();
  if (!f || f.estado !== 'coleta_minima') return null;
  const estadoEmLido = f.estadoEm as Timestamp;
  const original = f.original as Original;
  const normalizado = f.normalizado as Normalizado;
  const [digital, registro] = await Promise.all(['empresa_digital', 'empresa_registro'].map((e) => ref.collection('coleta').doc(e).get()));

  const s = sinais(original, normalizado);
  if (!noEmulador() && !p.modeloColeta) throw new Error('config/pipeline.modeloColeta is empty');
  const metodo = (await leMetodo({ 'portas-materiais.md': [1] })).blocos.map((b) => ({ nome: b.nome, texto: b.texto }));
  const r = noEmulador()
    ? simulaClassificacao(original.mensagem)
    : await chamaClaude({
        chave: chaveClaude,
        modelo: p.modeloColeta,
        metodo,
        usuario: promptQualificacao(
          original, normalizado, CARGOS_ROTULO[original.cargo] ?? original.cargo, f.origem?.pagina ?? null,
          digital.get('conteudo') ?? 'etapa sem conteúdo', registro.get('conteudo') ?? 'etapa sem conteúdo',
        ),
        esquema: ESQUEMA_CLASSIFICACAO,
      });
  const c = validaClassificacao(r.json);
  const custo: Custo = custoDe(p.modeloColeta, r.uso);
  const { decisao, motivo } = decide(c);
  const { estruturaTecnologia, portaIndicada, ...classificacaoMensagem } = c;

  const agora = Timestamp.now();
  await db.runTransaction(async (tx) => {
    const atual = (await tx.get(ref)).data();
    if (!atual || atual.estado !== 'coleta_minima' || !(atual.estadoEm as Timestamp).isEqual(estadoEmLido)) throw new Error('qualificar: ficha changed meanwhile');
    tx.update(ref, {
      'qualificacao.decisao': decisao,
      'qualificacao.motivo': motivo,
      'qualificacao.nivelCargo': s.nivelCargo,
      'qualificacao.cargoDecisor': s.cargoDecisor,
      'qualificacao.temMensagem': s.temMensagem,
      'qualificacao.siteInformado': s.siteInformado,
      'qualificacao.estruturaTecnologia': estruturaTecnologia,
      'qualificacao.portaIndicada': portaIndicada,
      'qualificacao.classificacaoMensagem': classificacaoMensagem,
      'custo.tokensEntrada': FieldValue.increment(custo.tokensEntrada),
      'custo.tokensSaida': FieldValue.increment(custo.tokensSaida),
      'custo.usdEstimado': FieldValue.increment(custo.usdEstimado ?? 0),
      estado: 'qualificada',
      estadoEm: agora,
    });
    tx.create(ref.collection('eventos').doc(), { em: agora, ator: { tipo: 'ia', id: 'qualificar' }, tipo: 'qualificada', detalhe: { decisao, motivo } });
    tx.set(
      db.collection('metricas').doc(mesDe((f.recebidaEm as Timestamp).toDate())),
      { qualificacao: { [decisao]: FieldValue.increment(1) }, custo: { qualificacao: { usdEstimado: FieldValue.increment(custo.usdEstimado ?? 0) } }, atualizadoEm: agora },
      { merge: true },
    );
  });
  return decisao;
}
