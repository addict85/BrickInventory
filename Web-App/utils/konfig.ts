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
    password: env.PGPASSWORD || 'brickinventory_secret',
    database: env.PGDATABASE || 'brickinventory',
  };
}
