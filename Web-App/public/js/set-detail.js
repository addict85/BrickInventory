// Der Detail-Dialog eines Sets: Anzeige, Menge, Anleitungen, Bildzoom. Er steht über Galerie und
// Kaufpreis-Dialog; wer ihn von unten öffnen muss, nimmt springe('setDetail', …) aus ziele.js.
import { stelleZielBereit } from './ziele.js';
import { registerActions, echt } from './registry.js';
import { CURRENCY, ME, curSet, set_curSet } from './zustand.js';
import { escJs, esc, html, sichereUrl, ungeprueft } from './escapen.js';
import { api } from './api.js';
import { fullUrl, setzeDialogbild, PLATZHALTER_SET } from './bilder.js';
import { G, ico, aktiverReiter, setzeHtml } from './dom.js';
import { fmtDatum, fmtGeld } from './format.js';
import { toast, verwirfToasts } from './meldungen.js';
import { alarmBlock, closeModal, ladeAlarm, ladeOrtAuswahl, lagerortBlock, setzeAlarmFeld } from './detailfelder.js';
import { confirmDelete } from './rueckfrage.js';
import { delSet, loadGallery, loadStats, reimportParts } from './gallery.js';
import { detailZeile, oderStrich, skelettZeilen, oeffneErfassen } from './bausteine.js';
import { diagrammBreite, priceChartSVG, renderMarketRows } from './diagramme.js';
import { loadFinance } from './finance.js';
import { locale, t, tRaw } from '../i18n.js';
import { openAcqModal, renderAcqModalBody } from './acquisition-modals.js';
import { kurzfassung, renderAcquisitionSummary } from './kaufpreis-anzeige.js';

// Verschoben wird nur über den Kaufpreis (Kaufpreis-Dialog, Zeile für Zeile), nicht das ganze Set: Mehrere
// Käufe eines Sets können im Haushalt verschiedenen Konten gehören. Der Server verlangt dafür
// acquisition_ids.
let _detailLauf = 0;

/** Inhalt des Set-Dialogs aus curSet und den Erfassungen. @param {string} sn @param {import('../../frontend-typen/vertrag').Acquisition[]} acqs */
function setDetailHtml(sn, acqs) {
  const set = curSet;
  if (!set) return '';
  const addedFmt = set.added_at ? fmtDatum(set.added_at) : '—';
  // Marktpreis und Entwicklung je Zustand, aus derselben Abfrage wie der Preisverlauf; hier nur der
  // Platzhalter. Ein Wert fürs ganze Set vermischte neu und gebraucht.
  const priceRow = html`<div class="m-wertkopf" id="m-market-rows" data-kopf="1" role="group" aria-label="${tRaw('detail.wert')}"><div class="skelett-zeile"></div><div class="skelett-zeile kurz"></div></div>`;
  const pnlRow = '';
  const qtyRow = detailZeile(
    t('detail.qty'),
    html`
      <button class="btn bs btn-sm detail-knopf menge-knopf" data-click="mQtyDec" aria-label="${tRaw('detail.qty_less')}">−</button>
      <input inputmode="numeric" type="number" id="m-qty" min="1" class="detail-feld menge-feld" aria-label="${tRaw('detail.qty')}" data-change="autosaveSet" />
      <button class="btn bs btn-sm detail-knopf menge-knopf" data-click="mQtyInc" aria-label="${tRaw('detail.qty_more')}">+</button>
    `,
    { wertStil: 'display:flex;align-items:center;gap:6px' },
  );

  // Acquisition summary: compact read-only rows + button to open full editor
  const acqRows = detailZeile(
    t('detail.purchase_price'),
    html`
      ${ungeprueft(renderAcquisitionSummary(acqs, sn))}
      <button class="btn bs btn-sm detail-knopf" data-click="openAcqModal" data-arg="${sn}">${ico('bearbeiten')} ${tRaw('detail.edit_prices')}</button>
    `,
    {
      zeilenStil: 'align-items:flex-start',
      wertId: 'm-acq-summary',
      wertStil: 'flex-direction:column;align-items:flex-end;gap:3px',
    },
  );

  return html`
    ${priceRow}${pnlRow}
    ${acqRows}
    ${detailZeile(t('detail.year'), oderStrich(set.year))}
    ${detailZeile(t('detail.theme'), esc(oderStrich(set.theme)))}
    ${qtyRow}
    ${detailZeile(t('detail.pieces'), set.pieces ? set.pieces.toLocaleString(locale()) : '—')}
    ${detailZeile(t('detail.minifigs'), oderStrich(set.minifigs), { wertId: 'm-minifigs-val' })}
    ${detailZeile(
      t('detail.alert'),
      alarmBlock(sn, 'm', (curSet?.conditions || []).includes('N') || !(curSet?.conditions || []).length ? 'N' : 'U'),
      {
        klasse: 'alarm-zeile',
        zeilenStil: 'align-items:flex-start',
        wertStil: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end',
      },
    )}
    ${detailZeile(
      t('detail.storage'),
      html`${lagerortBlock('m-storage', set.storage, `data-change="speichereSetLagerort" data-arg="${escJs(sn)}"`)}<button type="button" class="zu-sicht" data-click="sichtAusDialog" data-arg="lagerorte">${tRaw('detail.lagerorte_verwalten')}</button>`,
      { wertStil: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end' },
    )}
    ${detailZeile(t('detail.created'), `${ico('kalender')} ${addedFmt}`, { klasse: 'dr-leise' })}
    <div id="m-price-chart" data-stil="margin-top:.75rem">
      <h3 class="bereich-titel" data-stil="margin-bottom:4px">${tRaw('detail.price_history')}</h3>
      <div class="sparkline-wrap" id="m-sparkline-content"><span data-stil="color:var(--mut);font-size:var(--fs-1)">${tRaw('common.loading')}</span></div>
    </div>`;
}

/** Figurenzahl und Preisverlauf nachladen, ohne den Dialog aufzuhalten. @param {string} sn */
function ladeSetNachtraege(sn) {
  // Die Figurenzahl aus der Figurentabelle (verlässlicher als sets.minifigs). Die Antwort kann nach dem
  // Schliessen oder einem Setwechsel kommen; nur wenn noch dasselbe Set offen ist, wird geschrieben.
  api('GET', `/v1/minifigs?source=set`).then(md => {
    const el = G('m-minifigs-val');
    if (!el || !curSet || curSet.set_number !== sn) return;
    if (md.success && md.figs) {
      const setFigs = md.figs.filter(f => f.in_sets && String(f.in_sets).split(',').includes(sn));
      const total = setFigs.reduce(
        (s, f) => s + (parseInt(String(f.total_quantity), 10) || parseInt(String(f.quantity), 10) || 0),
        0,
      );
      if (total > 0) el.textContent = String(total);
      else if (!curSet.minifigs) el.textContent = '0';
    }
  });

  // Load price history async
  api('GET', `/v1/sets/${sn}/price-history`).then(ph => {
    renderMarketRows(ph);
    const el = G('m-sparkline-content');
    if (!el) return;
    // Beide Zustände in EINEM Diagramm — siehe priceChartSVG().
    setzeHtml(
      el,
      ph.success
        ? priceChartSVG(ph, sn.replace(/[^a-zA-Z0-9]/g, ''), diagrammBreite(el))
        : html`<span data-stil="color:var(--mut);font-size:var(--fs-1)">${tRaw(ph.networkError ? 'chart.offline' : 'detail.no_history')}</span>`,
    );
  });
}

/**
 * @param {string} sn
 */
export async function openModal(sn) {
  const lauf = ++_detailLauf;
  // Der Dialog steht sofort da, mit Platzhalter: Bei langsamem Netz geschah sonst bis zur Antwort nichts, und
  // ein zweiter Tipp öffnete ihn doppelt.
  G('m-tit').textContent = sn;
  G('m-untertit').textContent = '';
  setzeDialogbild(G('m-img'), PLATZHALTER_SET, PLATZHALTER_SET);
  setzeHtml(G('m-det'), skelettZeilen(4, tRaw('common.loading')));
  G('m-instr').replaceChildren();
  G('set-modal').dataset.nummer = sn;
  G('set-modal').classList.add('open');
  const [d, ad] = await Promise.all([
    api('GET', `/v1/sets/${sn}`),
    api('GET', `/v1/sets/${sn}/acquisitions`).catch(() => null),
  ]);
  // Inzwischen geschlossen oder ein anderes Set geöffnet: nichts mehr zeichnen.
  if (lauf !== _detailLauf || !G('set-modal').classList.contains('open')) return;
  if (!d?.success) {
    G('set-modal').classList.remove('open');
    // Meist ein Link auf ein Set, das (noch) nicht in diesem Konto ist: das sagen und das Anlegen anbieten.
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
  const set = d.set;
  if (!set) return;
  set_curSet(set);
  document.querySelector('#set-modal .mehr-menue')?.removeAttribute('open');
  G('m-tit').textContent = set.name || set.set_number;
  // Gehört das Set einem anderen Konto im Haushalt, steht es dabei; sonst sähe es aus wie das eigene.
  const fremd = (set.owners || []).filter(o => !ME || o.id !== ME.id).map(o => o.username);
  G('m-untertit').textContent = [
    set.name ? set.set_number : '',
    fremd.length ? tRaw('detail.konto_von', { namen: fremd.join(', ') }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  // fullUrl(): volle Auflösung, auch wenn image_local auf die _thumb-Datei zeigt
  const img = G('m-img');
  setzeDialogbild(img, fullUrl(set.image_local || set.image_url) || PLATZHALTER_SET, PLATZHALTER_SET);
  img.style.display = 'block';

  setzeHtml(G('m-det'), setDetailHtml(sn, ad?.acquisitions || []));

  G('m-qty').value = String(set.quantity);

  renderInstructions(set.instructions || [], sn);
  // Ab hier meinen die Alarm-Handler DIESEN Dialog.
  setzeAlarmFeld('m');
  G('set-modal').classList.add('open');
  ladeAlarm(sn).catch(() => {});
  // Die Auswahlliste gehört dem BESITZER des Sets, nicht dem Betrachter — Begründung an ladeOrtAuswahl().
  ladeOrtAuswahl(set.owners).catch(() => {});

  ladeSetNachtraege(sn);
}

/** Aus „Weitere Aktionen“ im Set-Detail: das offene Set. */
function teileNeuImportieren() {
  if (curSet?.set_number) reimportParts(curSet.set_number);
}

// openModal defined below (with price history)

/** @param {import('../../frontend-typen/vertrag').Instruction[]} instr @param {string} sn */
export function renderInstructions(instr, sn) {
  const items = instr
    .map(i => {
      const href = i.local_path || i.url;
      const isLocal = !!i.local_path;
      // Selbst hochgeladen oder automatisch importiert? Das sagt der Server (is_manual, siehe
      // utils/instructions.anleitungenZusammenlegen). Vorher stand die Regel hier als Pfadvergleich — eine
      // zweite Fassung derselben Frage, die die Android-App gar nicht erst nachbauen konnte.
      const isUpload = !!i.is_manual;
      const label = esc(i.description) || t('instr.label');
      // Lokale Dateien (PDF/Bild) im In-App-Viewer öffnen; externe URLs im neuen Tab.
      const link = isLocal
        ? html`<a href="${sichereUrl(href)}" data-click="openPdfViewerLink" data-arg="${href}" data-arg2="${i.description || ''}" data-stil="cursor:pointer">${ungeprueft(label)}</a>`
        : html`<a href="${sichereUrl(href)}" target="_blank" rel="noopener">${ungeprueft(label)}</a>`;
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
          <input type="text" id="instr-desc" data-stil="font-size:var(--fs-2);padding:6px 10px" />
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
      ${ME?.isAdmin || !instr.some(i => !i.is_manual) ? html`<button data-click="redownloadInstr" data-arg="${sn}" class="btn bs btn-sm" data-stil="margin-left:8px;font-size:var(--fs-0);padding:3px 8px">${tRaw('instr.reload')}</button>` : ''}
    </div>
    ${items ? ungeprueft(items) : html`<div data-stil="color:var(--mut);font-size:var(--fs-2)">${tRaw('instr.none_auto')}</div>`}
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
  const datei = fi.files?.[0];
  if (!datei) return;
  const status = G('instr-upload-status');
  status.textContent = tRaw('common.uploading');
  const fd = new FormData();
  fd.append('file', datei);
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

/**
 * @param {string} src
 */
/** @param {string} src @param {string} [name] wofür das Bild steht; ohne ihn hörte ein Vorleser nur „Schliessen“ */
export function openImageLightbox(src, name = '') {
  if (!src || src.endsWith('/assets/set-placeholder.svg')) return;
  G('lightbox-img').src = src;
  G('lightbox-img').setAttribute('alt', name || tRaw('common.bild'));
  G('img-lightbox').classList.add('open');
}

// `removeAttribute` und NICHT `src=''`: Ein leeres src ist keine leere
// Adresse, sondern die Adresse der SEITE. Der Browser laedt sie als Bild, scheitert daran, und der
// Fehlerlauscher in actions.js meldete bei jedem Schliessen des Zooms `[img] konnte nicht geladen werden:
// https://<host>/`. Ohne Attribut laedt der Browser gar nichts.
export function closeImageLightbox() {
  G('img-lightbox').classList.remove('open');
  G('lightbox-img').removeAttribute('src');
}

// Escape schliesst den Zoom über js/dialoge.js, wie jeden Dialog.
G('set-modal').addEventListener('click', e => e.target === e.currentTarget && closeModal());

/** @type {number | null} */
let _autosaveTimer = null;

export function autosaveSet() {
  if (!curSet) return;
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(async () => {
    const set = curSet;
    if (!set) return;
    const qty = parseInt(G('m-qty').value, 10) || 1;
    const prevQty = set.quantity || qty;
    const d = await api('PUT', `/v1/sets/${esc(set.set_number)}`, { quantity: qty });
    if (d.success) {
      // Die wirkliche Gesamtmenge kommt vom Server: Beim Verringern deckelt er bei den eigenen Exemplaren,
      // und dann stimmt die gesendete Zahl nicht. Ohne Übernahme stünde bis zum nächsten Öffnen die eigene
      // Annahme da.
      const echt = d.quantity != null && Number.isInteger(d.quantity) ? d.quantity : qty;
      // Gespeichert, aber ohne Marktpreis für die neue Erfassung: Er kommt mit dem Preislauf nach.
      if (d.degradiert?.includes('kaufpreis')) toast(tRaw('set.kaufpreis_folgt'), 'info');
      set.quantity = echt;
      if (echt !== qty) G('m-qty').value = String(echt);
      // Bei jeder Mengenänderung die Erfassungs-Übersicht neu laden: beim Erhöhen entsteht eine neue Zeile,
      // beim Reduzieren fällt (LIFO) die letzte weg — sonst blieb die entfernte Zeile in der Detailsicht
      // stehen.
      const sn = set.set_number;
      if (echt !== prevQty && typeof renderAcquisitionSummary === 'function') {
        api('GET', `/v1/sets/${esc(sn)}/acquisitions`)
          .then(ad => {
            if (!ad?.success) return;
            if (echt > prevQty) meldeNeueExemplare(sn, ad.acquisitions, echt - prevQty);
            const sumEl = G('m-acq-summary');
            if (sumEl) setzeHtml(sumEl, kurzfassung(ad.acquisitions, set.set_number));
            if (G('acq-modal').classList.contains('open') && typeof renderAcqModalBody === 'function') {
              renderAcqModalBody(set.set_number, ad.acquisitions, undefined);
            }
          })
          .catch(() => {});
      }
      // Mehr Exemplare melden sich mit Preis (meldeNeueExemplare), sobald die Erfassungen da sind.
      if (!(echt > prevQty)) toast(tRaw('settings.saved'), 'success');
      loadGallery();
      if (aktiverReiter() === 'finance') loadFinance();
    } else {
      toast(d.error || t('settings.error'), 'error');
    }
  }, 400);
}

/**
 * „+“ legt eine Kauferfassung an, meist mit dem Marktpreis als Schätzung. Das verändert die Finanzen, also
 * sagt der Toast es samt Betrag und bietet „Ändern“ an, statt nur „Gespeichert“ zu melden.
 */
/** @param {string} sn @param {import('../../frontend-typen/vertrag').Acquisition[] | null | undefined} acqs @param {number} n */
function meldeNeueExemplare(sn, acqs, n) {
  const neu = [...(acqs || [])].sort((a, b) => (b.id || 0) - (a.id || 0))[0];
  const preis = neu?.purchase_price;
  const mehrere = n > 1 ? 'exemplare' : 'exemplar';
  const text =
    preis != null && neu.price_estimated
      ? tRaw(`acq.${mehrere}_geschaetzt`, { n, preis: fmtGeld(preis, neu.currency || CURRENCY) })
      : preis == null
        ? tRaw(`acq.${mehrere}_ohne_preis`, { n })
        : tRaw('settings.saved');
  toast(text, 'success', { text: tRaw('acq.aendern'), fn: () => openAcqModal(sn) });
}

// Keine eigene Rückfrage mehr — delSet() fragt (siehe dort). Der Dialog schliesst nur, wenn wirklich gelöscht
// wurde; sonst stünde er nach einem „Abbrechen" leer da.
G('btn-md').onclick = async () => {
  if (!curSet) return;
  if (await delSet(curSet.set_number)) closeModal();
};

/**
 * @param {string} sn
 */
async function redownloadInstr(sn) {
  toast(tRaw('instr.loading'), 'info');
  const d = await api('POST', `/v1/sets/${sn}/instructions`);
  if (d.success) {
    if (!d.auftrag_id) toast(tRaw('instr.loaded', { count: d.instructions.length }), 'success');
    if (curSet) {
      openModal(sn);
    }
    loadStats();
  } else toast(d.error, 'error');
}

stelleZielBereit({ setDetail: openModal });

registerActions({
  teileNeuImportieren,
  autosaveSet,
  closeImageLightbox,
  delInstr,
  redownloadInstr,
  uploadInstr,
  openModal,
});
