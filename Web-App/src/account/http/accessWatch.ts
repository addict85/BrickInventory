/** A stream (SSE, NDJSON) lives for minutes, but its access was only checked at the
 * start. Without a watch, a signed-out device or a revoked token would keep
 * watching. It is checked on each tick and on every access change in the process,
 * without cache and without side effects (no last_used, no failed attempt). */
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

/** Does the access the request came with still apply now? */
export async function accessAppliesStill(konto: AccountServices, req: Request): Promise<boolean> {
  const s = req.session;
  if (s?.userId) {
    if ((await konto.sitzungen.versionFromDb(s.userId)) !== (s.sitzungsVersion ?? 0)) return false;
    // Logging out only deletes this one session, the version stays.
    return sessionAlive(req);
  }
  const kopf = String(req.headers.authorization || '');
  if (!kopf.startsWith('Bearer ')) return false;
  return konto.tokenGilt(kopf.slice(7));
}

/** `beenden` runs at most once, as soon as the access no longer applies. A
 * read error ends nothing: the next tick asks again.
 * @returns unsubscribe — call it in the stream's cleanup path. */
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

/** The last event of an SSE stream whose access ended. */
export const SSE_ACCESS_ENDED = 'event: zugang_beendet\ndata: {"reason":"zugang_beendet"}\n\n';
