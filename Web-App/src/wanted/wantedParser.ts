/** BrickLink-Wanted-XML lesen: Die Datei trägt BL-Nummern; die Abbildung auf
 * Rebrickable-Nummern macht wantedResolution.ts. */

export type WantedArt = 'part' | 'fig' | 'set';

// Nur P, M und S haben einen Platz im Bestand; andere Arten werden gezählt und
// gemeldet statt still verworfen.
const ARTEN: Record<string, WantedArt> = { P: 'part', M: 'fig', S: 'set' };

export interface WantedItem {
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
function zwischen(text: string, name: string, ab: number): { inhalt: string; ende: number } | null {
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
  return m.inhalt
    .trim()
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export interface ReadResult {
  posten: WantedItem[];
  fremdeArten: Record<string, number>;
  ohneNummer: number;
}

/** Wirft NICHT bei fremden Arten oder fehlenden Feldern: Eine zu neun Zehnteln
 * brauchbare Liste soll zu neun Zehnteln ankommen; der Rest steht im Ergebnis. */
export function readWantedList(xml: string): ReadResult {
  const posten: WantedItem[] = [];
  const fremdeArten: Record<string, number> = {};
  let ohneNummer = 0;

  for (let m = zwischen(xml, 'ITEM', 0); m !== null; m = zwischen(xml, 'ITEM', m.ende)) {
    const block = m.inhalt;
    const typ = (feld(block, 'ITEMTYPE') ?? '').toUpperCase();
    const art = ARTEN[typ];
    const blId = feld(block, 'ITEMID');

    if (!blId) {
      ohneNummer++;
      continue;
    }
    if (!art) {
      fremdeArten[typ || '(ohne)'] = (fremdeArten[typ || '(ohne)'] ?? 0) + 1;
      continue;
    }

    const colorRaw = feld(block, 'COLOR');
    const farbe = colorRaw === null ? null : parseInt(colorRaw, 10);
    const quantityRaw = parseInt(feld(block, 'MINQTY') ?? '1', 10);
    const stateRaw = (feld(block, 'CONDITION') ?? '').toUpperCase();
    const priceRaw = parseFloat(feld(block, 'MAXPRICE') ?? '');

    posten.push({
      art,
      blId,
      // Farbe 0 ist bei BrickLink „(Not Applicable)", keine Farbe.
      blFarbe: farbe !== null && Number.isFinite(farbe) && farbe > 0 ? farbe : null,
      menge: Number.isFinite(quantityRaw) && quantityRaw > 0 ? quantityRaw : 1,
      // X heisst „egal": null, damit die Einstellung des Kontos entscheidet.
      zustand: stateRaw === 'N' || stateRaw === 'U' ? stateRaw : null,
      // MAXPRICE ist eine Suchgrenze, kein Kaufpreis — -1 heisst „keiner".
      maxPreis: Number.isFinite(priceRaw) && priceRaw > 0 ? priceRaw : null,
    });
  }

  return { posten, fremdeArten, ohneNummer };
}
