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
  | 'katalogtreffer';

export interface Aufloesung {
  posten: WantedPosten;
  /** Die Rebrickable-Nummer — null, wenn lokal nichts zu finden war. */
  rbId: string | null;
  /** Die Rebrickable-Farbnummer — null bei Sets und wenn nichts zu finden war. */
  rbFarbe: number | null;
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

  const farbMap = new Map<number, number>();
  for (const z of await db.all(
    'SELECT id, bl_color_id FROM rb_colors WHERE bl_color_id = ANY($1)', [farben]).catch(() => [])) {
    farbMap.set(Number(z.bl_color_id), Number(z.id));
  }

  return posten.map((p) => {
    const treffer = zuordnung.get(`${p.art}:${p.blId}`);
    let rbId: string | null = null;
    let sicherheit: Sicherheit | null = null;
    if (treffer) { rbId = treffer.rbId; sicherheit = treffer.sicherheit; }
    else if (katalog.has(`${p.art}:${p.blId}`)) { rbId = p.blId; sicherheit = 'katalogtreffer'; }

    const rbFarbe = p.blFarbe === null ? null : (farbMap.get(p.blFarbe) ?? null);
    return {
      posten: p, rbId, rbFarbe, sicherheit,
      farbeOffen: rbId !== null && p.blFarbe !== null && rbFarbe === null,
    };
  });
}
