import * as db from '../db/database';
import { downloadSetImage } from '../utils/setImages';
import { generateThumb } from '../routes/thumbs';
// ── Echte Importe statt später require() (Nachtrag 139) ─────────────────────
//
// Beim Auslagern aus server.ts wanderten zehn `require('./jobs/...')`
// WORTGLEICH mit. Aus startup/ gesehen gibt es './jobs' nicht — jeder dieser
// Aufrufe warf, und weil sie in `setTimeout`/`.catch(() => {})` stecken, blieb
// es still: KEIN Job lief mehr an, ohne eine einzige Fehlermeldung.
import { enqueue, processNext, start as starteJobAnleitungen } from '../jobs/instructionQueue';
import { start as starteJobPreise } from '../jobs/priceJob';
import { start as starteJobBilder } from '../jobs/imageQueue';
import { processRetryQueue } from '../jobs/bricksetRetry';
import * as purchasePriceBackfill from '../jobs/purchasePriceBackfill';
import * as catalogSync from '../jobs/catalogSync';
import { purgeAltePreise } from '../utils/priceHistory';
import { purgeExpiredTokens } from '../utils/auth';
import { APP_ROOT, IMAGES_DIR } from '../utils/appPaths';
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

  // Enqueue all sets that have no instructions yet
  setTimeout(async () => {
    try {
      const missing = await db.all(
        `SELECT DISTINCT s.set_number FROM sets s
         WHERE NOT EXISTS (
           SELECT 1 FROM shared_instructions si WHERE si.set_number = s.set_number
         ) AND NOT EXISTS (
           SELECT 1 FROM instruction_queue iq WHERE iq.set_number = s.set_number AND iq.status IN ('pending','done')
         )`
      ).catch(() => []);
      if (missing.length) {
        console.log(`[instr-queue] Enqueueing ${missing.length} sets missing instructions`);
        for (const { set_number } of missing) await enqueue(set_number).catch(() => {});
        processNext();
      }
    } catch(e) { console.error('[instr-queue startup]', e.message); }
  }, 15000);
  setTimeout(() => processRetryQueue().catch(() => {}), 20000);

  // Background: download missing set images
  setTimeout(async () => {
    try {
      const missing = await db.all(
        `SELECT DISTINCT set_number, image_url FROM sets
         WHERE image_local IS NULL AND image_url IS NOT NULL LIMIT 500`
      ).catch(() => []);
      if (!missing.length) return;
      console.log(`[set-img-bg] Downloading ${missing.length} missing set images…`);
      for (const { set_number, image_url } of missing) {
        const local = await downloadSetImage(image_url, set_number).catch(() => null);
        if (local) {
          await db.run(`UPDATE sets SET image_local=$1 WHERE set_number=$2 AND image_local IS NULL`, [local, set_number]).catch(() => {});
          await db.run(`UPDATE set_catalog SET image_local=$1 WHERE set_number=$2 AND image_local IS NULL`, [local, set_number]).catch(() => {});
          generateThumb(local).catch(() => {});
        }
        await new Promise(r => setTimeout(r, 300));
      }
      console.log(`[set-img-bg] Done`);
    } catch(e) { console.error('[set-img-bg]', e.message); }
  }, 45_000);

  // Generate missing thumbnails
  setImmediate(async () => {
    try {
      const fs   = require('fs');
      const path = require('path');
      const sets  = await db.all("SELECT image_local FROM sets WHERE image_local IS NOT NULL");
      const parts = await db.all("SELECT image_local FROM parts WHERE image_local IS NOT NULL");
      const paths = [...sets, ...parts].map(r => r.image_local).filter(Boolean);
      let generated = 0;
      // Async statt existsSync: die Schleife läuft über ALLE Bilder von Sets
      // und Teilen und lief direkt nach app.listen() — bei ein paar tausend
      // Einträgen hat sie den Event-Loop sekundenlang blockiert, auch für
      // die übersprungenen. fs.promises.access() gibt zwischen jeder Prüfung
      // den Loop frei.
      const exists = (fp) => fs.promises.access(fp).then(() => true, () => false);
      for (const localPath of paths) {
        let fsPath;
        if      (localPath.startsWith('/images/')) fsPath = path.join(IMAGES_DIR, localPath.slice('/images/'.length));
        else if (localPath.startsWith('/data/'))   fsPath = path.join(APP_ROOT, localPath.slice(1));
        else continue;
        const thumbPath = fsPath.replace(path.extname(fsPath), '_thumb.jpg');
        if (await exists(thumbPath) || !(await exists(fsPath))) continue;
        await generateThumb(localPath).catch(() => {});
        generated++;
        if (generated % 10 === 0) await new Promise(r => setTimeout(r, 10));
      }
      if (generated > 0) console.log(`  🖼️  ${generated} Thumbnails generiert`);
    } catch(e) { console.error('Thumb gen error:', e.message); }
  });
}
