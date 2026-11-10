import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { proxyVertrauen, ohneV4Huelle, imDockerNetz, istDockerGateway } from '../infra/proxyVertrauen';

/** Über das Gateway kommen auch Clients herein; geraten wird deshalb nie zu
 * ihm, sondern zu einer festen Proxy-Adresse. */
export function proxyHinweis(trustProxy: string | undefined, warne: (text: string) => void = console.warn) {
  let vertrauen: ReturnType<typeof proxyVertrauen>;
  try {
    vertrauen = proxyVertrauen(trustProxy);
  } catch {
    vertrauen = false;
  }
  // Dieselbe Auswertung wie im Server, damit Hinweis und Wirkung übereinstimmen.
  const pruefer = express();
  pruefer.set('trust proxy', vertrauen);
  const vertraut = pruefer.get('trust proxy fn') as (adresse: string, hop: number) => boolean;
  let gewarnt = vertrauen === false;
  return (req: Request, _res: Response, next: NextFunction) => {
    const von = req.socket?.remoteAddress || '';
    if (!gewarnt && req.headers['x-forwarded-for'] && imDockerNetz(von) && !vertraut(von, 0)) {
      gewarnt = true;
      const ip = ohneV4Huelle(von);
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
}
