/** Jeder Schritt meldet seinen Fehler und lässt die übrigen laufen; scheitert
 * einer, wiederholt der Worker den ganzen Lauf — alle Schritte vertragen das. */
import { purgeExpiredTokens, raeumeAnmeldezaehlerAuf, raeumeOffeneRegistrierungenAuf } from '../konto';
import { raeumePapierkorbAuf } from '../bestand';
import { cleanOldPdfJobs, raeumeErledigteAuf, pruefeAbbruch, type AuftragsLauf } from '../auftraege';
import { purgeAltePreise } from '../finanzen';
import { raeumeBildCacheAuf, loescheVerfallene } from '../katalog';
import { fehlertext } from '../infra/fehler';
import { raeumeIdempotenzAuf } from '../idempotenz';
import { raeumeProtokollAuf } from './dienst';
import { raeumeAlteSicherungenAuf } from '../../db/migrate';
import * as db from '../../db/database';

type Schritt = [name: string, lauf: () => Promise<unknown>];

async function fuehreAus(schritte: Schritt[], auftrag?: AuftragsLauf): Promise<void> {
  const fehler: string[] = [];
  for (const [name, lauf] of schritte) {
    pruefeAbbruch(auftrag);
    try {
      const n = await lauf();
      if (typeof n === 'number' && n > 0) console.log(`[aufräumen] ${name}: ${n} entfernt`);
    } catch (e) { fehler.push(`${name}: ${fehlertext(e)}`); }
  }
  if (fehler.length) throw new Error(fehler.join('; '));
}

function aufraeumen(lauf?: AuftragsLauf): Promise<void> {
  return fuehreAus([
    ['abgelaufene Tokens', purgeExpiredTokens],
    ['Anmeldezähler', raeumeAnmeldezaehlerAuf],
    ['Papierkorb', raeumePapierkorbAuf],
    ['PDF-Aufträge', cleanOldPdfJobs],
    ['alte Aufträge', raeumeErledigteAuf],
    ['verfallene Bildwünsche', loescheVerfallene],
    ['Idempotenzschlüssel', raeumeIdempotenzAuf],
  ], lauf);
}

function aufraeumenTaeglich(lauf?: AuftragsLauf): Promise<void> {
  return fuehreAus([
    ['Preisverlauf', purgeAltePreise],
    ['unbestätigte Registrierungen', raeumeOffeneRegistrierungenAuf],
    ['Bild-Cache', raeumeBildCacheAuf],
    ['Verwaltungsprotokoll', () => raeumeProtokollAuf()],
    ['Kopien vor Migrationen', () => raeumeAlteSicherungenAuf(db)],
  ], lauf);
}

export { aufraeumen, aufraeumenTaeglich };
