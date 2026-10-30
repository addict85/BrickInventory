/**
 * Die Verbindung zur Datenbank — EINE Stelle für Server, Worker und Skripte.
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

/**
 * Die Zeitzone, in der eine Erfassung ihren Tag bekommt (Migration 0070):
 * ERFASSUNG_ZEITZONE, sonst TZ, sonst die des Prozesses. Ein Name, den
 * Intl nicht kennt, fiele erst beim ersten Kauf in PostgreSQL auf — er wird
 * hier verworfen, und es gilt UTC wie vor 0070.
 */
export function erfassungsZeitzone(env: NodeJS.ProcessEnv = process.env): string {
  const name = env.ERFASSUNG_ZEITZONE || env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  try { new Intl.DateTimeFormat('de', { timeZone: name }); return /^[A-Za-z0-9_+\-/]+$/.test(name) ? name : 'UTC'; }
  catch (e) { console.warn(`[konfig] Zeitzone „${name}“ unbekannt, Erfassungen nehmen UTC (${(e as Error).message})`); return 'UTC'; }
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
