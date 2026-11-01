import * as db from '../db/database';
import { logAndContinue } from '../src/infra/httpError';
import { initImageMisses } from '../src/katalog/bilder/imageMisses';
import { initImageQueue } from '../jobs/imageQueue';
import { kopienVerschluesseln, nummernNachverschluesseln } from '../src/gutscheine/dienst';
import { verschluesseleGutscheinAltbestand } from '../src/gutscheine/gutscheinDateien';
import { verschluesseleAltbestand } from '../src/konto/geheimnisAltbestand';
import { antwortenUmschluesseln } from '../src/idempotenz/dienst';
import { datenSchluessel } from '../src/infra/geheimnis';

/**
 * Schema und Migrationen, danach die Bild-Hilfsdienste — in JEDEM
 * Arbeitsprozess, weil sie prozess-lokal sind (Bestand im Speicher, Takt des
 * Puffers). Hier und nicht in db/: Die Datenbankschicht kennt keine Jobs.
 */
export async function bereiteDatenbankVor(): Promise<void> {
  // Beim Start statt bei der ersten Verschlüsselung: Ein falscher oder alter
  // Ort des Schlüssels soll im Startprotokoll stehen.
  datenSchluessel();
  await db.initSchemaOnce();
  // Vor der ersten Anfrage und ohne Ausweg: entschluessele() liest nur v2, und
  // eine Gutscheinzeile ohne nummer_suche entginge der Doppelprüfung.
  const n = await nummernNachverschluesseln() + await kopienVerschluesseln() + await verschluesseleAltbestand()
    + await antwortenUmschluesseln() + await verschluesseleGutscheinAltbestand();
  if (n) console.log(`[geheimnis] ${n} Geheimnisse auf v2 (mit Kontext) umgeschlüsselt`);
  await initImageMisses().catch(logAndContinue('db:image_misses'));
  await initImageQueue().catch(logAndContinue('db:image_wanted'));
}
