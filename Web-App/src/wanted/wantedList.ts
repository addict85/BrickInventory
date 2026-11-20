/** Import a BrickLink wanted list: read (wantedParser), resolve
 * (wantedAufloesung), write (wantedSchreiber). The file carries BL numbers,
 * the inventory lists RB numbers. */
import { readWantedList, type WantedArt, type WantedItem } from './wantedParser';
import {
  resolveLocalOn,
  resolveViaRebrickableOn,
  applyCorrectionsAn,
  backfillColors,
  describeItem,
  type Aufloesung,
  type Korrektur,
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
  korrekturen?: { angewandt: number; abgewiesen: Korrektur[] };
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

function countLevels(auf: Aufloesung[]): Record<string, number> {
  const z: Record<string, number> = {};
  for (const a of auf) if (a.sicherheit) z[a.sicherheit] = (z[a.sicherheit] ?? 0) + 1;
  return z;
}

/** The corrections after resolving, because they override it; before counting,
 * because the report would otherwise name numbers from before the correction. */
async function resolveCompleteOn(kx: WantedContext, posten: WantedItem[], uid: number, opt: WantedOptions) {
  let auf = await resolveLocalOn(kx, posten, uid);
  let rebrickable: WantedReport['rebrickable'];
  if (opt.viaRebrickable) {
    const r = await resolveViaRebrickableOn(kx, auf, 250, opt.fortschritt);
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
    const k = applyCorrectionsAn(auf, opt.korrekturen);
    auf = await backfillColors(kx, k.auf);
    korrekturen = { angewandt: k.angewandt, abgewiesen: k.abgewiesen };
  }
  return { auf, rebrickable, korrekturen };
}

export interface WantedOptions extends WriteOptions {
  vorschau?: boolean;
  viaRebrickable?: boolean;
  korrekturen?: Korrektur[];
  /** Is called SYNCHRONOUSLY and must not throw. */
  fortschritt?: (stand: WantedProgress) => void;
  /** The bar in the UI carries a cross; without this question it would have a
   * cancel button that lies. */
  abbruch?: () => Promise<boolean>;
}

/** Preview and the real thing take the same path, so that the preview promises
 * nothing the import does not do. */
export async function importiereWantedListe(
  k: WantedContext,
  uid: number,
  xml: string,
  opt: WantedOptions = {},
): Promise<WantedReport> {
  const gelesen = readWantedList(xml);
  const { auf, rebrickable, korrekturen } = await resolveCompleteOn(k, gelesen.posten, uid, opt);

  const bericht: WantedReport = {
    gelesen: gelesen.posten.length,
    fremdeArten: gelesen.fremdeArten,
    ohneNummer: gelesen.ohneNummer,
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
  const melde = () => opt.fortschritt?.({ phase: 'schreiben', fertig: seq + 1, gesamt: auf.length });

  for (const a of auf) {
    // The tick counts over ALL items, otherwise it would depend on how many were resolvable.
    if (opt.abbruch && !opt.vorschau && seq >= 0 && (seq + 1) % 10 === 0) {
      if (await opt.abbruch()) {
        bericht.abgebrochen = true;
        break;
      }
    }
    // An own binding: TypeScript does not narrow `a.rbId` via a helper variable.
    const rbId = a.rbId;
    const offen = rbId === null || a.farbeOffen;
    seq++;
    const zeile = reportRow(a);
    if (rbId === null || a.farbeOffen || opt.vorschau) {
      // In the preview "created" means "would be created".
      if (offen) zeile.ausgang = 'offen';
      bericht.posten.push(zeile);
      // A skipped item is done too, otherwise the bar would stand still.
      melde();
      continue;
    }

    try {
      const wie = await writeItem(uid, a, rbId, opt);
      if (wie === 'angelegt') bericht.angelegt++;
      else bericht.aufgestockt++;
      zeile.ausgang = wie;
    } catch (e: unknown) {
      bericht.fehler++;
      zeile.ausgang = 'fehler';
      zeile.grund = e instanceof Error ? e.message : String(e);
    }
    bericht.posten.push(zeile);
    // After success AND failure, otherwise the bar would stand still on errors.
    melde();
  }

  await describeRows(k, bericht.posten, auf);
  return bericht;
}

/** After writing too: the dialog redraws the same table with the
 * response and would otherwise show empty cells. */
async function describeRows(k: WantedContext, zeilen: ItemResult[], auf: Aufloesung[]): Promise<void> {
  const beschreibung = await describeItem(k, auf);
  zeilen.forEach((zeile, i) => {
    const b = beschreibung.get(i);
    if (!b) return;
    zeile.name = b.name;
    zeile.bild = b.bild;
    zeile.nameGeraten = b.geraten;
  });
}
