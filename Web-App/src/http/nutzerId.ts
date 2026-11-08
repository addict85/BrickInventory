import type { Request } from 'express';

/** EINE Antwort für Sitzung und Token: Vorher stand die Frage in zwei Reihenfolgen.
 * Sie liegt in src/infra (der untersten Stufe), weil die Drossel dort sitzt: Infra
 * darf weder eine HTTP-Seite noch einen höheren Bereich importieren (test/schichten.test.js). */
export function nutzerId(req: Request): number | null {
  const roh = req.session?.userId ?? req.tokenUserId ?? req.apiUser?.user_id;
  if (roh == null) return null;
  const n = Number(roh);
  return Number.isFinite(n) ? n : null;
}

/** Fehlt die Anmeldung hinter einem Wächter, ist die Verdrahtung falsch, nicht
 * die Anfrage — besser als `nutzerId(req)!` überall. */
export function angemeldeteNutzerId(req: Request): number {
  const id = nutzerId(req);
  if (id == null) {
    throw new Error('angemeldeteNutzerId ohne Anmeldung — die Route steht vor ihrem Waechter');
  }
  return id;
}
