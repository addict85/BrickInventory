/** Ein Auftrag, auf dessen Ergebnis die Anfrage wartet (etwa ein Import): Bricht der Web-Prozess
 * ab, läuft er weiter, und Fremdabrufe belasten nicht den Prozess, der die Seiten ausliefert. */
import { stelleAuftragEin } from './dienst';
import type { AuftragsArt, Fortschritt, NutzlastEingabe } from './auftraege';
import { Fachfehler, fachfehler, type FehlerArt, type FehlerCode } from '../infra/fehlerTexte';
import type { AuftraegeKontext } from './kontext';

/** So lange wartet die Anfrage; danach läuft der Auftrag im Hintergrund weiter. */
export const IMPORT_WARTEN_MS = 10 * 60_000;
const TAKT_MS = 150;

/** Was der Job ablegt: das Ergebnis, oder der Fachfehler, den die Route meldet. */
type Abgelegt = {
  ergebnis?: Record<string, unknown>;
  fachfehler?: { code: FehlerCode; art: FehlerArt; vars?: Record<string, string | number> };
};

export async function setzeErgebnis(k: AuftraegeKontext, id: string, ergebnis: Record<string, unknown>): Promise<void> {
  await k.auftraege.schreibeErgebnis(id, { ergebnis } satisfies Abgelegt);
}

/** Ein Fachfehler (falsche Datei, fehlendes Recht) kommt bei der Anfrage mit Code an. */
export async function setzeFachfehler(k: AuftraegeKontext, id: string, e: Fachfehler): Promise<void> {
  await k.auftraege.schreibeErgebnis(id, {
    fachfehler: { code: e.code, art: e.art, ...(e.vars ? { vars: e.vars } : {}) },
  } satisfies Abgelegt);
}

/** @typeParam T die Antwort, die der Job ablegt; der Vertrag prüft sie im Testlauf. */
export async function warteAufAuftrag<T, A extends AuftragsArt>(
  k: AuftraegeKontext,
  art: A,
  nutzlast: NutzlastEingabe<A>,
  o: { userId: number; fortschritt?: (f: Fortschritt) => void; wartenMs?: number },
): Promise<T> {
  const uid = o.userId;
  // Ein Versuch: Ein zweiter Lauf legte schon Angelegtes noch einmal an.
  const id = await stelleAuftragEin(k, art, nutzlast, { userId: uid, maxVersuche: 1 });
  if (!id) fachfehler('intern', 'interner_fehler');
  const bis = k.uhr.jetzt() + (o.wartenMs ?? IMPORT_WARTEN_MS);
  let zuletzt = '';
  for (;;) {
    const s = await k.auftraege.auftragsStand(id, uid);
    if (s?.fortschritt && o.fortschritt) {
      const j = JSON.stringify(s.fortschritt);
      if (j !== zuletzt) {
        zuletzt = j;
        o.fortschritt(s.fortschritt);
      }
    }
    const abgelegt = (s?.ergebnis ?? {}) as Abgelegt;
    if (abgelegt.fachfehler)
      throw new Fachfehler(abgelegt.fachfehler.art ?? 'ungueltig', abgelegt.fachfehler.code, abgelegt.fachfehler.vars);
    if (s?.status === 'erledigt') {
      // Gelesen ist gelesen: Das Ergebnis trägt Namen und Nummern aus der Datei.
      await k.auftraege.schreibeErgebnis(id, null);
      return (abgelegt.ergebnis ?? {}) as T;
    }
    if (!s || s.status === 'abgebrochen') fachfehler('konflikt', 'import_abgebrochen');
    if (s.status === 'fehler') fachfehler('intern', 'import_fehlgeschlagen');
    if (k.uhr.jetzt() > bis) fachfehler('zeitueberschreitung', 'import_laeuft_noch');
    await new Promise(r => setTimeout(r, TAKT_MS));
  }
}
