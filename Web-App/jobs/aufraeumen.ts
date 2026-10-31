/**
 * Die geplanten Aufräumläufe (utils/zeitplan.ts). Jeder Schritt meldet seinen
 * Fehler und lässt die übrigen laufen; scheitert einer, wiederholt der Worker
 * den ganzen Lauf — alle Schritte vertragen das.
 */
import { purgeExpiredTokens } from '../src/konto/auth';
import { raeumeAnmeldezaehlerAuf } from '../src/konto/loginLimiter';
import { raeumePapierkorbAuf } from '../utils/papierkorb';
import { cleanOldPdfJobs } from '../utils/pdfAuftraege';
import { raeumeErledigteAuf } from '../utils/auftraege';
import { purgeAltePreise } from '../utils/priceHistory';
import { raeumeBildCacheAuf } from '../utils/imgCacheServe';
import { loescheVerfallene } from '../utils/bildbedarf';
import { fehlertext } from '../src/infra/httpError';

type Schritt = [name: string, lauf: () => Promise<unknown>];

async function fuehreAus(schritte: Schritt[]): Promise<void> {
  const fehler: string[] = [];
  for (const [name, lauf] of schritte) {
    try {
      const n = await lauf();
      if (typeof n === 'number' && n > 0) console.log(`[aufräumen] ${name}: ${n} entfernt`);
    } catch (e) { fehler.push(`${name}: ${fehlertext(e)}`); }
  }
  if (fehler.length) throw new Error(fehler.join('; '));
}

/** Stündlich: was nach Ablauf einer Frist weg darf. */
function aufraeumen(): Promise<void> {
  return fuehreAus([
    ['abgelaufene Tokens', purgeExpiredTokens],
    ['Anmeldezähler', raeumeAnmeldezaehlerAuf],
    ['Papierkorb', raeumePapierkorbAuf],
    ['PDF-Aufträge', cleanOldPdfJobs],
    ['alte Aufträge', raeumeErledigteAuf],
    ['verfallene Bildwünsche', loescheVerfallene],
  ]);
}

/** Täglich: was über alle Dateien oder grosse Tabellen geht. */
function aufraeumenTaeglich(): Promise<void> {
  return fuehreAus([
    ['Preisverlauf', purgeAltePreise],
    ['Bild-Cache', raeumeBildCacheAuf],
  ]);
}

export { aufraeumen, aufraeumenTaeglich };
