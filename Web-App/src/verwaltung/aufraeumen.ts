/** Jeder Schritt meldet seinen Fehler und lässt die übrigen laufen; scheitert
 * einer, wiederholt der Worker den ganzen Lauf — alle Schritte vertragen das. */
import { purgeExpiredTokens } from '../konto/auth';
import { raeumeAnmeldezaehlerAuf } from '../konto/loginLimiter';
import { raeumePapierkorbAuf } from '../bestand/papierkorb';
import { cleanOldPdfJobs } from '../auftraege/pdfAuftraege';
import { raeumeErledigteAuf } from '../auftraege/dienst';
import { purgeAltePreise } from '../finanzen/priceHistory';
import { raeumeBildCacheAuf } from '../katalog/bilder/imgCacheServe';
import { loescheVerfallene } from '../katalog/bilder/bildbedarf';
import { fehlertext } from '../infra/fehler';
import { raeumeIdempotenzAuf } from '../idempotenz/dienst';
import { raeumeOffeneRegistrierungenAuf } from '../konto/konten';
import { raeumeProtokollAuf } from './dienst';
import { raeumeAlteSicherungenAuf } from '../../db/migrate';
import { pruefeAbbruch, type AuftragsLauf } from '../auftraege/auftraege';
import { verwaltungBereich } from './prozess';

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
    ['Kopien vor Migrationen', () => raeumeAlteSicherungenAuf(verwaltungBereich().db)],
  ], lauf);
}

export { aufraeumen, aufraeumenTaeglich };
