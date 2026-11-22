/** A budget per account for the logged-in API, weighted by cost (PDF, imports, catalog), so that
 * an account cannot call expensive paths in rapid succession. Counted in the database (api_budget):
 * every web process on it shares the same budget. */
import type { Request, Response, NextFunction } from 'express';
import { userId } from './userId';
import { sendError } from './httpResponse';
import { keyForRequest, type Key } from '../contract';

export const WINDOW_MS = 5 * 60 * 1000;
/** Units per account and window; a read call counts 1. */
export const BUDGET = 600;
/** Job starts per account and window — in addition to the consumption above. */
export const JOB_BUDGET = 20;

export const COST = { normal: 1, abruf: 5, preis: 20, auftrag: 25 } as const;

/** What starts a job, an upload or a run of several seconds.
 * Deliberately enumerated instead of "everything under /admin": a new route should
 * stand out here and not silently land in the normal budget. Contract keys instead of path patterns:
 * what gets classified is the route Express will find, not a spelling of it. */
const JOBS: ReadonlySet<Key> = new Set<Key>([
  'POST /api/v1/sets/partslist-pdf',
  'POST /api/v1/sets/import/csv',
  'POST /api/v1/sets/add-stream',
  'POST /api/v1/parts/import/csv',
  'POST /api/v1/minifigs/import/csv',
  'POST /api/v1/wanted/import/csv',
  'POST /api/v1/wanted-list/import/xml',
  'POST /api/v1/alerts/import/csv',
  'POST /api/v1/settings/import',
  'POST /api/v1/vouchers/pdf',
  'GET /api/v1/settings/export/data',
]);

/** Up to four BrickLink calls per request (two conditions, one fallback each), all from
 * the daily quota that ALL accounts share. */
const PRICE_FETCH: ReadonlySet<Key> = new Set<Key>([
  'GET /api/v1/wanted/:setNumber/preise',
  'GET /api/v1/sets/:setNumber/price',
]);

/** Trigger a fetch from Rebrickable, Brickset, a barcode service or
 * the voucher shop per request. The catalog asks Rebrickable per search; the daily quota there is finite. */
const FOREIGN_FETCH: ReadonlySet<Key> = new Set<Key>([
  'GET /api/v1/sets/info/:setNumber',
  'GET /api/v1/sets/barcode/:barcode',
  'POST /api/v1/sets',
  'POST /api/v1/sets/:setNumber/parts',
  'POST /api/v1/sets/:setNumber/instructions',
  'POST /api/v1/parts',
  'PUT /api/v1/parts/:partNumber/:colorId/color',
  'POST /api/v1/minifigs',
  'POST /api/v1/wanted/:setNumber/:condition/uebernehmen',
  'POST /api/v1/vouchers/:id/guthaben',
]);

/** @param path relative to /api/v1, as apiThrottle sees it there */
export function classification(method: string, path: string): { kosten: number; auftrag: boolean } {
  const k = keyForRequest(method === 'HEAD' ? 'GET' : method, `/api/v1${path}`);
  if (!k) return { kosten: COST.normal, auftrag: false };
  if (JOBS.has(k)) return { kosten: COST.auftrag, auftrag: true };
  if (PRICE_FETCH.has(k)) return { kosten: COST.preis, auftrag: false };
  if (FOREIGN_FETCH.has(k) || k.startsWith('GET /api/v1/catalog')) return { kosten: COST.abruf, auftrag: false };
  return { kosten: COST.normal, auftrag: false };
}

/** The store of the budget (src/throttle, claimApiBudget); src/http knows only its shape. */
export interface BudgetStore {
  claimApiBudget(
    uid: number,
    c: { cost: number; job: boolean; windowS: number; budget: number; jobBudget: number; nowMs: number },
  ): Promise<{ units: number; jobs: number; allowed: boolean; rest_s: string | number }>;
}

/** Rejected requests do not count, otherwise an attack would extend its own lock endlessly. */
export async function checkBudget(store: BudgetStore, uid: number, method: string, path: string, now = Date.now()) {
  const { kosten, auftrag } = classification(method, path);
  const r = await store.claimApiBudget(uid, {
    cost: kosten,
    job: auftrag,
    windowS: WINDOW_MS / 1000,
    budget: BUDGET,
    jobBudget: JOB_BUDGET,
    nowMs: now,
  });
  const restSec = Math.max(1, Number(r.rest_s) || 1);
  return { erlaubt: r.allowed, kosten, auftrag, restSec, units: r.units, auftraege: r.jobs };
}

/** Behind loginAtInbox: without an account there is nothing to limit, and
 * login has its own brakes (src/account/loginLimiter.ts). A database error goes to the error
 * path: without the database the request could not be served anyway. */
export function apiThrottle(store: BudgetStore) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const uid = userId(req);
    if (uid === null) {
      next();
      return;
    }
    let r: Awaited<ReturnType<typeof checkBudget>>;
    try {
      r = await checkBudget(store, uid, req.method, req.path);
    } catch (e) {
      next(e);
      return;
    }
    res.setHeader('RateLimit-Limit', String(BUDGET));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, BUDGET - r.units)));
    res.setHeader('RateLimit-Reset', String(r.restSec));
    if (r.erlaubt) {
      next();
      return;
    }
    res.setHeader('Retry-After', String(r.restSec));
    sendError(req, res, 'zu_viele', 'zu_viele_anfragen', { minuten: Math.max(1, Math.ceil(r.restSec / 60)) });
  };
}
