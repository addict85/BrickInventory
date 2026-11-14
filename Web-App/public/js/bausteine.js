// Bausteine für Ansichten (Detailzeile, Ladeanzeige, Leer- und Fehlerzustand) an einer Stelle: Was überall
// gleich aussehen soll, stand vorher fünfzehnmal als eigene HTML-Zeichenkette in vier Modulen.
import { api } from './api.js';
import { ico, G, setzeHtml } from './dom.js';
import { fmtBig, fmtPct, istGeschenk } from './format.js';
import { toast } from './meldungen.js';
import { tRaw } from '../i18n.js';
import { registerActions, resolveAction } from './registry.js';
import { esc, html, ungeprueft } from './escapen.js';
import { ME, CURRENCY } from './zustand.js';

/**
 * Eine Zeile „Label — Wert" in einer Detailansicht.
 *
 * @param {string | import('./escapen.js').SicheresHtml} label     Beschriftung links. Wird NICHT escaped: Alle
 *                           Aufrufer geben hier eine Übersetzung t(...), und
 *                           die ist bereits sicher. Ein escape hier würde die
 *                           Sonderzeichen der Übersetzungen zerstören.
 * @param {import('./escapen.js').Markup | string} wert      Inhalt rechts. Wird NICHT escaped — viele
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
  const wId = o.wertId ? ` id="${o.wertId}"` : '';
  return html`${html`<div class="dr${zKlasse}"${ungeprueft(zStil)}><span class="dl">${ungeprueft(label)}</span>`}${html`<span class="dv"${ungeprueft(wId)}${ungeprueft(wStil)}>${typeof wert === 'string' ? ungeprueft(wert) : wert}</span></div>`}`;
}

/**
 * Die Ladeanzeige — Kringel und Text, wie sie fünf Stellen bauten.
 *
 * @param {string} text bereits übersetzter Text
 * @param {{ stil?: string, klein?: boolean }} [o]  klein: eine Fläche, etwa für das Diagramm
 */
export function ladeAnzeige(text, o = {}) {
  const stil = o.stil ? ` data-stil="${o.stil}"` : '';
  // Ohne Text nur der Kringel — so macht es die Teile-Zusammenfassung, wo daneben schon steht, worauf
  // gewartet wird.
  const inhalt = o.klein
    ? '<div class="skelett-flaeche"></div>'
    : '<div class="skelett-zeile"></div><div class="skelett-zeile"></div><div class="skelett-zeile kurz"></div>';
  return html`${html`<div class="lade-geruest${o.klein ? ' klein' : ''}" role="status" aria-busy="true"${ungeprueft(stil)}>`}${html`<span class="vh">${text ? ungeprueft(text) : tRaw('common.loading')}</span>${ungeprueft(inhalt)}</div>`}`;
}

/**
 * Platzhalterkacheln in der Form des Inhalts, solange er lädt: Die Seite springt danach nicht, und man sieht,
 * was kommt. Der Text ist für Vorleseprogramme.
 * @param {number} anzahl
 * @param {string} text bereits übersetzt
 * @param {'set'|'teil'} [art]
 */
export function skelettKacheln(anzahl, text, art = 'set') {
  const raster = art === 'teil' ? 'parts-grid' : 'sgrid';
  const kachel = html`<div class="${art === 'teil' ? 'part-card' : 'sc'} skelett" aria-hidden="true"><div class="skelett-bild"></div><div class="skelett-zeile"></div><div class="skelett-zeile kurz"></div></div>`;
  return html`<div class="${raster} skelett-raster" role="status" aria-busy="true"><span class="vh">${ungeprueft(text)}</span>${Array.from({ length: anzahl }, () => kachel)}</div>`;
}

/**
 * Platzhalterzeilen für Listen und Detailansichten (Merkliste, Set-Detail), wie skelettKacheln für Raster.
 * @param {number} anzahl
 * @param {string} text bereits übersetzt
 */
export function skelettZeilen(anzahl, text) {
  const zeile =
    '<div class="skelett-listenzeile" aria-hidden="true"><div class="skelett-bild"></div><div><div class="skelett-zeile"></div><div class="skelett-zeile kurz"></div></div></div>';
  return html`<div class="skelett-liste" role="status" aria-busy="true"><span class="vh">${ungeprueft(text)}</span>${ungeprueft(zeile.repeat(anzahl))}</div>`;
}

/**
 * Ein Wert, der fehlen darf — sonst steht in der Zeile ein leeres Feld.
 *
 * Die Aufrufer schrieben dafür `${x || '—'}` oder `${x ?? '–'}`, mit zwei verschiedenen Strichen. Hier ist es
 * einer.
 * @param {unknown} wert
 */
export function oderStrich(wert) {
  return wert === null || wert === undefined || wert === '' ? '—' : String(wert);
}

/**
 * Wie [oderStrich], aber der Wert kommt vom Nutzer und wird escaped.
 * @param {string} wert
 */
export function textOderStrich(wert) {
  return wert === null || wert === undefined || wert === '' ? '—' : esc(String(wert));
}

/**
 * Fehlerzustand einer Liste: Grund und „Erneut versuchen“. Eine leere Liste an dieser Stelle läse sich als
 * „nichts erfasst“, obwohl nur der Server nicht geantwortet hat.
 * @param {{ grund?: string, erneut: string, arg?: string, titel?: string, details?: string }} o  erneut: Name der Ladefunktion (data-click)
 */
export function fehlerZustand(o) {
  const arg = o.arg ? ` data-arg="${esc(o.arg)}"` : '';
  const details = o.details
    ? html`<details class="fehler-details"><summary>${tRaw('liste.details')}</summary><code>${o.details}</code></details>`
    : '';
  return html`${html`<div class="empty leer fehler-zustand" role="alert"><div class="leer-ico">${ico('warnung')}</div>`}${html`<h2>${o.titel || tRaw('liste.fehler_titel')}</h2><p>${o.grund || tRaw('common.unknown_error')}</p>${details}`}${html`<button type="button" class="btn bp" data-lesend data-click="${o.erneut}"${ungeprueft(arg)}>${ico('aktualisieren')}<span>${tRaw('liste.erneut')}</span></button></div>`}`;
}

/**
 * Hat das Laden einer Liste versagt? Dann bleibt eine schon gezeigte Liste stehen (mit Meldung), sonst zeigt
 * `ziel` den Fehlerzustand.
 * @param {HTMLElement|null} ziel
 * @template D
 * @param {D} d          Antwort von api() — null zählt als Fehler
 * @param {{ erneut: string, arg?: string, behalten?: boolean }} o
 * @returns {d is Extract<D, { success: false }>} true, wenn es ein Fehler war und der Aufrufer aufhören soll
 */
export function listeLadefehler(ziel, d, o) {
  const a =
    /** @type {{ success?: unknown, status?: number, error?: unknown, networkError?: boolean } | null | undefined} */ (
      d
    );
  if (a && a.success !== false) return false;
  // Die abgelaufene Sitzung meldet die Anmeldekarte; „Erneut versuchen“ hülfe dort nicht.
  if (a?.status === 401) return true;
  const { grund, details } = verstaendlicherGrund(a);
  const nochmal = () => {
    const f = resolveAction(o.erneut);
    if (f) o.arg !== undefined ? f(o.arg) : f();
  };
  // „Der letzte Stand bleibt“ nur, wenn einer dasteht: Über einem Fehlerzustand widerspräche der Toast der Liste.
  const alterStand = o.behalten && !ziel?.querySelector('.fehler-zustand, .lade-geruest, .skelett-raster');
  if (alterStand)
    toast(
      tRaw('liste.alter_stand_kurz'),
      'error',
      { text: tRaw('liste.erneut'), fn: nochmal },
      [grund, details].filter(Boolean).join(' — '),
    );
  else if (ziel) setzeHtml(ziel, fehlerZustand({ grund, details, erneut: o.erneut, arg: o.arg }));
  return true;
}

/**
 * Ein Serverfehler (5xx) sagt dem Laien nichts. Gezeigt wird, was er tun kann; der Rohtext steht unter
 * „Details“ für die Meldung an den Verwalter. 4xx-Texte schreibt der Server selbst verständlich.
 * @param {{ networkError?: boolean, status?: number, error?: unknown } | null | undefined} d Antwort von api()
 * @returns {{ grund: string, details?: string }}
 */
export function verstaendlicherGrund(d) {
  if (d?.networkError) return { grund: tRaw('net.liste_offline') };
  if (!d || (d.status ?? 0) >= 500 || !d.error)
    return { grund: tRaw('liste.server_fehler'), details: d?.error ? String(d.error) : undefined };
  return { grund: String(d.error) };
}

/**
 * „144 aus Sets · 250 einzeln“ — leer, solange nur eine der beiden Quellen etwas hat.
 * @param {number} ausSets
 * @param {number} einzeln
 */
export function teileAufschluesselung(ausSets, einzeln) {
  if (!ausSets || !einzeln) return '';
  return tRaw('parts.stat.breakdown', { sets: fmtBig(ausSets), einzeln: fmtBig(einzeln) });
}

/**
 * Der Tastaturweg einer anklickbaren Tabellenzeile: ein echter Knopf in einer Zelle. Die Zeile selbst bleibt
 * für die Maus anklickbar, nimmt aber keinen Fokus mehr; eine fokussierbare <tr> nannte Vorlesern weder
 * Rolle noch Ziel.
 * @param {{ click: string, arg?: string | number, arg2?: string | number, arg3?: string | number }} ziel
 * @param {import('./escapen.js').Markup | string} sichtbar  Inhalt der Zelle
 * @param {string} name  Name des Knopfs; enthält den sichtbaren Text
 * Inhalt in einem <span>: Im Flex-Knopf fiele sonst der Abstand in „Brick 2 x 4 (Schwarz)“ weg.
 */
export function zeilenKnopf(ziel, sichtbar, name) {
  return html`<button type="button" class="zeile-oeffnen" data-click="${ziel.click}"${ziel.arg !== undefined ? html` data-arg="${ziel.arg}"` : ''}${ziel.arg2 !== undefined ? html` data-arg2="${ziel.arg2}"` : ''}${ziel.arg3 !== undefined ? html` data-arg3="${ziel.arg3}"` : ''} aria-label="${name}"><span>${sichtbar}</span></button>`;
}

let _kachelNr = 0;
/**
 * Name einer Kachel (role=button) nur aus Name und Nummer; der übrige Inhalt hängt per aria-describedby als
 * Beschreibung an. Ohne Namen las der Vorleser den ganzen Kachelinhalt als Namen, rund 190 Zeichen je Karte.
 * @param {string} name @param {string} nummer @param {number} [teile] Anzahl beschreibender Elemente
 */
export function kachelName(name, nummer, teile = 1) {
  const id = `kachel-${++_kachelNr}`;
  const ids = Array.from({ length: teile }, (_, i) => `${id}-${i + 1}`);
  return { attr: html` aria-label="${nummer ? `${name}, ${nummer}` : name}" aria-describedby="${ids.join(' ')}"`, ids };
}

/** „≈“ vor einem Kaufpreis, der ein eingesetzter Marktpreis ist; sonst läse er sich wie bezahlt.
 * @param {string | import('./escapen.js').SicheresHtml} markup schon maskiertes Markup */
export function geschaetztKauf(markup) {
  const hinweis = tRaw('acq.geschaetzt');
  return html`<span class="kauf-geschaetzt" title="${hinweis}"><span role="img" aria-label="${hinweis}">≈</span> ${ungeprueft(String(markup))}</span>`;
}

/**
 * G&V-Plakette. Bei Kaufpreis 0 „Geschenk“ statt einer Prozentzahl: Gegen 0 gerechnet stünde dort „+327.600
 * %“, und das sagt nichts.
 * @param {number | string | null | undefined} pct
 * @param {unknown} [kauf]
 */
export function pnlBadge(pct, kauf) {
  if (istGeschenk(kauf)) return html`<span class="pnl-geschenk">${tRaw('finance.gift')}</span>`;
  if (pct === null || pct === undefined) return '';
  const v = parseFloat(String(pct));
  const cls = v > 0 ? 'pnl-pos' : v < 0 ? 'pnl-neg' : 'pnl-neu';
  return html`<span class="${cls}">${fmtPct(v)}</span>`;
}

/**
 * Besitzer-Plaketten nur, wenn ein ANDERES Konto mit drinsteckt: Im Haushalt verhindern sie, dass man das
 * falsche Exemplar verschiebt; der eigene Name auf jeder Kachel wäre nur Rauschen.
 * @param {{ owners?: { id: number, username: string }[] } | null | undefined} item
 */
export function ownerBadges(item) {
  if (!item?.owners?.length) return '';
  if (item.owners.every(o => ME && o.id === ME.id)) return '';
  return html`${item.owners.map(o => html`<span class="cond-badge besitzer-badge" title="${o.username}">${o.username}</span>`)}`;
}

/**
 * Eine Plakette je erfasstem Zustand, aus `conditions` vom Server: Das Aggregat `condition` zeigte bei neu
 * und gebraucht nur „gebraucht“, und die Neu-Erfassung war unsichtbar, obwohl sie mitbewertet wird.
 * @param {{ conditions?: string[] | null, condition?: string | null } | null | undefined} item
 */
export function condBadges(item) {
  const list =
    Array.isArray(item?.conditions) && item.conditions.length ? item.conditions : [item?.condition === 'U' ? 'U' : 'N'];
  return html`${list.map((/** @type {string} */ c) =>
    c === 'U'
      ? html`<span class="cond-badge cond-used"><span class="vh">${tRaw('common.condition')}: </span>${tRaw('common.condition_used')}</span>`
      : html`<span class="cond-badge cond-new"><span class="vh">${tRaw('common.condition')}: </span>${tRaw('common.condition_badge_new')}</span>`,
  )}`;
}

/** Erfassen-Dialoge der Sammlung: set, part, fig — gleich aufgebaut (Erstfokus: data-erstfokus). */
// Ohne data-arg reicht der Dispatcher das Ereignis als erstes Argument.
const erfassenDialog = (/** @type {unknown} */ art) => G(`add-${typeof art === 'string' ? art : 'set'}-modal`);

/**
 * @param {string} [art]
 */
export function oeffneErfassen(art) {
  const dialog = erfassenDialog(art);
  // Das Kaufdatum steht auf heute und die Währung auf der des Kontos, solange niemand etwas anderes wählt.
  dialog?.querySelectorAll('input[data-heute]').forEach(f => {
    if (f instanceof HTMLInputElement) {
      f.max = heuteIso();
      if (!f.value) f.value = heuteIso();
    }
  });
  const w = /** @type {HTMLSelectElement | null} */ (dialog?.querySelector('#add-currency') ?? null);
  if (w && !(/** @type {HTMLInputElement | null} */ (dialog?.querySelector('#add-price'))?.value)) w.value = CURRENCY;
  dialog?.classList.add('open');
}

/** Heute als JJJJ-MM-TT im Kalender des Geräts. */
export function heuteIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * @param {string} [art]
 */
export function schliesseErfassen(art) {
  erfassenDialog(art)?.classList.remove('open');
}

/**
 * Gewählte CSV-Datei hochladen und das Ergebnis melden — eine Fassung für Teile, Figuren, Merkliste und
 * Alarme. Übersprungene Zeilen und Zusatz-hinweise stehen überall in der Meldung, sonst sähe ein lückenhafter
 * Import aus wie ein vollständiger.
 * @typedef {{ success: boolean, error?: string, added?: number, updated?: number, errors?: number,
 *   skipped?: number, skipped_hint?: string, [feld: string]: unknown }} CsvErgebnis
 * @param {{ feld: string, pfad: string, felder?: Record<string, string>,
 *           zeige?: (laeuft: boolean) => void, hinweise?: (d: CsvErgebnis) => unknown[] }} o
 * @returns {Promise<CsvErgebnis | null>} die Antwort bei Erfolg, sonst null
 */
export async function csvHochladen(o) {
  const fi = G(o.feld);
  if (!fi?.files?.[0]) return null;
  const fd = new FormData();
  fd.append('file', fi.files[0]);
  for (const [k, v] of Object.entries(o.felder ?? {})) fd.append(k, v);
  o.zeige?.(true);
  /** @type {CsvErgebnis} */
  const d = await api('POST', o.pfad, fd);
  fi.value = '';
  o.zeige?.(false);
  if (!d.success) {
    toast(d.error || tRaw('settings.error'), 'error');
    return null;
  }
  const extra = (o.hinweise?.(d) ?? []).filter(Boolean);
  const zusatz = [d.skipped_hint, ...extra].filter(Boolean).join(' — ');
  toast(
    tRaw('import.summary', { added: d.added, updated: d.updated, errors: d.errors }) + (zusatz ? ` — ${zusatz}` : ''),
    d.errors || d.skipped || extra.length ? 'info' : 'success',
  );
  return d;
}

registerActions({
  oeffneErfassen,
  schliesseErfassen,
});
