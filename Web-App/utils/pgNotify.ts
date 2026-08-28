/**
 * PostgreSQL LISTEN/NOTIFY statt Datenbank-Polling.
 *
 * ── Was vorher lief ─────────────────────────────────────────────────────────
 * Zwei Schleifen fragten dauerhaft dieselbe Tabelle ab:
 *   • server.ts alle 5 s   → global_settings.csv_sync_trigger
 *   • dailyScheduler alle 3 s → global_settings.job_reschedule_trigger
 *
 * Zusammen rund 28'800 Abfragen pro Tag und Worker, die praktisch immer nichts
 * finden. Bei mehreren Cluster-Workern entsprechend mehr. Postgres kann das
 * von sich aus melden.
 *
 * ── Warum die Zeile in global_settings trotzdem bleibt ──────────────────────
 * NOTIFY ist flüchtig: Wer im Moment des Signals nicht verbunden ist, bekommt
 * es nie. Der Datenbankeintrag bleibt deshalb die belastbare Quelle, NOTIFY ist
 * nur das Weckmittel. Beim Verbindungsaufbau — und nach jedem Reconnect — läuft
 * jeder Handler einmal an, damit ein währenddessen verpasstes Signal nachgeholt
 * wird. Damit ist kein Poller mehr nötig, ohne dass ein Trigger verlorengeht.
 *
 * Die Verbindung ist bewusst eine eigene, nicht aus dem Pool: Ein Client, der
 * dauerhaft LISTEN hält, wäre im Pool blockiert und stünde für Abfragen nicht
 * mehr zur Verfügung.
 */
import { Client } from 'pg';

/**
 * Handler eines Kanals.
 *
 * Der Payload ist optional, weil Handler auch beim (Wieder-)Verbinden ohne
 * konkretes Signal aufgerufen werden — dann steht dort undefined, und der
 * Handler soll seinen Zustand aus der Datenbank nachziehen.
 */
type Handler = (payload?: string) => void | Promise<void>;

const _handlers = new Map<string, Handler[]>();
let _client: any = null;
let _connecting = false;
let _retryMs = 1000;
/** Läuft ein Reconnect-Timer? Verhindert mehrere Timer für EINEN Abriss. */
let _reconnectTimer: any = null;
/** Nach close() wird nicht wieder verbunden — bis ein neues listen() kommt. */
let _closed = false;

function connectionString() {
  return process.env.DATABASE_URL;
}

async function connect() {
  if (_connecting || _client || _closed) return;
  _connecting = true;
  try {
    const c = new Client({ connectionString: connectionString() });
    c.on('error', () => { retire(c); });
    c.on('end',   () => { retire(c); });
    c.on('notification', (msg: any) => {
      for (const h of _handlers.get(msg.channel) || []) {
        Promise.resolve(h(msg.payload)).catch(e => console.error(`[notify:${msg.channel}]`, e.message));
      }
    });
    await c.connect();
    _client = c;
    _retryMs = 1000;

    for (const channel of _handlers.keys()) {
      await c.query(`LISTEN ${quoteIdent(channel)}`);
    }
    // Aufholen: Ein Signal, das während der Trennung kam, ist verloren — die
    // Handler prüfen ihren Datenbankeintrag deshalb einmal beim Verbinden.
    for (const hs of _handlers.values()) {
      for (const h of hs) Promise.resolve(h()).catch(() => {});
    }
  } catch (e: any) {
    console.error('[notify] Verbindung fehlgeschlagen:', e.message);
    _client = null;
    scheduleReconnect();
  } finally {
    _connecting = false;
  }
}

/**
 * Eine tote Verbindung aus dem Verkehr ziehen.
 *
 * ── Warum das nicht trivial ist ─────────────────────────────────────────────
 * Ein einziger Verbindungsabriss löst beim pg-Client DREI Ereignisse aus, in
 * dieser Reihenfolge (am laufenden Postgres 16 nachgemessen):
 *
 *     error → error → end
 *
 * Die vorherige Fassung hängte an 'error' und 'end' je einen Aufruf von
 * scheduleReconnect(), und dieser rief als Erstes `removeAllListeners()`.
 * Damit war nach dem ERSTEN Ereignis auch der 'error'-Zuhörer weg — und ein
 * 'error'-Ereignis ohne Zuhörer ist in Node kein Logeintrag, sondern eine
 * geworfene Ausnahme. Das ZWEITE 'error' riss also den ganzen Prozess mit:
 *
 *     Error: Connection terminated unexpectedly   → uncaughtException → exit(1)
 *
 * Jeder Postgres-Neustart, jeder Netzaussetzer und jedes Idle-Timeout eines
 * davorliegenden Proxys hat damit den Worker abgeschossen, der die
 * LISTEN-Verbindung hielt. Der Cluster forkt zwar sofort Ersatz, aber alles,
 * was in diesem Worker lief, ist weg: offene SSE-Ströme (die hängen seit dem
 * Umbau je Verbindung an einem Kanal), laufende Anfragen, ein gerade
 * erzeugtes PDF. Und weil bei einem Postgres-Neustart ALLE Worker gleichzeitig
 * ihre Verbindung verlieren, trifft es sie auch alle gleichzeitig.
 *
 * ── Was jetzt gilt ──────────────────────────────────────────────────────────
 * • Der tote Client behält dauerhaft einen leeren 'error'-Zuhörer. Er kostet
 *   nichts und macht jedes Nachzügler-Ereignis harmlos. NIE removeAllListeners()
 *   ohne Ersatz für 'error'.
 * • retire() wirkt nur für den Client, der GERADE der aktive ist — die zwei
 *   Nachzügler desselben Abrisses laufen ins Leere, statt den Backoff dreifach
 *   hochzuzählen und drei Timer zu stellen.
 */
function retire(c: any) {
  try { c.removeAllListeners(); } catch (_) {}
  // Ersatz-Zuhörer BEVOR irgendetwas anderes passiert: Ohne ihn wirft der
  // nächste 'error' des toten Clients und beendet den Prozess.
  try { c.on('error', () => {}); } catch (_) {}
  if (_client !== c) return;   // Nachzügler desselben Abrisses
  _client = null;
  scheduleReconnect();
}

function scheduleReconnect() {
  if (_closed) return;             // nach close() wird nicht wieder verbunden
  if (_reconnectTimer) return;     // es läuft bereits einer
  const wait = _retryMs;
  _retryMs = Math.min(30_000, _retryMs * 2);   // exponentiell, gedeckelt
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    connect().catch(() => {});
  }, wait);
  // Ein wartender Reconnect darf den Prozess nicht am Beenden hindern.
  _reconnectTimer.unref?.();
}

/** Kanalnamen sind Bezeichner und können nicht als Parameter gebunden werden. */
function quoteIdent(name: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Ungültiger Kanalname: ${name}`);
  return `"${name}"`;
}

/**
 * Handler für einen Kanal registrieren. Wird zusätzlich einmal beim
 * (Wieder-)Verbinden aufgerufen, damit verpasste Signale nachgeholt werden.
 */
export function listen(channel: string, handler: Handler) {
  quoteIdent(channel);
  // Ein neues listen() ist die ausdrückliche Absicht zu horchen — es hebt ein
  // vorheriges close() auf (sonst bliebe das Modul nach einem Testlauf oder
  // einem abgebrochenen Shutdown für immer stumm).
  _closed = false;
  if (!_handlers.has(channel)) _handlers.set(channel, []);
  _handlers.get(channel)!.push(handler);
  if (_client) {
    _client.query(`LISTEN ${quoteIdent(channel)}`).catch(() => {});
    Promise.resolve(handler()).catch(() => {});
  } else {
    connect().catch(() => {});
  }
}

/**
 * Signal senden. Läuft über den normalen Pool — NOTIFY braucht keine eigene
 * Verbindung. Fehler werden geschluckt: Der Datenbankeintrag ist die
 * belastbare Quelle, das Signal nur die Beschleunigung.
 */
export async function notify(channel: string, payload = '') {
  try {
    const db = require('../db/database');
    await db.run(`SELECT pg_notify($1, $2)`, [channel, payload]);
  } catch (e: any) {
    console.error(`[notify:${channel}]`, e.message);
  }
}

/**
 * Handler wieder abmelden.
 *
 * Nötig, seit SSE-Verbindungen sich pro offener Verbindung auf einen Kanal
 * setzen (routes/sets.ts): Ohne Gegenstück wüchse _handlers mit jeder
 * geschlossenen Verbindung weiter, und jedes Signal liefe durch tote Handler,
 * die auf ein längst beendetes res schreiben.
 *
 * LISTEN selbst wird bewusst NICHT zurückgenommen, solange noch irgendein
 * Handler auf dem Kanal hängt — und auch danach nicht: Ein überzähliges LISTEN
 * kostet nichts, ein fälschlich entferntes würde stillen Signalverlust
 * bedeuten.
 */
export function unlisten(channel: string, handler: Handler) {
  const hs = _handlers.get(channel);
  if (!hs) return;
  const i = hs.indexOf(handler);
  if (i !== -1) hs.splice(i, 1);
  if (!hs.length) _handlers.delete(channel);
}

/** Für Tests und den geordneten Herunterfahren-Pfad. */
export async function close() {
  // Reihenfolge zählt: erst die Absicht setzen, dann abräumen. Sonst stellt
  // das 'end'-Ereignis von c.end() unten sofort einen neuen Reconnect-Timer,
  // und das Modul verbindet sich NACH dem Herunterfahren wieder — im Test
  // hängt der Prozess dann an einer Verbindung, die niemand mehr will.
  _closed = true;
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  const c = _client;
  _client = null;
  _handlers.clear();
  _retryMs = 1000;
  if (c) {
    try { c.removeAllListeners(); c.on('error', () => {}); } catch (_) {}
    try { await c.end(); } catch (_) {}
  }
}
