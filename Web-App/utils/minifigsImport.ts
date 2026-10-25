import * as db from '../db/database';
import { getSetMinifigs } from '../clients/rebrickable';
import { fehlertext, logAndContinue } from '../utils/httpError';
import { mitVersion, beideSchreibweisen } from './setNummer';
import { merkeFigur } from './katalogPflege';

/**
 * Minifiguren eines Sets aus dem Katalog übernehmen.
 *
 * Wie utils/partsImport.ts: reine Katalogarbeit ohne Route, aus routes/minifigs.ts
 * herausgelöst, damit utils/setService.ts (addSet) keinen Router importieren
 * muss (Nachtrag 131).
 */

// ── Import minifigs from a set (called during set import) ─────────────────────
/**
 * Die Figuren eines Sets aus dem gemeinsamen Katalog.
 * Ausführlich: docs/begruendungen/utils/minifigsImport.ts.md#figurenauskatalog
 */
export async function figurenAusKatalog(setNumber: string) {
  return db.all(
    `SELECT fig_number, fig_name, quantity, image_url
       FROM set_minifigs_catalog
      WHERE set_number=$1 OR set_number=$2`,
    beideSchreibweisen(setNumber)).catch(() => []);
}

async function importMinifigsForSet(setNumber: string, userId: number) {
  try {
    const n = mitVersion(setNumber);
    const catalogFigs = await figurenAusKatalog(n);
    
    let figs = catalogFigs.map(f => ({
      fig_number: f.fig_number,
      fig_name:   f.fig_name || f.fig_number,
      quantity:   f.quantity || 1,
      image_url:  f.image_url || null
    }));

    // Only call API if catalog is empty
    if (!figs.length) {
      figs = await getSetMinifigs(setNumber);
    }
    if (!figs.length) return 0;

    // Delete existing set minifigs before re-import
    await db.run("DELETE FROM minifigs WHERE user_id=$1 AND set_number=$2 AND source='set'",
      [userId, setNumber]);

    for (const fig of figs) {
      // Nur noch der BESTAND: wer welche Figur aus welchem Set hat. Name und
      // Bild schreibt der Katalog-Upsert darunter EINMAL, statt je Konto neu
      // (Migration 0034).
      // Ohne Menge: Die Stückzahl einer Set-Figur ist seit Migration 0038 die
      // Katalogzahl — und die schreibt der Upsert auf
      // set_minifigs_catalog gleich darunter, aus derselben fig.quantity.
      // Vorher stand derselbe Wert an BEIDEN Stellen, in derselben Schleife;
      // genau das war die Abschrift.
      await db.run(
        "INSERT INTO minifigs (user_id, set_number, fig_number, source) VALUES ($1,$2,$3,'set') ON CONFLICT DO NOTHING",
        [userId, setNumber, fig.fig_number]);
      // Figurenkatalog — derselbe Schreiber wie beim Anlegen von Hand und
      // beim Verschieben eines Sets (utils/katalogPflege.ts).
      await merkeFigur(fig.fig_number, fig.fig_name, fig.image_url)
        .catch(logAndContinue('minifiguren:katalog'));
      // Also upsert into shared catalog
      await db.run(
        `INSERT INTO set_minifigs_catalog (set_number, fig_number, fig_name, quantity, image_url)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (set_number, fig_number) DO UPDATE SET
           fig_name=EXCLUDED.fig_name, quantity=EXCLUDED.quantity,
           image_url=EXCLUDED.image_url, updated_at=NOW()`,
        [setNumber, fig.fig_number, fig.fig_name, fig.quantity, fig.image_url]
      ).catch(()=>{});
    }
    console.log(`[minifigs] ${setNumber}: ${figs.length} importiert`);
    return figs.length;
  } catch (e) {
    console.warn(`[minifigs] Import fehlgeschlagen für ${setNumber}: ${fehlertext(e)}`);
    return 0;
  }
}

export { importMinifigsForSet };
