import express from 'express';
import type { Application, Request, Response, NextFunction } from 'express';
import { proxyVertrauen, withoutV4Shell, inDockerNetwork, isDockerGateway } from '../infra/proxyTrust';

/** Ab hier gilt „immer dieselbe Client-Adresse“ nicht mehr als Zufall eines
 * einzelnen Nutzers, sondern als Zeichen eines weiteren Proxys vor Caddy. */
export const EINE_ADDRESS = { anfragen: 300, ms: 60 * 60_000 };

export type ProxyStand =
  | { art: 'gateway' | 'docker_netz'; vars: { ip: string } }
  | { art: 'eine_adresse'; vars: { ip: string; minuten: number; anzahl: number } };
/** Der Verwalter liest das Protokoll selten; Hintergrundarbeiten zeigt den Hinweis des Hinweisgebers,
 * den startup/app.ts in app.locals ablegt (GET /admin/jobs). */
export function proxyHintStatus(app: Application): ProxyStand | null {
  return (app.locals.proxyHinweis as ReturnType<typeof proxyHinweis> | undefined)?.stand() ?? null;
}

/** Über das Gateway kommen auch Clients herein; geraten wird deshalb nie zu
 * ihm, sondern zu einer festen Proxy-Adresse. */
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
  // Dieselbe Auswertung wie im Server, damit Hinweis und Wirkung übereinstimmen.
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

/** Steht ein zweiter Proxy vor Caddy, kommt immer dessen Adresse an; gemeldet wird
 * erst nach vielen Anfragen über lange Zeit, damit ein einzelner Nutzer nicht zählt. */
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
    // Ohne ausgewertetes X-Forwarded-For (ausserhalb der Produktion) gibt es nichts zu zählen.
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
