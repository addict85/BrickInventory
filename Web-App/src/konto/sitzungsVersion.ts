/** Sitzungszeilen zu löschen reicht nicht: Eine laufende Anfrage schreibt ihre
 * Sitzung am Ende per Upsert zurück. Deshalb trägt jede Sitzung die Version
 * des Kontos; wer Zugänge beendet, erhöht sie, und jede Anfrage vergleicht. */
import type { Request, Response, NextFunction } from 'express';
import * as db from '../../db/database';

const ZWISCHENSPEICHER_MS = 5_000;
const gemerkt = new Map<number, { version: number | null; bis: number }>();

/** null: Konto fehlt oder ist gesperrt. */
export async function sitzungsVersionAusDb(uid: number): Promise<number | null> {
  const r = await db.get<{ v: number | null }>(
    'SELECT CASE WHEN is_active THEN sitzungs_version END AS v FROM users WHERE id = $1', [uid]);
  return r?.v ?? null;
}

async function aktuelleVersion(uid: number): Promise<number | null> {
  const g = gemerkt.get(uid);
  if (g && g.bis > Date.now()) return g.version;
  const version = await sitzungsVersionAusDb(uid);
  gemerkt.set(uid, { version, bis: Date.now() + ZWISCHENSPEICHER_MS });
  return version;
}

/** Vor dem Löschen der Zeilen aufrufen; liefert die neue Version. */
export async function erhoeheSitzungsVersion(uid: number): Promise<number> {
  const r = await db.get<{ v: number }>(
    'UPDATE users SET sitzungs_version = sitzungs_version + 1 WHERE id = $1 RETURNING sitzungs_version AS v', [uid]);
  gemerkt.delete(uid);
  return r?.v ?? 0;
}

/** regenerate statt destroy: Eine Anmeldung mit dem alten Keks braucht eine
 * leere Sitzung, in die sie schreiben kann. */
export function sitzungsVersionPruefen() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const s = req.session;
    if (!s?.userId) return next();
    try {
      if (await aktuelleVersion(s.userId) === (s.sitzungsVersion ?? 0)) return next();
    } catch (e) { return next(e); }
    s.regenerate((e?: unknown) => next(e));
  };
}
