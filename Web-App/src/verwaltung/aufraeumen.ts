/** Jeder Schritt meldet seinen Fehler und lässt die übrigen laufen; scheitert
 * einer, wiederholt der Worker den ganzen Lauf — alle Schritte vertragen das. */
import { kontoBereich, purgeExpiredTokens, raeumeAnmeldezaehlerAuf, raeumeOffeneRegistrierungenAuf } from '../konto';
import { raeumePapierkorbAuf } from '../bestand';
import { auftraegeBereich, cleanOldPdfJobs, pruefeAbbruch, type AuftragsLauf } from '../auftraege';
import { purgeAltePreise } from '../finanzen';
import { raeumeBildCacheAuf, loescheVerfallene } from '../katalog';
import { fehlertext } from '../infra/fehler';
import { raeumeIdempotenzAuf } from '../idempotenz';
import { raeumeAlteSicherungenAuf } from '../../db/migrate';
import { verwaltungBereich } from './prozess';

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

function aufraeumen(lauf?: AuftragsLauf): Promise<void> {
  return fuehreAus(
    [
      ['abgelaufene Tokens', purgeExpiredTokens],
      ['Anmeldezähler', raeumeAnmeldezaehlerAuf],
      ['Papierkorb', raeumePapierkorbAuf],
      ['PDF-Aufträge', cleanOldPdfJobs],
      ['alte Aufträge', auftraegeBereich().auftraege.raeumeErledigteAuf],
      ['verfallene Bildwünsche', loescheVerfallene],
      ['Idempotenzschlüssel', raeumeIdempotenzAuf],
    ],
    lauf,
  );
}

function aufraeumenTaeglich(lauf?: AuftragsLauf): Promise<void> {
  return fuehreAus(
    [
      ['Preisverlauf', purgeAltePreise],
      ['unbestätigte Registrierungen', raeumeOffeneRegistrierungenAuf],
      ['Bild-Cache', raeumeBildCacheAuf],
      ['Verwaltungsprotokoll', () => kontoBereich().protokoll.raeumeProtokollAuf()],
      ['Kopien vor Migrationen', () => raeumeAlteSicherungenAuf(verwaltungBereich().db)],
    ],
    lauf,
  );
}

export { aufraeumen, aufraeumenTaeglich };
