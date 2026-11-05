// Der Detail-Dialog eines Sets: Anzeige, Menge, Anleitungen, Bildzoom. Er
// steht über Galerie und Kaufpreis-Dialog; wer ihn von unten öffnen muss,
// nimmt springe('setDetail', …) aus 00-ziele.js.
import { stelleZielBereit } from './00-ziele.js';
import { registerActions, echt } from './00-registry.js';
import { CURRENCY, ME, curSet, set_curSet } from './00-zustand.js';
import { G, api, escJs, escUrl, fmtDatum, fmtGeld, fullUrl, ico, toast, aktiverReiter } from './01-core.js';
import { alarmBlock, closeModal, ladeAlarm, ladeOrtAuswahl, lagerortBlock, setzeAlarmFeld } from './02-detailfelder.js';
import { confirmDelete } from './01-rueckfrage.js';
import { delSet, loadGallery, loadStats, reimportParts } from './02-gallery.js';
import { detailZeile, oderStrich, skelettZeilen } from './01-bausteine.js';
import { diagrammBreite, priceChartSVG, renderMarketRows } from './01-diagramme.js';
import { loadFinance } from './04-finance.js';
import { locale, t, tRaw } from '../i18n.js';
import { openAcqModal, renderAcqModalBody, renderAcquisitionSummary } from './13-acquisition-modals.js';
import { esc } from './00-escapen.js';

// Verschoben wird nur über den Kaufpreis (Kaufpreis-Dialog, Zeile für Zeile),
// nicht das ganze Set: Mehrere Käufe eines Sets können im Haushalt
// verschiedenen Konten gehören. Der Server verlangt dafür acquisition_ids.
let _detailLauf = 0;

export async function openModal(sn){
  const lauf = ++_detailLauf;
  // Der Dialog steht sofort da, mit Platzhalter: Bei langsamem Netz geschah
  // sonst bis zur Antwort nichts, und ein zweiter Tipp öffnete ihn doppelt.
  G('m-tit').textContent = sn; G('m-untertit').textContent = '';
  const bild = G('m-img'); bild.src = '/assets/set-placeholder.svg';
  G('m-det').innerHTML = skelettZeilen(4, t('common.loading'));
  G('m-instr').innerHTML = '';
  G('set-modal').dataset.nummer = sn;
  G('set-modal').classList.add('open');
  const [d, ad] = await Promise.all([
    api('GET',`/v1/sets/${sn}`),
    api('GET',`/v1/sets/${sn}/acquisitions`).catch(()=>null)
  ]);
  // Inzwischen geschlossen oder ein anderes Set geöffnet: nichts mehr zeichnen.
  if (lauf !== _detailLauf || !G('set-modal').classList.contains('open')) return;
  if(!d?.success){ G('set-modal').classList.remove('open'); toast(tRaw('settings.error'),'error'); return; }
  set_curSet(d.set);
  document.querySelector('#set-modal .mehr-menue')?.removeAttribute('open');
  G('m-tit').textContent=curSet.name||curSet.set_number;
  G('m-untertit').textContent=curSet.name?curSet.set_number:'';
  // fullUrl(): volle Auflösung, auch wenn image_local auf die _thumb-Datei zeigt
  const img=G('m-img'); img.src=fullUrl(curSet.image_local||curSet.image_url)||'/assets/set-placeholder.svg'; img.style.display='block';

  const addedFmt = curSet.added_at ? fmtDatum(curSet.added_at) : '—';
  // Marktpreis und Entwicklung stehen jetzt JE ZUSTAND — und die Werte dafür
  // kommen aus derselben Abfrage wie der Preisverlauf (by_condition). Hier nur
  // der Platzhalter; gefüllt wird er in renderMarketRows() weiter unten,
  // sobald die Antwort da ist.
  //
  // Vorher standen hier zwei feste Zeilen aus _pnlCache — ein Wert für das
  // ganze Set. Wer ein Exemplar neu und eines gebraucht besitzt, sah damit eine
  // vermischte Entwicklung.
  const priceRow = '<div id="m-market-rows"></div>';
  const pnlRow  = '';
  const qtyRow = detailZeile(t('detail.qty'), `
      <button class="btn bs btn-sm detail-knopf menge-knopf" data-click="mQtyDec" aria-label="${esc(tRaw('detail.qty_less'))}">−</button>
      <input inputmode="numeric" type="number" id="m-qty" min="1" class="detail-feld menge-feld" aria-label="${esc(tRaw('detail.qty'))}" data-change="autosaveSet" />
      <button class="btn bs btn-sm detail-knopf menge-knopf" data-click="mQtyInc" aria-label="${esc(tRaw('detail.qty_more'))}">+</button>
    `, { wertStil: 'display:flex;align-items:center;gap:6px' });

  // Acquisition summary: compact read-only rows + button to open full editor
  const acqs = ad?.acquisitions || [];
  const acqRows = detailZeile(t('detail.purchase_price'), `
      ${renderAcquisitionSummary(acqs, sn)}
      <button class="btn bs btn-sm detail-knopf" data-click="openAcqModal" data-arg="${escJs(sn)}">${ico('bearbeiten')} ${t('detail.edit_prices')}</button>
    `, { zeilenStil: 'align-items:flex-start',
         wertId: 'm-acq-summary',
         wertStil: 'flex-direction:column;align-items:flex-end;gap:3px' });

  G('m-det').innerHTML = `
    ${detailZeile(t('detail.year'), oderStrich(curSet.year))}
    ${detailZeile(t('detail.theme'), esc(oderStrich(curSet.theme)))}
    ${qtyRow}
    ${detailZeile(t('detail.pieces'), curSet.pieces ? curSet.pieces.toLocaleString(locale()) : '—')}
    ${detailZeile(t('detail.minifigs'), oderStrich(curSet.minifigs), { wertId: 'm-minifigs-val' })}
    ${detailZeile(t('detail.created'), `${ico('kalender')} ${addedFmt}`)}
    ${detailZeile(t('detail.alert'), alarmBlock(sn), { klasse: 'alarm-zeile',
         zeilenStil: 'align-items:flex-start',
         wertStil: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end' })}
    ${detailZeile(t('detail.storage'),
        lagerortBlock('m-storage', curSet.storage,
                      `data-change="speichereSetLagerort" data-arg="${escJs(sn)}"`),
        { wertStil: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end' })}
    ${acqRows}
    ${priceRow}${pnlRow}
    <div id="m-price-chart" data-stil="margin-top:.75rem">
      <div data-stil="font-size:var(--fs-1);font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--mut);margin-bottom:4px">${t('detail.price_history')}</div>
      <div class="sparkline-wrap" id="m-sparkline-content"><span data-stil="color:var(--mut);font-size:var(--fs-1)">${t('common.loading')}</span></div>
    </div>`;

  G('m-qty').value=curSet.quantity;

  renderInstructions(curSet.instructions||[], sn);
  // Ab hier meinen die Alarm-Handler DIESEN Dialog.
  setzeAlarmFeld('m');
  G('set-modal').classList.add('open');
  ladeAlarm(sn).catch(() => {});
  // Die Auswahlliste gehört dem BESITZER des Sets, nicht dem Betrachter —
  // Begründung an ladeOrtAuswahl().
  ladeOrtAuswahl(curSet.owners).catch(() => {});

  // Load actual minifig count from minifigs table (more reliable than sets.minifigs)
  //
  // ── Wettlauf mit dem Schliessen des Dialogs ──────────────────────────────
  // Marcos Konsole: `TypeError: Cannot read properties of null (reading
  // 'minifigs')`, als [promise] gemeldet — also aus einer Fortsetzung wie
  // dieser.
  //
  // Die Abfrage über ALLE Minifiguren dauert; wer den Dialog vorher schliesst
  // (closeModal setzt curSet auf null) oder ein anderes Set öffnet, lief hier
  // in den Fehler. Das Element gab es dann teils noch — die Prüfung auf `el`
  // allein genügt also nicht.
  //
  // Deshalb wird die Setnummer von damals mit der von jetzt verglichen: Nur
  // wenn noch DASSELBE Set offen ist, gehört das Ergebnis dorthin.
  api('GET', `/v1/minifigs?source=set`).then(md => {
    const el = G('m-minifigs-val');
    if (!el || !curSet || curSet.set_number !== sn) return;
    if (md.success && md.figs) {
      const setFigs = md.figs.filter(f => f.in_sets && f.in_sets.split(',').includes(sn));
      const total   = setFigs.reduce((s, f) => s + (parseInt(f.total_quantity) || parseInt(f.quantity) || 0), 0);
      if (total > 0) el.textContent = total;
      else if (!curSet.minifigs) el.textContent = '0';
    }
  });

  // Load price history async
  api('GET', `/v1/sets/${sn}/price-history`).then(ph => {
    renderMarketRows(ph);
    const el = G('m-sparkline-content');
    if(!el) return;
    // Beide Zustände in EINEM Diagramm — siehe priceChartSVG().
    el.innerHTML = ph.success
      ? priceChartSVG(ph, sn.replace(/[^a-zA-Z0-9]/g, ''), diagrammBreite(el))
      : `<span data-stil="color:var(--mut);font-size:var(--fs-1)">${t(ph.networkError ? 'chart.offline' : 'detail.no_history')}</span>`;
  });

}

/** Aus „Weitere Aktionen“ im Set-Detail: das offene Set. */
function teileNeuImportieren(){ if (curSet?.set_number) reimportParts(curSet.set_number); }

// openModal defined below (with price history)

export function renderInstructions(instr, sn) {
  const items = instr.map(i => {
    const href = i.local_path || i.url;
    const isLocal = !!i.local_path;
    // Selbst hochgeladen oder automatisch importiert? Das sagt der Server
    // (is_manual, siehe utils/instructions.anleitungenZusammenlegen). Vorher
    // stand die Regel hier als Pfadvergleich — eine zweite Fassung derselben
    // Frage, die die Android-App gar nicht erst nachbauen konnte.
    const isUpload = !!i.is_manual;
    const label = esc(i.description) || t('instr.label');
    // Lokale Dateien (PDF/Bild) im In-App-Viewer öffnen; externe URLs im neuen Tab.
    const link = isLocal
      ? `<a href="${escUrl(href)}" data-click="openPdfViewerLink" data-arg="${esc(href)}" data-arg2="${esc(i.description||'')}" data-stil="cursor:pointer">${label}</a>`
      : `<a href="${escUrl(href)}" target="_blank" rel="noopener">${label}</a>`;
    return `<div class="ii" id="instr-${i.id}">
      ${link}
      ${isUpload ? `<span class="lv" data-stil="background:var(--p100);color:var(--p600)">${t('instr.badge_manual')}</span>` : isLocal ? `<span class="lc">${ico('speichern')}</span>` : `<span class="lv">${ico('globus')}</span>`}
      ${isUpload ? `<button data-click="delInstr"${echt()} data-arg="${esc(sn)}" data-arg2="${i.id}" title="${t('instr.delete_tooltip')}" data-stil="background:none;border:none;cursor:pointer;color:var(--s400);font-size:var(--fs-3);padding:0 2px" aria-label="${t('instr.delete_tooltip')}">${ico('schliessen')}</button>` : ''}
    </div>`;
  }).join('');

  const uploadForm = `
    <div id="instr-upload-form" data-stil="margin-top:10px;padding:10px;background:var(--s50);border:1px dashed var(--bdr);border-radius:8px">
      <div data-stil="font-size:var(--fs-1);font-weight:600;color:var(--mut);margin-bottom:7px">${t('instr.upload_title')}</div>
      <div data-stil="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end">
        <div data-stil="flex:1;min-width:140px">
          <input type="text" id="instr-desc" placeholder="${t('instr.desc_placeholder')}" data-stil="font-size:var(--fs-2);padding:6px 10px" />
        </div>
        <label class="btn bs btn-sm zeiger">
          ${ico('datei')} ${t('instr.choose_file')}
          <input type="file" id="instr-file" accept=".pdf,.jpg,.jpeg,.png" class="datei-versteckt" data-change="uploadInstr" data-arg="${escJs(sn)}" />
        </label>
      </div>
      <div id="instr-upload-status" role="status" data-stil="font-size:var(--fs-1);margin-top:6px;color:var(--mut)"></div>
    </div>`;

  G('m-instr').innerHTML = `
    <div data-stil="font-size:var(--fs-1);font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--mut);margin:12px 0 7px">
      ${t('instr.section_title')} ${instr.length ? `(${instr.length})` : ''}
      ${ME?.isAdmin || !instr.some(i => !i.is_manual) ? `<button data-click="redownloadInstr" data-arg="${escJs(sn)}" class="btn bs btn-sm" data-stil="margin-left:8px;font-size:var(--fs-0);padding:3px 8px">${t('instr.reload')}</button>` : ''}
    </div>
    ${items || `<div data-stil="color:var(--mut);font-size:var(--fs-2)">${t('instr.none_auto')}</div>`}
    ${uploadForm}`;
}

async function delInstr(sn, instrId) {
  if (!await confirmDelete(tRaw('instr.delete_title'),t('instr.delete_text'),'datei')) return;
  const d = await api('DELETE', `/v1/sets/${sn}/instructions/${instrId}`);
  if (d.success) { toast(tRaw('instr.deleted'), 'success'); openModal(sn); }
  else toast(d.error || t('settings.error'), 'error');
}

async function uploadInstr(sn) {
  const fi = G('instr-file');
  if (!fi.files[0]) return;
  const status = G('instr-upload-status');
  status.textContent = tRaw('common.uploading');
  const fd = new FormData();
  fd.append('file', fi.files[0]);
  const desc = G('instr-desc').value.trim();
  if (desc) fd.append('description', desc);
  try {
    const d = await api('POST', `/v1/sets/${sn}/instructions/upload`, fd);
    if (d.success) { toast(tRaw('instr.uploaded'), 'success'); openModal(sn); }
    else { status.textContent = d.error || tRaw('settings.error'); status.style.color = 'var(--r500)'; }
  } catch (e) { status.textContent = tRaw('common.network_error'); }
}

export function openImageLightbox(src){
  if(!src || src.endsWith('/assets/set-placeholder.svg')) return;
  G('lightbox-img').src = src;
  G('img-lightbox').classList.add('open');
}

// `removeAttribute` und NICHT `src=''`: Ein leeres src ist keine leere
// Adresse, sondern die Adresse der SEITE. Der Browser laedt sie als Bild,
// scheitert daran, und der Fehlerlauscher in 11-actions.js meldete bei jedem
// Schliessen des Zooms `[img] konnte nicht geladen werden: https://<host>/`.
// Ohne Attribut laedt der Browser gar nichts.
export function closeImageLightbox(){ G('img-lightbox').classList.remove('open'); G('lightbox-img').removeAttribute('src'); }

// Escape schliesst den Zoom über js/01-dialoge.js, wie jeden Dialog.
G('set-modal').addEventListener('click',e=>e.target===e.currentTarget&&closeModal());

let _autosaveTimer=null;

export function autosaveSet(){
  if(!curSet) return;
  clearTimeout(_autosaveTimer);
  _autosaveTimer=setTimeout(async ()=>{
    const qty = parseInt(G('m-qty').value)||1;
    const prevQty = curSet.quantity || qty;
    const d = await api('PUT',`/v1/sets/${esc(curSet.set_number)}`,{quantity:qty});
    if(d.success){
      // Die WIRKLICHE Gesamtmenge kommt vom Server.
      //
      // Angezeigt wird die Menge aller Konten, geschrieben wird die Differenz
      // auf das eigene. Beim VERRINGERN deckelt der Server bei den eigenen
      // Exemplaren — fremde lassen sich nicht wegnehmen —, und dann steht in
      // der Antwort eine andere Zahl als die gesendete. Ohne diese Übernahme
      // bliebe im Feld die eigene Annahme stehen, bis der Dialog neu geöffnet
      // wird.
      const echt = Number.isInteger(d.quantity) ? d.quantity : qty;
      curSet.quantity = echt;
      if (echt !== qty) G('m-qty').value = echt;
      // Bei jeder Mengenänderung die Erfassungs-Übersicht neu laden: beim
      // Erhöhen entsteht eine neue Zeile, beim Reduzieren fällt (LIFO) die
      // letzte weg — sonst blieb die entfernte Zeile in der Detailsicht stehen.
      const sn = curSet.set_number;
      if (echt !== prevQty && typeof renderAcquisitionSummary === 'function') {
        api('GET', `/v1/sets/${esc(sn)}/acquisitions`).then(ad => {
          if (!ad?.success) return;
          if (echt > prevQty) meldeNeueExemplare(sn, ad.acquisitions, echt - prevQty);
          const sumEl = G('m-acq-summary');
          if (sumEl) sumEl.innerHTML = renderAcquisitionSummary(ad.acquisitions, curSet.set_number) +
            `<button class="btn bs btn-sm" data-click="openAcqModal" data-arg="${escJs(curSet.set_number)}" data-stil="margin-top:4px;font-size:var(--fs-1);padding:2px 10px">${ico('bearbeiten')} ${t('detail.edit_prices')}</button>`;
          if (G('acq-modal').classList.contains('open') && typeof renderAcqModalBody === 'function') {
            renderAcqModalBody(curSet.set_number, ad.acquisitions);
          }
        }).catch(()=>{});
      }
      // Mehr Exemplare melden sich mit Preis (meldeNeueExemplare), sobald die Erfassungen da sind.
      if (!(echt > prevQty)) toast(tRaw('settings.saved'),'success');
      loadGallery();
      if(aktiverReiter()==='finance') loadFinance();
    } else { toast(d.error||t('settings.error'),'error'); }
  }, 400);
}

/**
 * „+“ legt eine Kauferfassung an, meist mit dem Marktpreis als Schätzung. Das
 * verändert die Finanzen, also sagt der Toast es samt Betrag und bietet
 * „Ändern“ an, statt nur „Gespeichert“ zu melden.
 */
function meldeNeueExemplare(sn, acqs, n) {
  const neu = [...(acqs || [])].sort((a, b) => (b.id || 0) - (a.id || 0))[0];
  const preis = neu?.purchase_price;
  const mehrere = n > 1 ? 'exemplare' : 'exemplar';
  const text = preis != null && neu.price_estimated
    ? tRaw(`acq.${mehrere}_geschaetzt`, { n, preis: fmtGeld(preis, neu.currency || CURRENCY) })
    : preis == null ? tRaw(`acq.${mehrere}_ohne_preis`, { n }) : tRaw('settings.saved');
  toast(text, 'success', { text: tRaw('acq.aendern'), fn: () => openAcqModal(sn) });
}

// Keine eigene Rückfrage mehr — delSet() fragt (siehe dort). Der Dialog
// schliesst nur, wenn wirklich gelöscht wurde; sonst stünde er nach einem
// „Abbrechen" leer da.
G('btn-md').onclick=async()=>{ if(!curSet) return; if(await delSet(curSet.set_number)) closeModal(); };

async function redownloadInstr(sn){ toast(tRaw('instr.loading'),'info'); const d=await api('POST',`/v1/sets/${sn}/instructions`); if(d.success){toast(tRaw('instr.loaded',{count:d.instructions.length}),'success');if(curSet){openModal(sn);}loadStats();} else toast(d.error,'error'); }

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
