/** Ein Ereignisstrom (SSE) für eine Route: Kopfzeilen, Herzschlag, Wache über den
 * Zugang und ein Ende, das alles genau einmal wegräumt. Jeder Strom muss sich
 * beim Herunterfahren abmelden, sonst wartet httpServer.close() auf ihn. */
import type { Request, Response } from 'express';
import { registerSse } from '../../http/sseRegistry';
import { SSE_ZUGANG_BEENDET, wacheUeberZugang } from './zugangsWache';
import type { KontoDienste } from '../bereich';

export interface Strom {
  sende(daten: object): void;
  ende(): void;
  /** Läuft beim Ende mit, auch wenn es der Client oder die Wache auslöst. */
  beiEnde(f: () => void): void;
  readonly zu: boolean;
}

export interface StromOptionen {
  /** Dieselbe Nachricht nicht zweimal hintereinander. */
  nurAenderungen?: boolean;
  /** Bei Gegendruck schliessen: Ein hängender Client liesse Node unbegrenzt puffern. */
  gegendruck?: string;
  herzschlag?: boolean;
}

export function oeffneStrom(konto: KontoDienste, req: Request, res: Response, o: StromOptionen = {}): Strom {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const abmelden = [registerSse(res)];
  let zu = false,
    zuletzt = '';
  const ende = () => {
    if (zu) return;
    zu = true;
    for (const f of abmelden) f();
    if (!res.writableEnded) res.end();
  };
  abmelden.push(
    wacheUeberZugang(konto, req, () => {
      res.write(SSE_ZUGANG_BEENDET);
      ende();
    }),
  );
  if (o.herzschlag !== false) {
    const uhr = setInterval(() => res.write(': keep-alive\n\n'), 20_000);
    abmelden.push(() => clearInterval(uhr));
  }
  req.on('close', ende);
  const sende = (daten: object) => {
    if (zu || res.destroyed) return;
    const json = JSON.stringify(daten);
    if (o.nurAenderungen && json === zuletzt) return;
    zuletzt = json;
    if (!res.write(`data: ${json}\n\n`) && o.gegendruck) {
      console.warn(`[strom] Gegendruck (${o.gegendruck}) — Verbindung wird geschlossen`);
      ende();
    }
  };
  return {
    sende,
    ende,
    beiEnde: f => {
      if (zu) f();
      else abmelden.push(f);
    },
    get zu() {
      return zu;
    },
  };
}
