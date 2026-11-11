/** Jeder Import läuft als Auftrag im Job-Prozess; die Anfrage reicht ein und
 * wartet auf das Ergebnis. Bricht der Web-Prozess ab, läuft der Import weiter,
 * und Fremdabrufe belasten nicht den Prozess, der die Seiten ausliefert. */
import { stelleAuftragEin } from './dienst';
import * as repo from './repository/auftraege';
import type { Fortschritt } from './auftraege';
import type { z } from 'zod';
import type { ImportNutzlast, NutzlastEingabe } from './nutzlasten';
import { Fachfehler, fachfehler, type FehlerArt, type FehlerCode } from '../infra/fehlerTexte';

export type ImportQuelle = z.input<typeof ImportNutzlast>['quelle'];
/** Was der Import der Quelle braucht (src/auftraege/nutzlasten.ts). */
export type ImportEingabe<Q extends ImportQuelle> = Extract<z.input<typeof ImportNutzlast>, { quelle: Q }>['eingabe'];

/** So lange wartet die Anfrage; danach läuft der Import im Hintergrund weiter. */
export const IMPORT_WARTEN_MS = 10 * 60_000;
const TAKT_MS = 150;

/** Was der Job ablegt: das Ergebnis, oder der Fachfehler, den die Route meldet. */
type Abgelegt = { ergebnis?: Record<string, unknown>; fachfehler?: { code: FehlerCode; art: FehlerArt; vars?: Record<string, string | number> } };

export async function setzeErgebnis(id: string, ergebnis: Record<string, unknown>): Promise<void> {
  await repo.schreibeErgebnis(id, { ergebnis } satisfies Abgelegt);
}

/** Ein Fachfehler (falsche Datei, fehlendes Recht) kommt bei der Anfrage mit Code an. */
export async function setzeFachfehler(id: string, e: Fachfehler): Promise<void> {
  await repo.schreibeErgebnis(id, { fachfehler: { code: e.code, art: e.art, ...(e.vars ? { vars: e.vars } : {}) } } satisfies Abgelegt);
}

/** @typeParam T die Antwort, die der Job ablegt; der Vertrag prüft sie im Testlauf. */
export async function importAlsAuftrag<T = Record<string, unknown>, Q extends ImportQuelle = ImportQuelle>(uid: number, quelle: Q, eingabe: ImportEingabe<Q>,
  o: { fortschritt?: (f: Fortschritt) => void; wartenMs?: number } = {}): Promise<T> {
  // Ein Versuch: Ein zweiter Lauf legte schon Angelegtes noch einmal an.
  // tsc verbindet Q nicht mit dem Zweig der Union; geprüft wird beim Einstellen.
  const nutzlast = { user_id: uid, quelle, eingabe } as NutzlastEingabe<'csv_import'>;
  const id = await stelleAuftragEin('csv_import', nutzlast, { userId: uid, maxVersuche: 1 });
  if (!id) fachfehler('intern', 'interner_fehler');
  const bis = Date.now() + (o.wartenMs ?? IMPORT_WARTEN_MS);
  let zuletzt = '';
  for (;;) {
    const s = await repo.auftragsStand(id);
    if (s?.fortschritt && o.fortschritt) {
      const j = JSON.stringify(s.fortschritt);
      if (j !== zuletzt) { zuletzt = j; o.fortschritt(s.fortschritt); }
    }
    const abgelegt = (s?.ergebnis ?? {}) as Abgelegt;
    if (abgelegt.fachfehler) throw new Fachfehler(abgelegt.fachfehler.art ?? 'ungueltig', abgelegt.fachfehler.code, abgelegt.fachfehler.vars);
    if (s?.status === 'erledigt') {
      // Gelesen ist gelesen: Das Ergebnis trägt Namen und Nummern aus der Datei.
      await repo.schreibeErgebnis(id, null);
      return (abgelegt.ergebnis ?? {}) as T;
    }
    if (!s || s.status === 'abgebrochen') fachfehler('konflikt', 'import_abgebrochen');
    if (s.status === 'fehler') fachfehler('intern', 'import_fehlgeschlagen');
    if (Date.now() > bis) fachfehler('zeitueberschreitung', 'import_laeuft_noch');
    await new Promise(r => setTimeout(r, TAKT_MS));
  }
}
