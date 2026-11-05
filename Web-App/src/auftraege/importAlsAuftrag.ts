/** Jeder Import läuft als Auftrag im Job-Prozess; die Anfrage reicht ein und
 * wartet auf das Ergebnis. Bricht der Web-Prozess ab, läuft der Import weiter,
 * und Fremdabrufe belasten nicht den Prozess, der die Seiten ausliefert. */
import { stelleAuftragEin } from './dienst';
import * as repo from './repository/auftraege';
import type { Fortschritt } from './auftraege';
import { Fachfehler, fehlerWerfen } from '../infra/fehlerTexte';
import type { FehlerCode } from '../infra/fehlerTexte';

export type ImportQuelle = 'teile_csv' | 'figuren_csv' | 'merkliste_csv' | 'alarme_csv' | 'wanted_xml';

/** So lange wartet die Anfrage; danach läuft der Import im Hintergrund weiter. */
export const IMPORT_WARTEN_MS = 10 * 60_000;
const TAKT_MS = 150;

/** Was der Job ablegt: das Ergebnis, oder der Fachfehler, den die Route meldet. */
type Abgelegt = { ergebnis?: Record<string, unknown>; fachfehler?: { code: FehlerCode; status: number; vars?: Record<string, string | number> } };

export async function setzeErgebnis(id: string, ergebnis: Record<string, unknown>): Promise<void> {
  await repo.schreibeErgebnis(id, { ergebnis } satisfies Abgelegt);
}

/** Ein Fachfehler (falsche Datei, fehlendes Recht) kommt bei der Anfrage mit Code an. */
export async function setzeFachfehler(id: string, e: Fachfehler): Promise<void> {
  await repo.schreibeErgebnis(id, { fachfehler: { code: e.code, status: e.status, ...(e.vars ? { vars: e.vars } : {}) } } satisfies Abgelegt);
}

/** @typeParam T die Antwort, die der Job ablegt; der Vertrag prüft sie im Testlauf. */
export async function importAlsAuftrag<T = Record<string, unknown>>(uid: number, quelle: ImportQuelle, eingabe: Record<string, unknown>,
  o: { fortschritt?: (f: Fortschritt) => void; wartenMs?: number } = {}): Promise<T> {
  // Ein Versuch: Ein zweiter Lauf legte schon Angelegtes noch einmal an.
  const id = await stelleAuftragEin('csv_import', { user_id: uid, quelle, eingabe }, { userId: uid, maxVersuche: 1 });
  if (!id) fehlerWerfen('interner_fehler', 500);
  const bis = Date.now() + (o.wartenMs ?? IMPORT_WARTEN_MS);
  let zuletzt = '';
  for (;;) {
    const s = await repo.auftragsStand(id);
    if (s?.fortschritt && o.fortschritt) {
      const j = JSON.stringify(s.fortschritt);
      if (j !== zuletzt) { zuletzt = j; o.fortschritt(s.fortschritt); }
    }
    const abgelegt = (s?.ergebnis ?? {}) as Abgelegt;
    if (abgelegt.fachfehler) throw new Fachfehler(abgelegt.fachfehler.code, abgelegt.fachfehler.status, abgelegt.fachfehler.vars);
    if (s?.status === 'erledigt') {
      // Gelesen ist gelesen: Das Ergebnis trägt Namen und Nummern aus der Datei.
      await repo.schreibeErgebnis(id, null);
      return (abgelegt.ergebnis ?? {}) as T;
    }
    if (!s || s.status === 'abgebrochen') fehlerWerfen('import_abgebrochen', 409);
    if (s.status === 'fehler') fehlerWerfen('import_fehlgeschlagen', 500);
    if (Date.now() > bis) fehlerWerfen('import_laeuft_noch', 504);
    await new Promise(r => setTimeout(r, TAKT_MS));
  }
}
