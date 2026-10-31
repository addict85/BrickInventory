/**
 * BrickLink-Wanted-Listen lesen und auf Rebrickable-Nummern abbilden.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#abschnitt
 */
import { blTeilZuRb, blFilterWirkungslos } from '../../clients/rebrickable';
import * as db from '../../db/database';
import { nutzerStandardZustand } from '../konto/settings';

/** Die drei Arten, die diese Anwendung führt. */
export type WantedArt = 'part' | 'fig' | 'set';

/**
 * BrickLinks Artencodes, soweit sie hier etwas bedeuten.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#arten
 */
const ARTEN: Record<string, WantedArt> = { P: 'part', M: 'fig', S: 'set' };

/** Ein Posten, wie er in der Datei steht — noch ganz in BrickLink-Begriffen. */
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

/**
 * Der Inhalt zwischen `<name>` und dem nächsten `</name>` ab `ab`.
 *
 * Zwei Suchen nach festem Text statt `<name>([\s\S]*?)</name>`: Das faule
 * Muster setzt bei einem offenen Tag ohne Ende an JEDER Fundstelle neu an und
 * läuft bis ans Dateiende — quadratisch. Fehlt das Ende nach dem ersten Tag,
 * fehlt es auch nach jedem späteren; dann ist Schluss.
 */
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

/** Ein Textfeld aus einem ITEM-Block. */
function feld(block: string, name: string): string | null {
  const m = zwischen(block, name, 0);
  if (!m) return null;
  // Die fünf vordefinierten Entitäten. Mehr kommt in einer Wanted-Liste nicht
  // vor; käme etwas, bliebe es stehen und fiele auf, statt still falsch zu
  // werden. &amp; ZULETZT — sonst würde aus „&amp;lt;" ein „<".
  return m.inhalt.trim()
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export interface LeseErgebnis {
  posten: WantedPosten[];
  /** Posten mit einer Art, die diese Anwendung nicht führt — je Code gezählt. */
  fremdeArten: Record<string, number>;
  /** ITEM-Blöcke ohne ITEMID. */
  ohneNummer: number;
}

/**
 * Eine Wanted-Liste lesen.
 *
 * Wirft NICHT bei fremden Arten oder fehlenden Feldern: Eine Liste, die zu
 * neun Zehnteln brauchbar ist, soll zu neun Zehnteln ankommen. Was nicht
 * geht, steht im Ergebnis.
 */
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
      // Farbe 0 ist bei BrickLink „(Not Applicable)" und keine Farbe. Bei
      // Sets steht ohnehin keine.
      blFarbe: farbe !== null && Number.isFinite(farbe) && farbe > 0 ? farbe : null,
      menge: Number.isFinite(mengeRoh) && mengeRoh > 0 ? mengeRoh : 1,
      // X heisst „egal". Als null weitergegeben, damit darüber die Einstellung
      // des Kontos entscheidet und nicht diese Datei — dieselbe Regel wie beim
      // Merklisten-Import.
      zustand: zustandRoh === 'N' || zustandRoh === 'U' ? zustandRoh : null,
      // -1.0000 heisst „kein Höchstpreis". Der Wert ist ohnehin kein
      // Kaufpreis, sondern eine Preisgrenze beim Suchen — er wird NICHT als
      // Kaufpreis übernommen (siehe die Begründung an der Route).
      maxPreis: Number.isFinite(preisRoh) && preisRoh > 0 ? preisRoh : null,
    });
  }

  return { posten, fremdeArten, ohneNummer };
}

/** Wie sicher eine Zuordnung ist. */
export type Sicherheit =
  /** bl_zuordnung kennt die Nummer ausdrücklich. */
  | 'zuordnung'
  /** bl_zuordnung sagt „keine abweichende Nummer" (bl_id IS NULL). */
  | 'gleich_vermerkt'
  /** Die Nummer steht so im Rebrickable-Katalog — niemand hat BrickLink dazu
   *  nachgesehen. WAHRSCHEINLICH, nicht sicher. */
  | 'katalogtreffer'
  /**
   * Rebrickable hat die Abbildung geliefert UND sie bestätigt: Der Treffer
   * trägt die gesuchte Nummer in external_ids.BrickLink. Das ist so sicher wie
   * Stufe 1, nur frisch geholt statt gespeichert — und deshalb eine eigene
   * Stufe, damit im Bericht steht, was ein Abruf gekostet hat.
   */
  | 'rebrickable'
  /**
   * Der Mensch hat sie in der Vorschau EINGETRAGEN.
   * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#sicherheit
   */
  | 'korrigiert';

export interface Aufloesung {
  posten: WantedPosten;
  /** Die Rebrickable-Nummer — null, wenn lokal nichts zu finden war. */
  rbId: string | null;
  /** Die Rebrickable-Farbnummer — null bei Sets und wenn nichts zu finden war. */
  rbFarbe: number | null;
  /**
   * Name und Farbwert zur Nummer — beide aus rb_colors.
   * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#aufloesung
   */
  rbFarbName: string | null;
  rbFarbHex: string | null;
  /** Woher die Nummer kommt. */
  sicherheit: Sicherheit | null;
  /** Die Farbe liess sich nicht abbilden, die Nummer schon. */
  farbeOffen: boolean;
}

/**
 * Lokal auflösen — ohne jeden Abruf bei einem fremden Dienst.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#loeselokalauf
 */
export async function loeseLokalAuf(posten: WantedPosten[]): Promise<Aufloesung[]> {
  if (!posten.length) return [];

  // Alles in DREI Abfragen statt in 224: Eine Abfrage je Posten wäre bei
  // Marcos Datei 672 Rundläufe zur Datenbank.
  const nummern = [...new Set(posten.map(p => p.blId))];
  const farben = [...new Set(posten.map(p => p.blFarbe).filter((f): f is number => f !== null))];

  const zuordnung = new Map<string, { rbId: string; sicherheit: Sicherheit }>();
  for (const z of await db.all(
    `SELECT art, rb_id, bl_id FROM bl_zuordnung
      WHERE (bl_id = ANY($1) OR (bl_id IS NULL AND rb_id = ANY($1)))`, [nummern])
    .catch(() => [])) {
    const schluessel = `${z.art}:${z.bl_id ?? z.rb_id}`;
    // Eine ausdrückliche Zuordnung gewinnt gegen einen NULL-Vermerk.
    const stufe: Sicherheit = z.bl_id ? 'zuordnung' : 'gleich_vermerkt';
    const schon = zuordnung.get(schluessel);
    if (!schon || (schon.sicherheit !== 'zuordnung' && stufe === 'zuordnung')) {
      zuordnung.set(schluessel, { rbId: z.rb_id, sicherheit: stufe });
    }
  }

  // Stufe 3 je Art im eigenen Katalog.
  const katalog = new Set<string>();
  for (const [art, sql] of [
    ['part', 'SELECT part_number AS n FROM part_catalog WHERE part_number = ANY($1)'],
    ['fig',  'SELECT fig_number AS n FROM minifigs_catalog WHERE fig_number = ANY($1)'],
    ['set',  'SELECT set_number AS n FROM set_catalog WHERE set_number = ANY($1)'],
  ] as const) {
    for (const z of await db.all(sql, [nummern]).catch(() => [])) katalog.add(`${art}:${z.n}`);
  }

  const farbMap = new Map<number, { id: number; name: string | null; hex: string | null }>();
  for (const z of await db.all(
    'SELECT id, name, rgb, bl_color_id FROM rb_colors WHERE bl_color_id = ANY($1)', [farben]).catch(() => [])) {
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

/**
 * Die offenen Posten über Rebrickable auflösen.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#abschnitt-2
 */
/**
 * Wie weit ist der Import? — für den Balken in der Oberfläche.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#wantedfortschritt
 */
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
  // Wie viele Abrufe es HÖCHSTENS werden. Genau die Bedingungen der Schleife
  // darunter, sonst zählt der Balken gegen eine andere Zahl als er füllt.
  const gesamt = Math.min(grenze,
    ergebnis.filter(a => a.rbId === null && a.posten.art === 'part').length);
  for (let i = 0; i < ergebnis.length; i++) {
    const a = ergebnis[i]!;
    if (a.rbId !== null) continue;
    if (a.posten.art !== 'part') continue;
    if (gefragt >= grenze) break;

    gefragt++;
    let rbId: string | null = null;
    // Ein Abruf, der scheitert (Netz, Kontingent, 500), beendet NICHT den
    // ganzen Lauf: Die übrigen Posten sind davon unberührt, und ein Import,
    // der an Posten 150 von 224 abbricht, lässt den Nutzer im Dunkeln.
    try { rbId = await blTeilZuRb(a.posten.blId); } catch { rbId = null; }
    if (rbId) {
      gefunden++;
      ergebnis[i] = { ...a, rbId, sicherheit: 'rebrickable' };
    }
    // NACH dem Abruf melden, nicht davor: „37 von 50" soll heissen, dass 37
    // erledigt sind — nicht, dass der 37. gerade anfängt.
    fortschritt?.({ phase: 'rebrickable', fertig: gefragt, gesamt });
  }
  return { auf: ergebnis, gefragt, gefunden, filterWirkungslos: blFilterWirkungslos() };
}

/**
 * Was aus einem Posten geworden ist.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#postenergebnis
 */
export interface PostenErgebnis {
  blId: string;
  art: WantedArt;
  /** Die BrickLink-Farbnummer aus der Datei — die Vorschau zeigt sie an. */
  blFarbe: number | null;
  menge: number;
  zustand: string | null;
  /**
   * MAXPRICE aus der Datei, je Stück — oder null.
   *
   * Steht im Bericht, seit die Vorschau eine Preisspalte hat (Marcos Wunsch
   * vom 21.10.). Vorher wurde der Wert gelesen und weitergereicht, aber nie
   * gezeigt; wer ihn in der Vorschau ändern soll, muss ihn erst einmal sehen.
   */
  maxPreis: number | null;
  rbId: string | null;
  rbFarbe: number | null;
  sicherheit: Sicherheit | null;
  /** 'angelegt' | 'aufgestockt' | 'offen' | 'fehler' */
  ausgang: 'angelegt' | 'aufgestockt' | 'offen' | 'fehler';
  grund?: string;
  /**
   * Derselbe Grund als Kennung, für die Oberfläche.
   * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#postenergebnis-2
   */
  grundCode?: 'nummer_unbekannt' | 'farbe_unbekannt';
  /** Beschreibung aus dem Katalog — leer, wenn er die Nummer nicht kennt. */
  name?: string | null;
  bild?: string | null;
  /**
   * Name und Bild wurden unter der BRICKLINK-Nummer gefunden, nicht über eine
   * Abbildung. Die Oberfläche muss das kennzeichnen — siehe beschreibePosten.
   */
  nameGeraten?: boolean;
  farbName?: string | null;
  farbHex?: string | null;
}

/**
 * Eine Korrektur aus der Vorschau.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#korrektur
 */
export interface Korrektur {
  index: number;
  /** Gegenprobe — muss zu dem Posten an [index] passen. */
  blId: string;
  art: WantedArt;
  rbId?: string | null;
  rbFarbe?: number | null;
  /**
   * Die Werte AUS DER DATEI, von Hand geändert — Marcos Wunsch vom 21.10.:
   * „Alle Spalten sollen bearbeitbar sein in der Vorschau, damit der Inhalt
   * vor dem Import korrigiert werden kann."
   * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#korrektur-2
   */
  menge?: number;
  /** 'N' | 'U' | null — null heisst „Standard des Kontos". */
  zustand?: string | null;
  /** Preis je Stück; null heisst „keiner, hol den Marktpreis". */
  kaufpreis?: number | null;
}

export interface WantedBericht {
  gelesen: number;
  fremdeArten: Record<string, number>;
  ohneNummer: number;
  /** Wie viele Posten je Sicherheitsstufe aufgelöst wurden. */
  stufen: Record<string, number>;
  /** Posten mit Nummer, aber ohne abbildbare Farbe. */
  farbeOffen: number;
  /** Nicht aufgelöst — mit ihren BrickLink-Nummern, damit man sie nachsehen kann. */
  offen: { blId: string; art: WantedArt; blFarbe: number | null }[];
  /** Nur gesetzt, wenn über Rebrickable gefragt wurde. */
  rebrickable?: { gefragt: number; gefunden: number; filterWirkungslos: boolean };
  /**
   * Nur gesetzt, wenn Korrekturen mitkamen.
   *
   * `abgewiesen` ist nicht leer, wenn eine Korrektur auf einen Posten zeigte,
   * der dort nicht steht — dann wurde zwischen Vorschau und Schreiben eine
   * andere Datei gewählt. Sie wird GENANNT und nicht übergangen.
   */
  korrekturen?: { angewandt: number; abgewiesen: Korrektur[] };
  angelegt: number;
  aufgestockt: number;
  fehler: number;
  /** true = es wurde NICHTS geschrieben. */
  vorschau: boolean;
  /**
   * true = jemand hat abgebrochen, der Rest der Liste blieb liegen.
   *
   * Steht nur dann da. Die Zahlen oben (angelegt/aufgestockt/fehler) gelten
   * für das, was BIS dahin geschehen ist — und das bleibt stehen.
   */
  abgebrochen?: boolean;
  /**
   * Der Standardzustand des Kontos — fuer die Vorschau.
   * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#wantedbericht
   */
  standardZustand: 'N' | 'U';
  posten: PostenErgebnis[];
}

/**
 * Zu jedem aufgelösten Posten Name, Bild und Farbbezeichnung holen.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#beschreibeposten
 */
export async function beschreibePosten(
  auf: Aufloesung[],
): Promise<Map<number, { name: string | null; bild: string | null; geraten: boolean }>> {
  const raus = new Map<number, { name: string | null; bild: string | null; geraten: boolean }>();

  // Die Nummern je Art sammeln. Ohne Rebrickable-Nummer gilt die
  // BrickLink-Nummer als Schluessel — siehe oben.
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
    const zeilen = await db.all(`
      SELECT p.part_number,
             COALESCE(pc.part_name, rp.name)        AS name,
             COALESCE(rp.part_img_url, '')          AS bild_allgemein
        FROM (SELECT UNNEST($1::text[]) AS part_number) p
        LEFT JOIN part_catalog pc ON pc.part_number = p.part_number
        LEFT JOIN rb_parts     rp ON rp.part_num    = p.part_number`,
      [nummern]).catch(() => []);
    const nachNummer = new Map(zeilen.map(z => [z.part_number, z]));
    // Die Farbbilder in EINER Abfrage: (Nummer, Farbe) als Paare.
    const paare = teile.filter(t => t.farbe !== null);
    const bilder = new Map<string, string>();
    if (paare.length) {
      const farbZeilen = await db.all(`
        SELECT part_number, color_id, COALESCE(image_local, image_url) AS bild
          FROM part_color_catalog
         WHERE (part_number, color_id) IN (
                 SELECT UNNEST($1::text[]), UNNEST($2::int[]))`,
        [paare.map(t => t.nr), paare.map(t => t.farbe)]).catch(() => []);
      for (const z of farbZeilen) if (z.bild) bilder.set(`${z.part_number}|${z.color_id}`, z.bild);
    }
    for (const t of teile) {
      const z = nachNummer.get(t.nr);
      const name = z?.name ?? null;
      const bild = bilder.get(`${t.nr}|${t.farbe}`) || z?.bild_allgemein || null;
      // `geraten` nur dann, wenn ueberhaupt etwas gefunden wurde: Eine leere
      // Zeile „geraten" zu nennen waere eine Behauptung ueber nichts.
      raus.set(t.i, { name, bild, geraten: t.geraten && !!(name || bild) });
    }
  }

  if (figuren.length) {
    const zeilen = await db.all(
      `SELECT fig_number, fig_name, COALESCE(image_local, image_url) AS bild
         FROM minifigs_catalog WHERE fig_number = ANY($1)`,
      [[...new Set(figuren.map(f => f.nr))]]).catch(() => []);
    const nach = new Map(zeilen.map(z => [z.fig_number, z]));
    for (const f of figuren) {
      const z = nach.get(f.nr);
      const name = z?.fig_name ?? null, bild = z?.bild ?? null;
      raus.set(f.i, { name, bild, geraten: f.geraten && !!(name || bild) });
    }
  }

  if (sets.length) {
    const nummern = [...new Set(sets.map(x => x.nr))];
    const zeilen = await db.all(`
      SELECT s.set_number,
             COALESCE(sc.name, rs.name)                                AS name,
             COALESCE(sc.image_local, sc.image_url, rs.set_img_url)     AS bild
        FROM (SELECT UNNEST($1::text[]) AS set_number) s
        LEFT JOIN set_catalog sc ON sc.set_number = s.set_number
        LEFT JOIN rb_sets     rs ON rs.set_num    = s.set_number`,
      [nummern]).catch(() => []);
    const nach = new Map(zeilen.map(z => [z.set_number, z]));
    for (const x of sets) {
      const z = nach.get(x.nr);
      const name = z?.name ?? null, bild = z?.bild ?? null;
      raus.set(x.i, { name, bild, geraten: x.geraten && !!(name || bild) });
    }
  }

  return raus;
}

/**
 * Die Korrekturen aus der Vorschau auf die Auflösung legen.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#wendekorrekturenan
 */
function wendeKorrekturenAn(
  auf: Aufloesung[], korrekturen: Korrektur[],
): { auf: Aufloesung[]; angewandt: number; abgewiesen: Korrektur[] } {
  const ergebnis = [...auf];
  const abgewiesen: Korrektur[] = [];
  let angewandt = 0;
  for (const k of korrekturen) {
    const a = ergebnis[k.index];
    if (!a || a.posten.art !== k.art || a.posten.blId !== k.blId) { abgewiesen.push(k); continue; }
    // Nur was DASTEHT wird geändert: `undefined` heisst „nicht angefasst",
    // `null` heisst „ausdrücklich geleert". Ohne die Unterscheidung löschte
    // eine Korrektur, die nur die Farbe setzt, die Nummer mit.
    const rbId    = k.rbId    === undefined ? a.rbId    : (k.rbId || null);
    const rbFarbe = k.rbFarbe === undefined ? a.rbFarbe : (k.rbFarbe ?? null);

    // ── Die Werte aus der Datei (Marcos Wunsch vom 21.10.) ─────────────────
    //
    // Eine UNBRAUCHBARE Angabe weist die ganze Korrektur ab, statt sie still
    // zurechtzubiegen: Eine Menge 0 ist ein Vertipper, und ein Posten, der
    // danach mit Menge 1 im Bestand steht, sagt das niemandem. Abgewiesene
    // Korrekturen stehen im Bericht (`korrekturen.abgewiesen`) — die
    // Oberfläche zeigt sie, und zwar seit es sie gibt.
    let menge = a.posten.menge;
    if (k.menge !== undefined) {
      const m = Math.trunc(Number(k.menge));
      if (!Number.isFinite(m) || m < 1) { abgewiesen.push(k); continue; }
      menge = m;
    }
    let zustand = a.posten.zustand;
    if (k.zustand !== undefined) {
      // null/'' heisst ausdrücklich „Standard des Kontos" — dieselbe Lesart
      // wie CONDITION=X in der Datei. Alles andere als N/U ist ein Fehler
      // und nicht etwa „egal": Wer 'X' tippt, meint den Standard und
      // schreibt dann auch nichts hin.
      if (k.zustand === null || k.zustand === '') zustand = null;
      else if (k.zustand === 'N' || k.zustand === 'U') zustand = k.zustand;
      else { abgewiesen.push(k); continue; }
    }
    let maxPreis = a.posten.maxPreis;
    if (k.kaufpreis !== undefined) {
      if (k.kaufpreis === null || (k.kaufpreis as unknown) === '') maxPreis = null;
      else {
        const p = Number(k.kaufpreis);
        // 0 ist hier KEIN Preis, sondern „keiner" — dieselbe Lesart wie beim
        // Leser (`preisRoh > 0`), wo MAXPRICE=-1 und 0 zu null werden.
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
      // Der POSTEN selbst ändert sich mit — das ist neu. Bis zum 21.10.
      // betraf eine Korrektur nur die AUFLÖSUNG (Nummer, Farbe); Menge,
      // Zustand und Preis galten als das, was in der Datei stand.
      ...(postenGeaendert ? { posten: { ...a.posten, menge, zustand, maxPreis } } : {}),
      // Der Name der Farbe gilt nicht mehr: Er gehoerte zur alten Nummer.
      // Er wird unten neu geholt (farbenNachtragen), damit die Zeile nicht
      // mit „Red" an einer blauen Farbnummer herausgeht.
      rbFarbName: rbFarbe === a.rbFarbe ? a.rbFarbName : null,
      rbFarbHex:  rbFarbe === a.rbFarbe ? a.rbFarbHex  : null,
      // `korrigiert` NUR bei einer geänderten Nummer: Diese Stufe entscheidet,
      // ob die Zuordnung gemerkt wird (siehe merkeNummer beim Anlegen). Eine
      // geänderte Menge sagt nichts über die Nummer aus — sie als
      // „nachgeschlagen" einzutragen wäre eine Behauptung über etwas, das
      // niemand angesehen hat.
      sicherheit: nummerGeaendert ? 'korrigiert' : a.sicherheit,
      // Eine eingetragene Farbe ist nicht mehr offen.
      farbeOffen: rbId !== null && a.posten.blFarbe !== null && rbFarbe === null,
    };
    angewandt++;
  }
  return { auf: ergebnis, angewandt, abgewiesen };
}

/**
 * Farbbezeichnung und Farbwert zu den korrigierten Farben nachholen.
 *
 * Die Auflösung holt sie für die Farben aus der DATEI; eine von Hand
 * eingetragene Farbnummer war dort nicht dabei. Ohne diesen Schritt ginge sie
 * ohne Namen an den Anleger — und das ist genau der Farbpunkt ohne
 * Beschriftung, der am 19.10. behoben wurde.
 */
async function farbenNachtragen(auf: Aufloesung[]): Promise<Aufloesung[]> {
  const offen = auf.filter(a => a.rbFarbe !== null && a.rbFarbName === null)
                   .map(a => a.rbFarbe as number);
  if (!offen.length) return auf;
  const zeilen = await db.all(
    'SELECT id, name, rgb FROM rb_colors WHERE id = ANY($1)', [[...new Set(offen)]])
    .catch(() => []);
  const nach = new Map(zeilen.map(z => [Number(z.id), z]));
  return auf.map(a => {
    if (a.rbFarbe === null || a.rbFarbName !== null) return a;
    const z = nach.get(a.rbFarbe);
    return z ? { ...a, rbFarbName: z.name ?? null, rbFarbHex: z.rgb ?? null } : a;
  });
}

/** Die Stufen zählen — eine Zeile, die sonst dreimal dastünde. */
function zaehleStufen(auf: Aufloesung[]): Record<string, number> {
  const z: Record<string, number> = {};
  for (const a of auf) if (a.sicherheit) z[a.sicherheit] = (z[a.sicherheit] ?? 0) + 1;
  return z;
}

/**
 * Eine Wanted-Liste einlesen — als Vorschau oder wirklich.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#abschnitt-3
 */
/**
 * Die drei Anleger, die der Import braucht.
 * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#anleger
 */
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
    /** Was der Mensch in der Vorschau geändert hat. */
    korrekturen?: Korrektur[];
    /**
     * Eine eingetragene Rebrickable-Nummer MERKEN.
     * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#importierewantedliste
     */
    merkeNummer?: (art: WantedArt, rbId: string, blId: string) => Promise<unknown>;
    /**
     * Wie weit es ist — für den Balken in der Oberfläche (siehe
     * WantedFortschritt). Wird SYNCHRON gerufen und darf nichts werfen; der
     * Aufrufer schreibt damit eine Zeile in seinen Strom.
     * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#importierewantedliste-2
     */
    fortschritt?: (stand: WantedFortschritt) => void;
    /**
     * Der Fortschritt steht seit dem 20.10. auch im Auftragsdatensatz, den
     * beide Oberflächen als Balken zeigen (utils/importAuftrag.ts), und dieser
     * Balken trägt ein Kreuz. Ein Import, der das Kreuz nicht beachtet, hätte
     * einen Abbrechen-Knopf, der lügt.
     * Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#importierewantedliste-3
     */
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

  // ── Korrekturen NACH dem Auflösen, VOR dem Zählen ──────────────────────
  //
  // Nach dem Auflösen, weil sie es überstimmen sollen. Vor dem Zählen, weil
  // der Bericht sonst die Zahlen von vor der Korrektur nennt — und Marco
  // liest ihn, um zu entscheiden.
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
  /** Ein Posten ist durch. `lfd` zählt ab 0, der Balken ab 1. */
  const melde = () => opt.fortschritt?.(
    { phase: 'schreiben', fertig: lfd + 1, gesamt: auf.length });

  for (const a of auf) {
    // Alle zehn Posten nachsehen, ob jemand abgebrochen hat. Die Zählung geht
    // über `lfd`, also über ALLE Posten — auch die übersprungenen; sonst hinge
    // der Takt daran, wie viele Posten auflösbar waren.
    if (opt.abbruch && !opt.vorschau && lfd >= 0 && (lfd + 1) % 10 === 0) {
      if (await opt.abbruch()) { bericht.abgebrochen = true; break; }
    }
    // Eine Farbe, die sich nicht abbilden laesst, wird NICHT erfunden
    // NACHGESTELLT: Liste mit 3001 in BL-Farbe 5 (abbildbar) und BL-Farbe 85
    // (nicht abbildbar) ergab zwei Zeilen, color_id 4 und color_id 0.
    // Ausführlich: docs/begruendungen/src/merkliste/wantedListe.ts.md#importierewantedliste-grund
    const grund = a.rbId === null
      ? 'Zu dieser BrickLink-Nummer ist keine Rebrickable-Nummer bekannt'
      : a.farbeOffen
        ? `BrickLink-Farbe ${a.posten.blFarbe} ist im Katalog keiner Rebrickable-Farbe zugeordnet`
        : undefined;
    const grundCode: PostenErgebnis['grundCode'] = a.rbId === null
      ? 'nummer_unbekannt'
      : a.farbeOffen ? 'farbe_unbekannt' : undefined;
    // Eigene Bindung statt nur eines Wahrheitswerts: Der Pruefer verengt
    // `a.rbId` ueber eine Hilfsvariable NICHT, und `rbId` ist weiter unten als
    // `string` gebraucht.
    const rbId = a.rbId;
    const offen = rbId === null || a.farbeOffen;
    lfd++;
    // Name und Bild kommen NACH der Schleife dazu — siehe dort, warum.
    const zeile: PostenErgebnis = {
      blId: a.posten.blId, art: a.posten.art,
      blFarbe: a.posten.blFarbe, menge: a.posten.menge, zustand: a.posten.zustand ?? null,
      maxPreis: a.posten.maxPreis ?? null,
      rbId: a.rbId, rbFarbe: a.rbFarbe,
      sicherheit: a.sicherheit, ausgang: a.rbId === null ? 'offen' : 'angelegt',
      ...(grund ? { grund } : {}),
      ...(grundCode ? { grundCode } : {}),
      // Die Farbangaben stehen auch ohne Vorschau da — sie kosten nichts, die
      // Auflösung hat sie ohnehin geholt.
      farbName: a.rbFarbName, farbHex: a.rbFarbHex,
    };
    if (rbId === null || a.farbeOffen || opt.vorschau) {
      // In der Vorschau steht „angelegt" fuer „wuerde angelegt" — geschrieben
      // wird nichts, und `vorschau: true` im Bericht sagt das.
      if (offen) zeile.ausgang = 'offen';
      bericht.posten.push(zeile);
      // Auch der übersprungene Posten ist ERLEDIGT. Zählte der Balken nur die
      // geschriebenen, bliebe er bei einer Liste mit vielen offenen Posten vor
      // dem Ende stehen — und sähe aus wie ein hängender Import.
      melde();
      continue;
    }

    try {
      if (!opt.anleger) throw new Error('Kein Anleger übergeben — siehe Anleger');
      let rueckmeldung: unknown;
      if (a.posten.art === 'part') {
        // `color_name`/`color_hex` reisen MIT. Ohne sie bleibt die Spalte
        // leer, und die Teileliste liest den Namen von dort — der Hex-Wert
        // faellt auf den Katalog zurueck, der Name NICHT. Ergebnis war ein
        // Farbpunkt ohne Beschriftung (Marcos Bildschirmfoto).
        //
        // `a.rbFarbe` ist hier nie null: Ein Posten ohne abbildbare Farbe ist
        // oben schon als offen ausgeschieden.
        rueckmeldung = await opt.anleger.teil(uid, {
          part_number: rbId,
          color_id: a.rbFarbe ?? 0,
          ...(a.rbFarbName ? { color_name: a.rbFarbName } : {}),
          ...(a.rbFarbHex ? { color_hex: a.rbFarbHex } : {}),
          quantity: a.posten.menge,
          condition: a.posten.zustand ?? undefined,
          // MAXPRICE als Preis/Stück — siehe oben. `undefined` und nicht
          // `null`: Die Anleger unterscheiden „nichts angegeben" (dann gilt
          // der Marktpreis) von einer ausdrücklichen Null.
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
      // Angelegt oder aufgestockt — der Anleger weiss es, und bis zum 19.10.
      // wurde es nicht gefragt: Ein zweiter Import derselben Liste meldete
      // `angelegt: 2, aufgestockt: 0`, obwohl beide Posten nur aufgestockt
      // wurden (nachgestellt). Die Zahl, die Marco liest, war falsch.
      const wieAngelegt = (rueckmeldung as { action?: string } | null | undefined)?.action !== 'updated';
      if (wieAngelegt) bericht.angelegt++; else bericht.aufgestockt++;
      zeile.ausgang = wieAngelegt ? 'angelegt' : 'aufgestockt';

      // Warum 'rebrickable' dazugehört
      // Dass es eine Abbildung ist und keine Vermutung, steht an blTeilZuRb
      // selbst: „Jeder Treffer muss in seinen external_ids.BrickLink die
      // GESUCHTE Nummer tragen" — nachgeschlagen und gegengeprüft, nur von …
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
    // Nach dem Anlegen UND nach einem Fehlschlag: Der Posten ist in beiden
    // Fällen abgearbeitet. Stünde die Meldung im try, bliebe der Balken bei
    // einer Liste mit Fehlern stehen.
    melde();
  }

  // Die Annahme war falsch. Der Dialog bleibt nach dem Schreiben offen und
  // zeichnet dieselbe Tabelle mit der ANTWORT neu (zeichneTabelle in
  // public/js/18-wanted-xml.js). Wer dort hinsieht, sieht also sehr wohl
  // etwas — und seit es diese Regel gab, sah er leere Zellen. GEMESSEN:
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
