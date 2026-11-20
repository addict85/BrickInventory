/** Ein Ereignisstrom (SSE) für eine Route: Kopfzeilen, Herzschlag, Wache über den
 * Zugang und ein Ende, das alles genau einmal wegräumt. Jeder Strom muss sich
 * beim Herunterfahren abmelden, sonst wartet httpServer.close() auf ihn. */
import type { Request, Response } from 'express';
import { registerSse } from '../../http/sseRegistry';
import { SSE_ACCESS_ENDED, watchViaAccess } from './zugangsWache';
import type { AccountServices } from '../bereich';

export interface Strom {
  sende(daten: object): void;
  ende(): void;
  /** Läuft beim Ende mit, auch wenn es der Client oder die Wache auslöst. */
  atEnd(f: () => void): void;
  readonly zu: boolean;
  /** Wie sende(), aber bei geschlossenem Strom StromGeschlossen: Die Arbeit dahinter bricht ab. */
  sendOrAbortAb(daten: object): void;
}

/** Der Client ist weg. Ein Abbruch, kein Fehler: Wer ihn fängt, meldet nichts. */
export class StromGeschlossen extends Error {
  constructor() {
    super('Strom geschlossen');
    this.name = 'StromGeschlossen';
  }
}

export interface StreamOptions {
  /** Dieselbe Nachricht nicht zweimal hintereinander. */
  onlyChanges?: boolean;
  /** Bei Gegendruck schliessen: Ein hängender Client liesse Node unbegrenzt puffern. */
  backpressure?: string;
  heartbeat?: boolean;
}

export function openStream(konto: AccountServices, req: Request, res: Response, o: StreamOptions = {}): Strom {
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
    watchViaAccess(konto, req, () => {
      res.write(SSE_ACCESS_ENDED);
      ende();
    }),
  );
  if (o.heartbeat !== false) {
    const uhr = setInterval(() => res.write(': keep-alive\n\n'), 20_000);
    abmelden.push(() => clearInterval(uhr));
  }
  req.on('close', ende);
  const sende = (daten: object) => {
    if (zu || res.destroyed) return;
    const json = JSON.stringify(daten);
    if (o.onlyChanges && json === zuletzt) return;
    zuletzt = json;
    if (!res.write(`data: ${json}\n\n`) && o.backpressure) {
      console.warn(`[strom] Gegendruck (${o.backpressure}) — Verbindung wird geschlossen`);
      ende();
    }
  };
  return {
    sende,
    ende,
    atEnd: f => {
      if (zu) f();
      else abmelden.push(f);
    },
    get zu() {
      return zu;
    },
    sendOrAbortAb: daten => {
      if (zu) throw new StromGeschlossen();
      sende(daten);
    },
  };
}
