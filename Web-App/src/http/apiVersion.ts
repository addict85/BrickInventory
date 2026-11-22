import type { Request, Response, NextFunction } from 'express';
import { sendError } from './httpResponse';
import { API_MIN_APP } from '../contract/version';
export { API_VERSION, API_MIN_APP } from '../contract/version';

/** Rejected before the app misreads responses. Without the header
 * (browsers, scripts) none of this applies. */
export function checkAppVersion(req: Request, res: Response, next: NextFunction): void {
  const raw = req.get('X-App-Api');
  const version = raw === undefined ? NaN : Number(raw);
  if (Number.isInteger(version) && version < API_MIN_APP) {
    sendError(req, res, 'zu_alt', 'app_too_old', { min: API_MIN_APP });
    return;
  }
  next();
}
