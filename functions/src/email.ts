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
