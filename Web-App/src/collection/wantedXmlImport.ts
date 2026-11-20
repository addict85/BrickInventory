/** Der Wanted-XML-Import als Auftrag: Er legt Teile, Figuren und Sets an und
 * fragt auf Wunsch Rebrickable — beides gehört nicht in den Web-Prozess. */
import type { Nutzlast, JobContext } from '../jobQueue';
import { logAndContinue } from '../infra/fehler';
import type { CollectionContext } from './context';

export type WantedXmlInput = Extract<Nutzlast<'csv_import'>, { quelle: 'wanted_xml' }>['eingabe'];

async function importWantedXml(
  kx: CollectionContext,
  uid: number,
  e: WantedXmlInput,
  k: JobContext,
): Promise<Record<string, unknown>> {
  // Zwei Merker: angefragt (für die Kette) und laufend (für den Abbruch).
  let jobRequested = false;
  let jobRunning = false;
  // Über eine Kette, weil der Rückruf synchron ist und das Schreiben nicht;
  // sonst stünde im Balken eine kleinere Zahl nach einer grösseren.
  let kette: Promise<unknown> = Promise.resolve();
  // Balken und Stand sind Anzeige: Ein gescheiterter Schritt hält weder den Import noch die nächsten auf.
  const danach = (wo: string, schritt: () => Promise<unknown>) => {
    kette = kette.then(schritt).catch(logAndContinue(wo));
  };
  // Erst die Kette abwarten, dann schliessen: Sonst stünde der Balken anderswo noch auf „läuft".
  const closeBar = async (
    angaben: Parameters<CollectionContext['jobQueue']['beendeAuftrag']>[1],
    zeilen?: Parameters<CollectionContext['jobQueue']['beendeAuftrag']>[2],
  ) => {
    await kette;
    if (jobRunning)
      await kx.jobQueue.beendeAuftrag(uid, angaben, zeilen).catch(logAndContinue('wanted-import:auftrag-ende'));
  };
  let zuletzt = 0,
    lastPhase = '';
  const anDenBar = (stand: { fertig: number; gesamt: number }, unbedingt = false) => {
    if (!jobRunning) return;
    danach('wanted-import:auftrag', () =>
      kx.jobQueue.reportJob(uid, { done: stand.fertig, total: stand.gesamt }, unbedingt),
    );
  };
  try {
    const bericht = await kx.wanted.importWantedList(uid, e.xml, {
      vorschau: !e.schreiben,
      viaRebrickable: e.viaRebrickable,
      ...(e.korrekturen ? { korrekturen: e.korrekturen } : {}),
      // Eine Korrektur des Kontos gilt nur für dieses; gemeinsam nur, was Rebrickable bestätigt hat.
      rememberNumber: (art, rbId, blId, quelle) =>
        quelle === 'korrigiert'
          ? kx.catalog.rememberOwnBlNumber(uid, art, rbId, blId)
          : kx.catalog.rememberBlNumber(art, rbId, blId),
      fortschritt: stand => {
        // Der Stand reist über den Auftrag zur wartenden Anfrage (und deren Strom);
        // höchstens fünfmal je Sekunde, der letzte jeder Phase immer.
        const jetzt = kx.uhr.jetzt();
        if (jetzt - zuletzt >= 200 || stand.fertig === stand.gesamt || stand.phase !== lastPhase) {
          zuletzt = jetzt;
          lastPhase = stand.phase;
          const f = { ...stand, erledigt: stand.fertig };
          danach('wanted-import:stand', () => k.fortschritt(f));
        }
        // Beim ERSTEN Schreib-Fortschritt angelegt: Vorher ist der Nenner nicht bekannt.
        if (e.schreiben && !jobRequested && stand.phase === 'schreiben') {
          jobRequested = true;
          danach('wanted-import:auftrag', async () => {
            jobRunning = await kx.jobQueue.startJob(uid, { total: stand.gesamt, current: e.fileName });
          });
        }
        anDenBar(stand);
      },
      ...(e.schreiben ? { abbruch: async () => jobRunning && (await kx.jobQueue.isAborted(uid)) } : {}),
      creator: {
        teil: (u, body) => kx.parts.addManualPart(u, body),
        figur: (u, body) => kx.minifigs.addManualMinifig(u, body),
        // Kaufpreis ist MAXPRICE aus der Datei.
        set: (u, sn, menge, zustand, kaufpreis) =>
          kx.sets.setErfassen({
            requester: u,
            setNumber: sn,
            menge,
            kaufpreis,
            zustand,
            ifPresent: 'aufstocken',
          }),
      },
    });
    await closeBar(
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
    await closeBar({ ok: 0, fehler: 0, done: 0, abgebrochen: true });
    throw f;
  }
}

export { importWantedXml };
