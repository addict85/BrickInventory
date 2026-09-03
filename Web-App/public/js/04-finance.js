import { ladeAnzeige } from './01-bausteine.js';
import { registerActions } from './00-registry.js';
import { colorName, locale, t, tRaw} from '../i18n.js';
import { CURRENCY, G, api, esc, escJs, escUrl, fmtN, imgUrl, thumbUrl, toast } from './01-core.js';
import { scopeMode, scopeQuery } from './14-scope.js';
import { PARTS_ICON_SVG, _pnlCache, condBadges, ownerBadges, pnlBadge } from './02-gallery.js';
import { loadCacheStats } from './05-settings.js';
import { openModal, portfolioChartSVG } from './07-admin.js';

// ═══ Finanzen: Bewertung, G&V, Portfolio-Chart ═══
// Teil von app.js — die Dateien in public/js/ werden in nummerierter
// Reihenfolge geladen und teilen sich den globalen Scope (kein Modul-
// System noetig, Inline-onclick-Handler in index.html funktionieren
// unveraendert). Der Split ist rein sequenziell und verhaelt sich
// identisch zur frueheren Einzeldatei.

// ── FINANCE ───────────────────────────────────────────


G('btn-clr').onclick=async()=>{ await api('POST','/v1/admin/cache-clear'); toast(tRaw('settings.cache_cleared'),'info'); loadCacheStats(); loadFinance(); };
let _chartPeriod  = 'week';
function setChartPeriod(period){
  _chartPeriod = period;
  document.querySelectorAll('.period-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.period === period);
  });
  loadPortfolioChart();
}

async function loadPortfolioChart(){
  const el  = G('portfolio-chart');
  if(!el) return;
  el.innerHTML = '<div style="color:var(--mut);font-size:.82rem;padding:1rem;text-align:center"><div class="spin" style="width:18px;height:18px;border-width:2px;margin:0 auto 6px"></div>'+t('common.loading')+'</div>';

  const d = await api('GET', `/v1/finance/portfolio-history?period=${_chartPeriod}${scopeMode('finance') !== 'all' ? '&accounts=' + scopeMode('finance') : ''}`);
  if(!d.success){
    el.innerHTML='<span style="color:var(--r500);font-size:.82rem;padding:.5rem;display:block">'+t('toast.error')+': '+( d.error||t('common.unknown'))+'</span>'; return;
  }
  if(!d.points?.length){
    el.innerHTML='<div style="color:var(--mut);font-size:.82rem;padding:1.5rem;text-align:center">'+t('history.none_title')+'<br><span style="font-size:.75rem">'+t('history.none_hint')+'</span></div>'; return;
  }

  const cur = d.currency || CURRENCY;
  // New API: points has {x_label, value, y_frac}, y_axis has {label, value, frac}
  // Convert to legacy format for portfolioChartSVG: [{day, total}]
  const grandTotal = window._finGrandTotal || d.points[d.points.length-1].value;
  const lastVal = d.points[d.points.length-1].value || 1;
  const scale = lastVal > 0 ? grandTotal / lastVal : 1;
  const finalChartData = d.points.map((p, i) => ({
    day:   p.x_label || String(i),
    total: i === d.points.length-1 ? grandTotal : parseFloat((p.value * scale).toFixed(2))
  }));
  el.innerHTML = portfolioChartSVG(finalChartData, _chartPeriod, d.y_axis);

  // P&L: use server-computed period_change_pct (compares period start vs current)
  const pnlEl = G('portfolio-pnl');
  if(pnlEl){
    if(d.period_change_pct != null){
      pnlEl.innerHTML = pnlBadge(d.period_change_pct.toFixed(1));
    } else {
      // Fallback: first chart point vs current
      const purchaseBaseline = parseFloat(d.purchase_total || 0);
      const firstVal = (purchaseBaseline > 0 && chartData.length <= 2)
        ? purchaseBaseline : chartData[0].total;
      if(firstVal > 0 && grandTotal > 0){
        const pct = ((grandTotal - firstVal) / firstVal * 100).toFixed(1);
        pnlEl.innerHTML = pnlBadge(pct);
      }
    }
  }
}

/**
 * Plakette in der letzten Spalte der Finanztabelle: Ist für diese Zeile ein
 * Marktpreis da oder nicht?
 *
 * ── Warum nur noch ZWEI Zustände ────────────────────────────────────────────
 * Vorher waren es drei: ⚡ (Preis aus dem Cache), 🔴 (gerade frisch von
 * BrickLink geholt) und „Err". Die Unterscheidung Cache/frisch ist eine
 * Innensicht des Servers — für die Frage „stimmt die Zahl in dieser Zeile?"
 * macht sie keinen Unterschied, beide Wege liefern denselben Preis. Dazu kam,
 * dass ausgerechnet der Normalfall (Cache) einen Blitz bekam und der seltene
 * Fall einen roten Punkt, der wie eine Warnung aussieht. Jetzt: Haken = Preis
 * da, Warndreieck = Preis fehlt.
 *
 * Beide tragen title UND aria-label — ohne beides sind es zwei unerklärte
 * Zeichen, und Vorleseprogramme sagten bisher nur „Blitz" bzw. „roter Kreis".
 * Beim Fehlerfall hängt die Meldung des Servers mit im Tooltip; sichtbar steht
 * sie ohnehin in der Summenspalte.
 */
function priceStatusBadge(s){
  if (s.error) {
    const titel = `${t('finance.price_failed')}: ${s.error}`;
    return `<span class="pst pst-err" title="${esc(titel)}" role="img" aria-label="${esc(titel)}">⚠</span>`;
  }
  const titel = t('finance.price_loaded');
  return `<span class="pst pst-ok" title="${esc(titel)}" role="img" aria-label="${esc(titel)}">✓</span>`;
}

export async function loadFinance(){
  G('fin-tbl').innerHTML = ladeAnzeige(t('finance.fetch_prices'));
  G('fin-sum').style.display='none';
  // Fetch all finance data in parallel
  const [d, partsVal, figsVal, pnlData] = await Promise.all([
    // Alle vier mit demselben Kontofilter — sonst stünde eine Summe aus
    // einem Blickfeld neben einer Aufstellung aus einem anderen.
    api('GET','/v1/finance/valuation'+scopeQuery('finance')),
    api('GET','/v1/finance/parts-valuation'+scopeQuery('finance')),
    api('GET','/v1/finance/minifigs-valuation'+scopeQuery('finance')),
    api('GET','/v1/finance/pnl'+scopeQuery('finance')),
  ]);
  if(!d.success){ toast(d.error||t('settings.error'),'error'); G('fin-tbl').innerHTML=`<div class="empty"><div class="icon">⚠️</div><h3>${t('toast.error')}</h3><p>${esc(d.error)}</p></div>`; return; }
  const cur=d.currency;
  G('fin-sum').style.display='grid';
  const partsExtra = parseFloat(partsVal.success ? partsVal.total_value||0 : 0);
  const figsExtra  = parseFloat(figsVal.success  ? figsVal.total_value||0  : 0);
  const extra = partsExtra + figsExtra;
  // Die Kachel „Ø Marktpreis" (qty_avg) ist entfallen.
  //
  // Sie zeigte den MENGENGEWICHTETEN Schnitt aus dem BrickLink-Preisführer, die
  // Gewinn-und-Verlust-Rechnung darunter rechnete aber schon länger mit avg —
  // Zahl und Prozentangabe daneben bezogen sich also auf verschiedene Werte.
  // Statt zwei Mittelwerte nebeneinander zu zeigen, deren Unterschied niemand
  // erklärt, bleibt der einfache Schnitt (avg): derselbe Wert, auf dem auch die
  // Bewertung und die Entwicklung beruhen.
  [['fmin','min','fc1'],['favg','avg','fc2'],['fmax','max','fc4']].forEach(([vid,key,cid])=>{
    const base = parseFloat(d.totals[key]||0);
    G(vid).textContent = (base+extra).toLocaleString(locale(),{minimumFractionDigits:2});
    G(cid).textContent = cur;
  });
  // G&V total (Sets + manuell erfasste Teile & Minifiguren zusammen)
  // totals.avg statt totals.qty_avg: Die Beschriftung lautet „Ø Marktpreis",
  // und Marktpreis ist seit der Preisumstellung avg_price. qty_avg ist der
  // mengengewichtete Schnitt und liegt systematisch darunter.
  const currentTotal = parseFloat(d.totals.avg||0) + extra;
  if(pnlData.success && pnlData.totals?.pnl_pct != null){
    G('fin-stat-pnl').style.display='';
    G('fin-total-pnl').innerHTML = pnlBadge(pnlData.totals.pnl_pct);
  }

  // ── Teile & Minifiguren: einzeln auflisten, analog zur Sets-Tabelle ─────────
  // (fliesst bereits in "extra"/Gesamtsumme oben ein — hier zusätzlich transparent
  // als eigene Zeilen mit Kaufpreis, aktuellem Wert und G&V ausgewiesen)
  // Feste Spaltenbreiten (colgroup + table-layout:fixed): Bild/Name/Anz. sowie
  // ein Platzhalter (entspricht der Erfasst-Spalte der Sets-Tabelle) sorgen
  // dafür, dass Kaufpreis/Marktpreis/Gesamt/G&V exakt an der gleichen Stelle
  // wie in der Sets-Tabelle beginnen (nicht nur gleich breit sind).
  // Eine Plakette für den Zustand DIESER Zeile — gemeinsame Fassung in
  // 02-gallery.js (dort für Kacheln mit mehreren Zuständen).
  const condBadge = c => condBadges({ conditions: [c] });
  const pmColgroup = `<colgroup>
    <col style="width:60px"><col style="width:395px"><col style="width:70px"><col style="width:90px"><col style="width:110px"><col style="width:110px"><col style="width:110px"><col style="width:80px"><col style="width:40px">
  </colgroup>`;
  // Wie bei den Sets: eine VOLLSTÄNDIGE Zeile je Kaufpreis-Erfassung, jede mit
  // dem Marktpreis ihres Zustands und ihrer eigenen Entwicklung. Ein Teil, das
  // einmal neu und einmal gebraucht gekauft wurde, steht mit zwei Zeilen da.
  // Ohne Erfassungen (Altbestand) bleibt es bei der einen Zeile.
  // Die Zeile öffnet denselben Detail-Dialog wie die Kachel im jeweiligen
  // Reiter (openManDetail) — analog zur Set-Zeile, die openModal ruft.
  // Vorher waren Teile- und Minifiguren-Zeilen die einzigen in dieser Tabelle,
  // die auf einen Klick nicht reagierten.
  const manArgs = it => it.fig_number
    ? `data-click="openManDetail" data-arg="fig" data-arg2="${escJs(it.fig_number)}" data-arg3="0"`
    : `data-click="openManDetail" data-arg="part" data-arg2="${escJs(it.part_number)}" data-arg3="${it.color_id||0}"`;
  function pmRow(it, label, acq){
    const qty = acq ? acq.quantity : (it.quantity || 1);
    // avg_price zuerst — wie überall seit der Preisumstellung.
    const current = acq ? parseFloat(acq.avg_price ?? 0)
                        : parseFloat(it.avg_price ?? it.qty_avg_price ?? 0);
    const purchase = acq
      ? (acq.purchase_price!=null ? parseFloat(acq.purchase_price) : null)
      : (it.purchase_price!=null ? parseFloat(it.purchase_price) : null);
    const total = acq ? parseFloat(acq.total_avg||0) : parseFloat(it.display_value||0);
    const pnl = acq ? acq.pnl_pct : it.pnl_pct;
    const img = it.image_local||it.image_url ? `<img src="${escUrl(imgUrl(thumbUrl(it.image_local||it.image_url)||it.image_local||it.image_url||'', true))}" loading="lazy" decoding="async" data-orig="${escUrl(imgUrl(it.image_url||''))}" />` : '—';
    // Der frühere dritte Parameter onclickAttr wurde von keinem Aufrufer
    // gesetzt — der Zweig war tot und hätte als Inline-Handler die CSP blockiert.
    return `<tr style="cursor:pointer" ${manArgs(it)}>
      <td>${img}</td>
      <td><span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:380px">${label}${acq?` ${condBadge(acq.condition)}`:''} ${ownerBadges(it)}</span></td>
      <td><span class="qbadge">×${qty}</span></td>
      <td style="font-size:.75rem;color:var(--mut)">${acq?.created_at?new Date(acq.created_at).toLocaleDateString(locale()):''}</td>
      <td class="price-cell">${purchase!=null?fmtN(purchase,cur):'<span style="color:var(--mut)">—</span>'}</td>
      <td class="price-cell">${current>0?fmtN(current,cur):'<span style="color:var(--mut)">—</span>'}</td>
      <td class="price-total">${fmtN(total,cur)}</td>
      <td>${pnl!=null?pnlBadge(pnl):'<span style="color:var(--mut)">—</span>'}</td>
      <td></td>
    </tr>`;
  }

  /** Ein Eintrag → eine Zeile je Erfassung (mindestens eine). */
  function pmRows(it, label){
    const acqs = it.acquisitions || [];
    if (!acqs.length) return pmRow(it, label, null);
    return acqs.map(a => pmRow(it, label, a)).join('');
  }
  const partsItems = partsVal.success ? partsVal.parts : [];
  const figsItems  = figsVal.success  ? figsVal.figs   : [];
  const partsRows = partsItems.map(p => pmRows(p, `${esc(p.part_name||p.part_number)}${p.color_name?` <span style="color:var(--mut);font-size:.75rem">(${esc(colorName(p.color_name))})</span>`:''}`)).join('');
  const figsRows  = figsItems.map(f => pmRows(f, esc(f.fig_name||f.fig_number))).join('');
  // Die vierte Spalte war ein reiner Platzhalter, damit die Preisspalten an
  // derselben Stelle wie in der Sets-Tabelle beginnen. Sie trägt jetzt dasselbe
  // wie dort: das Erfassungsdatum der Zeile.
  const pmTableHead = `<thead><tr><th></th><th>${t('gallery.sort.name')}</th><th>${t('detail.qty')}</th><th>${t('detail.added')}</th><th>${t('detail.purchase_price')}</th><th>${t('detail.market_price')}</th><th>${t('finance.grand.total')}</th><th>${t('finance.total_pnl')}</th><th title="${esc(t('finance.price_status'))}"><span class="vh">${esc(t('finance.price_status'))}</span></th></tr></thead>`;
  // Die Summen liefert der Server (`total_value`) — Android liest sie seit jeher
  // von dort. Hier wurde stattdessen über `display_value` addiert; heute kommt
  // dasselbe heraus, aber sobald der Server Zeilen ohne Preis anders behandelt,
  // zeigen die beiden Clients verschiedene Zahlen (Nachtrag 145).
  const partsTotal = parseFloat(partsVal?.total_value || 0);
  const figsTotal  = parseFloat(figsVal?.total_value || 0);
  const pmFoot = total => `<tfoot><tr><td colspan="6" style="text-align:right;padding:11px 13px;font-weight:600">Total:</td><td class="price-total" style="font-size:.95rem;padding:11px 13px">${fmtN(total,cur)}</td><td colspan="2"></td></tr></tfoot>`;
  const partsSectionHtml = partsItems.length ? `
    <div class="tw" style="margin-top:1.25rem">
      <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--mut);margin-bottom:6px;display:flex;align-items:center;gap:5px">${PARTS_ICON_SVG} ${t('parts.manual_section')}</div>
      <table class="dt" style="table-layout:fixed;width:1065px">${pmColgroup}${pmTableHead}<tbody>${partsRows}</tbody>${pmFoot(partsTotal)}</table>
    </div>` : '';
  const figsSectionHtml = figsItems.length ? `
    <div class="tw" style="margin-top:1.25rem">
      <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--mut);margin-bottom:6px">${t('finance.figs_section')}</div>
      <table class="dt" style="table-layout:fixed;width:1065px">${pmColgroup}${pmTableHead}<tbody>${figsRows}</tbody>${pmFoot(figsTotal)}</table>
    </div>` : '';

  // ── Eine Zeile JE KAUFPREIS-ERFASSUNG ───────────────────────────────────────
  //
  // Ein Set mit einem Kaufpreis für „Neu" und einem für „Gebraucht" steht
  // jetzt mit ZWEI Zeilen in der Tabelle, jede mit dem Marktpreis ihres
  // Zustands. Vorher gab es eine Zeile je Set — und weil eine einzige
  // Gebraucht-Erfassung das ganze Set als gebraucht führte, wurde auch das neu
  // gekaufte Exemplar mit dem Gebrauchtpreis bewertet.
  //
  // Bewusst OHNE zusätzliche Summenzeile je Set: Die Einzelzeilen sind die
  // Wahrheit, eine Summe daneben wäre eine zweite Darstellung derselben Zahlen.
  // Die Gesamtsumme steht wie bisher im Tabellenfuss.
  //
  // Sets mit genau einer (oder ohne) Erfassung sehen unverändert aus.
  //
  // JEDE Zeile ist vollständig — mit Bild, Nummer, Name und Jahr. Die erste
  // Fassung sparte diese vier Spalten in den Folgezeilen und rückte stattdessen
  // mit „↳" ein. Das las sich wie eine Unterposition und damit wie eine
  // Aufschlüsselung einer Summe darüber; genau das ist es aber nicht — die
  // Zeilen sind gleichrangig, jede steht für einen eigenen Kauf mit eigenem
  // Zustand, eigenem Marktpreis und eigener Entwicklung.
  //
  // Zusammengehalten werden sie durch die Zustands-Plakette am Namen, die
  // ohnehin jede Zeile trägt.
  //
  function setRow(s, acq){
    const qty      = acq ? acq.quantity : s.quantity;
    const purchase = acq ? acq.purchase_price : s.purchase_price;
    const market   = acq ? acq.avg_price : s.avg_price;
    const total    = acq ? acq.total_avg : s.total_avg;
    // G&V je Zeile vom Server (gegen den Kaufpreis DIESER Erfassung). Ohne
    // Erfassungen bleibt der bisherige Wert aus der G&V-Antwort.
    const pnl      = acq ? acq.pnl_pct
                         : (s.pnl_pct ?? _pnlCache[s.set_number]?.pnl_pct);
    const dateSrc  = acq ? acq.created_at : s.added_at;
    return `<tr style="cursor:pointer" data-click="openModal" data-arg="${escJs(s.set_number)}">
    <td>${s.image_local||s.image_url?`<img src="${escUrl(imgUrl(thumbUrl(s.image_local||s.image_url)||s.image_local||s.image_url||'', true))}" loading="lazy" decoding="async" data-orig="${escUrl(imgUrl(s.image_url||''))}" />`:'—'}</td>
    <td><span style="font-family:var(--mono);color:var(--b600);font-size:.77rem">${esc(s.set_number)}</span></td>
    <td>${esc(s.name)||'—'}${acq?` ${condBadge(acq.condition)}`:''} ${ownerBadges(s)}</td><td>${s.year||'—'}</td>
    <td><span class="qbadge">×${qty}</span></td>
    <td style="font-size:.75rem;color:var(--mut)">${dateSrc?new Date(dateSrc).toLocaleDateString(locale()):'—'}</td>
    <td class="price-cell">${purchase!=null?fmtN(purchase,cur):'—'}</td>
    <td class="${s.error?'':'price-cell'}">${s.error?'—':fmtN(market,cur)}</td>
    <td class="${s.error?'':'price-total'}">${s.error?esc(s.error):fmtN(total,cur)}</td>
    <td>${pnl!=null?pnlBadge(pnl):'<span style="color:var(--mut)">—</span>'}</td>
    <td>${priceStatusBadge(s)}</td>
  </tr>`;
  }
  const rows=d.sets.map(s=>{
    const acqs = s.acquisitions || [];
    if (acqs.length <= 1) return setRow(s, acqs[0] || null);
    return acqs.map(a => setRow(s, a)).join('');
  }).join('');
  const setsQtyAvg = parseFloat(d.totals.avg||0);
  // ── Gesamtwert kommt vom Server (Nachtrag 145) ─────────────────────────────
  //
  // Hier stand `setsQtyAvg + extra` — und in FinanceSections.kt derselbe
  // Ausdruck noch einmal. Die Regel „was zählt zum Gesamtwert" lag damit an
  // drei Stellen, und /finance/pnl liefert sie ohnehin schon: `totals.grand_total`
  // wird dort aus den Preisen JE ZEILE gebildet statt aus drei gerundeten
  // Endsummen.
  //
  // Der Rückfall auf die eigene Addition bleibt für den Fall, dass die
  // pnl-Abfrage scheitert — dann steht lieber eine leicht abweichende Zahl da
  // als gar keine.
  const grandTotal = parseFloat(pnlData?.totals?.grand_total || 0) || (setsQtyAvg + extra);
  window._finPartsExtra = extra;
  window._finGrandTotal  = grandTotal; // used by chart to scale last point
  if(G('portfolio-current')) G('portfolio-current').textContent = fmtN(grandTotal, cur);
  loadPortfolioChart();
  const grandTotalHtml = `
    <div class="tw" style="margin-top:1.25rem">
      <table class="dt" style="table-layout:fixed;width:1065px">
        <colgroup><col style="width:835px"><col style="width:110px"><col style="width:120px"></colgroup>
        <tbody>
          <tr><td style="color:var(--mut)">Sets</td><td class="price-total">${fmtN(setsQtyAvg,cur)}</td><td></td></tr>
          <tr><td style="color:var(--mut)">${t('finance.grand.parts')}</td><td class="price-total">${fmtN(partsTotal,cur)}</td><td></td></tr>
          <tr><td style="color:var(--mut)">${t('finance.figs_section')}</td><td class="price-total">${fmtN(figsTotal,cur)}</td><td></td></tr>
        </tbody>
        <tfoot><tr><td style="font-weight:700;padding:11px 13px">Total</td><td class="price-total" style="font-size:1.05rem;padding:11px 13px">${fmtN(grandTotal,cur)}</td><td></td></tr></tfoot>
      </table>
    </div>`;
  G('fin-tbl').innerHTML=`<div class="tw"><table class="dt" style="table-layout:fixed;width:1065px"><colgroup><col style="width:60px"><col style="width:90px"><col style="width:250px"><col style="width:55px"><col style="width:70px"><col style="width:90px"><col style="width:110px"><col style="width:110px"><col style="width:110px"><col style="width:80px"><col style="width:40px"></colgroup><thead><tr><th></th><th>Nr.</th><th>${t('gallery.sort.name')}</th><th>${t('detail.year')}</th><th>${t('detail.qty')}</th><th>${t('detail.added')}</th><th>${t('detail.purchase_price')}</th><th>${t('detail.market_price')}</th><th>${t('finance.grand.total')}</th><th>${t('finance.total_pnl')}</th><th title="${esc(t('finance.price_status'))}"><span class="vh">${esc(t('finance.price_status'))}</span></th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="8" style="text-align:right;padding:11px 13px;font-weight:600">${t('finance.total_sets_avg')}</td><td class="price-total" style="font-size:.95rem;padding:11px 13px">${fmtN(setsQtyAvg,cur)}</td><td colspan="2"></td></tr></tfoot></table></div>${partsSectionHtml}${figsSectionHtml}${grandTotalHtml}`;
}



// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
registerActions({
  setChartPeriod,
});
