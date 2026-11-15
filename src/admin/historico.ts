// A single hook between the router and a screen that pushes a history entry of its own (the dossier section
// list, spec 05 §5.6). The router asks it first on every "popstate": when the screen consumes the event
// (it closes its list, or runs what was waiting for the back navigation), the router must not route.
let gancho: (() => boolean) | null = null;

export function definirGanchoVoltar(f: (() => boolean) | null): void { gancho = f; }

/** True when a screen consumed the back navigation; the router then skips its own routing. */
export function voltarConsumido(): boolean { return gancho ? gancho() : false; }
