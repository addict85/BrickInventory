/** Ein Strom (SSE, NDJSON) lebt Minuten, geprüft wurde sein Zugang aber nur am
 * Anfang. Ohne Wache sähe ein abgemeldetes Gerät oder ein widerrufener Token
 * weiter zu. Geprüft wird im Takt und bei jeder Zugangsänderung im Prozess,
 * ohne Zwischenspeicher und ohne Nebenwirkungen (kein last_used, kein Fehlversuch). */
import type { Request } from 'express';
import { meldeFehler } from '../../infra/fehler';
import { kontoBereich } from '../prozess';
import { hashToken } from '../geraeteToken';
import { sitzungsVersionAusDb } from '../sitzungsVersion';
import { beiZugangsAenderung } from '../zugangsAenderung';

export { meldeZugangsAenderung } from '../zugangsAenderung';

export const WACHE_TAKT_MS = 15_000;

function sitzungLebt(req: Request): Promise<boolean> {
  const speicher = req.sessionStore;
  if (!speicher || !req.sessionID) return Promise.resolve(true);
  return new Promise((fertig, scheitern) =>
    speicher.get(req.sessionID, (e: unknown, s?: { userId?: number } | null) =>
      e ? scheitern(e) : fertig(s?.userId === req.session.userId),
    ),
  );
}

/** Gilt der Zugang, mit dem die Anfrage kam, jetzt noch? */
export async function zugangGiltNoch(req: Request): Promise<boolean> {
  const s = req.session;
  if (s?.userId) {
    if ((await sitzungsVersionAusDb(s.userId)) !== (s.sitzungsVersion ?? 0)) return false;
    // Abmelden löscht nur diese eine Sitzung, die Version bleibt.
    return sitzungLebt(req);
  }
  const kopf = String(req.headers.authorization || '');
  if (!kopf.startsWith('Bearer ')) return false;
  return !!(await kontoBereich().zugaenge.gueltigerToken(hashToken(kopf.slice(7))));
}

/** `beenden` läuft höchstens einmal, sobald der Zugang nicht mehr gilt. Ein
 * Lesefehler beendet nichts: Der nächste Takt fragt wieder.
 * @returns Abmelden — im Aufräumpfad des Stroms rufen. */
export function wacheUeberZugang(req: Request, beenden: () => void, taktMs = WACHE_TAKT_MS): () => void {
  let aus = false,
    laeuft = false;
  const pruefe = async () => {
    if (aus || laeuft) return;
    laeuft = true;
    try {
      if (!(await zugangGiltNoch(req)) && !aus) {
        abmelden();
        beenden();
      }
    } catch (e) {
      meldeFehler('strom:zugang', e);
    } finally {
      laeuft = false;
    }
  };
  const uhr = setInterval(pruefe, taktMs);
  uhr.unref?.();
  const weg = beiZugangsAenderung(() => void pruefe());
  function abmelden() {
    aus = true;
    clearInterval(uhr);
    weg();
  }
  return abmelden;
}

/** Das letzte Ereignis eines SSE-Stroms, dessen Zugang endete. */
export const SSE_ZUGANG_BEENDET = 'event: zugang_beendet\ndata: {"reason":"zugang_beendet"}\n\n';
