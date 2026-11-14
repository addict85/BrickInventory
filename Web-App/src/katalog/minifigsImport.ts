import { logAndContinue } from '../infra/fehler';
import { mitVersion } from '../infra/setNummer';
import { merkeFiguren, merkeSetFiguren } from './katalogPflege';
import * as inhalt from './repository/setInhalt';
import type { KatalogKontext } from './kontext';

// Mit und ohne Versionsanhang fragen, nicht zweimal dieselbe Schreibweise.
export async function figurenAusKatalog(k: KatalogKontext, setNumber: string) {
  return k.setInhalt.figurenDesSetkatalogs(mitVersion(setNumber)).catch((e: unknown) => {
    logAndContinue('minifiguren:katalog lesen')(e);
    return [];
  });
}

type Figur = { fig_number: string; fig_name: string; quantity: number; image_url: string | null };

/** In einer Transaktion; vorhandene Zeilen behalten den Lagerort. Eine Figur,
 * die mehrfach vorkommt, ist eine Zeile mit der Summe als Katalogmenge.
 * @returns die Zahl der Figuren; wirft bei Fehlern (der Auftrag wiederholt dann) */
export async function importiereFiguren(k: KatalogKontext, setNumber: string, userId: number): Promise<number> {
  const ausKatalog = await figurenAusKatalog(k, mitVersion(setNumber));
  const roh: Figur[] = ausKatalog.length
    ? ausKatalog.map(f => ({
        fig_number: f.fig_number,
        fig_name: f.fig_name || f.fig_number,
        quantity: f.quantity || 1,
        image_url: f.image_url || null,
      }))
    : await k.fremdquellen.quellen.getSetMinifigs(setNumber);
  const jeNummer = new Map<string, Figur>();
  for (const f of roh) {
    if (!f.fig_number) continue;
    const alt = jeNummer.get(f.fig_number);
    jeNummer.set(
      f.fig_number,
      alt ? { ...alt, quantity: alt.quantity + (f.quantity || 1) } : { ...f, quantity: f.quantity || 1 },
    );
  }
  const figs = [...jeNummer.values()];
  if (!figs.length) return 0;
  // Aus dem Katalog sind die Mengen schon zusammengefasst; geschrieben wird nur,
  // was von der Quelle kam.
  const ausQuelle = !ausKatalog.length;
  const nummern = figs.map(f => f.fig_number);

  await k.transaktion(async t => {
    await inhalt.fuegeSetFigurenEin(t.db, userId, setNumber, nummern);
    await inhalt.entferneFremdeSetFiguren(t.db, userId, setNumber, nummern);
    await merkeFiguren(
      t,
      figs.map(f => ({ figNumber: f.fig_number, figName: f.fig_name, imageUrl: f.image_url })),
      t.db,
    );
    if (ausQuelle)
      await merkeSetFiguren(
        t,
        setNumber,
        figs.map(f => ({ figNumber: f.fig_number, quantity: f.quantity })),
        t.db,
      );
  });
  console.log(`[minifigs] ${setNumber}: ${figs.length} importiert`);
  return figs.length;
}
