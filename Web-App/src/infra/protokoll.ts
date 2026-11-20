/** Jede console-Zeile als JSON-Zeile für Docker und Log-Sammler, daneben nach
 * app_logs für die Verwaltung. Schreibfehler dorthin höchstens einmal je
 * Minute melden. */
import * as logs from './repository/appLogs';
import { prozessweit } from './prozessweit';

export { requestContext } from './kontoKontext';
import { requestContext } from './kontoKontext';

/** Kein Leerraum, keine Steuer- oder Anführungszeichen. */
const ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const K = prozessweit('anfrageKennung', () => ({ sequence: 0 }));

/** Ungefiltert könnte ein Client Zeilenumbrüche oder fremde Kennungen ins
 * Protokoll schreiben und Einträge vortäuschen. */
export function anfrageKennung(roh: unknown): string {
  const wert = typeof roh === 'string' ? roh : '';
  if (ID_RE.test(wert)) return wert;
  K.sequence = (K.sequence + 1) % 1_679_616;
  return K.sequence.toString(36).padStart(4, '0');
}

type Stufe = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Stufe[] = ['debug', 'info', 'warn', 'error'];
const LOG_LEVEL: Record<Stufe | 'log', Stufe> = {
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
const PROCESS: Ausgabe = {
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
const REPORT_GAP_MS = 60_000;

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

const isContext = (a: unknown): a is Record<string, unknown> =>
  typeof a === 'object' && a !== null && !Array.isArray(a) && !(a instanceof Error);

export function split(args: unknown[]): { nachricht: string; kontext?: Record<string, unknown> } {
  const teile = [...args];
  let kontext: Record<string, unknown> | undefined;
  const letztes = teile[teile.length - 1];
  if (teile.length > 1 && isContext(letztes)) {
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
  output: Ausgabe;
  pool: Abfrager | null;
  puffer: { level: string; message: string }[];
  timer: NodeJS.Timeout | null;
  fehlgeschlagen: number;
  lastError: string;
  lastlyReported: number;
  reportTimer: NodeJS.Timeout | null;
  onRaeumTick: NodeJS.Timeout | null;
}
const P = prozessweit('protokoll', () => ({ z: null as Zustand | null }));
const pidTag = String(process.pid).slice(-4);

/** Felder in fester Reihenfolge. */
export function jsonRow(stufe: Stufe, args: unknown[], zeit: number, rid?: string): string {
  const { nachricht, kontext } = split(args);
  return JSON.stringify({
    zeit: new Date(zeit).toISOString(),
    stufe,
    nachricht,
    pid: process.pid,
    ...(rid ? { rid } : {}),
    ...(kontext ? { kontext } : {}),
  });
}

function writeError(anzahl: number, e: unknown): void {
  if (!P.z) return;
  P.z.fehlgeschlagen += anzahl;
  P.z.lastError = e instanceof Error ? e.message : String(e);
  if (P.z.output.jetzt() - P.z.lastlyReported >= REPORT_GAP_MS) {
    reportWriteError();
    return;
  }
  if (!P.z.reportTimer) {
    P.z.reportTimer = setTimeout(reportWriteError, REPORT_GAP_MS - (P.z.output.jetzt() - P.z.lastlyReported));
    P.z.reportTimer.unref();
  }
}

/** Direkt auf stderr, nicht über console — sonst wieder nach app_logs. */
export function reportWriteError(): void {
  if (!P.z) return;
  if (P.z.reportTimer) {
    clearTimeout(P.z.reportTimer);
    P.z.reportTimer = null;
  }
  if (!P.z.fehlgeschlagen) return;
  P.z.output.err(
    jsonRow(
      'warn',
      [`app_logs: ${P.z.fehlgeschlagen} Zeile(n) nicht geschrieben`, { last_error: P.z.lastError }],
      P.z.output.jetzt(),
    ),
  );
  P.z.fehlgeschlagen = 0;
  P.z.lastlyReported = P.z.output.jetzt();
}

export function emptyLog(): Promise<void> {
  if (!P.z?.pool || !P.z.puffer.length) return Promise.resolve();
  const rows = P.z.puffer.splice(0);
  return logs.writeLogRows(P.z.pool, rows).then(
    () => undefined,
    (e: unknown) => writeError(rows.length, e),
  );
}

export function logInDieDatabase(pool: Abfrager): void {
  if (!P.z) return;
  P.z.pool = pool;
  void emptyLog();
  if (P.z.onRaeumTick) clearInterval(P.z.onRaeumTick);
  P.z.onRaeumTick = setInterval(
    () => {
      logs.deleteOldLogRows(pool).catch((e: unknown) => writeError(0, e));
    },
    6 * 60 * 60 * 1000,
  );
  P.z.onRaeumTick.unref();
}

/** Als Letztes vor dem Schliessen des Pools, damit die Meldungen der übrigen
 * Abschlüsse noch in app_logs landen; danach geht nur noch stdout. */
export async function stopLog(): Promise<void> {
  if (!P.z) return;
  if (P.z.timer) clearTimeout(P.z.timer);
  if (P.z.onRaeumTick) clearInterval(P.z.onRaeumTick);
  P.z.timer = P.z.onRaeumTick = null;
  await emptyLog();
  reportWriteError();
  P.z.pool = null;
}

/** Gibt eine Funktion zurück, die den alten Zustand wiederherstellt (Tests). */
export function installLog(output: Ausgabe = PROCESS): () => void {
  const alt = { log: console.log, debug: console.debug, info: console.info, warn: console.warn, error: console.error };
  P.z = {
    output,
    pool: null,
    puffer: [],
    timer: null,
    fehlgeschlagen: 0,
    lastError: '',
    lastlyReported: -Infinity,
    reportTimer: null,
    onRaeumTick: null,
  };
  for (const name of ['log', ...LEVELS] as const) {
    const stufe = LOG_LEVEL[name];
    console[name] = (...args: unknown[]) => {
      if (!P.z) return;
      const rid = requestContext.getStore()?.rid;
      const zeile = jsonRow(stufe, args, P.z.output.jetzt(), rid);
      (stufe === 'warn' || stufe === 'error' ? P.z.output.err : P.z.output.out)(zeile);
      // app_logs behält das bisherige Textformat; die Protokollansicht liest es so.
      const { nachricht, kontext } = split(args);
      const text = `[${pidTag}${rid ? '/' + rid : ''}] ${nachricht}${kontext ? ' ' + logText(kontext) : ''}`;
      P.z.puffer.push({ level: name === 'log' ? 'log' : stufe, message: text.substring(0, MAX_TEXT) });
      // Ohne Pool wüchse der Puffer unbegrenzt; jede Zeile steht ohnehin auf stdout.
      if (P.z.puffer.length > 500) P.z.puffer.splice(0, P.z.puffer.length - 500);
      if (P.z.timer) clearTimeout(P.z.timer);
      P.z.timer = setTimeout(() => {
        if (P.z) P.z.timer = null;
        void emptyLog();
      }, 1500);
    };
  }
  return () => {
    if (P.z?.timer) clearTimeout(P.z.timer);
    if (P.z?.reportTimer) clearTimeout(P.z.reportTimer);
    if (P.z?.onRaeumTick) clearInterval(P.z.onRaeumTick);
    P.z = null;
    Object.assign(console, alt);
  };
}
