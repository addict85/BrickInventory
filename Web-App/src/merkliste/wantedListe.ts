/** Eine BrickLink-Wanted-Liste importieren: lesen (wantedParser), auflösen
 * (wantedAufloesung), schreiben (wantedSchreiber). Die Datei trägt BL-Nummern,
 * der Bestand führt RB-Nummern.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#abschnitt */
import { nutzerStandardZustand } from '../einstellungen/settings';
import { leseWantedListe } from './wantedParser';
import type { WantedArt, WantedPosten } from './wantedParser';
import {
  loeseLokalAuf,
  loeseUeberRebrickableAuf,
  wendeKorrekturenAn,
  farbenNachtragen,
  beschreibePosten,
} from './wantedAufloesung';
import type { Aufloesung, Korrektur, WantedFortschritt } from './wantedAufloesung';
import { berichtsZeile, schreibePosten } from './wantedSchreiber';
import type { PostenErgebnis, SchreibOptionen } from './wantedSchreiber';

export interface WantedBericht {
  gelesen: number;
  fremdeArten: Record<string, number>;
  ohneNummer: number;
  stufen: Record<string, number>;
  farbeOffen: number;
  /** Mit BL-Nummern, damit man sie nachsehen kann. */
  offen: { blId: string; art: WantedArt; blFarbe: number | null }[];
  rebrickable?: { gefragt: number; gefunden: number; filterWirkungslos: boolean };
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
   * Zustand nennt.
   * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#wantedbericht */
  standardZustand: 'N' | 'U';
  posten: PostenErgebnis[];
}

function zaehleStufen(auf: Aufloesung[]): Record<string, number> {
  const z: Record<string, number> = {};
  for (const a of auf) if (a.sicherheit) z[a.sicherheit] = (z[a.sicherheit] ?? 0) + 1;
  return z;
}

/** Nach dem Auflösen die Korrekturen, weil sie es überstimmen; vor dem Zählen,
 * weil der Bericht sonst Zahlen von vor der Korrektur nennt. */
async function loeseVollstaendigAuf(posten: WantedPosten[], uid: number, opt: WantedOptionen) {
  let auf = await loeseLokalAuf(posten, uid);
  let rebrickable: WantedBericht['rebrickable'];
  if (opt.ueberRebrickable) {
    const r = await loeseUeberRebrickableAuf(auf, 250, opt.fortschritt);
    auf = r.auf;
    rebrickable = { gefragt: r.gefragt, gefunden: r.gefunden, filterWirkungslos: r.filterWirkungslos };
  }
  let korrekturen: WantedBericht['korrekturen'];
  if (opt.korrekturen?.length) {
    const k = wendeKorrekturenAn(auf, opt.korrekturen);
    auf = await farbenNachtragen(k.auf);
    korrekturen = { angewandt: k.angewandt, abgewiesen: k.abgewiesen };
  }
  return { auf, rebrickable, korrekturen };
}

export interface WantedOptionen extends SchreibOptionen {
  vorschau?: boolean;
  ueberRebrickable?: boolean;
  korrekturen?: Korrektur[];
  /** Wird SYNCHRON gerufen und darf nichts werfen.
   * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#importierewantedliste-2 */
  fortschritt?: (stand: WantedFortschritt) => void;
  /** Der Balken in der Oberfläche trägt ein Kreuz; ohne diese Frage hätte er einen
   * Abbrechen-Knopf, der lügt.
   * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#importierewantedliste-3 */
  abbruch?: () => Promise<boolean>;
}

/** Vorschau und Ernstfall gehen denselben Weg, damit die Vorschau nichts
 * verspricht, was der Import nicht tut.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#abschnitt-3 */
export async function importiereWantedListe(
  uid: number,
  xml: string,
  opt: WantedOptionen = {},
): Promise<WantedBericht> {
  const gelesen = leseWantedListe(xml);
  const { auf, rebrickable, korrekturen } = await loeseVollstaendigAuf(gelesen.posten, uid, opt);

  const bericht: WantedBericht = {
    gelesen: gelesen.posten.length,
    fremdeArten: gelesen.fremdeArten,
    ohneNummer: gelesen.ohneNummer,
    stufen: zaehleStufen(auf),
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
    standardZustand: await nutzerStandardZustand(uid),
    posten: [],
  };

  let lfd = -1;
  const melde = () => opt.fortschritt?.({ phase: 'schreiben', fertig: lfd + 1, gesamt: auf.length });

  for (const a of auf) {
    // Der Takt zählt über ALLE Posten, sonst hinge er daran, wie viele auflösbar waren.
    if (opt.abbruch && !opt.vorschau && lfd >= 0 && (lfd + 1) % 10 === 0) {
      if (await opt.abbruch()) {
        bericht.abgebrochen = true;
        break;
      }
    }
    // Eigene Bindung: TypeScript verengt `a.rbId` über eine Hilfsvariable nicht.
    const rbId = a.rbId;
    const offen = rbId === null || a.farbeOffen;
    lfd++;
    const zeile = berichtsZeile(a);
    if (rbId === null || a.farbeOffen || opt.vorschau) {
      // In der Vorschau heisst „angelegt" „würde angelegt".
      if (offen) zeile.ausgang = 'offen';
      bericht.posten.push(zeile);
      // Auch ein übersprungener Posten ist erledigt, sonst bliebe der Balken stehen.
      melde();
      continue;
    }

    try {
      const wie = await schreibePosten(uid, a, rbId, opt);
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

  await beschreibeZeilen(bericht.posten, auf);
  return bericht;
}

/** Auch nach dem Schreiben: Der Dialog zeichnet dieselbe Tabelle mit der
 * Antwort neu und zeigte sonst leere Zellen.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#importierewantedliste-beschreibung */
async function beschreibeZeilen(zeilen: PostenErgebnis[], auf: Aufloesung[]): Promise<void> {
  const beschreibung = await beschreibePosten(auf);
  zeilen.forEach((zeile, i) => {
    const b = beschreibung.get(i);
    if (!b) return;
    zeile.name = b.name;
    zeile.bild = b.bild;
    zeile.nameGeraten = b.geraten;
  });
}
