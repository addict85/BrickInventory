/** Ein Strom (SSE, NDJSON) lebt Minuten, geprüft wurde sein Zugang aber nur am
 * Anfang. Ohne Wache sähe ein abgemeldetes Gerät oder ein widerrufener Token
 * weiter zu. Geprüft wird im Takt und bei jeder Zugangsänderung im Prozess,
 * ohne Zwischenspeicher und ohne Nebenwirkungen (kein last_used, kein Fehlversuch). */
import type { Request } from 'express';
import { reportError } from '../../infra/error';
import type { AccountServices } from '../area';
import { atAccessChange } from '../accessChange';

export { reportAccessChange } from '../accessChange';

export const WATCH_TICK_MS = 15_000;

function sessionAlive(req: Request): Promise<boolean> {
  const speicher = req.sessionStore;
  if (!speicher || !req.sessionID) return Promise.resolve(true);
  return new Promise((fertig, scheitern) =>
    speicher.get(req.sessionID, (e: unknown, s?: { userId?: number } | null) =>
      e ? scheitern(e) : fertig(s?.userId === req.session.userId),
    ),
  );
}

/** Gilt der Zugang, mit dem die Anfrage kam, jetzt noch? */
export async function accessAppliesStill(konto: AccountServices, req: Request): Promise<boolean> {
  const s = req.session;
  if (s?.userId) {
    if ((await konto.sitzungen.versionFromDb(s.userId)) !== (s.sitzungsVersion ?? 0)) return false;
    // Abmelden löscht nur diese eine Sitzung, die Version bleibt.
    return sessionAlive(req);
  }
  const kopf = String(req.headers.authorization || '');
  if (!kopf.startsWith('Bearer ')) return false;
  return konto.tokenGilt(kopf.slice(7));
}

/** `beenden` läuft höchstens einmal, sobald der Zugang nicht mehr gilt. Ein
 * Lesefehler beendet nichts: Der nächste Takt fragt wieder.
 * @returns Abmelden — im Aufräumpfad des Stroms rufen. */
export function watchViaAccess(
  konto: AccountServices,
  req: Request,
  beenden: () => void,
  taktMs = WATCH_TICK_MS,
): () => void {
  let aus = false,
    laeuft = false;
  const pruefe = async () => {
    if (aus || laeuft) return;
    laeuft = true;
    try {
      if (!(await accessAppliesStill(konto, req)) && !aus) {
        abmelden();
        beenden();
      }
    } catch (e) {
      reportError('strom:zugang', e);
    } finally {
      laeuft = false;
    }
  };
  const uhr = setInterval(pruefe, taktMs);
  uhr.unref?.();
  const weg = atAccessChange(() => void pruefe());
  function abmelden() {
    aus = true;
    clearInterval(uhr);
    weg();
  }
  return abmelden;
}

/** Das letzte Ereignis eines SSE-Stroms, dessen Zugang endete. */
export const SSE_ACCESS_ENDED = 'event: zugang_beendet\ndata: {"reason":"zugang_beendet"}\n\n';
