/**
 * Was der Job-Prozess bei jedem Start einmal nachholt — je Schritt ein
 * Auftrag 'nachlauf' (startup/jobsProzess.ts), damit ein Fehler wiederholt
 * wird und in der Verwaltung zu sehen ist.
 * Ausführlich: docs/begruendungen/jobs/startNachlaeufe.ts.md#abschnitt
 */
import * as db from '../db/database';
import { downloadSetImage } from '../utils/setImages';
import { generateThumb } from '../utils/thumbs';
import { anleitungEinreihen } from '../utils/anleitungsAuftrag';
import { verschluesseleAltbestand } from '../utils/geheimnisAltbestand';
import { verschluesseleGutscheinAltbestand } from '../utils/gutscheinDateien';
import * as catalogSync from './catalogSync';
import * as purchasePriceBackfill from './purchasePriceBackfill';
import { APP_ROOT, IMAGES_DIR } from '../utils/appPaths';
import { fehlertext, logAndContinue, meldeUndLiefere } from '../utils/httpError';

/**
 * Sets ohne Anleitung einreihen — nicht, wenn ein Abruf noch wartet oder in
 * den letzten Tagen schon ohne Ergebnis lief (erledigte Aufträge bleiben
 * sieben Tage, gescheiterte dreissig stehen; danach wird es wieder versucht).
 */
async function anleitungenNachtragen(): Promise<void> {
  const missing = await db.all(
    `SELECT DISTINCT s.set_number FROM sets s
     WHERE NOT EXISTS (SELECT 1 FROM shared_instructions si WHERE si.set_number = s.set_number)
       AND NOT EXISTS (SELECT 1 FROM auftraege a WHERE a.schluessel = 'anleitung:' || s.set_number
                         AND a.status IN ('offen', 'laeuft', 'erledigt'))`);
  if (missing.length) console.log(`[instr-queue] Enqueueing ${missing.length} sets missing instructions`);
  for (const { set_number } of missing) await anleitungEinreihen(set_number);
}

/** Geheimnisse aus der Zeit vor der Verschlüsselung (utils/geheimnis.ts). */
async function geheimnisseVerschluesseln(): Promise<void> {
  const n = await verschluesseleAltbestand() + await verschluesseleGutscheinAltbestand();
  if (n) console.log(`[geheimnis] ${n} Geheimnisse nachträglich verschlüsselt`);
}

/** Die Schritte und ihr Abstand zum Start in Sekunden: Beim Start hat der Katalog Vorrang. */
export const NACHLAEUFE = {
  geheimnisse:  { nachSekunden: 0,  lauf: geheimnisseVerschluesseln },
  vorschauen:   { nachSekunden: 0,  lauf: () => vorschaubilderNachtragen() },
  katalog:      { nachSekunden: 10, lauf: () => catalogSync.syncAllMissing() },
  anleitungen:  { nachSekunden: 15, lauf: anleitungenNachtragen },
  set_bilder:   { nachSekunden: 45, lauf: () => setBilderNachladen() },
  kaufpreise:   { nachSekunden: 45, lauf: () => purchasePriceBackfill.run() },
} as const;
export type Nachlauf = keyof typeof NACHLAEUFE;

/** Der Bearbeiter des Auftrags 'nachlauf'. */
export async function nachlauf(n: Record<string, unknown>): Promise<void> {
  const schritt = String(n.schritt);
  if (!Object.hasOwn(NACHLAEUFE, schritt)) throw new Error(`unbekannter Nachlauf ${schritt}`);
  await NACHLAEUFE[schritt as Nachlauf].lauf();
}

/** Fehlende Set-Bilder vom CDN holen. */
async function setBilderNachladen(): Promise<void> {
  try {
    // Der KATALOG: Bilder haengen an der Setnummer, nicht am Konto. Hier
    // stand `FROM sets` mit DISTINCT — das brauchte es nur, weil dieselbe
    // Setnummer je Konto einmal darin stand. Im Katalog ist sie es einmal.
    const missing = await db.all(
      `SELECT set_number, image_url FROM set_catalog
       WHERE image_local IS NULL AND image_url IS NOT NULL LIMIT 500`
    ).catch(meldeUndLiefere('nachlauf:missing', []));
    if (!missing.length) return;
    console.log(`[set-img-bg] Downloading ${missing.length} missing set images…`);
    for (const { set_number, image_url } of missing) {
      const local = await downloadSetImage(image_url, set_number).catch(meldeUndLiefere('nachlauf:downloadSetImage', null));
      if (local) {
        // EINE Anweisung. Das UPDATE auf `sets`, das hier daneben stand, ist
        // mit Migration 0033 weggefallen — und mit ihm der stille Fang am
        // Katalog-Schreiber, der die wichtigere der beiden Haelften war.
        await db.run(`UPDATE set_catalog SET image_local=$1 WHERE set_number=$2 AND image_local IS NULL`, [local, set_number])
          .catch(logAndContinue(`bilder:set ${set_number}`));
        generateThumb(local).catch(logAndContinue('nachlauf:generateThumb'));
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
    const sets  = await db.all("SELECT image_local FROM set_catalog WHERE image_local IS NOT NULL");
    // Aus part_color_catalog statt aus parts (Migration 0034): dasselbe
    // Bild stand dort einmal je Konto, die Schleife lief es mehrfach ab.
    const parts = await db.all("SELECT image_local FROM part_color_catalog WHERE image_local IS NOT NULL");
    const figs  = await db.all("SELECT image_local FROM minifigs_catalog WHERE image_local IS NOT NULL");
    const paths = [...sets, ...parts, ...figs].map((r: any) => r.image_local).filter(Boolean);
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
      await generateThumb(localPath).catch(logAndContinue('nachlauf:generateThumb'));
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
