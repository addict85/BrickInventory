import type { Request, Response } from 'express';
import { meldeFehler } from '../../infra/fehler';
import { PUBLIC_DIR } from '../../infra/appPaths';
import { renderIndexHtml } from '../indexHtml';

/** Renderer statt sendFile, sonst gingen die Assets ohne Stempel hinaus. Fällt
 * das Rendern aus, geht die Datei unverändert; js/theme-boot.js übernimmt. */
export async function sendeStartseite(res: Pick<Response, 'type' | 'sendFile'>, userId?: number): Promise<void> {
  await renderIndexHtml(userId).then(
    html => {
      res.type('html').send(html);
    },
    (e: unknown) => {
      meldeFehler('startseite:rendern', e);
      res.sendFile('index.html', { root: PUBLIC_DIR });
    },
  );
}

/** Ältere Mails (?token=) gelten weiter, aber ins Fragment, bevor die Seite lädt: Sonst trügen
 * die Referer ihrer Dateien den Token in weitere Protokollzeilen. Mailtokens sind hex. */
export function tokenInsFragment(req: Request, res: Response): boolean {
  const token = req.query.token;
  if (typeof token !== 'string' || !/^[0-9a-f]{1,128}$/i.test(token)) return false;
  res.redirect(303, `${req.path}#token=${token}`);
  return true;
}
