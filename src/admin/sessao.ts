// Re-emission of the sign-in state (spec 05 §2). Firebase Auth shares the stored session between tabs, so opening or
// reloading another tab can fire `onAuthStateChanged` again in a tab that is already routed, with the same user.
// Routing again would remount the view and drop what the person has on screen (editor text, ticks, open selectors).
// The shell therefore routes only when the user is not the one already routed.

/** True when the emission is for the user the shell already routed: nothing to redo. */
export const mesmoUsuarioRoteado = (uidRoteado: string | null, uidNovo: string | null | undefined): boolean =>
  !!uidRoteado && uidRoteado === uidNovo;
