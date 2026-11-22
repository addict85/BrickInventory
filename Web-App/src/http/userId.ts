import type { Request } from 'express';

/** ONE answer for session and token: before, the question stood in two orders.
 * It lives in src/infra (the lowest level) because the throttle sits there: infra
 * may import neither an HTTP side nor a higher area (test/layers.test.js). */
export function userId(req: Request): number | null {
  const raw = req.session?.userId ?? req.tokenUserId ?? req.apiUser?.user_id;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** If the login is missing behind a guard, the wiring is wrong, not
 * the request — better than `nutzerId(req)!` everywhere. */
export function signedInUserId(req: Request): number {
  const id = userId(req);
  if (id == null) {
    throw new Error('angemeldeteNutzerId ohne Anmeldung — die Route steht vor ihrem Waechter');
  }
  return id;
}
