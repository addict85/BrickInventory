/** Jeder Schritt meldet seinen Fehler und lässt die übrigen laufen; scheitert
 * einer, wiederholt der Worker den ganzen Lauf — alle Schritte vertragen das. */
import { pruefeAbbruch, type AuftragsLauf } from '../auftraege';
import { fehlertext } from '../infra/fehler';
import { raeumeAlteSicherungenAuf } from '../../db/migrate';
import type { ManagementContext } from './context';

type Step = [name: string, lauf: () => Promise<unknown>];

async function runSteps(schritte: Step[], auftrag?: AuftragsLauf): Promise<void> {
  const fehler: string[] = [];
  for (const [name, lauf] of schritte) {
    pruefeAbbruch(auftrag);
    try {
      const n = await lauf();
      if (typeof n === 'number' && n > 0) console.log(`[cleanup] ${name}: ${n} entfernt`);
    } catch (e) {
      fehler.push(`${name}: ${fehlertext(e)}`);
    }
  }
  if (fehler.length) throw new Error(fehler.join('; '));
}

function cleanup(k: ManagementContext, lauf?: AuftragsLauf): Promise<void> {
  return runSteps(
    [
      ...k.konto.aufraeumSchritte('stuendlich'),
      ['Papierkorb', k.bestand.raeumePapierkorbAuf],
      ['PDF-Aufträge', k.katalog.pdf.raeumeAuf],
      ['alte Aufträge', k.auftraege.raeumeErledigteAuf],
      ['verfallene Bildwünsche', k.bilder.loescheVerfallene],
      ['Idempotenzschlüssel', k.idempotency.cleanupIdempotency],
    ],
    lauf,
  );
}

function cleanupDaily(k: ManagementContext, lauf?: AuftragsLauf): Promise<void> {
  return runSteps(
    [
      ['Preisverlauf', k.finanzen.loescheAltePreise],
      ...k.konto.aufraeumSchritte('taeglich'),
      ['Bild-Cache', () => k.bilder.raeumeBildCacheAuf(k.bilder.bildGrenzen().cacheMaxBytes, k.uhr.jetzt())],
      ['Kopien vor Migrationen', () => raeumeAlteSicherungenAuf(k.db)],
    ],
    lauf,
  );
}

export { cleanup, cleanupDaily };
