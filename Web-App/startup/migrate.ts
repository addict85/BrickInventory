/** Entry point of the migration service (compose.yaml): first start, migrations and
 * expired copies as the migration role, then exit. app and jobs run with
 * a role that may not change the schema, and wait for this run. */
import { wireProcess } from './wiring';
import { warnAtSuperuser } from './database';
import { cleanOldBackupsOn } from '../db/migrate';
import { errorMessage } from '../src/infra/error';

async function migrate(): Promise<void> {
  const { db } = wireProcess();
  try {
    await warnAtSuperuser(db);
    // Without CREATE initSchemaOnce only checked and reported success without having migrated.
    if (!(await db.changeMaySchema()))
      throw new Error(
        'Diese Rolle darf das Schema nicht ändern: PGUSER muss die Migrationsrolle sein (UPGRADE.md#migrationsrolle).',
      );
    await db.initSchemaOnce();
    const removed = await cleanOldBackupsOn(db);
    if (removed) console.log(`[migration] ${removed} abgelaufene Kopie(n) vor Migrationen entfernt`);
  } finally {
    await db.pool.end();
  }
}

migrate().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error('❌ [migration] gescheitert:', errorMessage(e));
    process.exit(1);
  },
);
