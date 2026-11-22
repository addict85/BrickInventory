/** An event stream (SSE) for a route: headers, heartbeat, a watch over the
 * access and an end that clears everything exactly once. Every stream must unsubscribe
 * on shutdown, otherwise httpServer.close() waits for it. */
import type { Request, Response } from 'express';
import { registerSse } from '../../http/sseRegistry';
import { sseAccessEnded, watchViaAccess } from './accessWatch';
import type { AccountServices } from '../area';
import { lineToV1 } from '../../http/apiV1Alias';

export interface Stream {
  sende(data: object): void;
  ende(): void;
  /** Runs along at the end, even if the client or the watch triggers it. */
  atEnd(f: () => void): void;
  readonly zu: boolean;
  /** Like sende(), but StromGeschlossen when the stream is closed: the work behind it aborts. */
  sendOrAbort(data: object): void;
}

/** The client is gone. An abort, not an error: whoever catches it reports nothing. */
export class StreamClosed extends Error {
  constructor() {
    super('Strom geschlossen');
    this.name = 'StromGeschlossen';
  }
}

export interface StreamOptions {
  /** Not the same message twice in a row. */
  onlyChanges?: boolean;
  /** Close on backpressure: a hanging client would let Node buffer without limit. */
  backpressure?: string;
  heartbeat?: boolean;
}

export function openStream(konto: AccountServices, req: Request, res: Response, o: StreamOptions = {}): Stream {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const deregister = [registerSse(res)];
  let zu = false,
    lastUsed = '';
  const ende = () => {
    if (zu) return;
    zu = true;
    for (const f of deregister) f();
    if (!res.writableEnded) res.end();
  };
  deregister.push(
    watchViaAccess(konto, req, () => {
      res.write(sseAccessEnded(!!res.locals.apiV1));
      ende();
    }),
  );
  if (o.heartbeat !== false) {
    const clock = setInterval(() => res.write(': keep-alive\n\n'), 20_000);
    deregister.push(() => clearInterval(clock));
  }
  req.on('close', ende);
  const sende = (data: object) => {
    if (zu || res.destroyed) return;
    const json = JSON.stringify(lineToV1(res, data));
    if (o.onlyChanges && json === lastUsed) return;
    lastUsed = json;
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
      else deregister.push(f);
    },
    get zu() {
      return zu;
    },
    sendOrAbort: data => {
      if (zu) throw new StreamClosed();
      sende(data);
    },
  };
}
