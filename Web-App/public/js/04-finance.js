import { ladeAnzeige } from './01-bausteine.js';
import { registerActions } from './00-registry.js';
import { colorName, locale, t, tRaw} from '../i18n.js';
import { bildTag, platzhalterInhalt, leerZustand, ico, CURRENCY, G, api, esc, escJs, escUrl, fmtN, imgUrl, thumbUrl, toast } from './01-core.js';
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
  el.innerHTML = '<div data-stil="color:var(--mut);font-size:var(--fs-2);padding:1rem;text-align:center"><div class="spin" data-stil="width:18px;height:18px;border-width:2px;margin:0 auto 6px"></div>'+t('common.loading')+'</div>';

  const d = await api('GET', `/v1/finance/portfolio-history?period=${_chartPeriod}${scopeMode('finance') !== 'all' ? '&accounts=' + scopeMode('finance') : ''}`);
  if(!d.success){
    el.innerHTML='<span data-stil="color:var(--r500);font-size:var(--fs-2);padding:.5rem;display:block">'+t('toast.error')+': '+( d.error||t('common.unknown'))+'</span>'; return;
  }
  if(!d.points?.length){
    el.innerHTML='<div data-stil="color:var(--mut);font-size:var(--fs-2);padding:1.5rem;text-align:center">'+t('history.none_title')+'<br><span data-stil="font-size:var(--fs-1)">'+t('history.none_hint')+'</span></div>'; return;
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
    // Ohne Marktwert keine Entwicklung: Der Verlauf trägt dann nur den
    // Kaufpreis, und „0.0 %" neben „—" behauptete Stillstand.
    if(!(window._finGrandTotal > 0)) pnlEl.innerHTML = '';
    else if(d.period_change_pct != null){
      pnlEl.innerHTML = pnlBadge(d.period_change_pct.toFixed(1));
    } else {
      // Fallback: first chart point vs current
      const purchaseBaseline = parseFloat(d.purchase_total || 0);
      const firstVal = (purchaseBaseline > 0 && finalChartData.length <= 2)
        ? purchaseBaseline : finalChartData[0].total;
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
    return `<span class="pst pst-err" title="${esc(titel)}" role="img" aria-label="${esc(titel)}">${ico('warnung')}</span>`;
  }
  // Ohne Marktpreis kein Haken: Er sagte „vorhanden" über einer leeren Spalte.
  if (s.no_price) {
    const titel = t(s.bl_unbekannt ? 'finance.price_unknown_bl' : 'finance.price_none');
    return `<span class="pst pst-leer" title="${esc(titel)}" role="img" aria-label="${esc(titel)}">–</span>`;
  }
  const titel = t('finance.price_loaded');
  return `<span class="pst pst-ok" title="${esc(titel)}" role="img" aria-label="${esc(titel)}">${ico('ok')}</span>`;
}

export async function loadFinance(){
  G('fin-tbl').innerHTML = ladeAnzeige(t('finance.fetch_prices'));
  // Fetch all finance data in parallel
  const [d, partsVal, figsVal, pnlData] = await Promise.all([
    // Alle vier mit demselben Kontofilter — sonst stünde eine Summe aus
    // einem Blickfeld neben einer Aufstellung aus einem anderen.
    api('GET','/v1/finance/valuation'+scopeQuery('finance')),
    api('GET','/v1/finance/parts-valuation'+scopeQuery('finance')),
    api('GET','/v1/finance/minifigs-valuation'+scopeQuery('finance')),
    api('GET','/v1/finance/pnl'+scopeQuery('finance')),
  ]);
  if(!d.success){ toast(d.error||t('settings.error'),'error'); G('fin-tbl').innerHTML=`<div class="empty"><div class="icon">${ico('warnung')}</div><h3>${t('toast.error')}</h3><p>${esc(d.error)}</p></div>`; return; }
  const cur=d.currency;
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
  // Ohne vergleichbaren Posten keine G&V — auch nicht die vom letzten Filter.
  const gesamtGuv = pnlData.success ? pnlData.totals?.pnl_pct : null;

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
    <col data-stil="width:60px"><col data-stil="width:395px"><col data-stil="width:70px"><col data-stil="width:90px"><col data-stil="width:110px"><col data-stil="width:110px"><col data-stil="width:110px"><col data-stil="width:80px"><col data-stil="width:40px">
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
  /** Ein aus Teilepreisen geschätzter Figurenpreis bekommt „≈" und die Abdeckung. */
  function geschaetztMarke(it, html){
    if (!it.estimated_from_parts) return html;
    const p = it.abdeckung != null ? Math.round(it.abdeckung * 100) : '?';
    const hinweis = esc(tRaw('finance.aus_teilen_geschaetzt', { p }));
    return `<span title="${hinweis}"><span role="img" aria-label="${hinweis}">≈</span> ${html}</span>`;
  }

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
    const art = it.fig_number ? 'figur' : 'teil';
    const img = it.image_local||it.image_url ? bildTag({ src: imgUrl(thumbUrl(it.image_local||it.image_url)||it.image_local||it.image_url, true), orig: imgUrl(it.image_url||''), alt: '', ph: art }) : `<span class="bild-ph" aria-hidden="true">${platzhalterInhalt(art)}</span>`;
    // Der frühere dritte Parameter onclickAttr wurde von keinem Aufrufer
    // gesetzt — der Zweig war tot und hätte als Inline-Handler die CSP blockiert.
    return `<tr data-stil="cursor:pointer" ${manArgs(it)}>
      <td class="fin-bild">${img}</td>
      <td class="fin-name"><span data-stil="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:380px">${label}${acq?` ${condBadge(acq.condition)}`:''} ${ownerBadges(it)}</span><span class="fin-unter">×${qty}</span></td>
      <td class="fin-detail"><span class="qbadge">×${qty}</span></td>
      <td class="fin-detail" data-stil="font-size:var(--fs-1);color:var(--mut)">${acq?.created_at?new Date(acq.created_at).toLocaleDateString(locale()):''}</td>
      <td class="fin-detail price-cell">${purchase!=null?fmtN(purchase,cur):'<span data-stil="color:var(--mut)">—</span>'}</td>
      <td class="fin-detail price-cell">${current>0?geschaetztMarke(it, fmtN(current,cur)):'<span data-stil="color:var(--mut)">—</span>'}</td>
      <td class="fin-wert price-total">${fmtN(total,cur)}</td>
      <td class="fin-guv">${pnl!=null?pnlBadge(pnl):'<span data-stil="color:var(--mut)">—</span>'}</td>
      <td class="fin-status"></td>
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
  // Einstand je Abschnitt: vom Server (pnl), sonst aus den Zeilen gerechnet.
  const pt = pnlData.success ? (pnlData.totals || {}) : {};
  const einstand = {
    sets:  zahlOder(pt.sets_purchase,  einstandAus(d.sets)),
    parts: zahlOder(pt.parts_purchase, einstandAus(partsItems)),
    figs:  zahlOder(pt.figs_purchase,  einstandAus(figsItems)),
  };
  einstand.alle = zahlOder(pt.purchase, einstand.sets + einstand.parts + einstand.figs);
  const ohnePreis = d.sets.filter(s => s.error || !(parseFloat(s.avg_price) > 0)).length
    + [...partsItems, ...figsItems].filter(it => !(parseFloat(it.avg_price ?? it.qty_avg_price) > 0)).length;
  const partsRows = partsItems.map(p => pmRows(p, `${esc(p.part_name||p.part_number)}${p.color_name?` <span data-stil="color:var(--mut);font-size:var(--fs-1)">(${esc(colorName(p.color_name))})</span>`:''}`)).join('');
  const figsRows  = figsItems.map(f => pmRows(f, esc(f.fig_name||f.fig_number))).join('');
  // Die vierte Spalte war ein reiner Platzhalter, damit die Preisspalten an
  // derselben Stelle wie in der Sets-Tabelle beginnen. Sie trägt jetzt dasselbe
  // wie dort: das Erfassungsdatum der Zeile.
  const pmTableHead = `<thead><tr><th></th><th>${t('col.name')}</th><th>${t('detail.qty')}</th><th>${t('detail.added')}</th><th>${t('detail.purchase_price')}</th><th>${t('detail.market_price')}</th><th>${t('finance.grand.total')}</th><th>${t('finance.total_pnl')}</th><th title="${esc(t('finance.price_status'))}"><span class="vh">${esc(t('finance.price_status'))}</span></th></tr></thead>`;
  // Die Summen liefert der Server (`total_value`) — Android liest sie seit jeher
  // von dort. Hier wurde stattdessen über `display_value` addiert; heute kommt
  // dasselbe heraus, aber sobald der Server Zeilen ohne Preis anders behandelt,
  // zeigen die beiden Clients verschiedene Zahlen (Nachtrag 145).
  const partsTotal = parseFloat(partsVal?.total_value || 0);
  const figsTotal  = parseFloat(figsVal?.total_value || 0);
  const pmFoot = (kauf, total) => `<tfoot><tr><td colspan="4" class="fin-fuss-l">${t('finance.sum')}</td>${summenZellen(kauf, total, cur, 1)}<td colspan="2"></td></tr></tfoot>`;
  const partsSectionHtml = partsItems.length ? `
    <div class="tw" data-fin-art="parts" data-stil="margin-top:1.25rem">
      <div class="ctitle" data-stil="margin:0 0 6px;display:flex;align-items:center;gap:6px">${PARTS_ICON_SVG} ${t('parts.manual_section')}</div>
      <table class="dt dt-fin" data-stil="table-layout:fixed;width:100%;min-width:1065px">${pmColgroup}${pmTableHead}<tbody>${partsRows}</tbody>${pmFoot(einstand.parts, partsTotal)}</table>
    </div>` : '';
  const figsSectionHtml = figsItems.length ? `
    <div class="tw" data-fin-art="figs" data-stil="margin-top:1.25rem">
      <div class="ctitle" data-stil="margin:0 0 6px">${t('finance.figs_section')}</div>
      <table class="dt dt-fin" data-stil="table-layout:fixed;width:100%;min-width:1065px">${pmColgroup}${pmTableHead}<tbody>${figsRows}</tbody>${pmFoot(einstand.figs, figsTotal)}</table>
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
    // Die Fehlermeldung steht im Status-Symbol (Tooltip), nicht in der Summe:
    // Dort brach sie die Spalte fünfzeilig um.
    return `<tr data-stil="cursor:pointer" tabindex="0" data-click="openModal" data-arg="${escJs(s.set_number)}">
    <td class="fin-bild">${s.image_local||s.image_url?bildTag({ src: imgUrl(thumbUrl(s.image_local||s.image_url)||s.image_local||s.image_url, true), alt: '', ph: 'set' }):`<span class="bild-ph" aria-hidden="true">${platzhalterInhalt('set')}</span>`}</td>
    <td class="fin-detail"><span data-stil="font-family:var(--mono);color:var(--b600);font-size:var(--fs-1)">${esc(s.set_number)}</span></td>
    <td class="fin-name">${esc(s.name)||'—'}${acq?` ${condBadge(acq.condition)}`:''} ${ownerBadges(s)}<span class="fin-unter">${esc(s.set_number)}${s.year?` · ${s.year}`:''} · ×${qty}</span></td><td class="fin-detail">${s.year||'—'}</td>
    <td class="fin-detail"><span class="qbadge">×${qty}</span></td>
    <td class="fin-detail" data-stil="font-size:var(--fs-1);color:var(--mut)">${dateSrc?new Date(dateSrc).toLocaleDateString(locale()):'—'}</td>
    <td class="fin-detail price-cell">${purchase!=null?fmtN(purchase,cur):'—'}</td>
    <td class="fin-detail ${s.error?'':'price-cell'}">${s.error?`<span class="fin-fehlt" title="${esc(t('finance.price_failed'))}: ${esc(s.error)}">${t('finance.price_missing_short')}</span>`:fmtN(market,cur)}</td>
    <td class="fin-wert ${s.error?'':'price-total'}">${s.error?'<span data-stil="color:var(--mut)">—</span>':fmtN(total,cur)}</td>
    <td class="fin-guv">${pnl!=null?pnlBadge(pnl):'<span data-stil="color:var(--mut)">—</span>'}</td>
    <td class="fin-status">${priceStatusBadge(s)}</td>
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
  zeigeKennzahlen({ einstand: einstand.alle, wert: grandTotal, guv: gesamtGuv, ohnePreis, cur,
    guvKauf: parseFloat(pnlData?.totals?.pnl_purchase) || 0, guvMarkt: parseFloat(pnlData?.totals?.pnl_current) || 0,
                    min: parseFloat(d.totals.min||0) + extra, max: parseFloat(d.totals.max||0) + extra });
  // Nichts erfasst: ein Leerzustand statt Tabellen, die fünfmal „Preis fehlt“ melden.
  if (!d.sets.length && !partsItems.length && !figsItems.length) {
    G('fin-tbl').innerHTML = leerZustand({ ico: 'finanzen', titel: tRaw('finance.empty'), text: tRaw('finance.empty_text') });
    return;
  }
  const summenZeile = (name, kauf, wert) => `<tr><td class="fin-fuss-name">${name}</td>${summenZellen(kauf, wert, cur, 0)}</tr>`;
  const grandTotalHtml = `
    <div class="tw" data-stil="margin-top:1.25rem">
      <table class="dt dt-summe">
        <thead><tr><th></th><th>${t('finance.stat.purchase')}</th><th>${t('finance.grand.value')}</th></tr></thead>
        <tbody>
          ${summenZeile('Sets', einstand.sets, setsQtyAvg)}
          ${summenZeile(t('finance.grand.parts'), einstand.parts, partsTotal)}
          ${summenZeile(t('finance.figs_section'), einstand.figs, figsTotal)}
        </tbody>
        <tfoot>${summenZeile(t('finance.grand.total'), einstand.alle, grandTotal)}</tfoot>
      </table>
    </div>`;
  G('fin-tbl').innerHTML=`<div class="tw" data-fin-art="sets"><table class="dt dt-fin" data-stil="table-layout:fixed;width:100%;min-width:1065px"><colgroup><col data-stil="width:60px"><col data-stil="width:90px"><col data-stil="width:250px"><col data-stil="width:55px"><col data-stil="width:70px"><col data-stil="width:90px"><col data-stil="width:110px"><col data-stil="width:110px"><col data-stil="width:110px"><col data-stil="width:80px"><col data-stil="width:40px"></colgroup><thead><tr><th></th><th>Nr.</th><th>${t('col.name')}</th><th>${t('detail.year')}</th><th>${t('detail.qty')}</th><th>${t('detail.added')}</th><th>${t('detail.purchase_price')}</th><th>${t('detail.market_price')}</th><th>${t('finance.grand.total')}</th><th>${t('finance.total_pnl')}</th><th title="${esc(t('finance.price_status'))}"><span class="vh">${esc(t('finance.price_status'))}</span></th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="6" class="fin-fuss-l">${t('finance.sum')}</td>${summenZellen(einstand.sets, setsQtyAvg, cur, 1)}<td colspan="2"></td></tr></tfoot></table></div>${partsSectionHtml}${figsSectionHtml}${grandTotalHtml}`;
  // Der Filter ueberlebt das Neuzeichnen. Ohne diesen Aufruf stuenden nach
  // jedem „Preise laden" wieder alle drei Abschnitte da, waehrend die Chips
  // daneben weiter eine Auswahl anzeigen — die Anzeige waere dann eine
  // Behauptung.
  finFilterAnwenden();
}

/** Zahl aus der Serverantwort, sonst der Ersatzwert. */
function zahlOder(v, ersatz) { const n = parseFloat(v); return Number.isFinite(n) ? n : ersatz; }

/** Summe der Kaufpreise mal Menge — je Erfassung, sonst je Eintrag. */
function einstandAus(liste) {
  let s = 0;
  for (const it of liste || []) {
    const acqs = it.acquisitions?.length ? it.acquisitions : [it];
    for (const a of acqs) {
      const p = parseFloat(a.purchase_price);
      if (Number.isFinite(p)) s += p * (parseInt(a.quantity) || 1);
    }
  }
  return s;
}

/**
 * Die Zellen einer Summenzeile: Einstand und Marktwert. `luecke` Zellen
 * dazwischen halten die Spalten der Tabelle darüber (Kaufpreis | Marktpreis |
 * Total). Am Telefon tragen beide ihre Beschriftung selbst (data-kurz).
 */
function summenZellen(kauf, wert, cur, luecke) {
  const k = `<td class="price-total fin-fuss-wert" data-kurz="${esc(t('finance.stat.purchase'))}">${kauf > 0 ? fmtN(kauf, cur) : '—'}</td>`;
  const w = `<td class="price-total fin-fuss-wert" data-kurz="${esc(t('finance.grand.value'))}">${wert > 0 ? fmtN(wert, cur) : `<span class="fin-fehlt-kurz">${t('finance.price_missing_short')}</span>`}</td>`;
  return k + '<td></td>'.repeat(luecke) + w;
}

/**
 * Die Kacheln über der Tabelle. Der Einstand ist immer bekannt; Gesamtwert
 * und G&V nur, wenn es Marktpreise gibt — sonst sagt die Kachel, für wie
 * viele Positionen der Preis fehlt, statt „—“ zu zeigen.
 */
function zeigeKennzahlen({ einstand, wert, guv, ohnePreis, cur, min, max, guvKauf = 0, guvMarkt = 0 }) {
  G('fin-einstand').textContent = einstand > 0 ? fmtN(einstand, cur) : '—';
  const fehlt = ohnePreis > 0 ? tRaw('finance.price_missing_n', { n: ohnePreis }) : '';
  if (wert > 0) {
    G('fin-wert').textContent = fmtN(wert, cur);
    const spanne = min > 0 && max > min ? tRaw('finance.range', { min: fmtN(min, cur), max: fmtN(max, cur) }) : '';
    G('fin-wert-sub').textContent = [spanne, fehlt].filter(Boolean).join(' · ');
  } else {
    // Ohne Positionen fehlt kein Preis — dann einfach „—“.
    if (fehlt) G('fin-wert').innerHTML = `<span class="fval-hinweis">${esc(fehlt)}</span>`;
    else G('fin-wert').textContent = '—';
    G('fin-wert-sub').textContent = '';
  }
  G('fin-stat-pnl').style.display = guv != null && wert > 0 ? '' : 'none';
  if (guv != null) {
    G('fin-total-pnl').innerHTML = pnlBadge(guv);
    // Betrag und Prozent aus denselben Posten (mit Kauf- UND Marktpreis).
    G('fin-pnl-sub').textContent = guvKauf > 0 ? `${guvMarkt >= guvKauf ? '+' : '−'}${fmtN(Math.abs(guvMarkt - guvKauf), cur)}` : '';
  }
}

// ── Kategoriefilter: dieselbe Regel wie in der Android-App ──────────────────
//
// Marcos Vorgabe, dass die Funktionen in beiden Apps dieselben sein sollen.
// Der Reiter hatte den Filter bisher nur in der App.
//
// LEERE Auswahl heisst ALLE — das ist kein Sonderfall, sondern der Normalfall:
// Wer nichts einschraenkt, sieht alles, und der Chip „Alle" ist genau dann
// gewaehlt. Ausformuliert steht die Ueberlegung in FinanceUiState.kategorien
// (Android-App); hier steht sie absichtlich NICHT noch einmal aus.
//
// Gefiltert wird durch Ein- und Ausblenden, nicht durch Neuzeichnen: Die
// Summen unten sollen sich NICHT aendern — sie beschreiben den Bestand, nicht
// die Auswahl. Genau so haelt es die App auch (die Kacheln ueber der Liste
// bleiben dort ebenfalls stehen).
const finKategorien = new Set();

/** Zeigt der Reiter diese Zeilenart? Leere Auswahl heisst: alle. */
function finZeigt(art){ return finKategorien.size === 0 || finKategorien.has(art); }

/** Abschnitte ein-/ausblenden und die Chips nachziehen. */
function finFilterAnwenden(){
  // style.display statt des hidden-Attributs: `.tw` setzt in styles.css eine
  // eigene Darstellung, und eine Autoren-Regel schlaegt das `[hidden]` des
  // Browsers. Der Abschnitt bliebe sichtbar, ohne dass etwas scheitert.
  document.querySelectorAll('#fin-tbl [data-fin-art]').forEach(el => {
    el.style.display = finZeigt(el.dataset.finArt) ? '' : 'none';
  });
  document.querySelectorAll('#fin-filter button').forEach(b => {
    const art = b.dataset.art;
    b.classList.toggle('active', art ? finKategorien.has(art) : finKategorien.size === 0);
  });
}

/**
 * Ein Chip wurde geklickt.
 *
 * „alle" raeumt die Auswahl weg; die drei uebrigen schalten ihre Zeilenart
 * einzeln zu und wieder ab. Die letzte Art abzuwaehlen fuehrt auf die leere
 * Menge — und die heisst wieder ALLE. Eine Ansicht, die nach dem Abwaehlen
 * leer bliebe, waere kein Filter, sondern eine leere Seite.
 */
function finFilter(art){
  if (art === 'alle') finKategorien.clear();
  else if (finKategorien.has(art)) finKategorien.delete(art);
  else finKategorien.add(art);
  finFilterAnwenden();
}



// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
registerActions({
  setChartPeriod,
  finFilter,
});
