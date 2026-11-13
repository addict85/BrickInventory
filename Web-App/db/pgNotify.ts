/**
 * PostgreSQL LISTEN/NOTIFY statt Datenbank-Polling. Jeder Zugang (Db) hat seine
 * eigene Benachrichtigung: Horch-Verbindung und Handler gehören ihm, nicht dem Prozess.
 */
import { logAndContinue } from '../src/infra/fehler';
import { Client, type ClientConfig } from 'pg';
import { AsyncResource } from 'node:async_hooks';

/** Ohne Payload ruft der (Wieder-)Verbindungsaufbau: Dann zieht der Handler
 * seinen Zustand aus der Datenbank nach, statt einem Signal zu folgen. */
type Handler = (payload?: string) => void | Promise<void>;
/** Der Handler läuft im Rahmen seines listen(): Ein Strom einer Anfrage fragt
 * dann mit deren Konto, ein Auftrag im Systemrahmen (Zeilenschutz, Migration 0110). */
type Eintrag = { roh: Handler; lauf: Handler };

/** Kanalnamen sind Bezeichner und können nicht als Parameter gebunden werden. */
function quoteIdent(name: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Ungültiger Kanalname: ${name}`);
  return `"${name}"`;
}

/** Gesendet wird über den Zugang (senden), gehorcht auf einer eigenen Verbindung. */
export class Benachrichtigung {
  private readonly _handlers = new Map<string, Eintrag[]>();
  private _client: Client | null = null;
  private _connecting = false;
  private _retryMs = 1000;
  /** Verhindert mehrere Timer für EINEN Abriss. */
  private _reconnectTimer: NodeJS.Timeout | null = null;
  /** Nach close() wird nicht wieder verbunden — bis ein neues listen() kommt. */
  private _closed = false;
  /** Kanäle, deren LISTEN auf der lebenden Verbindung steht; leer, solange sie fehlt. */
  private readonly _lauscht = new Set<string>();

  constructor(
    private readonly verbindung: ClientConfig,
    private readonly senden: (sql: string, p: unknown[]) => Promise<unknown>,
  ) {}

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
      // close() kam während des Aufbaus: offen gelassen hielte sie den Prozess am Leben.
      if (this._closed) {
        c.removeAllListeners();
        c.on('error', () => {});
        await c.end().catch((e: Error) => console.warn('[pg-notify] Verbindung schliessen:', e.message));
        return;
      }
      this._client = c;
      this._retryMs = 1000;
      for (const channel of this._handlers.keys()) await c.query(`LISTEN ${quoteIdent(channel)}`);
      // Ein Signal aus der Trennung ist verloren: Die Handler holen einmal nach.
      for (const [channel, hs] of this._handlers) {
        for (const h of hs) Promise.resolve(h.lauf()).catch(logAndContinue('notify:h'));
        if (this._client === c) this._lauscht.add(channel);
      }
    } catch (e) {
      console.error('[notify] Verbindung fehlgeschlagen:', (e as Error).message);
      this._client = null;
      this.scheduleReconnect();
    } finally {
      this._connecting = false;
    }
  }

  /** Eine tote Verbindung aus dem Verkehr ziehen. */
  private retire(c: Client) {
    c.removeAllListeners();
    // Ersatz-Zuhörer zuerst: Sonst wirft der nächste 'error' und beendet den Prozess.
    c.on('error', () => {});
    if (this._client !== c) return; // Nachzügler desselben Abrisses
    this._client = null;
    this._lauscht.clear();
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this._closed || this._reconnectTimer) return;
    const wait = this._retryMs;
    this._retryMs = Math.min(30_000, this._retryMs * 2); // exponentiell, gedeckelt
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect().catch(logAndContinue('notify:connect'));
    }, wait);
    // Ein wartender Reconnect darf den Prozess nicht am Beenden hindern.
    this._reconnectTimer.unref?.();
  }

  /** Wird zusätzlich einmal beim (Wieder-)Verbinden aufgerufen, damit
   * verpasste Signale nachgeholt werden. Hebt ein vorheriges close() auf. */
  listen(channel: string, handler: Handler) {
    quoteIdent(channel);
    this._closed = false;
    if (!this._handlers.has(channel)) this._handlers.set(channel, []);
    this._handlers.get(channel)!.push({ roh: handler, lauf: AsyncResource.bind(handler) });
    const c = this._client;
    if (c) {
      c.query(`LISTEN ${quoteIdent(channel)}`).then(() => {
        Promise.resolve(handler()).catch(logAndContinue('notify:handler'));
        if (this._client === c) this._lauscht.add(channel);
      }, logAndContinue('notify:quoteIdent'));
    } else {
      this.connect().catch(logAndContinue('notify:connect'));
    }
  }

  /** Kommt ein Signal auf diesem Kanal gerade an? Wer darauf einen Zwischenspeicher baut, fragt hier. */
  hoertZu(channel: string): boolean {
    return this._lauscht.has(channel);
  }

  /** Fehler werden geschluckt: Der Datenbankeintrag ist die belastbare Quelle,
   * das Signal nur die Beschleunigung. */
  async notify(channel: string, payload = '') {
    try {
      await this.senden(`SELECT pg_notify($1, $2)`, [channel, payload]);
    } catch (e) {
      console.error(`[notify:${channel}]`, (e as Error).message);
    }
  }

  unlisten(channel: string, handler: Handler) {
    const hs = this._handlers.get(channel);
    if (!hs) return;
    const i = hs.findIndex(e => e.roh === handler);
    if (i !== -1) hs.splice(i, 1);
    if (!hs.length) {
      this._handlers.delete(channel);
      this._lauscht.delete(channel);
    }
  }

  /** Erst die Absicht setzen, dann abräumen: Sonst stellt das 'end' von c.end()
   * einen neuen Reconnect-Timer, und es verbindet sich nach dem Herunterfahren wieder. */
  async close() {
    this._closed = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    const c = this._client;
    this._client = null;
    this._lauscht.clear();
    this._handlers.clear();
    this._retryMs = 1000;
    if (c) {
      c.removeAllListeners();
      c.on('error', () => {});
      await c.end().catch((e: Error) => console.warn('[pg-notify] Verbindung schliessen:', e.message));
    }
  }
}
