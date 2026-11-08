/** Was eine Anfrage sofort braucht, läuft hier; was warten kann, wird ein
 * Auftrag. Dynamisches import, weil die Verdrahtung vor dem Setzen der
 * Datenbankadresse läuft (etwa in Tests); am Pfad über ../jobs/ erkennen die
 * require-Haken der Tests die Module. */
import { verdrahteNacharbeit } from '../src/auftraege/nacharbeit';
import { meldeFehler } from '../src/infra/fehler';

function verdrahte(): void {
  verdrahteNacharbeit({
    preisJobAnstossen: () => {
      import('../src/auftraege/zeitplan.js').then(z => z.ziehePlanVor('preise'))
        .catch((e: unknown) => meldeFehler('einstellungen:preis-job-anstossen', e));
    },
    preisFuerSetHolen: async (sn, uid, zustand) => (await import('../jobs/priceJob.js')).refreshPriceForSet(sn, uid, zustand),
    bildVormerken: (url, sn) => {
      import('../src/katalog/bilder/bildbedarf.js').then(b => b.merkeGebraucht(url, sn))
        .catch((e: unknown) => meldeFehler('nacharbeit:bild-vormerken', e));
    },
    setTeileAnreichern: async (sn) => (await import('../src/katalog/teileAnreicherung.js')).enrichSetParts(sn),
    figurenAnreichern: async (sn) => (await import('../src/katalog/teileAnreicherung.js')).enrichSetMinifigs(sn),
    setBilderLaden: async (sn) => {
      const [{ stelleAuftragEin }, { mitVersion }] = await Promise.all([import('../src/auftraege/dienst.js'), import('../src/infra/setNummer.js')]);
      return stelleAuftragEin('bilder', { set_number: sn, nur_bilder: true },
        { schluessel: `bilder:${mitVersion(sn)}:nur`, maxVersuche: 3 });
    },
  });
}

export { verdrahte };
