/**
 * PostgreSQL LISTEN/NOTIFY instead of database polling. Every access (Db) has its
 * own notification: listening connection and handlers belong to it, not to the process.
 */
import { logAndContinue } from '../src/infra/error';
import { Client, type ClientConfig } from 'pg';
import { AsyncResource } from 'node:async_hooks';

/** Without a payload it is called by the (re)connect: the handler then pulls
 * its state from the database instead of following a signal. */
type Handler = (payload?: string) => void | Promise<void>;
/** The handler runs in the frame of its listen(): a stream of a request then
 * queries with its account, a job in the system frame (row-level security, migration 0111). */
type Eintrag = { roh: Handler; lauf: Handler };

/** Channel names are identifiers and cannot be bound as parameters. */
function quoteIdent(name: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Ungültiger Kanalname: ${name}`);
  return `"${name}"`;
}

/** A catch-up without a signal; if it fails, the next signal fetches the state. */
function holeNach(handler: Handler) {
  Promise.resolve(handler()).catch(logAndContinue('notify:nachholen'));
}

/** What an access offers in LISTEN/NOTIFY. */
export interface Signale {
  listen(channel: string, handler: Handler): void;
  listensTo(channel: string): boolean;
  notify(channel: string, payload?: string): Promise<void>;
  unlisten(channel: string, handler: Handler): void;
  close(): Promise<void>;
  /** The same signals, sent over `senden` (the connection of a transaction). */
  ueber(senden: (sql: string, p: unknown[]) => Promise<unknown>): Signale;
}

/** Errors are swallowed: the database row is the reliable source,
 * the signal only the speed-up. */
async function notifyVia(senden: (sql: string, p: unknown[]) => Promise<unknown>, channel: string, payload: string) {
  try {
    await senden(`SELECT pg_notify($1, $2)`, [channel, payload]);
  } catch (e) {
    console.error(`[notify:${channel}]`, (e as Error).message);
  }
}

/** Sent over the access (senden), listened on a connection of its own. */
export class Benachrichtigung implements Signale {
  private readonly _handlers = new Map<string, Eintrag[]>();
  private _client: Client | null = null;
  private _connecting = false;
  private _retryMs = 1000;
  /** Prevents several timers for ONE drop. */
  private _reconnectTimer: NodeJS.Timeout | null = null;
  /** After close() there is no reconnect — until a new listen() comes. */
  private _closed = false;
  /** Channels whose LISTEN is on the live connection; empty while it is missing. */
  private readonly _listens = new Set<string>();

  constructor(
    private readonly verbindung: ClientConfig,
    private readonly senden: (sql: string, p: unknown[]) => Promise<unknown>,
  ) {}

  /** Never throws: a failure schedules the next attempt itself. */
  private async connect() {
    if (this._connecting || this._client || this._closed) return;
    this._connecting = true;
    try {
      const c = new Client({ ...this.verbindung, keepAlive: true });
      c.on('error', () => {
        this.retire(c);
      });
      c.on('end', () => {
        this.retire(c);
      });
      c.on('notification', (msg: import('pg').Notification) => {
        for (const h of this._handlers.get(msg.channel) || []) {
          Promise.resolve(h.lauf(msg.payload)).catch(e => console.error(`[notify:${msg.channel}]`, e.message));
        }
      });
      await c.connect();
      // close() came during the connect: left open it would keep the process alive.
      if (this._closed) {
        c.removeAllListeners();
        c.on('error', () => {});
        await c.end().catch((e: Error) => console.warn('[pg-notify] Verbindung schliessen:', e.message));
        return;
      }
      this._client = c;
      this._retryMs = 1000;
      for (const channel of this._handlers.keys()) await c.query(`LISTEN ${quoteIdent(channel)}`);
      // A signal from the disconnect is lost: the handlers catch up once.
      for (const [channel, hs] of this._handlers) {
        for (const h of hs) holeNach(h.lauf);
        if (this._client === c) this._listens.add(channel);
      }
    } catch (e) {
      console.error('[notify] Verbindung fehlgeschlagen:', (e as Error).message);
      this._client = null;
      this.scheduleReconnect();
    } finally {
      this._connecting = false;
    }
  }

  /** Take a dead connection out of service. */
  private retire(c: Client) {
    c.removeAllListeners();
    // Replacement listener first: otherwise the next 'error' throws and ends the process.
    c.on('error', () => {});
    if (this._client !== c) return; // stragglers of the same drop
    this._client = null;
    this._listens.clear();
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this._closed || this._reconnectTimer) return;
    const wait = this._retryMs;
    this._retryMs = Math.min(30_000, this._retryMs * 2); // exponential, capped
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      void this.connect();
    }, wait);
    // A pending reconnect must not keep the process from exiting.
    this._reconnectTimer.unref?.();
  }

  /** Additionally called once on (re)connect so
   * missed signals are caught up. Lifts a previous close(). */
  listen(channel: string, handler: Handler) {
    quoteIdent(channel);
    this._closed = false;
    if (!this._handlers.has(channel)) this._handlers.set(channel, []);
    this._handlers.get(channel)!.push({ roh: handler, lauf: AsyncResource.bind(handler) });
    const c = this._client;
    if (c) {
      c.query(`LISTEN ${quoteIdent(channel)}`).then(() => {
        holeNach(handler);
        if (this._client === c) this._listens.add(channel);
      }, logAndContinue('notify:listen'));
    } else {
      void this.connect();
    }
  }

  /** Is a signal on this channel currently arriving? Whoever builds a cache on top of it asks here. */
  listensTo(channel: string): boolean {
    return this._listens.has(channel);
  }

  /** Errors are swallowed: the database row is the reliable source,
   * the signal only the speed-up. */
  async notify(channel: string, payload = '') {
    await notifyVia(this.senden, channel, payload);
  }

  ueber(senden: (sql: string, p: unknown[]) => Promise<unknown>): Signale {
    return {
      listen: (c, h) => this.listen(c, h),
      listensTo: c => this.listensTo(c),
      notify: (c, p = '') => notifyVia(senden, c, p),
      unlisten: (c, h) => this.unlisten(c, h),
      close: () => this.close(),
      ueber: s => this.ueber(s),
    };
  }

  unlisten(channel: string, handler: Handler) {
    const hs = this._handlers.get(channel);
    if (!hs) return;
    const i = hs.findIndex(e => e.roh === handler);
    if (i !== -1) hs.splice(i, 1);
    if (!hs.length) {
      this._handlers.delete(channel);
      this._listens.delete(channel);
    }
  }

  /** Set the intent first, then tear down: otherwise the 'end' of c.end() schedules
   * a new reconnect timer, and it reconnects after shutting down. */
  async close() {
    this._closed = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    const c = this._client;
    this._client = null;
    this._listens.clear();
    this._handlers.clear();
    this._retryMs = 1000;
    if (c) {
      c.removeAllListeners();
      c.on('error', () => {});
      await c.end().catch((e: Error) => console.warn('[pg-notify] Verbindung schliessen:', e.message));
    }
  }
}
