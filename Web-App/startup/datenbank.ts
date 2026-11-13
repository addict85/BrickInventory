import type { Db } from '../db/database';
import { logAndContinue } from '../src/infra/fehler';
import { initImageMisses, initImageQueue } from '../src/katalog';
import { gutscheineBereich, verschluesseleGutscheinAltbestand } from '../src/gutscheine';
import { verschluesseleAltbestand } from '../src/konto';
import { antwortenUmschluesseln, alteAbdrueckeLoeschen, alleVergessen } from '../src/idempotenz';
import { altSchluessel, datenSchluessel } from '../src/infra/geheimnis';
import { konfig } from '../src/infra/konfig';
import { auftraegeBereich } from '../src/auftraege';

/** Ein Superuser erreicht COPY … PROGRAM und jede Datenbank des Servers: In
 * Betrieb (auch ohne NODE_ENV) ein Startverbot, ausser DB_SUPERUSER_ERLAUBT=1 (UPGRADE.md). */
export async function warneBeiSuperuser(db: Db): Promise<boolean> {
  if (!konfig().betrieb || !(await db.alsSuperuserVerbunden())) return false;
  if (!konfig().dbSuperuserErlaubt) {
    console.error(
      '❌ [datenbank] Die App verbindet sich als Superuser — Start verweigert. Eigene Rolle: UPGRADE.md#eigene-datenbankrolle; ' +
        'wer es bewusst so betreibt, setzt DB_SUPERUSER_ERLAUBT=1 (UPGRADE.md#superuser-ausnahme).',
    );
    process.exit(1);
  }
  console.warn(
    '⚠️  [datenbank] Die App verbindet sich als Superuser (DB_SUPERUSER_ERLAUBT=1). Eigene Rolle: UPGRADE.md#eigene-datenbankrolle.',
  );
  return true;
}

/** Die Marke im Laufzustand. Eine zurückgespielte ältere Sicherung bringt sie
 * nicht mit; dann läuft die Umstellung beim nächsten Start erneut. */
export const ALTBESTAND_MARKE = 'altbestand_v2';

/** Einmal je Datenbank, vor der ersten Anfrage und ohne Ausweg: entschluessele()
 * liest nur v2, und eine Gutscheinzeile ohne nummer_suche entginge der
 * Doppelprüfung. @returns null, wenn die Marke schon steht */
export async function altbestandAufruesten(): Promise<{ umgeschluesselt: number; abdruecke: number } | null> {
  if (await auftraegeBereich().laufzustand.liesZustand(ALTBESTAND_MARKE)) return null;
  const n =
    (await gutscheineBereich().gutscheine.nummernNachverschluesseln()) +
    (await gutscheineBereich().gutscheine.kopienVerschluesseln()) +
    (await verschluesseleAltbestand()) +
    (await antwortenUmschluesseln()) +
    (await verschluesseleGutscheinAltbestand());
  if (n) console.log(`[geheimnis] ${n} Geheimnisse auf v2 (mit Kontext) umgeschlüsselt`);
  const alt = await alteAbdrueckeLoeschen();
  if (alt) console.log(`[idempotenz] ${alt} Einträge mit altem Fingerabdruck (SHA-256 des Rumpfs) gelöscht`);
  await auftraegeBereich().laufzustand.setzeZustand(ALTBESTAND_MARKE, new Date().toISOString());
  return { umgeschluesselt: n, abdruecke: alt };
}

/** Steht der vorige Schlüssel bereit (DATA_KEY_ALT_FILE), schreibt jeder Start
 * alles, was nur er öffnet, mit dem neuen neu. Gleichzeitig laufende Prozesse
 * stören sich nicht: Jede Zeile wird nur ersetzt, wenn sie unverändert ist. */
export async function schluesselWechsel(): Promise<number | null> {
  if (!altSchluessel()) return null;
  const n =
    (await verschluesseleAltbestand({ alle: true })) +
    (await gutscheineBereich().gutscheine.gutscheineNeuVerschluesseln()) +
    (await gutscheineBereich().gutscheine.kopienVerschluesseln(true)) +
    (await verschluesseleGutscheinAltbestand({ alle: true }));
  // Antworten und Abdrücke gelten 24 Stunden und hängen am Schlüssel; neu rechnen lohnt nicht.
  await alleVergessen();
  console.log(
    `[geheimnis] Schlüsselwechsel: ${n} Werte mit dem neuen Schlüssel geschrieben. Der vorige ` +
      '(DATA_KEY_ALT_FILE) kann weg, sobald jedes Konto mit zweitem Faktor neue Wiederherstellungscodes hat (UPGRADE.md).',
  );
  return n;
}

/**
 * Schema und Migrationen, danach die Bild-Hilfsdienste — in JEDEM
 * Arbeitsprozess, weil sie prozess-lokal sind (Bestand im Speicher, Takt des
 * Puffers). Hier und nicht in db/: Die Datenbankschicht kennt keine Jobs.
 */
export async function bereiteDatenbankVor(db: Db): Promise<void> {
  // Beim Start statt bei der ersten Verschlüsselung: Ein falscher oder alter
  // Ort des Schlüssels soll im Startprotokoll stehen.
  datenSchluessel();
  await warneBeiSuperuser(db);
  await db.initSchemaOnce();
  // Sonst sähen Aufträge, Verwaltung und Anmeldung still keine Zeile der Kontotabellen.
  if (!(await db.systemrahmenWirkt()))
    throw new Error(
      'Die Rolle für Arbeit über Kontogrenzen unterliegt dem Zeilenschutz: PGSYSTEM_USER und ' +
        'PGSYSTEM_PASSWORD(_FILE) auf die Systemrolle setzen (postgres/app-rolle.sh, UPGRADE.md#systemrolle).',
    );
  await altbestandAufruesten();
  await schluesselWechsel();
  await initImageMisses().catch(logAndContinue('db:image_misses'));
  await initImageQueue().catch(logAndContinue('db:image_wanted'));
}
