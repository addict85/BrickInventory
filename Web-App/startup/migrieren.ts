/** Einstieg des Dienstes migration (compose.yaml): Erststart, Migrationen und
 * abgelaufene Kopien als Migrationsrolle, dann Ende. app und jobs laufen mit
 * einer Rolle, die das Schema nicht ändern darf, und warten auf diesen Lauf. */
import { verdrahteProzess } from './verdrahtung';
import { warneBeiSuperuser } from './datenbank';
import { raeumeAlteSicherungenAuf } from '../db/migrate';
import { fehlertext } from '../src/infra/fehler';

async function migriere(): Promise<void> {
  const db = verdrahteProzess();
  try {
    await warneBeiSuperuser();
    // Ohne CREATE prüfte initSchemaOnce nur und meldete Erfolg, ohne migriert zu haben.
    if (!(await db.darfSchemaAendern()))
      throw new Error(
        'Diese Rolle darf das Schema nicht ändern: PGUSER muss die Migrationsrolle sein (UPGRADE.md, Abschnitt 51).',
      );
    await db.initSchemaOnce();
    const weg = await raeumeAlteSicherungenAuf(db);
    if (weg) console.log(`[migration] ${weg} abgelaufene Kopie(n) vor Migrationen entfernt`);
  } finally {
    await db.pool.end();
  }
}

migriere().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error('❌ [migration] gescheitert:', fehlertext(e));
    process.exit(1);
  },
);
