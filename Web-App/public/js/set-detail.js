// The set detail dialog: display, quantity, instructions, image zoom. It sits above the gallery and
// the acquisition dialog; code that must open it from elsewhere uses jumpTo('setDetail', …) from targets.js.
import { emit } from './events.js';
import { registerTarget } from './targets.js';
import { registerActions, echt } from './registry.js';
import { accountCurrency, loggedInAccount, gallerySets, openSet, setOpenSet } from './state.js';
import { escJs, esc, html, safeUrl, rawHtml } from './escaping.js';
import { api } from './api.js';
import { fullUrl, setzeDialogbild, PLATZHALTER_SET } from './bilder.js';
import { G, ico, aktiverReiter, setzeHtml } from './dom.js';
import { fmtDatum, fmtGeld } from './format.js';
import { meldeAmFeld, toast, verwirfToasts } from './meldungen.js';
import { geloeschtMitRueckgaengig } from './papierkorb.js';
import {
  alarmBlock,
  closeModal,
  ladeAlarm,
  ladeOrtAuswahl,
  lagerortBlock,
  setzeAlarmFeld,
  setzeMengenfeld,
} from './detailfelder.js';
import { confirmDelete } from './rueckfrage.js';
import { delSet, reimportParts } from './collection.js';
import { detailZeile, kontoAnzeige, oderStrich, skelettZeilen, oeffneErfassen } from './bausteine.js';
import { diagrammBreite, priceChartSVG, renderMarketRows } from './diagramme.js';
import { locale, t, tRaw } from '../i18n.js';
import { openAcqModal, renderAcqModalBody } from './kauf-dialoge.js';
import { kurzfassung, renderAcquisitionSummary } from './kaufpreis-anzeige.js';

// Moving happens only per acquisition (the acquisition dialog, row by row), never for a whole set:
// several acquisitions of one set in a household can belong to different accounts. The server needs
// acquisition_ids for that.
let _detailRun = 0;

/** Accounts this account may write to (server: household members); null = not loaded yet.
 * @type {number[] | null} */
let _writableAccounts = null;

/** In a household: does the set (also) belong to another account? @param {import('../../frontend-typen/vertrag').SetItem | null} set */
const inHousehold = set => (set?.owners || []).some(o => !loggedInAccount || o.id !== loggedInAccount.id);

/** A name for the UI: the logged-in account is called "me". @param {{ id: number, username: string }} o */
const accountName = kontoAnzeige;

/**
 * Quantity per account from the acquisitions; the own account first. In a household each account
 * has its own stepper: a single total with "−" silently removed the own account's purchase even
 * when the other one's was meant.
 * @param {import('../../frontend-typen/vertrag').SetItem} set @param {import('../../frontend-typen/vertrag').Acquisition[]} acqs
 */
function quantitiesByAccount(set, acqs) {
  const owners = set.owners?.length
    ? set.owners
    : loggedInAccount
      ? [{ id: loggedInAccount.id, username: loggedInAccount.username }]
      : [];
  return owners
    .map(o => ({
      ...o,
      menge: acqs
        .filter(a => (a.owner_user_id ?? loggedInAccount?.id) === o.id)
        .reduce((s, a) => s + (a.quantity || 0), 0),
    }))
    .sort((a, b) => Number(b.id === loggedInAccount?.id) - Number(a.id === loggedInAccount?.id));
}

/**
 * Without a household, the plain field; in a household, one row per account (stepper only where
 * writing is allowed). "−" on the very last copy of the whole set is missing on purpose: that is a
 * delete and goes through the "Delete" action.
 * @param {import('../../frontend-typen/vertrag').SetItem} set @param {import('../../frontend-typen/vertrag').Acquisition[]} acqs
 */
function quantityBlock(set, acqs) {
  if (!inHousehold(set))
    return html`<span class="menge-regler" data-rueckmeldung>
      <button class="btn bs btn-sm detail-knopf menge-knopf" id="m-qty-dec" data-click="mQtyDec" aria-label="${tRaw('detail.qty_less')}">−</button>
      <input inputmode="numeric" type="number" id="m-qty" min="1" class="detail-feld menge-feld" aria-label="${tRaw('detail.qty')}" data-change="autosaveSet" />
      <button class="btn bs btn-sm detail-knopf menge-knopf" data-click="mQtyInc" aria-label="${tRaw('detail.qty_more')}">+</button>
      <span class="feld-status" role="status"></span><span class="vh" id="m-qty-letztes">${tRaw('detail.qty_letztes')}</span></span>`;
  const accounts = quantitiesByAccount(set, acqs);
  const total = accounts.reduce((s, k) => s + k.menge, 0);
  const rows = accounts.map(k => {
    const allowed = !_writableAccounts || _writableAccounts.includes(k.id);
    const name = accountName(k);
    const button = (/** @type {number} */ step, /** @type {string} */ symbol, /** @type {string} */ label) =>
      html`<button class="btn bs btn-sm detail-knopf menge-knopf" data-click="mengeJeKonto" data-arg="${k.id}" data-arg2="${step}" aria-label="${tRaw(label)}: ${name}"${step < 0 && (k.menge === 0 || total <= 1) ? html` disabled title="${tRaw(total <= 1 ? 'detail.qty_letztes' : 'detail.qty_less')}"` : ''}>${symbol}</button>`;
    return html`<div class="menge-konto" data-konto="${k.id}">
      <span class="menge-name">${name}</span>
      ${allowed ? button(-1, '−', 'detail.qty_less') : ''}<output class="menge-zahl" aria-label="${tRaw('detail.qty')}: ${name}">${k.menge}</output>${allowed ? button(1, '+', 'detail.qty_more') : ''}
    </div>`;
  });
  return html`<div class="menge-konten" data-rueckmeldung>${rows}
    <div class="menge-gesamt">${tRaw('detail.qty_zusammen', { n: total })}</div>
    <span class="feld-status" role="status"></span></div>`;
}

/** Header line: number and, in a household, ALL owners — naming only the other account read as if
 * the set belonged to them alone. @param {import('../../frontend-typen/vertrag').SetItem} set */
function subtitle(set) {
  const owners = inHousehold(set)
    ? (set.owners || [])
        .slice()
        .sort((a, b) => Number(b.id === loggedInAccount?.id) - Number(a.id === loggedInAccount?.id))
    : [];
  // Only the set number in fixed width; the owners are plain flowing text like everywhere else.
  const nr = set.name ? html`<span class="setnr">${set.set_number}</span>` : '';
  const who = owners.length
    ? tRaw(owners.length > 1 ? 'detail.konten_von' : 'detail.konto_von', { namen: owners.map(accountName).join(', ') })
    : '';
  return html`${nr}${nr && who ? ' · ' : ''}${who}`;
}

const PAIR = { paar: true };

/** Content of the set dialog from openSet and the acquisitions: value and history to the left under
 * the image, the fields on the right. @param {string} sn @param {import('../../frontend-typen/vertrag').Acquisition[]} acqs */
function setDetailHtml(sn, acqs) {
  const set = openSet;
  if (!set) return null;
  const addedFmt = set.added_at ? fmtDatum(set.added_at) : '—';
  // Market price and its movement per condition, from the same query as the price history; here only
  // the placeholder. A single value for the whole set mixed new and used.
  const priceRow = html`<div class="m-wertkopf" id="m-market-rows" data-kopf="1" role="group" aria-label="${tRaw('detail.wert')}"><div class="skelett-zeile"></div><div class="skelett-zeile kurz"></div></div>`;
  const pnlRow = '';
  const qtyRow = detailZeile(t('detail.qty'), quantityBlock(set, acqs), {
    zeilenStil: 'align-items:flex-start',
    wertId: 'm-menge',
    paar: true,
  });

  // Acquisition summary: compact read-only rows + button to open full editor
  const acqRows = detailZeile(
    t('detail.purchase_price'),
    html`
      ${renderAcquisitionSummary(acqs, sn)}
      <button class="btn bs btn-sm detail-knopf" data-click="openAcqModal" data-arg="${sn}">${ico('bearbeiten')} ${tRaw('detail.edit_prices')}</button>
    `,
    {
      zeilenStil: 'align-items:flex-start',
      wertId: 'm-acq-summary',
      wertStil: 'flex-direction:column;align-items:flex-end;gap:3px',
      paar: true,
    },
  );

  const left = html`${priceRow}${pnlRow}
    <div id="m-price-chart">
      <h3 class="bereich-titel" data-stil="margin-bottom:4px">${tRaw('detail.price_history')}</h3>
      <div class="sparkline-wrap" id="m-sparkline-content"><span data-stil="color:var(--mut);font-size:var(--fs-1)">${tRaw('common.loading')}</span></div>
    </div>`;
  // The minifig count comes from the catalog, same as in the table: the own minifig list only counts
  // what a parts import has taken over, and showed a different number for the same set.
  const right = html`<dl>
    ${acqRows}
    ${detailZeile(t('detail.year'), oderStrich(set.year), PAIR)}
    ${detailZeile(t('detail.theme'), esc(oderStrich(set.theme)), PAIR)}
    ${qtyRow}
    ${detailZeile(t('detail.pieces'), set.pieces ? set.pieces.toLocaleString(locale()) : '—', PAIR)}
    ${detailZeile(t('detail.minifigs'), oderStrich(set.minifigs), { wertId: 'm-minifigs-val', paar: true })}
    ${detailZeile(
      t('detail.alert'),
      alarmBlock(sn, 'm', (openSet?.conditions || []).includes('N') || !(openSet?.conditions || []).length ? 'N' : 'U'),
      {
        klasse: 'alarm-zeile',
        paar: true,
        zeilenStil: 'align-items:flex-start',
        wertStil: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end',
      },
    )}
    ${detailZeile(
      t('detail.storage'),
      html`${lagerortBlock('m-storage', set.storage, `data-change="speichereSetLagerort" data-arg="${escJs(sn)}"`)}<button type="button" class="zu-sicht" data-click="sichtAusDialog" data-arg="lagerorte">${tRaw('detail.lagerorte_verwalten')}</button>`,
      { wertStil: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end', paar: true },
    )}
    ${detailZeile(
      t('detail.created'),
      html`${ico('kalender')} ${addedFmt} <span class="text-klein">(${tRaw('detail.created_hint')})</span>`,
      { klasse: 'dr-leise', paar: true },
    )}</dl>`;
  return { links: left, rechts: right };
}

/** Load the price history in the background, without holding up the dialog.
 * @param {string} sn @param {import('../../frontend-typen/vertrag').Acquisition[]} acqs */
function loadSetFollowups(sn, acqs) {
  const prices = (/** @type {string} */ z) =>
    new Set(acqs.filter(a => a.condition === z && a.purchase_price != null).map(a => a.unit_price ?? a.purchase_price));
  const multi = new Set(['N', 'U'].filter(z => prices(z).size > 1));
  // The answer can arrive after closing or after switching sets; then it no longer belongs in the dialog.
  api('GET', `/v1/sets/${sn}/price-history`).then(ph => {
    if (!openSet || openSet.set_number !== sn) return;
    renderMarketRows(ph);
    const el = G('m-sparkline-content');
    if (!el) return;
    // Both conditions in ONE chart — see priceChartSVG().
    setzeHtml(
      el,
      ph.success
        ? priceChartSVG(ph, sn.replace(/[^a-zA-Z0-9]/g, ''), diagrammBreite(el), multi)
        : html`<span data-stil="color:var(--mut);font-size:var(--fs-1)">${tRaw(ph.networkError ? 'chart.offline' : 'detail.no_history')}</span>`,
    );
  });
}

/**
 * @param {string} sn
 */
export async function openModal(sn) {
  const run = ++_detailRun;
  // The dialog appears right away, with a placeholder: on a slow connection nothing happened until
  // the answer arrived, and a second tap opened it twice.
  G('m-tit').textContent = sn;
  G('m-untertit').textContent = '';
  setzeDialogbild(G('m-img'), PLATZHALTER_SET, PLATZHALTER_SET);
  setzeHtml(G('m-det'), skelettZeilen(4, tRaw('common.loading')));
  G('m-det-links')?.replaceChildren();
  G('m-instr').replaceChildren();
  G('set-modal').dataset.nummer = sn;
  G('set-modal').classList.add('open');
  const [d, ad, hm] = await Promise.all([
    api('GET', `/v1/sets/${sn}`),
    api('GET', `/v1/sets/${sn}/acquisitions`),
    _writableAccounts ? null : api('GET', '/v1/sets/household-members'),
  ]);
  if (hm?.success) _writableAccounts = hm.members.map(m => m.id);
  // Closed or another set opened in the meantime: draw nothing further.
  if (run !== _detailRun || !G('set-modal').classList.contains('open')) return;
  // Without a connection, the dialog shows what the collection has already loaded instead of not opening at all.
  const fromCache = !d?.success && d?.networkError ? gallerySets.find(x => x.set_number === sn) : undefined;
  if (fromCache) toast(tRaw('detail.offline_stand'), 'info');
  if (!d?.success && !fromCache) {
    G('set-modal').classList.remove('open');
    // Usually a link to a set that is (not yet) in this account: say so and offer to add it.
    if (d?.status === 404) {
      verwirfToasts();
      toast(tRaw('detail.nicht_in_sammlung', { nr: sn }), 'info', {
        text: tRaw('detail.jetzt_hinzufuegen'),
        fn: () => {
          oeffneErfassen('set');
          const f = G('add-num');
          if (f) {
            f.value = sn;
            f.focus();
          }
        },
      });
    } else toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  const set = d?.success ? d.set : fromCache;
  if (!set) return;
  setOpenSet(set);
  document.querySelector('#set-modal .mehr-menue')?.removeAttribute('open');
  G('m-tit').textContent = set.name || set.set_number;
  setzeHtml(G('m-untertit'), subtitle(set));
  // fullUrl(): full resolution, even when image_local points at the _thumb file
  const img = G('m-img');
  setzeDialogbild(img, fullUrl(set.image_local || set.image_url) || PLATZHALTER_SET, PLATZHALTER_SET);
  img.style.display = 'block';

  const content = setDetailHtml(sn, ad?.acquisitions || []);
  setzeHtml(G('m-det-links'), content ? content.links : '');
  setzeHtml(G('m-det'), content ? content.rechts : '');

  setzeMengenfeld(set.quantity);

  renderInstructions(set.instructions || [], sn);
  // From here on, the alert handlers mean THIS dialog.
  setzeAlarmFeld('m');
  G('set-modal').classList.add('open');
  ladeAlarm(sn).catch(() => {});
  // The storage-location list belongs to the set's OWNER, not the viewer — see ladeOrtAuswahl() for why.
  ladeOrtAuswahl(set.owners).catch(() => {});

  loadSetFollowups(sn, ad?.acquisitions || []);
}

/** From "more actions" in set detail: the currently open set. */
function teileNeuImportieren() {
  if (openSet?.set_number) reimportParts(openSet.set_number);
}

/** @param {import('../../frontend-typen/vertrag').Instruction[]} instr @param {string} sn */
export function renderInstructions(instr, sn) {
  const items = instr
    .map(i => {
      const href = i.local_path || i.url;
      const isLocal = !!i.local_path;
      // Uploaded by hand or imported automatically? The server says so (is_manual, see
      // anleitungenZusammenlegen in src/katalog/instructions.ts). Previously the rule lived here as a
      // path comparison — a second version of the same question that the Android app could not rebuild at all.
      const isUpload = !!i.is_manual;
      const label = esc(i.description) || t('instr.label');
      // Local files (PDF/image) open in the in-app viewer; external URLs open in a new tab.
      const link = isLocal
        ? html`<a href="${safeUrl(href)}" data-click="openPdfViewerLink" data-arg="${href}" data-arg2="${i.description || ''}" data-stil="cursor:pointer">${rawHtml(label)}</a>`
        : html`<a href="${safeUrl(href)}" target="_blank" rel="noopener">${rawHtml(label)}</a>`;
      return html`<div class="ii" id="instr-${i.id}">
      ${link}
      ${isUpload ? html`<span class="lv" data-stil="background:var(--p100);color:var(--p600)">${tRaw('instr.badge_manual')}</span>` : isLocal ? html`<span class="lc">${ico('speichern')}</span>` : html`<span class="lv">${ico('globus')}</span>`}
      ${isUpload ? html`<button data-click="delInstr"${echt()} data-arg="${sn}" data-arg2="${i.id}" title="${tRaw('instr.delete_tooltip')}" data-stil="background:none;border:none;cursor:pointer;color:var(--s400);font-size:var(--fs-3);padding:0 2px" aria-label="${tRaw('instr.delete_tooltip')}">${ico('schliessen')}</button>` : ''}
    </div>`;
    })
    .join('');

  const uploadForm = html`
    <div id="instr-upload-form" data-stil="margin-top:10px;padding:10px;background:var(--s50);border:1px dashed var(--bdr);border-radius:8px">
      <div data-stil="font-size:var(--fs-1);font-weight:600;color:var(--mut);margin-bottom:7px">${tRaw('instr.upload_title')}</div>
      <div data-stil="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end">
        <div data-stil="flex:1;min-width:140px">
          <label for="instr-desc" class="feld-titel-klein">${tRaw('instr.desc_placeholder')}</label>
          <input type="text" id="instr-desc" />
        </div>
        <label class="btn bs btn-sm zeiger">
          ${ico('datei')} ${tRaw('instr.choose_file')}
          <input type="file" id="instr-file" accept=".pdf,.jpg,.jpeg,.png" class="datei-versteckt" data-change="uploadInstr" data-arg="${sn}" />
        </label>
      </div>
      <div id="instr-upload-status" role="status" data-stil="font-size:var(--fs-1);margin-top:6px;color:var(--mut)"></div>
    </div>`;

  setzeHtml(
    G('m-instr'),
    html`
    <div class="zeile umbruch mittig" data-stil="margin:12px 0 7px;gap:8px">
      <h3 class="bereich-titel" data-stil="margin:0">${tRaw('instr.section_title')} ${instr.length ? html`(${instr.length})` : ''}</h3>
      ${loggedInAccount?.isAdmin || !instr.some(i => !i.is_manual) ? html`<button data-click="redownloadInstr" data-arg="${sn}" class="btn bs btn-sm" data-stil="margin-left:8px;font-size:var(--fs-0);padding:3px 8px">${tRaw('instr.reload')}</button>` : ''}
    </div>
    ${items ? rawHtml(items) : html`<div data-stil="color:var(--mut);font-size:var(--fs-2)">${tRaw('instr.none_auto')}</div>`}
    ${uploadForm}`,
  );
}

/** @param {string} sn @param {string} instrId */
async function delInstr(sn, instrId) {
  if (!(await confirmDelete(tRaw('instr.delete_title'), tRaw('instr.delete_text'), 'datei'))) return;
  const d = await api('DELETE', `/v1/sets/${sn}/instructions/${instrId}`);
  if (d.success) {
    toast(tRaw('instr.deleted'), 'success');
    openModal(sn);
  } else toast(d.error || t('settings.error'), 'error');
}

/**
 * @param {string} sn
 */
async function uploadInstr(sn) {
  const fi = G('instr-file');
  const file = fi.files?.[0];
  if (!file) return;
  const status = G('instr-upload-status');
  status.textContent = tRaw('common.uploading');
  const fd = new FormData();
  fd.append('file', file);
  const desc = G('instr-desc').value.trim();
  if (desc) fd.append('description', desc);
  try {
    const d = await api('POST', `/v1/sets/${sn}/instructions/upload`, fd);
    if (d.success) {
      toast(tRaw('instr.uploaded'), 'success');
      openModal(sn);
    } else {
      status.textContent = d.error || tRaw('settings.error');
      status.style.color = 'var(--r500)';
    }
  } catch {
    status.textContent = tRaw('common.network_error');
  }
}

/** @param {string} src @param {string} [name] what the image shows — without it a screen reader heard only "Close" */
export function openImageLightbox(src, name = '') {
  if (!src || src.endsWith('/assets/set-placeholder.svg')) return;
  G('lightbox-img').src = src;
  G('lightbox-img').setAttribute('alt', name || tRaw('common.bild'));
  G('img-lightbox').classList.add('open');
}

// `removeAttribute`, NOT `src=''`: an empty src is not an empty address, it is the address of the
// PAGE. The browser loads it as an image, fails, and the error listener in aktionen.js reported on
// every close of the zoom `[img] could not load: https://<host>/`. Without the attribute the
// browser loads nothing at all.
export function closeImageLightbox() {
  G('img-lightbox').classList.remove('open');
  G('lightbox-img').removeAttribute('src');
}

// Escape closes the zoom via js/dialoge.js, like every dialog.
G('set-modal').addEventListener('click', e => e.target === e.currentTarget && closeModal());

/** @type {number | null} */
let _autosaveTimer = null;
/** The quantity change not yet saved; null when nothing is pending. @type {(() => void) | null} */
let _pendingQuantitySave = null;

/** Save right away when closing: the dialog forgets openSet, and a change 400 ms after "−" was
 * closed got lost. Observed instead of hooked into every close path (button, Esc, backdrop,
 * acquisition dialog). */
function saveQuantityNow() {
  if (_autosaveTimer !== null) clearTimeout(_autosaveTimer);
  _autosaveTimer = null;
  _pendingQuantitySave?.();
}
if (typeof MutationObserver === 'function')
  new MutationObserver(() => {
    if (!G('set-modal').classList.contains('open')) saveQuantityNow();
  }).observe(G('set-modal'), { attributes: true, attributeFilter: ['class'] });

export function autosaveSet() {
  if (!openSet) return;
  setzeMengenfeld();
  if (_autosaveTimer !== null) clearTimeout(_autosaveTimer);
  const set = openSet;
  _pendingQuantitySave = () => {
    _pendingQuantitySave = null;
    const qty = parseInt(G('m-qty').value, 10) || 1;
    changeQuantity({ quantity: qty }, qty - (set.quantity || qty), G('m-qty'), set);
  };
  _autosaveTimer = setTimeout(saveQuantityNow, 400);
}

/** The stepper of one account in a household: a single step, relative, for exactly this account.
 * @param {string} konto @param {string} schritt */
function mengeJeKonto(konto, schritt) {
  const id = Number(konto),
    n = Number(schritt);
  if (!openSet || !Number.isInteger(id) || !n) return;
  const button = document.querySelector(`#m-menge [data-konto="${id}"] [data-arg2="${n}"]`);
  changeQuantity({ quantity_delta: n, ...(id === loggedInAccount?.id ? {} : { owner_user_id: id }) }, n, button);
}

/**
 * Save, then reload everything in the detail that depends on quantity (stepper, acquisition prices,
 * the value header with gains/losses, and the acquisition line in the chart). A decrease names the
 * acquisition that went away and offers Undo like a delete; an increase names the estimated price.
 * @param {{ quantity?: number, quantity_delta?: number, owner_user_id?: number }} body @param {number} step
 * @param {Element | null} field @param {import('./state.js').Tile | null} [set] the set, even if the dialog is already closed
 */
async function changeQuantity(body, step, field, set = openSet) {
  if (!set || !step) return;
  const sn = set.set_number;
  const d = await api('PUT', `/v1/sets/${esc(sn)}`, body);
  if (!d.success) {
    toast(d.error || t('settings.error'), 'error');
    return;
  }
  // Saved, but without a market price for the new acquisition: it follows with the price job.
  if (d.degradiert?.includes('kaufpreis')) toast(tRaw('set.kaufpreis_folgt'), 'info');
  if (d.entfallen?.length) reportRemovedPurchase(sn, d, body.owner_user_id);
  const ad = await refreshDetail(sn, field);
  if (step > 0 && ad) reportNewCopies(sn, ad.acquisitions, step);
  emit('sammlungLaden');
  if (aktiverReiter() === 'finance') emit('finanzenLaden');
}

/** "Purchase from 09/13/2026 (€250.00) removed" with Undo; the acquisition sits in the trash.
 * @param {string} sn @param {import('../../frontend-typen/vertrag').MengeGeaendert} d @param {number} [accountId] */
function reportRemovedPurchase(sn, d, accountId) {
  const removed = d.entfallen || [];
  const k = removed[0];
  const preis = k?.purchase_price != null ? ` (${fmtGeld(k.purchase_price, k.currency || accountCurrency)})` : '';
  const owner = accountId ? (openSet?.owners || []).find(o => o.id === accountId) : null;
  const text =
    removed.length === 1 && k
      ? tRaw('detail.kauf_entfernt', { datum: fmtDatum(k.date || ''), preis })
      : tRaw('detail.kaeufe_entfernt', { n: removed.length });
  const ids = typeof d.papierkorb === 'number' ? [d.papierkorb] : d.papierkorb || [];
  geloeschtMitRueckgaengig(owner ? `${text} · ${accountName(owner)}` : text, { papierkorb: ids }, () => {
    if (openSet?.set_number === sn) refreshDetail(sn, null);
  });
}

/**
 * Re-fetch the set and its acquisitions, and redraw the quantity block, the acquisition prices, the
 * header line and the value header with its chart. Focus stays on the pressed button, the feedback
 * sits at the field.
 * @param {string} sn @param {Element | null} field
 */
async function refreshDetail(sn, field) {
  const [d, ad] = await Promise.all([
    api('GET', `/v1/sets/${esc(sn)}`),
    api('GET', `/v1/sets/${esc(sn)}/acquisitions`),
  ]);
  if (!d?.success || !d.set || openSet?.set_number !== sn || !G('set-modal').classList.contains('open')) return ad;
  setOpenSet(d.set);
  const acqs = ad?.acquisitions || [];
  const focused = field && field === document.activeElement ? field : null;
  const quantityEl = G('m-menge');
  if (quantityEl) setzeHtml(quantityEl, quantityBlock(d.set, acqs));
  const newField = G('m-qty');
  setzeMengenfeld(d.set.quantity);
  const sumEl = G('m-acq-summary');
  if (sumEl) setzeHtml(sumEl, kurzfassung(acqs, sn));
  if (G('acq-modal').classList.contains('open')) renderAcqModalBody(sn, acqs, ad?.totals);
  setzeHtml(G('m-untertit'), subtitle(d.set));
  // The pressed button has been replaced; focus goes to its successor, or, if that is disabled (last
  // "−"), to "+".
  const accountId = field instanceof HTMLElement ? field.dataset.arg : undefined;
  const buttons = accountId ? [...(quantityEl?.querySelectorAll(`[data-arg="${accountId}"]`) || [])] : [];
  const target =
    field?.id === 'm-qty'
      ? newField
      : (buttons.find(
          k =>
            k instanceof HTMLElement &&
            k.dataset.arg2 === /** @type {HTMLElement} */ (field).dataset.arg2 &&
            !k.hasAttribute('disabled'),
        ) ??
        buttons.find(k => !k.hasAttribute('disabled')) ??
        null);
  if (focused && target instanceof HTMLElement) target.focus({ preventScroll: true });
  meldeAmFeld(target || quantityEl?.querySelector('[data-rueckmeldung]'));
  loadSetFollowups(sn, acqs);
  return ad;
}

/**
 * "+" creates an acquisition, usually with the market price as an estimate. That changes the
 * finances, so the toast says so with the amount and offers "Change" instead of only reporting "Saved".
 * @param {string} sn @param {import('../../frontend-typen/vertrag').Acquisition[] | null | undefined} acqs @param {number} n
 */
function reportNewCopies(sn, acqs, n) {
  const latest = [...(acqs || [])].sort((a, b) => (b.id || 0) - (a.id || 0))[0];
  const preis = latest?.purchase_price;
  const plural = n > 1 ? 'exemplare' : 'exemplar';
  const text =
    preis != null && latest.price_estimated
      ? tRaw(`acq.${plural}_geschaetzt`, { n, preis: fmtGeld(preis, latest.currency || accountCurrency) })
      : preis == null
        ? tRaw(`acq.${plural}_ohne_preis`, { n })
        : tRaw('settings.saved');
  toast(text, 'success', { text: tRaw('acq.aendern'), fn: () => openAcqModal(sn) });
}

// No separate confirmation here anymore — delSet() asks (see there). The dialog closes only on an
// actual delete; otherwise it would stand empty after a "Cancel".
G('btn-md').onclick = async () => {
  if (!openSet) return;
  if (await delSet(openSet.set_number)) closeModal();
};

/**
 * @param {string} sn
 */
async function redownloadInstr(sn) {
  toast(tRaw('instr.loading'), 'info');
  const d = await api('POST', `/v1/sets/${sn}/instructions`);
  if (d.success) {
    if (!d.auftrag_id) toast(tRaw('instr.loaded', { count: d.instructions.length }), 'success');
    if (openSet) {
      openModal(sn);
    }
    emit('kennzahlenLaden');
  } else toast(d.error, 'error');
}

registerTarget({ setDetail: openModal });

// Names below are registry-exposed (data-click/data-change in index.html, or verbindung.js) — kept unchanged.
registerActions({
  teileNeuImportieren,
  autosaveSet,
  mengeJeKonto,
  closeImageLightbox,
  delInstr,
  redownloadInstr,
  uploadInstr,
  openModal,
});
