// Writes wanted lists, the reverse direction of wanted-xml.js. A separate, DOM-free file so a test can
// read it in — init.js already touches the document when it loads.

/**
 * Maximum upload size, in bytes.
 *
 * BrickLink help 207: "maximum file size allowed for upload is 204800 bytes". Named once, because
 * otherwise the number would sit in both this module and its test.
 */
import { esc } from './escaping.js';

export const BL_UPLOAD_MAX_BYTES = 204800;

/**
 * An `<ITEM>` block.
 *
 * @param {{type:string, part:string, color:number|null, qty:number,
 *          condition?:string}} p
 */
function item(p) {
  const lines = [`<ITEMTYPE>${esc(p.type)}</ITEMTYPE>`, `<ITEMID>${esc(p.part)}</ITEMID>`];
  // COLOR only when a BRICKLINK number is known. `null` means "unknown" and is different from 0 — 0 is
  // "(Not Applicable)" at BrickLink and BLACK at Rebrickable. Confusing the two already ruined an import
  // on 10/19.
  if (p.color !== null && p.color !== undefined) lines.push(`<COLOR>${Number(p.color)}</COLOR>`);
  lines.push(`<MINQTY>${Math.max(1, Math.round(p.qty))}</MINQTY>`);
  // CONDITION only when it says something. X is BrickLink's default ("doesn't matter"), and writing it
  // out is the same as leaving it off — just longer.
  if (p.condition === 'N' || p.condition === 'U') lines.push(`<CONDITION>${esc(p.condition)}</CONDITION>`);
  return `<ITEM>\n${lines.map(z => '  ' + z).join('\n')}\n</ITEM>`;
}

/** A list as BrickLink XML — as ONE piece, regardless of size. */
/** @param {Parameters<typeof item>[0][]} items */
export function baueWantedXml(items) {
  // NO XML declaration — see point 1 at the top of this file.
  return `<INVENTORY>\n${items.map(item).join('\n')}\n</INVENTORY>\n`;
}

/**
 * Cut the list into chunks BrickLink accepts. Measured in bytes (TextEncoder), because umlauts take more
 * bytes than characters. A single item that's too big on its own still gets its own chunk, instead of
 * silently going missing.
 */
/** @param {Parameters<typeof item>[0][]} items */
export function baueWantedXmlStuecke(items, limit = BL_UPLOAD_MAX_BYTES) {
  if (!items.length) return [baueWantedXml([])];
  const enc = new TextEncoder();
  const bytes = (/** @type {string} */ s) => enc.encode(s).length;
  const WRAPPER_BYTES = bytes('<INVENTORY>\n\n</INVENTORY>\n');
  const chunks = [];
  let current = [];
  let size = WRAPPER_BYTES;
  for (const p of items) {
    const b = bytes(item(p)) + 1; // +1 for the separating \n
    if (current.length && size + b > limit) {
      chunks.push(baueWantedXml(current));
      current = [];
      size = WRAPPER_BYTES;
    }
    current.push(p);
    size += b;
  }
  if (current.length) chunks.push(baueWantedXml(current));
  return chunks;
}
