/** Jeder Schritt meldet seinen Fehler und lässt die übrigen laufen; scheitert
 * einer, wiederholt der Worker den ganzen Lauf — alle Schritte vertragen das. */
import { purgeExpiredTokens } from '../src/konto/auth';
import { raeumeAnmeldezaehlerAuf } from '../src/konto/loginLimiter';
import { raeumePapierkorbAuf } from '../src/bestand/papierkorb';
import { cleanOldPdfJobs } from '../src/auftraege/pdfAuftraege';
import { raeumeErledigteAuf } from '../src/auftraege/dienst';
import { purgeAltePreise } from '../src/finanzen/priceHistory';
import { raeumeBildCacheAuf } from '../src/katalog/bilder/imgCacheServe';
import { loescheVerfallene } from '../src/katalog/bilder/bildbedarf';
import { fehlertext } from '../src/infra/fehler';
import { raeumeIdempotenzAuf } from '../src/idempotenz/dienst';
import { raeumeOffeneRegistrierungenAuf } from '../src/konto/konten';
import { raeumeProtokollAuf } from '../src/verwaltung/dienst';
import { raeumeAlteSicherungenAuf } from '../db/migrate';
import * as db from '../db/database';
import { pruefeAbbruch, type AuftragsLauf } from '../src/auftraege/auftraege';

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
