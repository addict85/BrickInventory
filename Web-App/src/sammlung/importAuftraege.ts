/** Die Importe ausser dem Set-CSV (das in setCsvImport.ts zeilenweise
 * fortsetzt). Die Route reicht ein und wartet (src/auftraege/importAlsAuftrag.ts). */
import { csvImportBericht } from '../infra/csvExport';
import { Fachfehler } from '../infra/fehlerTexte';
import type { z } from 'zod';
import type { ImportNutzlast as ImportNutzlastSchema, AuftragsZeile, AuftragsKontext } from '../auftraege';
import { importiereWantedXml } from './wantedXmlImport';
import type { SammlungKontext } from './kontext';

export type ImportNutzlast = z.output<typeof ImportNutzlastSchema>;

async function ergebnisVon(
  kx: SammlungKontext,
  n: ImportNutzlast,
  k: AuftragsKontext,
): Promise<Record<string, unknown>> {
  const uid = n.user_id;
  switch (n.quelle) {
    case 'teile_csv':
      return csvImportBericht(await kx.teile.importiereTeileCsv(uid, n.eingabe.text));
    case 'figuren_csv':
      return csvImportBericht(await kx.figuren.importiereFigurenCsv(uid, n.eingabe.text));
    case 'merkliste_csv':
      return csvImportBericht(await kx.merkliste.importiereMerklisteCsv(n.eingabe.owner, n.eingabe.text));
    case 'alarme_csv':
      return kx.finanzen.preisalarm.alarmeAusCsv(uid, n.eingabe.waehrung, n.eingabe.text);
    case 'wanted_xml':
      return importiereWantedXml(kx, uid, n.eingabe, k);
  }
}

/** Ein Fachfehler ist ein Ergebnis (die Anfrage meldet ihn mit Code), kein Fehlschlag des Auftrags. */
async function fuehreImportAus(
  kx: SammlungKontext,
  n: ImportNutzlast,
  k: AuftragsKontext,
  a: AuftragsZeile,
): Promise<void> {
  try {
    await kx.auftraege.setzeErgebnis(a.id, await ergebnisVon(kx, n, k));
  } catch (e) {
    if (!(e instanceof Fachfehler)) throw e;
    await kx.auftraege.setzeFachfehler(a.id, e);
  }
}

export { fuehreImportAus };
