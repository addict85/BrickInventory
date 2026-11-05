/** Die Importe ausser dem Set-CSV (das in setCsvImport.ts zeilenweise
 * fortsetzt). Die Route reicht ein und wartet (src/auftraege/importAlsAuftrag.ts). */
import { importiereTeileCsv } from '../src/teile/manuelleTeile';
import { importiereFigurenCsv } from '../src/figuren/manuelleFiguren';
import { importiereMerklisteCsv } from '../src/merkliste/merkliste';
import { alarmeAusCsv } from '../src/finanzen/preisalarm';
import { csvImportBericht } from '../src/infra/csvExport';
import { Fachfehler } from '../src/infra/fehlerTexte';
import { setzeErgebnis, setzeFachfehler, type ImportQuelle } from '../src/auftraege/importAlsAuftrag';
import type { AuftragsZeile } from '../src/auftraege/auftraege';
import type { AuftragsKontext } from './auftragsWorker';
import { importiereWantedXml, type WantedXmlEingabe } from './wantedXmlImport';

export interface ImportNutzlast { user_id: number; quelle: ImportQuelle; eingabe: Record<string, unknown> }

async function ergebnisVon(n: ImportNutzlast, k: AuftragsKontext): Promise<Record<string, unknown>> {
  const uid = Number(n.user_id);
  const text = String(n.eingabe.text ?? '');
  switch (n.quelle) {
    case 'teile_csv':     return csvImportBericht(await importiereTeileCsv(uid, text));
    case 'figuren_csv':   return csvImportBericht(await importiereFigurenCsv(uid, text));
    case 'merkliste_csv': return csvImportBericht(await importiereMerklisteCsv(Number(n.eingabe.owner), text));
    case 'alarme_csv':    return alarmeAusCsv(uid, String(n.eingabe.waehrung ?? 'EUR'), text);
    case 'wanted_xml':    return importiereWantedXml(uid, n.eingabe as unknown as WantedXmlEingabe, k);
  }
}

/** Ein Fachfehler ist ein Ergebnis (die Anfrage meldet ihn mit Code), kein
 * Fehlschlag des Auftrags. */
async function fuehreImportAus(n: ImportNutzlast, k: AuftragsKontext, a: AuftragsZeile): Promise<void> {
  try { await setzeErgebnis(a.id, await ergebnisVon(n, k)); }
  catch (e) {
    if (!(e instanceof Fachfehler)) throw e;
    await setzeFachfehler(a.id, e);
  }
}

export { fuehreImportAus };
