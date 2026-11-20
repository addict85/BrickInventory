/** Die EINE Stelle, die process.env liest: Ein ungültiger Wert ist ein
 * Startfehler mit Namen und Grund, statt still auf eine Vorgabe zu fallen.
 * Die Liste mit Erklärung steht in .env.example. */
import { proxyVertrauen } from './proxyTrust';
import { readFileSync } from 'node:fs';
import { prozessweit } from './prozessweit';

type Umgebung = Record<string, string | undefined>;

/** Docker-Secrets: Steht X_FILE, kommt X aus der Datei statt aus der Umgebung,
 * die `docker inspect` und /proc/<pid>/environ jedem zeigen, der dort hinsieht. */
export const FILE_VARIABLES = [
  'SESSION_SECRET',
  'PGPASSWORD',
  'PGSYSTEM_PASSWORD',
  'PGSYSTEM_WEB_PASSWORD',
  'DATABASE_URL',
  'ADMIN_PASSWORD',
] as const;

/** Übernimmt jede lesbare X_FILE nach X und streicht X_FILE; ein zweiter Aufruf ändert nichts. */
export function secretsFromFiles(env: Umgebung): string[] {
  const fehler: string[] = [];
  for (const name of FILE_VARIABLES) {
    const datei = env[`${name}_FILE`]?.trim();
    if (!datei) continue;
    if (env[name]) {
      fehler.push(`${name} und ${name}_FILE sind beide gesetzt — nur eines davon`);
      continue;
    }
    try {
      env[name] = readFileSync(datei, 'utf8').replace(/\r?\n$/, '');
      delete env[`${name}_FILE`];
    } catch (e) {
      fehler.push(`${name}_FILE="${datei}" ist nicht lesbar (${(e as NodeJS.ErrnoException).code ?? e})`);
    }
  }
  return fehler;
}

export interface Konfig {
  production: boolean;
  nodeEnv: string;
  /** Nur ausdrücklich development oder test: ohne NODE_ENV gelten die Regeln des Betriebs. */
  entwicklung: boolean;
  /** Alles ausser development/test: Auch ohne NODE_ENV gelten die Verbote des Betriebs. */
  operation: boolean;
  /** Ausweg für den Start als Datenbank-Superuser in Produktion (UPGRADE.md). */
  dbSuperuserAllowed: boolean;
  port: number;
  hstsMaxAge: number;
  trustProxy: string | undefined;
  /** Ein Netz über acht Adressen in TRUST_PROXY ist gewollt (src/infra/proxyTrust.ts). */
  proxyNetworkConfirmed: boolean;
  sessionSecret: string | undefined;
  /** null: nach NODE_ENV (secure nur in Produktion). */
  cookieSecure: boolean | null;
  sitzungLeerlaufMin: number;
  sitzungHoechstStd: number;
  /** Eine offene Verwaltersitzung ist mehr wert: kürzer, höchstens die allgemeinen Fristen. */
  sitzungVerwalterLeerlaufMin: number;
  sitzungVerwalterHoechstStd: number;
  tokenIdleDays: number;
  rolle: Rolle;
  /** Für einen Hinweis beim Start. */
  veraltet: string[];
  pgPoolMax: number | null;
  pgPoolMin: number;
  pgIdleMs: number;
  pgConnMs: number;
  pgStmtMs: number;
  /** Eine hängende Transaktion hält sonst Advisory- und Zeilensperren unbegrenzt. */
  pgIdleTxMs: number;
  pgSperreMs: number;
  adminPassword: string;
  appBaseUrl: string | null;
  appRoot: string | null;
  appVersion: string | null;
  datenSchluessel: string;
  /** Pfad der Schlüsseldatei; null: <APP_ROOT>/schluessel/datenschluessel. */
  dataKeyFile: string | null;
  /** Der vorige Schlüssel während eines Wechsels (DATA_KEY_ALT oder die Datei). */
  dataKeyAlt: string;
  dataKeyAltFile: string | null;
  entryTimeZone: string;
  priceHistoryDays: number;
  uploadQuotaMb: number;
  uploadTotalMb: number;
  mailConsoleWithToken: boolean;
  bildUserAgent: string | null;
  imageCacheMaxMb: number;
  imageFetchesJeMinute: number;
  csvRowDeadlineMs: number;
  jobParallel: number;
  /** null: nach Kernen und cgroup-Kontingent (src/account/bcryptLimit.ts). */
  bcryptArbeiter: number | null;
  jobDeadlineSec: number;
  /** PEM; null: keine eigene CA. */
  caCertificate: string | null;
  hinterTls: boolean;
  /** Nur in Tests: Antworten gegen den API-Vertrag prüfen (src/http/contractRouter.ts). */
  checkContract: boolean;
  /** SHA-256 der Signaturzertifikate der App, 64 Hex-Zeichen in Grossbuchstaben. */
  androidZertifikate: string[];
  androidPaket: string;
  /** PEM statt der Google-Wurzeln; nur in Entwicklung und Test (src/devices/attestation). */
  attestationWurzeln: string | null;
  /** Bis dahin gelten Geräteschlüssel, die vor der Attestation hinterlegt wurden (UPGRADE.md). */
  geraeteschluesselAltBis: Date;
  /** So alt darf Googles Widerrufsliste höchstens sein; älter nimmt der Server keinen Schlüssel an. */
  attestationRevocationDays: number;
  attestationPatchAtLeast: number | null;
}

export type Rolle = 'web' | 'jobs' | 'beides';
const ROLES: readonly Rolle[] = ['web', 'jobs', 'beides'];

/** Auch andere Module nennen sie; Höchstdauer eine Woche wie der Browser-Token. */
export const VORGABE = {
  sitzungLeerlaufMin: 240,
  sitzungHoechstStd: 168,
  sitzungVerwalterLeerlaufMin: 30,
  sitzungVerwalterHoechstStd: 12,
  jobParallel: 4,
  jobDeadlineSec: 300,
} as const;

/** Die Meldung nennt jede ungültige Variable. */
export class KonfigFehler extends Error {
  constructor(readonly fehler: string[]) {
    super(`Ungültige Konfiguration:\n  - ${fehler.join('\n  - ')}`);
    this.name = 'KonfigFehler';
  }
}

/** Jede Variable, die ladeKonfig liest; .env.example nennt sie alle (test/konfig.test.js). */
export const VARIABLES = [
  'NODE_ENV',
  'PORT',
  'HSTS_MAX_AGE',
  'TRUST_PROXY',
  'PROXY_NETZ_BESTAETIGT',
  'SESSION_SECRET',
  'COOKIE_SECURE',
  'SESSION_IDLE_MINUTES',
  'SESSION_MAX_HOURS',
  'SESSION_ADMIN_IDLE_MINUTES',
  'SESSION_ADMIN_MAX_HOURS',
  'TOKEN_IDLE_DAYS',
  'ROLLE',
  'DATABASE_URL',
  'PGHOST',
  'PGPORT',
  'PGUSER',
  'PGPASSWORD',
  'PGDATABASE',
  'PGSYSTEM_USER',
  'PGSYSTEM_PASSWORD',
  'PGSYSTEM_WEB_USER',
  'PGSYSTEM_WEB_PASSWORD',
  'PGSSLMODE',
  'PG_POOL_MAX',
  'PG_POOL_MIN',
  'PG_IDLE_MS',
  'PG_CONN_MS',
  'PG_STMT_MS',
  'ADMIN_PASSWORD',
  'APP_BASE_URL',
  'APP_BASE_URL_FEHLT_OK',
  'APP_ROOT',
  'APP_VERSION',
  'DATA_KEY',
  'DATA_KEY_FILE',
  'DATA_KEY_ALT',
  'DATA_KEY_ALT_FILE',
  'ERFASSUNG_ZEITZONE',
  'TZ',
  'PRICE_HISTORY_KEEP_DAYS',
  'UPLOAD_KONTINGENT_MB',
  'UPLOAD_GESAMT_MB',
  'MAIL_KONSOLE_MIT_TOKEN',
  'IMG_USER_AGENT',
  'BILD_CACHE_MAX_MB',
  'BILD_ABRUFE_JE_MINUTE',
  'CSV_ZEILE_FRIST_MS',
  'AUFTRAG_PARALLEL',
  'BCRYPT_ARBEITER',
  'AUFTRAG_FRIST_SEK',
  'CA_ZERTIFIKAT',
  'VERTRAG_PRUEFEN',
  'PASSKEY_ANDROID_ZERTIFIKATE',
  'PASSKEY_ANDROID_PAKET',
  'DB_SUPERUSER_ERLAUBT',
  'ATTESTATION_WURZELN',
  'GERAETESCHLUESSEL_ALT_BIS',
  'ATTESTATION_WIDERRUF_TAGE',
  'ATTESTATION_PATCH_MINDESTENS',
  ...FILE_VARIABLES.map(n => `${n}_FILE` as const),
] as const;

/** Steht sie noch in einer alten compose.yaml, sagt der Start es. */
const STALE = ['WEB_WORKERS'] as const;

/** Ohne Angabe beides in einem Prozess: der einfache Start ohne Compose. */
function roleFrom(env: Umgebung, fehler: string[]): Rolle {
  const roh = env.ROLLE?.trim().toLowerCase() || 'beides';
  if ((ROLES as readonly string[]).includes(roh)) return roh as Rolle;
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
  if (!Number.isFinite(n) || n <= 0) {
    fehler.push(`${name}="${roh}" ist keine positive Zahl`);
    return vorgabe;
  }
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
  if (falsch.length)
    fehler.push(`PASSKEY_ANDROID_ZERTIFIKATE: ${falsch.join(', ')} ist kein SHA-256-Fingerabdruck (64 Hex-Zeichen)`);
  return falsch.length ? [] : [...new Set(hex)];
}

function androidPaket(env: Umgebung, fehler: string[]): string {
  const paket = env.PASSKEY_ANDROID_PAKET?.trim() || 'ch.brickinventoryapp';
  if (/^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/.test(paket)) return paket;
  fehler.push(`PASSKEY_ANDROID_PAKET="${paket}" ist kein Paketname`);
  return 'ch.brickinventoryapp';
}

/** Eine eigene Wurzel öffnete den Schrittschutz jedem Schlüssel, den sie signiert:
 * darum nur, wo NODE_ENV ausdrücklich development oder test sagt. */
function attestationWurzeln(env: Umgebung, fehler: string[]): string | null {
  const pem = env.ATTESTATION_WURZELN?.trim() || null;
  if (pem && !developmentEnvironment(env))
    fehler.push('ATTESTATION_WURZELN gilt nur mit NODE_ENV=development oder test');
  return pem;
}

export const LEGACY_KEY_CUTOFF_DATE = '2027-02-01';

function legacyKeyUntil(env: Umgebung, fehler: string[]): Date {
  const roh = env.GERAETESCHLUESSEL_ALT_BIS?.trim() || LEGACY_KEY_CUTOFF_DATE;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(roh) ? new Date(`${roh}T00:00:00Z`) : new Date(Number.NaN);
  const stichtag = new Date(`${LEGACY_KEY_CUTOFF_DATE}T00:00:00Z`);
  // Nur früher, nie später: Ein Datum in ferner Zukunft liesse unattestierte Schlüssel auf Dauer gelten.
  if (d.getTime() <= stichtag.getTime()) return d;
  fehler.push(
    Number.isNaN(d.getTime())
      ? `GERAETESCHLUESSEL_ALT_BIS="${roh}" ist kein Datum JJJJ-MM-TT`
      : `GERAETESCHLUESSEL_ALT_BIS="${roh}" liegt nach ${LEGACY_KEY_CUTOFF_DATE}; nur ein früheres Datum ist erlaubt`,
  );
  return stichtag;
}

function patchAtLeast(env: Umgebung, fehler: string[]): number | null {
  const roh = env.ATTESTATION_PATCH_MINDESTENS?.trim();
  if (!roh) return null;
  if (/^20\d\d(0[1-9]|1[0-2])$/.test(roh)) return Number(roh);
  fehler.push(`ATTESTATION_PATCH_MINDESTENS="${roh}" ist kein Monat JJJJMM`);
  return null;
}

/** Sicher genug, um in eine Verbindungsoption eingesetzt zu werden. */
export function timeZoneValid(name: string): boolean {
  if (!/^[A-Za-z0-9_+\-/]+$/.test(name)) return false;
  try {
    new Intl.DateTimeFormat('de', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** Ausdrücklich gesetzt muss die Zone stimmen; TZ und Prozesszone sind nur
 * Rückfall und fallen bei einem Fremdwert auf UTC. */
function zoneFrom(env: Umgebung, fehler: string[]): string {
  let zone = env.ERFASSUNG_ZEITZONE?.trim() || '';
  if (zone && !timeZoneValid(zone)) {
    fehler.push(`ERFASSUNG_ZEITZONE="${zone}" ist keine bekannte Zeitzone`);
    zone = '';
  }
  if (!zone) zone = env.TZ?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return timeZoneValid(zone) ? zone : 'UTC';
}

function developmentEnvironment(env: Umgebung): boolean {
  return ['development', 'test'].includes(env.NODE_ENV?.trim() ?? '');
}

/** Wirft KonfigFehler mit allen Fehlern auf einmal. */
/** Fristen der Browsersitzung; für Verwalter eigene, kürzere (src/account/sessionDeadline.ts). */
function sitzungsKonfig(env: Umgebung, f: string[]) {
  return {
    sitzungLeerlaufMin: ganzzahl(env, 'SESSION_IDLE_MINUTES', VORGABE.sitzungLeerlaufMin, 1, 525_600, f),
    sitzungHoechstStd: ganzzahl(env, 'SESSION_MAX_HOURS', VORGABE.sitzungHoechstStd, 1, 87_600, f),
    sitzungVerwalterLeerlaufMin: ganzzahl(
      env,
      'SESSION_ADMIN_IDLE_MINUTES',
      VORGABE.sitzungVerwalterLeerlaufMin,
      1,
      525_600,
      f,
    ),
    sitzungVerwalterHoechstStd: ganzzahl(
      env,
      'SESSION_ADMIN_MAX_HOURS',
      VORGABE.sitzungVerwalterHoechstStd,
      1,
      87_600,
      f,
    ),
  };
}

export function ladeKonfig(env: Umgebung = process.env): Konfig {
  const f: string[] = secretsFromFiles(env);
  const nodeEnv = env.NODE_ENV?.trim() || 'development';

  const basis = env.APP_BASE_URL?.trim().replace(/\/+$/, '') || null;
  if (basis && !/^https?:\/\/[^/\s]+/i.test(basis))
    f.push(`APP_BASE_URL="${env.APP_BASE_URL}" ist keine http(s)-Adresse`);

  const datenSchluessel = env.DATA_KEY?.trim() || '';
  if (datenSchluessel && Buffer.from(datenSchluessel, 'base64').length !== 32)
    f.push('DATA_KEY muss 32 Byte als base64 sein (openssl rand -base64 32)');
  const dataKeyAlt = env.DATA_KEY_ALT?.trim() || '';
  if (dataKeyAlt && Buffer.from(dataKeyAlt, 'base64').length !== 32)
    f.push('DATA_KEY_ALT muss 32 Byte als base64 sein (der vorige DATA_KEY)');

  const zone = zoneFrom(env, f);

  const pgPoolMax = env.PG_POOL_MAX?.trim() ? ganzzahl(env, 'PG_POOL_MAX', 15, 1, 1000, f) : null;
  const k: Konfig = {
    production: nodeEnv === 'production',
    nodeEnv,
    entwicklung: developmentEnvironment(env),
    operation: !developmentEnvironment(env),
    dbSuperuserAllowed: schalter(env, 'DB_SUPERUSER_ERLAUBT', f) === true,
    port: ganzzahl(env, 'PORT', 3000, 1, 65535, f),
    hstsMaxAge: ganzzahl(env, 'HSTS_MAX_AGE', 31_536_000, 0, 2 ** 31 - 1, f),
    trustProxy: env.TRUST_PROXY,
    proxyNetworkConfirmed: schalter(env, 'PROXY_NETZ_BESTAETIGT', f) === true,
    sessionSecret: env.SESSION_SECRET || undefined,
    cookieSecure: schalter(env, 'COOKIE_SECURE', f),
    ...sitzungsKonfig(env, f),
    tokenIdleDays: ganzzahl(env, 'TOKEN_IDLE_DAYS', 90, 1, 36_500, f),
    rolle: roleFrom(env, f),
    veraltet: STALE.filter(n => env[n]?.trim()),
    pgPoolMax,
    pgPoolMin: ganzzahl(env, 'PG_POOL_MIN', 2, 0, 1000, f),
    pgIdleMs: ganzzahl(env, 'PG_IDLE_MS', 30_000, 0, 86_400_000, f),
    pgConnMs: ganzzahl(env, 'PG_CONN_MS', 30_000, 0, 600_000, f),
    pgStmtMs: ganzzahl(env, 'PG_STMT_MS', 30_000, 0, 86_400_000, f),
    pgIdleTxMs: ganzzahl(env, 'PG_IDLE_TX_MS', 60_000, 0, 86_400_000, f),
    pgSperreMs: ganzzahl(env, 'PG_LOCK_MS', 10_000, 0, 86_400_000, f),
    adminPassword: env.ADMIN_PASSWORD || '',
    appBaseUrl: basis,
    appRoot: env.APP_ROOT?.trim() || null,
    appVersion: env.APP_VERSION?.trim() || null,
    datenSchluessel,
    dataKeyFile: env.DATA_KEY_FILE?.trim() || null,
    dataKeyAlt,
    dataKeyAltFile: env.DATA_KEY_ALT_FILE?.trim() || null,
    entryTimeZone: zone,
    // 0 oder weniger schaltet das Beschneiden des Preisverlaufs ab.
    priceHistoryDays: ganzzahl(env, 'PRICE_HISTORY_KEEP_DAYS', 1095, -1, 36_500, f),
    uploadQuotaMb: zahl(env, 'UPLOAD_KONTINGENT_MB', 2048, f),
    uploadTotalMb: zahl(env, 'UPLOAD_GESAMT_MB', 20_480, f),
    mailConsoleWithToken: env.MAIL_KONSOLE_MIT_TOKEN?.trim() === '1',
    bildUserAgent: env.IMG_USER_AGENT?.trim() || null,
    imageCacheMaxMb: zahl(env, 'BILD_CACHE_MAX_MB', 2048, f),
    imageFetchesJeMinute: ganzzahl(env, 'BILD_ABRUFE_JE_MINUTE', 240, 1, 100_000, f),
    csvRowDeadlineMs: ganzzahl(env, 'CSV_ZEILE_FRIST_MS', 120_000, 1, 86_400_000, f),
    jobParallel: ganzzahl(env, 'AUFTRAG_PARALLEL', VORGABE.jobParallel, 1, 64, f),
    bcryptArbeiter: env.BCRYPT_ARBEITER?.trim() ? ganzzahl(env, 'BCRYPT_ARBEITER', 4, 1, 64, f) : null,
    jobDeadlineSec: ganzzahl(env, 'AUFTRAG_FRIST_SEK', VORGABE.jobDeadlineSec, 1, 86_400, f),
    caCertificate: env.CA_ZERTIFIKAT?.trim() || null,
    hinterTls: !!basis && /^https:\/\//i.test(basis),
    checkContract: env.VERTRAG_PRUEFEN?.trim() === '1',
    androidZertifikate: androidZertifikate(env, f),
    androidPaket: androidPaket(env, f),
    attestationWurzeln: attestationWurzeln(env, f),
    geraeteschluesselAltBis: legacyKeyUntil(env, f),
    attestationRevocationDays: ganzzahl(env, 'ATTESTATION_WIDERRUF_TAGE', 7, 1, 90, f),
    attestationPatchAtLeast: patchAtLeast(env, f),
  };
  if (f.length) throw new KonfigFehler(f);
  return k;
}

/** Im Betrieb und hinter Caddy (APP_BASE_URL https://). COOKIE_SECURE=0 ist die bewusste
 * Ausnahme für einen Betrieb ohne TLS. */
export function cookieSafe(k: Konfig): boolean {
  return k.cookieSecure ?? (k.operation || k.hinterTls);
}

const K = prozessweit('konfig', () => ({ v: null as Readonly<Konfig> | null }));

/** Beim ersten Aufruf gelesen und eingefroren: konfig() steht im heissen Pfad
 * jeder Anfrage, und der Betrieb ändert seine Umgebung nicht zur Laufzeit.
 * Wer es doch tut (Tests), sagt es ausdrücklich mit setKonfig/readKonfigNew. */
export function konfig(): Readonly<Konfig> {
  K.v ??= Object.freeze(ladeKonfig(process.env));
  return K.v;
}

/** Für Tests: einzelne Werte über die gelesene Konfiguration legen; null hebt das auf. */
export function setKonfig(teil: Partial<Konfig> | null): Readonly<Konfig> {
  K.v = teil ? Object.freeze({ ...ladeKonfig(process.env), ...teil }) : null;
  return konfig();
}

/** Für Tests und Skripte, die process.env nach dem Start umstellen. */
export function readKonfigNew(): Readonly<Konfig> {
  return setKonfig(null);
}

export function checkKonfigOnStart(): Konfig {
  try {
    return konfig();
  } catch (e) {
    if (!(e instanceof KonfigFehler)) throw e;
    console.error(`❌ ${e.message}\n   Siehe .env.example.`);
    process.exit(1);
  }
}

/** Für Server, Worker und Skripte gleich: Eigene Vorgaben verbanden sich
 * ausserhalb von Docker mit einer anderen Datenbank. */
export function databaseConnection(env: NodeJS.ProcessEnv = process.env) {
  secretsFromFiles(env);
  if (env.DATABASE_URL) return { connectionString: env.DATABASE_URL };
  return {
    host: env.PGHOST || 'postgres',
    port: parseInt(env.PGPORT || '5432', 10),
    user: env.PGUSER || 'brickinventory',
    password: env.PGPASSWORD || STANDARD_DB_PASSWORD,
    database: env.PGDATABASE || 'brickinventory',
  };
}

/** Die Systemrolle (BYPASSRLS) für Arbeit über Kontogrenzen, sonst null: Mit
 * einer einzigen Rolle, der die Tabellen gehören, greift der Zeilenschutz nicht. */
export function systemConnection(env: NodeJS.ProcessEnv = process.env, art = 'PGSYSTEM') {
  secretsFromFiles(env);
  const user = env[`${art}_USER`]?.trim();
  if (!user) return null;
  const password = env[`${art}_PASSWORD`] ?? '';
  const basis = databaseConnection(env);
  if (!('connectionString' in basis)) return { ...basis, user, password };
  const u = new URL(basis.connectionString);
  u.username = encodeURIComponent(user);
  u.password = encodeURIComponent(password);
  return { connectionString: u.toString() };
}

export const systemWebConnection = (env: NodeJS.ProcessEnv = process.env) => systemConnection(env, 'PGSYSTEM_WEB');

/** Das Beispielpasswort aus compose.yaml; es steht in jedem öffentlichen Klon. */
export const STANDARD_DB_PASSWORD = 'brickinventory_secret';

/** In Produktion ein Startverbot. */
export function standardPasswordInUse(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = databaseConnection(env);
  if (!('connectionString' in v)) return v.password === STANDARD_DB_PASSWORD;
  try {
    return decodeURIComponent(new URL(v.connectionString).password) === STANDARD_DB_PASSWORD;
  } catch {
    return false;
  }
}

/** Ein öffentlich bekanntes Datenbankpasswort oder ein TRUST_PROXY, der Clients
 * ihre Adresse selbst angeben lässt, soll beim Deploy auffallen. */
export function startBans(env: NodeJS.ProcessEnv = process.env): string[] {
  if (developmentEnvironment(env)) return [];
  const reasons: string[] = [];
  if (standardPasswordInUse(env))
    reasons.push(
      '[datenbank] Die Datenbank benutzt das Beispielpasswort „brickinventory_secret" aus compose.yaml — ' +
        "Start verweigert. Ein eigenes setzen: in psql `ALTER USER brickinventory PASSWORD '…';` und denselben " +
        'Wert als DB_PASSWORD in .env (siehe UPGRADE.md).',
    );
  try {
    proxyVertrauen(env.TRUST_PROXY, env.PROXY_NETZ_BESTAETIGT?.trim() === '1');
  } catch (e) {
    reasons.push(`[proxy] ${(e as Error).message} Start verweigert.`);
  }
  // Ohne die Adresse kennt der Host-Filter keinen Namen und nimmt nur IP-Adressen an; wer das will, sagt es.
  if (
    !env.APP_BASE_URL?.trim() &&
    env.ROLLE?.trim().toLowerCase() !== 'jobs' &&
    env.APP_BASE_URL_FEHLT_OK?.trim() !== '1'
  )
    reasons.push(
      '[start] APP_BASE_URL fehlt im Betrieb: Der Host-Filter nähme nur IP-Adressen an — Start verweigert. ' +
        'In .env setzen (README.md); nur bewusst ohne: APP_BASE_URL_FEHLT_OK=1 (UPGRADE.md).',
    );
  if (env.MAIL_KONSOLE_MIT_TOKEN?.trim() === '1')
    reasons.push(
      '[mail] MAIL_KONSOLE_MIT_TOKEN=1 schreibt Rücksetz- und Bestätigungslinks samt Token ins Protokoll — ' +
        'im Betrieb Start verweigert. Nur auf einem Entwicklungsrechner setzen (NODE_ENV=development).',
    );
  return reasons;
}

/** Erlaubt, aber laut: Schalter, die im Betrieb eine Schutzschicht abschalten. */
export function startWarnings(env: NodeJS.ProcessEnv = process.env): string[] {
  if (developmentEnvironment(env)) return [];
  const w: string[] = [];
  if (schalter(env, 'COOKIE_SECURE', []) === false)
    w.push(
      '[start] COOKIE_SECURE=0: Das Sitzungs-Cookie geht auch über http, Passwort und Sitzung lesbar durchs Netz. ' +
        'Nur ohne TLS gedacht (README.md, „Ohne HTTPS“).',
    );
  if (env.HSTS_MAX_AGE?.trim() === '0')
    w.push(
      '[start] HSTS_MAX_AGE=0: Browser vergessen, dass der Server nur HTTPS spricht; ein Angreifer im Netz ' +
        'kann die erste Anfrage auf http umlenken. Nur zum Rückbau von HTTPS gedacht (README.md).',
    );
  if (dbWithoutTls(env))
    w.push(
      '[datenbank] Die Datenbank liegt auf einem anderen Rechner, die Verbindung prüft aber kein Zertifikat: ' +
        'Passwort und Daten gehen ungeschützt durchs Netz. PGSSLMODE=verify-full setzen (bzw. sslmode=verify-full ' +
        'in DATABASE_URL), README.md „Externe Datenbank“.',
    );
  return w;
}

/** Klartext nur auf demselben Rechner: Loopback, Socket oder ein Name ohne Punkt.
 * Den vergibt Docker für Dienste und Container im eigenen Netz (`postgres`,
 * `db-brickinventory`); ein Rechner im LAN hat in der Regel einen Namen mit Domain. */
function dbWithoutTls(env: NodeJS.ProcessEnv): boolean {
  let host = env.PGHOST?.trim() || 'postgres',
    modus = env.PGSSLMODE?.trim() || '';
  if (env.DATABASE_URL) {
    try {
      const u = new URL(env.DATABASE_URL);
      host = u.hostname.replace(/^\[|\]$/g, '') || 'localhost';
      modus = u.searchParams.get('sslmode') || modus;
    } catch {
      return false;
    }
  }
  const nah = ['127.0.0.1', '::1'].includes(host) || host.startsWith('/') || /^[a-z0-9_-]+$/i.test(host);
  return !nah && !/^verify-(ca|full)$/.test(modus);
}
