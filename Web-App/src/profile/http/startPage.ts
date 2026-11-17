import type { Request, Response } from 'express';
import { meldeFehler } from '../../infra/fehler';
import { PUBLIC_DIR } from '../../infra/appPaths';
import type { ProfileServices } from '../area';

/** Renderer instead of sendFile, or the assets would go out without a stamp. If
 * rendering fails, the file goes out unchanged; js/theme-boot.js takes over. */
export async function sendStartPage(
  profile: ProfileServices,
  res: Pick<Response, 'type' | 'sendFile'>,
  userId?: number,
): Promise<void> {
  await profile.startPageHtml(userId).then(
    html => {
      res.type('html').send(html);
    },
    (e: unknown) => {
      meldeFehler('startseite:rendern', e);
      res.sendFile('index.html', { root: PUBLIC_DIR });
    },
  );
}

/** Older mail links (?token=) still work, but into the fragment before the page loads: otherwise
 * referers from its files would carry the token into further log lines. Mail tokens are hex. */
const MAIL_PAGES = new Set(['/verify', '/reset-password']);
export function tokenToFragment(req: Request, res: Response): boolean {
  const token = req.query.token;
  const page = req.path.toLowerCase().replace(/\/$/, '');
  if (typeof token !== 'string' || !/^[0-9a-f]{1,128}$/i.test(token) || !MAIL_PAGES.has(page)) return false;
  res.redirect(303, `${page}#token=${token}`);
  return true;
}
