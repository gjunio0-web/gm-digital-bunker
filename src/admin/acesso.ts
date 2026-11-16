// Role check of the admin shell (spec 05, §3). It tells "this account has no access" apart from "the role
// could not be read right now": a failed read (network, service) must never be reported as missing access
// nor sign the user out.
//   ok            the document has the role admin or leitor
//   sem-acesso    the document is absent or carries no usable role, or Firestore answered permission-denied
//   indisponivel  every attempt failed for another reason (offline, service unavailable, timeout, ...)

export type Verificacao = 'ok' | 'sem-acesso' | 'indisponivel';

const PAUSAS_PADRAO_MS = [0, 1000, 3000];
const esperarPadrao = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `lerPapel` resolves with the role (or null when the document is absent) and rejects when the read fails.
 * A failure other than permission-denied is retried after each pause in `pausasMs` (the first pause is the
 * wait before the first attempt, normally 0).
 */
export async function verificarAcesso(
  lerPapel: () => Promise<string | null>,
  pausasMs: number[] = PAUSAS_PADRAO_MS,
  esperar: (ms: number) => Promise<void> = esperarPadrao,
): Promise<Verificacao> {
  for (const pausa of pausasMs) {
    if (pausa > 0) await esperar(pausa);
    try {
      const papel = await lerPapel();
      return papel === 'admin' || papel === 'leitor' ? 'ok' : 'sem-acesso';
    } catch (err) {
      if ((err as { code?: string }).code === 'permission-denied') return 'sem-acesso';
    }
  }
  return 'indisponivel';
}
