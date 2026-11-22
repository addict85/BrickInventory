/** Every console line as a JSON line for Docker and log collectors, and additionally into
 * app_logs for the admin. Report write errors there at most once per
 * minute. */
import { format } from 'node:util';
import * as logs from './repository/appLogs';
import { processWide } from './processWide';

export { requestContext } from './accountContext';
import { requestContext } from './accountContext';

/** No whitespace, no control characters or quotes. */
const ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const K = processWide('anfrageKennung', () => ({ sequence: 0 }));

/** Unfiltered, a client could write line breaks or foreign identifiers into the
 * log and fake entries. */
export function requestId(raw: unknown): string {
  const wert = typeof raw === 'string' ? raw : '';
  if (ID_RE.test(wert)) return wert;
  K.sequence = (K.sequence + 1) % 1_679_616;
  return K.sequence.toString(36).padStart(4, '0');
}

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Level[] = ['debug', 'info', 'warn', 'error'];
const LOG_LEVEL: Record<Level | 'log', Level> = {
  log: 'info',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

/** Replaced in tests. */
export interface Output {
  out(row: string): void;
  err(row: string): void;
  now(): number;
}
const PROCESS: Output = {
  out: z => {
    process.stdout.write(z + '\n');
  },
  err: z => {
    process.stderr.write(z + '\n');
  },
  now: () => Date.now(),
};

type Querier = logs.Querier;

const MAX_TEXT = 4000;
const REPORT_GAP_MS = 60_000;

/** Large objects truncated before they travel through buffer and DB. */
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

/** One call stays one line in app_logs and its viewer: a line break from a request or a foreign
 * response would otherwise fake a second entry. Here once, instead of at every call. */
export function oneLine(s: string): string {
  return s.replace(/\r?\n/g, ' ⏎ ').replace(/[\r\n]/g, '');
}

const PLACEHOLDER = /%[sdifjoOc%]/;

export function split(args: unknown[]): { nachricht: string; kontext?: Record<string, unknown> } {
  const parts = [...args];
  let kontext: Record<string, unknown> | undefined;
  const last = parts[parts.length - 1];
  if (parts.length > 1 && isContext(last)) {
    kontext = last;
    parts.pop();
  }
  const error = parts.find((t): t is Error => t instanceof Error);
  if (error) kontext = { ...kontext, fehler: { name: error.name, message: error.message, stack: error.stack } };
  const plain = parts.map(t => (t instanceof Error ? t.message : t));
  // As console does it: placeholders in the first text take the following values.
  const text =
    plain.length > 1 && typeof plain[0] === 'string' && PLACEHOLDER.test(plain[0])
      ? format(...plain)
      : plain.map(logText).join(' ');
  const nachricht = oneLine(text).substring(0, MAX_TEXT);
  return kontext ? { nachricht, kontext } : { nachricht };
}

interface State {
  output: Output;
  pool: Querier | null;
  puffer: { level: string; message: string }[];
  timer: NodeJS.Timeout | null;
  fehlgeschlagen: number;
  lastError: string;
  lastlyReported: number;
  reportTimer: NodeJS.Timeout | null;
  onRaeumTick: NodeJS.Timeout | null;
}
const P = processWide('protokoll', () => ({ z: null as State | null }));
const pidTag = String(process.pid).slice(-4);

/** Fields in a fixed order. */
export function jsonRow(stufe: Level, args: unknown[], time: number, rid?: string): string {
  const { nachricht, kontext } = split(args);
  return JSON.stringify({
    zeit: new Date(time).toISOString(),
    stufe,
    nachricht,
    pid: process.pid,
    ...(rid ? { rid } : {}),
    ...(kontext ? { kontext } : {}),
  });
}

function writeError(count: number, e: unknown): void {
  if (!P.z) return;
  P.z.fehlgeschlagen += count;
  P.z.lastError = e instanceof Error ? e.message : String(e);
  if (P.z.output.now() - P.z.lastlyReported >= REPORT_GAP_MS) {
    reportWriteError();
    return;
  }
  if (!P.z.reportTimer) {
    P.z.reportTimer = setTimeout(reportWriteError, REPORT_GAP_MS - (P.z.output.now() - P.z.lastlyReported));
    P.z.reportTimer.unref();
  }
}

/** Directly to stderr, not via console — otherwise back into app_logs. */
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
      P.z.output.now(),
    ),
  );
  P.z.fehlgeschlagen = 0;
  P.z.lastlyReported = P.z.output.now();
}

export function emptyLog(): Promise<void> {
  if (!P.z?.pool || !P.z.puffer.length) return Promise.resolve();
  const rows = P.z.puffer.splice(0);
  return logs.writeLogRows(P.z.pool, rows).then(
    () => undefined,
    (e: unknown) => writeError(rows.length, e),
  );
}

export function logToDatabase(pool: Querier): void {
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

/** Last before closing the pool, so that the messages of the other
 * shutdown steps still land in app_logs; afterwards only stdout works. */
export async function stopLog(): Promise<void> {
  if (!P.z) return;
  if (P.z.timer) clearTimeout(P.z.timer);
  if (P.z.onRaeumTick) clearInterval(P.z.onRaeumTick);
  P.z.timer = P.z.onRaeumTick = null;
  await emptyLog();
  reportWriteError();
  P.z.pool = null;
}

/** Returns a function that restores the old state (tests). */
export function installLog(output: Output = PROCESS): () => void {
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
      const row = jsonRow(stufe, args, P.z.output.now(), rid);
      (stufe === 'warn' || stufe === 'error' ? P.z.output.err : P.z.output.out)(row);
      // app_logs keeps the previous text format; the log view reads it like that.
      const { nachricht, kontext } = split(args);
      const text = `[${pidTag}${rid ? '/' + rid : ''}] ${nachricht}${kontext ? ' ' + logText(kontext) : ''}`;
      P.z.puffer.push({ level: name === 'log' ? 'log' : stufe, message: text.substring(0, MAX_TEXT) });
      // Without a pool the buffer would grow without limit; every line is on stdout anyway.
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
