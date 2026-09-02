// ── Echte Importe statt später require() (Nachtrag 139) ─────────────────────
//
// Beim Auslagern aus server.ts wanderten zehn `require('./jobs/...')`
// WORTGLEICH mit. Aus startup/ gesehen gibt es './jobs' nicht — jeder dieser
// Aufrufe warf, und weil sie in `setTimeout`/`.catch(() => {})` stecken, blieb
// es still: KEIN Job lief mehr an, ohne eine einzige Fehlermeldung.
import { start as starteJobPreise } from '../jobs/priceJob';
import { start as starteJobBilder } from '../jobs/imageQueue';
import { processRetryQueue } from '../jobs/bricksetRetry';
import * as purchasePriceBackfill from '../jobs/purchasePriceBackfill';
import { start as starteJobAnleitungen } from '../jobs/instructionQueue';
import * as catalogSync from '../jobs/catalogSync';
import * as nachlaeufe from '../jobs/startNachlaeufe';
import { purgeAltePreise } from '../utils/priceHistory';
import { purgeExpiredTokens } from '../utils/auth';
import { startImgCacheCleanup } from '../routes/imgProxy';
import { startPdfJobCleanup } from '../routes/api_v1/pdf';

/**
 * Was nach dem Start im Hintergrund anläuft — ausschliesslich im Primär-Worker.
 *
 * ── Warum eigene Datei (Nachtrag 134) ───────────────────────────────────────
 *
 * server.ts hatte fünf Aufgaben in 1174 Zeilen: Log-Abfangen nach PostgreSQL,
 * Cluster-Aufbau, Sicherheits-Header, Auslieferung statischer Dateien — und
 * diese Staffel aus zehn Hintergrundläufen.
 *
 * Die STAFFELUNG ist der eigentliche Grund für den Umzug. Sie ist bewusst
 * gewählt (Katalogabgleich nach 10 s, Anleitungen nach 15, Brickset-Wiederholung
 * nach 20, Bilder nach 45, Kaufpreis-Nachtrag nach 45), aber verstreut über
 * hundertdreissig Zeilen liess sie sich nur rekonstruieren, indem man jedes
 * `setTimeout` einzeln suchte. Hier stehen sie beieinander.
 *
 * ALLES HIER LÄUFT NUR IM PRIMÄR-WORKER. Der Aufrufer prüft das; in dieser
 * Datei wird es nicht noch einmal geprüft, damit es genau eine Stelle gibt, an
 * der die Bedingung steht.
 */
export async function starteHintergrundlaeufe(): Promise<void> {
  // HINWEIS: Hier standen zwei einmalige Umzüge — migrateImagesToData()
  // (public/images/ → data/images/) und migrateLayout() (data/part_images/
  // → data/images/{parts,minifigs}/, data/instructions/shared/ →
  // data/instructions/). Beide sind entfernt, nachdem der Umzug auf der
  // Installation durchgelaufen war.
  //
  // Sie liefen bei JEDEM Start und durchsuchten dabei Verzeichnisse, die es
  // längst nicht mehr gibt — Aufwand ohne Gegenwert, und zwei Dateien, die
  // beim Lesen des Startpfads erklärt werden mussten. Die zugehörige
  // Schema-Migration (db/migrations/0002) ist ebenfalls entfallen; der
  // Eintrag in schema_migrations bleibt bestehen und stört nicht.

  // Abgelaufene API-Tokens aufräumen.
  //
  // Jeder Login legt eine webapp-session-Zeile mit sieben Tagen Laufzeit an.
  // Entfernt hat sie bisher niemand — auch nach Ablauf nicht, weil
  // validateToken() abgelaufene Zeilen nur ignoriert statt sie zu löschen.
  // Die Tabelle wuchs damit monoton mit der Zahl der Anmeldungen.
  {
    const purge = async () => {
      const n = await purgeExpiredTokens().catch(() => 0);
      if (n) console.log(`[tokens] ${n} abgelaufene Token entfernt`);
    };
    purge();
    setInterval(purge, 60 * 60 * 1000).unref();
  }

  // Bild-Cache aufräumen — hier statt in registerImgProxy(), weil das in
  // JEDEM Worker läuft: Vorher legte jeder Prozess sein eigenes tägliches
  // Intervall an und ging das ganze Cache-Verzeichnis durch. Siehe
  // startImgCacheCleanup() in routes/imgProxy.ts.
  startImgCacheCleanup();

  // PDF-Aufträge aufräumen — aus demselben Grund hier: Vorher hing das
  // Aufräumen am POST für ein neues PDF. Wer einen Export abbrach und nie
  // wieder einen startete, liess PDF und Auftragsdatei dauerhaft liegen.
  startPdfJobCleanup();

  // Preisverlauf beschneiden. Die Tabelle wuchs unbegrenzt (rund 292 000
  // Zeilen im Jahr bei 800 Sets), und die Portfolio-Kurve liest für „Max"
  // jede Zeile. Steuerbar über PRICE_HISTORY_KEEP_DAYS (Vorgabe 1095, 0 = aus).
  {
    const beschneiden = async () => {
      const n = await purgeAltePreise().catch(() => 0);
      if (n) console.log(`[price-history] ${n} alte Preis-Zeilen entfernt`);
    };
    beschneiden();
    setInterval(beschneiden, 24 * 60 * 60 * 1000).unref();
  }

  // PriceJob — primary worker only
  starteJobPreise();

  // One-time migration: backfill purchase_price for existing sets/minifigs/parts
  // that don't have one yet, using the current market price (see feature: Kaufpreis).
  setTimeout(() => purchasePriceBackfill.run().catch(() => {}), 45000);

  starteJobAnleitungen();

  // Bilder, die über den Proxy angefragt wurden, im Hintergrund lokal ablegen
  // und verkleinern (Nachtrag 102). Die Anfrage selbst rechnet nichts mehr.
  starteJobBilder();

  setTimeout(() => catalogSync.syncAllMissing().catch(() => {}), 10000);

  // Sets ohne Anleitung in die Warteschlange (jobs/startNachlaeufe.ts).
  setTimeout(() => nachlaeufe.anleitungenNachtragen().catch(() => {}), 15000);
  setTimeout(() => processRetryQueue().catch(() => {}), 20000);

  // Fehlende Set-Bilder vom CDN (jobs/startNachlaeufe.ts).
  setTimeout(() => nachlaeufe.setBilderNachladen().catch(() => {}), 45_000);

  // Fehlende Vorschaubilder (jobs/startNachlaeufe.ts).
  setImmediate(() => { nachlaeufe.vorschaubilderNachtragen().catch(() => {}); });
}
