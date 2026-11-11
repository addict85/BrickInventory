/** BL-Nummern der Wanted-Liste auf Rebrickable-Nummern abbilden: zuerst lokal
 * (Zuordnungen, Katalog), dann über Rebrickable, zuletzt die Korrekturen von Hand. */
import { blTeilZuRb, blFilterWirkungslos, RebrickableGesperrt } from '../katalog';
import { meldeFehler } from '../infra/fehler';
import type { WantedArt, WantedPosten } from './wantedParser';
import { merklisteBereich } from './prozess';

export type Sicherheit =
  | 'zuordnung'
  | 'gleich_vermerkt'
  /** Die Nummer steht so im Rebrickable-Katalog — wahrscheinlich, nicht sicher. */
  | 'katalogtreffer'
  /** Abgebildet UND bestätigt (external_ids.BrickLink); eigene Stufe, damit der
   * Bericht zeigt, was ein Abruf gekostet hat. */
  | 'rebrickable'
  /** Von Hand eingetragen — eigene Stufe, damit der Bericht nicht behauptet, der
   * Katalog habe geliefert, was jemand getippt hat. */
  | 'korrigiert';

export interface Aufloesung {
  posten: WantedPosten;
  rbId: string | null;
  rbFarbe: number | null;
  /** Reisen mit, weil die Teileliste den Farbnamen von der Zeile liest. */
  rbFarbName: string | null;
  rbFarbHex: string | null;
  sicherheit: Sicherheit | null;
  farbeOffen: boolean;
}

/** Ohne fremden Abruf; die drei Stufen bleiben getrennt, weil sie verschieden
 * sicher sind. */
export async function loeseLokalAuf(posten: WantedPosten[], uid: number | null = null): Promise<Aufloesung[]> {
  if (!posten.length) return [];

  // Drei Abfragen für die ganze Liste statt eine je Posten.
  const nummern = [...new Set(posten.map(p => p.blId))];
  const farben = [...new Set(posten.map(p => p.blFarbe).filter((f): f is number => f !== null))];

  const zuordnung = new Map<string, { rbId: string; sicherheit: Sicherheit }>();
  const eigene = new Set<string>();
  for (const z of await merklisteBereich().wantedListe.zuordnungen(nummern, uid)) {
    const schluessel = `${z.art}:${z.bl_id ?? z.rb_id}`;
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
    for (const n of await merklisteBereich().wantedListe.nummernImKatalog(art, nummern)) katalog.add(`${art}:${n}`);
  }

  const farbMap = new Map<number, { id: number; name: string | null; hex: string | null }>();
  for (const z of await merklisteBereich().wantedListe.farbenZuBlFarben(farben)) {
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

/** Rebrickable ist der einzige direkte Weg von BL- zu RB-Nummern. */
export type RebrickableAbbruch = 'kontingent' | 'kein_schluessel' | 'stoerung';
/** Zwei Phasen, weil die Rebrickable-Abrufe ungleich länger dauern. */
export type WantedFortschritt = {
  phase: 'rebrickable' | 'schreiben';
  fertig: number;
  gesamt: number;
};

export async function loeseUeberRebrickableAuf(
  auf: Aufloesung[],
  grenze = 250,
  fortschritt?: (stand: WantedFortschritt) => void,
): Promise<{
  auf: Aufloesung[];
  gefragt: number;
  gefunden: number;
  filterWirkungslos: boolean;
  abgebrochen?: RebrickableAbbruch;
}> {
  let gefragt = 0,
    gefunden = 0;

  const ergebnis = [...auf];
  // Genau die Bedingungen der Schleife darunter, sonst zählt der Balken gegen
  // eine andere Zahl als er füllt.
  const gesamt = Math.min(grenze, ergebnis.filter(a => a.rbId === null && a.posten.art === 'part').length);
  for (let i = 0; i < ergebnis.length; i++) {
    const a = ergebnis[i]!;
    if (a.rbId !== null) continue;
    if (a.posten.art !== 'part') continue;
    if (gefragt >= grenze) break;

    gefragt++;
    let rbId: string | null;
    // Ein Fehler ausser „unbekannt“ trifft auch alle folgenden Posten; der Bericht
    // nennt den Grund, statt sie still als „nicht gefunden“ zu zählen.
    try {
      rbId = await blTeilZuRb(a.posten.blId);
    } catch (e) {
      if (!(e instanceof RebrickableGesperrt)) meldeFehler('wanted:rebrickable', e);
      const abgebrochen = e instanceof RebrickableGesperrt ? e.grund : 'stoerung';
      return { auf: ergebnis, gefragt, gefunden, filterWirkungslos: blFilterWirkungslos(), abgebrochen };
    }
    if (rbId) {
      gefunden++;
      ergebnis[i] = { ...a, rbId, sicherheit: 'rebrickable' };
    }
    // Nach dem Abruf: „37 von 50" heisst 37 erledigt.
    fortschritt?.({ phase: 'rebrickable', fertig: gefragt, gesamt });
  }
  return { auf: ergebnis, gefragt, gefunden, filterWirkungslos: blFilterWirkungslos() };
}

/** Adressiert über den Index: Dieselbe Nummer darf mehrfach in der Liste stehen. */
export interface Korrektur {
  index: number;
  /** Gegenprobe — muss zu dem Posten an [index] passen. */
  blId: string;
  art: WantedArt;
  rbId?: string | null | undefined;
  rbFarbe?: number | null | undefined;
  /** Die Werte aus der Datei, von Hand geändert, damit ein Vertipper nicht ein
   * erneutes Einlesen erzwingt. */
  menge?: number | undefined;
  /** null heisst „Standard des Kontos". */
  zustand?: string | null | undefined;
  /** null heisst „keiner, hol den Marktpreis". */
  kaufpreis?: number | null | undefined;
}

/** Drei Abfragen für die ganze Liste, nicht eine je Posten. */
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
    const zeilen = await merklisteBereich().wantedListe.teileBeschreibung(nummern);
    const nachNummer = new Map(zeilen.map(z => [z.part_number, z]));
    const paare = teile.filter(t => t.farbe !== null);
    const bilder = new Map<string, string>();
    if (paare.length) {
      const farbZeilen = await merklisteBereich().wantedListe.teilFarbbilder(
        paare.map(t => t.nr),
        paare.map(t => t.farbe as number),
      );
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
    const zeilen = await merklisteBereich().wantedListe.figurenBeschreibung([...new Set(figuren.map(f => f.nr))]);
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
    const zeilen = await merklisteBereich().wantedListe.setsBeschreibung(nummern);
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

/** Jede Korrektur wird gegen Art und Nummer am Index geprüft, sonst wirkte sie
 * nach Dateiwechsel lautlos auf einen fremden Posten. */
export function wendeKorrekturenAn(
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
    // `undefined` heisst „nicht angefasst", `null` „ausdrücklich geleert" — sonst
    // löschte eine Korrektur der Farbe die Nummer mit.
    const rbId = k.rbId === undefined ? a.rbId : k.rbId || null;
    const rbFarbe = k.rbFarbe === undefined ? a.rbFarbe : (k.rbFarbe ?? null);

    // Eine unbrauchbare Angabe weist die ganze Korrektur ab statt sie still
    // zurechtzubiegen: Menge 0 ist ein Vertipper, keine 1.
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
      // null/'' heisst „Standard des Kontos" wie CONDITION=X; alles andere als N/U
      // ist ein Fehler, nicht „egal".
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
        // 0 heisst „keiner", wie MAXPRICE beim Leser.
        if (!Number.isFinite(p) || p < 0) {
          abgewiesen.push(k);
          continue;
        }
        maxPreis = p > 0 ? p : null;
      }
    }

    const nummerGeaendert = rbId !== a.rbId || rbFarbe !== a.rbFarbe;
    const postenGeaendert = menge !== a.posten.menge || zustand !== a.posten.zustand || maxPreis !== a.posten.maxPreis;
    if (!nummerGeaendert && !postenGeaendert) continue; // nichts geändert

    ergebnis[k.index] = {
      ...a,
      rbId,
      rbFarbe,
      ...(postenGeaendert ? { posten: { ...a.posten, menge, zustand, maxPreis } } : {}),
      // Der Farbname gehörte zur alten Nummer und wird unten neu geholt.
      rbFarbName: rbFarbe === a.rbFarbe ? a.rbFarbName : null,
      rbFarbHex: rbFarbe === a.rbFarbe ? a.rbFarbHex : null,
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
export async function farbenNachtragen(auf: Aufloesung[]): Promise<Aufloesung[]> {
  const offen = auf.filter(a => a.rbFarbe !== null && a.rbFarbName === null).map(a => a.rbFarbe as number);
  if (!offen.length) return auf;
  const zeilen = await merklisteBereich().wantedListe.farbenZuIds([...new Set(offen)]);
  const nach = new Map(zeilen.map(z => [Number(z.id), z]));
  return auf.map(a => {
    if (a.rbFarbe === null || a.rbFarbName !== null) return a;
    const z = nach.get(a.rbFarbe);
    return z ? { ...a, rbFarbName: z.name ?? null, rbFarbHex: z.rgb ?? null } : a;
  });
}
