// CNPJ discovery and validation (spec 03, sections 3.1 to 3.3).
import { chamaJson } from './rede.js';

const PADRAO = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;

// Check digits of a 14-digit CNPJ.
export function cnpjValido(c: string): boolean {
  const d = c.replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (base: string) => {
    let soma = 0;
    let peso = base.length - 7;
    for (const n of base) {
      soma += Number(n) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13]);
}

// Valid CNPJs found in a text, digits only, without repetition.
export function extraiCnpjs(texto: string): string[] {
  return [...new Set((texto.match(PADRAO) ?? []).map((c) => c.replace(/\D/g, '')).filter(cnpjValido))];
}

// Fields of BrasilAPI kept for the analysis (spec 03, section 3.3); partners: name and role only.
export interface RegistroBrasilApi {
  cnpj: string;
  razaoSocial: string | null;
  nomeFantasia: string | null;
  cnaePrincipal: { codigo: string; descricao: string } | null;
  cnaesSecundarios: { codigo: string; descricao: string }[];
  porte: string | null;
  naturezaJuridica: string | null;
  dataAbertura: string | null;
  situacaoCadastral: string | null;
  capitalSocial: number | null;
  municipio: string | null;
  uf: string | null;
  quadroSocietario: { nome: string; qualificacao: string }[];
}

export function filtraBrasilApi(cnpj: string, r: Record<string, unknown>): RegistroBrasilApi {
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const qsa = Array.isArray(r.qsa) ? (r.qsa as Record<string, unknown>[]) : [];
  const sec = Array.isArray(r.cnaes_secundarios) ? (r.cnaes_secundarios as Record<string, unknown>[]) : [];
  return {
    cnpj,
    razaoSocial: s(r.razao_social),
    nomeFantasia: s(r.nome_fantasia),
    cnaePrincipal: r.cnae_fiscal ? { codigo: String(r.cnae_fiscal), descricao: s(r.cnae_fiscal_descricao) ?? '' } : null,
    cnaesSecundarios: sec.filter((c) => c.codigo).map((c) => ({ codigo: String(c.codigo), descricao: s(c.descricao) ?? '' })),
    porte: s(r.porte),
    naturezaJuridica: s(r.natureza_juridica),
    dataAbertura: s(r.data_inicio_atividade),
    situacaoCadastral: s(r.descricao_situacao_cadastral),
    capitalSocial: typeof r.capital_social === 'number' ? r.capital_social : null,
    municipio: s(r.municipio),
    uf: s(r.uf),
    quadroSocietario: qsa.map((q) => ({ nome: s(q.nome_socio) ?? '', qualificacao: s(q.qualificacao_socio) ?? '' })).filter((q) => q.nome),
  };
}

// Two more attempts after HTTP 429 (rate limit), waiting 3 s and then 6 s.
export async function consultaBrasilApi(cnpj: string): Promise<{ status: number; registro: RegistroBrasilApi | null }> {
  let { status, corpo } = await chamaJson(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {}, 15_000);
  for (const espera of [3_000, 6_000]) {
    if (status !== 429) break;
    await new Promise((r) => setTimeout(r, espera));
    ({ status, corpo } = await chamaJson(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {}, 15_000));
  }
  return { status, registro: status === 200 && corpo && typeof corpo === 'object' ? filtraBrasilApi(cnpj, corpo as Record<string, unknown>) : null };
}
