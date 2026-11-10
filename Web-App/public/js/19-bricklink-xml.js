// Wanted-Listen schreiben, die Gegenrichtung zu 18-wanted-xml.js. Eine eigene, DOM-freie Datei, damit ein
// Test sie einlesen kann — 08-init.js greift schon beim Laden aufs Dokument zu.

/**
 * Höchstgrösse eines Uploads, in Bytes.
 *
 * BrickLink-Hilfe 207: „maximum file size allowed for upload is 204800 bytes". Einmal benannt, weil die Zahl
 * sonst im Bauteil und in seinem Test zweimal stünde.
 */
import { esc } from './00-escapen.js';

export const BL_UPLOAD_MAX_BYTES = 204800;

/**
 * Ein `<ITEM>`-Block.
 *
 * @param {{type:string, part:string, color:number|null, qty:number,
 *          condition?:string}} p
 */
function item(p) {
  const zeilen = [
    `<ITEMTYPE>${esc(p.type)}</ITEMTYPE>`,
    `<ITEMID>${esc(p.part)}</ITEMID>`,
  ];
  // COLOR nur, wenn eine BRICKLINK-Nummer bekannt ist. `null` heisst „unbekannt" und ist etwas anderes als 0
  // — 0 ist bei BrickLink „(Not Applicable)" und bei Rebrickable SCHWARZ. Diese beiden zu verwechseln hat am
  // 19.10. schon den Import verdorben.
  if (p.color !== null && p.color !== undefined) zeilen.push(`<COLOR>${Number(p.color)}</COLOR>`);
  zeilen.push(`<MINQTY>${Math.max(1, Math.round(p.qty))}</MINQTY>`);
  // CONDITION nur, wenn sie etwas sagt. X ist BrickLinks Vorgabe („egal"), und sie hinzuschreiben ist
  // dasselbe wie sie weglassen — nur länger.
  if (p.condition === 'N' || p.condition === 'U') zeilen.push(`<CONDITION>${esc(p.condition)}</CONDITION>`);
  return `<ITEM>\n${zeilen.map(z => '  ' + z).join('\n')}\n</ITEM>`;
}

/** Eine Liste als BrickLink-XML — als EIN Stück, ohne Rücksicht auf die Grösse. */
/** @param {Parameters<typeof item>[0][]} posten */
export function baueWantedXml(posten) {
  // KEINE XML-Deklaration — siehe Punkt 1 im Kopf dieser Datei.
  return `<INVENTORY>\n${posten.map(item).join('\n')}\n</INVENTORY>\n`;
}

/**
 * Die Liste in Stücke schneiden, die BrickLink annimmt. Gemessen in Bytes (TextEncoder), weil Umlaute mehr
 * Bytes als Zeichen sind. Ein einzeln zu grosser Posten bekommt sein Stück, statt still zu fehlen.
 */
/** @param {Parameters<typeof item>[0][]} posten */
export function baueWantedXmlStuecke(posten, grenze = BL_UPLOAD_MAX_BYTES) {
  if (!posten.length) return [baueWantedXml([])];
  const enc = new TextEncoder();
  const bytes = (/** @type {string} */ s) => enc.encode(s).length;
  const RUMPF = bytes('<INVENTORY>\n\n</INVENTORY>\n');
  const stuecke = [];
  let aktuell = [];
  let gross = RUMPF;
  for (const p of posten) {
    const b = bytes(item(p)) + 1;          // +1 für das trennende \n
    if (aktuell.length && gross + b > grenze) {
      stuecke.push(baueWantedXml(aktuell));
      aktuell = []; gross = RUMPF;
    }
    aktuell.push(p); gross += b;
  }
  if (aktuell.length) stuecke.push(baueWantedXml(aktuell));
  return stuecke;
}
