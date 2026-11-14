/** Jede console-Zeile als JSON-Zeile für Docker und Log-Sammler, daneben nach
 * app_logs für die Verwaltung. Schreibfehler dorthin höchstens einmal je
 * Minute melden. */
import { AsyncLocalStorage } from 'node:async_hooks';
import * as logs from './repository/appLogs';
import { prozessweit } from './prozessweit';

export const anfrageKontext = new AsyncLocalStorage<{ rid: string }>();

/** Kein Leerraum, keine Steuer- oder Anführungszeichen. */
const KENNUNG_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const K = prozessweit('anfrageKennung', () => ({ folge: 0 }));

/** Ungefiltert könnte ein Client Zeilenumbrüche oder fremde Kennungen ins
 * Protokoll schreiben und Einträge vortäuschen. */
export function anfrageKennung(roh: unknown): string {
  const wert = typeof roh === 'string' ? roh : '';
  if (KENNUNG_RE.test(wert)) return wert;
  K.folge = (K.folge + 1) % 1_679_616;
  return K.folge.toString(36).padStart(4, '0');
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
const P = prozessweit('protokoll', () => ({ z: null as Zustand | null }));
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
  if (!P.z) return;
  P.z.fehlgeschlagen += anzahl;
  P.z.letzterFehler = e instanceof Error ? e.message : String(e);
  if (P.z.ausgabe.jetzt() - P.z.zuletztGemeldet >= MELDE_ABSTAND_MS) {
    meldeSchreibfehler();
    return;
  }
  if (!P.z.meldeTimer) {
    P.z.meldeTimer = setTimeout(meldeSchreibfehler, MELDE_ABSTAND_MS - (P.z.ausgabe.jetzt() - P.z.zuletztGemeldet));
    P.z.meldeTimer.unref();
  }
}

/** Direkt auf stderr, nicht über console — sonst wieder nach app_logs. */
export function meldeSchreibfehler(): void {
  if (!P.z) return;
  if (P.z.meldeTimer) {
    clearTimeout(P.z.meldeTimer);
    P.z.meldeTimer = null;
  }
  if (!P.z.fehlgeschlagen) return;
  P.z.ausgabe.err(
    jsonZeile(
      'warn',
      [`app_logs: ${P.z.fehlgeschlagen} Zeile(n) nicht geschrieben`, { letzter_fehler: P.z.letzterFehler }],
      P.z.ausgabe.jetzt(),
    ),
  );
  P.z.fehlgeschlagen = 0;
  P.z.zuletztGemeldet = P.z.ausgabe.jetzt();
}

export function leereProtokoll(): Promise<void> {
  if (!P.z?.pool || !P.z.puffer.length) return Promise.resolve();
  const rows = P.z.puffer.splice(0);
  return logs.schreibeLogZeilen(P.z.pool, rows).then(
    () => undefined,
    (e: unknown) => schreibfehler(rows.length, e),
  );
}

export function protokollInDieDatenbank(pool: Abfrager): void {
  if (!P.z) return;
  P.z.pool = pool;
  void leereProtokoll();
  if (P.z.aufraeumTakt) clearInterval(P.z.aufraeumTakt);
  P.z.aufraeumTakt = setInterval(
    () => {
      logs.loescheAlteLogZeilen(pool).catch((e: unknown) => schreibfehler(0, e));
    },
    6 * 60 * 60 * 1000,
  );
  P.z.aufraeumTakt.unref();
}

/** Als Letztes vor dem Schliessen des Pools, damit die Meldungen der übrigen
 * Abschlüsse noch in app_logs landen; danach geht nur noch stdout. */
export async function stoppeProtokoll(): Promise<void> {
  if (!P.z) return;
  if (P.z.timer) clearTimeout(P.z.timer);
  if (P.z.aufraeumTakt) clearInterval(P.z.aufraeumTakt);
  P.z.timer = P.z.aufraeumTakt = null;
  await leereProtokoll();
  meldeSchreibfehler();
  P.z.pool = null;
}

/** Gibt eine Funktion zurück, die den alten Zustand wiederherstellt (Tests). */
export function installiereProtokoll(ausgabe: Ausgabe = PROZESS): () => void {
  const alt = { log: console.log, debug: console.debug, info: console.info, warn: console.warn, error: console.error };
  P.z = {
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
      if (!P.z) return;
      const rid = anfrageKontext.getStore()?.rid;
      const zeile = jsonZeile(stufe, args, P.z.ausgabe.jetzt(), rid);
      (stufe === 'warn' || stufe === 'error' ? P.z.ausgabe.err : P.z.ausgabe.out)(zeile);
      // app_logs behält das bisherige Textformat; die Protokollansicht liest es so.
      const { nachricht, kontext } = zerlege(args);
      const text = `[${pidTag}${rid ? '/' + rid : ''}] ${nachricht}${kontext ? ' ' + logText(kontext) : ''}`;
      P.z.puffer.push({ level: name === 'log' ? 'log' : stufe, message: text.substring(0, MAX_TEXT) });
      // Ohne Pool wüchse der Puffer unbegrenzt; jede Zeile steht ohnehin auf stdout.
      if (P.z.puffer.length > 500) P.z.puffer.splice(0, P.z.puffer.length - 500);
      if (P.z.timer) clearTimeout(P.z.timer);
      P.z.timer = setTimeout(() => {
        if (P.z) P.z.timer = null;
        void leereProtokoll();
      }, 1500);
    };
  }
  return () => {
    if (P.z?.timer) clearTimeout(P.z.timer);
    if (P.z?.meldeTimer) clearTimeout(P.z.meldeTimer);
    if (P.z?.aufraeumTakt) clearInterval(P.z.aufraeumTakt);
    P.z = null;
    Object.assign(console, alt);
  };
}
