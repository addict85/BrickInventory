/** Einstieg des Dienstes migration (compose.yaml): Erststart, Migrationen und
 * abgelaufene Kopien als Migrationsrolle, dann Ende. app und jobs laufen mit
 * einer Rolle, die das Schema nicht ändern darf, und warten auf diesen Lauf. */
import { wireProcess } from './wiring';
import { warnAtSuperuser } from './database';
import { cleanOldBackupsOn } from '../db/migrate';
import { fehlertext } from '../src/infra/error';

async function migriere(): Promise<void> {
  const { db } = wireProcess();
  try {
    await warnAtSuperuser(db);
    // Ohne CREATE prüfte initSchemaOnce nur und meldete Erfolg, ohne migriert zu haben.
    if (!(await db.changeMaySchema()))
      throw new Error(
        'Diese Rolle darf das Schema nicht ändern: PGUSER muss die Migrationsrolle sein (UPGRADE.md#migrationsrolle).',
      );
    await db.initSchemaOnce();
    const weg = await cleanOldBackupsOn(db);
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
