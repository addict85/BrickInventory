import { echt, registerActions } from './00-registry.js';
import { t, tRaw } from '../i18n.js';
import { esc, html } from './00-escapen.js';
import { api } from './01-api.js';
import { ico, G, setzeHtml } from './01-dom.js';
import { betragFuerFeld } from './01-format.js';
import { betragAusFeld, mengeAusFeld, kaufdatumGueltig } from './01-formular.js';
import { toast } from './01-meldungen.js';
import { applySetAggregate, loadGallery } from './02-gallery.js';
import { loadFinance } from './04-finance.js';
import { CURRENCY, ME, curSet } from './00-zustand.js';
import { closeModal } from './02-detailfelder.js';
import { confirmDelete } from './01-rueckfrage.js';
import { acqSummary, summenText, umgerechnetText, kurzfassung } from './13-kaufpreis-anzeige.js';
export { erfassungsPreis, renderAcquisitionSummary } from './13-kaufpreis-anzeige.js';
import { renderMarketRows } from './01-diagramme.js';
import { erfassung, gespeichert, setzeMitFokus, isoTag, datumFeld, gespeichertMarke, zeigeGespeichert } from './13-erfassung-zustand.js';
// Kaufpreis-Modal und Detailfenster für manuelle Einträge: Beides ist Erfassung, keine Administration, und
// gehört deshalb nicht nach 07-admin.js.
// Ausführlich: docs/begruendungen/public/js/13-acquisition-modals.js.md#diese-708-zeilen-standen-in-js-07-admin
/** @typedef {import('../../frontend-typen/vertrag').HouseholdMember} Konto */
/** @typedef {import('../../frontend-typen/vertrag').AcquisitionTotals} Erfassungssumme */
/** @typedef {import('../../frontend-typen/vertrag').Acquisition} Erfassung */

// ── KAUFPREIS-MODAL ─────────────────────────────────────────────────────────
/**
 * @param {string} sn
 */
export function openAcqModal(sn) {
  erfassung.sn = sn;
  // Header
  G('acq-modal-tit').textContent = tRaw('detail.purchase_price');
  G('acq-modal-sub').textContent = sn + (curSet?.name ? ' – ' + curSet.name : '');
  setzeHtml(G('acq-modal-body'), html`<div data-stil="color:var(--mut);font-size:var(--fs-2)">${tRaw('common.loading')}</div>`);
  G('set-modal').classList.remove('open');
  gespeichert.clear();
  G('acq-modal').classList.add('open');
  loadAcqModal(sn);
}

// Ein Klick auf den Hintergrund schliesst über closeAcqModal(), die einzige Fassung mit der Rückkehr-Logik
// für Set und manuellen Eintrag.
// Ausführlich: docs/begruendungen/public/js/13-acquisition-modals.js.md#acq-modal
G('acq-modal').addEventListener('click', e => e.target === e.currentTarget && closeAcqModal());


/**
 * Summe nach jedem Speichern nachziehen: Sie stand bis zum erneuten Öffnen auf dem alten Wert.
 * @param {string} sn
 */
async function aktualisiereSumme(sn) {
  const ad = await api('GET', `/v1/sets/${sn}/acquisitions`);
  if (!ad?.success || erfassung.sn !== sn) return;
  const preis = G('acq-total-price'), menge = G('acq-total-qty');
  if (preis) preis.textContent = summenText(ad.totals);
  if (menge) menge.textContent = String(ad.totals?.quantity ?? 0);
  const hinweis = G('acq-summe-hinweis');
  if (hinweis) { hinweis.hidden = !ad.totals?.ohne_kurs; hinweis.textContent = ad.totals?.ohne_kurs ? tRaw('acq.ohne_kurs', { n: ad.totals.ohne_kurs }) : ''; }
  for (const a of ad.acquisitions || []) {
    const um = G(`acq-um-${a.id}`);
    if (um) um.textContent = umgerechnetText(a, ad.totals);
  }
}

/**
 * @param {string} sn
 */
async function loadAcqModal(sn) {
  const ad = await api('GET', `/v1/sets/${sn}/acquisitions`).catch(()=>null);
  const acqs = ad?.acquisitions || [];
  if (!erfassung.mitglieder.length) {
    const hm = await api('GET', '/v1/sets/household-members').catch(() => null);
    erfassung.mitglieder = hm?.members || [];
  }
  erfassung.besitzer = ad?.owner_user_id ?? ME?.id ?? null;
  renderAcqModalBody(sn, acqs, ad?.totals);
}

/**
 * @param {string} sn
 * @param {Erfassung[]} acqs
 * @param {Erfassungssumme | undefined} totals
 */
export function renderAcqModalBody(sn, acqs, totals) {
  if (!acqs.length) {
    setzeHtml(G('acq-modal-body'), html`<div data-stil="color:var(--mut);font-size:var(--fs-3);padding:.5rem 0">—</div>`);
    return;
  }
  let markup = html`<div class="tw"><table class="dt acq-tabelle" aria-label="${tRaw('detail.purchase_price')}">
    <thead>
      <tr>
        <th>${tRaw('detail.qty')}</th>
        <th>${tRaw('detail.added')}</th>
        <th>${tRaw('common.condition')}</th>
        <th class="zahl">${tRaw('detail.purchase_price')}</th>
        ${erfassung.mitglieder.length > 1 ? html`<th>${tRaw('household.owner')}</th>` : ''}
        <th><span class="vh">${tRaw('common.actions')}</span></th>
      </tr>
    </thead>
    <tbody>`;

  acqs.forEach(a => {
    const dateIso = isoTag(a.created_at);
    markup = html`${markup}${html`<tr id="acq-row-${a.id}">
      <td>
        <input class="acq-feld acq-menge" id="acq-menge-${a.id}" inputmode="numeric" type="number" min="1" value="${a.quantity}" aria-label="${tRaw('detail.qty')}"
          data-blur="acqSave" data-arg="${sn}" data-arg2="${a.id}" data-arg3="qty" data-val="1"
          data-keydown="blurOnEnter" />
      </td>
      <td>${datumFeld(`id="acq-datum-feld-${a.id}" data-change="acqSave" data-arg="${esc(sn)}" data-arg2="${a.id}" data-arg3="date" data-val="1"`, dateIso, `acq-datum-${a.id}`)}</td>
      <td>
        <select class="acq-feld" aria-label="${tRaw('common.condition')}" data-change="acqSave" data-arg="${sn}" data-arg2="${a.id}" data-arg3="cond" data-val="1">
          <option value="N" ${a.condition!=='U' ? 'selected' : ''}>${tRaw('common.condition_new')}</option>
          <option value="U" ${a.condition==='U' ? 'selected' : ''}>${tRaw('common.condition_used')}</option>
        </select>
      </td>
      <td class="zahl">
        <span class="acq-preisfeld"><input class="acq-feld acq-preis" id="acq-preis-${a.id}" type="text" inputmode="decimal" autocomplete="off" value="${betragFuerFeld(a.purchase_price)}" aria-label="${tRaw('detail.purchase_price')} (${a.currency || totals?.currency || CURRENCY})"
          data-blur="acqSave" data-arg="${sn}" data-arg2="${a.id}" data-arg3="price" data-val="1"
          data-keydown="blurOnEnter" /><span class="acq-waehrung" aria-hidden="true">${a.currency || totals?.currency || CURRENCY}</span></span>
        <span class="acq-umgerechnet" id="acq-um-${a.id}">${umgerechnetText(a, totals)}</span>
      </td>
      ${erfassung.mitglieder.length > 1 ? html`<td>
        <select class="acq-feld" aria-label="${tRaw('household.owner')}" data-change="acqSave" data-arg="${sn}" data-arg2="${a.id}" data-arg3="owner" data-val="1">
          ${erfassung.mitglieder.map(m => html`<option value="${m.id}"${m.id === (a.owner_user_id ?? erfassung.besitzer) ? ' selected' : ''}>${m.username}</option>`)}
        </select>
      </td>` : ''}
      <td class="acq-aktion">
        ${gespeichertMarke(a.id)}
        <button class="acq-loeschen" data-click="acqDelete"${echt()} data-arg="${sn}" data-arg2="${a.id}"
          title="${tRaw('gallery.delete.title')}" aria-label="${tRaw('gallery.delete.title')}">${ico('loeschen')}</button>
      </td>
    </tr>`}`;
  });

  markup = html`${markup}${html`</tbody></table></div>`}`;

  // Summenzeile: Der Server rechnet sie (acquisitionTotals in src/bestand/acquisitions.ts) und liefert sie
  // als `totals` mit. Vorher stand die Rechnung hier und noch dreimal woanders — zweimal in dieser Datei,
  // zweimal in der App, und mit verschiedenen Preisfeldern.
  markup = html`${markup}${acqSummary(totals)}`;

  setzeMitFokus(G('acq-modal-body'), markup);
}

/**
 * @param {string} sn
 * @param {string} id
 * @param {string} field
 * @param {string} value
 */
async function acqSave(sn, id, field, value) {
  /** @type {{ purchase_price?: number | null, quantity?: number, date?: string, condition?: string, owner_user_id?: number }} */
  const body = {};
  if (field === 'price') {
    const preis = betragAusFeld(`acq-preis-${id}`);
    if (!preis.ok) return;
    body.purchase_price = preis.wert;
  } else if (field === 'qty') {
    const menge = mengeAusFeld(`acq-menge-${id}`); if (!menge.ok) return; body.quantity = menge.wert;
  } else if (field === 'date') {
    if (!kaufdatumGueltig(`acq-datum-feld-${id}`)) return;
    body.date = value;
  } else if (field === 'owner') {
    // Eigentümerwechsel verschiebt genau diese Kaufpreis-Zeile, ohne from_user_id: Den Absender kennt der
    // Server aus der Zeile. Mit dem Betrachter als Absender fand er Zeilen von Unterkonten nicht (404).
    // Ausführlich: docs/begruendungen/public/js/13-acquisition-modals.js.md#eigentuemerwechsel-verschieben-genau-die
    body.owner_user_id = parseInt(value);
  } else {
    body.condition = value;
  }
  const d = await api('PUT', `/v1/sets/${sn}/acquisitions/${id}`, body);
  if (field === 'owner') {
    if (!d.success) { toast(d.error || t('settings.error'), 'error'); loadAcqModal(sn); return; }
    // Nach einem Wechsel stimmt fast alles auf dem Schirm nicht mehr: Mengen, Summen, Besitzer-Plaketten.
    // Lieber neu laden als vier Stellen einzeln nachziehen.
    toast(tRaw(d.source_emptied ? 'household.move_ok' : 'household.owner_moved',
      { parts: d.parts ?? 0, figs: d.minifigs ?? 0 }), 'success');
    // restore: Ohne das landet der Nutzer nach dem Wechsel wieder bei Seite 1; so bleiben Position und
    // geladene Tiefe erhalten.
    closeAcqModal(); closeModal(); loadGallery({ restore: true });
    return;
  }
  // Der Server liefert das neu berechnete Zustands-Aggregat mit — direkt in die Galerie-Liste schreiben,
  // damit die Kachel ohne Neuladen stimmt.
  applySetAggregate(d.set);
  if (!d.success) {
    toast(d.error || t('settings.error'), 'error');
    if (field === 'date') loadAcqModal(sn); // abgelehnte Eingabe auf gespeicherten Wert zurücksetzen
    return;
  }
  zeigeGespeichert(id);
  if (field === 'price') { const f = G(`acq-preis-${id}`); if (f && f !== document.activeElement) f.value = betragFuerFeld(body.purchase_price); }
  aktualisiereSumme(sn);
  // Marktpreis-Zeilen neu holen.
  //
  // Wird erstmals ein Kaufpreis in einem Zustand erfasst, entsteht dafür eine NEUE Zeile (der Server liefert
  // by_condition nur für Zustände mit Erfassung). Ohne dieses Nachladen erschiene sie erst beim nächsten
  // Öffnen des Dialogs.
  api('GET', `/v1/sets/${sn}/price-history`).then(renderMarketRows).catch(()=>{});

  // Galerie und Finanzen mitziehen: Kaufpreis und Menge wirken auf die Kachel und die Auswertung, die sonst
  // bis zum Neuladen alt blieben. restore, damit der Wechsel nicht die gescrollte Tiefe kostet.
  // Ausführlich: docs/begruendungen/public/js/13-acquisition-modals.js.md#loadgallery
  loadGallery({ restore: true });
  loadFinance();

  // Datum geändert → Reihenfolge/Summary neu laden
  if (field === 'date') {
    loadAcqModal(sn);
    api('GET', `/v1/sets/${sn}/acquisitions`).then(ad => {
      if (ad?.success && curSet?.set_number === sn) {
        const summaryEl = G('m-acq-summary');
        if (summaryEl) setzeHtml(summaryEl, kurzfassung(ad.acquisitions, sn));
      }
    }).catch(()=>{});
    return;
  }
  // War der Preis leer, hat der Server den Marktpreis geholt; neu laden, um ihn zu zeigen
  if (field === 'price' && (value === '' || value === null)) {
    loadAcqModal(sn);
    return;
  }
  // Zusammenfassung im Detail-Dialog nachziehen. Das Zustands-Aggregat kommt inzwischen aus der PUT-Antwort
  // (applySetAggregate oben) — hier wird nur noch die Erfassungsliste neu gerendert.
  if (field === 'cond') {
    api('GET', `/v1/sets/${sn}/acquisitions`).then(ad => {
      if (!ad?.success) return;
      const sumEl = G('m-acq-summary');
      if (sumEl) setzeHtml(sumEl, kurzfassung(ad.acquisitions, sn));
    }).catch(()=>{});
  }
  // Menge geändert: ganzen Dialog neu laden (Zusammenfassung, Menge im Set-Detail)
  if (field === 'qty') {
    loadAcqModal(sn);
    // Auch die Zusammenfassung im Set-Detail auffrischen
    api('GET', `/v1/sets/${sn}/acquisitions`).then(ad => {
      if (ad.success && curSet?.set_number === sn) {
        const summaryEl = G('m-acq-summary');
        if (summaryEl) setzeHtml(summaryEl, kurzfassung(ad.acquisitions, sn));
      }
    }).catch(()=>{});
    return;
  }
}

/**
 * @param {string} sn
 * @param {string} id
 */
async function acqDelete(sn, id) {
  if (!await confirmDelete(tRaw('acq.delete_title'), tRaw('acq.delete_text'), 'loeschen')) return;
  const d = await api('DELETE', `/v1/sets/${sn}/acquisitions/${id}`);
  if (!d.success) { toast(tRaw('settings.error'), 'error'); return; }
  // curSet und das Mengenfeld im Set-Detail nachführen
  if (curSet?.set_number === sn) {
    curSet.quantity = /** @type {number} */ (d.new_quantity);
    const qEl = G('m-qty');
    if (qEl) qEl.value = String(d.new_quantity);
  }
  // Erfassungsdialog neu laden
  const ad = await api('GET', `/v1/sets/${sn}/acquisitions`).catch(()=>null);
  if (!ad?.acquisitions?.length) { closeAcqModal(); return; }
  renderAcqModalBody(sn, ad.acquisitions, ad.totals);
  // Kurzübersicht im Set-Detail auffrischen
  const dvEl = G('m-acq-summary');
  if (dvEl) setzeHtml(dvEl, kurzfassung(ad.acquisitions, sn));
  // Wie in acqSave(): Eine gelöschte Erfassung verändert Bestand und Wert — und lässt eine Zustands-Zeile
  // verschwinden, wenn es die letzte war.
  api('GET', `/v1/sets/${sn}/price-history`).then(renderMarketRows).catch(()=>{});
  loadGallery({ restore: true });
  loadFinance();
}

export function closeAcqModal() {
  G('acq-modal').classList.remove('open');
  if (erfassung.zurueck) {
    const zurueck = erfassung.zurueck;
    erfassung.zurueck = null;
    zurueck();
  } else if (erfassung.sn) {
    const sn = erfassung.sn;
    G('set-modal').classList.add('open');
    api('GET', `/v1/sets/${sn}/acquisitions`).then(ad => {
      if (!ad?.success) return;
      const sumEl = G('m-acq-summary');
      // Der Neuaufbau ersetzt den Knopf, auf den die Dialogverwaltung den Fokus zurückgab; ohne das stünde
      // er danach auf der Dialogfläche.
      const aktiv = document.activeElement;
      const hatteFokus = !aktiv || aktiv === document.body || !!sumEl?.contains(aktiv) || aktiv.matches('#set-modal > .modal');
      if (sumEl) setzeHtml(sumEl, kurzfassung(ad.acquisitions, sn));
      if (hatteFokus) /** @type {HTMLElement | null} */ (sumEl?.querySelector('[data-click="openAcqModal"]'))?.focus({ preventScroll: true });
      const total = ad.totals?.quantity ?? 0;
      const qEl = G('m-qty');
      if (qEl && total > 0) { qEl.value = String(total); if(curSet) curSet.quantity = total; }
    }).catch(()=>{});
  }
}

// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
registerActions({
  acqDelete,
  acqSave,
  closeAcqModal,
  openAcqModal,
});
