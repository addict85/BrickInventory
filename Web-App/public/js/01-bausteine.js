// ── Bausteine für Ansichten ──────────────────────────────────────────────────
//
// 01-core.js sammelt WERKZEUGE: Escaping, Bild-URLs, Formatierung, Toasts,
// Theme. Was dort fehlte, sind Bausteine für die ANSICHT — und die standen
// deshalb als HTML-Zeichenkette in jedem Modul neu.
//
// ── Warum das mehr ist als Kosmetik ─────────────────────────────────────────
//
// Die Detailzeile stand fünfzehnmal von Hand geschrieben, in vier Modulen:
//
//     <div class="dr"><span class="dl">Label</span><span class="dv">Wert</span></div>
//
// Wer die Zeile ändern will — Abstand, Trennlinie, Umbruchverhalten auf dem
// Telefon —, muss heute alle fünfzehn finden. Und wer eine neue Detailansicht
// baut, schreibt die sechzehnte ab, samt der Frage, ob `dl` oder `dt` die
// richtige Klasse war.
//
// Dieselbe Überlegung wie bei AppKarte und Formen.kachelBreite in der
// Android-App: Was ALLE gleich aussehen soll, gehört an eine Stelle; was sich
// unterscheidet, bleibt beim Aufrufer.
//
// ── Die Klassennamen bleiben, wie sie sind ──────────────────────────────────
//
// `dr`, `dl`, `dv` sagen niemandem etwas ("detail row / label / value"). Sie
// stehen aber auch in styles.css, mobile.css und brick.css; sie umzubenennen
// hiesse, drei Stylesheets und ein Theme anzufassen, ohne dass sich etwas
// verbessert, das man sehen kann. Ab jetzt sind sie eine INNERE Angelegenheit
// dieser Datei — wer eine Detailzeile braucht, schreibt `detailZeile(…)` und
// sieht die Kürzel nie. In styles.css steht daneben, wofür sie stehen.
import { esc } from './01-core.js';

/**
 * Eine Zeile „Label — Wert" in einer Detailansicht.
 *
 * @param {string} label     Beschriftung links. Wird NICHT escaped: Alle
 *                           Aufrufer geben hier eine Übersetzung t(...), und
 *                           die ist bereits sicher. Ein escape hier würde die
 *                           Sonderzeichen der Übersetzungen zerstören.
 * @param {string} wert      Inhalt rechts. Wird NICHT escaped — viele
 *                           Aufrufer geben absichtlich Markup mit (Eingabe-
 *                           felder, Farbpunkte, Knöpfe). Wer Nutzertext
 *                           einsetzt, escaped ihn selbst mit esc().
 * @param {object} [o]
 * @param {string} [o.wertStil]  zusätzliches style-Attribut am Wert-Element
 * @param {string} [o.zeilenStil] zusätzliches style-Attribut an der Zeile
 * @param {string} [o.wertId]    id am Wert-Element, für späteres Nachfüllen
 */
export function detailZeile(label, wert, o = {}) {
  const zStil = o.zeilenStil ? ` style="${o.zeilenStil}"` : '';
  const wStil = o.wertStil ? ` style="${o.wertStil}"` : '';
  const wId   = o.wertId ? ` id="${o.wertId}"` : '';
  return `<div class="dr"${zStil}><span class="dl">${label}</span>` +
         `<span class="dv"${wId}${wStil}>${wert}</span></div>`;
}

/**
 * Die Ladeanzeige — Kringel und Text, wie sie fünf Stellen bauten.
 *
 * @param {string} text bereits übersetzter Text
 */
export function ladeAnzeige(text, o = {}) {
  const stil = o.stil ? ` style="${o.stil}"` : '';
  // Ohne Text nur der Kringel — so macht es die Teile-Zusammenfassung, wo
  // daneben schon steht, worauf gewartet wird.
  const beschriftung = text ? `<span>${text}</span>` : '';
  return `<div class="loading"${stil}><div class="spin"></div>${beschriftung}</div>`;
}

/**
 * Ein Wert, der fehlen darf — sonst steht in der Zeile ein leeres Feld.
 *
 * Die Aufrufer schrieben dafür `${x || '—'}` oder `${x ?? '–'}`, mit zwei
 * verschiedenen Strichen. Hier ist es einer.
 */
export function oderStrich(wert) {
  return (wert === null || wert === undefined || wert === '') ? '—' : String(wert);
}

/** Wie [oderStrich], aber der Wert kommt vom Nutzer und wird escaped. */
export function textOderStrich(wert) {
  return (wert === null || wert === undefined || wert === '') ? '—' : esc(String(wert));
}
