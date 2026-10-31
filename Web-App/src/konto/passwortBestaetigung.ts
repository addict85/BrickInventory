import bcrypt from 'bcryptjs';
import { bestaetigungGesperrt, bestaetigungFehlgeschlagen, bestaetigungGelungen } from './loginLimiter';
import type { FehlerCode } from '../infra/fehlerTexte';
import * as zugaenge from './repository/zugaenge';
import * as zf from './zweiterFaktor';

export type BestaetigungsAbsage = { status: number; code: FehlerCode; vars?: Record<string, string | number> };

/**
 * Das aktuelle Passwort eines angemeldeten Kontos prüfen, mit Bremse je Konto.
 * Wer nur eine offene Sitzung oder ein App-Token erbeutet hat, kommt damit
 * nicht weiter. @returns null, wenn es stimmt, sonst die Absage
 */
export async function pruefeBestaetigung(uid: number, passwort: unknown,
                                         zusatz: { zweiterFaktor?: unknown } = {}): Promise<BestaetigungsAbsage | null> {
  const gesperrt = await bestaetigungGesperrt(uid);
  if (gesperrt) return { status: 429, ...gesperrt };
  const u = await zugaenge.passwortHash(uid);
  const ok = !!u && typeof passwort === 'string' && passwort !== '' && await bcrypt.compare(passwort, u.password_hash);
  if (!ok) {
    await bestaetigungFehlgeschlagen(uid);
    return { status: 400, code: 'aktuelles_passwort_falsch' };
  }
  // Ein falscher Code zählt wie ein falsches Passwort — sonst liesse er sich
  // mit bekanntem Passwort beliebig oft raten.
  if ('zweiterFaktor' in zusatz && !await zf.pruefeCode(uid, zusatz.zweiterFaktor)) {
    await bestaetigungFehlgeschlagen(uid);
    return { status: 400, code: 'zweiter_faktor_falsch' };
  }
  await bestaetigungGelungen(uid);
  return null;
}

/** Nur der Code des zweiten Faktors — mit derselben Bremse wie das Passwort. */
export async function pruefeCodeBestaetigung(uid: number, code: unknown): Promise<BestaetigungsAbsage | null> {
  const gesperrt = await bestaetigungGesperrt(uid);
  if (gesperrt) return { status: 429, ...gesperrt };
  if (!await zf.pruefeCode(uid, code)) {
    await bestaetigungFehlgeschlagen(uid);
    return { status: 400, code: 'zweiter_faktor_falsch' };
  }
  await bestaetigungGelungen(uid);
  return null;
}
