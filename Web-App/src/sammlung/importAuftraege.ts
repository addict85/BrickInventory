/** Die Importe ausser dem Set-CSV (das in setCsvImport.ts zeilenweise
 * fortsetzt). Die Route reicht ein und wartet (src/auftraege/importAlsAuftrag.ts). */
import { importiereTeileCsv } from '../teile/manuelleTeile';
import { importiereFigurenCsv } from '../figuren/manuelleFiguren';
import { importiereMerklisteCsv } from '../merkliste/merkliste';
import { alarmeAusCsv } from '../finanzen/preisalarm';
import { csvImportBericht } from '../infra/csvExport';
import { Fachfehler } from '../infra/fehlerTexte';
import type { z } from 'zod';
import { setzeErgebnis, setzeFachfehler } from '../auftraege/importAlsAuftrag';
import type { ImportNutzlast as ImportNutzlastSchema } from '../auftraege/nutzlasten';
import { importiereWantedXml } from './wantedXmlImport';
import type { AuftragsZeile, AuftragsKontext } from '../auftraege/auftraege';

export type ImportNutzlast = z.output<typeof ImportNutzlastSchema>;

async function ergebnisVon(n: ImportNutzlast, k: AuftragsKontext): Promise<Record<string, unknown>> {
  const uid = n.user_id;
  switch (n.quelle) {
    case 'teile_csv':     return csvImportBericht(await importiereTeileCsv(uid, n.eingabe.text));
    case 'figuren_csv':   return csvImportBericht(await importiereFigurenCsv(uid, n.eingabe.text));
    case 'merkliste_csv': return csvImportBericht(await importiereMerklisteCsv(n.eingabe.owner, n.eingabe.text));
    case 'alarme_csv':    return alarmeAusCsv(uid, n.eingabe.waehrung, n.eingabe.text);
    case 'wanted_xml':    return importiereWantedXml(uid, n.eingabe, k);
  }
}

/** Ein Fachfehler ist ein Ergebnis (die Anfrage meldet ihn mit Code), kein Fehlschlag des Auftrags. */
async function fuehreImportAus(n: ImportNutzlast, k: AuftragsKontext, a: AuftragsZeile): Promise<void> {
  try { await setzeErgebnis(a.id, await ergebnisVon(n, k)); }
  catch (e) {
    if (!(e instanceof Fachfehler)) throw e;
    await setzeFachfehler(a.id, e);
  }
}

export { fuehreImportAus };
