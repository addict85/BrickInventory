import { echt, registerActions } from './00-registry.js';
import { t, tRaw } from '../i18n.js';
import { api, apiRoh } from './01-api.js';
import { ico, G } from './01-dom.js';
import { fmtDatum, fmtN, betragFuerFeld } from './01-format.js';
import { antwortFehler, betragAusFeld } from './01-formular.js';
import { toast } from './01-meldungen.js';
import { openPdfViewer } from './12-pdfviewer.js';
import { CURRENCY, _settingsCache } from './00-zustand.js';
import { esc } from './00-escapen.js';
import { bestaetigeMitPasswort, mitZweitemFaktor } from './01-rueckfrage.js';

// Gutscheine (LEGO-Geschenkkarten) stehen direkt im Profil statt in einem eigenen Reiter: Sie sollen
// schnell erreichbar sein, und wie in der App erfassen, ändern und anzeigen.
// Ausführlich: docs/begruendungen/public/js/17-gutscheine.js.md#im-eigenen-profil-sollen-lego-gutscheine

/** Die zuletzt geladene Liste — für die Knöpfe, die auf eine Zeile zeigen. */
/** @type {import('../../frontend-typen/vertrag').Gutschein[]} */
let _gutscheine = [];

/** Die id des Gutscheins, der gerade bearbeitet wird; null = neuer Eintrag. */
/** @type {number | string | null} */
let _bearbeitet = null;

/** @param {string} id */
const el = (/** @type {string} */ id) => /** @type {Feld} */ (document.getElementById(id));

// Die Handler nehmen die id als ERSTES Argument und kein Ereignis: Der
// Verteiler in 11-actions.js reicht `data-arg`, `data-arg2` … in dieser
// Reihenfolge durch und haengt das Ereignis ZULETZT an. Ein `(ev, id)` waere
// also still verdreht — die id landete in `ev`.

/** Eingeblendete PINs: auch nach dem Abruf nur auf Wunsch, gegen die Schulter daneben. */
const _sichtbar = new Set();

/** Nummer und PIN im Klartext je id: Die Liste des Servers trägt nur die Maske,
 * den Klartext gibt es bestätigt und protokolliert, einmal je Gutschein und Seite. */
const _klartext = new Map();

/**
 * @param {number} id
 */
async function holeKlartext(id) {
  if (_klartext.has(id)) return _klartext.get(id);
  const password = await bestaetigeMitPasswort(tRaw('vouchers.klartext_title'), tRaw('vouchers.klartext_text'), 'schloss', { knopf: 'confirm.btn.anzeigen', art: 'bp' });
  if (password === null) return null;
  const d = await mitZweitemFaktor(z => api('POST', `/v1/vouchers/${id}/klartext`, { password, ...z }));
  if (!d?.success) { if (d) toast(d.error || tRaw('vouchers.load_error'), 'error'); return null; }
  _klartext.set(id, { number: d.number, pin: d.pin });
  return _klartext.get(id);
}

/**
 * Das Kopieren-Symbol — zwei Blaetter, wie ueberall sonst auch.
 *
 * Inline und nicht als Schriftzeichen: Ein Emoji sieht auf jedem System
 * anders aus und faellt bei manchen Schriften ganz aus. `currentColor` laesst
 * es die Farbe des Knopfes annehmen, also auch im Dunkelmodus.
 */
const KOPIE_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="9" y="9" width="13" height="13" rx="2"/>' +
  '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

/** „6123-4567-8901“ und „612345678901“ → „6123 4567 8901“. */
/** @param {unknown} roh */
export function gruppiereNummer(roh) {
  return String(roh ?? '').replace(/[\s-]/g, '').replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** Die Währung der Karten des Ausgabelandes; ohne Land die des Kontos. */
/** @type {Record<string, string>} */
const LAND_WAEHRUNG = { 'de-CH': 'CHF', 'de-DE': 'EUR', 'de-AT': 'EUR', 'fr-FR': 'EUR', 'it-IT': 'EUR', 'nl-NL': 'EUR', 'en-GB': 'GBP', 'en-US': 'USD' };
/** Ohne gespeichertes Ausgabeland das Land zur Kontowährung (wie landFuerWaehrung im Server). */
/** @type {Record<string, string>} */
export const LAND_ZUR_WAEHRUNG = { CHF: 'de-CH', EUR: 'de-DE', GBP: 'en-GB', USD: 'en-US' };
export function landWaehrung() {
  const land = G('gutschein-land')?.value || _settingsCache?.gutschein_land || '';
  return LAND_WAEHRUNG[land] || CURRENCY;
}

/** Vorschlag im Formular und der Satz darunter, wenn die gewählte Währung abweicht. */
function waehrungPruefen() {
  const feld = G('v-currency'), hinweis = el('v-currency-hinweis');
  if (!feld || !hinweis) return;
  const soll = landWaehrung();
  hinweis.hidden = feld.value === soll;
  hinweis.textContent = tRaw('vouchers.waehrung_hinweis', { w: soll });
}

/** @param {import('../../frontend-typen/vertrag').Gutschein} g */
function zeile(g) {
  const k = _klartext.get(g.id);
  const pinOffen = _sichtbar.has(g.id) && !!k;
  // Die Nummer in Vierergruppen: 19 Ziffern am Stück sind beim Abtippen an
  // der Kasse nicht zu lesen, und genau dafür ist sie da. Erst die eigenen
  // Trenner weg, sonst zählen sie mit („6123 -456 7-89“). Kopiert wird
  // trotzdem die ROHE Nummer — mit Leerzeichen nimmt sie kein Bezahlfeld an.
  const nummer = gruppiereNummer(k ? k.number : g.number);
  return `
    <div class="voucher-row" data-id="${g.id}">
      <div class="voucher-main">
        <div class="voucher-num-row">
          <span class="voucher-num">${esc(nummer)}</span>
          <button class="v-btn" data-click="gutscheinKopieren" data-arg="${g.id}" data-arg2="nummer"
                  title="${tRaw('vouchers.copy_number')}"
                  aria-label="${tRaw('vouchers.copy_number')}">${KOPIE_ICON_SVG}<span class="v-btn-text">${t('vouchers.kurz_kopieren')}</span></button>
        </div>
        <div class="voucher-meta">
          <span class="voucher-amount">${fmtN(g.amount, g.currency)}</span>
          ${landWaehrung() && g.currency !== landWaehrung() ? `<span class="voucher-abweichung">${t('vouchers.waehrung_abweichend', { w: landWaehrung() })}</span>` : ''}
          <!-- Der Stand NEBEN dem Betrag, nicht statt ihm: „250 CHF" allein
               ist keine Auskunft, „250 CHF, abgefragt am 15.10." ist eine.
               Und eine Karte, deren Guthaben noch nie abgefragt wurde, sagt
               das — im WORT, nicht durch eine Farbe. -->
          <span class="voucher-stand">${g.guthaben_geprueft_am
            ? t('vouchers.balance_as_of',
                { datum: fmtDatum(g.guthaben_geprueft_am) })
            : t('vouchers.balance_never')}${g.hat_pdf ? '' : ` · <span class="voucher-nopdf">${t('vouchers.no_pdf_kurz')}</span>`}</span>
        </div>
      </div>
      <div class="voucher-pin">
        <span class="voucher-pin-label">${t('vouchers.pin')}</span>
        <code>${g.pin ? (pinOffen ? esc(k.pin) : '••••') : '–'}</code>
        ${g.pin ? `<button class="v-btn" data-click="gutscheinPinUmschalten" data-arg="${g.id}"
                     title="${tRaw(pinOffen ? 'vouchers.pin_hide' : 'vouchers.pin_show')}"
                     aria-label="${tRaw(pinOffen ? 'vouchers.pin_hide' : 'vouchers.pin_show')}">
                     ${ico(pinOffen ? 'auge-zu' : 'auge')}<span class="v-btn-text">${t(pinOffen ? 'vouchers.kurz_verbergen' : 'vouchers.kurz_anzeigen')}</span></button>
                   <button class="v-btn" data-click="gutscheinKopieren" data-arg="${g.id}" data-arg2="pin"
                     title="${tRaw('vouchers.copy_pin')}"
                     aria-label="${tRaw('vouchers.copy_pin')}">${KOPIE_ICON_SVG}<span class="v-btn-text">${t('vouchers.kurz_kopieren')}</span></button>` : ''}
      </div>
      <div class="voucher-actions">
        <button class="btn bs btn-sm v-text" type="button" data-click="gutscheinBearbeiten" data-arg="${g.id}"
                aria-label="${t('common.edit')}: ${esc(nummer)}">${ico('bearbeiten')}<span>${t('common.edit')}</span></button>
        <details class="mehr-menue v-mehr">
          <summary class="btn bs btn-sm v-text" aria-label="${t('vouchers.mehr')}: ${esc(nummer)}">${ico('menue')}<span>${t('vouchers.mehr')}</span></summary>
          <div class="mehr-liste">
            ${g.pin ? `<button class="btn bs btn-sm v-text" type="button" data-click="guthabenAbfragen" data-arg="${g.id}">${ico('aktualisieren')}<span>${t('vouchers.balance_one')}</span></button>` : ''}
            ${g.hat_pdf ? `<button class="btn bs btn-sm v-text" type="button" data-click="gutscheinPdfOeffnen" data-arg="${g.id}">${ico('datei')}<span>${t('vouchers.pdf_open')}</span></button>` : ''}
            <button class="btn bs btn-sm v-text v-btn-gefahr" type="button" data-click="gutscheinLoeschen"${echt()} data-arg="${g.id}"
                    aria-label="${t('common.delete')}: ${esc(nummer)}">${ico('loeschen')}<span>${t('common.delete')}</span></button>
          </div>
        </details>
      </div>
    </div>`;
}

/** Die Liste laden und zeichnen. */
export async function ladeGutscheine() {
  const liste = el('vouchers-list');
  if (!liste) return;
  const d = await api('GET', '/v1/vouchers');
  if (!d?.success) { liste.innerHTML = `<div class="voucher-leer">${t('vouchers.load_error')}</div>`; return; }
  _gutscheine = d.vouchers || [];
  const landFeld = G('gutschein-land');
  if (landFeld) landFeld.value = _settingsCache?.gutschein_land || LAND_ZUR_WAEHRUNG[CURRENCY] || 'de-CH';
  zeigeLandWaehrung();
  const cur = G('v-currency');
  if (cur && !_bearbeitet && !G('v-amount')?.value) cur.value = landWaehrung();
  waehrungPruefen();
  liste.innerHTML = _gutscheine.length
    ? _gutscheine.map(zeile).join('')
    : `<div class="voucher-leer" data-i18n="vouchers.empty">${t('vouchers.empty')}</div>`;
  // Summe, „alle abfragen“ und Export haben ohne Gutscheine nichts zu tun.
  document.querySelectorAll('[data-nur-mit-gutscheinen]').forEach(e => { /** @type {HTMLElement} */ (e).hidden = !_gutscheine.length; });

  // Die Summe. Nur wenn alle dieselbe Währung haben — sonst stünde dort eine
  // Zahl, die nichts bedeutet. Gemischte Währungen zusammenzuzählen wäre
  // schlimmer als gar keine Summe, weil es richtig aussieht.
  const summeEl = el('vouchers-total');
  if (summeEl) {
    const waehrungen = new Set(_gutscheine.map(g => g.currency));
    summeEl.textContent = (_gutscheine.length && waehrungen.size === 1)
      ? fmtN(_gutscheine.reduce((s, g) => s + g.amount, 0), [...waehrungen][0])
      : '';
  }
}

function formularLeeren() {
  _bearbeitet = null;
  const cur = G('v-currency'); if (cur) cur.value = landWaehrung();
  waehrungPruefen();
  for (const id of ['v-number', 'v-pin', 'v-amount']) { const e = el(id); if (e) e.value = ''; }
  const datei = el('v-pdf'); if (datei) { datei.value = ''; gutscheinDateiGewaehlt.call(datei); }
  const titel = el('vouchers-form-title');
  if (titel) titel.textContent = tRaw('vouchers.add');
  const abbrechen = el('v-cancel');
  if (abbrechen) abbrechen.style.display = 'none';
}

/** @param {string} id */
export function gutscheinBearbeiten(id) {
  const g = _gutscheine.find(x => String(x.id) === String(id));
  if (!g) return;
  _bearbeitet = g.id;
  // Ohne Abruf trägt das Formular die Maske; der Server lässt sie als „unverändert“ stehen.
  const k = _klartext.get(g.id);
  el('v-number').value = k ? k.number : g.number;
  el('v-pin').value    = (k ? k.pin : g.pin) || '';
  el('v-amount').value = betragFuerFeld(g.amount);
  const cur = el('v-currency'); if (cur) cur.value = g.currency;
  el('vouchers-form-title').textContent = tRaw('vouchers.edit');
  el('v-cancel').style.display = '';
  // Die Datei bleibt, wie sie ist: Ein Gutschein bekommt sein PDF beim
  // Anlegen. Es nachträglich auszutauschen wäre ein eigener Vorgang und
  // beantwortet keine Frage, die jemand hat.
  const pdfZeile = el('v-pdf').parentElement;
  if (pdfZeile) pdfZeile.style.display = 'none';
  el('v-number').focus();
}

export function gutscheinAbbrechen() {
  formularLeeren();
  const pdfZeile = el('v-pdf').parentElement;
  if (pdfZeile) pdfZeile.style.display = '';
}

/** Fehlercodes des Servers → Feld im Formular (Meldung am Feld statt Toast). */
const GUTSCHEIN_FELDER = { nummer_ungueltig: 'v-number', gutschein_existiert: 'v-number',
  pin_ungueltig: 'v-pin', betrag_ungueltig: 'v-amount', waehrung_ungueltig: 'v-currency' };

/**
 * Speichern, ein Knopf für beide Wege: Liegt eine Datei im Feld, liest der Server sie, und ausgefüllte
 * Felder gewinnen. So kann man ein PDF hochladen und den Betrag selbst ergänzen, wenn es ihn nicht
 * hergibt.
 * Ausführlich: docs/begruendungen/public/js/17-gutscheine.js.md#speichern-der-eine-knopf-fuer-beide-wege
 */
export async function gutscheinSpeichern() {
  const number   = el('v-number').value.trim();
  const pin      = el('v-pin').value.trim();
  const betrag   = betragAusFeld('v-amount');
  if (!betrag.ok) return;
  const amount   = betrag.wert ?? '';
  const currency = el('v-currency')?.value || 'CHF';
  const datei    = el('v-pdf')?.files?.[0] || null;

  if (_bearbeitet) {
    const d = await api('PUT', `/v1/vouchers/${_bearbeitet}`, { number, pin, amount, currency });
    if (!d?.success) { antwortFehler(d, GUTSCHEIN_FELDER, tRaw('vouchers.save_error')); return; }
    _klartext.delete(_bearbeitet);
    toast(tRaw('vouchers.saved'), 'success');
    formularLeeren(); const pdfZeile = el('v-pdf').parentElement; if (pdfZeile) pdfZeile.style.display = '';
    await ladeGutscheine();
    return;
  }

  if (datei) {
    // FormData statt api(): Der Helfer schickt JSON. Eine Datei geht nur als
    // multipart, und `Content-Type` setzt der Browser dabei selbst (samt
    // boundary) — ihn hier zu setzen, zerbricht die Anfrage.
    const form = new FormData();
    form.append('file', datei);
    // Nur ausgefüllte Felder mitschicken: Ein leeres Feld würde das aus dem
    // PDF Gelesene überschreiben — mit nichts.
    if (number)   form.append('number', number);
    if (pin)      form.append('pin', pin);
    if (amount !== '') form.append('amount', String(amount));
    if (currency) form.append('currency', currency);
    let r, d;
    try {
      r = await apiRoh('POST', '/v1/vouchers/pdf', { body: form });
      d = await r.json();
    } catch { toast(tRaw('vouchers.save_error'), 'error'); return; }

    if (r.status === 422) {
      // Das PDF gab nicht genug her. Was gelesen WURDE, wird eingetragen —
      // der Nutzer ergänzt den Rest und drückt noch einmal, mit derselben
      // Datei. Das ist der Unterschied zwischen „hat nicht geklappt" und
      // „hier fehlt noch der Betrag".
      const g = d?.gelesen || {};
      if (g.number && !number)     el('v-number').value = g.number;
      if (g.pin && !pin)           el('v-pin').value = g.pin;
      if (g.amount != null && amount === '') el('v-amount').value = betragFuerFeld(g.amount);
      if (g.currency && el('v-currency')) el('v-currency').value = g.currency;
      toast(tRaw('vouchers.pdf_incomplete'), 'error');
      return;
    }
    if (!d?.success) { antwortFehler(d, GUTSCHEIN_FELDER, tRaw('vouchers.save_error')); return; }

    // Ob ein PDF einen oder mehrere Gutscheine ergab, entscheidet der Server; `mehrere` sagt es. Dann
    // dieselbe Meldung wie bei CSV-Importen, damit niemand bei drei Gutscheinen „gespeichert“ liest und
    // rät.
    // Ausführlich: docs/begruendungen/public/js/17-gutscheine.js.md#if
    if (d.mehrere) {
      toast(tRaw('import.summary', { added: d.mehrere.added, updated: d.mehrere.updated,
                                     errors: d.mehrere.errors }),
        d.mehrere.errors ? 'info' : 'success');
    } else {
      toast(tRaw('vouchers.saved'), 'success');
    }
    formularLeeren();
    await ladeGutscheine();
    return;
  }

  const d = await api('POST', '/v1/vouchers', { number, pin, amount, currency });
  if (!d?.success) { antwortFehler(d, GUTSCHEIN_FELDER, tRaw('vouchers.save_error')); return; }
  toast(tRaw('vouchers.saved'), 'success');
  formularLeeren();
  await ladeGutscheine();
}

/** @param {string} id */
export async function gutscheinLoeschen(id) {
  const g = _gutscheine.find(x => String(x.id) === String(id));
  if (!g) return;
  const password = await bestaetigeMitPasswort(tRaw('vouchers.delete_title'), tRaw('vouchers.delete_confirm', { nummer: gruppiereNummer(g.number) }), 'loeschen', { knopf: 'confirm.btn.endgueltig_loeschen', art: 'bd' });
  if (password === null) return;
  const d = await mitZweitemFaktor(z => api('DELETE', `/v1/vouchers/${id}`, { password, ...z }));
  if (d === null) return;
  if (!d?.success) { toast(d?.error || tRaw('vouchers.delete_error'), 'error'); return; }
  // Rückgängig legt die Karte neu an: nur mit abgerufenem Klartext und ohne PDF, das verloren ginge.
  const k = _klartext.get(g.id);
  _klartext.delete(g.id);
  toast(tRaw('vouchers.deleted'), 'success', g.hat_pdf || !k ? undefined : { text: tRaw('trash.undo'), bleibt: true, fn: async () => {
    const r = await api('POST', '/v1/vouchers', { number: k.number, pin: k.pin || '', amount: g.amount, currency: g.currency });
    if (!r?.success) { toast(r?.error || tRaw('vouchers.save_error'), 'error'); return; }
    toast(tRaw('trash.restored'), 'success');
    await ladeGutscheine();
  } });
  await ladeGutscheine();
}

/** @param {string} id */
export async function gutscheinPinUmschalten(id) {
  const n = Number(id);
  if (_sichtbar.has(n)) _sichtbar.delete(n);
  else if (await holeKlartext(n)) _sichtbar.add(n);
  else return;
  ladeGutscheine();
}

/**
 * Das PDF im Betrachter der Anleitungen, wie in der Android-App: Er kann anzeigen und herunterladen,
 * zwei eigene Knöpfe dafür wären doppelt.
 * Ausführlich: docs/begruendungen/public/js/17-gutscheine.js.md#gutscheinpdfoeffnen
 */
/** @param {string} id */
export async function gutscheinPdfOeffnen(id) {
  const g = _gutscheine.find(x => String(x.id) === String(id));
  const f = await pdfFreigabe(`/v1/vouchers/${id}/pdf-freigabe`);
  if (!f) return;
  const r = await apiRoh('GET', `/v1/vouchers/${id}/pdf?ticket=${encodeURIComponent(f.ticket)}`, { signal: f.frist });
  if (!r.ok) { toast((await r.json().catch(() => ({}))).error || tRaw('settings.error'), 'error'); return; }
  const daten = await r.arrayBuffer();
  openPdfViewer(URL.createObjectURL(new Blob([daten], { type: 'application/pdf' })), g ? g.number : 'PDF',
    { daten, dateiname: `gutschein-${id}.pdf` });
}

/**
 * Bestätigung, dann ein Ticket für genau einen Abruf des PDFs (60 s).
 * @param {string} pfad
 */
async function pdfFreigabe(pfad) {
  const password = await bestaetigeMitPasswort(tRaw('vouchers.pdf_freigabe_title'), tRaw('vouchers.pdf_freigabe_text'), 'schloss', { knopf: 'confirm.btn.pdf_oeffnen', art: 'bp' });
  if (password === null) return null;
  const d = await mitZweitemFaktor(z => api('POST', pfad, { password, ...z }));
  if (!d?.success) { if (d) toast(d.error || tRaw('settings.error'), 'error'); return null; }
  // Nach der Frist gilt das Ticket nicht mehr; ein hängender Abruf bricht dann ab.
  return { ticket: d.ticket, frist: AbortSignal.timeout(d.gueltig_sek * 1000) };
}

/**
 * Nummer oder PIN kopieren, roh statt gruppiert: Die Leerzeichen sind eine Lesehilfe an der Kasse, ein
 * Bezahlfeld nimmt sie nicht an. navigator.clipboard braucht HTTPS, daher der Rückfall.
 * Ausführlich: docs/begruendungen/public/js/17-gutscheine.js.md#gutscheinkopieren
 */
/** @param {string} id @param {string} feld */
export async function gutscheinKopieren(id, feld) {
  const g = _gutscheine.find(x => String(x.id) === String(id));
  if (!g) return;
  const k = await holeKlartext(g.id);
  if (!k) return;
  const wert = feld === 'pin' ? (k.pin || '') : String(k.number);
  if (!wert) return;
  let geklappt = false;
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(wert); geklappt = true; }
  } catch { geklappt = false; }
  if (!geklappt) {
    try {
      const feldchen = document.createElement('textarea');
      feldchen.value = wert;
      // Ausserhalb des Bildes statt `display:none`: Ein verstecktes Element
      // lässt sich nicht markieren, und ohne Markierung kopiert execCommand
      // nichts.
      feldchen.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(feldchen);
      feldchen.select();
      geklappt = document.execCommand('copy');
      feldchen.remove();
    } catch { geklappt = false; }
  }
  toast(tRaw(geklappt
    ? (feld === 'pin' ? 'vouchers.copied_pin' : 'vouchers.copied_number')
    : 'vouchers.copy_error'), geklappt ? 'success' : 'error');
}

/**
 * Alle Gutscheine als ein PDF, per fetch statt Link: Die Kopfzeile X-Gutschein-Befunde sagt, wo der
 * Betrag nicht ersetzt werden konnte — ein <a href> würfe genau diese Auskunft weg.
 * Ausführlich: docs/begruendungen/public/js/17-gutscheine.js.md#gutscheineexportieren
 */
async function gutscheineExportieren() {
  const f = await pdfFreigabe('/v1/vouchers/export/pdf-freigabe');
  if (!f) return;
  toast(tRaw('vouchers.export_running'), 'info');
  try {
    const r = await apiRoh('GET', `/v1/vouchers/export/pdf?ticket=${encodeURIComponent(f.ticket)}`, { signal: f.frist });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      toast(d.error || tRaw('settings.error'), 'error');
      return;
    }
    const blob = await r.blob();
    /** @type {{ art?: string, grund?: string, number?: string }[]} */
    let befunde = [];
    try {
      const kopf = r.headers.get('X-Gutschein-Befunde');
      if (kopf) befunde = JSON.parse(atob(kopf));
    } catch { /* ohne Befunde ist das PDF trotzdem gut */ }

    // Herunterladen über ein kurzlebiges Objekt-URL: Der Name kommt aus dem
    // Content-Disposition, falls er lesbar ist, sonst aus dem Datum.
    const name = (r.headers.get('Content-Disposition') || '')
      .match(/filename="([^"]+)"/)?.[1]
      || `brickinventory-gutscheine-${new Date().toISOString().slice(0, 10)}.pdf`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);

    // Die Befunde: 'unveraendert' heisst jetzt genau eines — es hätte
    // ersetzt werden sollen und ging nicht. „Stimmte schon" ist eine eigene
    // Art und kein offener Punkt mehr.
    const offen = befunde.filter(b => b.art === 'unveraendert' && b.grund);
    if (!offen.length) {
      toast(tRaw('vouchers.export_done', { n: befunde.length }), 'success');
    } else {
      // tRaw statt t(), weil ein Toast reiner Text ist: t() maskiert, und aus 9'325 würde sichtbar
      // „9&#39;325“. Die Nummern stehen in der Meldung, damit man weiss, welche Karte auf Papier den alten
      // Betrag trägt.
      // Ausführlich: docs/begruendungen/public/js/17-gutscheine.js.md#toast
      toast(tRaw('vouchers.export_done', { n: befunde.length }) + ' — '
          + tRaw('vouchers.export_offen', { n: offen.length }) + ': '
          + offen.map(b => b.number).join(', '), 'info');
    }
  } catch (e) {
    toast(tRaw('settings.error'), 'error');
  }
}

// Guthaben bei LEGO auf Knopfdruck abfragen. Die Grenze (eine Anfrage je 30 s über alle Benutzer)
// setzt der Server; die Oberfläche befolgt sie: Bei 429 wartet sie wartenSek ab und fragt dieselbe
// Karte erneut. Eine Sammelroute hielte dafür Minuten eine Verbindung offen.
// Ausführlich: docs/begruendungen/public/js/17-gutscheine.js.md#kannst-du-dies-bei-den-gutscheinen-einba

/** Höchstens so oft dieselbe Karte erneut versuchen, wenn die Schranke bremst. */
const ABSTAND_VERSUCHE = 4;

const _warte = (/** @type {number} */ ms) => new Promise(r => setTimeout(r, ms));

/**
 * Sekunden abwarten und dabei herunterzählen.
 *
 * Der Text nennt die Karte: Bei „alle abfragen" ist sonst nicht zu sehen,
 * wofür gewartet wird.
 */
/** @param {number} sekunden @param {string} nummer */
async function warteSichtbar(sekunden, nummer) {
  const status = G('vouchers-balance-status');
  for (let rest = sekunden; rest > 0; rest--) {
    if (status) status.textContent = tRaw('vouchers.balance_wait', { sek: rest, nummer });
    await _warte(1000);
  }
}

/**
 * Eine Karte abfragen — ohne Takten, ohne Neuladen.
 *
 * Gibt zurück, was der Aufrufer wissen muss: ob es geklappt hat, und wenn
 * nicht, ob es am Abstand lag (dann lohnt Warten) oder am Bot-Schutz (dann
 * wird AUFGEHÖRT — weiterzufragen ist genau das, was nicht sein soll).
 * @param {number | string} id
 * @returns {Promise<{ art: 'ok', antwort: import('../../frontend-typen/vertrag').GuthabenAntwort } | { art: 'abstand', wartenSek: number } | { art: 'botschutz' | 'fehler', fehler: string }>}
 */
async function eineAbfrage(id) {
  const d = await api('POST', `/v1/vouchers/${id}/guthaben`);
  if (d?.success) return { art: 'ok', antwort: d };
  if (d?.grund === 'abstand' && Number(d.wartenSek) > 0) {
    return { art: 'abstand', wartenSek: Number(d.wartenSek) };
  }
  if (d?.grund === 'botschutz' || d?.grund === 'konto') {
    return { art: 'botschutz', fehler: d.error || tRaw('settings.error') };
  }
  return { art: 'fehler', fehler: d?.error || tRaw('settings.error') };
}

/** Was eine erfolgreiche Abfrage dem Nutzer sagt. */
/** @param {import('../../frontend-typen/vertrag').GuthabenAntwort} antwort */
function meldeErfolg(antwort) {
  const v = antwort.voucher;
  if (!v) return;
  toast(tRaw('vouchers.balance_done', {
    nummer: v.number,
    betrag: antwort.angezeigt || fmtN(v.amount, v.currency),
  }), 'success');
  // Eine stillschweigend geänderte Währung wäre eine geänderte Summe ohne
  // Hinweis — die Liste rechnet nur, wenn alle Gutscheine dieselbe tragen.
  if (antwort.waehrung_geaendert) {
    toast(tRaw('vouchers.balance_currency', { waehrung: v.currency }), 'info');
  }
}

/** Eine Karte, auf Knopfdruck in ihrer Zeile. */
/** @param {string} id */
export async function guthabenAbfragen(id) {
  const status = G('vouchers-balance-status');
  const g = _gutscheine.find(x => String(x.id) === String(id));
  if (status) status.textContent = tRaw('vouchers.balance_running');
  for (let versuch = 1; ; versuch++) {
    const r = await eineAbfrage(id);
    if (r.art === 'ok') {
      if (status) status.textContent = '';
      meldeErfolg(r.antwort);
      await ladeGutscheine();
      return;
    }
    if (r.art === 'abstand' && versuch < ABSTAND_VERSUCHE) {
      await warteSichtbar(r.wartenSek, g ? g.number : '');
      continue;
    }
    if (status) status.textContent = '';
    // Auch der Abstand wird hier zur Fehlermeldung: Nach vier Versuchen ist
    // die Auskunft „es ist belegt" ehrlicher als weiteres Warten.
    toast(('fehler' in r && r.fehler) || tRaw('settings.error'), 'error');
    return;
  }
}

/** Alle Karten mit PIN, eine nach der anderen. */
export async function guthabenAlleAbfragen() {
  const status = G('vouchers-balance-status');
  const dran = _gutscheine.filter(g => g.pin);
  if (!dran.length) {
    toast(tRaw('vouchers.balance_keine'), 'info');
    return;
  }
  let fertig = 0, fehler = 0;
  for (const g of dran) {
    let erledigt = false;
    for (let versuch = 1; !erledigt && versuch <= ABSTAND_VERSUCHE; versuch++) {
      if (status) {
        status.textContent = tRaw('vouchers.balance_progress',
          { n: fertig + fehler + 1, total: dran.length, nummer: g.number });
      }
      const r = await eineAbfrage(g.id);
      if (r.art === 'ok') { fertig++; meldeErfolg(r.antwort); erledigt = true; break; }
      if (r.art === 'abstand') { await warteSichtbar(r.wartenSek, g.number); continue; }
      fehler++;
      toast(r.fehler, 'error');
      erledigt = true;
      // Bot-Schutz: HIER wird abgebrochen, nicht nur diese Karte übersprungen.
      // Die übrigen Karten liefen in dieselbe Wand, und Marcos Vorgabe ist,
      // dass dann „nicht mehr Aufrufe generiert werden".
      if (r.art === 'botschutz') {
        if (status) status.textContent = '';
        await ladeGutscheine();
        return;
      }
    }
    if (!erledigt) { fehler++; toast(tRaw('vouchers.balance_belegt'), 'error'); }
  }
  if (status) status.textContent = '';
  toast(tRaw('vouchers.balance_alle_fertig', { fertig, fehler }),
    fehler ? 'info' : 'success');
  await ladeGutscheine();
}

/**
 * Das Ausgabeland speichern — eine globale Einstellung.
 *
 * Eigener Weg und nicht der große Speichern-Knopf der Einstellungsseite: Das
 * Feld steht in der Gutschein-Rubrik, und wer dort etwas wählt, erwartet, dass
 * es gilt. Der Server nimmt den Wert nur von einem Verwalter an — deshalb ist
 * das Feld für alle anderen gar nicht sichtbar (`admin-only` in index.html).
 */
export async function gutscheinLandSpeichern() {
  const feld = el('gutschein-land');
  if (!feld) return;
  const d = await api('POST', '/v1/settings', { gutschein_land: feld.value });
  if (d?.success && _settingsCache) _settingsCache.gutschein_land = G('gutschein-land')?.value;
  if (!_bearbeitet) { const cur = G('v-currency'); if (cur) cur.value = landWaehrung(); }
  waehrungPruefen();
  zeigeLandWaehrung();
  await ladeGutscheine();
  toast(d?.success ? tRaw('settings.saved') : (d?.error || tRaw('settings.error')),
    d?.success ? 'success' : 'error');
}

/** Der Name der gewählten Datei neben dem Knopf — das native Feld zeigte ihn selbst. @this {HTMLInputElement | undefined} */
function gutscheinDateiGewaehlt() {
  const name = el('v-pdf-name');
  if (!name) return;
  const datei = this?.files?.[0];
  name.textContent = datei ? datei.name : tRaw('vouchers.pdf_none');
}

/** Unter dem Ausgabeland: in welcher Währung dessen Karten lauten. */
function zeigeLandWaehrung() {
  const z = el('gutschein-land-waehrung');
  if (z) z.textContent = tRaw('vouchers.land_waehrung', { w: landWaehrung() });
}

registerActions({
  waehrungPruefen,
  gutscheinDateiGewaehlt,
  gutscheineExportieren,
  ladeGutscheine,
  gutscheinSpeichern,
  gutscheinBearbeiten,
  gutscheinAbbrechen,
  gutscheinLoeschen,
  gutscheinPinUmschalten,
  gutscheinPdfOeffnen,
  gutscheinKopieren,
  guthabenAbfragen,
  guthabenAlleAbfragen,
  gutscheinLandSpeichern,
});

// „Mehr“ klappt zu, sobald daneben getippt, darin gewählt oder Escape gedrückt wird.
if (typeof document !== 'undefined') {
  document.addEventListener('click', (ev) => {
    const ziel = ev.target instanceof Element ? ev.target : null;
    for (const d of document.querySelectorAll('details.v-mehr[open]'))
      if (!d.contains(ziel) || ziel?.closest('.mehr-liste button')) /** @type {HTMLDetailsElement} */ (d).open = false;
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    for (const d of document.querySelectorAll('details.v-mehr[open]')) {
      /** @type {HTMLDetailsElement} */ (d).open = false;
      if (d.contains(document.activeElement)) /** @type {HTMLElement|null} */ (d.querySelector('summary'))?.focus();
    }
  });
}
