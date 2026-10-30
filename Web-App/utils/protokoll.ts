/**
 * Das Serverprotokoll: jede console-Zeile als eine JSON-Zeile auf stdout bzw.
 * stderr (Zeit, Stufe, Nachricht, Prozess, Anfrage, Kontext) — lesbar für
 * Docker, journald und Log-Sammler. Daneben gehen die Zeilen wie bisher nach
 * app_logs für die Protokollansicht der Verwaltung. Schlägt das Schreiben
 * dorthin fehl, wird gezählt und höchstens einmal je Minute gemeldet.
 */
import { AsyncLocalStorage } from 'async_hooks';

/** Kennung der laufenden Anfrage; server.ts setzt sie je Anfrage. */
export const anfrageKontext = new AsyncLocalStorage<{ rid: string }>();

/** Was von aussen als Kennung durchgeht: kein Leerraum, keine Steuer- oder Anführungszeichen. */
const KENNUNG_RE = /^[A-Za-z0-9._:-]{1,64}$/;
let _kennungFolge = 0;

/**
 * Die Kennung einer Anfrage: die des Proxys (X-Request-Id), wenn sie harmlos
 * ist, sonst eine eigene. Ungefiltert könnte ein Client Zeilenumbrüche oder
 * fremde Kennungen ins Protokoll schreiben und Einträge vortäuschen.
 */
export function anfrageKennung(roh: unknown): string {
  const wert = typeof roh === 'string' ? roh : '';
  if (KENNUNG_RE.test(wert)) return wert;
  _kennungFolge = (_kennungFolge + 1) % 1_679_616;
  return _kennungFolge.toString(36).padStart(4, '0');
}

type Stufe = 'debug' | 'info' | 'warn' | 'error';
const STUFEN: Stufe[] = ['debug', 'info', 'warn', 'error'];
const LOG_STUFE: Record<Stufe | 'log', Stufe> = { log: 'info', debug: 'debug', info: 'info', warn: 'warn', error: 'error' };

/** Wohin die Zeilen gehen; im Test ersetzt. */
export interface Ausgabe {
  out(zeile: string): void;
  err(zeile: string): void;
  jetzt(): number;
}
const PROZESS: Ausgabe = {
  out: (z) => { process.stdout.write(z + '\n'); },
  err: (z) => { process.stderr.write(z + '\n'); },
  jetzt: () => Date.now(),
};

interface Abfrager { query(sql: string, werte?: unknown[]): Promise<unknown> }

const MAX_TEXT = 4000;
const MELDE_ABSTAND_MS = 60_000;

/** Eine Angabe als Text; grosse Objekte gekappt, bevor sie durch Puffer und DB wandern. */
function logText(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.stack || a.message;
  try {
    const s = JSON.stringify(a);
    return s && s.length > MAX_TEXT ? s.substring(0, MAX_TEXT) + '…' : (s ?? String(a));
  } catch { return String(a); }
}

const istKontext = (a: unknown): a is Record<string, unknown> =>
  typeof a === 'object' && a !== null && !Array.isArray(a) && !(a instanceof Error);

/**
 * Die Teile einer Zeile: Ein Objekt am Ende ist Kontext, ein Fehler wird
 * Kontext mit Stack; alles andere ergibt die Nachricht.
 */
export function zerlege(args: unknown[]): { nachricht: string; kontext?: Record<string, unknown> } {
  const teile = [...args];
  let kontext: Record<string, unknown> | undefined;
  const letztes = teile[teile.length - 1];
  if (teile.length > 1 && istKontext(letztes)) { kontext = letztes; teile.pop(); }
  const fehler = teile.find((t): t is Error => t instanceof Error);
  if (fehler) kontext = { ...kontext, fehler: { name: fehler.name, message: fehler.message, stack: fehler.stack } };
  const nachricht = teile.map(t => t instanceof Error ? t.message : logText(t)).join(' ').substring(0, MAX_TEXT);
  return kontext ? { nachricht, kontext } : { nachricht };
}

interface Zustand {
  ausgabe: Ausgabe;
  pool: Abfrager | null;
  puffer: { level: string; message: string }[];
  timer: NodeJS.Timeout | null;
  fehlgeschlagen: number;
  letzterFehler: string;
  zuletztGemeldet: number;
  meldeTimer: NodeJS.Timeout | null;
}
let Z: Zustand | null = null;
const pidTag = String(process.pid).slice(-4);

/** Eine Zeile für stdout: JSON, eine Zeile, Felder in fester Reihenfolge. */
export function jsonZeile(stufe: Stufe, args: unknown[], zeit: number, rid?: string): string {
  const { nachricht, kontext } = zerlege(args);
  return JSON.stringify({ zeit: new Date(zeit).toISOString(), stufe, nachricht, pid: process.pid,
    ...(rid ? { rid } : {}), ...(kontext ? { kontext } : {}) });
}

/** Fehlschläge beim Schreiben nach app_logs: sofort, wenn die letzte Meldung eine Minute her ist, sonst gesammelt. */
function schreibfehler(anzahl: number, e: unknown): void {
  if (!Z) return;
  Z.fehlgeschlagen += anzahl;
  Z.letzterFehler = e instanceof Error ? e.message : String(e);
  if (Z.ausgabe.jetzt() - Z.zuletztGemeldet >= MELDE_ABSTAND_MS) { meldeSchreibfehler(); return; }
  if (!Z.meldeTimer) {
    Z.meldeTimer = setTimeout(meldeSchreibfehler, MELDE_ABSTAND_MS - (Z.ausgabe.jetzt() - Z.zuletztGemeldet));
    Z.meldeTimer.unref();
  }
}

/** Die gesammelten Fehlschläge melden — direkt auf stderr, nicht über console (sonst wieder nach app_logs). */
export function meldeSchreibfehler(): void {
  if (!Z) return;
  if (Z.meldeTimer) { clearTimeout(Z.meldeTimer); Z.meldeTimer = null; }
  if (!Z.fehlgeschlagen) return;
  Z.ausgabe.err(jsonZeile('warn', [`app_logs: ${Z.fehlgeschlagen} Zeile(n) nicht geschrieben`,
    { letzter_fehler: Z.letzterFehler }], Z.ausgabe.jetzt()));
  Z.fehlgeschlagen = 0;
  Z.zuletztGemeldet = Z.ausgabe.jetzt();
}

/** Gepufferte Zeilen nach app_logs schreiben. */
export function leereProtokoll(): Promise<void> {
  if (!Z || !Z.pool || !Z.puffer.length) return Promise.resolve();
  const rows = Z.puffer.splice(0);
  const vals = rows.map((_, i) => `($${i * 2 + 1},$${i * 2 + 2})`).join(',');
  return Z.pool.query(`INSERT INTO app_logs (level,message) VALUES ${vals}`, rows.flatMap(r => [r.level, r.message]))
    .then(() => undefined, (e: unknown) => schreibfehler(rows.length, e));
}

/** Ab hier gehen die Zeilen auch nach app_logs; Einträge älter als 48 Stunden werden alle 6 Stunden entfernt. */
export function protokollInDieDatenbank(pool: Abfrager): void {
  if (!Z) return;
  Z.pool = pool;
  void leereProtokoll();
  setInterval(() => {
    pool.query(`DELETE FROM app_logs WHERE logged_at < NOW() - INTERVAL '48 hours'`)
      .catch((e: unknown) => schreibfehler(0, e));
  }, 6 * 60 * 60 * 1000).unref();
}

/**
 * console.log/info/warn/error/debug umleiten. Gibt eine Funktion zurück, die
 * den alten Zustand wiederherstellt (Tests).
 */
export function installiereProtokoll(ausgabe: Ausgabe = PROZESS): () => void {
  const alt = { log: console.log, debug: console.debug, info: console.info, warn: console.warn, error: console.error };
  Z = { ausgabe, pool: null, puffer: [], timer: null, fehlgeschlagen: 0, letzterFehler: '', zuletztGemeldet: -Infinity, meldeTimer: null };
  for (const name of ['log', ...STUFEN] as const) {
    const stufe = LOG_STUFE[name];
    console[name] = (...args: unknown[]) => {
      if (!Z) return;
      const rid = anfrageKontext.getStore()?.rid;
      const zeile = jsonZeile(stufe, args, Z.ausgabe.jetzt(), rid);
      (stufe === 'warn' || stufe === 'error' ? Z.ausgabe.err : Z.ausgabe.out)(zeile);
      // app_logs behält das bisherige Textformat; die Protokollansicht liest es so.
      const { nachricht, kontext } = zerlege(args);
      const text = `[${pidTag}${rid ? '/' + rid : ''}] ${nachricht}${kontext ? ' ' + logText(kontext) : ''}`;
      Z.puffer.push({ level: name === 'log' ? 'log' : stufe, message: text.substring(0, MAX_TEXT) });
      // Ohne Pool (Start, Datenbank weg) wüchse der Puffer unbegrenzt; jede Zeile steht ohnehin auf stdout.
      if (Z.puffer.length > 500) Z.puffer.splice(0, Z.puffer.length - 500);
      if (Z.timer) clearTimeout(Z.timer);
      Z.timer = setTimeout(() => { if (Z) Z.timer = null; void leereProtokoll(); }, 1500);
    };
  }
  return () => {
    if (Z?.timer) clearTimeout(Z.timer);
    if (Z?.meldeTimer) clearTimeout(Z.meldeTimer);
    Z = null;
    Object.assign(console, alt);
  };
}
