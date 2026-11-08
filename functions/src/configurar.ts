// Sets fields of config/pipeline without touching the others (only with Gon's authorization).
// Usage (from functions/): npm run configurar -- gmdb-qualidade modelos.coleta=claude-haiku-5-5 autoAnalisar=false
// Keys must exist in the defaults (dotted paths allowed, e.g. fontes.apollo.ativo) and keep the default's type.
// modelos.{etapa} and esforco.{etapa} take a string or null ("null": the stage inherits); esforco only one of
// baixo, medio, alto, padrao; a model must be listed in config/precos. maxAnalisesPorDia takes a number or null.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { ESFORCOS, ETAPAS_MODELO, PIPELINE_PADRAO } from './config.js';

const [projectId, ...pares] = process.argv.slice(2);
if (!projectId || !pares.length) {
  console.error('Usage: npm run configurar -- <project id> chave=valor [chave=valor ...]');
  process.exit(1);
}

const padraoDe = (caminho: string): unknown =>
  caminho.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), PIPELINE_PADRAO);

const campos: Record<string, unknown> = {};
for (const par of pares) {
  const i = par.indexOf('=');
  const chave = par.slice(0, i);
  const bruto = par.slice(i + 1);
  const [grupo, etapa, ...resto] = chave.split('.');
  if ((grupo === 'modelos' || grupo === 'esforco') && !resto.length) {
    if (!(ETAPAS_MODELO as readonly string[]).includes(etapa)) throw new Error(`Unknown key: ${chave}`);
    const valor = bruto === 'null' ? null : bruto;
    if (grupo === 'esforco' && valor !== null && !(ESFORCOS as readonly string[]).includes(valor)) throw new Error(`Invalid value for ${chave}: ${bruto}`);
    campos[chave] = valor;
    continue;
  }
  // Daily ceiling of analyses: a number, or null for no ceiling.
  if (chave === 'maxAnalisesPorDia') {
    const valor = bruto === 'null' ? null : Number(bruto);
    if (valor !== null && (!Number.isInteger(valor) || valor < 0)) throw new Error(`Invalid value for ${chave}: ${bruto}`);
    campos[chave] = valor;
    continue;
  }
  const padrao = padraoDe(chave);
  if (i < 1 || padrao === undefined || typeof padrao === 'object') throw new Error(`Unknown key: ${chave}`);
  const valor = typeof padrao === 'boolean' ? bruto === 'true' : typeof padrao === 'number' ? Number(bruto) : bruto;
  if ((typeof padrao === 'boolean' && !['true', 'false'].includes(bruto)) || (typeof padrao === 'number' && !Number.isFinite(valor))) {
    throw new Error(`Invalid value for ${chave}: ${bruto}`);
  }
  campos[chave] = valor;
}

initializeApp({ projectId });
// A model of modelos.* must be in config/precos, or its calls would have no estimated cost (phase 6, item 5).
const modelosPedidos = Object.entries(campos).filter(([k, v]) => k.startsWith('modelos.') && typeof v === 'string').map(([k, v]) => [k, v as string]);
if (modelosPedidos.length) {
  const conhecidos = Object.keys((await getFirestore().doc('config/precos').get()).get('modelos') ?? {});
  const sem = modelosPedidos.filter(([, v]) => !conhecidos.includes(v));
  if (sem.length) throw new Error(`Not in config/precos: ${sem.map(([k, v]) => `${k}=${v}`).join(', ')}`);
}
await getFirestore().doc('config/pipeline').update(campos);
console.log(`config/pipeline: set ${Object.entries(campos).map(([k, v]) => `${k}=${v}`).join(', ')}`);
