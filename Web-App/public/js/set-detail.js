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
import { meldeAmFeld, toast, verwirfToasts } from './meldungen.js';
import { geloeschtMitRueckgaengig } from './papierkorb.js';
import { alarmBlock, closeModal, ladeAlarm, ladeOrtAuswahl, lagerortBlock, setzeAlarmFeld } from './detailfelder.js';
import { confirmDelete } from './rueckfrage.js';
import { delSet, loadGallery, loadStats, reimportParts } from './gallery.js';
import { detailZeile, kontoAnzeige, oderStrich, skelettZeilen, oeffneErfassen } from './bausteine.js';
import { diagrammBreite, priceChartSVG, renderMarketRows } from './diagramme.js';
import { loadFinance } from './finance.js';
import { locale, t, tRaw } from '../i18n.js';
import { openAcqModal, renderAcqModalBody } from './acquisition-modals.js';
import { kurzfassung, renderAcquisitionSummary } from './kaufpreis-anzeige.js';

// Verschoben wird nur über den Kaufpreis (Kaufpreis-Dialog, Zeile für Zeile), nicht das ganze Set: Mehrere
// Käufe eines Sets können im Haushalt verschiedenen Konten gehören. Der Server verlangt dafür
// acquisition_ids.
let _detailLauf = 0;

/** Konten, für die dieses Konto schreiben darf (Server: haushaltsMitglieder); null = noch nicht geladen.
 * @type {number[] | null} */
let _schreibbar = null;

/** Im Haushalt: Gehört das Set (auch) einem anderen Konto? @param {import('../../frontend-typen/vertrag').SetItem | null} set */
const imHaushalt = set => (set?.owners || []).some(o => !ME || o.id !== ME.id);

/** Ein Name für die Oberfläche: das eigene Konto heisst „ich“. @param {{ id: number, username: string }} o */
const kontoName = kontoAnzeige;

/**
 * Menge je Konto aus den Erfassungen; das eigene Konto zuerst. Im Haushalt hat jedes Konto seinen Regler: Eine
 * Gesamtzahl mit „−“ nahm still den Kauf des eigenen Kontos weg, auch wenn man den des anderen meinte.
 * @param {import('../../frontend-typen/vertrag').SetItem} set @param {import('../../frontend-typen/vertrag').Acquisition[]} acqs
 */
function mengenJeKonto(set, acqs) {
  const besitzer = set.owners?.length ? set.owners : ME ? [{ id: ME.id, username: ME.username }] : [];
  return besitzer
    .map(o => ({
      ...o,
      menge: acqs.filter(a => (a.owner_user_id ?? ME?.id) === o.id).reduce((s, a) => s + (a.quantity || 0), 0),
    }))
    .sort((a, b) => Number(b.id === ME?.id) - Number(a.id === ME?.id));
}

/**
 * Ohne Haushalt das bekannte Feld; im Haushalt eine Zeile je Konto (Regler nur, wo geschrieben werden darf).
 * „−“ beim letzten Exemplar des ganzen Sets fehlt: Das ist Löschen und geht über „Löschen“.
 * @param {import('../../frontend-typen/vertrag').SetItem} set @param {import('../../frontend-typen/vertrag').Acquisition[]} acqs
 */
function mengenBlock(set, acqs) {
  if (!imHaushalt(set))
    return html`<span class="menge-regler" data-rueckmeldung>
      <button class="btn bs btn-sm detail-knopf menge-knopf" data-click="mQtyDec" aria-label="${tRaw('detail.qty_less')}">−</button>
      <input inputmode="numeric" type="number" id="m-qty" min="1" class="detail-feld menge-feld" aria-label="${tRaw('detail.qty')}" data-change="autosaveSet" />
      <button class="btn bs btn-sm detail-knopf menge-knopf" data-click="mQtyInc" aria-label="${tRaw('detail.qty_more')}">+</button>
      <span class="feld-status" role="status"></span></span>`;
  const konten = mengenJeKonto(set, acqs);
  const gesamt = konten.reduce((s, k) => s + k.menge, 0);
  const zeilen = konten.map(k => {
    const darf = !_schreibbar || _schreibbar.includes(k.id);
    const name = kontoName(k);
    const knopf = (/** @type {number} */ schritt, /** @type {string} */ zeichen, /** @type {string} */ was) =>
      html`<button class="btn bs btn-sm detail-knopf menge-knopf" data-click="mengeJeKonto" data-arg="${k.id}" data-arg2="${schritt}" aria-label="${tRaw(was)}: ${name}"${schritt < 0 && (k.menge === 0 || gesamt <= 1) ? ' disabled' : ''}>${zeichen}</button>`;
    return html`<div class="menge-konto" data-konto="${k.id}">
      <span class="menge-name">${name}</span>
      ${darf ? knopf(-1, '−', 'detail.qty_less') : ''}<span class="menge-zahl">${k.menge}</span>${darf ? knopf(1, '+', 'detail.qty_more') : ''}
    </div>`;
  });
  return html`<div class="menge-konten" data-rueckmeldung>${zeilen}
    <div class="menge-gesamt">${tRaw('detail.qty_zusammen', { n: gesamt })}</div>
    <span class="feld-status" role="status"></span></div>`;
}

/** Kopfzeile: Nummer und, im Haushalt, ALLE Besitzer — nur das fremde Konto zu nennen las sich, als gehöre
 * das Set dem anderen allein. @param {import('../../frontend-typen/vertrag').SetItem} set */
function untertitel(set) {
  const konten = imHaushalt(set)
    ? (set.owners || []).slice().sort((a, b) => Number(b.id === ME?.id) - Number(a.id === ME?.id))
    : [];
  // Nur die Setnummer in Festbreite; die Konten sind Fliesstext wie überall.
  const nr = set.name ? html`<span class="setnr">${set.set_number}</span>` : '';
  const wem = konten.length
    ? tRaw(konten.length > 1 ? 'detail.konten_von' : 'detail.konto_von', { namen: konten.map(kontoName).join(', ') })
    : '';
  return html`${nr}${nr && wem ? ' · ' : ''}${wem}`;
}

/** Inhalt des Set-Dialogs aus curSet und den Erfassungen: Wert und Verlauf links unter dem Bild, die Angaben
 * rechts. @param {string} sn @param {import('../../frontend-typen/vertrag').Acquisition[]} acqs */
function setDetailHtml(sn, acqs) {
  const set = curSet;
  if (!set) return null;
  const addedFmt = set.added_at ? fmtDatum(set.added_at) : '—';
  // Marktpreis und Entwicklung je Zustand, aus derselben Abfrage wie der Preisverlauf; hier nur der
  // Platzhalter. Ein Wert fürs ganze Set vermischte neu und gebraucht.
  const priceRow = html`<div class="m-wertkopf" id="m-market-rows" data-kopf="1" role="group" aria-label="${tRaw('detail.wert')}"><div class="skelett-zeile"></div><div class="skelett-zeile kurz"></div></div>`;
  const pnlRow = '';
  const qtyRow = detailZeile(t('detail.qty'), mengenBlock(set, acqs), {
    zeilenStil: 'align-items:flex-start',
    wertId: 'm-menge',
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
    },
  );

  const links = html`${priceRow}${pnlRow}
    <div id="m-price-chart">
      <h3 class="bereich-titel" data-stil="margin-bottom:4px">${tRaw('detail.price_history')}</h3>
      <div class="sparkline-wrap" id="m-sparkline-content"><span data-stil="color:var(--mut);font-size:var(--fs-1)">${tRaw('common.loading')}</span></div>
    </div>`;
  // Die Figurenzahl kommt wie in der Tabelle aus dem Katalog: Die eigene Figurenliste zählt nur, was ein
  // Teileimport übernommen hat, und zeigte so für dasselbe Set eine andere Zahl.
  const rechts = html`
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
    ${detailZeile(
      t('detail.created'),
      html`${ico('kalender')} ${addedFmt} <span class="text-klein">(${tRaw('detail.created_hint')})</span>`,
      { klasse: 'dr-leise' },
    )}`;
  return { links, rechts };
}

/** Preisverlauf nachladen, ohne den Dialog aufzuhalten.
 * @param {string} sn @param {import('../../frontend-typen/vertrag').Acquisition[]} acqs */
function ladeSetNachtraege(sn, acqs) {
  const preise = (/** @type {string} */ z) =>
    new Set(acqs.filter(a => a.condition === z && a.purchase_price != null).map(a => a.unit_price ?? a.purchase_price));
  const mittel = new Set(['N', 'U'].filter(z => preise(z).size > 1));
  // Die Antwort kann nach dem Schliessen oder einem Setwechsel kommen; dann gehört sie nicht in den Dialog.
  api('GET', `/v1/sets/${sn}/price-history`).then(ph => {
    if (!curSet || curSet.set_number !== sn) return;
    renderMarketRows(ph);
    const el = G('m-sparkline-content');
    if (!el) return;
    // Beide Zustände in EINEM Diagramm — siehe priceChartSVG().
    setzeHtml(
      el,
      ph.success
        ? priceChartSVG(ph, sn.replace(/[^a-zA-Z0-9]/g, ''), diagrammBreite(el), mittel)
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
  G('m-det-links')?.replaceChildren();
  G('m-instr').replaceChildren();
  G('set-modal').dataset.nummer = sn;
  G('set-modal').classList.add('open');
  const [d, ad, hm] = await Promise.all([
    api('GET', `/v1/sets/${sn}`),
    api('GET', `/v1/sets/${sn}/acquisitions`).catch(() => null),
    _schreibbar ? null : api('GET', '/v1/sets/household-members').catch(() => null),
  ]);
  if (hm?.success) _schreibbar = hm.members.map(m => m.id);
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
  setzeHtml(G('m-untertit'), untertitel(set));
  // fullUrl(): volle Auflösung, auch wenn image_local auf die _thumb-Datei zeigt
  const img = G('m-img');
  setzeDialogbild(img, fullUrl(set.image_local || set.image_url) || PLATZHALTER_SET, PLATZHALTER_SET);
  img.style.display = 'block';

  const inhalt = setDetailHtml(sn, ad?.acquisitions || []);
  setzeHtml(G('m-det-links'), inhalt ? inhalt.links : '');
  setzeHtml(G('m-det'), inhalt ? inhalt.rechts : '');

  const feld = G('m-qty');
  if (feld) feld.value = String(set.quantity);

  renderInstructions(set.instructions || [], sn);
  // Ab hier meinen die Alarm-Handler DIESEN Dialog.
  setzeAlarmFeld('m');
  G('set-modal').classList.add('open');
  ladeAlarm(sn).catch(() => {});
  // Die Auswahlliste gehört dem BESITZER des Sets, nicht dem Betrachter — Begründung an ladeOrtAuswahl().
  ladeOrtAuswahl(set.owners).catch(() => {});

  ladeSetNachtraege(sn, ad?.acquisitions || []);
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
      // anleitungenZusammenlegen in src/katalog/instructions.ts). Vorher stand die Regel hier als Pfadvergleich — eine
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
  _autosaveTimer = setTimeout(() => {
    if (!curSet) return;
    const qty = parseInt(G('m-qty').value, 10) || 1;
    aendereMenge({ quantity: qty }, qty - (curSet.quantity || qty), G('m-qty'));
  }, 400);
}

/** Der Regler eines Kontos im Haushalt: ein Schritt, relativ, für genau dieses Konto.
 * @param {string} konto @param {string} schritt */
function mengeJeKonto(konto, schritt) {
  const id = Number(konto),
    n = Number(schritt);
  if (!curSet || !Number.isInteger(id) || !n) return;
  const knopf = document.querySelector(`#m-menge [data-konto="${id}"] [data-arg2="${n}"]`);
  aendereMenge({ quantity_delta: n, ...(id === ME?.id ? {} : { owner_user_id: id }) }, n, knopf);
}

/**
 * Speichern, dann alles im Detail neu laden, was von der Menge abhängt (Regler, Kaufpreise, Wertkopf mit G&V
 * und die Kaufpreis-Linie im Diagramm). Eine Verringerung nennt den Kauf, der entfiel, und bietet Rückgängig
 * wie das Löschen; eine Erhöhung nennt den geschätzten Preis.
 * @param {{ quantity?: number, quantity_delta?: number, owner_user_id?: number }} body @param {number} schritt
 * @param {Element | null} feld
 */
async function aendereMenge(body, schritt, feld) {
  const set = curSet;
  if (!set || !schritt) return;
  const sn = set.set_number;
  const d = await api('PUT', `/v1/sets/${esc(sn)}`, body);
  if (!d.success) {
    toast(d.error || t('settings.error'), 'error');
    return;
  }
  // Gespeichert, aber ohne Marktpreis für die neue Erfassung: Er kommt mit dem Preislauf nach.
  if (d.degradiert?.includes('kaufpreis')) toast(tRaw('set.kaufpreis_folgt'), 'info');
  if (d.entfallen?.length) meldeEntfallen(sn, d, body.owner_user_id);
  const ad = await frischeDetailAuf(sn, feld);
  if (schritt > 0 && ad) meldeNeueExemplare(sn, ad.acquisitions, schritt);
  loadGallery();
  if (aktiverReiter() === 'finance') loadFinance();
}

/** „Kauf vom 13.09.2026 (250,00 €) entfernt“ mit Rückgängig; der Kauf liegt im Papierkorb.
 * @param {string} sn @param {import('../../frontend-typen/vertrag').MengeGeaendert} d @param {number} [konto] */
function meldeEntfallen(sn, d, konto) {
  const weg = d.entfallen || [];
  const k = weg[0];
  const preis = k?.purchase_price != null ? ` (${fmtGeld(k.purchase_price, k.currency || CURRENCY)})` : '';
  const wem = konto ? (curSet?.owners || []).find(o => o.id === konto) : null;
  const text =
    weg.length === 1 && k
      ? tRaw('detail.kauf_entfernt', { datum: fmtDatum(k.date || ''), preis })
      : tRaw('detail.kaeufe_entfernt', { n: weg.length });
  const ids = typeof d.papierkorb === 'number' ? [d.papierkorb] : d.papierkorb || [];
  geloeschtMitRueckgaengig(wem ? `${text} · ${kontoName(wem)}` : text, { papierkorb: ids }, () => {
    if (curSet?.set_number === sn) frischeDetailAuf(sn, null);
  });
}

/**
 * Set und Erfassungen neu holen und den Mengenblock, die Kaufpreise, die Kopfzeile und den Wertkopf samt
 * Diagramm neu zeichnen. Der Fokus bleibt auf dem gedrückten Knopf, die Rückmeldung steht am Feld.
 * @param {string} sn @param {Element | null} feld
 */
async function frischeDetailAuf(sn, feld) {
  const [d, ad] = await Promise.all([
    api('GET', `/v1/sets/${esc(sn)}`),
    api('GET', `/v1/sets/${esc(sn)}/acquisitions`).catch(() => null),
  ]);
  if (!d?.success || !d.set || curSet?.set_number !== sn || !G('set-modal').classList.contains('open')) return ad;
  set_curSet(d.set);
  const acqs = ad?.acquisitions || [];
  const fokus = feld && feld === document.activeElement ? feld : null;
  const menge = G('m-menge');
  if (menge) setzeHtml(menge, mengenBlock(d.set, acqs));
  const feldNeu = G('m-qty');
  if (feldNeu) feldNeu.value = String(d.set.quantity);
  const sumEl = G('m-acq-summary');
  if (sumEl) setzeHtml(sumEl, kurzfassung(acqs, sn));
  if (G('acq-modal').classList.contains('open')) renderAcqModalBody(sn, acqs, ad?.totals);
  setzeHtml(G('m-untertit'), untertitel(d.set));
  // Der gedrückte Knopf ist ersetzt; der Fokus geht an seinen Nachfolger, ist der gesperrt (letztes „−“), an „+“.
  const konto = feld instanceof HTMLElement ? feld.dataset.arg : undefined;
  const knoepfe = konto ? [...(menge?.querySelectorAll(`[data-arg="${konto}"]`) || [])] : [];
  const ziel =
    feld?.id === 'm-qty'
      ? feldNeu
      : (knoepfe.find(
          k =>
            k instanceof HTMLElement &&
            k.dataset.arg2 === /** @type {HTMLElement} */ (feld).dataset.arg2 &&
            !k.hasAttribute('disabled'),
        ) ??
        knoepfe.find(k => !k.hasAttribute('disabled')) ??
        null);
  if (fokus && ziel instanceof HTMLElement) ziel.focus({ preventScroll: true });
  meldeAmFeld(ziel || menge?.querySelector('[data-rueckmeldung]'));
  ladeSetNachtraege(sn, acqs);
  return ad;
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
  mengeJeKonto,
  closeImageLightbox,
  delInstr,
  redownloadInstr,
  uploadInstr,
  openModal,
});
