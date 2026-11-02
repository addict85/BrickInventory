import * as db from '../db/database';
import { logAndContinue } from '../src/infra/httpError';
import { initImageMisses } from '../src/katalog/bilder/imageMisses';
import { initImageQueue } from '../jobs/imageQueue';
import { kopienVerschluesseln, nummernNachverschluesseln } from '../src/gutscheine/dienst';
import { verschluesseleGutscheinAltbestand } from '../src/gutscheine/gutscheinDateien';
import { verschluesseleAltbestand } from '../src/konto/geheimnisAltbestand';
import { antwortenUmschluesseln } from '../src/idempotenz/dienst';
import { datenSchluessel } from '../src/infra/geheimnis';
import { konfig } from '../src/infra/konfig';

/** Ein Superuser erreicht COPY … PROGRAM und jede Datenbank des Servers. */
export async function warneBeiSuperuser(): Promise<boolean> {
  const z = await db.get<{ s: boolean }>('SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user');
  if (!konfig().produktion || !z?.s) return false;
  console.warn('⚠️  [datenbank] Die App verbindet sich als Superuser. Eigene Rolle: UPGRADE.md, Abschnitt 29.');
  return true;
}

/**
 * Schema und Migrationen, danach die Bild-Hilfsdienste — in JEDEM
 * Arbeitsprozess, weil sie prozess-lokal sind (Bestand im Speicher, Takt des
 * Puffers). Hier und nicht in db/: Die Datenbankschicht kennt keine Jobs.
 */
export async function bereiteDatenbankVor(): Promise<void> {
  // Beim Start statt bei der ersten Verschlüsselung: Ein falscher oder alter
  // Ort des Schlüssels soll im Startprotokoll stehen.
  datenSchluessel();
  await warneBeiSuperuser();
  await db.initSchemaOnce();
  // Vor der ersten Anfrage und ohne Ausweg: entschluessele() liest nur v2, und
  // eine Gutscheinzeile ohne nummer_suche entginge der Doppelprüfung.
  const n = await nummernNachverschluesseln() + await kopienVerschluesseln() + await verschluesseleAltbestand()
    + await antwortenUmschluesseln() + await verschluesseleGutscheinAltbestand();
  if (n) console.log(`[geheimnis] ${n} Geheimnisse auf v2 (mit Kontext) umgeschlüsselt`);
  await initImageMisses().catch(logAndContinue('db:image_misses'));
  await initImageQueue().catch(logAndContinue('db:image_wanted'));
}
