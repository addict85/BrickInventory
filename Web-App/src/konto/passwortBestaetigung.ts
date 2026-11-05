import { passwortPasst, BcryptUeberlast } from './bcryptSchranke';
import { bestaetigungGesperrt, bestaetigungFehlgeschlagen, bestaetigungGelungen, meldeAnmeldeereignis } from './loginLimiter';
import type { Bremse } from './loginLimiter';
import type { FehlerCode } from '../infra/fehlerTexte';
import * as zugaenge from './repository/zugaenge';
import * as zf from './zweiterFaktor';
import * as P from './passkeys';
import { kontoGedrosselt } from './zielDrossel';
import { hinweisNebenher } from './kontoHinweis';

export type BestaetigungsAbsage = { status: number; code: FehlerCode; vars?: Record<string, string | number>; passkey?: boolean };
export type Faktor = { code?: unknown; passkey?: unknown };

const leer = (w: unknown) => w === undefined || w === null || String(w).trim() === '';

async function gebremst(art: Bremse, uid: number, zugang: string, pruefung: () => Promise<boolean>,
                        absage: FehlerCode): Promise<BestaetigungsAbsage | null> {
  const gesperrt = await bestaetigungGesperrt(art, uid, zugang);
  if (gesperrt) {
    meldeAnmeldeereignis('bestaetigung_gesperrt', { konto: uid, art, zugang });
    return { status: 429, ...gesperrt };
  }
  if (!await pruefung()) {
    meldeAnmeldeereignis('bestaetigung_fehlgeschlagen', { konto: uid, art, zugang });
    // Wie beim Login erfährt der Inhaber vom Erreichen der Bremse, höchstens einmal am Tag:
    // Wer in einer laufenden Sitzung rät, hat schon einen Zugang erbeutet.
    if (await bestaetigungFehlgeschlagen(art, uid, zugang)) {
      meldeAnmeldeereignis('bestaetigung_gebremst', { konto: uid, art, zugang });
      if (!await kontoGedrosselt('bestaetigung-hinweis', uid, 1, 86_400_000)) hinweisNebenher(uid, 'bestaetigung_gebremst');
    }
    return { status: 400, code: absage };
  }
  await bestaetigungGelungen(art, uid, zugang);
  return null;
}

/** Der einzige Weg, ein Passwort in einer laufenden Sitzung zu bestätigen: Bei
 * aktivem zweitem Faktor immer mit Code oder Passkey. Fehlt beides, kommt die
 * Absage vor jeder Prüfung, damit kein Erfolg eine Bremse zurücksetzt.
 * @returns null, wenn alles stimmt */
export async function pruefeBestaetigung(uid: number, zugang: string, passwort: unknown,
                                         faktor: Faktor): Promise<BestaetigungsAbsage | null> {
  const mitFaktor = await zf.istAktiv(uid);
  if (mitFaktor && leer(faktor.code) && leer(faktor.passkey))
    return { status: 400, code: 'zweiter_faktor_noetig', ...(await P.hatPasskeys(uid) ? { passkey: true } : {}) };
  const pw = await gebremst('passwort', uid, zugang, async () => {
    const u = await zugaenge.passwortHash(uid);
    return !!u && typeof passwort === 'string' && passwort !== ''
      && passwortPasst(passwort, u.password_hash);
  }, 'aktuelles_passwort_falsch').catch((e: unknown) => {
    if (e instanceof BcryptUeberlast) return { status: 503, code: 'server_ausgelastet' } as BestaetigungsAbsage;
    throw e;
  });
  if (pw || !mitFaktor) return pw;
  return leer(faktor.passkey)
    ? gebremst('faktor', uid, zugang, async () => !!await zf.pruefeCode(uid, faktor.code), 'zweiter_faktor_falsch')
    : gebremst('faktor', uid, zugang,
      async () => await P.anmeldungPruefen(faktor.passkey, 'zweiter_faktor', uid) === uid, 'passkey_ungueltig');
}

/** Nur der Code, mit der Bremse für Codes. */
export function pruefeCodeBestaetigung(uid: number, zugang: string, code: unknown): Promise<BestaetigungsAbsage | null> {
  return gebremst('faktor', uid, zugang, async () => !!await zf.pruefeCode(uid, code), 'zweiter_faktor_falsch');
}

/** Das Bestätigen der Einrichtung prüft ebenfalls einen Code; ohne Bremse
 * liesse er sich in einer übernommenen Sitzung beliebig oft raten.
 * @returns die Wiederherstellungscodes oder die Absage */
export async function bestaetigeEinrichtungGebremst(uid: number, zugang: string, code: unknown): Promise<string[] | BestaetigungsAbsage> {
  let codes: string[] | null = null;
  const absage = await gebremst('faktor', uid, zugang,
    async () => !!(codes = await zf.bestaetigeEinrichtung(uid, String(code ?? ''))), 'zweiter_faktor_falsch');
  return absage ?? codes ?? { status: 400, code: 'zweiter_faktor_falsch' };
}
