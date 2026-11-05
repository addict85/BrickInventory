/** Die EINE Stelle, die process.env liest: Ein ungültiger Wert ist ein
 * Startfehler mit Namen und Grund, statt still auf eine Vorgabe zu fallen.
 * Die Liste mit Erklärung steht in .env.example. */
import { proxyVertrauen } from './proxyVertrauen';
import { readFileSync } from 'node:fs';

type Umgebung = Record<string, string | undefined>;

/** Docker-Secrets: Steht X_FILE, kommt X aus der Datei statt aus der Umgebung,
 * die `docker inspect` und /proc/<pid>/environ jedem zeigen, der dort hinsieht. */
export const DATEI_VARIABLEN = ['SESSION_SECRET', 'PGPASSWORD', 'DATABASE_URL', 'ADMIN_PASSWORD'] as const;

/** Übernimmt jede lesbare X_FILE nach X und streicht X_FILE; ein zweiter Aufruf ändert nichts. */
export function geheimnisseAusDateien(env: Umgebung): string[] {
  const fehler: string[] = [];
  for (const name of DATEI_VARIABLEN) {
    const datei = env[`${name}_FILE`]?.trim();
    if (!datei) continue;
    if (env[name]) { fehler.push(`${name} und ${name}_FILE sind beide gesetzt — nur eines davon`); continue; }
    try {
      env[name] = readFileSync(datei, 'utf8').replace(/\r?\n$/, '');
      delete env[`${name}_FILE`];
    } catch (e) { fehler.push(`${name}_FILE="${datei}" ist nicht lesbar (${(e as NodeJS.ErrnoException).code ?? e})`); }
  }
  return fehler;
}

export interface Konfig {
  produktion: boolean;
  nodeEnv: string;
  /** Nur ausdrücklich development oder test: ohne NODE_ENV gelten die Regeln des Betriebs. */
  entwicklung: boolean;
  /** Ausweg für den Start als Datenbank-Superuser in Produktion (UPGRADE.md). */
  dbSuperuserErlaubt: boolean;
  port: number;
  hstsMaxAge: number;
  trustProxy: string | undefined;
  sessionSecret: string | undefined;
  /** null: nach NODE_ENV (secure nur in Produktion). */
  cookieSecure: boolean | null;
  sitzungLeerlaufMin: number;
  sitzungHoechstStd: number;
  tokenLeerlaufTage: number;
  rolle: Rolle;
  /** Für einen Hinweis beim Start. */
  veraltet: string[];
  pgPoolMax: number | null;
  pgPoolMin: number;
  pgIdleMs: number;
  pgConnMs: number;
  pgStmtMs: number;
  /** Eine hängende Transaktion hält sonst Advisory- und Zeilensperren unbegrenzt. */
  pgLeerlaufTxMs: number;
  pgSperreMs: number;
  adminPasswort: string;
  appBaseUrl: string | null;
  appRoot: string | null;
  appVersion: string | null;
  datenSchluessel: string;
  /** Pfad der Schlüsseldatei; null: <APP_ROOT>/schluessel/datenschluessel. */
  datenSchluesselDatei: string | null;
  erfassungZeitzone: string;
  preisverlaufTage: number;
  uploadKontingentMb: number;
  mailKonsoleMitToken: boolean;
  bildUserAgent: string | null;
  bildCacheMaxMb: number;
  bildAbrufeJeMinute: number;
  csvZeileFristMs: number;
  auftragParallel: number;
  /** null: nach Kernen und cgroup-Kontingent (src/konto/bcryptSchranke.ts). */
  bcryptArbeiter: number | null;
  auftragFristSek: number;
  /** PEM; null: keine eigene CA. */
  caZertifikat: string | null;
  hinterTls: boolean;
  /** Nur in Tests: Antworten gegen den API-Vertrag prüfen (src/infra/vertrag/pruefen.ts). */
  vertragPruefen: boolean;
  /** SHA-256 der Signaturzertifikate der App, 64 Hex-Zeichen in Grossbuchstaben. */
  androidZertifikate: string[];
  androidPaket: string;
}

export type Rolle = 'web' | 'jobs' | 'beides';
const ROLLEN: readonly Rolle[] = ['web', 'jobs', 'beides'];

/** Auch andere Module nennen sie; Höchstdauer eine Woche wie der Browser-Token. */
export const VORGABE = { sitzungLeerlaufMin: 240, sitzungHoechstStd: 168 } as const;

/** Die Meldung nennt jede ungültige Variable. */
export class KonfigFehler extends Error {
  constructor(readonly fehler: string[]) {
    super(`Ungültige Konfiguration:\n  - ${fehler.join('\n  - ')}`);
    this.name = 'KonfigFehler';
  }
}

/** Auch für die Signatur des Zwischenspeichers. */
export const VARIABLEN = [
  'NODE_ENV', 'PORT', 'HSTS_MAX_AGE', 'TRUST_PROXY', 'SESSION_SECRET', 'COOKIE_SECURE',
  'SESSION_IDLE_MINUTES', 'SESSION_MAX_HOURS', 'TOKEN_IDLE_DAYS', 'ROLLE',
  'DATABASE_URL', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE',
  'PG_POOL_MAX', 'PG_POOL_MIN', 'PG_IDLE_MS', 'PG_CONN_MS', 'PG_STMT_MS', 'ADMIN_PASSWORD',
  'APP_BASE_URL', 'APP_BASE_URL_FEHLT_OK', 'APP_ROOT', 'APP_VERSION', 'DATA_KEY', 'DATA_KEY_FILE', 'ERFASSUNG_ZEITZONE', 'TZ',
  'PRICE_HISTORY_KEEP_DAYS', 'UPLOAD_KONTINGENT_MB', 'MAIL_KONSOLE_MIT_TOKEN', 'IMG_USER_AGENT',
  'BILD_CACHE_MAX_MB', 'BILD_ABRUFE_JE_MINUTE',
  'CSV_ZEILE_FRIST_MS', 'AUFTRAG_PARALLEL', 'BCRYPT_ARBEITER', 'AUFTRAG_FRIST_SEK', 'CA_ZERTIFIKAT', 'VERTRAG_PRUEFEN',
  'PASSKEY_ANDROID_ZERTIFIKATE', 'PASSKEY_ANDROID_PAKET', 'DB_SUPERUSER_ERLAUBT', ...DATEI_VARIABLEN.map(n => `${n}_FILE` as const),
] as const;

/** Steht sie noch in einer alten compose.yaml, sagt der Start es. */
const VERALTET = ['WEB_WORKERS'] as const;

/** Ohne Angabe beides in einem Prozess: der einfache Start ohne Compose. */
function rolleAus(env: Umgebung, fehler: string[]): Rolle {
  const roh = env.ROLLE?.trim().toLowerCase() || 'beides';
  if ((ROLLEN as readonly string[]).includes(roh)) return roh as Rolle;
  fehler.push(`ROLLE="${env.ROLLE}" ist weder web noch jobs noch beides`);
  return 'beides';
}

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

/** Jeder Signaturschlüssel (eigener, Play App Signing, Debug) ergibt einen anderen
 * Hash; welche Fassung die Nutzer eines Servers haben, weiss nur sein Betreiber.
 * Leer: Der Server nimmt keine Passkey-Antwort einer App an. */
function androidZertifikate(env: Umgebung, fehler: string[]): string[] {
  const roh = env.PASSKEY_ANDROID_ZERTIFIKATE?.trim() || '';
  const liste = roh ? roh.split(/[\s,;]+/).filter(Boolean) : [];
  const hex = liste.map(f => f.replace(/:/g, '').toUpperCase());
  const falsch = liste.filter((_, i) => !/^[0-9A-F]{64}$/.test(hex[i] ?? ''));
  if (falsch.length) fehler.push(`PASSKEY_ANDROID_ZERTIFIKATE: ${falsch.join(', ')} ist kein SHA-256-Fingerabdruck (64 Hex-Zeichen)`);
  return falsch.length ? [] : [...new Set(hex)];
}

function androidPaket(env: Umgebung, fehler: string[]): string {
  const paket = env.PASSKEY_ANDROID_PAKET?.trim() || 'ch.brickinventoryapp';
  if (/^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/.test(paket)) return paket;
  fehler.push(`PASSKEY_ANDROID_PAKET="${paket}" ist kein Paketname`);
  return 'ch.brickinventoryapp';
}

/** Sicher genug, um in eine Verbindungsoption eingesetzt zu werden. */
export function zeitzoneGueltig(name: string): boolean {
  if (!/^[A-Za-z0-9_+\-/]+$/.test(name)) return false;
  try { new Intl.DateTimeFormat('de', { timeZone: name }); return true; } catch { return false; }
}

/** Ausdrücklich gesetzt muss die Zone stimmen; TZ und Prozesszone sind nur
 * Rückfall und fallen bei einem Fremdwert auf UTC. */
function zoneAus(env: Umgebung, fehler: string[]): string {
  let zone = env.ERFASSUNG_ZEITZONE?.trim() || '';
  if (zone && !zeitzoneGueltig(zone)) { fehler.push(`ERFASSUNG_ZEITZONE="${zone}" ist keine bekannte Zeitzone`); zone = ''; }
  if (!zone) zone = env.TZ?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return zeitzoneGueltig(zone) ? zone : 'UTC';
}

/** Wirft KonfigFehler mit allen Fehlern auf einmal. */
export function ladeKonfig(env: Umgebung = process.env): Konfig {
  const f: string[] = geheimnisseAusDateien(env);
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
    entwicklung: ['development', 'test'].includes(env.NODE_ENV?.trim() ?? ''),
    dbSuperuserErlaubt: schalter(env, 'DB_SUPERUSER_ERLAUBT', f) === true,
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
    pgLeerlaufTxMs: ganzzahl(env, 'PG_IDLE_TX_MS', 60_000, 0, 86_400_000, f),
    pgSperreMs: ganzzahl(env, 'PG_LOCK_MS', 10_000, 0, 86_400_000, f),
    adminPasswort: env.ADMIN_PASSWORD || '',
    appBaseUrl: basis,
    appRoot: env.APP_ROOT?.trim() || null,
    appVersion: env.APP_VERSION?.trim() || null,
    datenSchluessel,
    datenSchluesselDatei: env.DATA_KEY_FILE?.trim() || null,
    erfassungZeitzone: zone,
    // 0 oder weniger schaltet das Beschneiden des Preisverlaufs ab.
    preisverlaufTage: ganzzahl(env, 'PRICE_HISTORY_KEEP_DAYS', 1095, -1, 36_500, f),
    uploadKontingentMb: zahl(env, 'UPLOAD_KONTINGENT_MB', 2048, f),
    mailKonsoleMitToken: env.MAIL_KONSOLE_MIT_TOKEN?.trim() === '1',
    bildUserAgent: env.IMG_USER_AGENT?.trim() || null,
    bildCacheMaxMb: zahl(env, 'BILD_CACHE_MAX_MB', 2048, f),
    bildAbrufeJeMinute: ganzzahl(env, 'BILD_ABRUFE_JE_MINUTE', 240, 1, 100_000, f),
    csvZeileFristMs: ganzzahl(env, 'CSV_ZEILE_FRIST_MS', 120_000, 1, 86_400_000, f),
    auftragParallel: ganzzahl(env, 'AUFTRAG_PARALLEL', 4, 1, 64, f),
    bcryptArbeiter: env.BCRYPT_ARBEITER?.trim() ? ganzzahl(env, 'BCRYPT_ARBEITER', 4, 1, 64, f) : null,
    auftragFristSek: ganzzahl(env, 'AUFTRAG_FRIST_SEK', 300, 1, 86_400, f),
    caZertifikat: env.CA_ZERTIFIKAT?.trim() || null,
    hinterTls: !!basis && /^https:\/\//i.test(basis),
    vertragPruefen: env.VERTRAG_PRUEFEN?.trim() === '1',
    androidZertifikate: androidZertifikate(env, f),
    androidPaket: androidPaket(env, f),
  };
  if (f.length) throw new KonfigFehler(f);
  return k;
}

/** Auch hinter Caddy (APP_BASE_URL https://). COOKIE_SECURE=0 ist die bewusste
 * Ausnahme für einen Betrieb ohne TLS. */
export function cookieSicher(k: Konfig): boolean {
  return k.cookieSecure ?? (k.produktion || k.hinterTls);
}

let _signatur: string | null = null;
let _konfig: Konfig | null = null;

/** Zwischengespeichert, solange sich keine Variable ändert — Tests setzen sie
 * zur Laufzeit um. */
export function konfig(): Konfig {
  const sig = [...VARIABLEN, ...VERALTET].map(n => process.env[n] ?? '\u0000').join('\u0001');
  if (_konfig && sig === _signatur) return _konfig;
  _konfig = ladeKonfig(process.env);
  _signatur = sig;
  return _konfig;
}

export function pruefeKonfigBeimStart(): Konfig {
  try { return konfig(); }
  catch (e) {
    if (!(e instanceof KonfigFehler)) throw e;
    console.error(`❌ ${e.message}\n   Siehe .env.example.`);
    process.exit(1);
  }
}

/** Für Server, Worker und Skripte gleich: Eigene Vorgaben verbanden sich
 * ausserhalb von Docker mit einer anderen Datenbank. */
export function datenbankVerbindung(env: NodeJS.ProcessEnv = process.env) {
  geheimnisseAusDateien(env);
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

/** In Produktion ein Startverbot. */
export function standardPasswortInBenutzung(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = datenbankVerbindung(env);
  if (!('connectionString' in v)) return v.password === STANDARD_DB_PASSWORT;
  try { return decodeURIComponent(new URL(v.connectionString).password) === STANDARD_DB_PASSWORT; }
  catch { return false; }
}

/** Ein öffentlich bekanntes Datenbankpasswort oder ein TRUST_PROXY, der Clients
 * ihre Adresse selbst angeben lässt, soll beim Deploy auffallen. */
export function startVerbote(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const gruende: string[] = [];
  if (standardPasswortInBenutzung(env))
    gruende.push('[datenbank] Die Datenbank benutzt das Beispielpasswort „brickinventory_secret" aus compose.yaml — '
      + 'Start verweigert. Ein eigenes setzen: in psql `ALTER USER brickinventory PASSWORD \'…\';` und denselben '
      + 'Wert als DB_PASSWORD in .env (siehe UPGRADE.md).');
  try { proxyVertrauen(env.TRUST_PROXY); }
  catch (e) { gruende.push(`[proxy] ${(e as Error).message} Start verweigert.`); }
  // Ohne die Adresse gibt es keinen Host-Filter gegen DNS-Rebinding; wer das will, sagt es ausdrücklich.
  if (!env.APP_BASE_URL?.trim() && env.ROLLE?.trim().toLowerCase() !== 'jobs' && env.APP_BASE_URL_FEHLT_OK?.trim() !== '1')
    gruende.push('[start] APP_BASE_URL fehlt im Betrieb: Der Host-Filter gegen DNS-Rebinding wäre aus — Start verweigert. '
      + 'In .env setzen (README.md); nur bewusst ohne: APP_BASE_URL_FEHLT_OK=1 (UPGRADE.md).');
  if (env.MAIL_KONSOLE_MIT_TOKEN?.trim() === '1')
    gruende.push('[mail] MAIL_KONSOLE_MIT_TOKEN=1 schreibt Rücksetz- und Bestätigungslinks samt Token ins Protokoll — '
      + 'im Betrieb Start verweigert. Nur auf einem Entwicklungsrechner setzen (NODE_ENV=development).');
  return gruende;
}

/** Erlaubt, aber laut: Schalter, die im Betrieb eine Schutzschicht abschalten. */
export function startWarnungen(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const w: string[] = [];
  if (schalter(env, 'COOKIE_SECURE', []) === false)
    w.push('[start] COOKIE_SECURE=0: Das Sitzungs-Cookie geht auch über http, Passwort und Sitzung lesbar durchs Netz. '
      + 'Nur ohne TLS gedacht (README.md, „Ohne HTTPS“).');
  return w;
}
