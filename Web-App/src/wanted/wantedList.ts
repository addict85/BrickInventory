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
  parsed: number;
  foreignTypes: Record<string, number>;
  withoutNumber: number;
  levels: Record<string, number>;
  colorPending: number;
  /** With BL numbers, so that they can be looked up. */
  open: { blId: string; kind: WantedArt; blColor: number | null }[];
  rebrickable?: { asked: number; found: number; filterIneffective: boolean; aborted?: RebrickableAbort };
  /** `abgewiesen`: corrections whose item did not match — then a different
   * file was chosen. They are NAMED, not skipped. */
  corrections?: { applied: number; rejected: Correction[] };
  created: number;
  topped_up: number;
  failed: number;
  /** true = NOTHING was written. */
  preview: boolean;
  /** The numbers above apply to what happened until the abort. */
  aborted?: boolean;
  /** So that the preview shows what WOULD be created, even if the file names no
   * condition. */
  defaultCondition: 'N' | 'U';
  items: ItemResult[];
}

function countLevels(auf: Resolution[]): Record<string, number> {
  const z: Record<string, number> = {};
  for (const a of auf) if (a.confidence) z[a.confidence] = (z[a.confidence] ?? 0) + 1;
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
      asked: r.asked,
      found: r.found,
      filterIneffective: r.filterIneffective,
      ...(r.aborted ? { aborted: r.aborted } : {}),
    };
  }
  let corrections: WantedReport['corrections'];
  if (opt.corrections?.length) {
    const k = applyCorrections(auf, opt.corrections);
    auf = await backfillColors(kx, k.auf);
    corrections = { applied: k.applied, rejected: k.rejected };
  }
  return { auf, rebrickable, corrections };
}

export interface WantedOptions extends WriteOptions {
  preview?: boolean;
  viaRebrickable?: boolean;
  corrections?: Correction[];
  /** Is called SYNCHRONOUSLY and must not throw. */
  progress?: (state: WantedProgress) => void;
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
  const { auf, rebrickable, corrections } = await resolveCompleteOn(k, read.items, uid, opt);

  const bericht: WantedReport = {
    parsed: read.items.length,
    foreignTypes: read.foreignTypes,
    withoutNumber: read.withoutNumber,
    levels: countLevels(auf),
    colorPending: auf.filter(a => a.colorPending).length,
    open: auf
      .filter(a => a.rbId === null)
      .map(a => ({ blId: a.items.blId, kind: a.items.kind, blColor: a.items.blColor })),
    ...(rebrickable ? { rebrickable } : {}),
    ...(corrections ? { corrections } : {}),
    created: 0,
    topped_up: 0,
    failed: 0,
    preview: !!opt.preview,
    defaultCondition: await k.settings.userDefaultCondition(uid),
    items: [],
  };

  let seq = -1;
  const melde = () => opt.progress?.({ phase: 'write', done: seq + 1, total: auf.length });

  for (const a of auf) {
    // The tick counts over ALL items, otherwise it would depend on how many were resolvable.
    if (opt.cancellation && !opt.preview && seq >= 0 && (seq + 1) % 10 === 0) {
      if (await opt.cancellation()) {
        bericht.aborted = true;
        break;
      }
    }
    // An own binding: TypeScript does not narrow `a.rbId` via a helper variable.
    const rbId = a.rbId;
    const open = rbId === null || a.colorPending;
    seq++;
    const row = reportRow(a);
    if (rbId === null || a.colorPending || opt.preview) {
      // In the preview "created" means "would be created".
      if (open) row.outcome = 'open';
      bericht.items.push(row);
      // A skipped item is done too, otherwise the bar would stand still.
      melde();
      continue;
    }

    try {
      const how = await writeItem(uid, a, rbId, opt);
      if (how === 'created') bericht.created++;
      else bericht.topped_up++;
      row.outcome = how;
    } catch (e: unknown) {
      bericht.failed++;
      row.outcome = 'error';
      row.reason = e instanceof Error ? e.message : String(e);
    }
    bericht.items.push(row);
    // After success AND failure, otherwise the bar would stand still on errors.
    melde();
  }

  await describeRows(k, bericht.items, auf);
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
    row.image = b.image;
    row.nameGuessed = b.geraten;
  });
}
