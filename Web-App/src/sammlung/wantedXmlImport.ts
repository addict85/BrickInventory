/** Der Wanted-XML-Import als Auftrag: Er legt Teile, Figuren und Sets an und
 * fragt auf Wunsch Rebrickable — beides gehört nicht in den Web-Prozess. */
import { importiereWantedListe } from '../merkliste/wantedListe';
import { merkeBlNummer, merkeEigeneBlNummer } from '../katalog/blZuordnung';
import { starteAuftrag, meldeAuftrag, beendeAuftrag, istAbgebrochen } from '../auftraege/importAuftrag';
import { addManualPart } from '../teile/manuelleTeile';
import { addManualFig } from '../figuren/manuelleFiguren';
import { addSet } from '../sets';
import { logAndContinue } from '../infra/fehler';
import type { Nutzlast } from '../auftraege/nutzlasten';
import type { AuftragsKontext } from '../auftraege/auftraege';

export type WantedXmlEingabe = Extract<Nutzlast<'csv_import'>, { quelle: 'wanted_xml' }>['eingabe'];

async function importiereWantedXml(uid: number, e: WantedXmlEingabe, k: AuftragsKontext): Promise<Record<string, unknown>> {
  // Zwei Merker: angefragt (für die Kette) und laufend (für den Abbruch).
  // Ausführlich: docs/begruendungen/src/sammlung/wantedXmlImport.ts.md#post-wanted-list-import-xml-auftragangefragt
  let auftragAngefragt = false;
  let auftragLaeuft = false;
  // Über eine Kette, weil der Rückruf synchron ist und das Schreiben nicht;
  // sonst stünde im Balken eine kleinere Zahl nach einer grösseren.
  let kette: Promise<unknown> = Promise.resolve();
  let zuletzt = 0, letztePhase = '';
  const anDenBalken = (stand: { fertig: number; gesamt: number }, unbedingt = false) => {
    if (!auftragLaeuft) return;
    kette = kette.then(() => meldeAuftrag(uid, { done: stand.fertig, total: stand.gesamt }, unbedingt))
      .catch(logAndContinue('wanted-import:auftrag'));
  };
  try {
    const bericht = await importiereWantedListe(uid, e.xml, {
      vorschau: !e.schreiben,
      ueberRebrickable: e.ueberRebrickable,
      ...(e.korrekturen ? { korrekturen: e.korrekturen } : {}),
      // Eine Korrektur des Kontos gilt nur für dieses; gemeinsam nur, was Rebrickable bestätigt hat.
      merkeNummer: (art, rbId, blId, quelle) => quelle === 'korrigiert'
        ? merkeEigeneBlNummer(uid, art, rbId, blId) : merkeBlNummer(art, rbId, blId),
      fortschritt: (stand) => {
        // Der Stand reist über den Auftrag zur wartenden Anfrage (und deren Strom);
        // höchstens fünfmal je Sekunde, der letzte jeder Phase immer.
        const jetzt = Date.now();
        if (jetzt - zuletzt >= 200 || stand.fertig === stand.gesamt || stand.phase !== letztePhase) {
          zuletzt = jetzt; letztePhase = stand.phase;
          const f = { ...stand, erledigt: stand.fertig };
          kette = kette.then(() => k.fortschritt(f)).catch(logAndContinue('wanted-import:stand'));
        }
        // Beim ERSTEN Schreib-Fortschritt angelegt: Vorher ist der Nenner nicht bekannt.
        if (e.schreiben && !auftragAngefragt && stand.phase === 'schreiben') {
          auftragAngefragt = true;
          kette = kette.then(async () => { auftragLaeuft = await starteAuftrag(uid, { total: stand.gesamt, current: e.dateiName }); })
            .catch((f) => { auftragLaeuft = false; logAndContinue('wanted-import:auftrag')(f); });
        }
        anDenBalken(stand);
      },
      ...(e.schreiben ? { abbruch: async () => auftragLaeuft && await istAbgebrochen(uid) } : {}),
      anleger: {
        teil:  (u, body) => addManualPart(u, body),
        figur: (u, body) => addManualFig(u, body),
        // Kaufpreis ist MAXPRICE aus der Datei.
        // Ausführlich: docs/begruendungen/src/sammlung/wantedXmlImport.ts.md#post-wanted-list-import-xml-3
        set:   (u, sn, menge, zustand, kaufpreis) => addSet({ setNumber: sn, menge, konto: u, kaufpreis, zustand }),
      },
    });
    // Erst die Kette abwarten, dann schliessen: Sonst stünde der Balken anderswo noch auf „läuft".
    // Ausführlich: docs/begruendungen/src/sammlung/wantedXmlImport.ts.md#post-wanted-list-import-xml-4
    await kette;
    if (auftragLaeuft) {
      await beendeAuftrag(uid, {
        ok: bericht.angelegt + bericht.aufgestockt,
        // Offene Posten sind eine Anmerkung (⚠), weder angelegt noch gescheitert.
        warn: bericht.posten.filter(p => p.ausgang === 'offen').length,
        fehler: bericht.fehler,
        // Die BEARBEITETEN Posten, sonst bliebe der Balken vor dem Ende stehen.
        done: bericht.posten.length,
        abgebrochen: !!bericht.abgebrochen,
      },
      // Je Posten eine lesbare Zeile fürs Protokoll des Balkens.
      // Ausführlich: docs/begruendungen/src/sammlung/wantedXmlImport.ts.md#post-wanted-list-import-xml-5
      bericht.posten.map(p => (p.ausgang === 'angelegt' || p.ausgang === 'aufgestockt')
        ? { success: true, set_number: p.blId, action: p.ausgang === 'angelegt' ? 'added' : 'updated' }
        : { success: false, isWarning: p.ausgang === 'offen', set_number: p.blId, error: p.grund || '' }))
        .catch(logAndContinue('wanted-import:auftrag-ende'));
    }
    return { success: true, ...bericht };
  } catch (f) {
    // Der Balken MUSS zu sein, auch nach einem Fehler, sonst zeigte er überall
    // einen Import, den es nicht mehr gibt.
    await kette;
    if (auftragLaeuft) {
      await beendeAuftrag(uid, { ok: 0, fehler: 0, done: 0, abgebrochen: true })
        .catch(logAndContinue('wanted-import:auftrag-ende (Fehler)'));
    }
    throw f;
  }
}

export { importiereWantedXml };
