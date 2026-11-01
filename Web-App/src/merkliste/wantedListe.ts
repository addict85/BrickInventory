/** BrickLink-Wanted-Listen lesen und auf Rebrickable-Nummern abbilden: Die Datei
 * trägt BL-Nummern, der Bestand führt RB-Nummern.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#abschnitt */
import { blTeilZuRb, blFilterWirkungslos } from '../../clients/rebrickable';
import * as repo from './repository/wantedListe';
import { meldeUndLiefere } from '../infra/httpError';
import { nutzerStandardZustand } from '../konto/settings';

export type WantedArt = 'part' | 'fig' | 'set';

// Nur P, M und S haben einen Platz im Bestand; andere Arten werden gezählt und
// gemeldet statt still verworfen.
// Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#arten
const ARTEN: Record<string, WantedArt> = { P: 'part', M: 'fig', S: 'set' };

export interface WantedPosten {
  art: WantedArt;
  /** ITEMID — eine BrickLink-Nummer, KEINE Rebrickable-Nummer. */
  blId: string;
  /** COLOR als BrickLink-Farbnummer; null bei Sets und farblosen Posten. */
  blFarbe: number | null;
  /** MINQTY, mindestens 1. */
  menge: number;
  /** CONDITION: N oder U; X („egal") wird zu null. */
  zustand: 'N' | 'U' | null;
  /** MAXPRICE; -1 heisst „kein Höchstpreis" und wird null. */
  maxPreis: number | null;
}

/** Zwei Suchen nach festem Text statt `<name>([\s\S]*?)</name>`: Das faule
 * Muster setzt bei offenem Tag an jeder Fundstelle neu an — quadratisch. */
function zwischen(text: string, name: string, ab: number):
    { inhalt: string; ende: number } | null {
  const auf = new RegExp(`<${name}>`, 'gi');
  auf.lastIndex = ab;
  const a = auf.exec(text);
  if (!a) return null;
  const zu = new RegExp(`</${name}>`, 'gi');
  zu.lastIndex = auf.lastIndex;
  const z = zu.exec(text);
  if (!z) return null;
  return { inhalt: text.slice(auf.lastIndex, z.index), ende: zu.lastIndex };
}

function feld(block: string, name: string): string | null {
  const m = zwischen(block, name, 0);
  if (!m) return null;
  // Nur die fünf vordefinierten Entitäten; &amp; ZULETZT, sonst würde aus
  // „&amp;lt;" ein „<".
  return m.inhalt.trim()
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export interface LeseErgebnis {
  posten: WantedPosten[];
  fremdeArten: Record<string, number>;
  ohneNummer: number;
}

/** Wirft NICHT bei fremden Arten oder fehlenden Feldern: Eine zu neun Zehnteln
 * brauchbare Liste soll zu neun Zehnteln ankommen; der Rest steht im Ergebnis. */
export function leseWantedListe(xml: string): LeseErgebnis {
  const posten: WantedPosten[] = [];
  const fremdeArten: Record<string, number> = {};
  let ohneNummer = 0;

  let m: { inhalt: string; ende: number } | null;
  for (let ab = 0; (m = zwischen(xml, 'ITEM', ab)) !== null; ab = m.ende) {
    const block = m.inhalt;
    const typ = (feld(block, 'ITEMTYPE') ?? '').toUpperCase();
    const art = ARTEN[typ];
    const blId = feld(block, 'ITEMID');

    if (!blId) { ohneNummer++; continue; }
    if (!art) { fremdeArten[typ || '(ohne)'] = (fremdeArten[typ || '(ohne)'] ?? 0) + 1; continue; }

    const farbeRoh = feld(block, 'COLOR');
    const farbe = farbeRoh === null ? null : parseInt(farbeRoh, 10);
    const mengeRoh = parseInt(feld(block, 'MINQTY') ?? '1', 10);
    const zustandRoh = (feld(block, 'CONDITION') ?? '').toUpperCase();
    const preisRoh = parseFloat(feld(block, 'MAXPRICE') ?? '');

    posten.push({
      art,
      blId,
      // Farbe 0 ist bei BrickLink „(Not Applicable)", keine Farbe.
      blFarbe: farbe !== null && Number.isFinite(farbe) && farbe > 0 ? farbe : null,
      menge: Number.isFinite(mengeRoh) && mengeRoh > 0 ? mengeRoh : 1,
      // X heisst „egal": null, damit die Einstellung des Kontos entscheidet.
      zustand: zustandRoh === 'N' || zustandRoh === 'U' ? zustandRoh : null,
      // MAXPRICE ist eine Suchgrenze, kein Kaufpreis — -1 heisst „keiner".
      maxPreis: Number.isFinite(preisRoh) && preisRoh > 0 ? preisRoh : null,
    });
  }

  return { posten, fremdeArten, ohneNummer };
}

export type Sicherheit =
  | 'zuordnung'
  | 'gleich_vermerkt'
  /** Die Nummer steht so im Rebrickable-Katalog — wahrscheinlich, nicht sicher. */
  | 'katalogtreffer'
  /** Abgebildet UND bestätigt (external_ids.BrickLink); eigene Stufe, damit der
   * Bericht zeigt, was ein Abruf gekostet hat. */
  | 'rebrickable'
  /** Von Hand eingetragen — eigene Stufe, damit der Bericht nicht behauptet, der
   * Katalog habe geliefert, was jemand getippt hat.
   * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#sicherheit */
  | 'korrigiert';

export interface Aufloesung {
  posten: WantedPosten;
  rbId: string | null;
  rbFarbe: number | null;
  /** Reisen mit, weil die Teileliste den Farbnamen von der Zeile liest.
   * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#aufloesung */
  rbFarbName: string | null;
  rbFarbHex: string | null;
  sicherheit: Sicherheit | null;
  farbeOffen: boolean;
}

/** Ohne fremden Abruf; die drei Stufen bleiben getrennt, weil sie verschieden
 * sicher sind.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#loeselokalauf */
export async function loeseLokalAuf(posten: WantedPosten[]): Promise<Aufloesung[]> {
  if (!posten.length) return [];

  // Drei Abfragen für die ganze Liste statt eine je Posten.
  const nummern = [...new Set(posten.map(p => p.blId))];
  const farben = [...new Set(posten.map(p => p.blFarbe).filter((f): f is number => f !== null))];

  const zuordnung = new Map<string, { rbId: string; sicherheit: Sicherheit }>();
  for (const z of await repo.zuordnungen(nummern).catch(meldeUndLiefere('wanted:zuordnung', []))) {
    const schluessel = `${z.art}:${z.bl_id ?? z.rb_id}`;
    const stufe: Sicherheit = z.bl_id ? 'zuordnung' : 'gleich_vermerkt';
    const schon = zuordnung.get(schluessel);
    if (!schon || (schon.sicherheit !== 'zuordnung' && stufe === 'zuordnung')) {
      zuordnung.set(schluessel, { rbId: z.rb_id, sicherheit: stufe });
    }
  }

  const katalog = new Set<string>();
  for (const art of ['part', 'fig', 'set'] as const) {
    for (const n of await repo.nummernImKatalog(art, nummern).catch(meldeUndLiefere('wanted:katalog', []))) katalog.add(`${art}:${n}`);
  }

  const farbMap = new Map<number, { id: number; name: string | null; hex: string | null }>();
  for (const z of await repo.farbenZuBlFarben(farben).catch(meldeUndLiefere('wanted:farben', []))) {
    farbMap.set(Number(z.bl_color_id), {
      id: Number(z.id), name: z.name ?? null, hex: z.rgb ?? null,
    });
  }

  return posten.map((p) => {
    const treffer = zuordnung.get(`${p.art}:${p.blId}`);
    let rbId: string | null = null;
    let sicherheit: Sicherheit | null = null;
    if (treffer) { rbId = treffer.rbId; sicherheit = treffer.sicherheit; }
    else if (katalog.has(`${p.art}:${p.blId}`)) { rbId = p.blId; sicherheit = 'katalogtreffer'; }

    const farbe = p.blFarbe === null ? null : (farbMap.get(p.blFarbe) ?? null);
    return {
      posten: p, rbId, rbFarbe: farbe?.id ?? null,
      rbFarbName: farbe?.name ?? null, rbFarbHex: farbe?.hex ?? null,
      sicherheit,
      farbeOffen: rbId !== null && p.blFarbe !== null && farbe === null,
    };
  });
}

/** Rebrickable ist der einzige direkte Weg von BL- zu RB-Nummern.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#abschnitt-2 */
/** Zwei Phasen, weil die Rebrickable-Abrufe ungleich länger dauern.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#wantedfortschritt */
export type WantedFortschritt = {
  phase: 'rebrickable' | 'schreiben';
  fertig: number;
  gesamt: number;
};

export async function loeseUeberRebrickableAuf(
  auf: Aufloesung[], grenze = 250,
  fortschritt?: (stand: WantedFortschritt) => void,
): Promise<{ auf: Aufloesung[]; gefragt: number; gefunden: number; filterWirkungslos: boolean }> {
  let gefragt = 0, gefunden = 0;

  const ergebnis = [...auf];
  // Genau die Bedingungen der Schleife darunter, sonst zählt der Balken gegen
  // eine andere Zahl als er füllt.
  const gesamt = Math.min(grenze,
    ergebnis.filter(a => a.rbId === null && a.posten.art === 'part').length);
  for (let i = 0; i < ergebnis.length; i++) {
    const a = ergebnis[i]!;
    if (a.rbId !== null) continue;
    if (a.posten.art !== 'part') continue;
    if (gefragt >= grenze) break;

    gefragt++;
    let rbId: string | null = null;
    // Ein gescheiterter Abruf beendet nicht den Lauf: Die übrigen Posten sind
    // davon unberührt.
    try { rbId = await blTeilZuRb(a.posten.blId); } catch { rbId = null; }
    if (rbId) {
      gefunden++;
      ergebnis[i] = { ...a, rbId, sicherheit: 'rebrickable' };
    }
    // Nach dem Abruf: „37 von 50" heisst 37 erledigt.
    fortschritt?.({ phase: 'rebrickable', fertig: gefragt, gesamt });
  }
  return { auf: ergebnis, gefragt, gefunden, filterWirkungslos: blFilterWirkungslos() };
}

/** Bild und Name reisen mit, weil die Vorschau sie wie die Teileliste zeigt.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#postenergebnis */
export interface PostenErgebnis {
  blId: string;
  art: WantedArt;
  blFarbe: number | null;
  menge: number;
  zustand: string | null;
  /** Je Stück; steht im Bericht, weil die Vorschau ihn änderbar zeigt. */
  maxPreis: number | null;
  rbId: string | null;
  rbFarbe: number | null;
  sicherheit: Sicherheit | null;
  ausgang: 'angelegt' | 'aufgestockt' | 'offen' | 'fehler';
  grund?: string;
  /** Kennung statt Satz, damit die Oberfläche in der Sprache des Betrachters setzt.
   * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#postenergebnis-2 */
  grundCode?: 'nummer_unbekannt' | 'farbe_unbekannt';
  /** Beschreibung aus dem Katalog — leer, wenn er die Nummer nicht kennt. */
  name?: string | null;
  bild?: string | null;
  /** Name und Bild unter der BL-Nummer gefunden, nicht über eine Abbildung — die
   * Oberfläche muss das kennzeichnen. */
  nameGeraten?: boolean;
  farbName?: string | null;
  farbHex?: string | null;
}

/** Adressiert über den Index: Dieselbe Nummer darf mehrfach in der Liste stehen.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#korrektur */
export interface Korrektur {
  index: number;
  /** Gegenprobe — muss zu dem Posten an [index] passen. */
  blId: string;
  art: WantedArt;
  rbId?: string | null;
  rbFarbe?: number | null;
  /** Die Werte aus der Datei, von Hand geändert, damit ein Vertipper nicht ein
   * erneutes Einlesen erzwingt.
   * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#korrektur-2 */
  menge?: number;
  /** null heisst „Standard des Kontos". */
  zustand?: string | null;
  /** null heisst „keiner, hol den Marktpreis". */
  kaufpreis?: number | null;
}

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

/** Drei Abfragen für die ganze Liste, nicht eine je Posten.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#beschreibeposten */
export async function beschreibePosten(
  auf: Aufloesung[],
): Promise<Map<number, { name: string | null; bild: string | null; geraten: boolean }>> {
  const raus = new Map<number, { name: string | null; bild: string | null; geraten: boolean }>();

  // Ohne Rebrickable-Nummer gilt die BrickLink-Nummer als Schlüssel.
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
    const zeilen = await repo.teileBeschreibung(nummern).catch(meldeUndLiefere('wanted:teile', []));
    const nachNummer = new Map(zeilen.map(z => [z.part_number, z]));
    const paare = teile.filter(t => t.farbe !== null);
    const bilder = new Map<string, string>();
    if (paare.length) {
      const farbZeilen = await repo.teilFarbbilder(paare.map(t => t.nr), paare.map(t => t.farbe as number))
        .catch(meldeUndLiefere('wanted:farbbilder', []));
      for (const z of farbZeilen) if (z.bild) bilder.set(`${z.part_number}|${z.color_id}`, z.bild);
    }
    for (const t of teile) {
      const z = nachNummer.get(t.nr);
      const name = z?.name ?? null;
      const bild = bilder.get(`${t.nr}|${t.farbe}`) || z?.bild_allgemein || null;
      // `geraten` nur bei einem Fund: Eine leere Zeile „geraten" zu nennen wäre
      // eine Behauptung über nichts.
      raus.set(t.i, { name, bild, geraten: t.geraten && !!(name || bild) });
    }
  }

  if (figuren.length) {
    const zeilen = await repo.figurenBeschreibung([...new Set(figuren.map(f => f.nr))])
      .catch(meldeUndLiefere('wanted:figuren', []));
    const nach = new Map(zeilen.map(z => [z.fig_number, z]));
    for (const f of figuren) {
      const z = nach.get(f.nr);
      const name = z?.fig_name ?? null, bild = z?.bild ?? null;
      raus.set(f.i, { name, bild, geraten: f.geraten && !!(name || bild) });
    }
  }

  if (sets.length) {
    const nummern = [...new Set(sets.map(x => x.nr))];
    const zeilen = await repo.setsBeschreibung(nummern).catch(meldeUndLiefere('wanted:sets', []));
    const nach = new Map(zeilen.map(z => [z.set_number, z]));
    for (const x of sets) {
      const z = nach.get(x.nr);
      const name = z?.name ?? null, bild = z?.bild ?? null;
      raus.set(x.i, { name, bild, geraten: x.geraten && !!(name || bild) });
    }
  }

  return raus;
}

/** Jede Korrektur wird gegen Art und Nummer am Index geprüft, sonst wirkte sie
 * nach Dateiwechsel lautlos auf einen fremden Posten.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#wendekorrekturenan */
function wendeKorrekturenAn(
  auf: Aufloesung[], korrekturen: Korrektur[],
): { auf: Aufloesung[]; angewandt: number; abgewiesen: Korrektur[] } {
  const ergebnis = [...auf];
  const abgewiesen: Korrektur[] = [];
  let angewandt = 0;
  for (const k of korrekturen) {
    const a = ergebnis[k.index];
    if (!a || a.posten.art !== k.art || a.posten.blId !== k.blId) { abgewiesen.push(k); continue; }
    // `undefined` heisst „nicht angefasst", `null` „ausdrücklich geleert" — sonst
    // löschte eine Korrektur der Farbe die Nummer mit.
    const rbId    = k.rbId    === undefined ? a.rbId    : (k.rbId || null);
    const rbFarbe = k.rbFarbe === undefined ? a.rbFarbe : (k.rbFarbe ?? null);

    // Eine unbrauchbare Angabe weist die ganze Korrektur ab statt sie still
    // zurechtzubiegen: Menge 0 ist ein Vertipper, keine 1.
    let menge = a.posten.menge;
    if (k.menge !== undefined) {
      const m = Math.trunc(Number(k.menge));
      if (!Number.isFinite(m) || m < 1) { abgewiesen.push(k); continue; }
      menge = m;
    }
    let zustand = a.posten.zustand;
    if (k.zustand !== undefined) {
      // null/'' heisst „Standard des Kontos" wie CONDITION=X; alles andere als N/U
      // ist ein Fehler, nicht „egal".
      if (k.zustand === null || k.zustand === '') zustand = null;
      else if (k.zustand === 'N' || k.zustand === 'U') zustand = k.zustand;
      else { abgewiesen.push(k); continue; }
    }
    let maxPreis = a.posten.maxPreis;
    if (k.kaufpreis !== undefined) {
      if (k.kaufpreis === null || (k.kaufpreis as unknown) === '') maxPreis = null;
      else {
        const p = Number(k.kaufpreis);
        // 0 heisst „keiner", wie MAXPRICE beim Leser.
        if (!Number.isFinite(p) || p < 0) { abgewiesen.push(k); continue; }
        maxPreis = p > 0 ? p : null;
      }
    }

    const nummerGeaendert = rbId !== a.rbId || rbFarbe !== a.rbFarbe;
    const postenGeaendert = menge !== a.posten.menge || zustand !== a.posten.zustand
                            || maxPreis !== a.posten.maxPreis;
    if (!nummerGeaendert && !postenGeaendert) continue;   // nichts geändert

    ergebnis[k.index] = {
      ...a, rbId, rbFarbe,
      ...(postenGeaendert ? { posten: { ...a.posten, menge, zustand, maxPreis } } : {}),
      // Der Farbname gehörte zur alten Nummer und wird unten neu geholt.
      rbFarbName: rbFarbe === a.rbFarbe ? a.rbFarbName : null,
      rbFarbHex:  rbFarbe === a.rbFarbe ? a.rbFarbHex  : null,
      // `korrigiert` nur bei geänderter Nummer: Die Stufe entscheidet, ob die
      // Zuordnung gemerkt wird; eine geänderte Menge sagt nichts über die Nummer.
      sicherheit: nummerGeaendert ? 'korrigiert' : a.sicherheit,
      farbeOffen: rbId !== null && a.posten.blFarbe !== null && rbFarbe === null,
    };
    angewandt++;
  }
  return { auf: ergebnis, angewandt, abgewiesen };
}

/** Eine von Hand eingetragene Farbe war in der Auflösung nicht dabei; ohne
 * diesen Schritt ginge sie ohne Namen an den Anleger. */
async function farbenNachtragen(auf: Aufloesung[]): Promise<Aufloesung[]> {
  const offen = auf.filter(a => a.rbFarbe !== null && a.rbFarbName === null)
                   .map(a => a.rbFarbe as number);
  if (!offen.length) return auf;
  const zeilen = await repo.farbenZuIds([...new Set(offen)]).catch(meldeUndLiefere('wanted:farbnamen', []));
  const nach = new Map(zeilen.map(z => [Number(z.id), z]));
  return auf.map(a => {
    if (a.rbFarbe === null || a.rbFarbName !== null) return a;
    const z = nach.get(a.rbFarbe);
    return z ? { ...a, rbFarbName: z.name ?? null, rbFarbHex: z.rgb ?? null } : a;
  });
}

function zaehleStufen(auf: Aufloesung[]): Record<string, number> {
  const z: Record<string, number> = {};
  for (const a of auf) if (a.sicherheit) z[a.sicherheit] = (z[a.sicherheit] ?? 0) + 1;
  return z;
}

/** Vorschau und Ernstfall gehen denselben Weg, damit die Vorschau nichts
 * verspricht, was der Import nicht tut.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#abschnitt-3 */
/** Als Schnittstelle: Die Route steckt die echten Funktionen hinein, ein Test Zähler.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#anleger */
export interface Anleger {
  teil: (uid: number, body: Record<string, unknown>) => Promise<unknown>;
  figur: (uid: number, body: Record<string, unknown>) => Promise<unknown>;
  set: (uid: number, setNummer: string, menge: number,
        zustand: string | null, kaufpreis: number | null) => Promise<unknown>;
}

export async function importiereWantedListe(
  uid: number, xml: string,
  opt: {
    vorschau?: boolean; ueberRebrickable?: boolean; anleger?: Anleger;
    korrekturen?: Korrektur[];
    /** Hereingegeben, damit diese Funktion bis auf den Anleger schreibfrei bleibt.
     * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#importierewantedliste */
    merkeNummer?: (art: WantedArt, rbId: string, blId: string) => Promise<unknown>;
    /** Wird SYNCHRON gerufen und darf nichts werfen.
     * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#importierewantedliste-2 */
    fortschritt?: (stand: WantedFortschritt) => void;
    /** Der Balken in der Oberfläche trägt ein Kreuz; ohne diese Frage hätte er einen
     * Abbrechen-Knopf, der lügt.
     * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#importierewantedliste-3 */
    abbruch?: () => Promise<boolean>;
  } = {},
): Promise<WantedBericht> {
  const gelesen = leseWantedListe(xml);
  let auf = await loeseLokalAuf(gelesen.posten);

  let rebrickable: WantedBericht['rebrickable'];
  if (opt.ueberRebrickable) {
    const r = await loeseUeberRebrickableAuf(auf, 250, opt.fortschritt);
    auf = r.auf;
    rebrickable = { gefragt: r.gefragt, gefunden: r.gefunden,
                    filterWirkungslos: r.filterWirkungslos };
  }

  // Nach dem Auflösen, weil Korrekturen es überstimmen; vor dem Zählen, weil der
  // Bericht sonst Zahlen von vor der Korrektur nennt.
  let korrekturen: WantedBericht['korrekturen'];
  if (opt.korrekturen?.length) {
    const k = wendeKorrekturenAn(auf, opt.korrekturen);
    auf = await farbenNachtragen(k.auf);
    korrekturen = { angewandt: k.angewandt, abgewiesen: k.abgewiesen };
  }

  const bericht: WantedBericht = {
    gelesen: gelesen.posten.length,
    fremdeArten: gelesen.fremdeArten,
    ohneNummer: gelesen.ohneNummer,
    stufen: zaehleStufen(auf),
    farbeOffen: auf.filter(a => a.farbeOffen).length,
    offen: auf.filter(a => a.rbId === null)
              .map(a => ({ blId: a.posten.blId, art: a.posten.art, blFarbe: a.posten.blFarbe })),
    ...(rebrickable ? { rebrickable } : {}),
    ...(korrekturen ? { korrekturen } : {}),
    angelegt: 0, aufgestockt: 0, fehler: 0,
    vorschau: !!opt.vorschau,
    standardZustand: await nutzerStandardZustand(uid),
    posten: [],
  };

  let lfd = -1;
  const melde = () => opt.fortschritt?.(
    { phase: 'schreiben', fertig: lfd + 1, gesamt: auf.length });

  for (const a of auf) {
    // Der Takt zählt über ALLE Posten, sonst hinge er daran, wie viele auflösbar waren.
    if (opt.abbruch && !opt.vorschau && lfd >= 0 && (lfd + 1) % 10 === 0) {
      if (await opt.abbruch()) { bericht.abgebrochen = true; break; }
    }
    // Eine nicht abbildbare Farbe wird nicht erfunden: color_id 0 ist bei
    // Rebrickable Schwarz, nicht „keine Farbe".
    // Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#importierewantedliste-grund
    const grund = a.rbId === null
      ? 'Zu dieser BrickLink-Nummer ist keine Rebrickable-Nummer bekannt'
      : a.farbeOffen
        ? `BrickLink-Farbe ${a.posten.blFarbe} ist im Katalog keiner Rebrickable-Farbe zugeordnet`
        : undefined;
    const grundCode: PostenErgebnis['grundCode'] = a.rbId === null
      ? 'nummer_unbekannt'
      : a.farbeOffen ? 'farbe_unbekannt' : undefined;
    // Eigene Bindung: TypeScript verengt `a.rbId` über eine Hilfsvariable nicht.
    const rbId = a.rbId;
    const offen = rbId === null || a.farbeOffen;
    lfd++;
    const zeile: PostenErgebnis = {
      blId: a.posten.blId, art: a.posten.art,
      blFarbe: a.posten.blFarbe, menge: a.posten.menge, zustand: a.posten.zustand ?? null,
      maxPreis: a.posten.maxPreis ?? null,
      rbId: a.rbId, rbFarbe: a.rbFarbe,
      sicherheit: a.sicherheit, ausgang: a.rbId === null ? 'offen' : 'angelegt',
      ...(grund ? { grund } : {}),
      ...(grundCode ? { grundCode } : {}),
      farbName: a.rbFarbName, farbHex: a.rbFarbHex,
    };
    if (rbId === null || a.farbeOffen || opt.vorschau) {
      // In der Vorschau heisst „angelegt" „würde angelegt".
      if (offen) zeile.ausgang = 'offen';
      bericht.posten.push(zeile);
      // Auch ein übersprungener Posten ist erledigt, sonst bliebe der Balken stehen.
      melde();
      continue;
    }

    try {
      if (!opt.anleger) throw new Error('Kein Anleger übergeben — siehe Anleger');
      let rueckmeldung: unknown;
      if (a.posten.art === 'part') {
        // Der Farbname reist mit: Die Teileliste liest ihn von der Zeile, ohne ihn
        // fällt sie nicht auf den Katalog zurück.
        rueckmeldung = await opt.anleger.teil(uid, {
          part_number: rbId,
          color_id: a.rbFarbe ?? 0,
          ...(a.rbFarbName ? { color_name: a.rbFarbName } : {}),
          ...(a.rbFarbHex ? { color_hex: a.rbFarbHex } : {}),
          quantity: a.posten.menge,
          condition: a.posten.zustand ?? undefined,
          // `undefined` statt `null`: Die Anleger unterscheiden „nichts angegeben"
          // (Marktpreis) von einer ausdrücklichen Null.
          ...(a.posten.maxPreis !== null ? { unit_price: a.posten.maxPreis } : {}),
        });
      } else if (a.posten.art === 'fig') {
        rueckmeldung = await opt.anleger.figur(uid, {
          fig_number: rbId,
          quantity: a.posten.menge,
          condition: a.posten.zustand ?? undefined,
          ...(a.posten.maxPreis !== null ? { unit_price: a.posten.maxPreis } : {}),
        });
      } else {
        rueckmeldung = await opt.anleger.set(uid, rbId, a.posten.menge,
                                             a.posten.zustand, a.posten.maxPreis);
      }
      // Der Anleger weiss, ob angelegt oder aufgestockt; ohne die Frage zählte ein
      // zweiter Import alles als angelegt.
      const wieAngelegt = (rueckmeldung as { action?: string } | null | undefined)?.action !== 'updated';
      if (wieAngelegt) bericht.angelegt++; else bericht.aufgestockt++;
      zeile.ausgang = wieAngelegt ? 'angelegt' : 'aufgestockt';

      // Auch 'rebrickable' wird gemerkt: blTeilZuRb prüft jeden Treffer gegen die
      // gesuchte BL-Nummer, es ist eine Abbildung, keine Vermutung.
      // Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#importierewantedliste-4
      if ((a.sicherheit === 'korrigiert' || a.sicherheit === 'rebrickable') && opt.merkeNummer) {
        await opt.merkeNummer(a.posten.art, rbId, a.posten.blId)
          .catch(() => { /* siehe oben */ });
      }
    } catch (e: unknown) {
      bericht.fehler++;
      zeile.ausgang = 'fehler';
      zeile.grund = e instanceof Error ? e.message : String(e);
    }
    bericht.posten.push(zeile);
    // Nach Erfolg UND Fehlschlag, sonst bliebe der Balken bei Fehlern stehen.
    melde();
  }

  // Auch nach dem Schreiben: Der Dialog zeichnet dieselbe Tabelle mit der
  // Antwort neu und zeigte sonst leere Zellen.
  // Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#importierewantedliste-beschreibung
  const beschreibung = await beschreibePosten(auf);
  bericht.posten.forEach((zeile, i) => {
    const b = beschreibung.get(i);
    if (!b) return;
    zeile.name = b.name;
    zeile.bild = b.bild;
    zeile.nameGeraten = b.geraten;
  });

  return bericht;
}
