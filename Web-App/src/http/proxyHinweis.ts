import express from 'express';
import type { Application, Request, Response, NextFunction } from 'express';
import { proxyVertrauen, ohneV4Huelle, imDockerNetz, istDockerGateway } from '../infra/proxyVertrauen';

/** Ab hier gilt „immer dieselbe Client-Adresse“ nicht mehr als Zufall eines
 * einzelnen Nutzers, sondern als Zeichen eines weiteren Proxys vor Caddy. */
export const EINE_ADRESSE = { anfragen: 300, ms: 60 * 60_000 };

export type ProxyStand =
  | { art: 'gateway' | 'docker_netz'; vars: { ip: string } }
  | { art: 'eine_adresse'; vars: { ip: string; minuten: number; anzahl: number } };
/** Der Verwalter liest das Protokoll selten; Hintergrundarbeiten zeigt den Hinweis des Hinweisgebers,
 * den startup/app.ts in app.locals ablegt (GET /admin/jobs). */
export function proxyHinweisStand(app: Application): ProxyStand | null {
  return (app.locals.proxyHinweis as ReturnType<typeof proxyHinweis> | undefined)?.stand() ?? null;
}

/** Über das Gateway kommen auch Clients herein; geraten wird deshalb nie zu
 * ihm, sondern zu einer festen Proxy-Adresse. */
export function proxyHinweis(
  trustProxy: string | undefined,
  warne: (text: string) => void = console.warn,
  uhr: () => number = Date.now,
  netzBestaetigt = false,
) {
  let vertrauen: ReturnType<typeof proxyVertrauen>;
  try {
    vertrauen = proxyVertrauen(trustProxy, netzBestaetigt);
  } catch {
    vertrauen = false;
  }
  // Dieselbe Auswertung wie im Server, damit Hinweis und Wirkung übereinstimmen.
  const pruefer = express();
  pruefer.set('trust proxy', vertrauen);
  const vertraut = pruefer.get('trust proxy fn') as (adresse: string, hop: number) => boolean;
  let gewarnt = vertrauen === false;
  let stand: ProxyStand | null = null;
  const eineAdresse = einzigeClientAdresse(Array.isArray(vertrauen), warne, uhr, s => {
    stand = s;
  });
  const mw = (req: Request, _res: Response, next: NextFunction) => {
    const von = req.socket?.remoteAddress || '';
    if (req.headers['x-forwarded-for'] && vertraut(von, 0)) eineAdresse(req.ip, von);
    if (!gewarnt && req.headers['x-forwarded-for'] && imDockerNetz(von) && !vertraut(von, 0)) {
      gewarnt = true;
      const ip = ohneV4Huelle(von);
      stand = { art: istDockerGateway(von) ? 'gateway' : 'docker_netz', vars: { ip } };
      warne(
        istDockerGateway(von)
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
function einzigeClientAdresse(
  aktiv: boolean,
  warne: (text: string) => void,
  uhr: () => number,
  merke: (s: ProxyStand) => void,
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
    if (anzahl < EINE_ADRESSE.anfragen || uhr() - seit < EINE_ADRESSE.ms) return;
    fertig = true;
    merke({ art: 'eine_adresse', vars: { ip: ohneV4Huelle(ip), minuten, anzahl } });
    warne(
      `⚠️ [sicherheit] Seit ${minuten} Minuten kommen alle ${anzahl} Anfragen über den Proxy mit derselben ` +
        `Client-Adresse ${ohneV4Huelle(ip)}. Steht vor Caddy ein weiterer Proxy (z. B. Nginx Proxy Manager), ` +
        'teilen sich alle Clients diese Adresse: Fehlversuche eines Fremden sperren alle aus, Registrierung und ' +
        '„Passwort vergessen“ sind für alle zusammen gedrosselt. Die Adresse dieses Proxys in VORGELAGERTER_PROXY ' +
        '(.env) eintragen — siehe README.md, Abschnitt „Proxy vor Caddy“.',
    );
  };
}
