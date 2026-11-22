import express from 'express';
import type { Application, Request, Response, NextFunction } from 'express';
import { proxyVertrauen, withoutV4Shell, inDockerNetwork, isDockerGateway } from '../infra/proxyTrust';

/** From here on "always the same client address" no longer counts as the coincidence of a
 * single user, but as a sign of a further proxy in front of Caddy. */
export const EINE_ADDRESS = { anfragen: 300, ms: 60 * 60_000 };

export type ProxyStand =
  | { art: 'gateway' | 'docker_netz'; vars: { ip: string } }
  | { art: 'eine_adresse'; vars: { ip: string; minuten: number; anzahl: number } };
/** The admin rarely reads the log; background jobs shows the hint of the hint giver,
 * which startup/app.ts stores in app.locals (GET /admin/jobs). */
export function proxyHintStatus(app: Application): ProxyStand | null {
  return (app.locals.proxyHinweis as ReturnType<typeof proxyHinweis> | undefined)?.stand() ?? null;
}

/** Clients come in via the gateway as well; that is why the guess is never
 * the gateway, but a fixed proxy address. */
export function proxyHinweis(
  trustProxy: string | undefined,
  warne: (text: string) => void = console.warn,
  uhr: () => number = Date.now,
  networkConfirmed = false,
) {
  let vertrauen: ReturnType<typeof proxyVertrauen>;
  try {
    vertrauen = proxyVertrauen(trustProxy, networkConfirmed);
  } catch {
    vertrauen = false;
  }
  // The same evaluation as in the server, so that hint and effect match.
  const checker = express();
  checker.set('trust proxy', vertrauen);
  const vertraut = checker.get('trust proxy fn') as (adresse: string, hop: number) => boolean;
  let warned = vertrauen === false;
  let stand: ProxyStand | null = null;
  const eineAddress = onlyClientAddress(Array.isArray(vertrauen), warne, uhr, s => {
    stand = s;
  });
  const mw = (req: Request, _res: Response, next: NextFunction) => {
    const von = req.socket?.remoteAddress || '';
    if (req.headers['x-forwarded-for'] && vertraut(von, 0)) eineAddress(req.ip, von);
    if (!warned && req.headers['x-forwarded-for'] && inDockerNetwork(von) && !vertraut(von, 0)) {
      warned = true;
      const ip = withoutV4Shell(von);
      stand = { art: isDockerGateway(von) ? 'gateway' : 'docker_netz', vars: { ip } };
      warne(
        isDockerGateway(von)
          ? `⚠️ [sicherheit] X-Forwarded-For kommt über das Docker-Gateway ${ip} und wird verworfen. Über das Gateway ` +
              'erreichen auch Clients selbst den Server; ihm zu vertrauen hiesse, ihnen ihre Adresse zu glauben. Den ' +
              'Reverse-Proxy mit fester Adresse ins Netz brickinventory-net stellen und genau diese in TRUST_PROXY ' +
              'eintragen — siehe compose.yaml und README.md.'
          : `⚠️ [sicherheit] Ein Reverse-Proxy erreicht den Server aus dem Docker-Netz unter ${ip}. Sein X-Forwarded-For ` +
              'wird verworfen, und alle Clients teilen sich eine Adresse (Anmeldesperre, Drosseln). Ist das der eigene ' +
              `Proxy, ihm eine feste Adresse geben und TRUST_PROXY=${ip} setzen — siehe README.md.`,
      );
    }
    next();
  };
  return Object.assign(mw, { stand: () => stand });
}

/** If a second proxy stands in front of Caddy, its address always arrives; a report only
 * happens after many requests over a long time, so that a single user does not count. */
function onlyClientAddress(
  aktiv: boolean,
  warne: (text: string) => void,
  uhr: () => number,
  remember: (s: ProxyStand) => void,
) {
  let fertig = !aktiv;
  let erste: string | undefined;
  let seit = 0;
  let anzahl = 0;
  return (ip: string | undefined, von: string) => {
    // Without an evaluated X-Forwarded-For (outside production) there is nothing to count.
    if (fertig || !ip || ip === von) return;
    if (erste === undefined) {
      erste = ip;
      seit = uhr();
    }
    if (ip !== erste) {
      fertig = true;
      return;
    }
    anzahl++;
    const minuten = Math.floor((uhr() - seit) / 60_000);
    if (anzahl < EINE_ADDRESS.anfragen || uhr() - seit < EINE_ADDRESS.ms) return;
    fertig = true;
    remember({ art: 'eine_adresse', vars: { ip: withoutV4Shell(ip), minuten, anzahl } });
    warne(
      `⚠️ [sicherheit] Seit ${minuten} Minuten kommen alle ${anzahl} Anfragen über den Proxy mit derselben ` +
        `Client-Adresse ${withoutV4Shell(ip)}. Steht vor Caddy ein weiterer Proxy (z. B. Nginx Proxy Manager), ` +
        'teilen sich alle Clients diese Adresse: Fehlversuche eines Fremden sperren alle aus, Registrierung und ' +
        '„Passwort vergessen“ sind für alle zusammen gedrosselt. Die Adresse dieses Proxys in VORGELAGERTER_PROXY ' +
        '(.env) eintragen — siehe README.md, Abschnitt „Proxy vor Caddy“.',
    );
  };
}
