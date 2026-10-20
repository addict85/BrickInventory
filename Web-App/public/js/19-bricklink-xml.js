// ── BrickLink-Wanted-Listen SCHREIBEN ───────────────────────────────────────
//
// Die Gegenrichtung zu js/18-wanted-xml.js (das liest). Benutzt wird sie vom
// BrickLink-Knopf der Teileliste (plExportBricklink in js/08-init.js).
//
// ── Warum eine eigene, DOM-freie Datei ──────────────────────────────────────
//
// Damit sie sich prüfen lässt. js/08-init.js greift schon beim Laden auf das
// Dokument zu; ein Test kann sie deshalb nicht einfach einlesen. Diese Datei
// kennt nur Daten und Zeichenketten — test/bricklink-wanted-xml.test.js
// importiert sie unverändert, so wie test/bundle-smoke.test.js es mit
// js/01-core.js macht.
//
// ── Die drei Stellen, an denen man dieses Format falsch macht ───────────────
//
// Alle drei hatte der Export vom 20.10. falsch, und alle drei fallen erst bei
// BrickLink auf — hier ist nichts zu sehen:
//
//   1. Eine XML-Deklaration (`<?xml …?>`) ist VERBOTEN. BrickLinks Hilfe sagt
//      wörtlich, ein Wanted-List-XML „can not have an XML declaration".
//      Der Leser in js/18-wanted-xml.js verträgt beides, BrickLink nicht —
//      und genau von dort stammte die Zeile.
//   2. Höchstens 204 800 Bytes je Upload (BrickLink-Hilfe 207). Darüber wird
//      die GANZE Datei abgewiesen, nicht der überzählige Teil.
//   3. COLOR ist eine BRICKLINK-Farbnummer. Eine Rebrickable-Nummer dort
//      hinzuschreiben ergibt eine gültige Datei mit der falschen Farbe —
//      Marco bestellt dann rot, was blau sein sollte. Deshalb nimmt
//      [baueWantedXml] `null` als „unbekannt" und schreibt KEIN COLOR;
//      wer eine Nummer nicht hat, lässt den Posten besser weg und sagt es
//      (siehe plExportBricklink).

/**
 * Höchstgrösse eines Uploads, in Bytes.
 *
 * BrickLink-Hilfe 207: „maximum file size allowed for upload is 204800
 * bytes". Einmal benannt, weil die Zahl sonst im Bauteil und in seinem Test
 * zweimal stünde.
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
  // COLOR nur, wenn eine BRICKLINK-Nummer bekannt ist. `null` heisst
  // „unbekannt" und ist etwas anderes als 0 — 0 ist bei BrickLink „(Not
  // Applicable)" und bei Rebrickable SCHWARZ. Diese beiden zu verwechseln
  // hat am 19.10. schon den Import verdorben.
  if (p.color !== null && p.color !== undefined) zeilen.push(`<COLOR>${Number(p.color)}</COLOR>`);
  zeilen.push(`<MINQTY>${Math.max(1, Math.round(p.qty))}</MINQTY>`);
  // CONDITION nur, wenn sie etwas sagt. X ist BrickLinks Vorgabe („egal"),
  // und sie hinzuschreiben ist dasselbe wie sie weglassen — nur länger.
  if (p.condition === 'N' || p.condition === 'U') zeilen.push(`<CONDITION>${esc(p.condition)}</CONDITION>`);
  return `<ITEM>\n${zeilen.map(z => '  ' + z).join('\n')}\n</ITEM>`;
}

/** Eine Liste als BrickLink-XML — als EIN Stück, ohne Rücksicht auf die Grösse. */
export function baueWantedXml(posten) {
  // KEINE XML-Deklaration — siehe Punkt 1 im Kopf dieser Datei.
  return `<INVENTORY>\n${posten.map(item).join('\n')}\n</INVENTORY>\n`;
}

/**
 * Dieselbe Liste, in Stücke geschnitten, die BrickLink annimmt.
 *
 * Gemessen wird in BYTES und nicht in Zeichen: Ein Teilename mit Umlaut wird
 * in UTF-8 zu mehr Bytes als er Zeichen hat, und die Grenze ist eine
 * Bytegrenze. `TextEncoder` statt `.length` ist hier tragend.
 *
 * Ein einzelner Posten, der allein schon zu gross ist, lässt sich nicht
 * teilen; er bekommt sein eigenes Stück, und das ist dann eben zu gross. Das
 * zu verschweigen wäre schlimmer — BrickLink lehnt ab, und niemand wüsste,
 * woran es lag.
 */
export function baueWantedXmlStuecke(posten, grenze = BL_UPLOAD_MAX_BYTES) {
  if (!posten.length) return [baueWantedXml([])];
  const enc = new TextEncoder();
  const bytes = (s) => enc.encode(s).length;
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
