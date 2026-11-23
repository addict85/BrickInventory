// Probe für test/services-limits.test.js: Jede Zeile mit @ts-expect-error greift auf
// Innenleben eines Bereichs zu (Zugang, Arbeitseinheit, Repository, Fach). Gibt eine
// Fabrik es wieder heraus, ist die Erwartung unbenutzt und tsc meldet die Zeile.
import type { Services } from '../../startup/wiring';

export function probe(d: Services): unknown[] {
  return [
    // Kein Bereich gibt seinen Zugang oder seine Transaktion heraus.
    // @ts-expect-error
    d.inventory.db,
    // @ts-expect-error
    d.inventory.transact,
    // @ts-expect-error
    d.inventory.trash,
    // @ts-expect-error
    d.inventory.manualQuantities,
    // @ts-expect-error
    d.jobQueue.db,
    // @ts-expect-error
    d.jobQueue.jobs,
    // @ts-expect-error
    d.jobQueue.runState,
    // @ts-expect-error
    d.jobQueue.fans,
    // @ts-expect-error
    d.settings.repository,
    // @ts-expect-error
    d.household.db,
    // @ts-expect-error
    d.household.repository,
    // @ts-expect-error
    d.account.db,
    // @ts-expect-error
    d.account.log,
    // @ts-expect-error
    d.account.accounts,
    // @ts-expect-error
    d.catalog.db,
    // @ts-expect-error
    d.catalog.sources,
    // @ts-expect-error
    d.catalog.imageWork,
    // @ts-expect-error
    d.finances.db,
    // @ts-expect-error
    d.finances.priceCache,
    // @ts-expect-error
    d.sets.db,
    // @ts-expect-error
    d.sets.catalog,
    // @ts-expect-error
    d.parts.partsList,
    // @ts-expect-error
    d.minifigs.db,
    // @ts-expect-error
    d.wanted.db,
    // @ts-expect-error
    d.vouchers.vouchers,
    // @ts-expect-error
    d.collection.db,
    // @ts-expect-error
    d.management.db,
    // @ts-expect-error
    d.idempotency.db,
    // Die ausdrücklichen Services dagegen stehen da.
    d.inventory.locationService.storages,
    d.jobQueue.readState,
    d.account.admin.rememberAdminAction,
  ];
}
