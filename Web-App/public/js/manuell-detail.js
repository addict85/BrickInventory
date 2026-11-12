import { detailZeile } from './bausteine.js';
import { echt, registerActions } from './registry.js';
import { colorName, t, tRaw } from '../i18n.js';
import { escHex, escJs, hexZiffern, esc, html, ungeprueft, verbinde } from './escapen.js';
import { api } from './api.js';
import { fullUrl, imgUrl } from './bilder.js';
import { ico, G, aktiverReiter, setzeHtml, fuegeHtmlEin } from './dom.js';
import { betragFuerFeld } from './format.js';
import { betragAusFeld, mengeAusFeld, kaufdatumGueltig } from './formular.js';
import { toast } from './meldungen.js';
import { loadFinance } from './finance.js';
import { deleteManualFig, loadManualFigsTable, manuelleFiguren, updateManualFig } from './minifigs.js';
import { ME } from './zustand.js';
import { lagerortBlock, ladeOrtAuswahl } from './detailfelder.js';
import { confirmDelete } from './rueckfrage.js';
import { acqSummary, renderManAcqSummary, kurzfassungMan } from './kaufpreis-anzeige.js';
import { diagrammBreite, priceChartSVG, renderMarketRows } from './diagramme.js';
import { deleteManualPart, loadManualParts, manuelleTeile, updateManualPart } from './parts.js';
import { loadBrickColors } from './teil-erfassen.js';
import {
  erfassung,
  gespeichert,
  setzeMitFokus,
  isoTag,
  datumFeld,
  gespeichertMarke,
  zeigeGespeichert,
} from './erfassung-zustand.js';
import { closeAcqModal } from './acquisition-modals.js';
/** @typedef {import('../../frontend-typen/vertrag').AcquisitionTotals} Erfassungssumme */
/** @typedef {import('../../frontend-typen/vertrag').Acquisition} Erfassung */

// Detailfenster und Erfassungen manuell erfasster Teile und Minifiguren; das Fenster #acq-modal teilt es mit
// dem Kaufpreis-Dialog des Sets (acquisition-modals.js).
// ── MANUAL ITEM DETAIL MODAL (Teile + Minifiguren) ─────────────────────────
/** @type {{ type: string, id: string, colorId: number, owner?: number } | null} */
let _manItem = null; // { type:'part'|'fig', id, colorId:int, owner:int|undefined }
/** Ein anderer Dialog übernimmt: Der Zustand des Teile-Dialogs gilt nicht mehr. */
export function vergissManItem() {
  _manItem = null;
}

/** Die Zeilen des Detail-Dialogs eines manuell erfassten Teils oder einer Figur.
 * @param {string} type @param {string} id @param {number} colorId @param {{ quantity?: number, user_id?: number | null, bl_fig_number?: string | null, color_hex?: string | null, color_name?: string | null, storage?: string | null }} item @param {Erfassung[]} acqs @param {{ totals?: { priced_rows?: number, quantity?: number } } | null | undefined} ad
 * @returns {import('./escapen.js').Markup[]} */
function manDetailZeilen(type, id, colorId, item, acqs, ad) {
  const rows = [];

  // Qty stepper — die Stückzahl kommt aus derselben Serversumme wie die Summenzeile darunter (`totals`),
  // nicht aus einer eigenen Schleife.
  const totalQty = ad?.totals?.priced_rows !== undefined && acqs.length ? ad.totals.quantity : item.quantity;
  rows.push(
    detailZeile(
      t('detail.qty'),
      html`
    <button class="btn bs btn-sm" data-click="manQtyChange" data-arg="-1" aria-label="${tRaw('detail.qty_less')}" data-stil="font-size:var(--fs-4);padding:2px 8px;line-height:1">−</button>
    <input inputmode="numeric" type="number" id="man-det-qty" min="1" aria-label="${tRaw('detail.qty')}" value="${totalQty}" data-stil="width:4.5em;text-align:center;border:1px solid var(--feldrand);border-radius:6px;padding:2px;font-weight:600" data-change="manQtySave" />
    <button class="btn bs btn-sm" data-click="manQtyChange" data-arg="1" aria-label="${tRaw('detail.qty_more')}" data-stil="font-size:var(--fs-4);padding:2px 8px;line-height:1">+</button>
  `,
      { wertStil: 'display:flex;align-items:center;gap:6px' },
    ),
  );

  // BrickLink-Nr (minifigs only, editable)
  if (type === 'fig') {
    rows.push(
      detailZeile(
        'BrickLink-Nr.',
        html`
      <input type="text" value="${item.bl_fig_number || ''}" placeholder="${tRaw('figs.bl_placeholder')}" aria-label="${tRaw('figs.bl_number')}" data-stil="width:9em;max-width:100%;text-align:right;border:1px solid var(--feldrand);border-radius:6px;padding:2px 6px"
        data-blur="saveManualFigBl" data-arg="${id}" data-arg2="${item?.user_id || ''}" />
    `,
      ),
    );
  }

  // Die Farbe eines Teils ist änderbar, für den Fall, dass sie falsch geladen wurde — gerade ein Teil ohne
  // Farbname braucht die Zeile. Dieselbe Liste wie beim Erfassen (loadBrickColors), nachgeladen nach dem
  // Zeichnen.
  if (type === 'part') {
    const swatch = html`<span id="man-farb-punkt" data-stil="display:inline-block;width:12px;height:12px;border-radius:50%;border:1px solid rgba(0,0,0,.15);vertical-align:middle;flex:0 0 auto" data-farbe="${escHex(item.color_hex, 'var(--s300)')}"></span>`;
    rows.push(
      detailZeile(
        t('parts.color_label'),
        html`${swatch}
      <select id="man-farb-wahl" aria-label="${tRaw('parts.color_label')}" data-stil="max-width:150px;border:1px solid var(--feldrand);border-radius:6px;padding:2px 4px;font-size:var(--fs-2)"
        data-change="speichereTeilFarbe" data-part="${id}" data-color="${colorId}"
        data-owner="${item?.user_id ?? ''}">
        <option value="${colorId}">${item.color_name ? colorName(item.color_name) : tRaw('parts.no_color_dash')}</option>
      </select>`,
        { wertStil: 'display:flex;align-items:center;gap:6px;justify-content:flex-end' },
      ),
    );
  }

  // Lagerort auch im Detail der manuell erfassten Teile und Figuren: Dasselbe Bedienelement und derselbe
  // Speicherweg wie bei Teilen aus Sets, nur die Adresse hängt am Typ. Die Ortsliste gehört dem Besitzer.
  ladeOrtAuswahl(item?.user_id != null ? [item.user_id] : []).catch(() => {});
  rows.push(
    detailZeile(
      t('detail.storage'),
      lagerortBlock(
        'man-storage',
        item?.storage,
        `data-change="speichereTeilLagerort" data-typ="${type === 'fig' ? 'fig' : 'part'}" ` +
          `data-part="${escJs(id)}" data-color="${colorId}" ` +
          `data-owners="${esc(item?.user_id ?? '')}"`,
      ),
      { wertStil: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end' },
    ),
  );

  // Acquisition summary — compact, like set-detail
  rows.push(
    detailZeile(
      t('detail.purchase_price'),
      html`
      ${ungeprueft(renderManAcqSummary(acqs, type, id, colorId))}
      <button class="btn bs btn-sm" data-click="openManAcqModal" data-stil="margin-top:4px;font-size:var(--fs-1);padding:2px 10px">${ico('bearbeiten')} ${tRaw('detail.edit_prices')}</button>
    `,
      {
        zeilenStil: 'align-items:flex-start',
        wertId: 'man-acq-summary',
        wertStil: 'flex-direction:column;align-items:flex-end;gap:3px',
      },
    ),
  );

  // Preisverlauf wie im Set-Detail, beide Zustände in einem Diagramm, der Marktpreis je Zustand darüber. Bis
  // genug Punkte gesammelt sind, bleibt das Diagramm leer — das ist erwartet.
  rows.push(html`<div id="man-market-rows"></div>`);

  rows.push(html`<div data-stil="margin-top:10px">
    <h3 class="bereich-titel" data-stil="margin-bottom:4px">${tRaw('detail.price_history')}</h3>
    <div id="man-chart-content"><span data-stil="color:var(--mut);font-size:var(--fs-1)">${tRaw('common.loading')}</span></div>
  </div>`);

  return rows;
}

/** Preisverlauf und Marktpreise nachladen, ohne den Dialog aufzuhalten.
 * @param {string} type @param {string} id @param {number | string} colorId */
function ladeManPreisverlauf(type, id, colorId) {
  // Derselbe Renderer wie beim Set — die Endpunkte liefern dieselbe Diagrammstruktur
  // (src/finanzen/chartData.ts), also braucht es hier keine zweite Zeichenlogik.
  const histUrl =
    type === 'fig'
      ? `/v1/minifigs/${encodeURIComponent(id)}/price-history`
      : `/v1/parts/${encodeURIComponent(id)}/${colorId || 0}/price-history`;
  api('GET', histUrl)
    .then(ph => {
      // Dieselbe Funktion wie im Set-Detail — die Endpunkte liefern dieselbe by_condition-Struktur, also
      // braucht es keine zweite Darstellungslogik.
      renderMarketRows(ph, 'man-market-rows');
      const el = G('man-chart-content');
      if (!el) return;
      setzeHtml(
        el,
        ph?.success
          ? priceChartSVG(ph, `man-${String(id).replace(/[^a-zA-Z0-9]/g, '')}-${colorId || 0}`, diagrammBreite(el))
          : html`<span data-stil="color:var(--mut);font-size:var(--fs-1)">${tRaw('detail.no_history')}</span>`,
      );
    })
    .catch(() => {
      const el = G('man-chart-content');
      if (el)
        setzeHtml(
          el,
          html`<span data-stil="color:var(--mut);font-size:var(--fs-1)">${tRaw('detail.no_history')}</span>`,
        );
    });
}

/**
 * @param {string} type
 * @param {string} id
 * @param {string | number} colorId
 */
export async function openManDetail(type, id, colorId) {
  const ziel = /** @type {NonNullable<typeof _manItem>} */ ({ type, id, colorId: parseInt(String(colorId), 10) || 0 });
  _manItem = ziel;
  const modal = G('man-detail-modal');
  const bodyEl = G('man-detail-body');
  const imgEl = G('man-detail-img');

  /** @param {ManuelleFigur[] | undefined} figs @param {ManuellesTeil[] | undefined} teile */
  const finde = (figs, teile) =>
    type === 'fig'
      ? figs?.find(f => f.fig_number === id)
      : teile?.find(p => p.part_number === id && (p.color_id || 0) === ziel.colorId);

  let item = finde(manuelleFiguren(), manuelleTeile());
  // Die Caches der Reiter Teile und Minifiguren folgen deren Suche, Lagerort und Kontowahl; die Finanztabelle
  // nicht. Fehlt der Eintrag, wird er deshalb ungefiltert gesucht — der Cache des Reiters bleibt, wie er ist.
  if (!item && type === 'fig')
    item = finde((await api('GET', '/v1/minifigs/manual').catch(() => null))?.figs, undefined);
  if (!item && type !== 'fig') item = finde(undefined, (await api('GET', '/v1/parts/manual').catch(() => null))?.parts);
  // Besitzer der KARTE merken. Im Haushalt zeigt der manuelle Bereich die Eintraege aller Konten; ohne diese
  // Angabe schrieb der Server in die Zeile des Aufrufers. NACHGEMESSEN: Das Hauptkonto setzte auf der Karte
  // des Kindes die Menge auf 99 — geaendert wurde die eigene (vorher 5|9, nachher 99|9), und die Antwort
  // sagte „success".
  ziel.owner = item?.user_id ?? undefined;
  if (!item) return;

  G('man-detail-tit').textContent = String(item.fig_name || item.part_name || id);
  G('man-detail-sub').textContent = id + (item.color_name ? ' · ' + colorName(String(item.color_name)) : '');

  // Volle Auflösung über den Server-Proxy, nicht direkt vom CDN: Fremde Bildadressen lädt der Browser nie
  // selbst (Hotlink-Schutz, Cache).
  const rawImgSrc = item.image_local || item.image_url || '';
  const imgSrc = rawImgSrc ? imgUrl(fullUrl(rawImgSrc), false) : '';
  if (imgSrc) {
    imgEl.src = imgSrc;
    imgEl.style.display = '';
  } else {
    imgEl.style.display = 'none';
  }

  // Load acquisitions
  const acqUrl =
    type === 'fig'
      ? `/v1/minifigs/${encodeURIComponent(id)}/acquisitions`
      : `/v1/parts/${encodeURIComponent(id)}/${parseInt(String(colorId), 10) || 0}/acquisitions`;
  const ad = await api('GET', acqUrl).catch(() => null);
  const acqs = ad?.acquisitions || [];

  setzeHtml(bodyEl, verbinde(manDetailZeilen(type, id, ziel.colorId, item, acqs, ad)));
  modal.classList.add('open');

  // Farbauswahl nachfüllen — siehe die Begründung an der Zeile oben.
  if (type === 'part') fuelleFarbwahl(ziel.colorId).catch(() => {});

  ladeManPreisverlauf(type, id, colorId);

  // Wire delete button — deleteManualFig/deleteManualPart already have their own confirmDelete
  G('man-detail-del').onclick = async () => {
    const mi = /** @type {NonNullable<typeof _manItem>} */ (_manItem);
    if (type === 'fig') {
      const ok = await deleteManualFig(id);
      if (ok !== false) closeManDetail();
    } else {
      const ok = await deleteManualPart(id, mi.colorId);
      if (ok !== false) closeManDetail();
    }
  };
}

/**
 * Die Farbliste getrennt vom Zeichnen füllen: Der erste Abruf geht zu Rebrickable, der Dialog steht derweil
 * offen. Scheitert er, bleibt die aktuelle Farbe als einzige Wahl — besser als eine Liste ohne sie.
 * @param {number} aktuell
 */
async function fuelleFarbwahl(aktuell) {
  const sel = G('man-farb-wahl');
  if (!sel) return;
  const farben = await loadBrickColors();
  if (!farben?.length || !G('man-farb-wahl')) return;
  // data-name bleibt der englische Rebrickable-Name — er reist als color_name mit und wird für
  // BrickLink-Abgleiche gebraucht. Übersetzt wird nur der sichtbare Text, mit derselben Funktion wie im
  // Teile-Reiter (renderColorDropdown in minifigs.js).
  setzeHtml(
    sel,
    farben.map(
      c =>
        html`${html`<option value="${c.id}" data-name="${(c.name || '').replace(/"/g, '&quot;')}" `}${html`data-hex="${hexZiffern(c.hex)}"${Number(c.id) === Number(aktuell) ? ' selected' : ''}>`}${html`${colorName(c.name)}</option>`}`,
    ),
  );
  // Kennt die Liste die heutige Farbe nicht (ältere Bestände, eine Farbe, die Rebrickable zurückgezogen hat),
  // wäre sie nach dem Ersetzen verschwunden und die Auswahl stünde auf einer FREMDEN Farbe — ohne dass jemand
  // etwas geändert hätte. Dann kommt sie vorne wieder dazu.
  if (!farben.some(c => Number(c.id) === Number(aktuell))) {
    fuegeHtmlEin(sel, 'afterbegin', html`<option value="${Number(aktuell) || 0}" selected>${String(aktuell)}</option>`);
  }
}

/**
 * Die Farbe eines manuellen Teils ändern (die Regeln stehen in src/teile/teilFarbeAendern.ts). Danach öffnet
 * der Dialog mit der neuen Farbe: Sie ist Teil der Adresse, der alte Dialog zeigte ins Leere.
 * @this {unknown}
 */
async function speichereTeilFarbe() {
  const el =
    this instanceof HTMLSelectElement
      ? this
      : /** @type {HTMLSelectElement | null} */ (document.querySelector('#man-farb-wahl'));
  if (!el) return;
  const nummer = el.dataset.part ?? '';
  const alt = parseInt(el.dataset.color ?? '', 10) || 0;
  const neu = parseInt(el.value, 10);
  if (!Number.isFinite(neu) || neu === alt) return;
  const wahl = el.options[el.selectedIndex];
  const owner = el.dataset.owner;
  const d = await api(
    'PUT',
    `/v1/parts/${encodeURIComponent(nummer)}/${alt}/color${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`,
    { color_id: neu, color_name: wahl?.dataset.name || null, color_hex: wahl?.dataset.hex || null },
  );
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  // `bild` sagt, woher das Bild der neuen Farbe kommt (src/teile/teilFarbeAendern.ts).
  // null heisst: keines gefunden — dann steht nach dem Neuöffnen der Platzhalter da, und genau das war Marcos
  // Befund. Die Meldung sagt es, statt ihn ein zweites Mal vor einem leeren Platz stehen zu lassen.
  if (d.bild === null) toast(tRaw('parts.color.saved_no_image'), 'info');
  else toast(tRaw('settings.saved'), 'success');
  await loadManualParts().catch(() => {});
  if (aktiverReiter() === 'finance') loadFinance();
  await openManDetail('part', nummer, neu);
}

function closeManDetail() {
  G('man-detail-modal').classList.remove('open');
  _manItem = null;
}
G('man-detail-modal').addEventListener('click', e => e.target === e.currentTarget && closeManDetail());

/**
 * @param {string} delta
 */
function manQtyChange(delta) {
  const inp = G('man-det-qty');
  if (!inp) return;
  // parseInt auf delta: Seit der Umstellung auf data-arg kommt der Wert als Zeichenkette ("1"/"-1"). Ohne
  // Umwandlung wäre 1 + "1" die Zeichenkette "11" — aus einer 1 wurde beim Klick auf + eine 11.
  inp.value = String(Math.max(1, parseInt(inp.value || '1', 10) + (parseInt(delta, 10) || 0)));
  manQtySave();
}

async function manQtySave() {
  const inp = G('man-det-qty');
  if (!inp || !_manItem) return;
  const { type, id, colorId, owner } = _manItem;
  const qty = parseInt(inp.value, 10) || 1;
  if (type === 'fig') {
    await updateManualFig(id, { quantity: qty }, owner);
  } else {
    await updateManualPart(id, colorId, { quantity: qty }, owner);
  }

  // Die Erfassungsliste nach jeder Mengenänderung neu laden, in beide Richtungen: Beim Verringern entfernt
  // der Server Erfassungen (LIFO), und nur beim Erhöhen neu zu laden zeigte gelöschte Einträge weiter an.
  const acqUrl2 =
    type === 'fig'
      ? `/v1/minifigs/${encodeURIComponent(id)}/acquisitions`
      : `/v1/parts/${encodeURIComponent(id)}/${colorId}/acquisitions`;
  api('GET', acqUrl2)
    .then(ad2 => {
      const acqs2 = ad2?.acquisitions || [];
      const sumEl = G('man-acq-summary');
      if (sumEl) setzeHtml(sumEl, kurzfassungMan(acqs2, type, id, colorId));
      if (G('acq-modal').classList.contains('open')) renderManAcqBody(type, id, colorId, acqs2, ad2?.totals);
    })
    .catch(() => {});

  // Zwischenspeicher der Kacheln auffrischen
  if (type === 'fig') loadManualFigsTable();
  else loadManualParts();
}

// Öffnet den gemeinsamen Erfassungsdialog für manuelle Teile und Figuren
function openManAcqModal() {
  if (!_manItem) return;
  const { type, id, colorId } = _manItem;
  const title =
    type === 'fig'
      ? manuelleFiguren().find(f => f.fig_number === id)?.fig_name || id
      : manuelleTeile().find(p => p.part_number === id)?.part_name || id;
  G('acq-modal-tit').textContent = tRaw('detail.edit_prices');
  G('acq-modal-sub').textContent = title;
  setzeHtml(
    G('acq-modal-body'),
    html`<div data-stil="color:var(--mut);font-size:var(--fs-2)">${tRaw('common.loading')}</div>`,
  );
  G('man-detail-modal').classList.remove('open');
  gespeichert.clear();
  G('acq-modal').classList.add('open');
  // Das Schliessen führt zurück in diesen Dialog statt zum Set.
  erfassung.sn = null;
  const mi = _manItem;
  erfassung.zurueck = () => {
    if (mi.type === 'fig') loadManualFigsTable();
    else loadManualParts();
    openManDetail(mi.type, mi.id, mi.colorId);
  };
  loadManAcqModal(type, id, colorId);
}

/**
 * @param {string} type
 * @param {string} id
 * @param {number} colorId
 */
async function loadManAcqModal(type, id, colorId) {
  const url =
    type === 'fig'
      ? `/v1/minifigs/${encodeURIComponent(id)}/acquisitions`
      : `/v1/parts/${encodeURIComponent(id)}/${colorId}/acquisitions`;
  const ad = await api('GET', url).catch(() => null);
  // Wie im Set-Dialog: Ohne Mitgliederliste und ohne owner_user_id wüsste die Eigentümer-Auswahl nicht,
  // worauf sie steht.
  if (!erfassung.mitglieder.length) {
    const hm = await api('GET', '/v1/sets/household-members').catch(() => null);
    erfassung.mitglieder = hm?.members || [];
  }
  erfassung.besitzer = ad?.owner_user_id ?? ME?.id ?? null;
  renderManAcqBody(type, id, colorId, ad?.acquisitions || [], ad?.totals);
}

/**
 * @param {string} type
 * @param {string} id
 * @param {number} colorId
 * @param {Erfassung[]} acqs
 * @param {Erfassungssumme | undefined} totals
 */
function renderManAcqBody(type, id, colorId, acqs, totals) {
  // Derselbe Tabellenbauer, mit Speichern und Löschen je Art
  if (!acqs.length) {
    setzeHtml(
      G('acq-modal-body'),
      html`<div data-stil="color:var(--mut);font-size:var(--fs-3);padding:.5rem 0">—</div>`,
    );
    return;
  }
  let markup = html`<div class="tw"><table class="dt acq-tabelle" aria-label="${tRaw('detail.purchase_price')}">
    <thead><tr>
      <th>${tRaw('detail.qty')}</th><th>${tRaw('detail.added')}</th>
      <th>${tRaw('common.condition')}</th>
      <th class="zahl">${tRaw('figs.price_label')}</th>
      ${erfassung.mitglieder.length > 1 ? html`<th>${tRaw('household.owner')}</th>` : ''}
      <th><span class="vh">${tRaw('common.actions')}</span></th>
    </tr></thead><tbody>`;

  acqs.forEach(a => {
    const dateIso = isoTag(a.created_at);
    const t_ = type,
      i_ = id,
      c_ = colorId,
      ai_ = a.id;
    const args = `data-arg="${esc(t_)}" data-arg2="${esc(i_)}" data-arg3="${esc(c_)}" data-arg4="${ai_}"`;
    markup = html`${markup}${html`<tr id="acq-row-${ai_}">
      <td>
        <input class="acq-feld acq-menge" id="acq-menge-${ai_}" inputmode="numeric" type="number" min="1" value="${a.quantity}" aria-label="${tRaw('detail.qty')}"
          data-blur="manAcqSave" ${ungeprueft(args)} data-arg5="qty" data-val="1"
          data-keydown="blurOnEnter" />
      </td>
      <td>${datumFeld(`id="acq-datum-feld-${ai_}" data-change="manAcqSave" ${args} data-arg5="date" data-val="1"`, dateIso, `acq-datum-${ai_}`)}</td>
      <td>
        <select class="acq-feld" aria-label="${tRaw('common.condition')}" data-change="manAcqSave" ${ungeprueft(args)} data-arg5="cond" data-val="1">
          <option value="N" ${a.condition !== 'U' ? 'selected' : ''}>${tRaw('common.condition_new')}</option>
          <option value="U" ${a.condition === 'U' ? 'selected' : ''}>${tRaw('common.condition_used')}</option>
        </select>
      </td>
      <td class="zahl">
        <input class="acq-feld acq-preis" id="acq-preis-${ai_}" type="text" inputmode="decimal" autocomplete="off" value="${betragFuerFeld(a.unit_price)}" aria-label="${tRaw('detail.purchase_price')}"
          data-blur="manAcqSave" ${ungeprueft(args)} data-arg5="price" data-val="1"
          data-keydown="blurOnEnter" />
      </td>
      ${
        erfassung.mitglieder.length > 1
          ? html`<td>
        <select class="acq-feld" aria-label="${tRaw('household.owner')}" data-change="manAcqSave" ${ungeprueft(args)} data-arg5="owner" data-val="1">
          ${erfassung.mitglieder.map(m => html`<option value="${m.id}"${m.id === (a.owner_user_id ?? erfassung.besitzer) ? ' selected' : ''}>${m.username}</option>`)}
        </select>
      </td>`
          : ''
      }
      <td class="acq-aktion">
        ${gespeichertMarke(ai_)}
        <button class="acq-loeschen" data-click="manAcqDelete"${echt()} ${ungeprueft(args)}
          title="${tRaw('gallery.delete.title')}" aria-label="${tRaw('gallery.delete.title')}">${ico('loeschen')}</button>
      </td>
    </tr>`}`;
  });

  markup = html`${markup}${html`</tbody></table></div>`}`;
  markup = html`${markup}${acqSummary(totals)}`;
  setzeMitFokus(G('acq-modal-body'), markup);
}

/**
 * @param {string} type
 * @param {string} id
 * @param {number} colorId
 * @param {string} acqId
 * @param {string} field
 * @param {string} value
 */
async function manAcqSave(type, id, colorId, acqId, field, value) {
  try {
    const url =
      type === 'fig'
        ? `/v1/minifigs/${encodeURIComponent(id)}/acquisitions/${acqId}`
        : `/v1/parts/${encodeURIComponent(id)}/${colorId}/acquisitions/${acqId}`;
    /** @type {{ unit_price?: number | null, quantity?: number, date?: string, condition?: string, owner_user_id?: number }} */
    const body = {};
    if (field === 'price') {
      const preis = betragAusFeld(`acq-preis-${acqId}`);
      if (!preis.ok) return;
      body.unit_price = preis.wert;
    } else if (field === 'qty') {
      const menge = mengeAusFeld(`acq-menge-${acqId}`);
      if (!menge.ok) return;
      body.quantity = menge.wert;
    } else if (field === 'date') {
      if (!kaufdatumGueltig(`acq-datum-feld-${acqId}`)) return;
      body.date = value;
    } else if (field === 'owner') {
      // Eigentümerwechsel = Verschieben genau dieser Kaufpreis-Zeile. Ein manuell erfasstes Teil hat keinen
      // Inhalt — es wandern nur Menge und Erfassung (src/sets/setMove.ts, moveManualAcquisition). KEIN
      // from_user_id: Den Absender ermittelt der Server aus der Zeile selbst (umzugsQuelle) — hier
      // stand der Betrachter, siehe acqSave().
      body.owner_user_id = parseInt(value, 10);
    } else body.condition = value;
    const d = await api('PUT', url, body);
    if (!d?.success) {
      toast(d?.error || t('settings.error'), 'error');
      if (field === 'date' || field === 'owner') await loadManAcqModal(type, id, colorId);
      return;
    }
    zeigeGespeichert(acqId);
    if (field === 'owner') {
      // Danach stimmt fast nichts mehr auf dem Schirm: Mengen, Summen, Besitzer-Plaketten. Lieber neu laden
      // als vier Stellen nachziehen.
      toast(tRaw('household.owner_moved', { parts: 0, figs: 0 }), 'success');
      closeAcqModal();
      closeManDetail();
      if (type === 'fig') loadManualFigsTable();
      else loadManualParts();
      return;
    }
    // Dialog neu laden bei Preis (geholter Marktpreis), Menge (neue Zeile möglich) oder Datum (Reihenfolge)
    if ((field === 'price' && (value === '' || value === null)) || field === 'qty' || field === 'date') {
      await loadManAcqModal(type, id, colorId);
    }
    // Kachel immer auffrischen, damit Plakette und Preis stimmen
    if (type === 'fig') loadManualFigsTable();
    else loadManualParts();
  } catch (e) {
    console.error('[manAcqSave]', e);
    toast(tRaw('settings.error'), 'error');
  }
  // Marktpreis-Zeilen nachladen: Wird erstmals ein Kaufpreis in einem Zustand erfasst, entsteht dafür eine
  // neue Zeile.
  const mi = _manItem;
  if (mi) {
    const u =
      mi.type === 'fig'
        ? `/v1/minifigs/${encodeURIComponent(mi.id)}/price-history`
        : `/v1/parts/${encodeURIComponent(mi.id)}/${mi.colorId || 0}/price-history`;
    api('GET', u)
      .then(ph => renderMarketRows(ph, 'man-market-rows'))
      .catch(() => {});
  }
}

/**
 * @param {string} type
 * @param {string} id
 * @param {number} colorId
 * @param {string} acqId
 */
async function manAcqDelete(type, id, colorId, acqId) {
  if (!(await confirmDelete(tRaw('acq.delete_title'), tRaw('acq.delete_text'), 'loeschen'))) return;
  const delUrl =
    type === 'fig'
      ? `/v1/minifigs/${encodeURIComponent(id)}/acquisitions/${acqId}`
      : `/v1/parts/${encodeURIComponent(id)}/${colorId}/acquisitions/${acqId}`;
  const listUrl =
    type === 'fig'
      ? `/v1/minifigs/${encodeURIComponent(id)}/acquisitions`
      : `/v1/parts/${encodeURIComponent(id)}/${colorId}/acquisitions`;
  const d = await api('DELETE', delUrl);
  if (!d.success) {
    toast(tRaw('settings.error'), 'error');
    return;
  }
  // Mengenfeld im Detaildialog nachführen
  const qEl = G('man-det-qty');
  if (qEl && d.new_quantity !== undefined) qEl.value = d.new_quantity;
  const ad = await api('GET', listUrl).catch(() => null);
  const acqs = ad?.acquisitions || [];
  // Zusammenfassung im Detaildialog auffrischen
  const sumEl = G('man-acq-summary');
  if (sumEl) setzeHtml(sumEl, kurzfassungMan(acqs, type, id, colorId));
  if (!acqs.length) {
    closeAcqModal();
    return;
  }
  renderManAcqBody(type, id, colorId, acqs, ad?.totals);
  if (type === 'fig') loadManualFigsTable();
  else loadManualParts();
}

// Open modal: show price history sparkline

// ── Handler beim Dispatcher anmelden (siehe js/registry.js) ──────────────
registerActions({
  closeManDetail,
  manAcqDelete,
  manAcqSave,
  manQtyChange,
  manQtySave,
  openManAcqModal,
  openManDetail,
  speichereTeilFarbe,
});
