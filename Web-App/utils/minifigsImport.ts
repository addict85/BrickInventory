import * as db from '../db/database';
import { getSetMinifigs } from '../clients/rebrickable';
import { fehlertext } from '../utils/httpError';
import { mitVersion, beideSchreibweisen } from './setNummer';

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
 *
 * Stand zweimal da — hier und in routes/api_v1/sets.ts. Nicht wortgleich: Der
 * zweite Kandidat war hier `setNumber` (die ROHE Eingabe) statt der blanken
 * Nummer. Fuer eine Eingabe MIT Versionsanhang ergab das zweimal denselben
 * Wert, und die blanke Schreibweise wurde nie geprueft — dieselbe entartete
 * Paarbildung wie schon in utils/handlers/parts.ts und jobs/catalogSync.ts.
 * beideSchreibweisen() liefert immer zwei verschiedene.
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
      await db.run(
        "INSERT INTO minifigs (user_id, set_number, fig_number, fig_name, quantity, image_url, source) VALUES ($1,$2,$3,$4,$5,$6,'set') ON CONFLICT DO NOTHING",
        [userId, setNumber, fig.fig_number, fig.fig_name, fig.quantity, fig.image_url]);
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
