// Probe für test/dienste-grenzen.test.js: Jede Zeile mit @ts-expect-error greift auf
// Innenleben eines Bereichs zu (Zugang, Arbeitseinheit, Repository, Fach). Gibt eine
// Fabrik es wieder heraus, ist die Erwartung unbenutzt und tsc meldet die Zeile.
import type { Dienste } from '../../startup/verdrahtung';

export function probe(d: Dienste): unknown[] {
  return [
    // Kein Bereich gibt seinen Zugang oder seine Transaktion heraus.
    // @ts-expect-error
    d.bestand.db,
    // @ts-expect-error
    d.bestand.transaktion,
    // @ts-expect-error
    d.bestand.papierkorb,
    // @ts-expect-error
    d.bestand.manuelleMengen,
    // @ts-expect-error
    d.auftraege.db,
    // @ts-expect-error
    d.auftraege.auftraege,
    // @ts-expect-error
    d.auftraege.laufzustand,
    // @ts-expect-error
    d.auftraege.faecher,
    // @ts-expect-error
    d.einstellungen.repository,
    // @ts-expect-error
    d.haushalt.db,
    // @ts-expect-error
    d.haushalt.repository,
    // @ts-expect-error
    d.konto.db,
    // @ts-expect-error
    d.konto.protokoll,
    // @ts-expect-error
    d.konto.konten,
    // @ts-expect-error
    d.katalog.db,
    // @ts-expect-error
    d.katalog.nacharbeit,
    // @ts-expect-error
    d.katalog.bildwerk,
    // @ts-expect-error
    d.finanzen.db,
    // @ts-expect-error
    d.finanzen.preisCache,
    // @ts-expect-error
    d.sets.db,
    // @ts-expect-error
    d.sets.katalog,
    // @ts-expect-error
    d.teile.teileListe,
    // @ts-expect-error
    d.figuren.db,
    // @ts-expect-error
    d.merkliste.db,
    // @ts-expect-error
    d.gutscheine.gutscheine,
    // @ts-expect-error
    d.sammlung.db,
    // @ts-expect-error
    d.verwaltung.db,
    // @ts-expect-error
    d.idempotenz.db,
    // Die ausdrücklichen Dienste dagegen stehen da.
    d.bestand.lagerortDienst.lagerorte,
    d.auftraege.liesZustand,
    d.konto.protokolliere,
  ];
}
