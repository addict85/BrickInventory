/** THE one place that reads process.env: an invalid value is a
 * startup error with name and reason, instead of silently falling back to a default.
 * The list with explanations is in .env.example. */
import { proxyVertrauen } from './proxyTrust';
import { readFileSync } from 'node:fs';
import { processWide } from './prozessweit';

type Environment = Record<string, string | undefined>;

/** Docker secrets: if X_FILE is set, X comes from the file instead of from the environment,
 * which `docker inspect` and /proc/<pid>/environ show to anyone who looks there. */
export const FILE_VARIABLES = [
  'SESSION_SECRET',
  'PGPASSWORD',
  'PGSYSTEM_PASSWORD',
  'PGSYSTEM_WEB_PASSWORD',
  'DATABASE_URL',
  'ADMIN_PASSWORD',
] as const;

/** Transfers every readable X_FILE to X and removes X_FILE; a second call changes nothing. */
export function secretsFromFiles(env: Environment): string[] {
  const fehler: string[] = [];
  for (const name of FILE_VARIABLES) {
    const file = env[`${name}_FILE`]?.trim();
    if (!file) continue;
    if (env[name]) {
      fehler.push(`${name} und ${name}_FILE sind beide gesetzt — nur eines davon`);
      continue;
    }
    try {
      env[name] = readFileSync(file, 'utf8').replace(/\r?\n$/, '');
      delete env[`${name}_FILE`];
    } catch (e) {
      fehler.push(`${name}_FILE="${file}" ist nicht lesbar (${(e as NodeJS.ErrnoException).code ?? e})`);
    }
  }
  return fehler;
}

export interface Konfig {
  production: boolean;
  nodeEnv: string;
  /** Only explicitly development or test: without NODE_ENV the production rules apply. */
  entwicklung: boolean;
  /** Everything except development/test: even without NODE_ENV the production prohibitions apply. */
  operation: boolean;
  /** Way out for starting as a database superuser in production (UPGRADE.md). */
  dbSuperuserAllowed: boolean;
  port: number;
  hstsMaxAge: number;
  trustProxy: string | undefined;
  /** A network spanning more than eight addresses in TRUST_PROXY is intended (src/infra/proxyTrust.ts). */
  proxyNetworkConfirmed: boolean;
  sessionSecret: string | undefined;
  /** null: according to NODE_ENV (secure only in production). */
  cookieSecure: boolean | null;
  sitzungLeerlaufMin: number;
  sitzungHoechstStd: number;
  /** An open admin session is worth more: shorter, at most the general deadlines. */
  sitzungVerwalterLeerlaufMin: number;
  sitzungVerwalterHoechstStd: number;
  tokenIdleDays: number;
  /** Upper bound of a device access from login on; the swap inherits it, then the app signs in again. */
  tokenMaxDays: number;
  rolle: Role;
  /** For a hint at startup. */
  veraltet: string[];
  pgPoolMax: number | null;
  pgPoolMin: number;
  pgIdleMs: number;
  pgConnMs: number;
  pgStmtMs: number;
  /** A hanging transaction would otherwise hold advisory and row locks indefinitely. */
  pgIdleTxMs: number;
  pgSperreMs: number;
  adminPassword: string;
  appBaseUrl: string | null;
  appRoot: string | null;
  appVersion: string | null;
  datenSchluessel: string;
  /** Path of the key file; null: <APP_ROOT>/schluessel/datenschluessel. */
  dataKeyFile: string | null;
  /** The previous key during a rotation (DATA_KEY_ALT or the file). */
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
  /** null: according to cores and cgroup quota (src/account/bcryptLimit.ts). */
  bcryptArbeiter: number | null;
  jobDeadlineSec: number;
  /** PEM; null: no own CA. */
  caCertificate: string | null;
  hinterTls: boolean;
  /** Only in tests: check responses against the API contract (src/http/contractRouter.ts). */
  checkContract: boolean;
  /** SHA-256 of the app's signing certificates, 64 hex characters in upper case. */
  androidZertifikate: string[];
  androidPaket: string;
  /** PEM instead of the Google roots; only in development and test (src/devices/attestation). */
  attestationWurzeln: string | null;
  /** Until then, device keys registered before the attestation apply (UPGRADE.md). */
  geraeteschluesselAltBis: Date;
  /** Google's revocation list may be at most this old; if older, the server accepts no key. */
  attestationRevocationDays: number;
  attestationPatchAtLeast: number | null;
}

export type Role = 'web' | 'jobs' | 'beides';
const ROLES: readonly Role[] = ['web', 'jobs', 'beides'];

/** Other modules name it too; maximum duration one week like the browser token. */
export const DEFAULT = {
  sitzungLeerlaufMin: 240,
  sitzungHoechstStd: 168,
  sitzungVerwalterLeerlaufMin: 30,
  sitzungVerwalterHoechstStd: 12,
  jobParallel: 4,
  jobDeadlineSec: 300,
} as const;

/** The message names every invalid variable. */
export class KonfigFehler extends Error {
  constructor(readonly fehler: string[]) {
    super(`Ungültige Konfiguration:\n  - ${fehler.join('\n  - ')}`);
    this.name = 'KonfigFehler';
  }
}

/** Every variable ladeKonfig reads; .env.example names them all (test/konfig.test.js). */
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
  'TOKEN_MAX_DAYS',
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

/** If it is still in an old compose.yaml, startup says so. */
const STALE = ['WEB_WORKERS'] as const;

/** Without a value both in one process: the simple start without Compose. */
function roleFrom(env: Environment, fehler: string[]): Role {
  const raw = env.ROLLE?.trim().toLowerCase() || 'beides';
  if ((ROLES as readonly string[]).includes(raw)) return raw as Role;
  fehler.push(`ROLLE="${env.ROLLE}" ist weder web noch jobs noch beides`);
  return 'beides';
}

function integer(
  env: Environment,
  name: string,
  defaultValue: number,
  min: number,
  max: number,
  fehler: string[],
): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') return defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    fehler.push(`${name}="${raw}" ist keine ganze Zahl von ${min} bis ${max}`);
    return defaultValue;
  }
  return n;
}

function zahl(env: Environment, name: string, defaultValue: number, fehler: string[]): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') return defaultValue;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    fehler.push(`${name}="${raw}" ist keine positive Zahl`);
    return defaultValue;
  }
  return n;
}

function flag(env: Environment, name: string, fehler: string[]): boolean | null {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') return null;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  fehler.push(`${name}="${raw}" ist weder 1 noch 0`);
  return null;
}

/** Every signing key (own, Play App Signing, debug) yields a different
 * hash; which version a server's users have is only known by its operator.
 * Empty: the server accepts no passkey response from an app. */
function androidCertificates(env: Environment, fehler: string[]): string[] {
  const raw = env.PASSKEY_ANDROID_ZERTIFIKATE?.trim() || '';
  const list = raw ? raw.split(/[\s,;]+/).filter(Boolean) : [];
  const hex = list.map(f => f.replace(/:/g, '').toUpperCase());
  const wrong = list.filter((_, i) => !/^[0-9A-F]{64}$/.test(hex[i] ?? ''));
  if (wrong.length)
    fehler.push(`PASSKEY_ANDROID_ZERTIFIKATE: ${wrong.join(', ')} ist kein SHA-256-Fingerabdruck (64 Hex-Zeichen)`);
  return wrong.length ? [] : [...new Set(hex)];
}

function androidPackage(env: Environment, fehler: string[]): string {
  const pkg = env.PASSKEY_ANDROID_PAKET?.trim() || 'ch.brickinventoryapp';
  if (/^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/.test(pkg)) return pkg;
  fehler.push(`PASSKEY_ANDROID_PAKET="${pkg}" ist kein Paketname`);
  return 'ch.brickinventoryapp';
}

/** An own root would open the step guard to every key it signs:
 * hence only where NODE_ENV explicitly says development or test. */
function attestationRoots(env: Environment, fehler: string[]): string | null {
  const pem = env.ATTESTATION_WURZELN?.trim() || null;
  if (pem && !developmentEnvironment(env))
    fehler.push('ATTESTATION_WURZELN gilt nur mit NODE_ENV=development oder test');
  return pem;
}

export const LEGACY_KEY_CUTOFF_DATE = '2027-02-01';

function legacyKeyUntil(env: Environment, fehler: string[]): Date {
  const raw = env.GERAETESCHLUESSEL_ALT_BIS?.trim() || LEGACY_KEY_CUTOFF_DATE;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00Z`) : new Date(Number.NaN);
  const cutoffDate = new Date(`${LEGACY_KEY_CUTOFF_DATE}T00:00:00Z`);
  // Only earlier, never later: a date in the distant future would let unattested keys apply permanently.
  if (d.getTime() <= cutoffDate.getTime()) return d;
  fehler.push(
    Number.isNaN(d.getTime())
      ? `GERAETESCHLUESSEL_ALT_BIS="${raw}" ist kein Datum JJJJ-MM-TT`
      : `GERAETESCHLUESSEL_ALT_BIS="${raw}" liegt nach ${LEGACY_KEY_CUTOFF_DATE}; nur ein früheres Datum ist erlaubt`,
  );
  return cutoffDate;
}

function patchAtLeast(env: Environment, fehler: string[]): number | null {
  const raw = env.ATTESTATION_PATCH_MINDESTENS?.trim();
  if (!raw) return null;
  if (/^20\d\d(0[1-9]|1[0-2])$/.test(raw)) return Number(raw);
  fehler.push(`ATTESTATION_PATCH_MINDESTENS="${raw}" ist kein Monat JJJJMM`);
  return null;
}

/** Safe enough to be inserted into a connection option. */
export function timeZoneValid(name: string): boolean {
  if (!/^[A-Za-z0-9_+\-/]+$/.test(name)) return false;
  try {
    new Intl.DateTimeFormat('de', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** If set explicitly, the zone must be correct; TZ and the process zone are only
 * a fallback and fall back to UTC for a foreign value. */
function zoneFrom(env: Environment, fehler: string[]): string {
  let zone = env.ERFASSUNG_ZEITZONE?.trim() || '';
  if (zone && !timeZoneValid(zone)) {
    fehler.push(`ERFASSUNG_ZEITZONE="${zone}" ist keine bekannte Zeitzone`);
    zone = '';
  }
  if (!zone) zone = env.TZ?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return timeZoneValid(zone) ? zone : 'UTC';
}

function developmentEnvironment(env: Environment): boolean {
  return ['development', 'test'].includes(env.NODE_ENV?.trim() ?? '');
}

/** Throws KonfigFehler with all errors at once. */
/** Deadlines of the browser session; for admins separate, shorter ones (src/account/sessionDeadline.ts). */
function sessionConfig(env: Environment, f: string[]) {
  return {
    sitzungLeerlaufMin: integer(env, 'SESSION_IDLE_MINUTES', DEFAULT.sitzungLeerlaufMin, 1, 525_600, f),
    sitzungHoechstStd: integer(env, 'SESSION_MAX_HOURS', DEFAULT.sitzungHoechstStd, 1, 87_600, f),
    sitzungVerwalterLeerlaufMin: integer(
      env,
      'SESSION_ADMIN_IDLE_MINUTES',
      DEFAULT.sitzungVerwalterLeerlaufMin,
      1,
      525_600,
      f,
    ),
    sitzungVerwalterHoechstStd: integer(
      env,
      'SESSION_ADMIN_MAX_HOURS',
      DEFAULT.sitzungVerwalterHoechstStd,
      1,
      87_600,
      f,
    ),
  };
}

export function ladeKonfig(env: Environment = process.env): Konfig {
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

  const pgPoolMax = env.PG_POOL_MAX?.trim() ? integer(env, 'PG_POOL_MAX', 15, 1, 1000, f) : null;
  const k: Konfig = {
    production: nodeEnv === 'production',
    nodeEnv,
    entwicklung: developmentEnvironment(env),
    operation: !developmentEnvironment(env),
    dbSuperuserAllowed: flag(env, 'DB_SUPERUSER_ERLAUBT', f) === true,
    port: integer(env, 'PORT', 3000, 1, 65535, f),
    hstsMaxAge: integer(env, 'HSTS_MAX_AGE', 31_536_000, 0, 2 ** 31 - 1, f),
    trustProxy: env.TRUST_PROXY,
    proxyNetworkConfirmed: flag(env, 'PROXY_NETZ_BESTAETIGT', f) === true,
    sessionSecret: env.SESSION_SECRET || undefined,
    cookieSecure: flag(env, 'COOKIE_SECURE', f),
    ...sessionConfig(env, f),
    tokenIdleDays: integer(env, 'TOKEN_IDLE_DAYS', 90, 1, 36_500, f),
    tokenMaxDays: integer(env, 'TOKEN_MAX_DAYS', 90, 1, 365, f),
    rolle: roleFrom(env, f),
    veraltet: STALE.filter(n => env[n]?.trim()),
    pgPoolMax,
    pgPoolMin: integer(env, 'PG_POOL_MIN', 2, 0, 1000, f),
    pgIdleMs: integer(env, 'PG_IDLE_MS', 30_000, 0, 86_400_000, f),
    pgConnMs: integer(env, 'PG_CONN_MS', 30_000, 0, 600_000, f),
    pgStmtMs: integer(env, 'PG_STMT_MS', 30_000, 0, 86_400_000, f),
    pgIdleTxMs: integer(env, 'PG_IDLE_TX_MS', 60_000, 0, 86_400_000, f),
    pgSperreMs: integer(env, 'PG_LOCK_MS', 10_000, 0, 86_400_000, f),
    adminPassword: env.ADMIN_PASSWORD || '',
    appBaseUrl: basis,
    appRoot: env.APP_ROOT?.trim() || null,
    appVersion: env.APP_VERSION?.trim() || null,
    datenSchluessel,
    dataKeyFile: env.DATA_KEY_FILE?.trim() || null,
    dataKeyAlt,
    dataKeyAltFile: env.DATA_KEY_ALT_FILE?.trim() || null,
    entryTimeZone: zone,
    // 0 or less switches off trimming the price history.
    priceHistoryDays: integer(env, 'PRICE_HISTORY_KEEP_DAYS', 1095, -1, 36_500, f),
    uploadQuotaMb: zahl(env, 'UPLOAD_KONTINGENT_MB', 2048, f),
    uploadTotalMb: zahl(env, 'UPLOAD_GESAMT_MB', 20_480, f),
    mailConsoleWithToken: env.MAIL_KONSOLE_MIT_TOKEN?.trim() === '1',
    bildUserAgent: env.IMG_USER_AGENT?.trim() || null,
    imageCacheMaxMb: zahl(env, 'BILD_CACHE_MAX_MB', 2048, f),
    imageFetchesJeMinute: integer(env, 'BILD_ABRUFE_JE_MINUTE', 240, 1, 100_000, f),
    csvRowDeadlineMs: integer(env, 'CSV_ZEILE_FRIST_MS', 120_000, 1, 86_400_000, f),
    jobParallel: integer(env, 'AUFTRAG_PARALLEL', DEFAULT.jobParallel, 1, 64, f),
    bcryptArbeiter: env.BCRYPT_ARBEITER?.trim() ? integer(env, 'BCRYPT_ARBEITER', 4, 1, 64, f) : null,
    jobDeadlineSec: integer(env, 'AUFTRAG_FRIST_SEK', DEFAULT.jobDeadlineSec, 1, 86_400, f),
    caCertificate: env.CA_ZERTIFIKAT?.trim() || null,
    hinterTls: !!basis && /^https:\/\//i.test(basis),
    checkContract: env.VERTRAG_PRUEFEN?.trim() === '1',
    androidZertifikate: androidCertificates(env, f),
    androidPaket: androidPackage(env, f),
    attestationWurzeln: attestationRoots(env, f),
    geraeteschluesselAltBis: legacyKeyUntil(env, f),
    attestationRevocationDays: integer(env, 'ATTESTATION_WIDERRUF_TAGE', 7, 1, 90, f),
    attestationPatchAtLeast: patchAtLeast(env, f),
  };
  if (f.length) throw new KonfigFehler(f);
  return k;
}

/** In production and behind Caddy (APP_BASE_URL https://). COOKIE_SECURE=0 is the deliberate
 * exception for an operation without TLS. */
export function cookieSafe(k: Konfig): boolean {
  return k.cookieSecure ?? (k.operation || k.hinterTls);
}

const K = processWide('konfig', () => ({ v: null as Readonly<Konfig> | null }));

/** Read on the first call and frozen: konfig() is on the hot path
 * of every request, and production does not change its environment at runtime.
 * Whoever does (tests) says so explicitly with setKonfig/readKonfigNew. */
export function konfig(): Readonly<Konfig> {
  K.v ??= Object.freeze(ladeKonfig(process.env));
  return K.v;
}

/** For tests: lay individual values over the read configuration; null lifts that. */
export function setKonfig(teil: Partial<Konfig> | null): Readonly<Konfig> {
  K.v = teil ? Object.freeze({ ...ladeKonfig(process.env), ...teil }) : null;
  return konfig();
}

/** For tests and scripts that change process.env after startup. */
export function readKonfigNew(): Readonly<Konfig> {
  return setKonfig(null);
}

export function checkConfigOnStart(): Konfig {
  try {
    return konfig();
  } catch (e) {
    if (!(e instanceof KonfigFehler)) throw e;
    console.error(`❌ ${e.message}\n   Siehe .env.example.`);
    process.exit(1);
  }
}

/** The same for server, worker and scripts: own defaults connected to a different database
 * outside of Docker. */
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

/** The system role (BYPASSRLS) for work across account boundaries, otherwise null: with
 * a single role that owns the tables, row security does not apply. */
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

/** The example password from compose.yaml; it is in every public clone. */
export const STANDARD_DB_PASSWORD = 'brickinventory_secret';

/** A startup prohibition in production. */
export function standardPasswordInUse(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = databaseConnection(env);
  if (!('connectionString' in v)) return v.password === STANDARD_DB_PASSWORD;
  try {
    return decodeURIComponent(new URL(v.connectionString).password) === STANDARD_DB_PASSWORD;
  } catch {
    return false;
  }
}

/** A publicly known database password or a TRUST_PROXY that lets clients
 * state their address themselves should stand out on deploy. */
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
  // Without the address the host filter knows no name and accepts only IP addresses; whoever wants that says so.
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

/** Allowed, but loud: switches that turn off a protection layer in production. */
export function startWarnings(env: NodeJS.ProcessEnv = process.env): string[] {
  if (developmentEnvironment(env)) return [];
  const w: string[] = [];
  if (flag(env, 'COOKIE_SECURE', []) === false)
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

/** Plaintext only on the same machine: loopback, socket or a name without a dot.
 * Docker assigns those for services and containers in its own network (`postgres`,
 * `db-brickinventory`); a machine on the LAN usually has a name with a domain. */
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
