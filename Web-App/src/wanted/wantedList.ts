/** Import a BrickLink wanted list: read (wantedParser), resolve
 * (wantedAufloesung), write (wantedSchreiber). The file carries BL numbers,
 * the inventory lists RB numbers. */
import { readWantedList, type WantedArt, type WantedItem } from './wantedParser';
import {
  resolveLocalOn,
  resolveViaRebrickableOn,
  applyCorrections,
  backfillColors,
  describeItem,
  type Resolution,
  type Correction,
  type WantedProgress,
} from './wantedResolution';
import type { RebrickableAbort } from './wantedResolution';
import { reportRow, writeItem, type ItemResult, type WriteOptions } from './wantedWriter';
import type { WantedContext } from './context';

export interface WantedReport {
  gelesen: number;
  fremdeArten: Record<string, number>;
  ohneNummer: number;
  stufen: Record<string, number>;
  farbeOffen: number;
  /** With BL numbers, so that they can be looked up. */
  offen: { blId: string; art: WantedArt; blFarbe: number | null }[];
  rebrickable?: { gefragt: number; gefunden: number; filterWirkungslos: boolean; abgebrochen?: RebrickableAbort };
  /** `abgewiesen`: corrections whose item did not match — then a different
   * file was chosen. They are NAMED, not skipped. */
  korrekturen?: { angewandt: number; abgewiesen: Correction[] };
  angelegt: number;
  aufgestockt: number;
  fehler: number;
  /** true = NOTHING was written. */
  vorschau: boolean;
  /** The numbers above apply to what happened until the abort. */
  abgebrochen?: boolean;
  /** So that the preview shows what WOULD be created, even if the file names no
   * condition. */
  standardZustand: 'N' | 'U';
  posten: ItemResult[];
}

function countLevels(auf: Resolution[]): Record<string, number> {
  const z: Record<string, number> = {};
  for (const a of auf) if (a.sicherheit) z[a.sicherheit] = (z[a.sicherheit] ?? 0) + 1;
  return z;
}

/** The corrections after resolving, because they override it; before counting,
 * because the report would otherwise name numbers from before the correction. */
async function resolveCompleteOn(kx: WantedContext, item: WantedItem[], uid: number, opt: WantedOptions) {
  let auf = await resolveLocalOn(kx, item, uid);
  let rebrickable: WantedReport['rebrickable'];
  if (opt.viaRebrickable) {
    const r = await resolveViaRebrickableOn(kx, auf, 250, opt.progress);
    auf = r.auf;
    rebrickable = {
      gefragt: r.gefragt,
      gefunden: r.gefunden,
      filterWirkungslos: r.filterWirkungslos,
      ...(r.abgebrochen ? { abgebrochen: r.abgebrochen } : {}),
    };
  }
  let korrekturen: WantedReport['korrekturen'];
  if (opt.korrekturen?.length) {
    const k = applyCorrections(auf, opt.korrekturen);
    auf = await backfillColors(kx, k.auf);
    korrekturen = { angewandt: k.angewandt, abgewiesen: k.abgewiesen };
  }
  return { auf, rebrickable, korrekturen };
}

export interface WantedOptions extends WriteOptions {
  vorschau?: boolean;
  viaRebrickable?: boolean;
  korrekturen?: Correction[];
  /** Is called SYNCHRONOUSLY and must not throw. */
  progress?: (stand: WantedProgress) => void;
  /** The bar in the UI carries a cross; without this question it would have a
   * cancel button that lies. */
  cancellation?: () => Promise<boolean>;
}

/** Preview and the real thing take the same path, so that the preview promises
 * nothing the import does not do. */
export async function importWantedList(
  k: WantedContext,
  uid: number,
  xml: string,
  opt: WantedOptions = {},
): Promise<WantedReport> {
  const read = readWantedList(xml);
  const { auf, rebrickable, korrekturen } = await resolveCompleteOn(k, read.posten, uid, opt);

  const bericht: WantedReport = {
    gelesen: read.posten.length,
    fremdeArten: read.fremdeArten,
    ohneNummer: read.ohneNummer,
    stufen: countLevels(auf),
    farbeOffen: auf.filter(a => a.farbeOffen).length,
    offen: auf
      .filter(a => a.rbId === null)
      .map(a => ({ blId: a.posten.blId, art: a.posten.art, blFarbe: a.posten.blFarbe })),
    ...(rebrickable ? { rebrickable } : {}),
    ...(korrekturen ? { korrekturen } : {}),
    angelegt: 0,
    aufgestockt: 0,
    fehler: 0,
    vorschau: !!opt.vorschau,
    standardZustand: await k.einstellungen.userDefaultCondition(uid),
    posten: [],
  };

  let seq = -1;
  const melde = () => opt.progress?.({ phase: 'schreiben', fertig: seq + 1, gesamt: auf.length });

  for (const a of auf) {
    // The tick counts over ALL items, otherwise it would depend on how many were resolvable.
    if (opt.cancellation && !opt.vorschau && seq >= 0 && (seq + 1) % 10 === 0) {
      if (await opt.cancellation()) {
        bericht.abgebrochen = true;
        break;
      }
    }
    // An own binding: TypeScript does not narrow `a.rbId` via a helper variable.
    const rbId = a.rbId;
    const open = rbId === null || a.farbeOffen;
    seq++;
    const row = reportRow(a);
    if (rbId === null || a.farbeOffen || opt.vorschau) {
      // In the preview "created" means "would be created".
      if (open) row.ausgang = 'offen';
      bericht.posten.push(row);
      // A skipped item is done too, otherwise the bar would stand still.
      melde();
      continue;
    }

    try {
      const how = await writeItem(uid, a, rbId, opt);
      if (how === 'angelegt') bericht.angelegt++;
      else bericht.aufgestockt++;
      row.ausgang = how;
    } catch (e: unknown) {
      bericht.fehler++;
      row.ausgang = 'fehler';
      row.grund = e instanceof Error ? e.message : String(e);
    }
    bericht.posten.push(row);
    // After success AND failure, otherwise the bar would stand still on errors.
    melde();
  }

  await describeRows(k, bericht.posten, auf);
  return bericht;
}

/** After writing too: the dialog redraws the same table with the
 * response and would otherwise show empty cells. */
async function describeRows(k: WantedContext, rows: ItemResult[], auf: Resolution[]): Promise<void> {
  const description = await describeItem(k, auf);
  rows.forEach((row, i) => {
    const b = description.get(i);
    if (!b) return;
    row.name = b.name;
    row.bild = b.bild;
    row.nameGeraten = b.geraten;
  });
}
