/**
 * Setzt die Ausführung für src/auftraege/nacharbeit.ts ein: Was eine Anfrage sofort
 * braucht (Marktpreis, Katalog), läuft hier; was warten kann, wird ein
 * Auftrag. Die Module werden erst beim Aufruf geladen (dynamisches import):
 * Die Verdrahtung läuft vor dem Setzen der Datenbankadresse, etwa in Tests;
 * der Pfad über ../jobs/ lässt require-Haken der Tests ihn erkennen.
 */
import { verdrahteNacharbeit } from '../src/auftraege/nacharbeit';
import { meldeUndWeiter } from '../src/infra/httpError';

function verdrahte(): void {
  verdrahteNacharbeit({
    preisJobAnstossen: () => {
      import('../src/auftraege/zeitplan.js').then(z => z.ziehePlanVor('preise'))
        .catch((e: unknown) => meldeUndWeiter('einstellungen:preis-job-anstossen', e));
    },
    preisFuerSetHolen: async (sn, uid, zustand) => (await import('../jobs/priceJob.js')).refreshPriceForSet(sn, uid, zustand),
    bildVormerken: (url, sn) => {
      import('../src/katalog/bilder/bildbedarf.js').then(b => b.merkeGebraucht(url, sn))
        .catch((e: unknown) => meldeUndWeiter('nacharbeit:bild-vormerken', e));
    },
    setTeileAnreichern: async (sn) => (await import('../jobs/partsCatalogEnrich.js')).enrichSetParts(sn),
    figurenAnreichern: async (sn) => (await import('../jobs/partsCatalogEnrich.js')).enrichSetMinifigs(sn),
    setBilderLaden: async (sn) => {
      const [{ stelleAuftragEin }, { mitVersion }] = await Promise.all([import('../src/auftraege/dienst.js'), import('../src/sets/setNummer.js')]);
      return stelleAuftragEin('bilder', { set_number: sn, nur_bilder: true },
        { schluessel: `bilder:${mitVersion(sn)}:nur`, maxVersuche: 3 });
    },
  });
}

export { verdrahte };
