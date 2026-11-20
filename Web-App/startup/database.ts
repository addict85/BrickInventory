import type { Db } from '../db/database';
import { altKey, datenSchluessel } from '../src/infra/secret';
import { konfig } from '../src/infra/config';
import type { Dienste } from './wiring';

/** Ein Superuser erreicht COPY … PROGRAM und jede Datenbank des Servers: In
 * Betrieb (auch ohne NODE_ENV) ein Startverbot, ausser DB_SUPERUSER_ERLAUBT=1 (UPGRADE.md). */
export async function warnAtSuperuser(db: Db): Promise<boolean> {
  if (!konfig().operation || !(await db.asSuperuserConnected())) return false;
  if (!konfig().dbSuperuserAllowed) {
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
export const LEGACY_STOCK_BRAND = 'altbestand_v2';

/** Einmal je Datenbank, vor der ersten Anfrage und ohne Ausweg: entschluessele()
 * liest nur v2, und eine Gutscheinzeile ohne nummer_suche entginge der
 * Doppelprüfung. @returns null, wenn die Marke schon steht */
export async function legacyStockUpgrade(d: Dienste): Promise<{ umgeschluesselt: number; prints: number } | null> {
  if (await d.jobQueue.liesZustand(LEGACY_STOCK_BRAND)) return null;
  const n =
    (await d.vouchers.reencryptNumbers()) +
    (await d.vouchers.reencryptCopies()) +
    (await d.factors.encryptLegacySecrets()) +
    (await d.idempotency.reencryptResponses()) +
    (await d.vouchers.encryptLegacyFiles());
  if (n) console.log(`[geheimnis] ${n} Geheimnisse auf v2 (mit Kontext) umgeschlüsselt`);
  const alt = await d.idempotency.deleteOldFingerprints();
  if (alt) console.log(`[idempotenz] ${alt} Einträge mit altem Fingerabdruck (SHA-256 des Rumpfs) gelöscht`);
  await d.jobQueue.setzeZustand(LEGACY_STOCK_BRAND, new Date().toISOString());
  return { umgeschluesselt: n, prints: alt };
}

/** Steht der vorige Schlüssel bereit (DATA_KEY_ALT_FILE), schreibt jeder Start
 * alles, was nur er öffnet, mit dem neuen neu. Gleichzeitig laufende Prozesse
 * stören sich nicht: Jede Zeile wird nur ersetzt, wenn sie unverändert ist. */
export async function keySwitch(d: Dienste): Promise<number | null> {
  if (!altKey()) return null;
  const n =
    (await d.factors.encryptLegacySecrets({ alle: true })) +
    (await d.vouchers.reencryptAllVouchers()) +
    (await d.vouchers.reencryptCopies(true)) +
    (await d.vouchers.encryptLegacyFiles({ alle: true }));
  // Antworten und Abdrücke gelten 24 Stunden und hängen am Schlüssel; neu rechnen lohnt nicht.
  await d.idempotency.forgetAll();
  console.log(
    `[geheimnis] Schlüsselwechsel: ${n} Werte mit dem neuen Schlüssel geschrieben. Der vorige ` +
      '(DATA_KEY_ALT_FILE) kann weg, sobald jedes Konto mit zweitem Faktor neue Wiederherstellungscodes hat (UPGRADE.md).',
  );
  return n;
}

/** Der Web-Prozess allein darf Gutscheine nicht anfassen (Web-Systemrolle): Er wartet,
 * bis der Dienst jobs den Altbestand umgestellt hat, statt alte Zeilen zu lesen. */
export async function waitOnLegacyStock(d: Dienste, takt = 2000): Promise<void> {
  for (let n = 0; !(await d.jobQueue.liesZustand(LEGACY_STOCK_BRAND)); n++) {
    if (n % 15 === 0) console.log('[geheimnis] warte, bis der Dienst jobs die Geheimnisse auf v2 umgestellt hat');
    await new Promise(r => setTimeout(r, takt));
  }
}

/**
 * Schema und Migrationen, danach die Bild-Hilfsdienste — in JEDEM
 * Arbeitsprozess, weil sie prozess-lokal sind (Bestand im Speicher, Takt des
 * Puffers). Hier und nicht in db/: Die Datenbankschicht kennt keine Jobs.
 * Umschlüsseln nur mit `jobs`: Allein dessen Systemrolle erreicht die Gutscheine.
 */
export async function prepareDatabaseBefore(db: Db, d: Dienste, o: { jobs?: boolean } = {}): Promise<void> {
  // Beim Start statt bei der ersten Verschlüsselung: Ein falscher oder alter
  // Ort des Schlüssels soll im Startprotokoll stehen.
  datenSchluessel();
  await warnAtSuperuser(db);
  await db.initSchemaOnce();
  // Sonst sähen Aufträge, Verwaltung und Anmeldung still keine Zeile der Kontotabellen.
  if (!(await db.systemrahmenActs()))
    throw new Error(
      'Die Rolle für Arbeit über Kontogrenzen unterliegt dem Zeilenschutz: PGSYSTEM_USER und ' +
        'PGSYSTEM_PASSWORD(_FILE) auf die Systemrolle setzen (postgres/app-rolle.sh, UPGRADE.md#systemrolle).',
    );
  if (o.jobs === false) await waitOnLegacyStock(d);
  else {
    await legacyStockUpgrade(d);
    await keySwitch(d);
  }
  await d.images.startNone();
  await d.images.startImageDemand();
}
