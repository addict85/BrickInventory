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
import { esc, ico, toast } from './01-core.js';
import { tRaw } from '../i18n.js';
import { resolveAction } from './00-registry.js';

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
 * @param {string} [o.wertStil]  zusätzlicher Stil (data-stil) am Wert-Element
 * @param {string} [o.zeilenStil] zusätzlicher Stil (data-stil) an der Zeile
 * @param {string} [o.wertId]    id am Wert-Element, für späteres Nachfüllen
 * @param {string} [o.klasse]    zusätzliche Klasse an der Zeile
 */
export function detailZeile(label, wert, o = {}) {
  const zStil = o.zeilenStil ? ` data-stil="${o.zeilenStil}"` : '';
  const zKlasse = o.klasse ? ` ${o.klasse}` : '';
  const wStil = o.wertStil ? ` data-stil="${o.wertStil}"` : '';
  const wId   = o.wertId ? ` id="${o.wertId}"` : '';
  return `<div class="dr${zKlasse}"${zStil}><span class="dl">${label}</span>` +
         `<span class="dv"${wId}${wStil}>${wert}</span></div>`;
}

/**
 * Die Ladeanzeige — Kringel und Text, wie sie fünf Stellen bauten.
 *
 * @param {string} text bereits übersetzter Text
 * @param {{ stil?: string, klein?: boolean }} [o]  klein: für eine Fläche wie das Diagramm
 */
export function ladeAnzeige(text, o = {}) {
  const stil = o.stil ? ` data-stil="${o.stil}"` : '';
  // Ohne Text nur der Kringel — so macht es die Teile-Zusammenfassung, wo
  // daneben schon steht, worauf gewartet wird.
  const beschriftung = text ? `<span>${text}</span>` : '';
  return o.klein ? `<div class="loading klein"${stil}><div class="spin"></div>${beschriftung}</div>`
                 : `<div class="loading"${stil}><div class="spin"></div>${beschriftung}</div>`;
}

/**
 * Platzhalterkacheln in der Form des Inhalts, solange er lädt: Die Seite
 * springt danach nicht, und man sieht, was kommt. Der Text ist für
 * Vorleseprogramme.
 * @param {number} anzahl
 * @param {string} text bereits übersetzt
 * @param {'set'|'teil'} [art]
 */
export function skelettKacheln(anzahl, text, art = 'set') {
  const raster = art === 'teil' ? 'parts-grid' : 'sgrid';
  const kachel = `<div class="${art === 'teil' ? 'part-card' : 'sc'} skelett" aria-hidden="true"><div class="skelett-bild"></div><div class="skelett-zeile"></div><div class="skelett-zeile kurz"></div></div>`;
  return `<div class="${raster} skelett-raster" role="status" aria-busy="true"><span class="vh">${text}</span>${kachel.repeat(anzahl)}</div>`;
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

/**
 * Fehlerzustand einer Liste: Grund und „Erneut versuchen“. Eine leere Liste
 * an dieser Stelle läse sich als „nichts erfasst“, obwohl nur der Server
 * nicht geantwortet hat.
 * @param {{ grund?: string, erneut: string, arg?: string }} o  erneut: Name der Ladefunktion (data-click)
 */
export function fehlerZustand(o) {
  const arg = o.arg ? ` data-arg="${esc(o.arg)}"` : '';
  return `<div class="empty leer fehler-zustand" role="alert"><div class="leer-ico">${ico('warnung')}</div>` +
    `<h3>${esc(tRaw('liste.fehler_titel'))}</h3><p>${esc(o.grund || tRaw('common.unknown_error'))}</p>` +
    `<button type="button" class="btn bp" data-click="${esc(o.erneut)}"${arg}>${ico('aktualisieren')}<span>${esc(tRaw('liste.erneut'))}</span></button></div>`;
}

/**
 * Hat das Laden einer Liste versagt? Dann bleibt eine schon gezeigte Liste
 * stehen (mit Meldung), sonst zeigt `ziel` den Fehlerzustand.
 * @param {HTMLElement|null} ziel
 * @param {any} d          Antwort von api() — null zählt als Fehler
 * @param {{ erneut: string, arg?: string, behalten?: boolean }} o
 * @returns {boolean} true, wenn es ein Fehler war und der Aufrufer aufhören soll
 */
export function listeLadefehler(ziel, d, o) {
  if (d && d.success !== false) return false;
  const grund = d?.error || tRaw('api.unreachable');
  const nochmal = () => { const f = resolveAction(o.erneut); if (f) o.arg !== undefined ? f(o.arg) : f(); };
  if (o.behalten) toast(`${grund} ${tRaw('liste.alter_stand')}`, 'error', { text: tRaw('liste.erneut'), fn: nochmal });
  else if (ziel) ziel.innerHTML = fehlerZustand({ grund, erneut: o.erneut, arg: o.arg });
  return true;
}
