import * as db from '../db/database';
import { getSetMinifigs } from '../clients/rebrickable';
import { logAndContinue } from '../src/infra/httpError';
import { mitVersion } from './setNummer';
import { merkeFiguren, merkeSetFiguren } from './katalogPflege';

/**
 * Minifiguren eines Sets aus dem Katalog übernehmen — reine Katalogarbeit
 * ohne Route, damit utils/setService.ts keinen Router importieren muss.
 */

/**
 * Die Figuren eines Sets aus dem gemeinsamen Katalog.
 * Ausführlich: docs/begruendungen/utils/minifigsImport.ts.md#figurenauskatalog
 */
export async function figurenAusKatalog(setNumber: string) {
  return db.all(
    `SELECT fig_number, fig_name, quantity, image_url
       FROM set_minifigs_catalog
      WHERE set_number = $1`,
    [mitVersion(setNumber)]).catch((e: unknown) => { logAndContinue('minifiguren:katalog lesen')(e); return []; });
}

type Figur = { fig_number: string; fig_name: string; quantity: number; image_url: string | null };

/**
 * Die Figuren eines Sets in den Bestand: Vorhandene Zeilen bleiben stehen
 * (mit Lagerort), neue kommen dazu, weggefallene gehen — alles in einer
 * Transaktion. Steht eine Figur mehrfach in der Liste, ist sie eine Zeile mit
 * der Summe als Katalogmenge (Bestandszeilen haben keine Menge, Migration 0038).
 * @returns die Zahl der Figuren; wirft bei Fehlern (der Auftrag wiederholt dann)
 */
export async function importiereFiguren(setNumber: string, userId: number): Promise<number> {
  const katalog = await figurenAusKatalog(mitVersion(setNumber));
  const roh: Figur[] = katalog.length
    ? katalog.map(f => ({ fig_number: f.fig_number, fig_name: f.fig_name || f.fig_number,
                          quantity: f.quantity || 1, image_url: f.image_url || null }))
    : await getSetMinifigs(setNumber);
  const jeNummer = new Map<string, Figur>();
  for (const f of roh) {
    if (!f.fig_number) continue;
    const alt = jeNummer.get(f.fig_number);
    jeNummer.set(f.fig_number, alt ? { ...alt, quantity: alt.quantity + (f.quantity || 1) } : { ...f, quantity: f.quantity || 1 });
  }
  const figs = [...jeNummer.values()];
  if (!figs.length) return 0;
  // Aus dem Katalog gelesen, sind die Mengen schon zusammengefasst und die
  // Zeilen da; neu geschrieben wird nur, was von der Quelle kam.
  const ausQuelle = !katalog.length;
  const nummern = figs.map(f => f.fig_number);

  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO minifigs (user_id, set_number, fig_number, source)
       SELECT $1, $2, f, 'set' FROM unnest($3::text[]) AS f ON CONFLICT DO NOTHING`,
      [userId, setNumber, nummern]);
    await tx.run(
      `DELETE FROM minifigs WHERE user_id=$1 AND set_number=$2 AND source='set' AND NOT (fig_number = ANY($3::text[]))`,
      [userId, setNumber, nummern]);
    await merkeFiguren(figs.map(f => ({ figNumber: f.fig_number, figName: f.fig_name, imageUrl: f.image_url })), tx);
    if (ausQuelle) await merkeSetFiguren(setNumber, figs.map(f => ({ figNumber: f.fig_number, quantity: f.quantity })), tx);
  });
  console.log(`[minifigs] ${setNumber}: ${figs.length} importiert`);
  return figs.length;
}
