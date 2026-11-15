import { logAndContinue } from '../infra/fehler';
import { mitVersion } from '../infra/setNummer';
import { merkeFiguren, merkeSetFiguren } from './katalogPflege';
import type { KatalogKontext } from './kontext';

// Mit und ohne Versionsanhang fragen, nicht zweimal dieselbe Schreibweise.
export async function figurenAusKatalog(k: KatalogKontext, setNumber: string) {
  return k.setInhalt.figurenDesSetkatalogs(mitVersion(setNumber)).catch((e: unknown) => {
    logAndContinue('minifiguren:katalog lesen')(e);
    return [];
  });
}

export type Figur = { fig_number: string; fig_name: string; quantity: number; image_url: string | null };

/** Die Figuren eines Sets aus Katalog oder Quelle; eine Figur, die mehrfach vorkommt,
 * ist eine Zeile mit der Summe als Katalogmenge. */
export async function setFigurenLaden(
  k: KatalogKontext,
  setNumber: string,
): Promise<{ figuren: Figur[]; ausQuelle: boolean }> {
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
  // Aus dem Katalog sind die Mengen schon zusammengefasst; geschrieben wird nur, was von der Quelle kam.
  return { figuren: [...jeNummer.values()], ausQuelle: !ausKatalog.length };
}

/** In der Transaktion des Aufrufers (t.katalog), neben dem Eintrag in den Bestand. */
export async function setFigurenMerken(k: KatalogKontext, setNumber: string, figs: Figur[], ausQuelle: boolean) {
  await merkeFiguren(
    k,
    figs.map(f => ({ figNumber: f.fig_number, figName: f.fig_name, imageUrl: f.image_url })),
    k.db,
  );
  if (ausQuelle)
    await merkeSetFiguren(
      k,
      setNumber,
      figs.map(f => ({ figNumber: f.fig_number, quantity: f.quantity })),
      k.db,
    );
}
