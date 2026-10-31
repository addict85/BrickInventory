import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import * as db from '../db/database';
import { bestaetigungGesperrt, bestaetigungFehlgeschlagen, bestaetigungGelungen } from './loginLimiter';
import { sendeFehler } from '../src/infra/fehlerTexte';
import * as zf from './zweiterFaktor';

/**
 * Das aktuelle Passwort eines angemeldeten Kontos prüfen, mit Bremse je Konto
 * (utils/loginLimiter.ts). Antwortet selbst, wenn es nicht stimmt. Wer nur eine
 * offene Sitzung oder ein App-Token erbeutet hat, kommt damit nicht weiter.
 */
export async function bestaetigePasswort(req: Request, res: Response, uid: number, passwort: unknown,
                                         zusatz: { zweiterFaktor?: unknown } = {}): Promise<boolean> {
  const gesperrt = await bestaetigungGesperrt(uid);
  if (gesperrt) { sendeFehler(req, res, 429, gesperrt.code, gesperrt.vars); return false; }
  const u = await db.get('SELECT password_hash FROM users WHERE id = $1', [uid]);
  const ok = !!u && typeof passwort === 'string' && passwort !== '' && await bcrypt.compare(passwort, u.password_hash);
  if (!ok) {
    await bestaetigungFehlgeschlagen(uid);
    sendeFehler(req, res, 400, 'aktuelles_passwort_falsch');
    return false;
  }
  // Ein falscher Code zählt wie ein falsches Passwort — sonst liesse er sich
  // mit bekanntem Passwort beliebig oft raten.
  if ('zweiterFaktor' in zusatz && !await zf.pruefeCode(uid, zusatz.zweiterFaktor)) {
    await bestaetigungFehlgeschlagen(uid);
    sendeFehler(req, res, 400, 'zweiter_faktor_falsch');
    return false;
  }
  await bestaetigungGelungen(uid);
  return true;
}
