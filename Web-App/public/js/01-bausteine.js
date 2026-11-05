// Bausteine für Ansichten (Detailzeile, Ladeanzeige, Leer- und Fehlerzustand) an einer Stelle: Was
// überall gleich aussehen soll, stand vorher fünfzehnmal als eigene HTML-Zeichenkette in vier Modulen.
// Ausführlich: docs/begruendungen/public/js/01-bausteine.js.md#01-core-js-sammelt-werkzeuge-escaping-bi
import { ico, toast, G, fmtBig, fmtPct, istGeschenk, api } from './01-core.js';
import { tRaw, t } from '../i18n.js';
import { registerActions, resolveAction } from './00-registry.js';
import { esc } from './00-escapen.js';
import { ME } from './00-zustand.js';

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
 * @param {{ stil?: string, klein?: boolean }} [o]  klein: eine Fläche, etwa für das Diagramm
 */
export function ladeAnzeige(text, o = {}) {
  const stil = o.stil ? ` data-stil="${o.stil}"` : '';
  // Ohne Text nur der Kringel — so macht es die Teile-Zusammenfassung, wo
  // daneben schon steht, worauf gewartet wird.
  const inhalt = o.klein ? '<div class="skelett-flaeche"></div>'
    : '<div class="skelett-zeile"></div><div class="skelett-zeile"></div><div class="skelett-zeile kurz"></div>';
  return `<div class="lade-geruest${o.klein ? ' klein' : ''}" role="status" aria-busy="true"${stil}>` +
    `<span class="vh">${text || esc(tRaw('common.loading'))}</span>${inhalt}</div>`;
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
 * Platzhalterzeilen für Listen und Detailansichten (Merkliste, Set-Detail),
 * wie skelettKacheln für Raster.
 * @param {number} anzahl
 * @param {string} text bereits übersetzt
 */
export function skelettZeilen(anzahl, text) {
  const zeile = '<div class="skelett-listenzeile" aria-hidden="true"><div class="skelett-bild"></div><div><div class="skelett-zeile"></div><div class="skelett-zeile kurz"></div></div></div>';
  return `<div class="skelett-liste" role="status" aria-busy="true"><span class="vh">${text}</span>${zeile.repeat(anzahl)}</div>`;
}

/**
 * Ein Wert, der fehlen darf — sonst steht in der Zeile ein leeres Feld.
 * 
 * Die Aufrufer schrieben dafür `${x || '—'}` oder `${x ?? '–'}`, mit zwei
 * verschiedenen Strichen. Hier ist es einer.
 * @param {unknown} wert
 */
export function oderStrich(wert) {
  return (wert === null || wert === undefined || wert === '') ? '—' : String(wert);
}

/**
 * Wie [oderStrich], aber der Wert kommt vom Nutzer und wird escaped.
 * @param {string} wert
 */
export function textOderStrich(wert) {
  return (wert === null || wert === undefined || wert === '') ? '—' : esc(String(wert));
}

/**
 * Fehlerzustand einer Liste: Grund und „Erneut versuchen“. Eine leere Liste
 * an dieser Stelle läse sich als „nichts erfasst“, obwohl nur der Server
 * nicht geantwortet hat.
 * @param {{ grund?: string, erneut: string, arg?: string, titel?: string, details?: string }} o  erneut: Name der Ladefunktion (data-click)
 */
export function fehlerZustand(o) {
  const arg = o.arg ? ` data-arg="${esc(o.arg)}"` : '';
  const details = o.details ? `<details class="fehler-details"><summary>${esc(tRaw('liste.details'))}</summary><code>${esc(o.details)}</code></details>` : '';
  return `<div class="empty leer fehler-zustand" role="alert"><div class="leer-ico">${ico('warnung')}</div>` +
    `<h2>${esc(o.titel || tRaw('liste.fehler_titel'))}</h2><p>${esc(o.grund || tRaw('common.unknown_error'))}</p>${details}` +
    `<button type="button" class="btn bp" data-lesend data-click="${esc(o.erneut)}"${arg}>${ico('aktualisieren')}<span>${esc(tRaw('liste.erneut'))}</span></button></div>`;
}

/**
 * Hat das Laden einer Liste versagt? Dann bleibt eine schon gezeigte Liste
 * stehen (mit Meldung), sonst zeigt `ziel` den Fehlerzustand.
 * @param {HTMLElement|null} ziel
 * @template D
 * @param {D} d          Antwort von api() — null zählt als Fehler
 * @param {{ erneut: string, arg?: string, behalten?: boolean }} o
 * @returns {d is Extract<D, { success: false }>} true, wenn es ein Fehler war und der Aufrufer aufhören soll
 */
export function listeLadefehler(ziel, d, o) {
  const a = /** @type {{ success?: unknown, status?: number, error?: unknown, networkError?: boolean } | null | undefined} */ (d);
  if (a && a.success !== false) return false;
  // Die abgelaufene Sitzung meldet die Anmeldekarte; „Erneut versuchen“ hülfe dort nicht.
  if (a?.status === 401) return true;
  const { grund, details } = verstaendlicherGrund(a);
  const nochmal = () => { const f = resolveAction(o.erneut); if (f) o.arg !== undefined ? f(o.arg) : f(); };
  // „Der letzte Stand bleibt“ nur, wenn einer dasteht: Über einem Fehlerzustand widerspräche der Toast der Liste.
  const alterStand = o.behalten && !ziel?.querySelector('.fehler-zustand, .lade-geruest, .skelett-raster');
  if (alterStand) toast(tRaw('liste.alter_stand_kurz'), 'error', { text: tRaw('liste.erneut'), fn: nochmal }, [grund, details].filter(Boolean).join(' — '));
  else if (ziel) ziel.innerHTML = fehlerZustand({ grund, details, erneut: o.erneut, arg: o.arg });
  return true;
}

/**
 * Ein Serverfehler (5xx) sagt dem Laien nichts. Gezeigt wird, was er tun kann;
 * der Rohtext steht unter „Details“ für die Meldung an den Verwalter.
 * 4xx-Texte schreibt der Server selbst verständlich.
 * @param {{ networkError?: boolean, status?: number, error?: unknown } | null | undefined} d Antwort von api()
 * @returns {{ grund: string, details?: string }}
 */
export function verstaendlicherGrund(d) {
  if (d?.networkError) return { grund: tRaw('net.liste_offline') };
  if (!d || (d.status ?? 0) >= 500 || !d.error) return { grund: tRaw('liste.server_fehler'), details: d?.error ? String(d.error) : undefined };
  return { grund: String(d.error) };
}

/**
 * „144 aus Sets · 250 einzeln“ — leer, solange nur eine der beiden Quellen etwas hat.
 * @param {number} ausSets
 * @param {number} einzeln
 */
export function teileAufschluesselung(ausSets, einzeln) {
  if (!ausSets || !einzeln) return '';
  return t('parts.stat.breakdown', { sets: fmtBig(ausSets), einzeln: fmtBig(einzeln) });
}

/**
 * G&V-Plakette. Bei Kaufpreis 0 „Geschenk“ statt einer Prozentzahl: Gegen 0
 * gerechnet stünde dort „+327.600 %“, und das sagt nichts.
 * @param {number | string | null | undefined} pct
 * @param {unknown} [kauf]
 */
export function pnlBadge(pct, kauf){
  if(istGeschenk(kauf)) return `<span class="pnl-geschenk">${t('finance.gift')}</span>`;
  if(pct===null||pct===undefined) return '';
  const v=parseFloat(String(pct)); const cls=v>0?'pnl-pos':v<0?'pnl-neg':'pnl-neu';
  return `<span class="${cls}">${fmtPct(v)}</span>`;
}

/**
 * Besitzer-Plaketten nur, wenn ein ANDERES Konto mit drinsteckt: Im Haushalt verhindern sie, dass man
 * das falsche Exemplar verschiebt; der eigene Name auf jeder Kachel wäre nur Rauschen.
 * Ausführlich: docs/begruendungen/public/js/01-bausteine.js.md#besitzer-plaketten-nur-im-haushalt
 * @param {{ owners?: { id: number, username: string }[] } | null | undefined} item
 */
export function ownerBadges(item) {
  if (!item?.owners?.length) return '';
  if (item.owners.every(o => ME && o.id === ME.id)) return '';
  return item.owners.map(o => `<span class="cond-badge besitzer-badge" title="${esc(o.username)}">${esc(o.username)}</span>`).join('');
}

/**
 * Eine Plakette je erfasstem Zustand, aus `conditions` vom Server: Das Aggregat `condition` zeigte bei
 * neu und gebraucht nur „gebraucht“, und die Neu-Erfassung war unsichtbar, obwohl sie mitbewertet
 * wird.
 * Ausführlich: docs/begruendungen/public/js/01-bausteine.js.md#zustands-plaketten-eines-eintrags-eine-j
 * @param {{ conditions?: string[] | null, condition?: string | null } | null | undefined} item
 */
export function condBadges(item) {
  const list = Array.isArray(item?.conditions) && item.conditions.length
    ? item.conditions
    : [item?.condition === 'U' ? 'U' : 'N'];
  return list.map((/** @type {string} */ c) => c === 'U'
    ? `<span class="cond-badge cond-used"><span class="vh">${t('common.condition')}: </span>${t('common.condition_used')}</span>`
    : `<span class="cond-badge cond-new"><span class="vh">${t('common.condition')}: </span>${t('common.condition_badge_new')}</span>`
  ).join('');
}

/** Erfassen-Dialoge der Sammlung: set, part, fig — gleich aufgebaut (Erstfokus: data-erstfokus). */
// Ohne data-arg reicht der Dispatcher das Ereignis als erstes Argument.
const erfassenDialog = (/** @type {unknown} */ art) => G(`add-${typeof art === 'string' ? art : 'set'}-modal`);

/**
 * @param {string} [art]
 */
export function oeffneErfassen(art){ erfassenDialog(art)?.classList.add('open'); }

/**
 * @param {string} [art]
 */
export function schliesseErfassen(art){ erfassenDialog(art)?.classList.remove('open'); }

/**
 * Gewählte CSV-Datei hochladen und das Ergebnis melden — eine Fassung für
 * Teile, Figuren, Merkliste und Alarme. Übersprungene Zeilen und Zusatz-
 * hinweise stehen überall in der Meldung, sonst sähe ein lückenhafter Import
 * aus wie ein vollständiger.
 * @param {{ feld: string, pfad: string, felder?: Record<string, string>,
 *           zeige?: (laeuft: boolean) => void, hinweise?: (d: any) => unknown[] }} o
 * @returns {Promise<any>} die Antwort bei Erfolg, sonst null
 */
export async function csvHochladen(o) {
  const fi = G(o.feld);
  if (!fi?.files?.[0]) return null;
  const fd = new FormData();
  fd.append('file', fi.files[0]);
  for (const [k, v] of Object.entries(o.felder ?? {})) fd.append(k, v);
  o.zeige?.(true);
  const d = await api('POST', o.pfad, fd);
  fi.value = '';
  o.zeige?.(false);
  if (!d.success) { toast(d.error || tRaw('settings.error'), 'error'); return null; }
  const extra = (o.hinweise?.(d) ?? []).filter(Boolean);
  const zusatz = [d.skipped_hint, ...extra].filter(Boolean).join(' — ');
  toast(tRaw('import.summary', { added: d.added, updated: d.updated, errors: d.errors }) + (zusatz ? ` — ${zusatz}` : ''),
    (d.errors || d.skipped || extra.length) ? 'info' : 'success');
  return d;
}

registerActions({
  oeffneErfassen,
  schliesseErfassen,
});
