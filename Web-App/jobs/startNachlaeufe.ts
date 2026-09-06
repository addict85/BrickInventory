/**
 * Die drei Nachläufe, die beim Start einmalig aufräumen.
 *
 * ── Warum sie hier stehen und nicht mehr in startup/backgroundJobs.ts ───────
 *
 * Die Startstaffel gibt es, damit die Hintergrundläufe BEIEINANDER stehen —
 * so steht es in ihrem eigenen Kopfkommentar. Drei von ihnen standen aber
 * nicht als Aufruf da, sondern als anonymer Block im `setTimeout`:
 *
 *     setTimeout(async () => { … 16 Zeilen … }, 15000);
 *
 * Zwei Folgen hatte das. Erstens liest sich die Staffel dadurch als Mischung
 * aus Fahrplan und Arbeit, und die Blöcke wachsen dort, wo man den Überblick
 * sucht. Zweitens — und das ist der Anlass — lassen sie sich NICHT ABFANGEN:
 * test/background-jobs-start.test.js hängt sich an die Modulauflösung, um zu
 * prüfen, dass jeder Lauf wirklich angestossen wird, ohne ihn auszuführen. Was
 * kein Modul ist, läuft dort echt mit — gegen die Testdatenbank, und nach dem
 * Testende gegen einen bereits geschlossenen Verbindungspool:
 *
 *     Thumb gen error: Cannot use a pool after calling end on the pool
 *
 * Als Modulfunktionen sind sie abfangbar wie die anderen auch. Die Rümpfe sind
 * WORTGLEICH übernommen; es wurde nichts umgestellt und nichts weggelassen.
 */
import * as db from '../db/database';
import { downloadSetImage } from '../utils/setImages';
import { generateThumb } from '../utils/thumbs';
import { enqueue, processNext } from './instructionQueue';
import { APP_ROOT, IMAGES_DIR } from '../utils/appPaths';
import { fehlertext, logAndContinue } from '../utils/httpError';

/** Sets ohne Anleitung in die Warteschlange stellen. */
async function anleitungenNachtragen(): Promise<void> {
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
  } catch (e) { console.error('[instr-queue startup]', fehlertext(e)); }
}

/** Fehlende Set-Bilder vom CDN holen. */
async function setBilderNachladen(): Promise<void> {
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
        await db.run(`UPDATE sets SET image_local=$1 WHERE set_number=$2 AND image_local IS NULL`, [local, set_number])
          .catch(logAndContinue(`bilder:set ${set_number}`));
        await db.run(`UPDATE set_catalog SET image_local=$1 WHERE set_number=$2 AND image_local IS NULL`, [local, set_number]).catch(() => {});
        generateThumb(local).catch(() => {});
      }
      await new Promise(r => setTimeout(r, 300));
    }
    console.log(`[set-img-bg] Done`);
  } catch (e) { console.error('[set-img-bg]', fehlertext(e)); }
}

/** Fehlende Vorschaubilder erzeugen. */
async function vorschaubilderNachtragen(): Promise<void> {
  try {
    const fs   = require('fs');
    const path = require('path');
    const sets  = await db.all("SELECT image_local FROM sets WHERE image_local IS NOT NULL");
    const parts = await db.all("SELECT image_local FROM parts WHERE image_local IS NOT NULL");
    const paths = [...sets, ...parts].map((r: any) => r.image_local).filter(Boolean);
    let generated = 0;
    // Async statt existsSync: die Schleife läuft über ALLE Bilder von Sets
    // und Teilen und lief direkt nach app.listen() — bei ein paar tausend
    // Einträgen hat sie den Event-Loop sekundenlang blockiert, auch für
    // die übersprungenen. fs.promises.access() gibt zwischen jeder Prüfung
    // den Loop frei.
    const exists = (fp: string) => fs.promises.access(fp).then(() => true, () => false);
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
  } catch (e) { console.error('Thumb gen error:', fehlertext(e)); }
}

// Abschliessender Export-Block wie in jedem anderen Job-Modul: In .ts erzeugt
// module.exports keine benannten Exporte, und die Aufrufer importieren per
// Namen (test/jobs-typescript.test.js wacht darüber).
export { anleitungenNachtragen, setBilderNachladen, vorschaubilderNachtragen };
