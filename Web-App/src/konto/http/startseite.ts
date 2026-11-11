import type { Response } from 'express';
import { meldeFehler } from '../../infra/fehler';
import { PUBLIC_DIR } from '../../infra/appPaths';
import { renderIndexHtml } from '../indexHtml';

/** Renderer statt sendFile, sonst gingen die Assets ohne Stempel hinaus. Fällt
 * das Rendern aus, geht die Datei unverändert; js/00-theme-boot.js übernimmt. */
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
