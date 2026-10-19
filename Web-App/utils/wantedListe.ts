/**
 * BrickLink-Wanted-Listen lesen und auf Rebrickable-Nummern abbilden.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 *   „Ich möchte auch Bricklink-Wanted-Listen importieren können. Diese sollen
 *    dann als manuell erfasste Parts und Minifiguren oder sets importiert
 *    werden. Anbei habe ich dir ein XML. Bitte beachte dass im xml BL-IDs und
 *    nicht Rebrickable-IDs enthalten sind."
 *
 * Und zur Reihenfolge: „Zuerst die restlichen … mit der Option diese über
 * Bricklink oder noch besser über Rebrickable versuchen aufzulösen."
 *
 * ── Was an Marcos Datei GEMESSEN wurde ──────────────────────────────────────
 *
 * 224 Posten, alle ITEMTYPE=P, alle CONDITION=X, alle MAXPRICE=-1.0000, alle
 * NOTIFY=N. 24 verschiedene BL-Farben. Die Teilenummern: 203 rein numerisch,
 * 16 Ziffern+Buchstaben, 4 bedruckt (pb/pr), eine mit x-Präfix.
 *
 * Sets und Minifiguren kommen in dieser Datei NICHT vor. Die Codes dafür (S
 * und M) stehen hier aus BrickLinks Artenliste, nicht aus Marcos Datei — das
 * ist der einzige Teil dieses Lesers, der sich an seinem Beispiel nicht
 * prüfen lässt, und er steht deshalb hier ausdrücklich.
 *
 * ── Warum ohne XML-Bibliothek ───────────────────────────────────────────────
 *
 * Eine Wanted-Liste ist flach: <INVENTORY> mit <ITEM>-Kindern, in jedem
 * höchstens ein Dutzend Textfelder, keine Attribute, keine Verschachtelung.
 * Dafür eine Abhängigkeit aufzunehmen wäre mehr, als die Sache trägt — anders
 * als bei den PDFs, wo das Messen ergeben hat, dass es ohne nicht geht.
 *
 * Gelesen wird je ITEM-Block und NICHT über die ganze Datei: Sonst gewinnt
 * beim Zählen der erste Treffer, und aus 224 Posten würde einer. (Genau diese
 * Form hat in diesem Baum schon zweimal etwas falsch gemacht — siehe
 * seitenweiseLesen in utils/gutscheinPdfSchreiben.ts.)
 */
import * as db from '../db/database';

/** Die drei Arten, die diese Anwendung führt. */
export type WantedArt = 'part' | 'fig' | 'set';

/**
 * BrickLinks Artencodes, soweit sie hier etwas bedeuten.
 *
 * P, S und M sind die drei, die einen Platz im Bestand haben. B (Book),
 * G (Gear), C (Catalog), I (Instruction), O (Original Box) und U (Unsorted
 * Lot) führt diese Anwendung nicht — sie werden GEZÄHLT und gemeldet, nicht
 * stillschweigend verworfen: Wer eine Liste mit Zubehör hochlädt, soll lesen,
 * dass davon etwas liegengeblieben ist.
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

/** Ein Textfeld aus einem ITEM-Block. */
function feld(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return null;
  // Die fünf vordefinierten Entitäten. Mehr kommt in einer Wanted-Liste nicht
  // vor; käme etwas, bliebe es stehen und fiele auf, statt still falsch zu
  // werden. &amp; ZULETZT — sonst würde aus „&amp;lt;" ein „<".
  return (m[1] ?? '').trim()
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

  const blockRe = /<ITEM>([\s\S]*?)<\/ITEM>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml)) !== null) {
    const block = m[1] ?? '';
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
  | 'rebrickable';

export interface Aufloesung {
  posten: WantedPosten;
  /** Die Rebrickable-Nummer — null, wenn lokal nichts zu finden war. */
  rbId: string | null;
  /** Die Rebrickable-Farbnummer — null bei Sets und wenn nichts zu finden war. */
  rbFarbe: number | null;
  /**
   * Name und Farbwert zur Nummer — beide aus rb_colors.
   *
   * Sie reisen MIT, statt spaeter nachgeschlagen zu werden: Der Anleger
   * schreibt `color_name` an die Zeile, und die Teileliste liest den Namen
   * von dort. Bis zum 19.10. wurden sie nicht uebergeben; der Hex-Wert fiel
   * in der Anzeige auf den Katalog zurueck, der NAME nicht. Marcos Befund:
   * ein Farbpunkt ohne Beschriftung.
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
 *
 * ── Die drei Stufen, und warum sie getrennt bleiben ─────────────────────────
 *
 * 1. `bl_zuordnung.bl_id = X` — jemand hat die abweichende Nummer eingetragen.
 *    Das ist eine Abbildung, kein Schluss.
 * 2. `bl_zuordnung.rb_id = X AND bl_id IS NULL` — jemand hat nachgesehen und
 *    vermerkt: keine abweichende Nummer. Also ist die BL-Nummer die
 *    RB-Nummer. Auch das ist eine Abbildung (Migration 0037 erklärt diesen
 *    NULL-Wert ausdrücklich).
 * 3. Die Nummer steht so im Rebrickable-Katalog. Das ist WAHRSCHEINLICH
 *    richtig — bei den meisten Teilen benutzen beide Dienste dieselbe Nummer
 *    —, aber es hat niemand nachgesehen. Es gibt Nummern, die bei BrickLink
 *    etwas anderes bezeichnen als bei Rebrickable.
 *
 * Die drei zusammenzuwerfen wäre bequem und würde Stufe 3 wie eine Abbildung
 * aussehen lassen. Sie bleibt deshalb getrennt und wird in der Vorschau
 * einzeln gezählt — Marco entscheidet, ob er sie nimmt.
 *
 * Die FARBE kommt aus rb_colors.bl_color_id. Das ist katalogweit gepflegt und
 * kennt keine Stufen: entweder die Zuordnung steht da oder nicht.
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
 *
 * ── Marcos Vorgabe zur Reihenfolge ──────────────────────────────────────────
 *
 *   „Zuerst die restlichen … mit der Option diese über Bricklink oder noch
 *    besser über Rebrickable versuchen aufzulösen."
 *
 * „Noch besser über Rebrickable" ist nicht nur besser, sondern der einzige
 * DIREKTE Weg: BrickLink kennt keine Rebrickable-Nummern. Über BrickLink
 * ginge nur ein Umweg (Posten abfragen, Name und Alternativnummern holen, die
 * bei Rebrickable suchen) — zwei Sprünge mit je eigener Fehlerquelle. Deshalb
 * steht hier Rebrickable und nicht beides; käme der Umweg, wäre er eine
 * eigene Funktion und keine stillere Hälfte dieser.
 *
 * ── Nur die OFFENEN, und nur auf Verlangen ──────────────────────────────────
 *
 * Jeder Abruf kostet aus Marcos Tageskontingent. Angefragt wird deshalb
 * ausschliesslich, was lokal nichts ergab — bei seiner Datei wären das die
 * Posten, die `loeseLokalAuf` offen lässt, nicht alle 224.
 *
 * Teile allein: Für Figuren und Sets führt Rebrickable keine BrickLink-IDs in
 * external_ids (die Notiz steht in utils/bricklinkLink.ts: „Rebrickable hat
 * external_ids nur bei Parts"). Eine Abfrage dafür wäre ein Abruf, der nichts
 * finden KANN.
 */
export async function loeseUeberRebrickableAuf(
  auf: Aufloesung[], grenze = 250,
): Promise<{ auf: Aufloesung[]; gefragt: number; gefunden: number; filterWirkungslos: boolean }> {
  const { blTeilZuRb, blFilterWirkungslos } = require('../clients/rebrickable');
  let gefragt = 0, gefunden = 0;

  const ergebnis = [...auf];
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
  }
  return { auf: ergebnis, gefragt, gefunden, filterWirkungslos: blFilterWirkungslos() };
}

/** Was aus einem Posten geworden ist. */
export interface PostenErgebnis {
  blId: string;
  art: WantedArt;
  rbId: string | null;
  rbFarbe: number | null;
  sicherheit: Sicherheit | null;
  /** 'angelegt' | 'aufgestockt' | 'offen' | 'fehler' */
  ausgang: 'angelegt' | 'aufgestockt' | 'offen' | 'fehler';
  grund?: string;
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
  angelegt: number;
  aufgestockt: number;
  fehler: number;
  /** true = es wurde NICHTS geschrieben. */
  vorschau: boolean;
  posten: PostenErgebnis[];
}

/** Die Stufen zählen — eine Zeile, die sonst dreimal dastünde. */
function zaehleStufen(auf: Aufloesung[]): Record<string, number> {
  const z: Record<string, number> = {};
  for (const a of auf) if (a.sicherheit) z[a.sicherheit] = (z[a.sicherheit] ?? 0) + 1;
  return z;
}

/**
 * Eine Wanted-Liste einlesen — als Vorschau oder wirklich.
 *
 * ── Warum die Vorschau derselbe Weg ist ─────────────────────────────────────
 *
 * Sie liest, löst auf und zählt genau wie der Ernstfall; nur das Schreiben
 * bleibt aus. Zwei getrennte Wege hätten auseinanderlaufen können — und dann
 * verspräche die Vorschau etwas, das der Import nicht tut. Das ist die Sorte
 * Fehler, die niemand sieht, weil beide Zahlen plausibel aussehen.
 *
 * ── Was angelegt wird, und warum es HEREINGEGEBEN wird ──────────────────────
 *
 * „als manuell erfasste Parts und Minifiguren oder sets" — also über
 * addManualPart(), addManualFig() und addSet(), die drei Wege, die auch das
 * Formular benutzt. Kein eigenes INSERT: Dort hängen Lagerort, Preisregel,
 * Katalognachtrag und die Erfassungszeile dran, und jede Abschrift davon
 * verliert etwas (die Begründung steht an addManualPart).
 *
 * Nur: addManualPart und addManualFig liegen in routes/. Mein erster Entwurf
 * holte sie mit require('../routes/parts') hierher — und test/schichten.test.js
 * hat das abgewiesen: „Neue Abhaengigkeit von einer Fachdatei auf eine ROUTE.
 * Die Funktion gehoert in die Schicht, die sie braucht — sonst zieht jeder
 * Nutzer den HTTP-Apparat mit."
 *
 * Die Ausnahmeliste dieses Tests ist LEER, und das ist ein erarbeiteter Stand
 * (der Kommentar dort sagt, dass zwei von acht Einträgen nur wegen eines
 * Fehlers in der Regel dastanden). Der erste neue Eintrag wäre ein
 * Rückschritt — also ist die Abhängigkeit umgedreht: Die ROUTE kennt die
 * Routen und gibt die drei Anleger herein. Diese Datei kennt nur ihre Form.
 *
 * ── Kein Kaufpreis ──────────────────────────────────────────────────────────
 *
 * MAXPRICE ist eine SUCHGRENZE („bis so viel würde ich zahlen"), kein
 * bezahlter Preis. Als Kaufpreis übernommen stünde in der Finanzansicht ein
 * Betrag, den niemand ausgegeben hat. Die Posten kommen deshalb ohne Preis
 * herein; was sie wert sind, holt der Marktpreis.
 */
/**
 * Die drei Anleger, die der Import braucht.
 *
 * Als Schnittstelle und nicht als Einfuhr: So kennt diese Datei nur die FORM
 * („etwas, das ein Teil anlegt") und nicht den Ort. Die Route steckt die
 * echten Funktionen hinein; ein Test könnte Zähler hineinstecken.
 *
 * Die Reihenfolge der Parameter folgt den echten Funktionen, damit das
 * Hereingeben eine Zuweisung bleibt und keine Übersetzung: addManualPart und
 * addManualFig nehmen (uid, body), addSet nimmt die Setnummer zuerst — daher
 * die eigene Form für `set`.
 */
export interface Anleger {
  teil: (uid: number, body: Record<string, unknown>) => Promise<unknown>;
  figur: (uid: number, body: Record<string, unknown>) => Promise<unknown>;
  set: (uid: number, setNummer: string, menge: number,
        zustand: string | null) => Promise<unknown>;
}

export async function importiereWantedListe(
  uid: number, xml: string,
  opt: { vorschau?: boolean; ueberRebrickable?: boolean; anleger?: Anleger } = {},
): Promise<WantedBericht> {
  const gelesen = leseWantedListe(xml);
  let auf = await loeseLokalAuf(gelesen.posten);

  let rebrickable: WantedBericht['rebrickable'];
  if (opt.ueberRebrickable) {
    const r = await loeseUeberRebrickableAuf(auf);
    auf = r.auf;
    rebrickable = { gefragt: r.gefragt, gefunden: r.gefunden,
                    filterWirkungslos: r.filterWirkungslos };
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
    angelegt: 0, aufgestockt: 0, fehler: 0,
    vorschau: !!opt.vorschau,
    posten: [],
  };

  for (const a of auf) {
    // ── Eine Farbe, die sich nicht abbilden laesst, wird NICHT erfunden ────
    //
    // Marcos Befund vom 19.10.: „Die Farbe wurde nicht immer uebernommen und
    // die Teile sind nun mehrfach vorhanden (bsp 3001)."
    //
    // Hier stand `color_id: a.rbFarbe ?? 0`. Die 0 ist bei Rebrickable aber
    // SCHWARZ und nicht „keine Farbe" — die Warnung steht woertlich in
    // routes/parts.ts („fuer die Bildsuche fatal: 0 ist bei Rebrickable
    // SCHWARZ"). Ein Posten mit unbekannter Farbe landete damit als
    // schwarzes Teil im Bestand, NEBEN demselben Teil in seiner richtigen
    // Farbe. Das ist das Doppelte, das Marco sieht.
    //
    // NACHGESTELLT: Liste mit 3001 in BL-Farbe 5 (abbildbar) und BL-Farbe 85
    // (nicht abbildbar) ergab zwei Zeilen, color_id 4 und color_id 0.
    //
    // Der Bericht wusste es die ganze Zeit — `farbeOffen` zaehlt genau diese
    // Posten — und schrieb sie trotzdem. Jetzt bleiben sie OFFEN, mit Grund.
    // Damit fehlt der Posten im Bestand, statt falsch darin zu stehen; die
    // Vorschau (Stufe 3) gibt Marco die Gelegenheit, die Farbe zu setzen.
    const grund = a.rbId === null
      ? 'Zu dieser BrickLink-Nummer ist keine Rebrickable-Nummer bekannt'
      : a.farbeOffen
        ? `BrickLink-Farbe ${a.posten.blFarbe} ist im Katalog keiner Rebrickable-Farbe zugeordnet`
        : undefined;
    // Eigene Bindung statt nur eines Wahrheitswerts: Der Pruefer verengt
    // `a.rbId` ueber eine Hilfsvariable NICHT, und `rbId` ist weiter unten als
    // `string` gebraucht.
    const rbId = a.rbId;
    const offen = rbId === null || a.farbeOffen;
    const zeile: PostenErgebnis = {
      blId: a.posten.blId, art: a.posten.art, rbId: a.rbId, rbFarbe: a.rbFarbe,
      sicherheit: a.sicherheit, ausgang: a.rbId === null ? 'offen' : 'angelegt',
      ...(grund ? { grund } : {}),
    };
    if (rbId === null || a.farbeOffen || opt.vorschau) {
      // In der Vorschau steht „angelegt" fuer „wuerde angelegt" — geschrieben
      // wird nichts, und `vorschau: true` im Bericht sagt das.
      if (offen) zeile.ausgang = 'offen';
      bericht.posten.push(zeile);
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
        });
      } else if (a.posten.art === 'fig') {
        rueckmeldung = await opt.anleger.figur(uid, {
          fig_number: rbId,
          quantity: a.posten.menge,
          condition: a.posten.zustand ?? undefined,
        });
      } else {
        rueckmeldung = await opt.anleger.set(uid, rbId, a.posten.menge, a.posten.zustand);
      }
      // Angelegt oder aufgestockt — der Anleger weiss es, und bis zum 19.10.
      // wurde es nicht gefragt: Ein zweiter Import derselben Liste meldete
      // `angelegt: 2, aufgestockt: 0`, obwohl beide Posten nur aufgestockt
      // wurden (nachgestellt). Die Zahl, die Marco liest, war falsch.
      const wieAngelegt = (rueckmeldung as { action?: string } | null | undefined)?.action !== 'updated';
      if (wieAngelegt) bericht.angelegt++; else bericht.aufgestockt++;
      zeile.ausgang = wieAngelegt ? 'angelegt' : 'aufgestockt';
    } catch (e: unknown) {
      bericht.fehler++;
      zeile.ausgang = 'fehler';
      zeile.grund = e instanceof Error ? e.message : String(e);
    }
    bericht.posten.push(zeile);
  }

  return bericht;
}
