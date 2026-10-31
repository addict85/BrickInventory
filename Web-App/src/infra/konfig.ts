/**
 * Die Konfiguration aus der Umgebung — die EINE Stelle, die process.env liest.
 * Jede Variable hat Typ, Vorgabe und Grenzen; ein ungültiger Wert ist ein
 * Startfehler mit Namen und Grund, statt still auf eine Vorgabe zu fallen.
 * Die Liste mit Erklärung steht in .env.example.
 */

type Umgebung = Record<string, string | undefined>;

export interface Konfig {
  produktion: boolean;
  nodeEnv: string;
  port: number;
  hstsMaxAge: number;
  trustProxy: string | undefined;
  sessionSecret: string | undefined;
  /** null: nach NODE_ENV (secure nur in Produktion). */
  cookieSecure: boolean | null;
  sitzungLeerlaufMin: number;
  sitzungHoechstStd: number;
  tokenLeerlaufTage: number;
  /** Was dieser Prozess tut: Anfragen beantworten, Aufträge abarbeiten oder beides. */
  rolle: Rolle;
  /** Gesetzte Variablen, die der Server nicht mehr auswertet — für einen Hinweis beim Start. */
  veraltet: string[];
  pgPoolMax: number | null;
  pgPoolMin: number;
  pgIdleMs: number;
  pgConnMs: number;
  pgStmtMs: number;
  adminPasswort: string;
  appBaseUrl: string | null;
  appRoot: string | null;
  appVersion: string | null;
  datenSchluessel: string;
  erfassungZeitzone: string;
  preisverlaufTage: number;
  uploadKontingentMb: number;
  mailKonsoleMitToken: boolean;
  bildUserAgent: string | null;
  csvZeileFristMs: number;
  auftragParallel: number;
  auftragFristSek: number;
  /** Wurzelzertifikat der internen CA (Caddy), PEM; null: keine eigene CA. */
  caZertifikat: string | null;
  /** APP_BASE_URL beginnt mit https:// — der Server steht hinter TLS. */
  hinterTls: boolean;
}

export type Rolle = 'web' | 'jobs' | 'beides';
const ROLLEN: readonly Rolle[] = ['web', 'jobs', 'beides'];

/** Vorgaben, die auch andere Module nennen (utils/sitzungsFrist.ts). */
// Höchstdauer eine Woche, wie der Browser-Token.
export const VORGABE = { sitzungLeerlaufMin: 240, sitzungHoechstStd: 168 } as const;

/** Ein oder mehrere ungültige Werte; die Meldung nennt jede Variable. */
export class KonfigFehler extends Error {
  constructor(readonly fehler: string[]) {
    super(`Ungültige Konfiguration:\n  - ${fehler.join('\n  - ')}`);
    this.name = 'KonfigFehler';
  }
}

/** Alle Variablen, die der Server kennt — auch für die Signatur des Zwischenspeichers. */
export const VARIABLEN = [
  'NODE_ENV', 'PORT', 'HSTS_MAX_AGE', 'TRUST_PROXY', 'SESSION_SECRET', 'COOKIE_SECURE',
  'SESSION_IDLE_MINUTES', 'SESSION_MAX_HOURS', 'TOKEN_IDLE_DAYS', 'ROLLE',
  'DATABASE_URL', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE',
  'PG_POOL_MAX', 'PG_POOL_MIN', 'PG_IDLE_MS', 'PG_CONN_MS', 'PG_STMT_MS', 'ADMIN_PASSWORD',
  'APP_BASE_URL', 'APP_ROOT', 'APP_VERSION', 'DATA_KEY', 'ERFASSUNG_ZEITZONE', 'TZ',
  'PRICE_HISTORY_KEEP_DAYS', 'UPLOAD_KONTINGENT_MB', 'MAIL_KONSOLE_MIT_TOKEN', 'IMG_USER_AGENT',
  'CSV_ZEILE_FRIST_MS', 'AUFTRAG_PARALLEL', 'AUFTRAG_FRIST_SEK', 'CA_ZERTIFIKAT',
] as const;

/** Ausgewertet wird sie nicht mehr; steht sie noch in einer alten compose.yaml, sagt der Start es. */
const VERALTET = ['WEB_WORKERS'] as const;

/** Ohne Angabe beides in einem Prozess: der einfache Start ohne Compose. */
function rolleAus(env: Umgebung, fehler: string[]): Rolle {
  const roh = env.ROLLE?.trim().toLowerCase() || 'beides';
  if ((ROLLEN as readonly string[]).includes(roh)) return roh as Rolle;
  fehler.push(`ROLLE="${env.ROLLE}" ist weder web noch jobs noch beides`);
  return 'beides';
}

/** Liest eine ganze Zahl in [min, max]; leer heisst Vorgabe. */
function ganzzahl(env: Umgebung, name: string, vorgabe: number, min: number, max: number, fehler: string[]): number {
  const roh = env[name]?.trim();
  if (roh === undefined || roh === '') return vorgabe;
  const n = Number(roh);
  if (!Number.isInteger(n) || n < min || n > max) {
    fehler.push(`${name}="${roh}" ist keine ganze Zahl von ${min} bis ${max}`);
    return vorgabe;
  }
  return n;
}

/** Eine positive Zahl, auch mit Nachkommastellen; leer heisst Vorgabe. */
function zahl(env: Umgebung, name: string, vorgabe: number, fehler: string[]): number {
  const roh = env[name]?.trim();
  if (roh === undefined || roh === '') return vorgabe;
  const n = Number(roh);
  if (!Number.isFinite(n) || n <= 0) { fehler.push(`${name}="${roh}" ist keine positive Zahl`); return vorgabe; }
  return n;
}

function schalter(env: Umgebung, name: string, fehler: string[]): boolean | null {
  const roh = env[name]?.trim();
  if (roh === undefined || roh === '') return null;
  if (roh === '1' || roh === 'true') return true;
  if (roh === '0' || roh === 'false') return false;
  fehler.push(`${name}="${roh}" ist weder 1 noch 0`);
  return null;
}

/** Ein Zeitzonenname, den Intl kennt und der sicher in eine Verbindungsoption passt. */
export function zeitzoneGueltig(name: string): boolean {
  if (!/^[A-Za-z0-9_+\-/]+$/.test(name)) return false;
  try { new Intl.DateTimeFormat('de', { timeZone: name }); return true; } catch { return false; }
}

/**
 * Ausdrücklich gesetzt muss die Zone stimmen; TZ und die Prozesszone sind nur
 * Rückfall und fallen bei einem Fremdwert auf UTC wie vor Migration 0070.
 */
function zoneAus(env: Umgebung, fehler: string[]): string {
  let zone = env.ERFASSUNG_ZEITZONE?.trim() || '';
  if (zone && !zeitzoneGueltig(zone)) { fehler.push(`ERFASSUNG_ZEITZONE="${zone}" ist keine bekannte Zeitzone`); zone = ''; }
  if (!zone) zone = env.TZ?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return zeitzoneGueltig(zone) ? zone : 'UTC';
}

/** Die ganze Konfiguration aus `env`. Wirft KonfigFehler mit allen Fehlern auf einmal. */
export function ladeKonfig(env: Umgebung = process.env): Konfig {
  const f: string[] = [];
  const nodeEnv = env.NODE_ENV?.trim() || 'development';

  const basis = env.APP_BASE_URL?.trim().replace(/\/+$/, '') || null;
  if (basis && !/^https?:\/\/[^/\s]+/i.test(basis)) f.push(`APP_BASE_URL="${env.APP_BASE_URL}" ist keine http(s)-Adresse`);

  const datenSchluessel = env.DATA_KEY?.trim() || '';
  if (datenSchluessel && Buffer.from(datenSchluessel, 'base64').length !== 32)
    f.push('DATA_KEY muss 32 Byte als base64 sein (openssl rand -base64 32)');

  const zone = zoneAus(env, f);

  const pgPoolMax = env.PG_POOL_MAX?.trim() ? ganzzahl(env, 'PG_POOL_MAX', 15, 1, 1000, f) : null;
  const k: Konfig = {
    produktion: nodeEnv === 'production',
    nodeEnv,
    port: ganzzahl(env, 'PORT', 3000, 1, 65535, f),
    hstsMaxAge: ganzzahl(env, 'HSTS_MAX_AGE', 31_536_000, 0, 2 ** 31 - 1, f),
    trustProxy: env.TRUST_PROXY,
    sessionSecret: env.SESSION_SECRET || undefined,
    cookieSecure: schalter(env, 'COOKIE_SECURE', f),
    sitzungLeerlaufMin: ganzzahl(env, 'SESSION_IDLE_MINUTES', VORGABE.sitzungLeerlaufMin, 1, 525_600, f),
    sitzungHoechstStd: ganzzahl(env, 'SESSION_MAX_HOURS', VORGABE.sitzungHoechstStd, 1, 87_600, f),
    tokenLeerlaufTage: ganzzahl(env, 'TOKEN_IDLE_DAYS', 90, 1, 36_500, f),
    rolle: rolleAus(env, f),
    veraltet: VERALTET.filter(n => env[n]?.trim()),
    pgPoolMax,
    pgPoolMin: ganzzahl(env, 'PG_POOL_MIN', 2, 0, 1000, f),
    pgIdleMs: ganzzahl(env, 'PG_IDLE_MS', 30_000, 0, 86_400_000, f),
    pgConnMs: ganzzahl(env, 'PG_CONN_MS', 30_000, 0, 600_000, f),
    pgStmtMs: ganzzahl(env, 'PG_STMT_MS', 30_000, 0, 86_400_000, f),
    adminPasswort: env.ADMIN_PASSWORD || '',
    appBaseUrl: basis,
    appRoot: env.APP_ROOT?.trim() || null,
    appVersion: env.APP_VERSION?.trim() || null,
    datenSchluessel,
    erfassungZeitzone: zone,
    // 0 oder weniger schaltet das Beschneiden des Preisverlaufs ab.
    preisverlaufTage: ganzzahl(env, 'PRICE_HISTORY_KEEP_DAYS', 1095, -1, 36_500, f),
    uploadKontingentMb: zahl(env, 'UPLOAD_KONTINGENT_MB', 2048, f),
    mailKonsoleMitToken: env.MAIL_KONSOLE_MIT_TOKEN?.trim() === '1',
    bildUserAgent: env.IMG_USER_AGENT?.trim() || null,
    csvZeileFristMs: ganzzahl(env, 'CSV_ZEILE_FRIST_MS', 120_000, 1, 86_400_000, f),
    auftragParallel: ganzzahl(env, 'AUFTRAG_PARALLEL', 4, 1, 64, f),
    auftragFristSek: ganzzahl(env, 'AUFTRAG_FRIST_SEK', 300, 1, 86_400, f),
    caZertifikat: env.CA_ZERTIFIKAT?.trim() || null,
    hinterTls: !!basis && /^https:\/\//i.test(basis),
  };
  if (f.length) throw new KonfigFehler(f);
  return k;
}

/**
 * Das Sitzungscookie nur über TLS: in Produktion und immer, wenn APP_BASE_URL
 * mit https:// beginnt (hinter Caddy). COOKIE_SECURE=0 ist die bewusste
 * Ausnahme für einen Betrieb ohne TLS.
 */
export function cookieSicher(k: Konfig): boolean {
  return k.cookieSecure ?? (k.produktion || k.hinterTls);
}

let _signatur: string | null = null;
let _konfig: Konfig | null = null;

/**
 * Die geltende Konfiguration. Zwischengespeichert, solange sich keine der
 * bekannten Variablen ändert — Tests setzen sie zur Laufzeit um.
 */
export function konfig(): Konfig {
  const sig = [...VARIABLEN, ...VERALTET].map(n => process.env[n] ?? '\u0000').join('\u0001');
  if (_konfig && sig === _signatur) return _konfig;
  _konfig = ladeKonfig(process.env);
  _signatur = sig;
  return _konfig;
}

/** Beim Start: alle Werte prüfen und bei einem Fehler mit klarer Meldung beenden. */
export function pruefeKonfigBeimStart(): Konfig {
  try { return konfig(); }
  catch (e) {
    if (!(e instanceof KonfigFehler)) throw e;
    console.error(`❌ ${e.message}\n   Siehe .env.example.`);
    process.exit(1);
  }
}

/**
 * Die Verbindung zur Datenbank — für Server, Worker und Skripte.
 * Der CSV-Worker hatte eigene Standardwerte (brickinv statt brickinventory);
 * ausserhalb von Docker verband er sich dadurch mit einer anderen Datenbank.
 */
export function datenbankVerbindung(env: NodeJS.ProcessEnv = process.env) {
  if (env.DATABASE_URL) return { connectionString: env.DATABASE_URL };
  return {
    host:     env.PGHOST     || 'postgres',
    port:     parseInt(env.PGPORT || '5432'),
    user:     env.PGUSER     || 'brickinventory',
    password: env.PGPASSWORD || STANDARD_DB_PASSWORT,
    database: env.PGDATABASE || 'brickinventory',
  };
}

/** Das Beispielpasswort aus compose.yaml; es steht in jedem öffentlichen Klon. */
export const STANDARD_DB_PASSWORT = 'brickinventory_secret';

/** Ob die Verbindung noch das Beispielpasswort benutzt (in Produktion ein Startverbot). */
export function standardPasswortInBenutzung(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = datenbankVerbindung(env);
  if (!('connectionString' in v)) return v.password === STANDARD_DB_PASSWORT;
  try { return decodeURIComponent(new URL(v.connectionString).password) === STANDARD_DB_PASSWORT; }
  catch { return false; }
}

/**
 * Gründe, den Start in Produktion zu verweigern. Ein öffentlich bekanntes
 * Datenbankpasswort oder ein TRUST_PROXY, das Clients ihre Adresse selbst
 * angeben lässt, soll beim Deploy auffallen, nicht erst im Ernstfall.
 */
export function startVerbote(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const gruende: string[] = [];
  if (standardPasswortInBenutzung(env))
    gruende.push('[datenbank] Die Datenbank benutzt das Beispielpasswort „brickinventory_secret" aus compose.yaml — '
      + 'Start verweigert. Ein eigenes setzen: in psql `ALTER USER brickinventory PASSWORD \'…\';` und denselben '
      + 'Wert als DB_PASSWORD in .env (siehe UPGRADE.md).');
  try { (require('./proxyVertrauen') as typeof import('./proxyVertrauen')).proxyVertrauen(env.TRUST_PROXY); }
  catch (e) { gruende.push(`[proxy] ${(e as Error).message} Start verweigert.`); }
  return gruende;
}
