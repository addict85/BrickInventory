/** Eine BrickLink-Wanted-Liste importieren: lesen (wantedParser), auflösen
 * (wantedAufloesung), schreiben (wantedSchreiber). Die Datei trägt BL-Nummern,
 * der Bestand führt RB-Nummern. */
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
} from './wantedAufloesung';
import type { RebrickableAbort } from './wantedAufloesung';
import { reportRow, writeItem, type ItemResult, type WriteOptions } from './wantedSchreiber';
import type { WantedContext } from './context';

export interface WantedReport {
  gelesen: number;
  fremdeArten: Record<string, number>;
  ohneNummer: number;
  stufen: Record<string, number>;
  farbeOffen: number;
  /** Mit BL-Nummern, damit man sie nachsehen kann. */
  offen: { blId: string; art: WantedArt; blFarbe: number | null }[];
  rebrickable?: { gefragt: number; gefunden: number; filterWirkungslos: boolean; abgebrochen?: RebrickableAbort };
  /** `abgewiesen`: Korrekturen, deren Posten nicht passte — dann wurde eine andere
   * Datei gewählt. Sie werden GENANNT, nicht übergangen. */
  korrekturen?: { angewandt: number; abgewiesen: Korrektur[] };
  angelegt: number;
  aufgestockt: number;
  fehler: number;
  /** true = es wurde NICHTS geschrieben. */
  vorschau: boolean;
  /** Die Zahlen oben gelten für das, was bis zum Abbruch geschah. */
  abgebrochen?: boolean;
  /** Damit die Vorschau zeigt, was angelegt WÜRDE, auch wenn die Datei keinen
   * Zustand nennt. */
  standardZustand: 'N' | 'U';
  posten: ItemResult[];
}

function countLevels(auf: Aufloesung[]): Record<string, number> {
  const z: Record<string, number> = {};
  for (const a of auf) if (a.sicherheit) z[a.sicherheit] = (z[a.sicherheit] ?? 0) + 1;
  return z;
}

/** Nach dem Auflösen die Korrekturen, weil sie es überstimmen; vor dem Zählen,
 * weil der Bericht sonst Zahlen von vor der Korrektur nennt. */
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
  /** Wird SYNCHRON gerufen und darf nichts werfen. */
  fortschritt?: (stand: WantedProgress) => void;
  /** Der Balken in der Oberfläche trägt ein Kreuz; ohne diese Frage hätte er einen
   * Abbrechen-Knopf, der lügt. */
  abbruch?: () => Promise<boolean>;
}

/** Vorschau und Ernstfall gehen denselben Weg, damit die Vorschau nichts
 * verspricht, was der Import nicht tut. */
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
    // Der Takt zählt über ALLE Posten, sonst hinge er daran, wie viele auflösbar waren.
    if (opt.abbruch && !opt.vorschau && seq >= 0 && (seq + 1) % 10 === 0) {
      if (await opt.abbruch()) {
        bericht.abgebrochen = true;
        break;
      }
    }
    // Eigene Bindung: TypeScript verengt `a.rbId` über eine Hilfsvariable nicht.
    const rbId = a.rbId;
    const offen = rbId === null || a.farbeOffen;
    seq++;
    const zeile = reportRow(a);
    if (rbId === null || a.farbeOffen || opt.vorschau) {
      // In der Vorschau heisst „angelegt" „würde angelegt".
      if (offen) zeile.ausgang = 'offen';
      bericht.posten.push(zeile);
      // Auch ein übersprungener Posten ist erledigt, sonst bliebe der Balken stehen.
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
    // Nach Erfolg UND Fehlschlag, sonst bliebe der Balken bei Fehlern stehen.
    melde();
  }

  await describeRows(k, bericht.posten, auf);
  return bericht;
}

/** Auch nach dem Schreiben: Der Dialog zeichnet dieselbe Tabelle mit der
 * Antwort neu und zeigte sonst leere Zellen. */
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
