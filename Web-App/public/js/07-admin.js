import { registerActions } from './00-registry.js';
import { detailZeile, oderStrich, textOderStrich } from './01-bausteine.js';
import { renderAcquisitionSummary } from './13-acquisition-modals.js';
import { locale, t, tRaw} from '../i18n.js';
import { CURRENCY, G, ME, _settingsCache, api, esc, escJs, fmtN, fullUrl, imgUrl, toast , set_settingsCache} from './01-core.js';
import { initStorageSelects } from './02-gallery.js';
import { PARTS_ICON_SVG, _pnlCache, allSets, setAllSets, applySetAggregate, autosaveSet, closeModal, curSet, loadGallery, pnlBadge, reimportParts, renderInstructions, updateGalleryPrices , set_pnlCache, set_curSet} from './02-gallery.js';
import { loadFinance } from './04-finance.js';
import { scopeQuery } from './14-scope.js';
import { loadApiLimits, loadCacheTtl, loadSettings } from './05-settings.js';
import { deleteManualFig, deleteManualPart, loadManualFigsTable, loadManualParts, manualFigsCache, manualPartsCache, updateManualFig, updateManualPart } from './06-minifigs.js';

// ═══ Confirm-Dialog, Config-Export/Import, API-Tokens, Job-Status ═══
// (Kaufpreis-Modal und Detailfenster lagen bis Nachtrag 130 ebenfalls hier —
//  jetzt js/13-acquisition-modals.js.)
// Teil von app.js — die Dateien in public/js/ werden in nummerierter
// Reihenfolge geladen und teilen sich den globalen Scope (kein Modul-
// System noetig, Inline-onclick-Handler in index.html funktionieren
// unveraendert). Der Split ist rein sequenziell und verhaelt sich
// identisch zur frueheren Einzeldatei.

// ── CONFIRM DIALOG ────────────────────────────────────────────
export function confirmDelete(title, msg, icon) {
  return new Promise(resolve => {
    const modal = G('confirm-modal');
    G('cd-title').textContent = title || t('common.delete_title');
    G('cd-msg').textContent   = msg   || t('common.delete_text');
    G('cd-icon').textContent  = icon  || '🗑️';
    modal.style.display = 'flex';
    const btnYes = G('cd-confirm');
    const btnNo  = G('cd-cancel');
    function cleanup(result) {
      modal.style.display = 'none';
      btnYes.onclick = null;
      btnNo.onclick  = null;
      modal.onclick  = null;
      resolve(result);
    }
    btnYes.onclick = () => cleanup(true);
    btnNo.onclick  = () => cleanup(false);
    modal.onclick  = e => { if (e.target === modal) cleanup(false); };
  });
}

// ── CONFIG EXPORT / IMPORT ───────────────────────────────────
G('btn-cfg-export').onclick = async () => {
  const a = document.createElement('a');
  a.href = '/api/v1/settings/export';
  a.download = `brickinventory-manager-config-${new Date().toISOString().substring(0,10)}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

async function importConfig() {
  const fi = G('cfg-import-file');
  if (!fi.files[0]) return;
  const st = G('cfg-import-status');
  st.textContent = tRaw('settings.importing');
  const fd = new FormData(); fd.append('file', fi.files[0]);
  try {
    const r = await fetch('/api/v1/settings/import', { method: 'POST', body: fd });
    const d = await r.json();
    if (d.success) {
      st.textContent = tRaw('settings.imported_note',{n:d.imported,note:d.note||''});
      st.style.color = 'var(--g500)';
      toast(tRaw('admin.config_imported'), 'success');
      loadSettings();
      set_settingsCache(null); // invalidate cache so next loadSettings fetches fresh
      if (ME?.isAdmin) { loadCacheTtl(); loadApiLimits(); }
    } else {
      st.textContent = '❌ ' + (d.error || t('settings.error'));
      st.style.color = 'var(--r500)';
    }
  } catch(e) { st.textContent = '❌ ' + tRaw('common.network_error'); }
  fi.value = '';
}

// ── API TOKEN MANAGEMENT ─────────────────────────────────────





export async function enrichGalleryWithPrices(){
  // Mit Kontofilter — aus demselben Grund wie loadStats(): Diese Funktion
  // steht am Ende von loadGallery(), und loadGallery() laeuft bei jedem
  // Wechsel des Kontofilters. Etwas neu zu laden, das sich dadurch nicht
  // aendern kann, ergibt nur einen Sinn, wenn es sich aendern sollte.
  //
  const pnl = await api('GET','/v1/finance/pnl' + scopeQuery('gallery'));
  if(!pnl.success) return;
  set_pnlCache({});
  // ── Mehrere Zeilen, EINE Kachel ─────────────────────────────────────────
  //
  // /finance/pnl liefert eine Zeile JE BESITZER (die Finanztabelle zeigt sie
  // so, mit Besitzer-Plakette). Die Galerie fasst im Haushalt dieselbe
  // Setnummer zu EINER Kachel zusammen. Hier stand nur
  // `_pnlCache[s.set_number] = …` — die zuletzt gelesene Zeile gewann.
  //
  // NACHGEMESSEN, und der Fall ist enger als er aussieht: Sind Kaufpreise
  // ERFASST (der Normalfall), rechnet der Server den mengengewichteten Wert
  // schon je Zeile aus — zwei Konten mit 600 und 100 ergaben in BEIDEN Zeilen
  // 350, „letzte gewinnt" traf also zufaellig das Richtige.
  //
  // Fehlen die Erfassungen und steht nur noch sets.purchase_price (Altdaten,
  // oder alle Kaufpreise eines Sets wieder entfernt), fallen die Zeilen
  // auseinander: 100 mit 750 % und 600 mit 41,7 %, und die Kachel nahm eine
  // davon.
  //
  // Gewichtet nach Menge ergibt in BEIDEN Faellen dasselbe: 350 und 142,9 %.
  // Gerechnet wird ueber `baseline_price` — das ist der Kaufpreis, wenn er
  // bekannt ist, und sonst der erste beobachtete Marktpreis (financeCalc.ts).
  // Nur so bleibt der Rueckfall erhalten, den `baseline_pnl_pct` mitbringt.
  const jeSet = new Map();
  for(const s of pnl.sets){
    if(!jeSet.has(s.set_number)) jeSet.set(s.set_number, []);
    jeSet.get(s.set_number).push(s);
  }
  for(const [nr, zeilen] of jeSet){
    // Eine Zeile: den Wert des Servers unveraendert nehmen. Alles andere waere
    // dieselbe Rechnung ein zweites Mal, mit der Chance abzuweichen.
    if(zeilen.length === 1){
      const s = zeilen[0];
      _pnlCache[nr] = { price: s.current_price, pnl_pct: s.baseline_pnl_pct || s.pnl_pct };
      continue;
    }
    let summe = 0, menge = 0;
    for(const s of zeilen){
      const m = parseInt(s.quantity) || 1;
      const b = s.baseline_price == null ? null : parseFloat(s.baseline_price);
      if(b != null){ summe += b * m; menge += m; }
    }
    const markt = parseFloat(zeilen[0].current_price) || 0;
    const basis = menge > 0 ? summe / menge : null;
    // Math.max(basis, 0.01) wie PNL_EPS auf dem Server (utils/setValue.ts) —
    // ohne das ergibt ein Kaufpreis von 0 eine Division durch null.
    _pnlCache[nr] = {
      price: zeilen[0].current_price,
      pnl_pct: (basis != null && markt > 0)
        ? ((markt - basis) / Math.max(basis, 0.01) * 100).toFixed(1)
        : null,
    };
  }
  // Inject price data into cached sets
  setAllSets(allSets.map(s => ({
    ...s,
    _price:   _pnlCache[s.set_number]?.price || 0,
    _pnl_pct: _pnlCache[s.set_number]?.pnl_pct ?? undefined
  })));
  // Nur die Preis-Container nachtragen statt die ganze Galerie neu zu bauen —
  // ein voller renderGallery() erzeugt alle <img> neu und lässt sie erneut
  // einblenden (sichtbares Flackern nach dem Laden).
  updateGalleryPrices();
}

// Sparkline SVG renderer
function sparklineSVG(data, width=260, height=44){
  if(!data||data.length<2) return '<span style="color:var(--mut);font-size:.78rem">Noch keine Daten</span>';
  // avg_price ist die massgebliche Grösse (siehe die frühere Preis-Umstellung
  // in dieser Sitzung) — qty_avg_price kann für denselben, korrekt
  // aufgelösten Zustand trotzdem fehlen oder abweichen. Genau das erzeugte
  // den weiterhin gemeldeten Graphen-Fehler: Der Server wählte inzwischen
  // längst den richtigen Zustand, aber diese Zeile hier zeichnete eine andere
  // Preisspalte davon. Android hatte dieselbe Stelle bereits richtig
  // (avgPrice ?: qtyAvgPrice) — der Webapp fehlte der Fix.
  const vals = data.map(d=>d.avg_price||d.qty_avg_price||d.total||0);
  const min=Math.min(...vals), max=Math.max(...vals), range=max-min||1;
  const pts = vals.map((v,i) => {
    const x = (i/(vals.length-1))*width;
    const y = height - ((v-min)/range)*(height-6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const lastVal = vals[vals.length-1];
  const color = '#2563eb';
  const purchaseColor = '#16a34a';
  const areaStart = `0,${height}`;
  const areaEnd   = `${width},${height}`;
  const area = `${areaStart} ${pts} ${areaEnd}`;
  const hasPurchasePoint = !!data[0]?.is_purchase_price;
  const purchaseDot = hasPurchasePoint
    ? `<circle cx="0" cy="${(height-((vals[0]-min)/range)*(height-6)-3).toFixed(1)}" r="3.5" fill="${purchaseColor}" stroke="white" stroke-width="1"><title>Kaufpreis</title></circle>`
    : '';

  // Format first/last date as DD.MM.YYYY
  function fmtD(entry) {
    const raw = entry?.recorded_at || entry?.day || '';
    if (!raw) return '';
    try {
      const d = new Date(raw);
      return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
    } catch(_) { return ''; }
  }
  const dateFirst = fmtD(data[0]);
  const dateLast  = fmtD(data[data.length-1]);
  const labelHeight = dateFirst || dateLast ? 14 : 0;
  const totalH = height + labelHeight;

  return `<svg viewBox="0 0 ${width} ${totalH}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:${totalH}px">
    <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity=".18"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon points="${area}" fill="url(#sg)"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${(vals.length-1)/(vals.length-1)*width}" cy="${(height-((lastVal-min)/range)*(height-6)-3).toFixed(1)}" r="3" fill="${color}"/>
    ${purchaseDot}
    ${dateFirst ? `<text x="1" y="${totalH}" font-size="9" fill="var(--mut)" text-anchor="start" font-family="inherit">${dateFirst}</text>` : ''}
    ${dateLast  ? `<text x="${width-1}" y="${totalH}" font-size="9" fill="var(--mut)" text-anchor="end" font-family="inherit">${dateLast}</text>` : ''}
  </svg>`;
}


/**
 * Preisverlauf mit ZWEI Linien (neu und gebraucht) plus Legende.
 *
 * ── Warum eine eigene Funktion statt sparklineSVG() zu erweitern ────────────
 * sparklineSVG() ist auf eine Reihe gebaut: 260 × 44 Pixel, keine Achsen, kein
 * Platz für eine Legende. Vor allem aber ist ihre x-Achse INDEXBASIERT
 * (i / (n-1) * width). Bei zwei Reihen unterschiedlicher Länge — der Normalfall,
 * weil Gebrauchtpreise für viele Sets später einsetzen — würden beide über die
 * volle Breite gestreckt. Punkte aus verschiedenen Monaten lägen übereinander,
 * und das Diagramm zeigte einen Vergleich, den es nicht gibt.
 *
 * Hier kommt die x-Position deshalb vom DATUM. Fehlende Tage werden
 * ausgelassen, nicht interpoliert: Ein erfundener Zwischenwert sähe aus wie
 * eine echte Preisbewegung.
 *
 * ── Gemeinsame Skala ────────────────────────────────────────────────────────
 * Beide Linien teilen sich y-Achse und Zeitachse. Der interessante Vergleich
 * ist der Abstand zwischen Neu- und Gebrauchtpreis und wie er sich entwickelt;
 * getrennte Skalen machen genau das unsichtbar.
 *
 * @param {{history_new?: any[], history_used?: any[]}} data Antwort von
 *        /api/v1/sets/:nummer/price-history — beide Reihen dürfen leer sein.
 * @param {string} uid Eindeutiges Kürzel für die Verlaufs-IDs im SVG (siehe unten)
 * @returns {string} SVG-Markup oder ein Hinweistext
 */
/**
 * Marktpreis und Entwicklung je Zustand in den Detail-Dialog schreiben.
 *
 * Eine Zeile erscheint nur für Zustände, zu denen eine Erfassung existiert —
 * der Server entscheidet das (by_condition, siehe utils/priceHistory.ts) und
 * liefert gar keinen Eintrag für die anderen. Damit taucht eine neue Zeile
 * automatisch auf, sobald ein Kaufpreis in diesem Zustand erfasst wird: Nach
 * jedem Speichern wird diese Abfrage erneut geladen.
 *
 * @param {{by_condition?: Record<string, {market_price: number|null, pnl_pct: number|null}>}} ph
 */
export function renderMarketRows(ph, targetId = 'm-market-rows') {
  const el = G(targetId);
  if (!el) return;
  const LABEL = { N: t('common.condition_new'), U: t('common.condition_used') };
  const rows = ['N', 'U']
    .filter(c => ph?.by_condition?.[c])
    .map(c => {
      const d = ph.by_condition[c];
      const price = d.market_price != null
        ? `<span style="font-weight:700;color:var(--b600)">${esc(fmtN(d.market_price, CURRENCY))}</span>`
        : '<span style="color:var(--mut)">—</span>';
      const pnl = d.pnl_pct != null ? pnlBadge(d.pnl_pct) : '';
      return detailZeile(
        `${esc(t('detail.market_price'))} (${esc(LABEL[c])})`,
        `${price}${pnl}`,
        { wertStil: 'display:flex;align-items:center;gap:8px' });
    });
  el.innerHTML = rows.join('');
}

export function priceChartSVG(data, uid = String(Math.random()).slice(2, 8)) {
  // Erwartet die fertigen Diagrammdaten des Servers:
  //   { values: [ { name, values: [{x, y}], firstRealIndex } ], x: [...] }
  //
  // Die Zeitachse rechnet nicht mehr der Client — siehe utils/chartData.ts.
  // Vorher tat das jeder Client für sich, und Android hätte dieselbe Rechnung
  // ein zweites Mal gebraucht.
  const NAMES  = { N: t('common.condition_new'), U: t('common.condition_used') };
  // Farben aus dem Design, nicht fest verdrahtet. In inline-SVG greift var()
  // sowohl in stroke als auch in stop-color, das Diagramm folgt damit dem
  // aktiven Design ohne eigene Fallunterscheidung.
  const COLORS = { N: 'var(--chart-new)', U: 'var(--chart-used)' };

  const chart = data?.chart;
  const axis  = chart?.x || [];
  // firstRealIndex überspringen: Vor dem ersten echten Wert stehen aufgefüllte
  // Nullen. Als Punkt gezeichnet ergäben sie eine Linie, die bei null beginnt
  // und dann senkrecht hochspringt — ein Kurssturz, den es nie gab.
  const series = (chart?.values || [])
    .map(sd => ({
      name: NAMES[sd.name] || sd.name,
      color: COLORS[sd.name] || 'var(--mut)',
      pts: (sd.values || []).slice(sd.firstRealIndex ?? 0).filter(pt => pt.y > 0),
    }))
    .filter(sd => sd.pts.length > 0);

  if (!series.length || axis.length < 2) {
    return `<span style="color:var(--mut);font-size:.78rem">${t('detail.no_history')}</span>`;
  }

  const W = 700, H = 190, PAD = { l: 64, r: 14, t: 12, b: 40 };
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;

  const toTime = d => new Date(d + 'T00:00:00').getTime();
  const first = axis[0], last = axis[axis.length - 1];
  const span = Math.max(1, toTime(last) - toTime(first));
  const xOf = d => PAD.l + ((toTime(d) - toTime(first)) / span) * iw;

  const vals = series.flatMap(sd => sd.pts.map(p => p.y));
  const rawMin = Math.min(...vals), rawMax = Math.max(...vals);
  const spread = rawMax - rawMin;
  const pad = spread > 0 ? spread * 0.15 : (rawMax * 0.1 || 1);
  const min = Math.max(0, rawMin - pad), max = rawMax + pad, range = max - min || 1;
  const yOf = v => PAD.t + ih - ((v - min) / range) * ih;

  const parts = series.map((sd, i) => {
    const pts = sd.pts.map(p => `${xOf(p.x).toFixed(1)},${yOf(p.y).toFixed(1)}`);
    if (pts.length < 2) {
      const [cx, cy] = pts[0].split(',');
      return `<circle cx="${cx}" cy="${cy}" r="3.5" fill="${sd.color}"/>`;
    }
    // Eindeutige Verlaufs-ID: Die alte Sparkline benutzt ein festes id="sg" —
    // stehen zwei SVGs mit derselben ID im Dokument, verweisen beide auf den
    // ERSTEN Verlauf, und die zweite Fläche bekäme die falsche Farbe.
    const gid = `pg-${uid}-${i}`;
    const area = `${xOf(sd.pts[0].x).toFixed(1)},${PAD.t + ih} ${pts.join(' ')} ${xOf(sd.pts[sd.pts.length-1].x).toFixed(1)},${PAD.t + ih}`;
    return `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${sd.color}" stop-opacity=".16"/>
        <stop offset="100%" stop-color="${sd.color}" stop-opacity="0"/>
      </linearGradient></defs>
      <polygon points="${area}" fill="url(#${gid})"/>
      <polyline points="${pts.join(' ')}" fill="none" stroke="${sd.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');

  const yTicks = [min, (min + max) / 2, max].map(v =>
    `<text x="${PAD.l - 8}" y="${(yOf(v) + 3).toFixed(1)}" font-size="10" fill="var(--mut)" text-anchor="end" font-family="inherit">${esc(fmtN(v, CURRENCY))}</text>
     <line x1="${PAD.l}" y1="${yOf(v).toFixed(1)}" x2="${W - PAD.r}" y2="${yOf(v).toFixed(1)}" stroke="var(--bdr)" stroke-width=".5"/>`
  ).join('');

  const fmtDay = d => { const [y, m, dd] = String(d).split('-'); return `${dd}.${m}.${y}`; };
  const legend = series.map((sd, i) =>
    `<g transform="translate(${PAD.l + i * 120}, ${H - 8})">
       <line x1="0" y1="-4" x2="16" y2="-4" stroke="${sd.color}" stroke-width="2.5" stroke-linecap="round"/>
       <text x="22" y="0" font-size="11" fill="var(--txt)" font-family="inherit">${esc(sd.name)}</text>
     </g>`).join('');

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto">
    ${yTicks}
    ${parts}
    <text x="${PAD.l}" y="${H - 22}" font-size="10" fill="var(--mut)" text-anchor="start" font-family="inherit">${esc(fmtDay(first))}</text>
    <text x="${W - PAD.r}" y="${H - 22}" font-size="10" fill="var(--mut)" text-anchor="end" font-family="inherit">${esc(fmtDay(last))}</text>
    ${legend}
  </svg>`;
}

// Portfolio area chart
function fmtChartVal(v){
  if(v===0) return '0';
  // Use Swiss locale formatting: 1100 → 1'100, no k/M abbreviations
  return Math.round(v).toLocaleString(locale());
}
export function portfolioChartSVG(data, period, metric, yAxisData){
  const W=700, H=180, PAD={l:72,r:16,t:14,b:32};
  const iw=W-PAD.l-PAD.r, ih=H-PAD.t-PAD.b;
  const vals=data.map(d=>d.total||0);
  if(vals.length<2) return '<div style="color:var(--mut);font-size:.82rem;padding:1.5rem;text-align:center">Noch keine Verlaufsdaten.</div>';

  const rawMin=Math.min(...vals);
  const rawMax=Math.max(...vals);
  // Ensure meaningful Y range even if all values identical
  const spread = rawMax - rawMin;
  const padding = spread > 0 ? spread * 0.15 : rawMax * 0.1 || 1;
  const min = Math.max(0, rawMin - padding);
  const max = rawMax + padding;
  const range = max - min || 1;

  // Always blue — consistent with webapp brand color
  const color = '#2563eb';
  const n = vals.length;

  function px(i){ return PAD.l+(n===1 ? iw/2 : i/(n-1)*iw); }
  function py(v){ return PAD.t + ih - ((v-min)/range)*ih; }

  const pts  = vals.map((v,i)=>`${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const area = `${PAD.l},${PAD.t+ih} ${pts} ${(PAD.l+iw).toFixed(1)},${PAD.t+ih}`;

  // Y ticks: 5 evenly distributed values on the actual scale
  const yTicks = [0,0.25,0.5,0.75,1].map(t => {
    const v = min + t * range;
    const y = PAD.t + ih - t * ih;
    return `<line x1="${PAD.l}" y1="${y.toFixed(1)}" x2="${PAD.l+iw}" y2="${y.toFixed(1)}" stroke="var(--bdr)" stroke-width="0.8" stroke-dasharray="3,3"/>
<text x="${(PAD.l-5).toFixed(0)}" y="${(y+3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--mut)" font-family="monospace">${fmtChartVal(v)}</text>`;
  }).join('');

  // X labels: max 7 evenly spaced
  const step  = Math.max(1, Math.ceil(n/7));
  const xIdxs = [];
  for(let i=0; i<n; i+=step) xIdxs.push(i);
  if(xIdxs[xIdxs.length-1] !== n-1) xIdxs.push(n-1);

  // Detect if all labels share the same date → show hour instead
  const allDays = data.map(d => (d.day||'').substring(0,10));
  const uniqueDays = new Set(allDays);
  const useHour = uniqueDays.size === 1 && data[0].hour;

  const xLabels = xIdxs.map(i => {
    let lbl = '';
    if(useHour){
      // Show time HH:MM from hour field "YYYY-MM-DD HH"
      const h = (data[i].hour||'').split(' ')[1] || '';
      lbl = h ? `${h}:00` : (data[i].day||'');
    } else {
      lbl = data[i].day || '';
      if(/^\d{4}-\d{2}-\d{2}$/.test(lbl)){ const[,mm,dd]=lbl.split('-'); lbl=`${dd}.${mm}`; }
      else if(/^\d{4}-\d{2}$/.test(lbl)){ const[y,m]=lbl.split('-'); lbl=`${m}/${y.slice(2)}`; }
    }
    return `<text x="${px(i).toFixed(1)}" y="${H-6}" text-anchor="middle" font-size="10" fill="var(--mut)">${lbl}</text>`;
  }).join('');

  // Dots with tooltip
  const dots = vals.map((v,i) => {
    const isLast = i===n-1;
    return `<circle cx="${px(i).toFixed(1)}" cy="${py(v).toFixed(1)}" r="${isLast?4:2.5}"
      fill="${color}" stroke="white" stroke-width="1.2" opacity="${isLast?1:0.4}">
      <title>${data[i].day}: ${v.toLocaleString(locale(),{minimumFractionDigits:2})}</title>
    </circle>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-height:180px;display:block">
  <defs><linearGradient id="pcg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${color}" stop-opacity=".15"/>
    <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
  </linearGradient></defs>
  ${yTicks}${xLabels}
  <polygon points="${area}" fill="url(#pcg)"/>
  <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  ${dots}
</svg>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// VERSCHIEBEN — nur über den Kaufpreis
// ═══════════════════════════════════════════════════════════════════════════
// Hier stand eine Auswahl „Quellkonto → Zielkonto" im Fuss des Set-Dialogs,
// die das ganze Set auf einmal verschob. Sie ist entfernt: Verschoben wird
// über den KAUFPREIS, im Kaufpreis-Dialog, Zeile für Zeile.
//
// Der Grund ist nicht Bequemlichkeit, sondern Ehrlichkeit der Anzeige. Ein Set
// mit drei Erfassungen sind drei Käufe, und im Haushalt können sie
// verschiedenen Kindern gehören. „Das Set verschieben" verdeckt, was
// tatsächlich wandert. Wer alles verschieben will, ändert den Eigentümer jeder
// Zeile — und sieht dabei, wie viele es sind.
//
// Der Server erzwingt dieselbe Regel: POST /api/v1/sets/:sn/move ohne
// acquisition_ids antwortet mit 400.

/**
 * Lagerort eines Sets speichern.
 *
 * ── Warum beim Verlassen des Feldes und nicht auf Tastendruck ──────────────
 *
 * Wie die Menge daneben (`autosaveSet`): Ein Lagerort wird getippt, nicht
 * gewählt. Ein Speichern je Zeichen erzeugte sechs Anfragen für „Kiste 3" und
 * hinterliesse dabei fünf Zwischenstände in der Datenbank.
 */
export async function speichereSetLagerort(sn) {
  const el = G('m-storage');
  if (!el) return;
  const d = await api('PUT', `/v1/sets/${encodeURIComponent(sn)}/storage`, { storage: el.value });
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  // Die Liste im Hintergrund trägt den Ort ebenfalls — ohne Nachziehen zeigte
  // die Kachel den alten, bis jemand neu lädt.
  const eintrag = (allSets || []).find(x => x.set_number === sn);
  if (eintrag) eintrag.storage = d.storage;
  if (curSet && curSet.set_number === sn) curSet.storage = d.storage;
  await ladeLagerorte();
}

/**
 * Die bekannten Lagerorte in die gemeinsame <datalist> schreiben.
 *
 * EINE Liste für alle Eingabefelder (Set-Detail, Teil-Detail, Filter): Der
 * Ortsname ist frei, aber wer „Kiste 3" schon einmal getippt hat, soll ihn
 * beim nächsten Mal vorgeschlagen bekommen — sonst stehen „Kiste 3" und
 * „kiste 3" nebeneinander und die Übersicht zählt sie getrennt.
 */
/**
 * Preisalarm des offenen Sets laden und anzeigen.
 *
 * ── Warum nur der Zustand „neu" im Dialog steht ─────────────────────────────
 *
 * Der Server kann je Zustand einen Alarm — die Oberfläche bietet vorerst den
 * für NEU an, weil das der Fall ist, nach dem gefragt wurde. Die Trennung
 * steckt trotzdem schon im Server und in der Tabelle: Sie nachträglich
 * einzuziehen hiesse, bestehende Alarme zuordnen zu müssen, und das geht nicht
 * ohne Raten. Ein zweites Auswahlfeld hier ist dagegen eine Zeile.
 */
/**
 * Für WELCHEN Zustand der Alarm gilt — neu oder gebraucht.
 *
 * ── Warum das jetzt eine Wahl ist und keine Konstante ───────────────────────
 *
 * Hier stand `const ALARM_ZUSTAND = 'N'` mit der Begründung: „Die Oberfläche
 * bietet vorerst den für NEU an, weil das der Fall ist, nach dem gefragt
 * wurde. Ein zweites Auswahlfeld hier ist dagegen eine Zeile."
 *
 * Server und Tabelle konnten es die ganze Zeit — `price_alerts` hat den
 * Zustand im Schlüssel. Neu und gebraucht liegen oft um ein Vielfaches
 * auseinander; wer ein gebrauchtes Exemplar sucht, hatte bisher keine
 * Möglichkeit, darauf zu warten.
 */
/**
 * Welcher Alarmblock gerade gemeint ist: 'm' (Set-Detail) oder 'mk-m'
 * (Merkposten-Detail).
 *
 * ── Warum eine Modulvariable und kein Parameter ─────────────────────────────
 *
 * Die Handler werden vom Ereignis-Dispatcher über data-click/data-change
 * gerufen und bekommen genau EIN Argument: die Setnummer. Ein zweites
 * hiesse, sie in data-arg zu kodieren und überall wieder zu zerlegen.
 *
 * Eine Modulvariable ist hier gefahrlos, weil immer höchstens EIN Dialog
 * offen ist — beide setzen sie beim Öffnen. Stünden je zwei gleichzeitig
 * offen, wäre das falsch; dann gäbe es aber auch zwei gleiche IDs im
 * Dokument, und das ginge ohnehin schief.
 */
let _alarmFeld = 'm';
export function setzeAlarmFeld(praefix) { _alarmFeld = praefix === 'mk-m' ? 'mk-m' : 'm'; }
const alarmId = (teil) => `${_alarmFeld}-alert-${teil}`;

/**
 * Der Alarmblock — EINMAL formuliert, von beiden Dialogen benutzt.
 *
 * Das Merkposten-Detail zeigt denselben Alarm: Es ist derselbe Eintrag in
 * price_alerts, am selben Schlüssel. Eine zweite Maske dafür wäre die
 * nächste Stelle, an der eine Regel nur an einem der beiden Wege nachgezogen
 * wird — das ist in diesem Baum schon mehrfach passiert.
 */
export function alarmBlock(sn, praefix = 'm') {
  const p = praefix === 'mk-m' ? 'mk-m' : 'm';
  // Das Aussehen steht in styles.css unter .alarm-feld, nicht hier: Die feste
  // Hoehe im style-Attribut hat den gewaehlten Eintrag auf sechs Pixel
  // zusammengeschnitten (im Browser gemessen, Begruendung dort).
  return `
      <select id="${p}-alert-cond" class="alarm-feld" data-change="wechsleAlarmZustand" data-arg="${escJs(sn)}">
        <option value="N">${esc(tRaw('common.condition_new'))}</option>
        <option value="U">${esc(tRaw('common.condition_used'))}</option>
      </select>
      <select id="${p}-alert-dir" class="alarm-feld" data-change="speichereAlarm" data-arg="${escJs(sn)}">
        <option value="unter">${esc(tRaw('detail.alert_below'))}</option>
        <option value="ueber">${esc(tRaw('detail.alert_above'))}</option>
      </select>
      <input type="number" id="${p}-alert-val" class="alarm-feld" min="0" step="0.01" placeholder="—"
             data-input="alarmGetippt" data-arg="${escJs(sn)}"
             data-change="speichereAlarm" />
      <span id="${p}-alert-state" style="font-size:.72rem;color:var(--mut)"></span>
    `;
}

/**
 * Der Lagerort: ein AUSWAHLFELD, das auch neue Werte annimmt.
 *
 * ── Marcos Vorgabe ─────────────────────────────────────────────────────────
 *
 * „Das Feld Lagerort soll ein Auswahlfeld sein (analog den Feldern beim
 * Preisalarm), zusaetzlich sollen dort aber auch neue Werte erfasst werden
 * koennen."
 *
 * ── Warum die datalist das nicht war ───────────────────────────────────────
 *
 * Hier stand ein `<input list="lagerorte">`. Das nimmt Getipptes an und kennt
 * die Vorschlaege — aber es SIEHT aus wie ein Textfeld: kein Pfeil, und in
 * Chrome klappt die Liste auf einen Klick nicht auf. Wer sie nicht kennt,
 * findet sie nicht. Die App hat dafuer laengst ein richtiges Aufklappfeld
 * (ui/screens/LagerortFeld.kt) — die Webapp zieht hiermit nach.
 *
 * ── Wie beides zusammengeht ────────────────────────────────────────────────
 *
 * Ein `select` mit den bekannten Orten und einem letzten Eintrag „neuer Ort".
 * Wird der gewaehlt, erscheint das Textfeld daneben. Das Textfeld traegt die
 * urspruengliche Kennung und die urspruenglichen data-Attribute weiter — es
 * ist nach wie vor DAS Feld, das gespeichert wird. Eine Wahl aus der Liste
 * schreibt nur hinein und loest sein change-Ereignis aus; damit laeuft das
 * Speichern durch DENSELBEN Weg wie eine Eingabe von Hand, und es gibt keine
 * zweite Fassung der Speicherregel.
 *
 * @param id     Kennung des TEXTFELDES (m-storage, setitem-storage) — die
 *               Auswahl bekommt dieselbe mit dem Zusatz "-sel".
 * @param wert   Aktueller Lagerort, oder leer.
 * @param attrs  Weitere Attribute fuers Textfeld (data-change, data-part, …).
 */
/**
 * Wie der Eintrag „neuer Ort" erkannt wird.
 *
 * Als data-Attribut und NICHT ueber einen abgemachten Wert: Jeder Wert, den
 * man sich ausdenkt, kann jemand als Lagerort eintippen — und ein
 * Steuerzeichen als Notloesung waere schlimmer, HTML ersetzt U+0000 beim
 * Einlesen durch U+FFFD, der Vergleich ginge still schief. Das Attribut kann
 * mit keinem Ortsnamen kollidieren.
 */
const ORT_NEU_MARKE = 'data-neu="1"';
const istNeuEintrag = (sel) => sel?.selectedOptions?.[0]?.dataset?.neu === '1';
let _orte = [];

/**
 * Den Vorrat merken und bereits gezeichnete Auswahlfelder nachziehen.
 *
 * Die Orte kommen ueber das Netz, der Dialog steht aber schon. Ohne das
 * Nachziehen zeigte die erste Anzeige eine leere Auswahl — und genau dann
 * schaut man hin.
 */
export function setzeOrtVorrat(namen) {
  _orte = [...new Set((namen || []).filter(Boolean).map(String))]
    .sort((a, b) => a.localeCompare(b));
  for (const sel of document.querySelectorAll('select[data-ortauswahl]')) {
    // Steht die Auswahl gerade auf „neuer Ort", soll sie dort stehen bleiben —
    // sonst spraenge sie jemandem beim Tippen unter der Hand weg.
    const warNeu = istNeuEintrag(sel);
    const vorher = sel.value;
    sel.innerHTML = ortOptionen(vorher);
    if (warNeu) sel.selectedIndex = sel.options.length - 1;
    else if ([...sel.options].some(o => o.value === vorher)) sel.value = vorher;
  }
}

function ortOptionen(wert) {
  const bekannt = _orte.includes(wert);
  return [
    `<option value="">${esc(tRaw('detail.storage_none'))}</option>`,
    // Ein Ort, den der Vorrat (noch) nicht kennt — etwa weil er gerade erst
    // eingetippt wurde —, muss trotzdem dastehen, sonst spraenge die Anzeige
    // auf „—" zurueck.
    ...(wert && !bekannt ? [`<option value="${esc(wert)}" selected>${esc(wert)}</option>`] : []),
    ..._orte.map(o => `<option value="${esc(o)}"${o === wert ? ' selected' : ''}>${esc(o)}</option>`),
    // IMMER zuletzt: setzeOrtVorrat() greift ihn ueber options.length - 1 ab.
    `<option value="" ${ORT_NEU_MARKE}>${esc(tRaw('detail.storage_new'))}</option>`,
  ].join('');
}

export function lagerortBlock(id, wert, attrs = '') {
  const ort = String(wert || '');
  return `
      <select id="${id}-sel" class="alarm-feld" data-ortauswahl="1"
              data-change="lagerortGewaehlt" data-arg="${id}">${ortOptionen(ort)}</select>
      <input type="text" id="${id}" class="alarm-feld" maxlength="60" style="display:none"
             placeholder="${esc(tRaw('detail.storage_ph'))}" value="${esc(ort)}"
             data-blur="lagerortGetippt" ${attrs} />
    `;
}

/**
 * Aus der Liste gewaehlt — oder „neuer Ort".
 *
 * @param id Kennung des Textfeldes; die Auswahl heisst id + "-sel".
 */
export function lagerortGewaehlt(id) {
  const sel = G(`${id}-sel`), feld = G(id);
  if (!sel || !feld) return;
  if (istNeuEintrag(sel)) {
    // Leeren, zeigen, Fokus: Wer „neuer Ort" waehlt, will tippen — nicht erst
    // den alten Namen wegloeschen.
    feld.value = '';
    feld.style.display = '';
    feld.focus();
    return;
  }
  feld.style.display = 'none';
  feld.value = sel.value;
  // Das change-Ereignis von Hand: Ein programmatisch gesetzter Wert loest
  // keines aus. Ueber die Ereignis-Delegation (11-actions.js) landet es bei
  // genau dem Handler, der auch eine Eingabe von Hand speichert.
  feld.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Ein neuer Ort ist fertig getippt (das Feld wurde verlassen).
 *
 * Gespeichert hat das change-Ereignis des Feldes selbst — hier wird nur die
 * Auswahl daneben nachgezogen, damit der neue Name darin steht und nicht
 * weiter „neuer Ort" angezeigt wird.
 *
 * `this` ist das Feld: Die Delegation ruft den Handler mit dem Element als
 * Empfaenger auf (11-actions.js, fn.apply(el, args)). Ein data-self="1" waere
 * hier falsch — dasselbe Attribut gaelte auch fuer das change-Ereignis und
 * schoebe dem Speichern ein Argument unter.
 */
export function lagerortGetippt() {
  const feld = this;
  const sel = G(`${feld?.id}-sel`);
  if (!sel) return;
  const ort = String(feld.value || '').trim();
  if (!_orte.includes(ort) && ort) _orte = [..._orte, ort].sort((a, b) => a.localeCompare(b));
  sel.innerHTML = ortOptionen(ort);
  sel.value = ort;
  if (ort) feld.style.display = 'none';
}

function alarmZustand() {
  return G(alarmId('cond'))?.value === 'U' ? 'U' : 'N';
}

export async function ladeAlarm(sn) {
  const d = await api('GET', `/v1/sets/${encodeURIComponent(sn)}/alert`).catch(() => null);
  const dir = G(alarmId('dir')), val = G(alarmId('val'));
  if (!dir || !val) return;
  const a = (d?.alerts || []).find(x => x.condition === alarmZustand());
  dir.value = a?.richtung || 'unter';
  val.value = a ? String(a.schwelle) : '';
  zeigeAlarmMerker(a);
}

/**
 * Nur den Merker nachführen — OHNE das Eingabefeld anzufassen.
 *
 * Getrennt von ladeAlarm(), und das ist der Kern der Entprellung: Während
 * getippt wird, darf die Antwort des Servers nicht ins Feld zurückschreiben.
 * Wer „249.90" tippt, hat nach der Ruhezeit hinter „249.9" vielleicht schon
 * die letzte Null gesetzt — ladeAlarm() machte daraus wieder „249.9" und
 * fräse dem Tippenden das Zeichen weg.
 */
function zeigeAlarmMerker(a) {
  const st = G(alarmId('state'));
  if (!st) return;
  // Der Merker sagt, ob schon gemeldet wurde. Ihn zu zeigen ist der
  // Unterschied zwischen „der Alarm steht" und „der Alarm hat gefeuert" —
  // sonst fragt man sich, warum keine Mail mehr kommt.
  st.textContent = !a ? ''
    : a.ausgeloest ? tRaw('detail.alert_fired') : tRaw('detail.alert_armed');
}

/**
 * Auf den anderen Zustand umschalten.
 *
 * LÄDT, speichert NICHT — und das ist der Punkt: Ein Wechsel ist die Frage
 * „was steht für gebraucht?", keine Eingabe. Würde hier gespeichert, legte
 * schon das Umschalten einen Alarm im neuen Zustand an (oder löschte ihn,
 * wenn das Feld leer ist). Eine noch laufende Ruhezeit wird verworfen, damit
 * nicht kurz darauf die Schwelle des ALTEN Zustands beim neuen landet.
 */
export function wechsleAlarmZustand(sn) {
  clearTimeout(_alarmRuhe); _alarmRuhe = null;
  return ladeAlarm(sn);
}

/**
 * Wie lange Ruhe herrschen muss, bevor beim Tippen gespeichert wird.
 *
 * Dieselbe Zahl wie in der App (Alarmeingabe.RUHE_MS) — laufen die beiden
 * auseinander, verhält sich dasselbe Feld an zwei Stellen verschieden, ohne
 * dass es jemandem auffiele.
 */
const ALARM_RUHE = 800;
let _alarmRuhe = null;

/**
 * Beim Tippen speichern — entprellt.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 *
 * „Der Preisalarm wird nicht gespeichert … soll gespeichert werden, wenn man
 * was einträgt. Analog dem Kaufpreis."
 *
 * Bis hierher hing das Feld an `change`, also am Verlassen des Feldes. Wer
 * tippt und das Fenster schliesst, ohne vorher woanders hinzuklicken, verlor
 * die Eingabe.
 *
 * ── Warum die Werte JETZT festgehalten werden ───────────────────────────────
 *
 * Der Zeitgeber feuert bis zu ALARM_RUHE später. Läse er die Felder erst
 * dann, wären sie womöglich gar nicht mehr da — das Detailfenster ist
 * inzwischen zu, G() liefert null, und die Eingabe wäre wieder verloren. Das
 * ist genau der Fehler, den diese Änderung beheben soll; deshalb steht hier
 * eine Kopie und kein zweiter Blick in den Baum.
 */
export function alarmGetippt(sn) {
  const dir = G(alarmId('dir')), val = G(alarmId('val'));
  if (!dir || !val) return;
  const richtung = dir.value, roh = String(val.value || '').trim();
  clearTimeout(_alarmRuhe);
  _alarmRuhe = setTimeout(() => { _alarmRuhe = null; sendeAlarm(sn, richtung, roh); }, ALARM_RUHE);
}

/**
 * Preisalarm speichern oder löschen — SOFORT.
 *
 * Für die Richtung: Sie wird gewählt, nicht getippt, und eine Ruhezeit auf
 * eine einzelne Wahl wäre nur eine Verzögerung ohne Gewinn. Eine noch
 * laufende Ruhezeit wird dabei verworfen, damit nicht kurz darauf die alte
 * Richtung hinterherkommt.
 */
export function speichereAlarm(sn) {
  const dir = G(alarmId('dir')), val = G(alarmId('val'));
  if (!dir || !val) return;
  clearTimeout(_alarmRuhe); _alarmRuhe = null;
  return sendeAlarm(sn, dir.value, String(val.value || '').trim());
}

/**
 * Der eine Weg zum Server.
 *
 * Ein leeres Feld heisst LÖSCHEN, nicht „Schwelle 0": Die natürliche Geste,
 * einen Alarm loszuwerden, ist das Feld zu leeren — ein eigener Knopf daneben
 * wäre ein zweiter Weg für dieselbe Absicht.
 *
 * Ein halber Anfang („-", "abc") ist keine Zahl und damit ein Löschen.
 * „249." dagegen NICHT: `parseFloat("249.")` ist 249 — das hatte ich zuerst
 * falsch behauptet und erst gemessen, als der Android-Lauf meinen Test dazu
 * rot meldete. Dieselbe Lesart wie in Alarmeingabe.zahl().
 *
 * Der Grund für ALARM_RUHE ist damit ein anderer und ein besserer: Wer „249"
 * tippen will, tippt unterwegs „2" und „24". Ohne Ruhezeit stünde am Ende
 * eine Schwelle bei 2 — und die meldet sofort.
 */
async function sendeAlarm(sn, richtung, roh) {
  const zahl = parseFloat(String(roh).replace(',', '.'));
  const loeschen = !(zahl > 0);
  const cond = alarmZustand();
  const d = loeschen
    ? await api('DELETE', `/v1/sets/${encodeURIComponent(sn)}/alert?condition=${cond}`)
    : await api('PUT', `/v1/sets/${encodeURIComponent(sn)}/alert`,
                { richtung, schwelle: zahl, condition: cond });
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  // Nur den Merker, nicht das Feld — die Begründung steht an zeigeAlarmMerker().
  zeigeAlarmMerker(loeschen ? null : d.alert);
}

/**
 * Beim Oeffnen zeigen, welche Alarme seit dem letzten Besuch ausgeloest haben.
 *
 * ── Warum die Webapp das auch tut ───────────────────────────────────────────
 *
 * Die Android-App fragt stuendlich im Hintergrund nach und meldet es als
 * Benachrichtigung (alarm/PreisalarmWorker.kt). Ohne dieses Gegenstueck waere
 * der Preisalarm die erste Funktion, die in der App mehr kann als hier — und
 * genau das soll nicht passieren.
 *
 * Ein Hintergrundlauf ist im Browser nicht das Gegenstueck: Eine
 * geschlossene Seite fragt nichts ab, und ein Service Worker mit Web-Push
 * waere derselbe schwere Apparat, den die App mit Firebase bewusst vermeidet.
 * Das ehrliche Gegenstueck ist: beim Oeffnen nachfragen.
 *
 * ── Die Marke kommt vom SERVER ──────────────────────────────────────────────
 *
 * Dieselbe Begruendung wie in Alarmabholung.kt: Naehme die Seite ihre eigene
 * Uhr, entschiede die Gangabweichung zum Server darueber, ob eine Meldung
 * doppelt kommt oder ausfaellt.
 *
 * Je Konto eine eigene Marke: An einem Rechner melden sich durchaus zwei
 * Leute an, und die Marke des einen darf die Meldungen des anderen nicht
 * verschlucken.
 */
export async function zeigeOffeneAlarme() {
  if (!ME?.id) return;
  const schluessel = 'bim_alarm_marke_' + ME.id;
  let marke = null;
  try { marke = localStorage.getItem(schluessel); } catch (_) {}
  const d = await api('GET', '/v1/alerts/pending' + (marke ? '?since=' + encodeURIComponent(marke) : ''))
    .catch(() => null);
  // Ohne `now` keine neue Marke — und ohne neue Marke lieber gar nichts
  // speichern als eine falsche.
  if (!d?.success || !d.now) return;
  try { localStorage.setItem(schluessel, String(d.now)); } catch (_) {}
  // Erster Besuch: nur merken, nichts melden. Sonst schlaegt ein frisch
  // angemeldetes Konto mit Schwellen auf, die vor Wochen gerissen sind.
  if (!marke) return;
  const unter = tRaw('detail.alert_below'), ueber = tRaw('detail.alert_above');
  for (const a of (d.alerts || [])) {
    const richtung = a.richtung === 'unter' ? unter : ueber;
    const schwelle = Number(a.schwelle).toFixed(2);
    // Derselbe Aufbau wie Alarmabholung.text() in der App — wer beides
    // benutzt, soll nicht zwei Formulierungen derselben Meldung lesen.
    const txt = a.zuletzt_preis == null
      ? `${a.set_number}: ${richtung} ${a.currency_code} ${schwelle}`
      : `${a.set_number}: ${a.currency_code} ${Number(a.zuletzt_preis).toFixed(2)} ` +
        `(${richtung} ${a.currency_code} ${schwelle})`;
    toast(txt, 'info');
  }
}

/**
 * Die Auswahlliste im Detailfenster — der VORRAT des Besitzers.
 *
 * ── Marcos Festlegung ───────────────────────────────────────────────────────
 *
 * „Der Grossvater soll die Werte der Enkel für die entsprechenden Sets sehen
 * und wählen können."
 *
 * Ein Lagerort ist ein Regal in einer Wohnung. Beim Set des Enkels gehören
 * die Regale des ENKELS zur Wahl — ein Set des Enkels in „Grossvaters Keller"
 * wäre eine Aussage über die falsche Wohnung.
 *
 * Ohne `owners` (Einzelkonto, oder eine Zeile ohne Besitzerplakette) bleibt
 * der Parameter weg, und der Server antwortet mit der eigenen Liste. Genau
 * das ist dann auch richtig.
 *
 * ── Warum eine datalist und kein select ─────────────────────────────────────
 *
 * Marco will beides: auswählen UND neue Werte gleich erfassen. Ein `select`
 * kann nur das erste, ein Textfeld nur das zweite. Eine `datalist` klappt auf
 * wie ein Auswahlfeld und nimmt trotzdem Getipptes an — und was getippt wird,
 * landet im Vorrat (setzeLagerort in utils/lagerort.ts).
 */
export async function ladeOrtAuswahl(besitzer) {
  const dl = G('lagerorte');
  if (!dl) return;
  const ids = (besitzer || []).map(o => o?.id ?? o).filter(n => Number.isFinite(Number(n)));
  const frage = ids.length ? '?owner=' + encodeURIComponent(ids.join(',')) : '';
  const d = await api('GET', '/v1/storage/locations' + frage).catch(() => null);
  if (!d?.success) return;
  dl.innerHTML = (d.orte || []).map(o => `<option value="${esc(o.name)}"></option>`).join('');
  // Dieselbe Liste speist das Auswahlfeld im Detail (lagerortBlock).
  setzeOrtVorrat((d.orte || []).map(o => o.name));
}

export async function ladeLagerorte() {
  const d = await api('GET', '/v1/storage' + scopeQuery('gallery')).catch(() => null);
  if (!d?.success) return;
  const orte = d.orte || [];
  const dl = G('lagerorte');
  if (dl) dl.innerHTML = orte.map(o => `<option value="${esc(o.ort)}"></option>`).join('');
  setzeOrtVorrat(orte.map(o => o.ort));
  // Dieselbe Liste speist die Filter-Auswahlfelder. Sie getrennt zu holen
  // hiesse, dass Vorschlag und Filter kurzzeitig zwei Staende zeigen.
  initStorageSelects(orte);
}

export async function openModal(sn){
  const [d, ad] = await Promise.all([
    api('GET',`/v1/sets/${sn}`),
    api('GET',`/v1/sets/${sn}/acquisitions`).catch(()=>null)
  ]);
  if(!d?.success){toast(tRaw('settings.error'),'error');return;}
  set_curSet(d.set);
  G('m-tit').textContent=curSet.set_number;
  // fullUrl(): volle Auflösung, auch wenn image_local auf die _thumb-Datei zeigt
  const img=G('m-img'); img.src=fullUrl(curSet.image_local||curSet.image_url)||'/assets/set-placeholder.svg'; img.style.display='block';

  const addedFmt = curSet.added_at ? new Date(curSet.added_at).toLocaleDateString(locale()) : '—';
  const cached = _pnlCache[sn];
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
      <button class="btn bs btn-sm" data-click="mQtyDec" style="font-size:1rem;padding:2px 8px;line-height:1">−</button>
      <input type="number" id="m-qty" min="1" style="width:46px;text-align:center;border:1px solid var(--bdr);border-radius:6px;padding:2px;font-weight:600" data-change="autosaveSet" />
      <button class="btn bs btn-sm" data-click="mQtyInc" style="font-size:1rem;padding:2px 8px;line-height:1">+</button>
    `, { wertStil: 'display:flex;align-items:center;gap:6px' });

  // Acquisition summary: compact read-only rows + button to open full editor
  const acqs = ad?.acquisitions || [];
  const acqRows = detailZeile(t('detail.purchase_price'), `
      ${renderAcquisitionSummary(acqs, sn)}
      <button class="btn bs btn-sm" data-click="openAcqModal" data-arg="${escJs(sn)}" style="margin-top:4px;font-size:.75rem;padding:2px 10px">✏️ ${t('detail.edit_prices')}</button>
    `, { zeilenStil: 'align-items:flex-start',
         wertId: 'm-acq-summary',
         wertStil: 'flex-direction:column;align-items:flex-end;gap:3px' });

  G('m-det').innerHTML = `
    ${detailZeile('Name', textOderStrich(curSet.name))}
    ${detailZeile(t('detail.year'), oderStrich(curSet.year))}
    ${detailZeile(t('detail.theme'), esc(oderStrich(curSet.theme)))}
    ${qtyRow}
    ${detailZeile(t('detail.pieces'), `${curSet.pieces ? curSet.pieces.toLocaleString(locale()) : '—'} <button class="btn bs btn-sm" data-click="reimportParts" data-arg="${escJs(sn)}" title="${t('detail.reimport_parts')}" style="padding:1px 6px;font-size:.75rem;margin-left:4px">${PARTS_ICON_SVG}</button>`)}
    ${detailZeile(t('detail.minifigs'), oderStrich(curSet.minifigs), { wertId: 'm-minifigs-val' })}
    ${detailZeile(t('detail.added'), `📅 ${addedFmt}`)}
    ${detailZeile(t('detail.alert'), alarmBlock(sn), {
         zeilenStil: 'align-items:flex-start',
         wertStil: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end' })}
    ${detailZeile(t('detail.storage'),
        lagerortBlock('m-storage', curSet.storage,
                      `data-change="speichereSetLagerort" data-arg="${escJs(sn)}"`),
        { wertStil: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end' })}
    ${acqRows}
    ${priceRow}${pnlRow}
    <div id="m-price-chart" style="margin-top:.75rem">
      <div style="font-size:.73rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--mut);margin-bottom:4px">${t('detail.price_history')}</div>
      <div class="sparkline-wrap" id="m-sparkline-content"><span style="color:var(--mut);font-size:.78rem">${t('common.loading')}</span></div>
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
      ? priceChartSVG(ph, sn.replace(/[^a-zA-Z0-9]/g, ''))
      : `<span style="color:var(--mut);font-size:.78rem">${t('detail.no_history')}</span>`;
  });

}

// ── JOB STATUS ───────────────────────────────────────────
export let jobPollTimer = null;
export let _lastImportAt = 0; // timestamp of last set import

function formatDur(ms) {
  if (!ms) return '';
  if (ms < 60000) return `${(ms/1000).toFixed(1)}s`;
  return `${Math.floor(ms/60000)}m ${Math.floor((ms%60000)/1000)}s`;
}

export async function pollJobStatus() {
  const d = await api('GET', '/v1/admin/job-status');
  if (!d.success) return;
  const j = d.job;
  const dot = G('job-dot');
  const stxt = G('job-status-txt');
  const sdet = G('job-status-detail');
  const pwrap = G('job-progress-wrap');
  const pbar = G('job-prog-bar');
  const ptxt = G('job-prog-txt');
  const btn = G('btn-job-trigger');

  if (j.running) {
    dot.style.background = 'var(--b500)';
    dot.style.animation = 'sp .8s linear infinite';
    stxt.textContent = tRaw('monitor.job_running');
    if (j.progress) {
      const pct = j.progress.total ? (j.progress.current / j.progress.total * 100) : 0;
      pwrap.style.display = 'flex';
      pbar.style.width = pct + '%';
      ptxt.textContent = `${j.progress.current}/${j.progress.total}`;
      sdet.textContent = j.progress.set ? t('monitor.current',{set:j.progress.set}) : '';
    }
    btn.disabled = true;
    // Poll faster while running
    if (jobPollTimer) clearTimeout(jobPollTimer);
    jobPollTimer = setTimeout(pollJobStatus, 2000);
  } else {
    dot.style.animation = '';
    pwrap.style.display = 'none';
    btn.disabled = false;
    if (j.lastRun) {
      dot.style.background = j.lastErrors > 0 ? 'var(--a500)' : 'var(--g500)';
      stxt.textContent = tRaw('monitor.last_run_at',{time:new Date(j.lastRun).toLocaleString(locale())});
      const parts = [];
      if (j.lastUpdated) parts.push(`${j.lastUpdated} ${t('common.updated')}`);
      if (j.lastErrors)  parts.push(t('monitor.errors_n',{n:j.lastErrors}));
      if (j.lastDuration) parts.push(formatDur(j.lastDuration));
      sdet.textContent = parts.join(' · ') + (j.nextRun ? ` · ${t('monitor.next_run')} ${new Date(j.nextRun).toLocaleTimeString(locale())}` : '');
    } else {
      dot.style.background = 'var(--s300)';
      stxt.textContent = tRaw('monitor.waiting_first');
      sdet.textContent = j.nextRun ? `Startet um: ${new Date(j.nextRun).toLocaleTimeString(locale())}` : '';
    }
    // Poll every 30s while idle
    if (jobPollTimer) clearTimeout(jobPollTimer);
    jobPollTimer = setTimeout(pollJobStatus, 30000);
  }
}

export async function triggerCsvSync(btn) {
  btn.disabled = true; btn.textContent = tRaw('monitor.starting');
  const d = await api('POST', '/v1/admin/trigger-csv-sync').catch(() => null);
  if (d?.success) {
    toast(tRaw('monitor.sync_started'), 'success');
    btn.textContent = tRaw('monitor.started');
    setTimeout(() => { btn.disabled = false; btn.textContent = tRaw('monitor.sync_now'); }, 5000);
  } else {
    toast(d?.error || t('settings.error'), 'error');
    btn.disabled = false; btn.textContent = tRaw('monitor.sync_now');
  }
}

/**
 * Alle fehlenden Katalogbilder einreihen.
 *
 * Marcos Wunsch: „Wenn dieser geklickt wird, sollen alle fehlenden Bilder des
 * Katalogs heruntergeladen werden resp. in die Queue gestellt werden."
 *
 * Der Server reiht nur ein — geholt wird im Hintergrund, gedrosselt
 * (jobs/imageQueue.ts). Die Rückmeldung nennt deshalb die Zahl der Aufträge,
 * nicht der Bilder: „gestartet" wäre irreführend, das dauert je nach
 * Katalogumfang Stunden.
 */
export async function queueCatalogImages(btn) {
  btn.disabled = true; btn.textContent = tRaw('monitor.starting');
  const d = await api('POST', '/v1/admin/catalog-images').catch(() => null);
  if (d?.success) {
    // Beide Zahlen nennen: was ansteht UND was schon fertig war. Ohne die
    // zweite sähe ein „0 Bilder in der Warteschlange" nach einem Fehlschlag
    // aus, obwohl es die beste aller Meldungen ist — alles ist da.
    const n = (d.pending ?? 0).toLocaleString(locale());
    const fertig = d.skipped ?? 0;
    const teile = [fertig > 0
      ? tRaw('monitor.catalog_images_queued_skipped',
             { n, fertig: fertig.toLocaleString(locale()) })
      : tRaw('monitor.catalog_images_queued', { n })];
    // Zurückgenommene Fehlanzeigen und die geschätzte Dauer nur nennen, wenn es
    // etwas zu nennen gibt — sonst wächst die Meldung um zwei Nullen.
    if (d.verworfen > 0)
      teile.push(tRaw('monitor.catalog_images_retried',
                      { n: d.verworfen.toLocaleString(locale()) }));
    if (d.dauer_minuten > 0)
      teile.push(tRaw('monitor.catalog_images_eta',
                      { n: d.dauer_minuten.toLocaleString(locale()) }));
    toast(teile.join(' · '), 'success');
    btn.textContent = '✅';
    setTimeout(() => { btn.disabled = false; btn.textContent = tRaw('monitor.catalog_images'); }, 5000);
  } else {
    toast(d?.error || t('settings.error'), 'error');
    btn.disabled = false; btn.textContent = tRaw('monitor.catalog_images');
  }
}

export async function redownloadMissingImages(btn) {
  btn.disabled = true; btn.textContent = tRaw('monitor.starting');
  const d = await api('POST', '/v1/admin/redownload-missing-images').catch(() => null);
  if (d?.success) {
    toast(tRaw('monitor.redownload_started'), 'success');
    btn.textContent = '✅';
    setTimeout(() => { btn.disabled = false; btn.textContent = tRaw('monitor.redownload_missing'); }, 5000);
  } else {
    toast(d?.error || t('settings.error'), 'error');
    btn.disabled = false; btn.textContent = tRaw('monitor.redownload_missing');
  }
}

export async function reimportMissingInstructions(btn) {
  btn.disabled = true; btn.textContent = '⏳ '+t('common.loading');
  const d = await api('POST', '/v1/admin/reimport-instructions').catch(() => null);
  if (d?.success) {
    toast(tRaw('monitor.enqueued',{n:d.enqueued}), 'success');
    btn.textContent = tRaw('monitor.enqueued_short',{n:d.enqueued});
    setTimeout(() => { btn.disabled = false; btn.textContent = tRaw('monitor.import_missing'); }, 4000);
  } else {
    toast(d?.error || t('settings.error'), 'error');
    btn.disabled = false; btn.textContent = tRaw('monitor.import_missing');
  }
}

export async function toggleBricksetQueue(btn) {
  const panel = G('brickset-queue-panel');
  if (!panel) return;
  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    const lbl = btn.querySelector('span') || btn; lbl.textContent = tRaw('monitor.show');
    return;
  }
  btn.textContent = '⏳ '+t('common.loading');
  await loadBricksetQueue();
  btn.textContent = tRaw('monitor.collapse');
}

/**
 * Warteschlange holen und zeichnen — ohne Umschalten.
 *
 * Aus toggleBricksetQueue() herausgelöst, damit Retry und Löschen die Liste
 * nachladen können. Vorher ging beides nur über das Umschalten, und ein Aufruf
 * hätte die Anzeige zugeklappt statt aktualisiert — deshalb blieben Eintrag,
 * Versuchszähler und retry_after nach einem Klick sichtbar unverändert stehen.
 */
export async function loadBricksetQueue() {
  const panel = G('brickset-queue-panel');
  if (!panel) return;
  const d = await api('GET', '/v1/admin/brickset-queue').catch(() => null);
  if (!d?.success) { panel.innerHTML = `<div style="color:var(--r500)">${t('monitor.load_error')}</div>`; panel.style.display='block'; return; }
  if (!d.entries?.length) { panel.innerHTML = `<div style="font-size:.8rem;color:var(--mut)">${t('monitor.no_entries')}</div>`; panel.style.display='block'; return; }
  panel.innerHTML = `
    <div style="font-size:.78rem;font-weight:700;color:var(--mut);margin-bottom:.5rem;text-transform:uppercase;letter-spacing:.5px">${t('monitor.queue_entries',{n:d.count})}</div>
    <div style="display:flex;flex-direction:column;gap:.4rem;max-height:400px;overflow-y:auto">
      ${d.entries.map(e => `
        <div id="bsq-${esc(e.set_number)}" style="display:flex;align-items:flex-start;gap:.5rem;padding:.5rem .6rem;background:var(--s50);border-radius:6px;font-size:.8rem">
          <div style="flex:1;min-width:0">
            <div style="font-weight:600">${esc(e.set_number)}${e.name ? ` — ${esc(e.name)}` : ''}</div>
            <div style="color:var(--mut);margin-top:.15rem">${t('monitor.attempt',{a:e.attempts,r:e.retry_after})}</div>
            ${e.last_error ? `
            <details style="margin-top:.25rem">
              <summary style="cursor:pointer;color:var(--r500);font-size:.75rem;user-select:none">${t('monitor.show_last_error')}</summary>
              <div style="margin-top:.2rem;padding:.3rem .4rem;background:var(--s100);border-radius:4px;font-family:monospace;font-size:.72rem;white-space:pre-wrap;word-break:break-all;color:var(--r600);max-height:100px;overflow-y:auto">${esc(e.last_error)}</div>
            </details>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:.3rem;flex-shrink:0">
            <button class="btn bs btn-sm" style="padding:2px 8px;font-size:.72rem"
              data-click="retryBricksetQueueEntry" data-arg="${esc(e.set_number)}" data-self="1">🔄</button>
            <button class="btn bd btn-sm" style="padding:2px 8px;font-size:.72rem"
              data-click="deleteBricksetQueueEntry" data-arg="${esc(e.set_number)}" data-self="1">🗑️</button>
          </div>
        </div>`).join('')}
    </div>`;
  panel.style.display = 'block';
}

/**
 * ── Argumentreihenfolge ─────────────────────────────────────────────────────
 * Der Dispatcher (js/11-actions.js) legt bei data-self="1" ZUERST das Element
 * an und hängt danach die data-arg-Werte an:
 *
 *     if (el.dataset.self === '1') args.push(el);
 *     for (const key of ['data-arg', …]) args.push(…);
 *
 * Die Signatur lautete (setNumber, btn) — genau verdreht. Folge: setNumber war
 * das Knopf-Element. Die Meldung zeigte deshalb
 * "[object HTMLButtonElement] wird erneut versucht", und die Adresse lautete
 * /v1/admin/brickset-queue/[object%20HTMLButtonElement]/retry — der Server
 * fand unter diesem Namen nie einen Eintrag und setzte dessen retry_after
 * folglich nie zurück.
 *
 * Die übrigen data-self-Handler (triggerCsvSync, toggleBricksetQueue, …) haben
 * kein data-arg und waren deshalb nie betroffen.
 */
async function retryBricksetQueueEntry(btn, setNumber) {
  btn.disabled = true; btn.textContent = '⏳';
  const d = await api('POST', `/v1/admin/brickset-queue/${setNumber}/retry`).catch(() => null);
  if (d?.success) {
    btn.textContent = '✅';
    toast(tRaw('monitor.retrying',{set:setNumber}), 'success');
    // Warteschlange neu zeichnen — retry_after und Versuchszähler haben sich
    // geändert. Vorher blieb der Eintrag mit den alten Werten stehen, was wie
    // ein wirkungsloser Klick aussah.
    loadBricksetQueue();
    setTimeout(() => { btn.disabled = false; btn.textContent = '🔄'; }, 3000);
  } else {
    btn.disabled = false; btn.textContent = '🔄';
    toast(tRaw('monitor.retry_error'), 'error');
  }
}

// Gleiche Reihenfolge wie retryBricksetQueueEntry oben — Element zuerst.
async function deleteBricksetQueueEntry(btn, setNumber) {
  const row = G(`bsq-${setNumber}`);
  // Remove immediately from UI
  if (row) row.style.opacity = '0.4';
  btn.disabled = true; btn.textContent = '⏳';
  const d = await api('DELETE', `/v1/admin/brickset-queue/${setNumber}`).catch(() => null);
  if (d?.success) {
    if (row) row.remove();
    toast(tRaw('monitor.removed_fallback',{set:setNumber}), 'success');
  } else {
    if (row) row.style.opacity = '1';
    btn.disabled = false; btn.textContent = '🗑️';
    toast(tRaw('monitor.delete_error'), 'error');
  }
}

G('btn-job-trigger').onclick = async () => {
  const d = await api('POST', '/v1/admin/trigger-price-job');
  if (d.success && d.started) { toast(tRaw('monitor.job_started'), 'info'); setTimeout(pollJobStatus, 1000); }
  else if (d.success && !d.started) toast(tRaw('monitor.job_already'), 'info');
  else toast(d.error || t('settings.error'), 'error');
};



// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
registerActions({
  deleteBricksetQueueEntry,
  importConfig,
  openModal,
  redownloadMissingImages,
  queueCatalogImages,
  reimportMissingInstructions,
  retryBricksetQueueEntry,
  speichereAlarm,
  alarmGetippt,
  wechsleAlarmZustand,
  speichereSetLagerort,
  lagerortGewaehlt,
  lagerortGetippt,
  toggleBricksetQueue,
  triggerCsvSync,
});

/**
 * Setter für jobPollTimer — importierte Bindungen sind in ES-Modulen schreibgeschützt.
 * Ersetzt die frühere direkte Zuweisung aus einer anderen Datei, die mit
 * globalen Variablen noch möglich war.
 * @param {any} v
 */
export function set_jobPollTimer(v) { jobPollTimer = v; }

/**
 * Setter für _lastImportAt — importierte Bindungen sind in ES-Modulen schreibgeschützt.
 * Ersetzt die frühere direkte Zuweisung aus einer anderen Datei, die mit
 * globalen Variablen noch möglich war.
 * @param {any} v
 */
export function set_lastImportAt(v) { _lastImportAt = v; }

