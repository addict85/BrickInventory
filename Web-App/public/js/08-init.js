import { PARTS_ICON_SVG, bindTabs } from './02-gallery.js';
import { registerActions } from './00-registry.js';
import { locale, t, tRaw} from '../i18n.js';
import { escHex, G, api, checkAuth, esc, escUrl, imgUrl, thumbUrl, toast } from './01-core.js';
import { initScrollbalken } from './15-scrollbar.js';

// ═══ App-Initialisierung + temporaere Teileliste ═══
//
// ── Warum der Start nicht mehr hier steht ───────────────────────────────────
// Hier stand `checkAuth();` direkt im Modulrumpf. Mit klassischen Skripten war
// das unproblematisch: Alle Dateien waren zu diesem Zeitpunkt geladen.
//
// Als ES-Modul ist es das nicht. Bei gegenseitigen Importen wertet JavaScript
// das importierte Modul VOR dem importierenden aus — und weil i18n.js aus
// 01-core.js importiert, war das Übersetzungsobjekt `I18N` noch nicht
// initialisiert, wenn checkAuth() darüber applyLang() aufrief. Ergebnis:
// "Cannot read properties of undefined" beim Laden der Seite, also ein
// vollständig toter Start.
//
// Der Start gehört deshalb NACH die Auswertung aller Module: js/main.js ruft
// startApp() als letzten Schritt auf. Das ist auch unabhängig vom Modulsystem
// die sauberere Aufteilung — ein Modul beschreibt, was es kann, und startet
// nicht beim Geladenwerden die Anwendung.

/**
 * Auffangnetz für Fehler, die niemand behandelt.
 *
 * ── Wozu ────────────────────────────────────────────────────────────────────
 * api() liefert inzwischen bei jedem Fehlschlag ein Objekt statt zu werfen
 * (siehe 01-core.js), damit die bestehenden success/error-Pfade greifen. Das
 * deckt den Regelfall ab — aber nicht einen Programmierfehler in einem
 * Rückruf, einen fehlgeschlagenen Aufruf ausserhalb von api() oder ein
 * Promise, das niemand einsammelt. Ohne dieses Netz endet so etwas
 * ausschliesslich in der Browser-Konsole: Der Benutzer klickt, nichts
 * passiert, und niemand erfährt, dass etwas kaputt war.
 *
 * Eine sichtbare Meldung ist hier nicht Selbstzweck: Sie unterscheidet für den
 * Benutzer „hat nicht funktioniert" von „hat nichts getan" — und im
 * Fehlerbericht steht dann eine Beobachtung statt „irgendwie ging es nicht".
 *
 * Bewusst knapp gehalten: eine kurze Meldung, die Einzelheiten bleiben in der
 * Konsole. Und höchstens eine alle fünf Sekunden — ein Fehler in einer
 * Schleife soll den Bildschirm nicht zupflastern.
 */
let _letzteFehlermeldung = 0;
function meldeUnerwartet(quelle, fehler) {
  console.error(`[${quelle}]`, fehler);
  const jetzt = Date.now();
  if (jetzt - _letzteFehlermeldung < 5000) return;
  _letzteFehlermeldung = jetzt;
  // tRaw statt t: Das Ergebnis geht über toast() nach textContent — t()
  // maskiert die eingesetzten Werte und die Maskierung würde dort WÖRTLICH
  // erscheinen (siehe frontend-escaping.test.js).
  toast(tRaw('api.unexpected'), 'error');
}

function bindGlobalErrorHandlers() {
  window.addEventListener('unhandledrejection', (ev) => meldeUnerwartet('promise', ev.reason));
  // Ressourcenfehler (Bilder) laufen ebenfalls über 'error', blubbern aber
  // nicht bis window hoch — hier kommen nur echte Skriptfehler an.
  window.addEventListener('error', (ev) => meldeUnerwartet('script', ev.error || ev.message));
}

/** Startet die Anwendung. Aufruf ausschliesslich aus js/main.js. */
export function startApp() {
  bindGlobalErrorHandlers();
  bindTabs();
  plRenderSets();
  // Eigener Scrollbalken für die ganze Anwendung (Nachtrag 92). Der des
  // Browsers ist per CSS ausgeblendet; ohne diesen Aufruf gäbe es gar keinen.
  initScrollbalken();
  checkAuth();
}
// ── TEILELISTE (temporary parts list, resets on page leave) ──────────────────
export let _plSets = []; // { set_number, name }
export let _plParts = null; // generated parts list
let _rbToBlColor = {}; // Rebrickable → BrickLink color ID mapping

function plAddSet() {
  const raw = G('pl-setnr').value.trim();
  if (!raw) { toast(tRaw('common.enter_set_number'), 'error'); return; }
  // Support comma-separated input
  const nrs = raw.split(',').map(s => s.trim().replace(/\s/g,'')).filter(Boolean);
  nrs.forEach(nr => {
    const normalized = nr.includes('-') ? nr : nr + '-1';
    _plSets.push({ set_number: normalized, name: normalized });
    // Try to get set name from catalog (works for any set, not just owned ones)
    api('GET', `/sets/info/${normalized}`).then(d => {
      if (d.success && d.name && d.name !== normalized) {
        for (let i = _plSets.length-1; i >= 0; i--) {
          if (_plSets[i].set_number === normalized && _plSets[i].name === normalized) {
            _plSets[i].name = d.name; plRenderSets(); break;
          }
        }
      }
    }).catch(() => {});
  });
  G('pl-setnr').value = '';
  G('pl-setnr').focus();
  plRenderSets();
}

G('pl-setnr')?.addEventListener('keydown', e => e.key === 'Enter' && plAddSet());

function plRenderSets() {
  const c = G('pl-sets'); if (!c) return;
  if (!_plSets.length) { c.innerHTML = `<span style="color:var(--mut);font-size:.85rem">${t('pl.no_sets')}</span>`; G('btn-pl-gen').disabled = true; return; }
  G('btn-pl-gen').disabled = false;
  c.innerHTML = _plSets.map((s,i) => `
    <div style="display:inline-flex;align-items:center;gap:6px;background:var(--b50);border:1px solid var(--b200);border-radius:20px;padding:3px 10px 3px 8px;font-size:.85rem">
      <span style="font-weight:600;color:var(--b700)">${esc(s.set_number)}</span>
      <span style="color:var(--mut)">${s.name !== s.set_number ? '— '+esc(s.name) : ''}</span>
      <button data-click="plRemoveSet" data-arg="${i}" style="background:none;border:none;cursor:pointer;color:var(--mut);padding:0;font-size:.9rem;line-height:1">✕</button>
    </div>`).join('');
}
// Aufruf verschoben nach startApp() (js/08-init.js), das js/main.js NACH der
// Auswertung aller Module aufruft. Im Modulrumpf lief er zu früh: Bei
// gegenseitigen Importen ist das Übersetzungsobjekt aus i18n.js dann noch
// nicht initialisiert, und t() wirft.


function plRemoveSet(i) {
  _plSets.splice(i, 1);
  _plParts = null;
  G('pl-result').innerHTML = '';
  G('btn-pl-pdf').style.display = 'none';
  G('btn-pl-bl').style.display = 'none';
  G('pl-bl-condition').style.display = 'none';
  plRenderSets();
}

async function plGenerate() {
  if (!_plSets.length) return;
  G('pl-status').textContent = tRaw('pl.loading_lists');
  G('btn-pl-gen').disabled = true;
  G('pl-result').innerHTML = '';
  G('btn-pl-pdf').style.display = 'none';
  G('btn-pl-bl').style.display = 'none';
  G('pl-bl-condition').style.display = 'none';

  const combined = {}; // key: „partNum|colorId" → { part_number, part_name, color_name, color_hex, quantity }
  let errors = 0;

  // Load RB→BL color mapping from server (from rb_colors.bl_color_id)
  let rbToBlColor = {};
  try {
    const cm = await api('GET', '/v1/parts/bl-color-map');
    if (cm?.success) rbToBlColor = cm.map;
  } catch(_) {}
  _rbToBlColor = rbToBlColor;

  for (const s of _plSets) {
    G('pl-status').textContent = tRaw('pl.loading_set',{set:s.set_number});
    // Use user-independent CSV endpoints (work for all users regardless of import history)
    try {
      const d = await api('GET', `/v1/sets/${encodeURIComponent(s.set_number)}/parts-list`);
      if (d.success && d.parts?.length) {
        for (const p of d.parts) {
          const blNum = p.bl_part_number || p.part_number;
          const key = `${blNum}|${p.color_id||0}`;
          if (combined[key]) {
            combined[key].quantity += parseInt(p.total_quantity || p.quantity || 1);
          } else {
            combined[key] = {
              part_number:    p.part_number,
              bl_part_number: blNum,
              part_name:      p.part_name || p.part_number,
              color_name:     p.color_name || '–',
              color_hex:      p.color_hex || null,
              color_id:       p.color_id || 0,
              bl_color_id:    p.bl_color_id ?? rbToBlColor[p.color_id] ?? null,
              quantity:       parseInt(p.total_quantity || p.quantity || 1),
              image_local:    p.image_local || null,
              image_url:      p.image_url || null
            };
          }
        }
      } else if (!d.success) { errors++; }
    } catch(e) { console.error('plGenerate parts error for', s.set_number, e); errors++; }

    // Fetch minifigures from CSV (user-independent)
    try {
      const dm = await api('GET', `/v1/sets/${encodeURIComponent(s.set_number)}/minifigs-list`);
      if (dm?.success && dm.figs?.length) {
        for (const f of dm.figs) {
          const figQty = parseInt(f.quantity || 1);
          const key = `fig:${esc(f.fig_number)}`;
          if (combined[key]) {
            combined[key].quantity += figQty;
          } else {
            combined[key] = {
              part_number:    f.fig_number,
              bl_part_number: f.fig_number,
              part_name:      f.fig_name || f.fig_number,
              color_name:     t('detail.minifigs'),
              color_hex:      'f5a800',
              color_id:       0,
              quantity:       figQty,
              image_url:      f.image_url || null,
              is_fig:         true
            };
          }
        }
      }
    } catch(e) { console.error('plGenerate figs error for', s.set_number, e); }
  }

  _plParts = Object.values(combined);
  G('pl-status').textContent = tRaw('pl.summary',{parts:_plParts.length,sets:_plSets.length}) + (errors ? ` (${t('monitor.errors_n',{n:errors})})` : '');
  G('btn-pl-gen').disabled = false;
  plRenderTable();
  G('btn-pl-pdf').style.display = '';
  G('btn-pl-bl').style.display = '';
  G('pl-bl-condition').style.display = '';
}

function plRenderTable() {
  let _imgLogged = false;
  if (!_plParts?.length) { G('pl-result').innerHTML = `<div class="empty"><p>${t('parts.none_found')}</p></div>`; return; }

  // Group by color
  const byColor = {};
  for (const p of _plParts) {
    const k = p.color_name;
    if (!byColor[k]) byColor[k] = { color_name: p.color_name, color_hex: p.color_hex, parts: [] };
    byColor[k].parts.push(p);
  }
  const sorted = Object.values(byColor).sort((a,b) => a.color_name.localeCompare(b.color_name));

  let html = '';
  let totalParts = 0;
  for (const grp of sorted) {
    const colorDot = grp.color_hex ? `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${escHex(grp.color_hex, 'var(--s300)')};border:1px solid rgba(0,0,0,.15);vertical-align:middle;margin-right:6px"></span>` : '';
    html += `<div style="margin-bottom:1.5rem"><div style="font-weight:700;font-size:.95rem;padding:6px 0;border-bottom:2px solid var(--b200);margin-bottom:.5rem;color:var(--b700)">${colorDot}${esc(grp.color_name)} <span style="font-weight:400;color:var(--mut);font-size:.85rem">${t('pl.types',{n:grp.parts.length})}</span></div><div>`;
      html += `<div style="display:flex;align-items:center;gap:10px;padding:3px 4px;font-size:.7rem;font-weight:700;color:var(--mut);text-transform:uppercase;letter-spacing:.4px;border-bottom:1.5px solid var(--b200)"><span style="width:44px;flex-shrink:0"></span><span style="min-width:65px;flex-shrink:0">Nr.</span><span style="flex:1">${t('pl.col_name')}</span><span style="width:70px;text-align:right;flex-shrink:0">${t('pl.col_needed')}</span><span style="width:70px;padding-left:6px;flex-shrink:0">${t('pl.col_have')}</span></div>`;
    for (const p of grp.parts.sort((a,b) => (a.bl_part_number||a.part_number).localeCompare(b.bl_part_number||b.part_number, undefined, { numeric: true }))) {
      totalParts += p.quantity;
      // Build image source: prefer local cached file, then stored URL, then Rebrickable CDN
      const imgSrc = p.image_url || '';
      const img = `<div style="width:44px;height:44px;flex-shrink:0;border-radius:6px;background:#f1f5f9;overflow:hidden;display:flex;align-items:center;justify-content:center">${
        imgSrc
          ? `<img src="${escUrl(imgUrl(thumbUrl(imgSrc)||imgSrc, true))}" loading="lazy" decoding="async" style="max-width:44px;max-height:44px;width:auto;height:auto;display:block" data-onerror="hide">`
          : PARTS_ICON_SVG
      }</div>`;
      const pkey = `${esc(p.part_number)}__${p.color_id||0}`;
      const blColorId = p.bl_color_id ?? _rbToBlColor[p.color_id] ?? p.color_id ?? 0;
      html += `<div style="display:flex;align-items:center;gap:10px;padding:5px 4px;border-bottom:1px solid var(--bdr)">${img}<span style="font-family:monospace;font-size:.82rem;color:var(--b600);min-width:65px;flex-shrink:0" title="Rebrickable: ${esc(p.part_number)}">${esc(p.bl_part_number||p.part_number)}</span><span style="flex:1;font-size:.875rem">${esc(p.part_name)}</span><span style="font-weight:700;font-size:.875rem;width:70px;text-align:right;flex-shrink:0">${p.quantity.toLocaleString(locale())}×</span><span style="width:70px;flex-shrink:0;padding-left:6px"><input type="number" min="0" value="0" data-key="${pkey}" data-need="${p.quantity}" data-part="${esc(p.bl_part_number||p.part_number)}" data-color="${blColorId}" data-rb-color="${p.color_id||0}" data-type="${(p.bl_part_number||p.part_number||'P').startsWith('fig-')?'M':'P'}" class="pl-have-input" style="width:58px;height:28px;border:1px solid var(--bdr);border-radius:5px;padding:0 6px;font-size:.82rem;text-align:center" /></span></div>`;
    }
    html += '</div></div>';
  }
  // Summary shown in status bar above table
  G('pl-result').innerHTML = html;
}

async function plExportPdf() {
  if (!_plParts?.length) return;
  const btn = G('btn-pl-pdf');
  if (btn) { btn.disabled = true; btn.textContent = tRaw('pdf.creating'); }
  try {
    const pdfParts = _plParts.map(p => ({
      part_number:    p.part_number,
      bl_part_number: p.bl_part_number || p.part_number,
      part_name:      p.part_name,
      color_name:     p.color_name,
      color_hex:      p.color_hex,
      color_id:       p.color_id,
      quantity:       p.quantity,
      image_url:      p.image_url,
      image_local:    p.image_local || null,
      is_fig:         p.is_fig || false,
    }));

    // Step 1: Async PDF-Job starten
    const startResp = await fetch('/api/v1/sets/partslist-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ sets: _plSets, parts: pdfParts })
    });
    if (!startResp.ok) throw new Error(`HTTP ${startResp.status}`);
    const { jobId } = await startResp.json();
    if (!jobId) throw new Error(t('pdf.no_job_id'));

    // Step 2: SSE statt Polling — Ergebnis kommt sofort wenn fertig.
    // Fallback auf Polling falls EventSource nicht verfügbar.
    if (btn) btn.textContent = tRaw('pdf.loading_images');
    await new Promise((resolve, reject) => {
      let settled = false;
      // Countdown der geschätzten Restzeit (aus etaSeconds vom Server).
      let etaTimer = null, etaRemaining = null;
      const stopEta = () => { if (etaTimer) { clearInterval(etaTimer); etaTimer = null; } };
      const startEta = (sec) => {
        if (etaTimer || !sec || sec <= 0) return;
        etaRemaining = sec;
        const tick = () => {
          if (btn) btn.textContent = etaRemaining > 0 ? t('pdf.eta', { sec: etaRemaining }) : t('pdf.almost_done');
          if (etaRemaining > 0) etaRemaining--;
        };
        tick();
        etaTimer = setInterval(tick, 1000);
      };
      const finish = (err) => { stopEta(); if (!settled) { settled = true; err ? reject(new Error(err)) : resolve(); } };

      const trySSE = () => {
        if (typeof EventSource === 'undefined') { pollPdfStatus(jobId, btn, finish, startEta); return; }
        const es = new EventSource(`/api/v1/sets/partslist-pdf/stream/${jobId}`, { withCredentials: true });
        es.onmessage = (e) => {
          try {
            const { status, error, etaSeconds } = JSON.parse(e.data);
            if (status === 'running' && etaSeconds != null) startEta(etaSeconds);
            if (status === 'done') { es.close(); finish(null); }
            else if (status === 'error') { es.close(); finish(error || t('pdf.server_error')); }
          } catch(_) {}
        };
        es.onerror = () => { es.close(); if (!settled) pollPdfStatus(jobId, btn, finish, startEta); };
      };
      trySSE();
    });

    // Step 3: Download
    const dlResp = await fetch(`/api/v1/sets/partslist-pdf/download/${jobId}`, { credentials: 'include' });
    if (!dlResp.ok) throw new Error(t('pdf.download_error',{status:dlResp.status}));
    const blob = await dlResp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'teileliste.pdf'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(tRaw('pdf.created'), 'success');
  } catch(e) {
    console.error('PDF error:', e);
    toast(tRaw('pdf.error_prefix')+' ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📄 PDF'; }
  }
}

// Polling-Fallback für PDF-Export (nur wenn EventSource nicht verfügbar).
async function pollPdfStatus(jobId, btn, finish, startEta) {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      const r = await fetch(`/api/v1/sets/partslist-pdf/status/${jobId}`, { credentials: 'include' });
      const { status, error, etaSeconds } = await r.json();
      if (status === 'running' && etaSeconds != null && startEta) startEta(etaSeconds);
      if (status === 'done') { finish(null); return; }
      if (status === 'error') { finish(error || t('pdf.server_error')); return; }
    } catch(e) { finish(e.message); return; }
  }
  finish('Timeout');
}

export function plInit() {
  // Capture server origin for local image paths
  window._plServerUrl = window.location.origin;
  plRenderSets();
}


async function plExportBricklink() {
  // Ensure BL color mapping is loaded (may be empty if plGenerate was called before sync)
  if (!Object.keys(_rbToBlColor).length) {
    try {
      const cm = await api('GET', '/v1/parts/bl-color-map');
      if (cm?.success && cm.map) _rbToBlColor = cm.map;
    } catch(_) {}
  }
  // Collect all "vorhanden" inputs from the table
  const inputs = document.querySelectorAll('.pl-have-input');
  const missing = [];
  const condition = G('pl-bl-condition')?.value || 'X';
  inputs.forEach(inp => {
    const need = parseInt(inp.dataset.need) || 0;
    const have = parseInt(inp.value) || 0;
    const diff = need - have;
    if (diff > 0) {
      const rbColor = parseInt(inp.dataset.rbColor) || 0;
      const blColor = _rbToBlColor[rbColor] ?? parseInt(inp.dataset.color) ?? 0;
      missing.push({
        type:    inp.dataset.type || 'P',
        part:    inp.dataset.part,
        color:   blColor,
        qty:     diff
      });
    }
  });
  if (!missing.length) { toast(tRaw('pl.none_missing'), 'info'); return; }

  // Expand minifigs into individual parts and deduplicate by BL-ID + color
  const blMap = {}; // key: "type|partNum|colorId" → {type,part,color,qty}
  for (const m of missing) {
    if (m.type === 'M') {
      try {
        const dp = await api('GET', `/v1/minifigs/${encodeURIComponent(m.part)}/parts`);
        if (dp?.success && dp.parts?.length) {
          for (const p of dp.parts) {
            const blNum  = p.bl_part_number || p.part_number;
            const blColId = p.bl_color_id ?? _rbToBlColor[p.color_id] ?? p.color_id ?? 0;
            const key    = `P|${blNum}|${blColId}`;
            const qty    = parseInt(p.quantity || 1) * m.qty;
            if (blMap[key]) blMap[key].qty += qty;
            else blMap[key] = { type: 'P', part: blNum, color: blColId, qty };
          }
          continue;
        }
      } catch(_) {}
      // Fallback: add whole minifig
      const key = `M|${m.part}|0`;
      if (blMap[key]) blMap[key].qty += m.qty;
      else blMap[key] = { type: 'M', part: m.part, color: 0, qty: m.qty };
    } else {
      const key = `P|${m.part}|${m.color||0}`;
      if (blMap[key]) blMap[key].qty += m.qty;
      else blMap[key] = { ...m };
    }
  }
  const expanded = Object.values(blMap);

  // Build BrickLink Wanted List XML
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<INVENTORY>\n';
  for (const m of expanded) {
    xml += '  <ITEM>\n';
    xml += `    <ITEMTYPE>${m.type}</ITEMTYPE>\n`;
    xml += `    <ITEMID>${m.part}</ITEMID>\n`;
    // m.color is the BL color ID — only omit for minifigs (type M) where color is N/A
    // For parts, always include color (even 0 = "(Not Applicable)" for uncolored parts)
    if (m.type !== 'M' && m.color !== null && m.color !== undefined) {
      xml += `    <COLOR>${m.color}</COLOR>\n`;
    }
    xml += `    <MINQTY>${m.qty}</MINQTY>\n`;
    xml += `    <CONDITION>${condition}</CONDITION>\n`;
    xml += '  </ITEM>\n';
  }
  xml += '</INVENTORY>';

  // Open XML in new tab
  const blob = new Blob([xml], { type: 'text/plain; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const tab = window.open(url, '_blank');
  if (!tab) {
    // Popup blocked — fallback to download
    const a = document.createElement('a');
    a.href = url; a.download = 'bricklink-wanted.xml'; a.click();
    toast(tRaw('pdf.popup_blocked'), 'info');
  } else {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  toast(`✅ ${missing.length} fehlende Teiletypen exportiert`, 'success');
}

function plReset() {
  _plSets = []; _plParts = null;
  G('pl-result').innerHTML = '';
  G('pl-status').textContent = '';
  G('btn-pl-pdf').style.display = 'none';
  G('btn-pl-bl').style.display = 'none';
  G('pl-bl-condition').style.display = 'none';
  plRenderSets();
}

// Auto-reset when navigating away from the tab
const _origShowTab = typeof showTab === 'function' ? showTab : null;



// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
registerActions({
  plAddSet,
  plExportBricklink,
  plExportPdf,
  plGenerate,
  plRemoveSet,
  plReset,
});


/**
 * Teileliste-Zustand zurücksetzen (beim Abmelden).
 *
 * Ersetzt die früheren direkten Zuweisungen aus 01-core.js — importierte
 * Bindungen sind in ES-Modulen schreibgeschützt. Die Funktion hält das Wissen,
 * was "leer" für diesen Zustand heisst, dort wo der Zustand definiert ist.
 */
export function resetPartsList() { _plParts = null; _plSets = []; }
