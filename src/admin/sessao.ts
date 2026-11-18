// Re-emission of the sign-in state (spec 05 §2). Firebase Auth shares the stored session between tabs, so opening or
// reloading another tab can fire `onAuthStateChanged` again in a tab that is already routed, with the same user.
// Routing again would remount the view and drop what the person has on screen (editor text, ticks, open selectors).
// The shell therefore routes only when the user is not the one already routed.

/** True when the emission is for the user the shell already routed: nothing to redo. */
export const mesmoUsuarioRoteado = (uidRoteado: string | null, uidNovo: string | null | undefined): boolean =>
  !!uidRoteado && uidRoteado === uidNovo;

/**
 * A `null` user is not always a sign-out. When another tab loads, Firebase rewrites the stored session and this tab sees
 * `null` for about a second, then the same user again (observed on the published page, 18/nov/2026). Tearing the view
 * down on that `null` loses the editor text. After a "Sair" click, or before anything was routed, `null` is acted on
 * at once; otherwise it waits and acts only if the user is still gone.
 */
export const ESPERA_SAIDA_MS = 3000;
export const aoReceberNulo = (uidRoteado: string | null): 'sair-agora' | 'esperar' => (uidRoteado ? 'esperar' : 'sair-agora');
