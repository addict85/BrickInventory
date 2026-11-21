/** Map the wanted list's BL numbers to Rebrickable numbers: first locally
 * (mappings, catalog), then via Rebrickable, finally the manual corrections. */
import { RebrickableLocked } from '../externalSources';
import { reportError } from '../infra/error';
import type { WantedArt, WantedItem } from './wantedParser';
import type { WantedContext } from './context';

export type Sicherheit =
  | 'zuordnung'
  | 'gleich_vermerkt'
  /** The number appears like this in the Rebrickable catalog — probably, not certainly. */
  | 'katalogtreffer'
  /** Mapped AND confirmed (external_ids.BrickLink); a level of its own, so that the
   * report shows what a fetch cost. */
  | 'rebrickable'
  /** Entered by hand — a level of its own, so that the report does not claim the
   * catalog delivered what someone typed. */
  | 'korrigiert';

export interface Aufloesung {
  posten: WantedItem;
  rbId: string | null;
  rbFarbe: number | null;
  /** Travel along, because the parts list reads the color name from the row. */
  rbFarbName: string | null;
  rbFarbHex: string | null;
  sicherheit: Sicherheit | null;
  farbeOffen: boolean;
}

/** Without a third-party fetch; the three levels stay separate because they are differently
 * certain. */
export async function resolveLocalOn(
  k: WantedContext,
  posten: WantedItem[],
  uid: number | null = null,
): Promise<Aufloesung[]> {
  if (!posten.length) return [];

  // Three queries for the whole list instead of one per item.
  const nummern = [...new Set(posten.map(p => p.blId))];
  const farben = [...new Set(posten.map(p => p.blFarbe).filter((f): f is number => f !== null))];

  const zuordnung = new Map<string, { rbId: string; sicherheit: Sicherheit }>();
  const eigene = new Set<string>();
  for (const z of await k.wantedListe.mappings(nummern, uid)) {
    const schluessel = `${z.type}:${z.bl_id ?? z.rb_id}`;
    const stufe: Sicherheit = z.bl_id ? 'zuordnung' : 'gleich_vermerkt';
    const schon = zuordnung.get(schluessel);
    if (z.eigen) eigene.add(schluessel);
    else if (eigene.has(schluessel)) continue;
    if (!schon || (schon.sicherheit !== 'zuordnung' && stufe === 'zuordnung')) {
      zuordnung.set(schluessel, { rbId: z.rb_id, sicherheit: stufe });
    }
  }

  const katalog = new Set<string>();
  for (const art of ['part', 'fig', 'set'] as const) {
    for (const n of await k.wantedListe.numbersInCatalog(art, nummern)) katalog.add(`${art}:${n}`);
  }

  const farbMap = new Map<number, { id: number; name: string | null; hex: string | null }>();
  for (const z of await k.wantedListe.colorsToBlColors(farben)) {
    farbMap.set(Number(z.bl_color_id), {
      id: Number(z.id),
      name: z.name ?? null,
      hex: z.rgb ?? null,
    });
  }

  return posten.map(p => {
    const treffer = zuordnung.get(`${p.art}:${p.blId}`);
    let rbId: string | null = null;
    let sicherheit: Sicherheit | null = null;
    if (treffer) {
      rbId = treffer.rbId;
      sicherheit = treffer.sicherheit;
    } else if (katalog.has(`${p.art}:${p.blId}`)) {
      rbId = p.blId;
      sicherheit = 'katalogtreffer';
    }

    const farbe = p.blFarbe === null ? null : (farbMap.get(p.blFarbe) ?? null);
    return {
      posten: p,
      rbId,
      rbFarbe: farbe?.id ?? null,
      rbFarbName: farbe?.name ?? null,
      rbFarbHex: farbe?.hex ?? null,
      sicherheit,
      farbeOffen: rbId !== null && p.blFarbe !== null && farbe === null,
    };
  });
}

/** Rebrickable is the only direct path from BL to RB numbers. */
export type RebrickableAbort = 'kontingent' | 'kein_schluessel' | 'stoerung';
/** Two phases, because the Rebrickable fetches take much longer. */
export type WantedProgress = {
  phase: 'rebrickable' | 'schreiben';
  fertig: number;
  gesamt: number;
};

export async function resolveViaRebrickableOn(
  k: WantedContext,
  auf: Aufloesung[],
  grenze = 250,
  fortschritt?: (stand: WantedProgress) => void,
): Promise<{
  auf: Aufloesung[];
  gefragt: number;
  gefunden: number;
  filterWirkungslos: boolean;
  abgebrochen?: RebrickableAbort;
}> {
  let gefragt = 0,
    gefunden = 0;

  const ergebnis = [...auf];
  // Exactly the conditions of the loop below, otherwise the bar counts against
  // a different number than it fills.
  const gesamt = Math.min(grenze, ergebnis.filter(a => a.rbId === null && a.posten.art === 'part').length);
  for (let i = 0; i < ergebnis.length; i++) {
    const a = ergebnis[i]!;
    if (a.rbId !== null) continue;
    if (a.posten.art !== 'part') continue;
    if (gefragt >= grenze) break;

    gefragt++;
    let rbId: string | null;
    // An error other than "unknown" also affects all following items; the report
    // names the reason instead of silently counting them as "not found".
    try {
      rbId = await k.externalSources.quellen.blTeilZuRb(a.posten.blId);
    } catch (e) {
      if (!(e instanceof RebrickableLocked)) reportError('wanted:rebrickable', e);
      const abgebrochen = e instanceof RebrickableLocked ? e.grund : 'stoerung';
      return {
        auf: ergebnis,
        gefragt,
        gefunden,
        filterWirkungslos: k.externalSources.quellen.blFilterIneffective(),
        abgebrochen,
      };
    }
    if (rbId) {
      gefunden++;
      ergebnis[i] = { ...a, rbId, sicherheit: 'rebrickable' };
    }
    // After the fetch: "37 of 50" means 37 done.
    fortschritt?.({ phase: 'rebrickable', fertig: gefragt, gesamt });
  }
  return { auf: ergebnis, gefragt, gefunden, filterWirkungslos: k.externalSources.quellen.blFilterIneffective() };
}

/** Addressed via the index: the same number may appear several times in the list. */
export interface Korrektur {
  index: number;
  /** Cross-check — must match the item at [index]. */
  blId: string;
  art: WantedArt;
  rbId?: string | null | undefined;
  rbFarbe?: number | null | undefined;
  /** The values from the file, changed by hand, so that a typo does not force
   * reading the file in again. */
  menge?: number | undefined;
  /** null means "the account's default". */
  zustand?: string | null | undefined;
  /** null means "none, fetch the market price". */
  kaufpreis?: number | null | undefined;
}

/** Three queries for the whole list, not one per item. */
export async function describeItem(
  k: WantedContext,
  auf: Aufloesung[],
): Promise<Map<number, { name: string | null; bild: string | null; geraten: boolean }>> {
  const raus = new Map<number, { name: string | null; bild: string | null; geraten: boolean }>();

  // Without a Rebrickable number the BrickLink number serves as the key.
  const teile: { i: number; nr: string; farbe: number | null; geraten: boolean }[] = [];
  const figuren: { i: number; nr: string; geraten: boolean }[] = [];
  const sets: { i: number; nr: string; geraten: boolean }[] = [];
  auf.forEach((a, i) => {
    const nr = a.rbId ?? a.posten.blId;
    const geraten = a.rbId === null;
    if (!nr) return;
    if (a.posten.art === 'part') teile.push({ i, nr, farbe: a.rbFarbe, geraten });
    else if (a.posten.art === 'fig') figuren.push({ i, nr, geraten });
    else sets.push({ i, nr, geraten });
  });

  if (teile.length) {
    const nummern = [...new Set(teile.map(t => t.nr))];
    const zeilen = await k.wantedListe.partsDescription(nummern);
    const afterNumber = new Map(zeilen.map(z => [z.part_number, z]));
    const pairs = teile.filter(t => t.farbe !== null);
    const bilder = new Map<string, string>();
    if (pairs.length) {
      const farbRows = await k.wantedListe.partColorImages(
        pairs.map(t => t.nr),
        pairs.map(t => t.farbe as number),
      );
      for (const z of farbRows) if (z.bild) bilder.set(`${z.part_number}|${z.color_id}`, z.bild);
    }
    for (const t of teile) {
      const z = afterNumber.get(t.nr);
      const name = z?.name ?? null;
      const bild = bilder.get(`${t.nr}|${t.farbe}`) || z?.bild_allgemein || null;
      // `geraten` only on a find: calling an empty row "guessed" would be
      // a claim about nothing.
      raus.set(t.i, { name, bild, geraten: t.geraten && !!(name || bild) });
    }
  }

  if (figuren.length) {
    const zeilen = await k.wantedListe.minifigsDescription([...new Set(figuren.map(f => f.nr))]);
    const nach = new Map(zeilen.map(z => [z.fig_number, z]));
    for (const f of figuren) {
      const z = nach.get(f.nr);
      const name = z?.fig_name ?? null,
        bild = z?.bild ?? null;
      raus.set(f.i, { name, bild, geraten: f.geraten && !!(name || bild) });
    }
  }

  if (sets.length) {
    const nummern = [...new Set(sets.map(x => x.nr))];
    const zeilen = await k.wantedListe.setsDescription(nummern);
    const nach = new Map(zeilen.map(z => [z.set_number, z]));
    for (const x of sets) {
      const z = nach.get(x.nr);
      const name = z?.name ?? null,
        bild = z?.bild ?? null;
      raus.set(x.i, { name, bild, geraten: x.geraten && !!(name || bild) });
    }
  }

  return raus;
}

/** Every correction is checked against kind and number at the index, otherwise after a file change
 * it would silently act on a foreign item. */
export function applyCorrectionsAn(
  auf: Aufloesung[],
  korrekturen: Korrektur[],
): { auf: Aufloesung[]; angewandt: number; abgewiesen: Korrektur[] } {
  const ergebnis = [...auf];
  const abgewiesen: Korrektur[] = [];
  let angewandt = 0;
  for (const k of korrekturen) {
    const a = ergebnis[k.index];
    if (!a || a.posten.art !== k.art || a.posten.blId !== k.blId) {
      abgewiesen.push(k);
      continue;
    }
    // `undefined` means "not touched", `null` "explicitly cleared" — otherwise
    // a correction of the color would delete the number as well.
    const rbId = k.rbId === undefined ? a.rbId : k.rbId || null;
    const rbFarbe = k.rbFarbe === undefined ? a.rbFarbe : (k.rbFarbe ?? null);

    // An unusable value rejects the whole correction instead of silently
    // bending it into shape: quantity 0 is a typo, not a 1.
    let menge = a.posten.menge;
    if (k.menge !== undefined) {
      const m = Math.trunc(Number(k.menge));
      if (!Number.isFinite(m) || m < 1) {
        abgewiesen.push(k);
        continue;
      }
      menge = m;
    }
    let zustand = a.posten.zustand;
    if (k.zustand !== undefined) {
      // null/'' means "the account's default" like CONDITION=X; anything other than N/U
      // is an error, not "any".
      if (k.zustand === null || k.zustand === '') zustand = null;
      else if (k.zustand === 'N' || k.zustand === 'U') zustand = k.zustand;
      else {
        abgewiesen.push(k);
        continue;
      }
    }
    let maxPreis = a.posten.maxPreis;
    if (k.kaufpreis !== undefined) {
      if (k.kaufpreis === null || (k.kaufpreis as unknown) === '') maxPreis = null;
      else {
        const p = Number(k.kaufpreis);
        // 0 means "none", like MAXPRICE in the reader.
        if (!Number.isFinite(p) || p < 0) {
          abgewiesen.push(k);
          continue;
        }
        maxPreis = p > 0 ? p : null;
      }
    }

    const numberChanged = rbId !== a.rbId || rbFarbe !== a.rbFarbe;
    const itemChanged = menge !== a.posten.menge || zustand !== a.posten.zustand || maxPreis !== a.posten.maxPreis;
    if (!numberChanged && !itemChanged) continue; // nothing changed

    ergebnis[k.index] = {
      ...a,
      rbId,
      rbFarbe,
      ...(itemChanged ? { posten: { ...a.posten, menge, zustand, maxPreis } } : {}),
      // The color name belonged to the old number and is fetched again below.
      rbFarbName: rbFarbe === a.rbFarbe ? a.rbFarbName : null,
      rbFarbHex: rbFarbe === a.rbFarbe ? a.rbFarbHex : null,
      // `korrigiert` only for a changed number: the level decides whether the
      // mapping is remembered; a changed quantity says nothing about the number.
      sicherheit: numberChanged ? 'korrigiert' : a.sicherheit,
      farbeOffen: rbId !== null && a.posten.blFarbe !== null && rbFarbe === null,
    };
    angewandt++;
  }
  return { auf: ergebnis, angewandt, abgewiesen };
}

/** A color entered by hand was not part of the resolution; without
 * this step it would go to the creator without a name. */
export async function backfillColors(k: WantedContext, auf: Aufloesung[]): Promise<Aufloesung[]> {
  const offen = auf.filter(a => a.rbFarbe !== null && a.rbFarbName === null).map(a => a.rbFarbe as number);
  if (!offen.length) return auf;
  const zeilen = await k.wantedListe.colorsToIds([...new Set(offen)]);
  const nach = new Map(zeilen.map(z => [Number(z.id), z]));
  return auf.map(a => {
    if (a.rbFarbe === null || a.rbFarbName !== null) return a;
    const z = nach.get(a.rbFarbe);
    return z ? { ...a, rbFarbName: z.name ?? null, rbFarbHex: z.rgb ?? null } : a;
  });
}
