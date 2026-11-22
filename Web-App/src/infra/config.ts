/** THE one place that reads process.env: an invalid value is a
 * startup error with name and reason, instead of silently falling back to a default.
 * The list with explanations is in .env.example. */
import { proxyTrust } from './proxyTrust';
import { readFileSync } from 'node:fs';
import { processWide } from './processWide';

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
  const error: string[] = [];
  for (const name of FILE_VARIABLES) {
    const file = env[`${name}_FILE`]?.trim();
    if (!file) continue;
    if (env[name]) {
      error.push(`${name} und ${name}_FILE sind beide gesetzt — nur eines davon`);
      continue;
    }
    try {
      env[name] = readFileSync(file, 'utf8').replace(/\r?\n$/, '');
      delete env[`${name}_FILE`];
    } catch (e) {
      error.push(`${name}_FILE="${file}" ist nicht lesbar (${(e as NodeJS.ErrnoException).code ?? e})`);
    }
  }
  return error;
}

export interface AppConfig {
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
  /** Old variable names still in use (`ALT → NEU`), for a warning at startup. */
  renamed: string[];
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

export type Role = 'web' | 'jobs' | 'both';
const ROLES: readonly Role[] = ['web', 'jobs', 'both'];

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
export class ConfigError extends Error {
  constructor(readonly error: string[]) {
    super(`Ungültige Konfiguration:\n  - ${error.join('\n  - ')}`);
    this.name = 'KonfigFehler';
  }
}

/** Every variable ladeKonfig reads; .env.example names them all (test/konfig.test.js). */
export const VARIABLES = [
  'NODE_ENV',
  'PORT',
  'HSTS_MAX_AGE',
  'TRUST_PROXY',
  'PROXY_NETWORK_CONFIRMED',
  'SESSION_SECRET',
  'COOKIE_SECURE',
  'SESSION_IDLE_MINUTES',
  'SESSION_MAX_HOURS',
  'SESSION_ADMIN_IDLE_MINUTES',
  'SESSION_ADMIN_MAX_HOURS',
  'TOKEN_IDLE_DAYS',
  'TOKEN_MAX_DAYS',
  'ROLE',
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
  'APP_BASE_URL_MISSING_OK',
  'APP_ROOT',
  'APP_VERSION',
  'DATA_KEY',
  'DATA_KEY_FILE',
  'DATA_KEY_ALT',
  'DATA_KEY_ALT_FILE',
  'ACQUISITION_TIME_ZONE',
  'TZ',
  'PRICE_HISTORY_KEEP_DAYS',
  'UPLOAD_QUOTA_MB',
  'UPLOAD_TOTAL_MB',
  'MAIL_CONSOLE_WITH_TOKEN',
  'IMG_USER_AGENT',
  'IMAGE_CACHE_MAX_MB',
  'IMAGE_FETCHES_PER_MINUTE',
  'CSV_ROW_DEADLINE_MS',
  'JOB_PARALLEL',
  'BCRYPT_WORKERS',
  'JOB_DEADLINE_SEC',
  'CA_CERTIFICATE',
  'CHECK_CONTRACT',
  'PASSKEY_ANDROID_CERTIFICATES',
  'PASSKEY_ANDROID_PACKAGE',
  'DB_SUPERUSER_ALLOWED',
  'ATTESTATION_ROOTS',
  'DEVICE_KEY_OLD_UNTIL',
  'ATTESTATION_REVOCATION_DAYS',
  'ATTESTATION_PATCH_MINIMUM',
  ...FILE_VARIABLES.map(n => `${n}_FILE` as const),
] as const;

/** Renamed from German to English; the old name still counts, and startup names it
 * (server.ts), so that an existing .env keeps working until it is switched over. */
export const RENAMED_VARIABLES: Readonly<Record<string, string>> = {
  ROLE: 'ROLLE',
  PROXY_NETWORK_CONFIRMED: 'PROXY_NETZ_BESTAETIGT',
  APP_BASE_URL_MISSING_OK: 'APP_BASE_URL_FEHLT_OK',
  ACQUISITION_TIME_ZONE: 'ERFASSUNG_ZEITZONE',
  UPLOAD_QUOTA_MB: 'UPLOAD_KONTINGENT_MB',
  UPLOAD_TOTAL_MB: 'UPLOAD_GESAMT_MB',
  MAIL_CONSOLE_WITH_TOKEN: 'MAIL_KONSOLE_MIT_TOKEN',
  IMAGE_CACHE_MAX_MB: 'BILD_CACHE_MAX_MB',
  IMAGE_FETCHES_PER_MINUTE: 'BILD_ABRUFE_JE_MINUTE',
  CSV_ROW_DEADLINE_MS: 'CSV_ZEILE_FRIST_MS',
  JOB_PARALLEL: 'AUFTRAG_PARALLEL',
  BCRYPT_WORKERS: 'BCRYPT_ARBEITER',
  JOB_DEADLINE_SEC: 'AUFTRAG_FRIST_SEK',
  CA_CERTIFICATE: 'CA_ZERTIFIKAT',
  CHECK_CONTRACT: 'VERTRAG_PRUEFEN',
  PASSKEY_ANDROID_CERTIFICATES: 'PASSKEY_ANDROID_ZERTIFIKATE',
  PASSKEY_ANDROID_PACKAGE: 'PASSKEY_ANDROID_PAKET',
  DB_SUPERUSER_ALLOWED: 'DB_SUPERUSER_ERLAUBT',
  ATTESTATION_ROOTS: 'ATTESTATION_WURZELN',
  DEVICE_KEY_OLD_UNTIL: 'GERAETESCHLUESSEL_ALT_BIS',
  ATTESTATION_REVOCATION_DAYS: 'ATTESTATION_WIDERRUF_TAGE',
  ATTESTATION_PATCH_MINIMUM: 'ATTESTATION_PATCH_MINDESTENS',
};

/** The environment with every old name copied to its new one, unless the new one is set. */
export function withRenamedVariables(env: Environment): Environment {
  const out: Environment = { ...env };
  for (const [neu, alt] of Object.entries(RENAMED_VARIABLES))
    if (out[neu] === undefined && env[alt] !== undefined) out[neu] = env[alt];
  return out;
}

/** Old names that are set: `ALT → NEU`, for the warning at startup. */
export function renamedInUse(env: Environment): string[] {
  return Object.entries(RENAMED_VARIABLES)
    .filter(([, alt]) => env[alt] !== undefined)
    .map(([neu, alt]) => `${alt} → ${neu}`);
}

/** If it is still in an old compose.yaml, startup says so. */
const STALE = ['WEB_WORKERS'] as const;

/** Without a value both in one process: the simple start without Compose. */
function roleFrom(env: Environment, error: string[]): Role {
  const raw = env.ROLE?.trim().toLowerCase() || 'both';
  // 'beides' is the value from before the English names; it still means both.
  if (raw === 'beides') return 'both';
  if ((ROLES as readonly string[]).includes(raw)) return raw as Role;
  error.push(`ROLE="${env.ROLE}" ist weder web noch jobs noch both`);
  return 'both';
}

function integer(
  env: Environment,
  name: string,
  defaultValue: number,
  min: number,
  max: number,
  error: string[],
): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') return defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    error.push(`${name}="${raw}" ist keine ganze Zahl von ${min} bis ${max}`);
    return defaultValue;
  }
  return n;
}

function number(env: Environment, name: string, defaultValue: number, error: string[]): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') return defaultValue;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    error.push(`${name}="${raw}" ist keine positive Zahl`);
    return defaultValue;
  }
  return n;
}

function flag(env: Environment, name: string, error: string[]): boolean | null {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') return null;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  error.push(`${name}="${raw}" ist weder 1 noch 0`);
  return null;
}

/** Every signing key (own, Play App Signing, debug) yields a different
 * hash; which version a server's users have is only known by its operator.
 * Empty: the server accepts no passkey response from an app. */
function androidCertificates(env: Environment, error: string[]): string[] {
  const raw = env.PASSKEY_ANDROID_CERTIFICATES?.trim() || '';
  const list = raw ? raw.split(/[\s,;]+/).filter(Boolean) : [];
  const hex = list.map(f => f.replace(/:/g, '').toUpperCase());
  const wrong = list.filter((_, i) => !/^[0-9A-F]{64}$/.test(hex[i] ?? ''));
  if (wrong.length)
    error.push(`PASSKEY_ANDROID_CERTIFICATES: ${wrong.join(', ')} ist kein SHA-256-Fingerabdruck (64 Hex-Zeichen)`);
  return wrong.length ? [] : [...new Set(hex)];
}

function androidPackage(env: Environment, error: string[]): string {
  const pkg = env.PASSKEY_ANDROID_PACKAGE?.trim() || 'ch.brickinventoryapp';
  if (/^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/.test(pkg)) return pkg;
  error.push(`PASSKEY_ANDROID_PACKAGE="${pkg}" ist kein Paketname`);
  return 'ch.brickinventoryapp';
}

/** An own root would open the step guard to every key it signs:
 * hence only where NODE_ENV explicitly says development or test. */
function attestationRoots(env: Environment, error: string[]): string | null {
  const pem = env.ATTESTATION_ROOTS?.trim() || null;
  if (pem && !developmentEnvironment(env)) error.push('ATTESTATION_ROOTS gilt nur mit NODE_ENV=development oder test');
  return pem;
}

export const LEGACY_KEY_CUTOFF_DATE = '2027-02-01';

function legacyKeyUntil(env: Environment, error: string[]): Date {
  const raw = env.DEVICE_KEY_OLD_UNTIL?.trim() || LEGACY_KEY_CUTOFF_DATE;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00Z`) : new Date(Number.NaN);
  const cutoffDate = new Date(`${LEGACY_KEY_CUTOFF_DATE}T00:00:00Z`);
  // Only earlier, never later: a date in the distant future would let unattested keys apply permanently.
  if (d.getTime() <= cutoffDate.getTime()) return d;
  error.push(
    Number.isNaN(d.getTime())
      ? `DEVICE_KEY_OLD_UNTIL="${raw}" ist kein Datum JJJJ-MM-TT`
      : `DEVICE_KEY_OLD_UNTIL="${raw}" liegt nach ${LEGACY_KEY_CUTOFF_DATE}; nur ein früheres Datum ist erlaubt`,
  );
  return cutoffDate;
}

function patchAtLeast(env: Environment, error: string[]): number | null {
  const raw = env.ATTESTATION_PATCH_MINIMUM?.trim();
  if (!raw) return null;
  if (/^20\d\d(0[1-9]|1[0-2])$/.test(raw)) return Number(raw);
  error.push(`ATTESTATION_PATCH_MINIMUM="${raw}" ist kein Monat JJJJMM`);
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
function zoneFrom(env: Environment, error: string[]): string {
  let zone = env.ACQUISITION_TIME_ZONE?.trim() || '';
  if (zone && !timeZoneValid(zone)) {
    error.push(`ACQUISITION_TIME_ZONE="${zone}" ist keine bekannte Zeitzone`);
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

/** A data key is 32 bytes as base64; anything else is reported, not shortened. */
function checkedDataKey(env: Environment, name: string, hint: string, f: string[]): string {
  const v = env[name]?.trim() || '';
  if (v && Buffer.from(v, 'base64').length !== 32) f.push(`${name} muss 32 Byte als base64 sein (${hint})`);
  return v;
}

export function loadConfig(raw: Environment = process.env): AppConfig {
  // Files first and on `raw` itself: X_FILE leaves the caller's environment, so a second
  // call (or a later reader of process.env) does not see both X and X_FILE.
  const f: string[] = secretsFromFiles(raw);
  const env = withRenamedVariables(raw);
  const nodeEnv = env.NODE_ENV?.trim() || 'development';

  const basis = env.APP_BASE_URL?.trim().replace(/\/+$/, '') || null;
  if (basis && !/^https?:\/\/[^/\s]+/i.test(basis))
    f.push(`APP_BASE_URL="${env.APP_BASE_URL}" ist keine http(s)-Adresse`);

  const datenSchluessel = checkedDataKey(env, 'DATA_KEY', 'openssl rand -base64 32', f);
  const dataKeyAlt = checkedDataKey(env, 'DATA_KEY_ALT', 'der vorige DATA_KEY', f);

  const zone = zoneFrom(env, f);

  const pgPoolMax = env.PG_POOL_MAX?.trim() ? integer(env, 'PG_POOL_MAX', 15, 1, 1000, f) : null;
  const k: AppConfig = {
    production: nodeEnv === 'production',
    nodeEnv,
    entwicklung: developmentEnvironment(env),
    operation: !developmentEnvironment(env),
    dbSuperuserAllowed: flag(env, 'DB_SUPERUSER_ALLOWED', f) === true,
    port: integer(env, 'PORT', 3000, 1, 65535, f),
    hstsMaxAge: integer(env, 'HSTS_MAX_AGE', 31_536_000, 0, 2 ** 31 - 1, f),
    trustProxy: env.TRUST_PROXY,
    proxyNetworkConfirmed: flag(env, 'PROXY_NETWORK_CONFIRMED', f) === true,
    sessionSecret: env.SESSION_SECRET || undefined,
    cookieSecure: flag(env, 'COOKIE_SECURE', f),
    ...sessionConfig(env, f),
    tokenIdleDays: integer(env, 'TOKEN_IDLE_DAYS', 90, 1, 36_500, f),
    tokenMaxDays: integer(env, 'TOKEN_MAX_DAYS', 90, 1, 365, f),
    rolle: roleFrom(env, f),
    veraltet: STALE.filter(n => env[n]?.trim()),
    renamed: renamedInUse(raw),
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
    uploadQuotaMb: number(env, 'UPLOAD_QUOTA_MB', 2048, f),
    uploadTotalMb: number(env, 'UPLOAD_TOTAL_MB', 20_480, f),
    mailConsoleWithToken: env.MAIL_CONSOLE_WITH_TOKEN?.trim() === '1',
    bildUserAgent: env.IMG_USER_AGENT?.trim() || null,
    imageCacheMaxMb: number(env, 'IMAGE_CACHE_MAX_MB', 2048, f),
    imageFetchesJeMinute: integer(env, 'IMAGE_FETCHES_PER_MINUTE', 240, 1, 100_000, f),
    csvRowDeadlineMs: integer(env, 'CSV_ROW_DEADLINE_MS', 120_000, 1, 86_400_000, f),
    jobParallel: integer(env, 'JOB_PARALLEL', DEFAULT.jobParallel, 1, 64, f),
    bcryptArbeiter: env.BCRYPT_WORKERS?.trim() ? integer(env, 'BCRYPT_WORKERS', 4, 1, 64, f) : null,
    jobDeadlineSec: integer(env, 'JOB_DEADLINE_SEC', DEFAULT.jobDeadlineSec, 1, 86_400, f),
    caCertificate: env.CA_CERTIFICATE?.trim() || null,
    hinterTls: !!basis && /^https:\/\//i.test(basis),
    checkContract: env.CHECK_CONTRACT?.trim() === '1',
    androidZertifikate: androidCertificates(env, f),
    androidPaket: androidPackage(env, f),
    attestationWurzeln: attestationRoots(env, f),
    geraeteschluesselAltBis: legacyKeyUntil(env, f),
    attestationRevocationDays: integer(env, 'ATTESTATION_REVOCATION_DAYS', 7, 1, 90, f),
    attestationPatchAtLeast: patchAtLeast(env, f),
  };
  if (f.length) throw new ConfigError(f);
  return k;
}

/** In production and behind Caddy (APP_BASE_URL https://). COOKIE_SECURE=0 is the deliberate
 * exception for an operation without TLS. */
export function cookieSafe(k: AppConfig): boolean {
  return k.cookieSecure ?? (k.operation || k.hinterTls);
}

const K = processWide('konfig', () => ({ v: null as Readonly<AppConfig> | null }));

/** Read on the first call and frozen: konfig() is on the hot path
 * of every request, and production does not change its environment at runtime.
 * Whoever does (tests) says so explicitly with setKonfig/readKonfigNew. */
export function konfig(): Readonly<AppConfig> {
  K.v ??= Object.freeze(loadConfig(process.env));
  return K.v;
}

/** For tests: lay individual values over the read configuration; null lifts that. */
export function setConfig(teil: Partial<AppConfig> | null): Readonly<AppConfig> {
  K.v = teil ? Object.freeze({ ...loadConfig(process.env), ...teil }) : null;
  return konfig();
}

/** For tests and scripts that change process.env after startup. */
export function readConfigNew(): Readonly<AppConfig> {
  return setConfig(null);
}

export function checkConfigOnStart(): AppConfig {
  try {
    return konfig();
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
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
export function startBans(raw: NodeJS.ProcessEnv = process.env): string[] {
  const env = withRenamedVariables(raw);
  if (developmentEnvironment(env)) return [];
  const reasons: string[] = [];
  if (standardPasswordInUse(env))
    reasons.push(
      '[datenbank] Die Datenbank benutzt das Beispielpasswort „brickinventory_secret" aus compose.yaml — ' +
        "Start verweigert. Ein eigenes setzen: in psql `ALTER USER brickinventory PASSWORD '…';` und denselben " +
        'Wert als DB_PASSWORD in .env (siehe UPGRADE.md).',
    );
  try {
    proxyTrust(env.TRUST_PROXY, env.PROXY_NETWORK_CONFIRMED?.trim() === '1');
  } catch (e) {
    reasons.push(`[proxy] ${(e as Error).message} Start verweigert.`);
  }
  // Without the address the host filter knows no name and accepts only IP addresses; whoever wants that says so.
  if (
    !env.APP_BASE_URL?.trim() &&
    env.ROLE?.trim().toLowerCase() !== 'jobs' &&
    env.APP_BASE_URL_MISSING_OK?.trim() !== '1'
  )
    reasons.push(
      '[start] APP_BASE_URL fehlt im Betrieb: Der Host-Filter nähme nur IP-Adressen an — Start verweigert. ' +
        'In .env setzen (README.md); nur bewusst ohne: APP_BASE_URL_MISSING_OK=1 (UPGRADE.md).',
    );
  if (env.MAIL_CONSOLE_WITH_TOKEN?.trim() === '1')
    reasons.push(
      '[mail] MAIL_CONSOLE_WITH_TOKEN=1 schreibt Rücksetz- und Bestätigungslinks samt Token ins Protokoll — ' +
        'im Betrieb Start verweigert. Nur auf einem Entwicklungsrechner setzen (NODE_ENV=development).',
    );
  return reasons;
}

/** Allowed, but loud: switches that turn off a protection layer in production. */
export function startWarnings(raw: NodeJS.ProcessEnv = process.env): string[] {
  const env = withRenamedVariables(raw);
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
