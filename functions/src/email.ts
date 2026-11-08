// E-mails through the SMTP2GO HTTP API (spec 01, section 4). In the emulator nothing is sent:
// the message is logged instead, so tests never reach the provider.
import { logger } from 'firebase-functions';
import { EMAIL_CONTATO, REMETENTE, SITE } from './config.js';
import { CARGOS_ROTULO, TEXTOS } from './textos.generated.js';
import type { Idioma, Original } from './validacao.js';

const API = 'https://api.smtp2go.com/v3/email/send';

interface Mensagem {
  para: string;
  assunto: string;
  corpo: string;
  responderPara?: string;
}

const noEmulador = () => process.env.FUNCTIONS_EMULATOR === 'true';

async function envia(chave: string, m: Mensagem): Promise<void> {
  if (noEmulador()) {
    logger.info('Emulator: e-mail not sent', { para: m.para === EMAIL_CONTATO ? 'admin' : 'interessado', assunto: m.assunto });
    return;
  }
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Smtp2go-Api-Key': chave },
    body: JSON.stringify({
      sender: REMETENTE,
      to: [m.para],
      subject: m.assunto,
      text_body: m.corpo,
      custom_headers: m.responderPara ? [{ header: 'Reply-To', value: m.responderPara }] : [],
    }),
  });
  const corpo = (await res.json().catch(() => null)) as { data?: { succeeded?: number; error?: string } } | null;
  if (!res.ok || corpo?.data?.succeeded !== 1) {
    throw new Error(`SMTP2GO HTTP ${res.status}: ${corpo?.data?.error ?? 'not accepted'}`);
  }
}

// Confirmation to the person who filled the form. It never repeats anything typed in the form,
// so the form cannot be used to send arbitrary text to third parties. Replies go to contato@.
export function confirmacao(chave: string, para: string, lang: Idioma): Promise<void> {
  const t = TEXTOS[lang];
  const corpo = [t.greeting, '', t.success, '', t.addMore, '', 'GM Digital Bunker™', SITE, '', t.footer].join('\n');
  return envia(chave, { para, assunto: t.subject, corpo, responderPara: EMAIL_CONTATO });
}

// Notice to the administrator with the fields as received (role shown with its form label).
// Replies go to the person.
export function aviso(chave: string, id: string, o: Original, pagina: string | null, recebidaEm: Date): Promise<void> {
  const corpo = [
    `Nome: ${o.nome}`,
    `Empresa: ${o.empresa}`,
    `Cargo: ${CARGOS_ROTULO[o.cargo] ?? o.cargo}`,
    `E-mail: ${o.email}`,
    `Site: ${o.site ?? '–'}`,
    `Idioma: ${o.lang}`,
    `Página: ${pagina ?? '–'}`,
    '',
    'Mensagem:',
    o.mensagem ?? '–',
    '',
    `Ficha: fichas/${id}`,
    `Recebida em: ${recebidaEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (horário de Brasília)`,
  ].join('\n');
  return envia(chave, { para: EMAIL_CONTATO, assunto: `Nova ficha – ${o.nome} (${o.empresa})`, corpo, responderPara: o.email });
}

export interface AvisoAnalise {
  fichaId: string;
  empresa: string;
  versao: string;
  pronta: boolean;
  pendencias: number;
  quadrante: string;
  destino: string;
  grau: string;
  pontos: number;
  confianca: string;
  confiancaMotivo: string;
  prazoEm: Date | null;
  portaProvavel: string;
  resumoExecutivo: string;
  link: string;
}

// Second notice to the administrator, when the analysis is ready (spec 01, decision 3; spec 04, 7):
// executive summary, likely door, quadrant, destination, grade, confidence, deadline and the ficha link.
export function avisoAnalise(chave: string, a: AvisoAnalise): Promise<void> {
  const prazo = a.prazoEm ? a.prazoEm.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '–';
  const corpo = [
    `Empresa: ${a.empresa}`,
    `Análise: ${a.versao} – ${a.pronta ? 'pronta' : `com pendências (${a.pendencias})`}`,
    '',
    `Quadrante: ${a.quadrante}`,
    `Destino: ${a.destino}`,
    `Grau: ${a.grau} (${a.pontos} pontos)`,
    `Confiança: ${a.confianca} – ${a.confiancaMotivo}`,
    `Prazo de resposta: ${prazo}`,
    `Porta provável: ${a.portaProvavel}`,
    '',
    'Resumo executivo:',
    a.resumoExecutivo,
    '',
    `Ficha: ${a.link}`,
  ].join('\n');
  return envia(chave, { para: EMAIL_CONTATO, assunto: `Análise ${a.pronta ? 'pronta' : 'com pendências'} – ${a.empresa} (${a.quadrante}, grau ${a.grau})`, corpo });
}

// Notice of fichas stopped in coletando or sintetizando beyond config/pipeline.prazoParadaMin (phase 6, item 3c):
// company, state, how long and the link; nothing is run again by itself.
export function avisoParadas(chave: string, paradas: { empresa: string; estado: string; minutos: number; link: string }[]): Promise<void> {
  const corpo = [
    `${paradas.length} ficha(s) parada(s) além do prazo; o erro de interrupção foi gravado em cada uma, sem reexecução automática.`,
    '',
    ...paradas.map((p) => `- ${p.empresa}: ${p.estado} há ${p.minutos} min – ${p.link}`),
  ].join('\n');
  return envia(chave, { para: EMAIL_CONTATO, assunto: `Fichas paradas – ${paradas.length}`, corpo });
}

// Notice that the daily ceiling of analyses was reached (phase 6, item 4): sent once per day.
export function avisoTeto(chave: string, teto: number, dia: string): Promise<void> {
  const corpo = [
    `O teto diário de ${teto} análises foi atingido em ${dia}.`,
    'As fichas seguintes que a triagem mandaria à análise ficam em "qualificada", com o evento teto_diario; podem ser mandadas à análise pelo hub.',
    'O teto fica em config/pipeline.maxAnalisesPorDia (null desliga).',
  ].join('\n');
  return envia(chave, { para: EMAIL_CONTATO, assunto: `Teto diário de análises atingido – ${dia}`, corpo });
}
