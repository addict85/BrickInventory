import { logAndContinue } from '../infra/fehler';
import { withVersion } from '../infra/setNummer';
import { rememberMinifigs, merkeSetFiguren } from './katalogPflege';
import type { CatalogContext } from './kontext';

// Mit und ohne Versionsanhang fragen, nicht zweimal dieselbe Schreibweise.
export async function minifigsFromCatalog(k: CatalogContext, setNumber: string) {
  return k.setInhalt.minifigsOfSetkatalogs(withVersion(setNumber)).catch((e: unknown) => {
    logAndContinue('minifiguren:katalog lesen')(e);
    return [];
  });
}

export type Figur = { fig_number: string; fig_name: string; quantity: number; image_url: string | null };

/** Die Figuren eines Sets aus Katalog oder Quelle; eine Figur, die mehrfach vorkommt,
 * ist eine Zeile mit der Summe als Katalogmenge. */
export async function loadSetMinifigs(
  k: CatalogContext,
  setNumber: string,
): Promise<{ figuren: Figur[]; fromSource: boolean }> {
  const fromCatalog = await minifigsFromCatalog(k, withVersion(setNumber));
  const roh: Figur[] = fromCatalog.length
    ? fromCatalog.map(f => ({
        fig_number: f.fig_number,
        fig_name: f.fig_name || f.fig_number,
        quantity: f.quantity || 1,
        image_url: f.image_url || null,
      }))
    : await k.fremdquellen.quellen.getSetMinifigs(setNumber);
  const jeNumber = new Map<string, Figur>();
  for (const f of roh) {
    if (!f.fig_number) continue;
    const alt = jeNumber.get(f.fig_number);
    jeNumber.set(
      f.fig_number,
      alt ? { ...alt, quantity: alt.quantity + (f.quantity || 1) } : { ...f, quantity: f.quantity || 1 },
    );
  }
  // Aus dem Katalog sind die Mengen schon zusammengefasst; geschrieben wird nur, was von der Quelle kam.
  return { figuren: [...jeNumber.values()], fromSource: !fromCatalog.length };
}

/** In der Transaktion des Aufrufers (t.katalog), neben dem Eintrag in den Bestand. */
export async function setFigurenMerken(k: CatalogContext, setNumber: string, figs: Figur[], fromSource: boolean) {
  await rememberMinifigs(
    k,
    figs.map(f => ({ figNumber: f.fig_number, figName: f.fig_name, imageUrl: f.image_url })),
    k.db,
  );
  if (fromSource)
    await merkeSetFiguren(
      k,
      setNumber,
      figs.map(f => ({ figNumber: f.fig_number, quantity: f.quantity })),
      k.db,
    );
}
