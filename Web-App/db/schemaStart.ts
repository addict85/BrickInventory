/** Erststart und Migrationen beim Start: Basis in eine leere Datenbank, offene
 * Migrationen unter einer Sperre, Prüfungen für die Laufzeitrolle. */
import fs from 'node:fs';
import path from 'node:path';
import type { Client, Pool } from 'pg';
import { runMigrations, offeneMigrationen } from './migrate';
import { LOCKS } from '../src/infra/lockNamespaces';
import { logAndContinue } from '../src/infra/fehler';
import { konfig } from '../src/infra/konfig';

/** Was nach dem Einspielen der Basis in eine leere Datenbank geschieht (das erste
 * Konto). Die Datenbankschicht kennt keine Konten; wer den Zugang anlegt, gibt es mit. */
export type Erststart = () => Promise<void>;

// Die älteste Migration, auf der eine bestehende Datenbank aufsetzen darf: db/basis.sql
// und alle Migrationen danach kennen nur Schemas ab hier. Was älter ist, holt
// zuerst eine Fassung nach, die die früheren Startstufen noch mitbringt (UPGRADE.md).
const MINDESTSTAND = '0050-teilezaehler-nur-bestehende-konten.sql';

/** Eine LEERE Datenbank bekommt db/basis.sql (Abbild der Migrationen), danach
 * nur die jüngeren Migrationen; eine bestehende bleibt unberührt.
 * true, wenn die Basis eingespielt wurde. */
export async function initSchema(eigeneVerbindung: () => Promise<Client>, erststart?: Erststart): Promise<boolean> {
  const c = await eigeneVerbindung();
  try {
    const leer = !(await c.query("SELECT to_regclass('public.users') AS t")).rows[0].t;
    if (!leer) return false;
    // Eigene Verbindung, weil die Basis Sitzungswerte setzt (SET …), die
    // sonst an einer Pool-Verbindung hängen blieben.
    await c.query('BEGIN');
    await c.query(fs.readFileSync(path.join(__dirname, 'basis.sql'), 'utf8'));
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch((r: Error) => console.warn('[schema] ROLLBACK gescheitert:', r.message));
    throw e;
  } finally {
    await c.end().catch((r: Error) => console.warn('[schema] Verbindung schliessen:', r.message));
  }
  if (erststart) await erststart();
  else console.warn('⚠️  [schema] Leere Datenbank ohne Erststart: kein erstes Konto angelegt.');
  console.log('✅ PostgreSQL schema ready');
  return true;
}

// Erststart und Migrationen unter einem Advisory-Lock (LOCKS.SCHEMA_INIT):
// Starten web und jobs zugleich, migriert genau einer; der andere wartet.
// Die Laufzeitrolle (compose.yaml) darf kein Schema ändern: Sie prüft nur,
// ob der Dienst migration fertig ist, statt an CREATE zu scheitern.
export async function initSchemaOnce(pool: Pool, initSchema: () => Promise<boolean>): Promise<void> {
  const client = await pool.connect();
  try {
    // Warten auf den anderen Prozess ist hier gewollt, auch länger als lock_timeout
    // und statement_timeout: Eine lange Migration dort bräche den Start (57014) ab.
    await client.query('SET lock_timeout = 0');
    await client.query('SET statement_timeout = 0');
    await client.query(`SELECT pg_advisory_lock(${LOCKS.SCHEMA_INIT})`);
    await client.query('RESET statement_timeout');
    if (!(await darfSchemaAendernAuf(client))) return await nurStandPruefen(client);
    const neu = await initSchema();
    if (!neu) await pruefeMindeststand(client);
    // Vor offenen Migrationen eine Kopie der Nutzerdaten — nicht bei einer
    // eben angelegten, leeren Datenbank.
    const applied = await runMigrations(client, { sichern: !neu });
    await schreibeErfassungsZeitzone(client);
    if (applied.length) console.log(`✅ ${applied.length} Migration(en) angewandt`);
    else if (!neu) console.log('✅ Schema aktuell — keine offenen Migrationen');
  } finally {
    await client
      .query(`SELECT pg_advisory_unlock(${LOCKS.SCHEMA_INIT})`)
      .catch(logAndContinue('db:pg_advisory_unlock'));
    await client.query('RESET lock_timeout').catch(logAndContinue('db:lock_timeout'));
    await client.query('RESET statement_timeout').catch(logAndContinue('db:statement_timeout'));
    client.release();
  }
}

/** Die konfigurierte Zeitzone für den Trigger erfassung_tag() (Migration
 * 0078) — in der Datenbank, damit jede Verbindung denselben Tag rechnet. */
async function schreibeErfassungsZeitzone(client: import('pg').ClientBase): Promise<void> {
  await client.query(
    `INSERT INTO global_settings (key, value) VALUES ('erfassung_zeitzone', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
     WHERE global_settings.value IS DISTINCT FROM EXCLUDED.value`,
    [konfig().erfassungZeitzone],
  );
}

export const DARF_SCHEMA_AENDERN = `SELECT has_schema_privilege('public', 'CREATE') AS d`;
async function darfSchemaAendernAuf(client: import('pg').ClientBase): Promise<boolean> {
  return (await client.query<{ d: boolean }>(DARF_SCHEMA_AENDERN)).rows[0]?.d === true;
}

/** Für die Laufzeitrolle: Ein leeres oder nicht migriertes Schema hält den Start
 * an, statt dass Anfragen auf fehlende Spalten treffen. */
async function nurStandPruefen(client: import('pg').ClientBase): Promise<void> {
  const leer = !(await client.query("SELECT to_regclass('public.users') AS t")).rows[0].t;
  const offen = leer ? [] : await offeneMigrationen(client);
  if (leer || offen.length)
    throw new Error(
      `${leer ? 'Die Datenbank ist leer' : `Migrationen offen: ${offen.join(', ')}`}. Diese Rolle darf das Schema nicht ändern; ` +
        'Grundschema und Migrationen spielt der Dienst migration als Migrationsrolle ein (UPGRADE.md#migrationsrolle).',
    );
  await schreibeErfassungsZeitzone(client);
  console.log('✅ Schema aktuell (eingespielt vom Dienst migration)');
}

/** Eine bestehende Datenbank ohne Migration ab MINDESTSTAND hält den Start an,
 * bevor eine Migration sie anfasst: Die jüngeren setzen Tabellen voraus, die
 * dort fehlen, und schrieben sonst ein halbes Schema. */
async function pruefeMindeststand(client: import('pg').ClientBase): Promise<void> {
  const { rows } = await client.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS da`);
  const neuGenug =
    rows[0].da &&
    (await client.query('SELECT 1 FROM schema_migrations WHERE name >= $1 LIMIT 1', [MINDESTSTAND])).rows.length > 0;
  if (!neuGenug)
    throw new Error(
      `Die Datenbank ist älter als Migration ${MINDESTSTAND}. Zuerst auf eine Fassung vor dem ` +
        'Entfernen der früheren Startstufen aktualisieren, dann auf diese (UPGRADE.md#stichtag-0050).',
    );
}
