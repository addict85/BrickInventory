/** Jede console-Zeile als JSON-Zeile für Docker und Log-Sammler, daneben nach
 * app_logs für die Verwaltung. Schreibfehler dorthin höchstens einmal je
 * Minute melden. */
import { AsyncLocalStorage } from 'node:async_hooks';
import * as logs from './repository/appLogs';

export const anfrageKontext = new AsyncLocalStorage<{ rid: string }>();

/** Kein Leerraum, keine Steuer- oder Anführungszeichen. */
const KENNUNG_RE = /^[A-Za-z0-9._:-]{1,64}$/;
let _kennungFolge = 0;

/** Ungefiltert könnte ein Client Zeilenumbrüche oder fremde Kennungen ins
 * Protokoll schreiben und Einträge vortäuschen. */
export function anfrageKennung(roh: unknown): string {
  const wert = typeof roh === 'string' ? roh : '';
  if (KENNUNG_RE.test(wert)) return wert;
  _kennungFolge = (_kennungFolge + 1) % 1_679_616;
  return _kennungFolge.toString(36).padStart(4, '0');
}

type Stufe = 'debug' | 'info' | 'warn' | 'error';
const STUFEN: Stufe[] = ['debug', 'info', 'warn', 'error'];
const LOG_STUFE: Record<Stufe | 'log', Stufe> = {
  log: 'info',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

/** Im Test ersetzt. */
export interface Ausgabe {
  out(zeile: string): void;
  err(zeile: string): void;
  jetzt(): number;
}
const PROZESS: Ausgabe = {
  out: z => {
    process.stdout.write(z + '\n');
  },
  err: z => {
    process.stderr.write(z + '\n');
  },
  jetzt: () => Date.now(),
};

type Abfrager = logs.Abfrager;

const MAX_TEXT = 4000;
const MELDE_ABSTAND_MS = 60_000;

/** Grosse Objekte gekappt, bevor sie durch Puffer und DB wandern. */
function logText(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.stack || a.message;
  try {
    const s = JSON.stringify(a);
    return s && s.length > MAX_TEXT ? s.substring(0, MAX_TEXT) + '…' : (s ?? String(a));
  } catch {
    return String(a);
  }
}

const istKontext = (a: unknown): a is Record<string, unknown> =>
  typeof a === 'object' && a !== null && !Array.isArray(a) && !(a instanceof Error);

export function zerlege(args: unknown[]): { nachricht: string; kontext?: Record<string, unknown> } {
  const teile = [...args];
  let kontext: Record<string, unknown> | undefined;
  const letztes = teile[teile.length - 1];
  if (teile.length > 1 && istKontext(letztes)) {
    kontext = letztes;
    teile.pop();
  }
  const fehler = teile.find((t): t is Error => t instanceof Error);
  if (fehler) kontext = { ...kontext, fehler: { name: fehler.name, message: fehler.message, stack: fehler.stack } };
  const nachricht = teile
    .map(t => (t instanceof Error ? t.message : logText(t)))
    .join(' ')
    .substring(0, MAX_TEXT);
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
  aufraeumTakt: NodeJS.Timeout | null;
}
let Z: Zustand | null = null;
const pidTag = String(process.pid).slice(-4);

/** Felder in fester Reihenfolge. */
export function jsonZeile(stufe: Stufe, args: unknown[], zeit: number, rid?: string): string {
  const { nachricht, kontext } = zerlege(args);
  return JSON.stringify({
    zeit: new Date(zeit).toISOString(),
    stufe,
    nachricht,
    pid: process.pid,
    ...(rid ? { rid } : {}),
    ...(kontext ? { kontext } : {}),
  });
}

function schreibfehler(anzahl: number, e: unknown): void {
  if (!Z) return;
  Z.fehlgeschlagen += anzahl;
  Z.letzterFehler = e instanceof Error ? e.message : String(e);
  if (Z.ausgabe.jetzt() - Z.zuletztGemeldet >= MELDE_ABSTAND_MS) {
    meldeSchreibfehler();
    return;
  }
  if (!Z.meldeTimer) {
    Z.meldeTimer = setTimeout(meldeSchreibfehler, MELDE_ABSTAND_MS - (Z.ausgabe.jetzt() - Z.zuletztGemeldet));
    Z.meldeTimer.unref();
  }
}

/** Direkt auf stderr, nicht über console — sonst wieder nach app_logs. */
export function meldeSchreibfehler(): void {
  if (!Z) return;
  if (Z.meldeTimer) {
    clearTimeout(Z.meldeTimer);
    Z.meldeTimer = null;
  }
  if (!Z.fehlgeschlagen) return;
  Z.ausgabe.err(
    jsonZeile(
      'warn',
      [`app_logs: ${Z.fehlgeschlagen} Zeile(n) nicht geschrieben`, { letzter_fehler: Z.letzterFehler }],
      Z.ausgabe.jetzt(),
    ),
  );
  Z.fehlgeschlagen = 0;
  Z.zuletztGemeldet = Z.ausgabe.jetzt();
}

export function leereProtokoll(): Promise<void> {
  if (!Z?.pool || !Z.puffer.length) return Promise.resolve();
  const rows = Z.puffer.splice(0);
  return logs.schreibeLogZeilen(Z.pool, rows).then(
    () => undefined,
    (e: unknown) => schreibfehler(rows.length, e),
  );
}

export function protokollInDieDatenbank(pool: Abfrager): void {
  if (!Z) return;
  Z.pool = pool;
  void leereProtokoll();
  if (Z.aufraeumTakt) clearInterval(Z.aufraeumTakt);
  Z.aufraeumTakt = setInterval(
    () => {
      logs.loescheAlteLogZeilen(pool).catch((e: unknown) => schreibfehler(0, e));
    },
    6 * 60 * 60 * 1000,
  );
  Z.aufraeumTakt.unref();
}

/** Als Letztes vor dem Schliessen des Pools, damit die Meldungen der übrigen
 * Abschlüsse noch in app_logs landen; danach geht nur noch stdout. */
export async function stoppeProtokoll(): Promise<void> {
  if (!Z) return;
  if (Z.timer) clearTimeout(Z.timer);
  if (Z.aufraeumTakt) clearInterval(Z.aufraeumTakt);
  Z.timer = Z.aufraeumTakt = null;
  await leereProtokoll();
  meldeSchreibfehler();
  Z.pool = null;
}

/** Gibt eine Funktion zurück, die den alten Zustand wiederherstellt (Tests). */
export function installiereProtokoll(ausgabe: Ausgabe = PROZESS): () => void {
  const alt = { log: console.log, debug: console.debug, info: console.info, warn: console.warn, error: console.error };
  Z = {
    ausgabe,
    pool: null,
    puffer: [],
    timer: null,
    fehlgeschlagen: 0,
    letzterFehler: '',
    zuletztGemeldet: -Infinity,
    meldeTimer: null,
    aufraeumTakt: null,
  };
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
      // Ohne Pool wüchse der Puffer unbegrenzt; jede Zeile steht ohnehin auf stdout.
      if (Z.puffer.length > 500) Z.puffer.splice(0, Z.puffer.length - 500);
      if (Z.timer) clearTimeout(Z.timer);
      Z.timer = setTimeout(() => {
        if (Z) Z.timer = null;
        void leereProtokoll();
      }, 1500);
    };
  }
  return () => {
    if (Z?.timer) clearTimeout(Z.timer);
    if (Z?.meldeTimer) clearTimeout(Z.meldeTimer);
    if (Z?.aufraeumTakt) clearInterval(Z.aufraeumTakt);
    Z = null;
    Object.assign(console, alt);
  };
}
