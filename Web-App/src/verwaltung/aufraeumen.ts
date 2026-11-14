/** Jeder Schritt meldet seinen Fehler und lässt die übrigen laufen; scheitert
 * einer, wiederholt der Worker den ganzen Lauf — alle Schritte vertragen das. */
import { pruefeAbbruch, type AuftragsLauf } from '../auftraege';
import { raeumeBildCacheAuf } from '../bilder';
import { fehlertext } from '../infra/fehler';
import { raeumeAlteSicherungenAuf } from '../../db/migrate';
import type { VerwaltungKontext } from './kontext';

type Schritt = [name: string, lauf: () => Promise<unknown>];

async function fuehreAus(schritte: Schritt[], auftrag?: AuftragsLauf): Promise<void> {
  const fehler: string[] = [];
  for (const [name, lauf] of schritte) {
    pruefeAbbruch(auftrag);
    try {
      const n = await lauf();
      if (typeof n === 'number' && n > 0) console.log(`[aufräumen] ${name}: ${n} entfernt`);
    } catch (e) {
      fehler.push(`${name}: ${fehlertext(e)}`);
    }
  }
  if (fehler.length) throw new Error(fehler.join('; '));
}

function aufraeumen(k: VerwaltungKontext, lauf?: AuftragsLauf): Promise<void> {
  return fuehreAus(
    [
      ['abgelaufene Tokens', k.konto.tokensAufraeumen],
      ['Anmeldezähler', k.konto.raeumeAnmeldezaehlerAuf],
      ['Verwalterübernahmen', k.konto.fuehreFaelligeUebernahmenAus],
      ['Papierkorb', k.bestand.raeumePapierkorbAuf],
      ['PDF-Aufträge', k.auftraege.cleanOldPdfJobs],
      ['alte Aufträge', k.auftraege.raeumeErledigteAuf],
      ['verfallene Bildwünsche', k.katalog.bilder.loescheVerfallene],
      ['Idempotenzschlüssel', k.idempotenz.raeumeIdempotenzAuf],
    ],
    lauf,
  );
}

function aufraeumenTaeglich(k: VerwaltungKontext, lauf?: AuftragsLauf): Promise<void> {
  return fuehreAus(
    [
      ['Preisverlauf', k.finanzen.purgeAltePreise],
      ['unbestätigte Registrierungen', k.konto.raeumeOffeneRegistrierungenAuf],
      ['Bild-Cache', () => raeumeBildCacheAuf(k.katalog.bilder.bildGrenzen().cacheMaxBytes)],
      ['Verwaltungsprotokoll', () => k.konto.raeumeProtokollAuf()],
      ['Kopien vor Migrationen', () => raeumeAlteSicherungenAuf(k.db)],
    ],
    lauf,
  );
}

export { aufraeumen, aufraeumenTaeglich };
