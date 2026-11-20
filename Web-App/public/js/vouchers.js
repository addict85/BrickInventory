import { echt, registerActions } from './registry.js';
import { tRaw } from '../i18n.js';
import { api, apiRaw } from './api.js';
import { ico, G, setzeHtml } from './dom.js';
import { fmtDatum, fmtN, amountForField } from './format.js';
import { responseError, amountFromField, feldFehler } from './form.js';
import { toast } from './messages.js';
import { openPdfViewer } from './pdfviewer.js';
import { accountCurrency, settingsSnapshot } from './state.js';
import { html, joinHtml } from './escaping.js';
import { bestaetigeMitPasswort, withSecondFactor } from './confirm-prompt.js';

// Vouchers (LEGO gift cards) stand directly in the profile instead of in a tab of their own: they should be quickly
// reachable and, as in the app, be captured, changed and shown.

/** The most recently loaded list — for the buttons that point to a row. */
/** @type {import('../../frontend-types/contract').Gutschein[]} */
let _vouchers = [];
/** The most recently loaded vouchers, for reading by the balance lookup. */
export const gutscheine = () => _vouchers;

/** The id of the voucher currently being edited; null = new entry. */
/** @type {number | string | null} */
let _edited = null;

/** @param {string} id */
const el = (/** @type {string} */ id) => /** @type {Feld} */ (document.getElementById(id));

// The handlers take the id as the FIRST argument and no event: the dispatcher in actions.js passes
// `data-arg`, `data-arg2` … through in this order and appends the event LAST. An `(ev, id)`
// would therefore be silently swapped — the id would land in `ev`.

/** Revealed PINs: even after fetching only on request, against the shoulder next to you. */
const _visible = new Set();

/** Number and PIN in plaintext per id: the server's list only carries the mask,
 * the plaintext is given confirmed and logged, once per voucher and page. */
const _plaintext = new Map();

/**
 * @param {number} id
 */
async function fetchPlaintext(id) {
  if (_plaintext.has(id)) return _plaintext.get(id);
  const password = await bestaetigeMitPasswort(
    tRaw('vouchers.klartext_title'),
    tRaw('vouchers.klartext_text'),
    'schloss',
    { knopf: 'confirm.btn.anzeigen', art: 'bp' },
  );
  if (password === null) return null;
  const d = await withSecondFactor(z => api('POST', `/v1/vouchers/${id}/klartext`, { password, ...z }));
  if (!d?.success) {
    if (d) toast(d.error || tRaw('vouchers.load_error'), 'error');
    return null;
  }
  _plaintext.set(id, { number: d.number, pin: d.pin });
  return _plaintext.get(id);
}

/**
 * The copy icon — two sheets, as everywhere else.
 *
 * Inline and not as a font character: an emoji looks different on every system and is missing entirely with some
 * fonts. `currentColor` lets it adopt the button's color, i.e. also in dark mode.
 */
const COPY_ICON_SVG = html`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13"
  height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

/** "6123-4567-8901" and "612345678901" → "6123 4567 8901". */
/** @param {unknown} roh */
export function groupNumber(roh) {
  return String(roh ?? '')
    .replace(/[\s-]/g, '')
    .replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** The currency of the issuing country's cards; without a country that of the account. */
/** @type {Record<string, string>} */
const LAND_CURRENCY = {
  'de-CH': 'CHF',
  'de-DE': 'EUR',
  'de-AT': 'EUR',
  'fr-FR': 'EUR',
  'it-IT': 'EUR',
  'nl-NL': 'EUR',
  'en-GB': 'GBP',
  'en-US': 'USD',
};
/** Without a stored issuing country, the country of the account currency (like landFuerWaehrung in the server). */
/** @type {Record<string, string>} */
export const LAND_TO_CURRENCY = { CHF: 'de-CH', EUR: 'de-DE', GBP: 'en-GB', USD: 'en-US' };
export function landCurrency() {
  const land = G('gutschein-land')?.value || settingsSnapshot?.gutschein_land || '';
  return LAND_CURRENCY[land] || accountCurrency;
}

/** Suggestion in the form and the sentence below it if the chosen currency differs. */
function waehrungPruefen() {
  const feld = G('v-currency'),
    hinweis = el('v-currency-hinweis');
  if (!feld || !hinweis) return;
  const soll = landCurrency();
  hinweis.hidden = feld.value === soll;
  hinweis.textContent = tRaw('vouchers.waehrung_hinweis', { w: soll });
}

/** @param {import('../../frontend-types/contract').Gutschein} g */
function zeile(g) {
  const k = _plaintext.get(g.id);
  const openPin = _visible.has(g.id) && !!k;
  // The number in groups of four: 19 digits in one go cannot be read when typing them at the checkout, and
  // that is exactly what it is for. First remove the own separators, otherwise they count ("6123 -456 7-89"). Still the
  // RAW number is copied — with spaces no payment field accepts it.
  const nummer = groupNumber(k ? k.number : g.number);
  return html`
    <div class="voucher-row" data-id="${g.id}">
      <div class="voucher-main">
        <div class="voucher-num-row">
          <span class="voucher-num">${nummer}</span>
          <button class="v-btn" data-click="gutscheinKopieren" data-arg="${g.id}" data-arg2="nummer"
                  title="${tRaw('vouchers.copy_number')}"
                  aria-label="${tRaw('vouchers.copy_number')}">${COPY_ICON_SVG}<span class="v-btn-text">${tRaw('vouchers.kurz_kopieren')}</span></button>
        </div>
        <div class="voucher-meta">
          <span class="voucher-amount">${fmtN(g.amount, g.currency)}</span>
          ${landCurrency() && g.currency !== landCurrency() ? html`<span class="voucher-abweichung">${tRaw('vouchers.waehrung_abweichend', { w: landCurrency() })}</span>` : ''}
          <!-- Der Stand NEBEN dem Betrag, nicht statt ihm: „250 CHF" allein
               ist keine Auskunft, „250 CHF, abgefragt am 15.10." ist eine.
               Und eine Karte, deren Guthaben noch nie abgefragt wurde, sagt
               das — im WORT, nicht durch eine Farbe. -->
          <span class="voucher-stand">${g.guthaben_geprueft_am ? tRaw('vouchers.balance_as_of', { datum: fmtDatum(g.guthaben_geprueft_am) }) : tRaw('vouchers.balance_never')}${g.hat_pdf ? '' : html` · <span class="voucher-nopdf">${tRaw('vouchers.no_pdf_kurz')}</span>`}</span>
        </div>
      </div>
      <div class="voucher-pin">
        <span class="voucher-pin-label">${tRaw('vouchers.pin')}</span>
        <code>${g.pin ? (openPin ? k.pin : '••••') : '–'}</code>
        ${
          g.pin
            ? html`<button class="v-btn" data-click="gutscheinPinUmschalten" data-arg="${g.id}"
                     title="${tRaw(openPin ? 'vouchers.pin_hide' : 'vouchers.pin_show')}"
                     aria-label="${tRaw(openPin ? 'vouchers.pin_hide' : 'vouchers.pin_show')}">
                     ${ico(openPin ? 'auge-zu' : 'auge')}<span class="v-btn-text">${tRaw(openPin ? 'vouchers.kurz_verbergen' : 'vouchers.kurz_anzeigen')}</span></button>
                   <button class="v-btn" data-click="gutscheinKopieren" data-arg="${g.id}" data-arg2="pin"
                     title="${tRaw('vouchers.copy_pin')}"
                     aria-label="${tRaw('vouchers.copy_pin')}">${COPY_ICON_SVG}<span class="v-btn-text">${tRaw('vouchers.kurz_kopieren')}</span></button>`
            : ''
        }
      </div>
      <div class="voucher-actions">
        <button class="btn bs btn-sm v-text" type="button" data-click="gutscheinBearbeiten" data-arg="${g.id}"
                aria-label="${tRaw('common.edit')}: ${nummer}">${ico('bearbeiten')}<span>${tRaw('common.edit')}</span></button>
        <details class="mehr-menue v-mehr">
          <summary class="btn bs btn-sm v-text" aria-label="${tRaw('vouchers.mehr')}: ${nummer}">${ico('menue')}<span>${tRaw('vouchers.mehr')}</span></summary>
          <div class="mehr-liste">
            ${g.pin ? html`<button class="btn bs btn-sm v-text" type="button" data-click="guthabenAbfragen" data-arg="${g.id}">${ico('aktualisieren')}<span>${tRaw('vouchers.balance_one')}</span></button>` : ''}
            ${g.hat_pdf ? html`<button class="btn bs btn-sm v-text" type="button" data-click="gutscheinPdfOeffnen" data-arg="${g.id}">${ico('datei')}<span>${tRaw('vouchers.pdf_open')}</span></button>` : ''}
            <button class="btn bs btn-sm v-text v-btn-gefahr" type="button" data-click="gutscheinLoeschen"${echt()} data-arg="${g.id}"
                    aria-label="${tRaw('common.delete')}: ${nummer}">${ico('loeschen')}<span>${tRaw('common.delete')}</span></button>
          </div>
        </details>
      </div>
    </div>`;
}

/** Load and draw the list. */
export async function ladeGutscheine() {
  const liste = el('vouchers-list');
  if (!liste) return;
  const d = await api('GET', '/v1/vouchers');
  if (!d?.success) {
    setzeHtml(liste, html`<div class="voucher-leer">${tRaw('vouchers.load_error')}</div>`);
    return;
  }
  _vouchers = d.vouchers || [];
  const landField = G('gutschein-land');
  if (landField) landField.value = settingsSnapshot?.gutschein_land || LAND_TO_CURRENCY[accountCurrency] || 'de-CH';
  showLandCurrency();
  const cur = G('v-currency');
  if (cur && !_edited && !G('v-amount')?.value) cur.value = landCurrency();
  waehrungPruefen();
  setzeHtml(
    liste,
    _vouchers.length
      ? joinHtml(_vouchers.map(zeile))
      : html`<div class="voucher-leer" data-i18n="vouchers.empty">${tRaw('vouchers.empty')}</div>`,
  );
  // Sum, "query all" and export have nothing to do without vouchers.
  document.querySelectorAll('[data-nur-mit-gutscheinen]').forEach(e => {
    /** @type {HTMLElement} */ (e).hidden = !_vouchers.length;
  });

  // The sum per currency: adding up mixed ones would look right and be wrong; with no value at all only
  // the label "sum" stood there.
  const sumEl = el('vouchers-total');
  if (sumEl) {
    /** @type {Map<string, number>} */
    const je = new Map();
    for (const g of _vouchers) je.set(g.currency, (je.get(g.currency) || 0) + g.amount);
    sumEl.textContent = [...je].map(([w, betrag]) => fmtN(betrag, w)).join(' · ');
  }
}

function clearForm() {
  _edited = null;
  const cur = G('v-currency');
  if (cur) cur.value = landCurrency();
  waehrungPruefen();
  for (const id of ['v-number', 'v-pin', 'v-amount']) {
    const e = el(id);
    if (e) e.value = '';
  }
  const datei = el('v-pdf');
  if (datei) {
    datei.value = '';
    gutscheinDateiGewaehlt.call(datei);
  }
  const titel = el('vouchers-form-title');
  if (titel) titel.textContent = tRaw('vouchers.add');
  const abbrechen = el('v-cancel');
  if (abbrechen) abbrechen.style.display = 'none';
}

/** @param {string} id */
export function gutscheinBearbeiten(id) {
  const g = _vouchers.find(x => String(x.id) === String(id));
  if (!g) return;
  _edited = g.id;
  // Without a fetch the form carries the mask; the server leaves it standing as "unchanged".
  const k = _plaintext.get(g.id);
  el('v-number').value = k ? k.number : g.number;
  el('v-pin').value = (k ? k.pin : g.pin) || '';
  el('v-amount').value = amountForField(g.amount);
  const cur = el('v-currency');
  if (cur) cur.value = g.currency;
  el('vouchers-form-title').textContent = tRaw('vouchers.edit');
  el('v-cancel').style.display = '';
  // The file stays as it is: a voucher gets its PDF when created. Replacing it afterwards
  // would be a process of its own and answers no question anyone has.
  const pdfRow = el('v-pdf').parentElement;
  if (pdfRow) pdfRow.style.display = 'none';
  el('v-number').focus();
}

export function gutscheinAbbrechen() {
  clearForm();
  const pdfRow = el('v-pdf').parentElement;
  if (pdfRow) pdfRow.style.display = '';
}

/** Server error codes → field in the form (message at the field instead of a toast). */
const VOUCHER_FIELDS = {
  nummer_ungueltig: 'v-number',
  gutschein_existiert: 'v-number',
  pin_ungueltig: 'v-pin',
  betrag_ungueltig: 'v-amount',
  waehrung_ungueltig: 'v-currency',
};

/**
 * Save, one button for both paths: if a file is in the field, the server reads it, and filled-in fields
 * win. That way one can upload a PDF and add the amount oneself if it does not yield it.
 */
export async function gutscheinSpeichern() {
  const number = el('v-number').value.trim();
  const pin = el('v-pin').value.trim();
  const betrag = amountFromField('v-amount', 'common.betrag_negativ');
  const datei = el('v-pdf')?.files?.[0] || null;
  // All gaps at once: the server reported them one after the other. A PDF can deliver number and amount.
  const leer = datei ? [] : [!number && 'v-number', betrag.ok && betrag.wert === null && 'v-amount'];
  const fehlt = /** @type {string[]} */ (leer.filter(Boolean));
  for (const id of fehlt) feldFehler(id, tRaw('vouchers.pflicht_fehlt'));
  if (!betrag.ok || fehlt.length) {
    el(fehlt[0] ?? 'v-amount')?.focus();
    return;
  }
  const amount = betrag.wert ?? '';
  const currency = el('v-currency')?.value || 'CHF';

  if (_edited) {
    const d = await api('PUT', `/v1/vouchers/${_edited}`, { number, pin, amount, currency });
    if (!d?.success) {
      responseError(d, VOUCHER_FIELDS, tRaw('vouchers.save_error'));
      return;
    }
    _plaintext.delete(_edited);
    toast(tRaw('vouchers.saved'), 'success');
    clearForm();
    const pdfRow = el('v-pdf').parentElement;
    if (pdfRow) pdfRow.style.display = '';
    await ladeGutscheine();
    return;
  }

  if (datei) {
    // FormData instead of api(): the helper sends JSON. A file only goes as multipart, and the browser sets `Content-Type`
    // itself in the process (including boundary) — setting it here breaks the request.
    const form = new FormData();
    form.append('file', datei);
    // Only send filled-in fields: an empty field would overwrite what was read from the PDF — with
    // nichts.
    if (number) form.append('number', number);
    if (pin) form.append('pin', pin);
    if (amount !== '') form.append('amount', String(amount));
    if (currency) form.append('currency', currency);
    let r, d;
    try {
      r = await apiRaw('POST', '/v1/vouchers/pdf', { body: form });
      d = await r.json();
    } catch {
      toast(tRaw('vouchers.save_error'), 'error');
      return;
    }

    if (r.status === 422) {
      // The PDF did not yield enough. What WAS read is filled in — the user adds the rest and
      // presses once more, with the same file. That is the difference between "did not work" and
      // "the amount is still missing here".
      const g = d?.gelesen || {};
      if (g.number && !number) el('v-number').value = g.number;
      if (g.pin && !pin) el('v-pin').value = g.pin;
      if (g.amount != null && amount === '') el('v-amount').value = amountForField(g.amount);
      if (g.currency && el('v-currency')) el('v-currency').value = g.currency;
      toast(tRaw('vouchers.pdf_incomplete'), 'error');
      return;
    }
    if (!d?.success) {
      responseError(d, VOUCHER_FIELDS, tRaw('vouchers.save_error'));
      return;
    }

    // Whether a PDF yielded one or several vouchers is decided by the server; `mehrere` says so. Then
    // the same message as for CSV imports, so that nobody reads "saved" for three vouchers and guesses.
    if (d.mehrere) {
      toast(
        tRaw('import.summary', { added: d.mehrere.added, updated: d.mehrere.updated, errors: d.mehrere.errors }),
        d.mehrere.errors ? 'info' : 'success',
      );
    } else {
      toast(tRaw('vouchers.saved'), 'success');
    }
    clearForm();
    await ladeGutscheine();
    return;
  }

  const d = await api('POST', '/v1/vouchers', { number, pin, amount, currency });
  if (!d?.success) {
    responseError(d, VOUCHER_FIELDS, tRaw('vouchers.save_error'));
    return;
  }
  toast(tRaw('vouchers.saved'), 'success');
  clearForm();
  await ladeGutscheine();
}

/** @param {string} id */
export async function gutscheinLoeschen(id) {
  const g = _vouchers.find(x => String(x.id) === String(id));
  if (!g) return;
  const password = await bestaetigeMitPasswort(
    tRaw('vouchers.delete_title'),
    tRaw('vouchers.delete_confirm', { nummer: groupNumber(g.number) }),
    'loeschen',
    { knopf: 'confirm.btn.endgueltig_loeschen', art: 'bd' },
  );
  if (password === null) return;
  const d = await withSecondFactor(z => api('DELETE', `/v1/vouchers/${id}`, { password, ...z }));
  if (d === null) return;
  if (!d?.success) {
    toast(d?.error || tRaw('vouchers.delete_error'), 'error');
    return;
  }
  // Undo creates the card anew: only with fetched plaintext and without a PDF, which would get lost.
  const k = _plaintext.get(g.id);
  _plaintext.delete(g.id);
  toast(
    tRaw('vouchers.deleted'),
    'success',
    g.hat_pdf || !k
      ? undefined
      : {
          text: tRaw('trash.undo'),
          bleibt: true,
          fn: async () => {
            const r = await api('POST', '/v1/vouchers', {
              number: k.number,
              pin: k.pin || '',
              amount: g.amount,
              currency: g.currency,
            });
            if (!r?.success) {
              toast(r?.error || tRaw('vouchers.save_error'), 'error');
              return;
            }
            toast(tRaw('trash.restored'), 'success');
            await ladeGutscheine();
          },
        },
  );
  await ladeGutscheine();
}

/** @param {string} id */
export async function gutscheinPinUmschalten(id) {
  const n = Number(id);
  if (_visible.has(n)) _visible.delete(n);
  else if (await fetchPlaintext(n)) _visible.add(n);
  else return;
  ladeGutscheine();
}

/**
 * The PDF in the instructions' viewer, as in the Android app: it can display and download, two
 * buttons of its own for that would be duplicates.
 */
/** @param {string} id */
export async function gutscheinPdfOeffnen(id) {
  const g = _vouchers.find(x => String(x.id) === String(id));
  const f = await pdfFreigabe(`/v1/vouchers/${id}/pdf-freigabe`);
  if (!f) return;
  const r = await apiRaw('GET', `/v1/vouchers/${id}/pdf?ticket=${encodeURIComponent(f.ticket)}`, { signal: f.frist });
  if (!r.ok) {
    toast((await r.json().catch(() => ({}))).error || tRaw('settings.error'), 'error');
    return;
  }
  const daten = await r.arrayBuffer();
  openPdfViewer(URL.createObjectURL(new Blob([daten], { type: 'application/pdf' })), g ? g.number : 'PDF', {
    daten,
    fileName: `gutschein-${id}.pdf`,
  });
}

/**
 * Confirmation, then a ticket for exactly one fetch of the PDF (60 s).
 * @param {string} pfad
 */
async function pdfFreigabe(pfad) {
  const password = await bestaetigeMitPasswort(
    tRaw('vouchers.pdf_freigabe_title'),
    tRaw('vouchers.pdf_freigabe_text'),
    'schloss',
    { knopf: 'confirm.btn.pdf_oeffnen', art: 'bp' },
  );
  if (password === null) return null;
  const d = await withSecondFactor(z => api('POST', pfad, { password, ...z }));
  if (!d?.success) {
    if (d) toast(d.error || tRaw('settings.error'), 'error');
    return null;
  }
  // After the deadline the ticket no longer applies; a hanging fetch then aborts.
  return { ticket: d.ticket, frist: AbortSignal.timeout(d.gueltig_sek * 1000) };
}

/**
 * Copy number or PIN, raw instead of grouped: the spaces are a reading aid at the checkout, a
 * payment field does not accept them. navigator.clipboard needs HTTPS, hence the fallback.
 */
/** @param {string} id @param {string} feld */
export async function gutscheinKopieren(id, feld) {
  const g = _vouchers.find(x => String(x.id) === String(id));
  if (!g) return;
  const k = await fetchPlaintext(g.id);
  if (!k) return;
  const wert = feld === 'pin' ? k.pin || '' : String(k.number);
  if (!wert) return;
  let geklappt = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(wert);
      geklappt = true;
    }
  } catch {
    geklappt = false;
  }
  if (!geklappt) {
    try {
      const feldchen = document.createElement('textarea');
      feldchen.value = wert;
      // Outside the view instead of `display:none`: a hidden element cannot be selected, and
      // without a selection execCommand copies nothing.
      feldchen.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(feldchen);
      feldchen.select();
      geklappt = document.execCommand('copy');
      feldchen.remove();
    } catch {
      geklappt = false;
    }
  }
  toast(
    tRaw(geklappt ? (feld === 'pin' ? 'vouchers.copied_pin' : 'vouchers.copied_number') : 'vouchers.copy_error'),
    geklappt ? 'success' : 'error',
  );
}

/**
 * All vouchers as one PDF, via fetch instead of a link: the header X-Gutschein-Befunde says where the amount
 * could not be replaced — an <a href> would throw away exactly this information.
 */
async function gutscheineExportieren() {
  const f = await pdfFreigabe('/v1/vouchers/export/pdf-freigabe');
  if (!f) return;
  toast(tRaw('vouchers.export_running'), 'info');
  try {
    const r = await apiRaw('GET', `/v1/vouchers/export/pdf?ticket=${encodeURIComponent(f.ticket)}`, {
      signal: f.frist,
    });
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
    } catch {
      /* without findings the PDF is fine anyway */
    }

    // Download via a short-lived object URL: the name comes from the Content-Disposition if it
    // is readable, otherwise from the date.
    const name =
      (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] ||
      `brickinventory-gutscheine-${new Date().toISOString().slice(0, 10)}.pdf`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    // The findings: 'unveraendert' now means exactly one thing — it should have been replaced and could not be.
    // "Was already right" is a kind of its own and no longer an open item.
    const offen = befunde.filter(b => b.art === 'unveraendert' && b.grund);
    if (!offen.length) {
      toast(tRaw('vouchers.export_done', { n: befunde.length }), 'success');
    } else {
      // tRaw instead of t(), because a toast is plain text: t() escapes, and 9'325 would visibly become
      // "9&#39;325". The numbers are in the message, so that one knows which card on paper carries the old
      // amount.
      toast(
        tRaw('vouchers.export_done', { n: befunde.length }) +
          ' — ' +
          tRaw('vouchers.export_offen', { n: offen.length }) +
          ': ' +
          offen.map(b => b.number).join(', '),
        'info',
      );
    }
  } catch {
    toast(tRaw('settings.error'), 'error');
  }
}

/**
 * Save the issuing country — a global setting.
 *
 * A path of its own and not the big save button of the settings page: the field stands in the
 * voucher section, and whoever chooses something there expects it to apply. The server only accepts the value from an
 * admin — that is why the field is not even visible for everyone else (`admin-only` in index.html).
 */
export async function gutscheinLandSpeichern() {
  const feld = el('gutschein-land');
  if (!feld) return;
  const d = await api('POST', '/v1/settings', { gutschein_land: feld.value });
  if (d?.success && settingsSnapshot) settingsSnapshot.gutschein_land = G('gutschein-land')?.value;
  if (!_edited) {
    const cur = G('v-currency');
    if (cur) cur.value = landCurrency();
  }
  waehrungPruefen();
  showLandCurrency();
  await ladeGutscheine();
  toast(d?.success ? tRaw('settings.saved') : d?.error || tRaw('settings.error'), d?.success ? 'success' : 'error');
}

/** The name of the chosen file next to the button — the native field showed it itself. @this {HTMLInputElement | undefined} */
function gutscheinDateiGewaehlt() {
  const name = el('v-pdf-name');
  if (!name) return;
  const datei = this?.files?.[0];
  name.textContent = datei ? datei.name : tRaw('vouchers.pdf_none');
}

/** Below the issuing country: in which currency its cards are denominated. */
function showLandCurrency() {
  const z = el('gutschein-land-waehrung');
  if (z) z.textContent = tRaw('vouchers.land_waehrung', { w: landCurrency() });
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
  gutscheinLandSpeichern,
});

// "More" collapses as soon as someone taps next to it, chooses inside it or presses Escape.
if (typeof document !== 'undefined') {
  document.addEventListener('click', ev => {
    const ziel = ev.target instanceof Element ? ev.target : null;
    for (const d of document.querySelectorAll('details.v-mehr[open]'))
      if (!d.contains(ziel) || ziel?.closest('.mehr-liste button')) /** @type {HTMLDetailsElement} */ (d).open = false;
  });
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    for (const d of document.querySelectorAll('details.v-mehr[open]')) {
      /** @type {HTMLDetailsElement} */ (d).open = false;
      if (d.contains(document.activeElement)) /** @type {HTMLElement|null} */ (d.querySelector('summary'))?.focus();
    }
  });
}
