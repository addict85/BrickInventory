import type { Db } from '../db/database';
import { altKey, dataKey } from '../src/infra/secret';
import { konfig } from '../src/infra/config';
import type { Services } from './wiring';

/** A superuser reaches COPY … PROGRAM and every database of the server: in
 * production (even without NODE_ENV) a startup prohibition, unless DB_SUPERUSER_ERLAUBT=1 (UPGRADE.md). */
export async function warnAtSuperuser(db: Db): Promise<boolean> {
  if (!konfig().operation || !(await db.asSuperuserConnected())) return false;
  if (!konfig().dbSuperuserAllowed) {
    console.error(
      '❌ [datenbank] Die App verbindet sich als Superuser — Start verweigert. Eigene Rolle: UPGRADE.md#eigene-datenbankrolle; ' +
        'wer es bewusst so betreibt, setzt DB_SUPERUSER_ERLAUBT=1 (UPGRADE.md#superuser-ausnahme).',
    );
    process.exit(1);
  }
  console.warn(
    '⚠️  [datenbank] Die App verbindet sich als Superuser (DB_SUPERUSER_ERLAUBT=1). Eigene Rolle: UPGRADE.md#eigene-datenbankrolle.',
  );
  return true;
}

/** The marker in the run state. A restored older backup does not bring it
 * along; then the conversion runs again on the next start. */
export const LEGACY_STOCK_BRAND = 'altbestand_v2';

/** Once per database, before the first request and without a way out: entschluessele()
 * only reads v2, and a voucher row without nummer_suche would escape the
 * duplicate check. @returns null if the marker is already set */
export async function legacyStockUpgrade(d: Services): Promise<{ umgeschluesselt: number; prints: number } | null> {
  if (await d.jobQueue.readState(LEGACY_STOCK_BRAND)) return null;
  const n =
    (await d.vouchers.reencryptNumbers()) +
    (await d.vouchers.reencryptCopies()) +
    (await d.factors.encryptLegacySecrets()) +
    (await d.idempotency.reencryptResponses()) +
    (await d.vouchers.encryptLegacyFiles());
  if (n) console.log(`[geheimnis] ${n} Geheimnisse auf v2 (mit Kontext) umgeschlüsselt`);
  const alt = await d.idempotency.deleteOldFingerprints();
  if (alt) console.log(`[idempotenz] ${alt} Einträge mit altem Fingerabdruck (SHA-256 des Rumpfs) gelöscht`);
  await d.jobQueue.setState(LEGACY_STOCK_BRAND, new Date().toISOString());
  return { umgeschluesselt: n, prints: alt };
}

/** If the previous key is available (DATA_KEY_ALT_FILE), every start rewrites
 * everything only it opens with the new one. Concurrently running processes
 * do not disturb each other: every row is only replaced if it is unchanged. */
export async function keySwitch(d: Services): Promise<number | null> {
  if (!altKey()) return null;
  const n =
    (await d.factors.encryptLegacySecrets({ alle: true })) +
    (await d.vouchers.reencryptAllVouchers()) +
    (await d.vouchers.reencryptCopies(true)) +
    (await d.vouchers.encryptLegacyFiles({ alle: true }));
  // Responses and fingerprints apply for 24 hours and depend on the key; recomputing is not worth it.
  await d.idempotency.forgetAll();
  console.log(
    `[geheimnis] Schlüsselwechsel: ${n} Werte mit dem neuen Schlüssel geschrieben. Der vorige ` +
      '(DATA_KEY_ALT_FILE) kann weg, sobald jedes Konto mit zweitem Faktor neue Wiederherstellungscodes hat (UPGRADE.md).',
  );
  return n;
}

/** The web process alone must not touch vouchers (web system role): it waits
 * until the jobs service has converted the legacy data, instead of reading old rows. */
export async function waitOnLegacyStock(d: Services, tick = 2000): Promise<void> {
  for (let n = 0; !(await d.jobQueue.readState(LEGACY_STOCK_BRAND)); n++) {
    if (n % 15 === 0) console.log('[geheimnis] warte, bis der Dienst jobs die Geheimnisse auf v2 umgestellt hat');
    await new Promise(r => setTimeout(r, tick));
  }
}

/**
 * Schema and migrations, then the image helper services — in EVERY
 * worker process, because they are process-local (state in memory, tick of the
 * buffer). Here and not in db/: the database layer knows no jobs.
 * Re-encryption only with `jobs`: only its system role reaches the vouchers.
 */
export async function prepareDatabaseBefore(db: Db, d: Services, o: { jobs?: boolean } = {}): Promise<void> {
  // At startup instead of at the first encryption: a wrong or old
  // location of the key should appear in the startup log.
  dataKey();
  await warnAtSuperuser(db);
  await db.initSchemaOnce();
  // Otherwise jobs, admin and login would silently see no row of the account tables.
  if (!(await db.systemFrameActs()))
    throw new Error(
      'Die Rolle für Arbeit über Kontogrenzen unterliegt dem Zeilenschutz: PGSYSTEM_USER und ' +
        'PGSYSTEM_PASSWORD(_FILE) auf die Systemrolle setzen (postgres/app-rolle.sh, UPGRADE.md#systemrolle).',
    );
  if (o.jobs === false) await waitOnLegacyStock(d);
  else {
    await legacyStockUpgrade(d);
    await keySwitch(d);
  }
  await d.images.startNone();
  await d.images.startImageDemand();
}
