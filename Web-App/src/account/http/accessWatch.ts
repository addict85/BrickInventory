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
  const store = req.sessionStore;
  if (!store || !req.sessionID) return Promise.resolve(true);
  return new Promise((finished, fail) =>
    store.get(req.sessionID, (e: unknown, s?: { userId?: number } | null) =>
      e ? fail(e) : finished(s?.userId === req.session.userId),
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
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return false;
  return konto.tokenGilt(header.slice(7));
}

/** `beenden` runs at most once, as soon as the access no longer applies. A
 * read error ends nothing: the next tick asks again.
 * @returns unsubscribe — call it in the stream's cleanup path. */
export function watchViaAccess(
  konto: AccountServices,
  req: Request,
  end: () => void,
  tickMs = WATCH_TICK_MS,
): () => void {
  let from = false,
    running = false;
  const check = async () => {
    if (from || running) return;
    running = true;
    try {
      if (!(await accessAppliesStill(konto, req)) && !from) {
        deregister();
        end();
      }
    } catch (e) {
      reportError('strom:zugang', e);
    } finally {
      running = false;
    }
  };
  const clock = setInterval(check, tickMs);
  clock.unref?.();
  const route = atAccessChange(() => void check());
  function deregister() {
    from = true;
    clearInterval(clock);
    route();
  }
  return deregister;
}

/** The last event of an SSE stream whose access ended; v1 clients get the former German name. */
export const sseAccessEnded = (v1: boolean): string =>
  v1
    ? 'event: zugang_beendet\ndata: {"reason":"zugang_beendet"}\n\n'
    : 'event: access_ended\ndata: {"reason":"access_ended"}\n\n';
