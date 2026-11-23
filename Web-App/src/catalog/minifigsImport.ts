import { logAndContinue } from '../infra/error';
import { withVersion } from '../infra/setNumber';
import { rememberMinifigs, rememberSetMinifigs } from './catalogMaintenance';
import type { CatalogContext } from './context';

// Ask with and without the version suffix, not twice the same spelling.
export async function minifigsFromCatalog(k: CatalogContext, setNumber: string) {
  return k.setContent.minifigsOfSetCatalog(withVersion(setNumber)).catch((e: unknown) => {
    logAndContinue('minifiguren:katalog lesen')(e);
    return [];
  });
}

export type SetFig = { fig_number: string; fig_name: string; quantity: number; image_url: string | null };

/** A set's figures from the catalog or the source; a figure occurring several times
 * is one row with the sum as catalog quantity. */
export async function loadSetMinifigs(
  k: CatalogContext,
  setNumber: string,
): Promise<{ minifigs: SetFig[]; fromSource: boolean }> {
  const fromCatalog = await minifigsFromCatalog(k, withVersion(setNumber));
  const raw: SetFig[] = fromCatalog.length
    ? fromCatalog.map(f => ({
        fig_number: f.fig_number,
        fig_name: f.fig_name || f.fig_number,
        quantity: f.quantity || 1,
        image_url: f.image_url || null,
      }))
    : await k.externalSources.sources.getSetMinifigs(setNumber);
  const perNumber = new Map<string, SetFig>();
  for (const f of raw) {
    if (!f.fig_number) continue;
    const alt = perNumber.get(f.fig_number);
    perNumber.set(
      f.fig_number,
      alt ? { ...alt, quantity: alt.quantity + (f.quantity || 1) } : { ...f, quantity: f.quantity || 1 },
    );
  }
  // From the catalog the quantities are already merged; only what came from the source is written.
  return { minifigs: [...perNumber.values()], fromSource: !fromCatalog.length };
}

/** In the caller's transaction (t.katalog), next to the entry in the inventory. */
export async function rememberSetFigs(k: CatalogContext, setNumber: string, figs: SetFig[], fromSource: boolean) {
  await rememberMinifigs(
    k,
    figs.map(f => ({ figNumber: f.fig_number, figName: f.fig_name, imageUrl: f.image_url })),
    k.db,
  );
  if (fromSource)
    await rememberSetMinifigs(
      k,
      setNumber,
      figs.map(f => ({ figNumber: f.fig_number, quantity: f.quantity })),
      k.db,
    );
}
