// Probe für test/dienste-grenzen.test.js: Jede Zeile mit @ts-expect-error greift auf
// Innenleben eines Bereichs zu (Zugang, Arbeitseinheit, Repository, Fach). Gibt eine
// Fabrik es wieder heraus, ist die Erwartung unbenutzt und tsc meldet die Zeile.
import type { Dienste } from '../../startup/verdrahtung';

export function probe(d: Dienste): unknown[] {
  return [
    // Kein Bereich gibt seinen Zugang oder seine Transaktion heraus.
    // @ts-expect-error
    d.inventory.db,
    // @ts-expect-error
    d.inventory.transaktion,
    // @ts-expect-error
    d.inventory.papierkorb,
    // @ts-expect-error
    d.inventory.manuelleMengen,
    // @ts-expect-error
    d.auftraege.db,
    // @ts-expect-error
    d.auftraege.auftraege,
    // @ts-expect-error
    d.auftraege.laufzustand,
    // @ts-expect-error
    d.auftraege.faecher,
    // @ts-expect-error
    d.settings.repository,
    // @ts-expect-error
    d.household.db,
    // @ts-expect-error
    d.household.repository,
    // @ts-expect-error
    d.konto.db,
    // @ts-expect-error
    d.konto.protokoll,
    // @ts-expect-error
    d.konto.konten,
    // @ts-expect-error
    d.catalog.db,
    // @ts-expect-error
    d.catalog.quellen,
    // @ts-expect-error
    d.catalog.bildwerk,
    // @ts-expect-error
    d.finances.db,
    // @ts-expect-error
    d.finances.preisCache,
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
    // Die ausdrücklichen Dienste dagegen stehen da.
    d.inventory.locationService.lagerorte,
    d.auftraege.liesZustand,
    d.konto.verwalter.rememberAdminAction,
  ];
}
