/** Remove an account permanently — the same flow for the administrator and for the own
 * account. Log, row and sessions fall in one transaction:
 * if a session were left over, the deleted account would still be signed in. */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../infra/appPaths';
import * as repo from './repository/accounts';
import { increaseSessionVersion } from './sessionVersion';
import { emptyTokenCache } from './tokenCache';
import { reportError } from '../infra/error';
import { fachfehler, notFound } from '../infra/errorTexts';
import { inSystemContext } from '../infra/accountContext';
import type { AccountContext } from './context';

/** @param through the administrator who deletes; null if the account deletes itself */
export async function kontoEntfernen(k: AccountContext, target: number, through: number | null): Promise<void> {
  // Always in the system frame: only the system role sees sessions and the copies made before migrations.
  const fremd = through !== null && through !== target;
  const remove = () =>
    k.transaktion(async t => {
      // Before deleting: afterwards the name for the log can no longer be determined.
      if (through !== null && fremd) await t.protokoll.protokolliere(through, target, 'konto_geloescht');
      const route =
        through === null ? await t.konten.deleteOwnAccount(target) : await t.konten.deleteAccount(target, through);
      if (route === repo.LAST_ADMIN || (!route && through === null)) fachfehler('konflikt', 'letzter_verwalter');
      if (!route) notFound('benutzer_nicht_gefunden_oder_eigenes');
      // user_sessions has no foreign key to users.
      await increaseSessionVersion(t, target);
      await t.zugaenge.deleteSessionsOfAccount(target);
    });
  await inSystemContext('kontenverwaltung', remove);
  // After committing: caches and neighbor processes should forget the account only once it is gone.
  emptyTokenCache(k);
  k.household.reportHouseholdChange();
  await removeAccountFiles(k, target);
}

/** Compensation instead of failure: the account is deleted, only its files are
 * still there. A job tries again until disk or permissions allow it. */
export async function removeAccountFiles(k: AccountContext, target: number): Promise<'entfernt' | 'eingereiht'> {
  try {
    await deleteAccountFiles(target);
    return 'entfernt';
  } catch (e) {
    reportError(`konto:dateien ${target}`, e);
    await k.jobQueue.placeJobOne(
      'konto_dateien',
      { user_id: target },
      { schluessel: `konto_dateien:${target}`, maxAttempts: 10, afterSeconds: 60 },
    );
    return 'eingereiht';
  }
}

/** Own instructions and voucher PDFs belong to the account; left behind they would have no owner. */
export async function deleteAccountFiles(userId: number): Promise<void> {
  if (!Number.isInteger(userId) || userId <= 0) return;
  for (const art of ['uploads', 'vouchers'])
    await fs.promises.rm(path.join(DATA_DIR, art, String(userId)), { recursive: true, force: true });
}
