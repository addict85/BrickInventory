/** Der Wanted-XML-Import als Auftrag: Er legt Teile, Figuren und Sets an und
 * fragt auf Wunsch Rebrickable — beides gehört nicht in den Web-Prozess. */
import type { Nutzlast, AuftragsKontext } from '../auftraege';
import { logAndContinue } from '../infra/fehler';
import type { SammlungKontext } from './kontext';

export type WantedXmlEingabe = Extract<Nutzlast<'csv_import'>, { quelle: 'wanted_xml' }>['eingabe'];

async function importiereWantedXml(
  kx: SammlungKontext,
  uid: number,
  e: WantedXmlEingabe,
  k: AuftragsKontext,
): Promise<Record<string, unknown>> {
  // Zwei Merker: angefragt (für die Kette) und laufend (für den Abbruch).
  let auftragAngefragt = false;
  let auftragLaeuft = false;
  // Über eine Kette, weil der Rückruf synchron ist und das Schreiben nicht;
  // sonst stünde im Balken eine kleinere Zahl nach einer grösseren.
  let kette: Promise<unknown> = Promise.resolve();
  // Balken und Stand sind Anzeige: Ein gescheiterter Schritt hält weder den Import noch die nächsten auf.
  const danach = (wo: string, schritt: () => Promise<unknown>) => {
    kette = kette.then(schritt).catch(logAndContinue(wo));
  };
  // Erst die Kette abwarten, dann schliessen: Sonst stünde der Balken anderswo noch auf „läuft".
  const schliesseBalken = async (
    angaben: Parameters<SammlungKontext['auftraege']['beendeAuftrag']>[1],
    zeilen?: Parameters<SammlungKontext['auftraege']['beendeAuftrag']>[2],
  ) => {
    await kette;
    if (auftragLaeuft)
      await kx.auftraege.beendeAuftrag(uid, angaben, zeilen).catch(logAndContinue('wanted-import:auftrag-ende'));
  };
  let zuletzt = 0,
    letztePhase = '';
  const anDenBalken = (stand: { fertig: number; gesamt: number }, unbedingt = false) => {
    if (!auftragLaeuft) return;
    danach('wanted-import:auftrag', () =>
      kx.auftraege.meldeAuftrag(uid, { done: stand.fertig, total: stand.gesamt }, unbedingt),
    );
  };
  try {
    const bericht = await kx.merkliste.importiereWantedListe(uid, e.xml, {
      vorschau: !e.schreiben,
      ueberRebrickable: e.ueberRebrickable,
      ...(e.korrekturen ? { korrekturen: e.korrekturen } : {}),
      // Eine Korrektur des Kontos gilt nur für dieses; gemeinsam nur, was Rebrickable bestätigt hat.
      merkeNummer: (art, rbId, blId, quelle) =>
        quelle === 'korrigiert'
          ? kx.katalog.merkeEigeneBlNummer(uid, art, rbId, blId)
          : kx.katalog.merkeBlNummer(art, rbId, blId),
      fortschritt: stand => {
        // Der Stand reist über den Auftrag zur wartenden Anfrage (und deren Strom);
        // höchstens fünfmal je Sekunde, der letzte jeder Phase immer.
        const jetzt = Date.now();
        if (jetzt - zuletzt >= 200 || stand.fertig === stand.gesamt || stand.phase !== letztePhase) {
          zuletzt = jetzt;
          letztePhase = stand.phase;
          const f = { ...stand, erledigt: stand.fertig };
          danach('wanted-import:stand', () => k.fortschritt(f));
        }
        // Beim ERSTEN Schreib-Fortschritt angelegt: Vorher ist der Nenner nicht bekannt.
        if (e.schreiben && !auftragAngefragt && stand.phase === 'schreiben') {
          auftragAngefragt = true;
          danach('wanted-import:auftrag', async () => {
            auftragLaeuft = await kx.auftraege.starteAuftrag(uid, { total: stand.gesamt, current: e.dateiName });
          });
        }
        anDenBalken(stand);
      },
      ...(e.schreiben ? { abbruch: async () => auftragLaeuft && (await kx.auftraege.istAbgebrochen(uid)) } : {}),
      anleger: {
        teil: (u, body) => kx.teile.addManualPart(u, body),
        figur: (u, body) => kx.figuren.addManualFig(u, body),
        // Kaufpreis ist MAXPRICE aus der Datei.
        set: (u, sn, menge, zustand, kaufpreis) =>
          kx.sets.setErfassen({
            anfragender: u,
            setNumber: sn,
            menge,
            kaufpreis,
            zustand,
            wennVorhanden: 'aufstocken',
          }),
      },
    });
    await schliesseBalken(
      {
        ok: bericht.angelegt + bericht.aufgestockt,
        // Offene Posten sind eine Anmerkung (⚠), weder angelegt noch gescheitert.
        warn: bericht.posten.filter(p => p.ausgang === 'offen').length,
        fehler: bericht.fehler,
        // Die BEARBEITETEN Posten, sonst bliebe der Balken vor dem Ende stehen.
        done: bericht.posten.length,
        abgebrochen: !!bericht.abgebrochen,
      },
      // Je Posten eine lesbare Zeile fürs Protokoll des Balkens.
      bericht.posten.map(p =>
        p.ausgang === 'angelegt' || p.ausgang === 'aufgestockt'
          ? { success: true, set_number: p.blId, action: p.ausgang === 'angelegt' ? 'added' : 'updated' }
          : { success: false, isWarning: p.ausgang === 'offen', set_number: p.blId, error: p.grund || '' },
      ),
    );
    return { ...bericht };
  } catch (f) {
    // Der Balken MUSS zu sein, auch nach einem Fehler, sonst zeigte er überall
    // einen Import, den es nicht mehr gibt.
    await schliesseBalken({ ok: 0, fehler: 0, done: 0, abgebrochen: true });
    throw f;
  }
}

export { importiereWantedXml };
