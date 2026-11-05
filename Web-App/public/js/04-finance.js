// Finanzen: Bewertung, G&V und Wertentwicklung des Bestands.
import { ladeAnzeige, listeLadefehler, verstaendlicherGrund, condBadges, ownerBadges, pnlBadge } from './01-bausteine.js';
import { registerActions } from './00-registry.js';
import { colorName, t, tRaw } from '../i18n.js';
import { fmtDatum, fmtGeld, bildTag, platzhalterInhalt, leerZustand, ico, G, api, escJs, fmtN, imgUrl, thumbUrl, alle } from './01-core.js';
import { scopeMode, scopeQuery } from './14-scope.js';
import { CURRENCY, _pnlCache } from './00-zustand.js';
import { esc } from './00-escapen.js';
import { diagrammBreite, portfolioChartSVG, zeitpunkt, diagrammLeer } from './01-diagramme.js';

// ── FINANCE ───────────────────────────────────────────


// Vorgewählt ist der längste Zeitraum: Eine Woche hat bei neuem Bestand oft
// nur einen Messpunkt und zeigte dann eine flache Linie mit „0 %“.
let _chartPeriod  = 'max';
/**
 * @param {string} period
 */
function setChartPeriod(period){
  _chartPeriod = period;
  // Nur die Zeitraum-Knöpfe: Die Filterchips darunter tragen dieselbe Klasse.
  document.querySelectorAll('.zeitraum-wahl .period-btn').forEach(b => {
    const an = /** @type {HTMLElement} */ (b).dataset.period === period;
    b.classList.toggle('active', an);
    b.setAttribute('aria-pressed', String(an));
  });
  loadPortfolioChart();
}

/** Zuletzt gezeichnete Kurve — beim Drehen des Telefons neu in der neuen Breite.
 * @type {{ day: string, total: number, zeit?: number }[] | null} */
let _letzteKurve = null;
let _kurveBreite = 0;
/** Einstand und Währung der Kennzahlen — die Bezugslinie im Wertdiagramm. */
let _einstand = 0, _waehrung = '', _einstandText = '';
window.addEventListener('resize', () => {
  const el = G('portfolio-chart');
  if (!_letzteKurve || !el?.querySelector('svg')) return;
  const b = diagrammBreite(el);
  if (Math.abs(b - _kurveBreite) < 24) return;
  _kurveBreite = b;
  el.innerHTML = portfolioChartSVG(_letzteKurve, _chartPeriod, b, _einstand, _waehrung || CURRENCY, _einstandText || undefined);
});

/** Hinweis statt Kurve, wenn der Verlauf nicht zu holen war — im selben
 * Muster wie der Fehlerzustand einer Liste, nur kleiner.
 * @param {boolean} offline @param {{ networkError?: boolean, status?: number, error?: unknown } | null | undefined} d */
function diagrammNichtDa(offline, d){
  const { grund, details } = offline ? { grund: tRaw('api.unreachable') } : verstaendlicherGrund(d);
  return `<div class="empty leer klein fehler-zustand" role="status"><div class="leer-ico">${ico('warnung')}</div>` +
    `<h2>${esc(tRaw('chart.unavailable'))}</h2><p>${esc(grund)}</p>` +
    (details ? `<details class="fehler-details"><summary>${esc(tRaw('liste.details'))}</summary><code>${esc(details)}</code></details>` : '') +
    `<button type="button" class="btn bs" data-lesend data-click="loadPortfolioChart">${ico('aktualisieren')}<span>${esc(tRaw('liste.erneut'))}</span></button></div>`;
}

async function loadPortfolioChart(){
  const el  = G('portfolio-chart');
  if(!el) return;
  el.innerHTML = ladeAnzeige(t('common.loading'), { klein: true });

  const d = await api('GET', `/v1/finance/portfolio-history?period=${_chartPeriod}${scopeMode('finance') !== 'all' ? '&accounts=' + scopeMode('finance') : ''}`);
  if(!d.success){
    if (d.status === 401) return;
    // Ohne Verlauf wählt ein Zeitraum nichts; „Erneut versuchen“ ist die einzige Handlung.
    document.querySelectorAll('.zeitraum-wahl .period-btn').forEach(b => { /** @type {HTMLButtonElement} */ (b).disabled = true; });
    el.innerHTML = diagrammNichtDa(!!d.networkError, d);
    return;
  }
  // Weniger als zwei echte Messpunkte sind kein Verlauf: Der Server ergänzt
  // dann einen künstlichen Startwert, und die Linie behauptete Stillstand.
  // messpunkte und chart nennt der Vertrag nicht (PortfolioHistoryResponse); der Server schickt sie mit.
  const ungenannt = /** @type {{ messpunkte?: number, chart?: { values?: { values?: { x: string }[] }[] } }} */ (/** @type {unknown} */ (d));
  const messpunkte = ungenannt.messpunkte ?? d.points?.length ?? 0;
  _letzteKurve = null;
  // Ohne jeden Verlauf („Max“ leer) gibt es keinen Zeitraum zu wählen.
  const ganzLeer = (!d.points?.length || messpunkte < 2) && _chartPeriod === 'max';
  /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('.zeitraum-wahl .period-btn')).forEach(b => { b.disabled = ganzLeer; });
  if(!d.points?.length || messpunkte < 2){
    el.innerHTML = diagrammLeer();
    const pnlLeer = G('portfolio-pnl');
    if(pnlLeer) pnlLeer.innerHTML = '';
    return;
  }

  const cur = d.currency || CURRENCY;
  // New API: points has {x_label, value, y_frac}, y_axis has {label, value, frac}
  // Convert to legacy format for portfolioChartSVG: [{day, total}]
  const grandTotal = window._finGrandTotal || d.points[d.points.length-1].value;
  const lastVal = d.points[d.points.length-1].value || 1;
  const scale = lastVal > 0 ? grandTotal / lastVal : 1;
  // Die Zeitpunkte stehen in d.chart (dieselbe Reihenfolge wie points); mit
  // ihnen liegen die Punkte auf einer echten Zeitachse statt nach Index.
  const zeiten = ungenannt.chart?.values?.[0]?.values?.map(v => zeitpunkt(v.x)) || [];
  const mitZeit = zeiten.length === d.points.length && zeiten.every(Number.isFinite);
  const finalChartData = d.points.map((p, i) => ({
    day:   p.x_label || '',
    zeit:  mitZeit ? zeiten[i] : undefined,
    total: i === d.points.length-1 ? grandTotal : parseFloat((p.value * scale).toFixed(2))
  }));
  _letzteKurve = finalChartData;
  _kurveBreite = diagrammBreite(el);
  el.innerHTML = portfolioChartSVG(finalChartData, _chartPeriod, _kurveBreite, _einstand, cur, _einstandText || undefined);

  // P&L: use server-computed period_change_pct (compares period start vs current)
  const pnlEl = G('portfolio-pnl');
  if(pnlEl){
    // Ohne Marktwert keine Entwicklung: Der Verlauf trägt dann nur den
    // Kaufpreis, und „0.0 %" neben „—" behauptete Stillstand.
    const zeitraumText = { week: 'finance.change.week', month: 'finance.change.month',
                           year: 'finance.change.year', max: 'finance.change.max' }[_chartPeriod];
    // „seit 4. Sept.“ statt „seit Beginn“: Der Bezug der Prozentzahl steht dabei.
    const start = finalChartData[0]?.zeit;
    const seit = _chartPeriod === 'max' && start !== undefined && Number.isFinite(start) ? tRaw('finance.change.seit', { datum: fmtDatum(new Date(start)) }) : '';
    const zeitraum = zeitraumText ? `<span class="pnl-zeitraum">${seit ? esc(seit) : t(zeitraumText)}</span>` : '';
    if(!(Number(window._finGrandTotal) > 0)) pnlEl.innerHTML = '';
    else if(d.period_change_pct != null){
      pnlEl.innerHTML = pnlBadge(d.period_change_pct) + zeitraum;
    } else {
      // Fallback: first chart point vs current
      const purchaseBaseline = parseFloat(d.purchase_total || '0');
      const firstVal = (purchaseBaseline > 0 && finalChartData.length <= 2)
        ? purchaseBaseline : finalChartData[0].total;
      if(firstVal > 0 && grandTotal > 0){
        const pct = (grandTotal - firstVal) / firstVal * 100;
        pnlEl.innerHTML = pnlBadge(pct) + zeitraum;
      }
    }
  }
}

/**
 * Plakette „Marktpreis da oder nicht“ mit nur zwei Zuständen: Ob der Preis aus dem Cache oder frisch
 * kam, ändert an der Zahl nichts. title UND aria-label, sonst sind es unerklärte Zeichen auch für
 * Vorleseprogramme.
 * Ausführlich: docs/begruendungen/public/js/04-finance.js.md#pricestatusbadge
 */
/** @param {{ error?: string | null, no_price?: boolean | null, bl_unbekannt?: boolean | null }} s */
function priceStatusBadge(s, neutral = false){
  // Fehlt der Preis fast überall (kein Zugang, Dienst noch nicht gelaufen), ist
  // das kein Fehler dieser Zeile: grau statt rot, der Grund im Tooltip.
  if (s.error) {
    const titel = `${t('finance.price_failed')}: ${s.error}`;
    return `<span class="pst ${neutral ? 'pst-leer' : 'pst-err'}" title="${esc(titel)}" role="img" aria-label="${esc(titel)}">${neutral ? '–' : ico('warnung')}</span>`;
  }
  // Ohne Marktpreis kein Haken: Er sagte „vorhanden" über einer leeren Spalte.
  if (s.no_price) {
    const titel = t(s.bl_unbekannt ? 'finance.price_unknown_bl' : 'finance.price_none');
    return `<span class="pst pst-leer" title="${esc(titel)}" role="img" aria-label="${esc(titel)}">–</span>`;
  }
  const titel = t('finance.price_loaded');
  return `<span class="pst pst-ok" title="${esc(titel)}" role="img" aria-label="${esc(titel)}">${ico('ok')}</span>`;
}

/** Platzhalter einer Kennzahl, solange sie lädt — „—“ hiesse „kein Wert“. */
const WERT_SKELETT = '<span class="skelett-zeile skelett-wert" aria-hidden="true"></span>';
/** Alle Kennzahlen laden gleich: Gerüst statt „—“, auch Gewinn/Verlust. */
const KENNZAHLEN = ['fin-einstand', 'fin-wert', 'fin-total-pnl', 'portfolio-current'];

/** Was eine Tabellenzeile ausser ihren Daten braucht.
 * @typedef {{ cur: string, mehrereKonten: boolean, fehlerNeutral: boolean }} Zeilenlage */

/** Stehen Zeilen mehrerer Konten da, nennt jede ihr Konto — auch das eigene;
 * sonst sieht dasselbe Set zweimal aus wie ein Fehler. @param {any} it @param {boolean} mehrereKonten */
function besitzer(it, mehrereKonten) {
  return mehrereKonten && it.owners?.length
    ? it.owners.map((/** @type {any} */ o) => `<span class="cond-badge besitzer-badge"><span class="vh">${t('finance.konto')}: </span>${esc(o.username)}</span>`).join('')
    : ownerBadges(it);
}

const condBadge = (/** @type {string} */ c) => condBadges({ conditions: [c] });
/** Ein fehlender Marktwert sieht in Zeile, Summe und Kachel gleich aus: Strich, für Vorleser „Preis fehlt“. */
const ohneWert = () => `<span class="text-mut" title="${esc(tRaw('finance.price_missing_short'))}"><span aria-hidden="true">—</span><span class="vh">${t('finance.price_missing_short')}</span></span>`;
// Feste Spaltenbreiten (colgroup, table-layout:fixed): Die Preisspalten der Teile- und Figurentabellen
// beginnen so genau unter denen der Sets, und man kann die Zahlen untereinander vergleichen.
// Ausführlich: docs/begruendungen/public/js/04-finance.js.md#condbadge
const PM_COLGROUP = `<colgroup>
    <col class="sp-60"><col class="sp-325 fin-k-name"><col class="sp-70 fin-k-zusatz"><col class="sp-100 fin-k-zusatz"><col class="sp-110"><col class="sp-110 fin-k-markt"><col class="sp-110"><col class="sp-90"><col class="sp-55">
  </colgroup>`;
/**
 * Teile- und Figurenzeilen öffnen ihr Detail wie die Kachel im Reiter: Eine Tabelle, in der nur die
 * Set-Zeilen auf Klick reagieren, sieht kaputt aus.
 * Ausführlich: docs/begruendungen/public/js/04-finance.js.md#manargs
 * @param {any} it */
const manArgs = it => it.fig_number
  ? `data-click="openManDetail" data-arg="fig" data-arg2="${escJs(it.fig_number)}" data-arg3="0"`
  : `data-click="openManDetail" data-arg="part" data-arg2="${escJs(it.part_number)}" data-arg3="${it.color_id||0}"`;
/** Ein aus Teilepreisen geschätzter Figurenpreis bekommt „≈" und die Abdeckung.
 * @param {{ estimated_from_parts?: boolean | null, abdeckung?: number | null }} it @param {string} html */
function geschaetztMarke(it, html){
  if (!it.estimated_from_parts) return html;
  const p = it.abdeckung != null ? Math.round(it.abdeckung * 100) : '?';
  const hinweis = esc(tRaw('finance.aus_teilen_geschaetzt', { p }));
  return `<span title="${hinweis}"><span role="img" aria-label="${hinweis}">≈</span> ${html}</span>`;
}

/** @param {any} it @param {string} label @param {any} acq @param {Zeilenlage} lage */
function pmRow(it, label, acq, lage){
  const cur = lage.cur;
  const qty = acq ? acq.quantity : (it.quantity || 1);
  // avg_price zuerst — wie überall seit der Preisumstellung.
  const current = acq ? parseFloat(acq.avg_price ?? 0)
                      : parseFloat(it.avg_price ?? it.qty_avg_price ?? 0);
  const purchase = acq
    ? (acq.purchase_price!=null ? parseFloat(acq.purchase_price) : null)
    : (it.purchase_price!=null ? parseFloat(it.purchase_price) : null);
  const total = acq ? (acq.wert_gesamt ?? 0) : (it.wert_gesamt ?? 0);
  const pnl = acq ? acq.pnl_prozent : it.pnl_prozent;
  const art = it.fig_number ? 'figur' : 'teil';
  const img = it.image_local||it.image_url ? bildTag({ src: imgUrl(thumbUrl(it.image_local||it.image_url)||it.image_local||it.image_url, true), orig: imgUrl(it.image_url||''), alt: '', ph: art }) : `<span class="bild-ph" aria-hidden="true">${platzhalterInhalt(art)}</span>`;
  // Der frühere dritte Parameter onclickAttr wurde von keinem Aufrufer
  // gesetzt — der Zweig war tot und hätte als Inline-Handler die CSP blockiert.
    return `<tr class="zeiger" tabindex="0" ${manArgs(it)}>
    <td class="fin-bild">${img}</td>
      <td class="fin-name"><span class="fin-name-text">${label}${acq?` ${condBadge(acq.condition)}`:''} ${besitzer(it, lage.mehrereKonten)}</span><span class="fin-unter">×${qty}</span></td>
    <td class="fin-detail zahl"><span class="qbadge">×${qty}</span></td>
    <td class="fin-detail fin-datum">${acq?.created_at?fmtDatum(acq.created_at):''}</td>
    <td class="fin-detail price-cell zahl">${einstandZelle(purchase, qty, cur, acq)}</td>
    <td class="fin-detail price-cell zahl">${current>0?geschaetztMarke(it, fmtN(current,cur)):ohneWert()}</td>
    <td class="fin-wert price-total zahl">${total > 0 ? fmtN(total,cur) : ohneWert()}</td>
    <td class="fin-guv zahl">${pnlBadge(pnl, purchase)||'<span class="text-mut">—</span>'}</td>
    <td class="fin-status"></td>
  </tr>`;
}

/** Eine Zeile je Kaufpreis-Erfassung (mindestens eine), jede mit dem Marktpreis ihres Zustands.
 * @param {any} it @param {string} label @param {Zeilenlage} lage */
function pmRows(it, label, lage){
  const acqs = it.acquisitions || [];
  if (!acqs.length) return pmRow(it, label, null, lage);
  return acqs.map((/** @type {any} */ a) => pmRow(it, label, a, lage)).join('');
}

function pmTableHead() {
  return `<thead><tr><th><span class="vh">${t('col.image')}</span></th><th>${t('col.name')}</th><th class="zahl">${t('detail.qty')}</th><th>${t('detail.added')}</th>${preisKoepfe()}<th title="${esc(t('finance.price_status'))}"><span aria-hidden="true">${t('finance.price_status_kurz')}</span><span class="vh">${esc(t('finance.price_status'))}</span></th></tr></thead>`;
}

/** Abschnitt der manuell erfassten Teile oder Figuren; leer ohne Einträge.
 * @param {{ art: string, titel: string, symbol: string, zeilen: string, anzahl: number, kauf: number, wert: number, cur: string }} o */
function manuellerAbschnitt(o) {
  if (!o.anzahl) return '';
  const fuss = `<tfoot><tr><td colspan="4" class="fin-fuss-l">${t('finance.sum')}</td>${summenZellen(o.kauf, o.wert, o.cur, 1)}<td colspan="2"></td></tr></tfoot>`;
  return `
    <div class="tw abstand-o-125" data-fin-art="${o.art}" tabindex="0" role="region" aria-label="${esc(o.titel)}">
      <div class="ctitle fin-abschnitt">${ico(o.symbol)} ${o.titel}</div>
      <table class="dt dt-fin">${PM_COLGROUP}${pmTableHead()}<tbody>${o.zeilen}</tbody>${fuss}</table>
    </div>`;
}

// Eine vollständige Zeile je Kaufpreis-Erfassung, jede mit dem Marktpreis ihres Zustands: Sonst
// bewertete eine Gebraucht-Erfassung auch das neu gekaufte Exemplar gebraucht. Keine Summenzeile und
// kein Einrücken — die Zeilen sind gleichrangige Käufe, keine Aufschlüsselung.
// Ausführlich: docs/begruendungen/public/js/04-finance.js.md#setrow
/** @param {any} s @param {any} acq @param {Zeilenlage} lage */
function setRow(s, acq, lage){
  const { cur, fehlerNeutral } = lage;
  const mitPreis = !s.error;
  const qty      = acq ? acq.quantity : s.quantity;
  const purchase = acq ? acq.purchase_price : s.purchase_price;
  const market   = acq ? acq.avg_price : s.avg_price;
  const total    = acq ? acq.wert_gesamt : s.wert_gesamt;
  // G&V je Zeile vom Server (gegen den Kaufpreis DIESER Erfassung). Ohne
  // Erfassungen bleibt der bisherige Wert aus der G&V-Antwort.
  const pnl      = acq ? acq.pnl_prozent
                       : (s.pnl_prozent ?? _pnlCache[s.set_number]?.pnl_pct);
  const dateSrc  = acq ? acq.created_at : s.added_at;
  // Die Fehlermeldung steht im Status-Symbol (Tooltip), nicht in der Summe:
  // Dort brach sie die Spalte fünfzeilig um.
  return `<tr class="zeiger" tabindex="0" data-click="openModal" data-arg="${escJs(s.set_number)}">
  <td class="fin-bild">${s.image_local||s.image_url?bildTag({ src: imgUrl(thumbUrl(s.image_local||s.image_url)||s.image_local||s.image_url, true), alt: '', ph: 'set' }):`<span class="bild-ph" aria-hidden="true">${platzhalterInhalt('set')}</span>`}</td>
  <td class="fin-detail"><span class="nummer-klein">${esc(s.set_number)}</span></td>
    <td class="fin-name">${esc(s.name)||'—'}${s.year?` <span class="fin-jahr">${s.year}</span>`:''}${acq?` ${condBadge(acq.condition)}`:''} ${besitzer(s, lage.mehrereKonten)}<span class="fin-unter">${esc(s.set_number)}${s.year?` · ${s.year}`:''} · ×${qty}</span></td>
  <td class="fin-detail zahl"><span class="qbadge">×${qty}</span></td>
  <td class="fin-detail fin-datum">${dateSrc?fmtDatum(dateSrc):'—'}</td>
  <td class="fin-detail price-cell zahl">${einstandZelle(purchase, qty, cur, acq)}</td>
    <td class="fin-detail zahl price-cell">${mitPreis && Number(market) > 0 ? fmtN(market,cur) : ohneWert()}</td>
  <td class="fin-wert zahl price-total">${mitPreis && Number(total) > 0 ? fmtN(total,cur) : ohneWert()}</td>
  <td class="fin-guv zahl">${pnlBadge(pnl, purchase)||'<span class="text-mut">—</span>'}</td>
    <td class="fin-status">${priceStatusBadge(s, fehlerNeutral)}</td>
</tr>`;
}

/** @param {string} rows @param {{ sets: number }} einstand @param {number} setsQtyAvg @param {string} cur */
function setsTabelle(rows, einstand, setsQtyAvg, cur) {
  return `<div class="tw" data-fin-art="sets" tabindex="0" role="region" aria-label="${esc(t('finance.filter.sets'))}"><div class="ctitle fin-abschnitt">${ico('set')} ${t('finance.filter.sets')}</div><table class="dt dt-fin"><colgroup><col class="sp-60"><col class="sp-90 fin-k-zusatz"><col class="sp-235 fin-k-name"><col class="sp-70 fin-k-zusatz"><col class="sp-100 fin-k-zusatz"><col class="sp-110"><col class="sp-110 fin-k-markt"><col class="sp-110"><col class="sp-90"><col class="sp-55"></colgroup><thead><tr><th><span class="vh">${t('col.image')}</span></th><th>${t('col.nr')}</th><th>${t('col.name')}</th><th class="zahl">${t('detail.qty')}</th><th>${t('detail.added')}</th>${preisKoepfe()}<th title="${esc(t('finance.price_status'))}"><span aria-hidden="true">${t('finance.price_status_kurz')}</span><span class="vh">${esc(t('finance.price_status'))}</span></th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="5" class="fin-fuss-l">${t('finance.sum')}</td>${summenZellen(einstand.sets, setsQtyAvg, cur, 1)}<td colspan="2"></td></tr></tfoot></table></div>${legende()}`;
}

/** Gesamtübersicht: Einstand und Wert je Bereich und zusammen.
 * @param {{ sets: number, parts: number, figs: number, alle: number }} einstand
 * @param {{ sets: number, parts: number, figs: number, alle: number }} wert @param {string} cur
 * @param {{ ohneMarkt: number }} basis */
function summenTabelle(einstand, wert, cur, basis) {
  const zeile = (/** @type {string} */ name, /** @type {number} */ kauf, /** @type {number} */ w, zusatz = '') =>
    `<tr><td class="fin-fuss-name">${name}</td>${summenZellen(kauf, w, cur, 0, zusatz)}</tr>`;
  return `
    <div class="tw abstand-o-125">
      <table class="dt dt-summe">
        <thead><tr><th><span class="vh">${t('finance.bereich')}</span></th><th>${t('finance.col.purchase')}</th><th>${t('finance.grand.value')}</th></tr></thead>
        <tbody>
          ${zeile(t('finance.filter.sets'), einstand.sets, wert.sets)}
          ${zeile(t('finance.grand.parts'), einstand.parts, wert.parts)}
          ${zeile(t('finance.figs_section'), einstand.figs, wert.figs)}
        </tbody>
        <tfoot>${zeile(t('finance.grand.total'), einstand.alle, wert.alle, basis.ohneMarkt > 0 ? tRaw('finance.ohne_n', { n: basis.ohneMarkt }) : '')}</tfoot>
      </table>
      ${basis.ohneMarkt > 0 ? `<p class="fin-fussnote">${esc(tRaw('finance.summe_ohne_markt', { n: basis.ohneMarkt }))}</p>` : ''}
    </div>`;
}

/** Platzhalter, solange geladen wird; eine vorhandene Tabelle bleibt stehen. @returns {boolean} ob schon eine Tabelle da war */
function finanzenLaedt() {
  const hatteTabelle = !!G('fin-tbl').querySelector('table');
  if (!hatteTabelle) G('fin-tbl').innerHTML = ladeAnzeige(t('finance.fetch_prices'));
  if (!G('fin-sum').dataset.geladen) {
    G('fin-sum').setAttribute('aria-busy', 'true');
    for (const id of KENNZAHLEN) G(id).innerHTML = WERT_SKELETT;
  }
  // Ein Fehler vom letzten Mal bleibt nicht stehen, während neu geladen wird.
  const kurve = G('portfolio-chart');
  if (kurve?.querySelector('.fehler-zustand')) kurve.innerHTML = ladeAnzeige(t('common.loading'), { klein: true });
  return hatteTabelle;
}

/** Ladefehler: Diagramm und Kennzahlen dürfen nicht auf „Laden…“ stehen bleiben. @param {any} d */
function finanzenFehlen(d) {
  if (d?.status === 401) return;
  // Grund und „Erneut versuchen“ stehen schon bei der Liste darunter; ein zweiter Block sagte dasselbe.
  if (!_letzteKurve) G('portfolio-chart').innerHTML = `<p class="fehler-zustand text-mut">${esc(tRaw('chart.unavailable'))}</p>`;
  if (!G('fin-sum').dataset.geladen) {
    G('fin-sum').removeAttribute('aria-busy');
    for (const id of KENNZAHLEN) G(id).textContent = '—';
  }
}

export async function loadFinance(){
  const hatteTabelle = finanzenLaedt();
  // Alle vier mit demselben Kontofilter — sonst stünde eine Summe aus einem
  // Blickfeld neben einer Aufstellung aus einem anderen.
  const [d, partsVal, figsVal, pnlData] = await Promise.all([
    api('GET',`/v1/finance/valuation${scopeQuery('finance')}`),
    api('GET',`/v1/finance/parts-valuation${scopeQuery('finance')}`),
    api('GET',`/v1/finance/minifigs-valuation${scopeQuery('finance')}`),
    api('GET',`/v1/finance/pnl${scopeQuery('finance')}`),
  ]);
  if (listeLadefehler(G('fin-tbl'), d, { erneut: 'loadFinance', behalten: hatteTabelle })) { finanzenFehlen(d); return; }
  const cur=d.currency;
  const extra = parseFloat(partsVal.success ? partsVal.total_value||'0' : '0') + parseFloat(figsVal.success ? figsVal.total_value||'0' : '0');
  // Ohne vergleichbaren Posten keine G&V — auch nicht die vom letzten Filter: Eine stehengebliebene Zahl
  // sähe aus wie die Antwort auf den neuen.
  // Ausführlich: docs/begruendungen/public/js/04-finance.js.md#gesamtguv
  const gesamtGuv = pnlData.success ? pnlData.totals?.pnl_prozent : null;
  const alleZeilen = [...(d.sets || []), ...(partsVal.success ? partsVal.parts : []), ...(figsVal.success ? figsVal.figs : [])];
  const mehrereKonten = new Set(alleZeilen.flatMap(z => (z.owners || []).map(o => o.id))).size > 1;
  const partsItems = partsVal.success ? partsVal.parts : [];
  const figsItems  = figsVal.success  ? figsVal.figs   : [];
  // Einstand je Abschnitt: vom Server (pnl), sonst aus den Zeilen gerechnet.
  /** @type {Partial<import('../../frontend-typen/vertrag').PnlTotals>} */
  const pt = pnlData.success ? (pnlData.totals || {}) : {};
  const einstand = {
    sets:  zahlOder(pt.sets_purchase,  einstandAus(d.sets)),
    parts: zahlOder(pt.parts_purchase, einstandAus(partsItems)),
    figs:  zahlOder(pt.figs_purchase,  einstandAus(figsItems)),
    alle: 0,
  };
  einstand.alle = zahlOder(pt.purchase, einstand.sets + einstand.parts + einstand.figs);
  const ohnePreis = d.sets.filter(s => s.error || !(Number(s.avg_price) > 0)).length
    + [...partsItems, ...figsItems].filter(it => !(Number(it.avg_price ?? it.qty_avg_price) > 0)).length;
  // Summen vom Server (`total_value`), wie in der App.
  const setsQtyAvg = parseFloat(d.totals.avg||'0');
  // Der Gesamtwert kommt vom Server (totals.grand_total, je Zeile gerechnet): Die Regel, was mitzählt,
  // soll an einer Stelle liegen. Die eigene Summe ist nur Rückfall, wenn die pnl-Abfrage scheitert.
  // Ausführlich: docs/begruendungen/public/js/04-finance.js.md#grandtotal
  const grandTotal = parseFloat(pnlData?.totals?.grand_total || '0') || (setsQtyAvg + extra);
  const basis = basisAus(pt, ohnePreis);
  const wert = { sets: setsQtyAvg, parts: parseFloat(partsVal?.total_value || '0'), figs: parseFloat(figsVal?.total_value || '0'), alle: grandTotal };
  window._finPartsExtra = extra;
  // Diagramm, Kopfzahl und Karten zeigen denselben Marktwert und Einstand.
  const kopfWert = basis.bewertet > 0 ? basis.wert : grandTotal;
  window._finGrandTotal  = kopfWert;
  if(G('portfolio-current')) G('portfolio-current').textContent = kopfWert > 0 ? fmtN(kopfWert, cur) : '—';
  _einstand = basis.bewertet > 0 ? basis.einstand : einstand.alle; _waehrung = cur;
  // Die Linie vergleicht mit der Wertkurve; fehlt Positionen der Marktpreis, nennt sie ihren Bezug.
  _einstandText = basis.bewertet > 0 && Math.abs(basis.einstand - einstand.alle) >= 0.005 ? tRaw('finance.chart.einstand_basis') : '';
  const leer = !d.sets.length && !partsItems.length && !figsItems.length;
  G('tab-finance')?.classList.toggle('finanzen-leer', leer);
  loadPortfolioChart();
  zeigeKennzahlen({ basis, einstandAlle: einstand.alle, wertAlle: grandTotal, guv: gesamtGuv, cur,
    fremdeWaehrung: pnlData?.totals?.kaufpreise_fremde_waehrung || 0 });
  // Nichts erfasst: ein Leerzustand statt Tabellen, die fünfmal „Preis fehlt“ melden.
  if (leer) {
    G('fin-tbl').innerHTML = leerZustand({ ico: 'finanzen', titel: tRaw('finance.empty'), text: tRaw('finance.empty_text'),
      knopf: { text: tRaw('gallery.add.title'), click: 'oeffneErfassen', arg: 'set' } });
    return;
  }
  // Fehlt der Preis bei den meisten Sets, ist es eine Störung, kein Einzelfall: neutral statt rot.
  const fehlerZeilen = d.sets.filter((/** @type {any} */ s) => s.error).length;
  /** @type {Zeilenlage} */
  const lage = { cur, mehrereKonten, fehlerNeutral: fehlerZeilen >= 3 && fehlerZeilen * 2 >= d.sets.length };
  const rows = d.sets.map((/** @type {any} */ s) => {
    const acqs = s.acquisitions || [];
    if (acqs.length <= 1) return setRow(s, acqs[0] || null, lage);
    return acqs.map((/** @type {any} */ a) => setRow(s, a, lage)).join('');
  }).join('');
  const partsRows = partsItems.map(p => pmRows(p, `${esc(p.part_name||p.part_number)}${p.color_name?` <span class="text-mut schrift-1">(${esc(colorName(p.color_name))})</span>`:''}`, lage)).join('');
  const figsRows  = figsItems.map(f => pmRows(f, esc(f.fig_name||f.fig_number), lage)).join('');
  G('fin-tbl').innerHTML = setsTabelle(rows, einstand, setsQtyAvg, cur)
    + manuellerAbschnitt({ art: 'parts', titel: t('parts.manual_section'), symbol: 'teil', zeilen: partsRows, anzahl: partsItems.length, kauf: einstand.parts, wert: wert.parts, cur })
    + manuellerAbschnitt({ art: 'figs', titel: t('finance.figs_section'), symbol: 'figur', zeilen: figsRows, anzahl: figsItems.length, kauf: einstand.figs, wert: wert.figs, cur })
    + summenTabelle(einstand, wert, cur, basis);
  // Der Filter überlebt das Neuzeichnen; sonst zeigten die Chips eine Auswahl,
  // die die Tabelle nicht mehr hat.
  finFilterAnwenden();
}

/**
 * Die Kaufpreisspalte zeigt den Einstand der Zeile (Menge × Stückpreis), damit
 * die Summe darunter sich aus der Spalte nachrechnen lässt; der Stückpreis
 * steht bei Menge > 1 als „je …“ darunter.
 * @param {unknown} stueck
 * @param {unknown} menge
 * @param {string} cur
 * @param {{ kaufpreis_original?: number, kaufpreis_waehrung?: string } | null} [acq]
 */
function einstandZelle(stueck, menge, cur, acq) {
  const p = stueck == null || String(stueck).trim() === '' ? NaN : Number(stueck);
  // In fremder Währung ohne Kurs zählt der Preis nicht mit, steht aber da: Ein Strich hiesse „unbekannt“.
  if (!Number.isFinite(p) && acq?.kaufpreis_original != null)
    return `${fmtGeld(acq.kaufpreis_original * (parseInt(String(menge)) || 1), acq.kaufpreis_waehrung)}<span class="fin-je">${esc(tRaw('finance.nicht_umgerechnet'))}</span>`;
  if (!Number.isFinite(p)) return '<span class="text-mut">—</span>';
  const n = parseInt(String(menge)) || 1;
  if (n <= 1) return fmtGeld(p, cur);
  return `${fmtGeld(p * n, cur)}<span class="fin-je">${esc(tRaw('finance.je', { preis: fmtGeld(p, cur) }))}</span>`;
}

/**
 * Die Köpfe der Preisspalten. Sie brechen nicht um: „Gewinn/Verlust“ steht
 * gekürzt da, der volle Name im title und für Vorleser.
 */
function preisKoepfe() {
  const kurz = (/** @type {string} */ lang, /** @type {string} */ kurzTxt) => `<th class="zahl" title="${esc(tRaw(lang))}"><span aria-hidden="true">${kurzTxt}</span><span class="vh">${t(lang)}</span></th>`;
  return `<th class="zahl">${t('finance.col.purchase')}</th>`
    + `<th class="zahl" title="${esc(tRaw('finance.market_price_stueck'))}">${t('detail.market_price')}</th>`
    + `<th class="zahl">${t('finance.grand.value')}</th>`
    + kurz('finance.total_pnl', t('finance.pnl_kurz'));
}
/** Was das Zeichen in der Spalte „Status“ heisst — ein Häkchen allein sagt es nicht. */
function legende() {
  return `<p class="fin-legende">${tRaw('finance.legende', { ok: `<span class="legende-zeichen pst pst-ok" aria-hidden="true">${ico('ok')}</span>`,
    fehlt: '<span class="legende-zeichen pst pst-leer" aria-hidden="true">–</span>', fehler: `<span class="legende-zeichen pst pst-err" aria-hidden="true">${ico('warnung')}</span>` })}</p>`;
}


/**
 * Zahl aus der Serverantwort, sonst der Ersatzwert.
 * @param {unknown} v
 * @param {number} ersatz
 */
function zahlOder(v, ersatz) { const n = parseFloat(String(v)); return Number.isFinite(n) ? n : ersatz; }

/**
 * Summe der Kaufpreise mal Menge — je Erfassung, sonst je Eintrag.
 * @typedef {{ purchase_price?: unknown, quantity?: unknown }} Kaufposten
 * @param {(Kaufposten & { acquisitions?: Kaufposten[] | null })[] | null | undefined} liste
 */
function einstandAus(liste) {
  let s = 0;
  for (const it of liste || []) {
    const acqs = it.acquisitions?.length ? it.acquisitions : [it];
    for (const a of acqs) {
      const p = parseFloat(String(a.purchase_price));
      if (Number.isFinite(p)) s += p * (parseInt(String(a.quantity)) || 1);
    }
  }
  return s;
}

/**
 * Die Zellen einer Summenzeile: Einstand und Marktwert. `luecke` Zellen
 * dazwischen halten die Spalten der Tabelle darüber (Kaufpreis | Marktpreis |
 * Total). Am Telefon tragen beide ihre Beschriftung selbst (data-kurz).
 * @param {number} kauf
 * @param {number} wert
 * @param {string} cur
 * @param {number} luecke
 */
function summenZellen(kauf, wert, cur, luecke, zusatz = '') {
  const k = `<td class="price-total fin-fuss-wert" data-kurz="${esc(t('finance.col.purchase'))}">${kauf > 0 ? fmtN(kauf, cur) : '<span class="text-mut">—</span>'}</td>`;
  const w = `<td class="price-total fin-fuss-wert" data-kurz="${esc(t('finance.grand.value'))}">${wert > 0 ? fmtN(wert, cur) + (zusatz ? `<span class="fin-je">${esc(zusatz)}</span>` : '') : ohneWert()}</td>`;
  return k + '<td></td>'.repeat(luecke) + w;
}
/**
 * Die gemeinsame Basis der Karten vom Server; ohne sie (pnl gescheitert) keine G/V.
 * @typedef {{ bewertet: number, ohneMarkt: number, ohneKauf: number, einstand: number, wert: number, betrag: number,
 *   gesamt?: number, ohneMarktEinstand?: number, ohneKaufWert?: number }} Basis
 * @param {Partial<import('../../frontend-typen/vertrag').PnlTotals>} pt @param {number} ohnePreis
 * @returns {Basis}
 */
function basisAus(pt, ohnePreis) {
  const z = (/** @type {unknown} */ v) => parseFloat(String(v)) || 0;
  if (pt.basis_einstand == null) return { bewertet: 0, ohneMarkt: ohnePreis, ohneKauf: 0, einstand: 0, wert: 0, betrag: 0 };
  return {
    gesamt: pt.positionen || 0, bewertet: pt.positionen_bewertet || 0,
    ohneMarkt: pt.positionen_ohne_marktpreis || 0, ohneKauf: pt.positionen_ohne_kaufpreis || 0,
    einstand: z(pt.basis_einstand), wert: z(pt.basis_marktwert), betrag: z(pt.basis_guv_betrag),
    ohneMarktEinstand: z(pt.ohne_marktpreis_einstand), ohneKaufWert: z(pt.ohne_kaufpreis_marktwert),
  };
}


/**
 * Die Kacheln über der Tabelle. Der Einstand ist immer bekannt; Gesamtwert
 * und G&V nur, wenn es Marktpreise gibt — sonst sagt die Kachel, für wie
 * viele Positionen der Preis fehlt, statt „—“ zu zeigen.
 */
/** @param {{ basis: Basis, einstandAlle: number, wertAlle: number, guv: number | null | undefined, cur: string, fremdeWaehrung?: number }} p */
function zeigeKennzahlen({ basis, einstandAlle, wertAlle, guv, cur, fremdeWaehrung = 0 }) {
  G('fin-sum').dataset.geladen = '1';
  G('fin-sum').removeAttribute('aria-busy');
  const mitBasis = basis.bewertet > 0;
  const einstand = mitBasis ? basis.einstand : einstandAlle;
  const wert = mitBasis ? basis.wert : wertAlle;
  const teilweise = mitBasis && Math.abs(einstandAlle - basis.einstand) >= 0.005;
  G('fin-einstand-titel').textContent = tRaw(teilweise ? 'finance.stat.purchase_basis' : 'finance.stat.purchase');
  G('fin-einstand').textContent = einstand > 0 || mitBasis ? fmtN(einstand, cur) : '—';
  // Kaufpreise in anderer Währung zählt der Server nicht mit (keine Kurse).
  // Kaufpreise in anderer Währung zählt der Server nicht mit (keine Kurse);
  // die Zahl dazu steht unter der Summe statt still zu fehlen.
  G('fin-einstand-sub').textContent = fremdeWaehrung > 0
    ? tRaw('finance.fremde_waehrung_n', { n: fremdeWaehrung })
    : teilweise ? tRaw('finance.stat.purchase_von', { betrag: fmtN(einstandAlle, cur) }) : tRaw('finance.stat.purchase_hint');
  const fehlt = basis.ohneMarkt > 0 ? tRaw('finance.price_missing_n', { n: basis.ohneMarkt }) : '';
  // Rechnet die Kachel nur über bewertete Posten, sagt sie es; sonst stünden zwei „Marktwerte“ verschieden da.
  const wertTeilweise = mitBasis && Math.abs(wertAlle - basis.wert) >= 0.005;
  G('fin-wert-titel').textContent = tRaw(wertTeilweise ? 'finance.stat.value_basis' : 'finance.stat.value');
  if (wert > 0) {
    G('fin-wert').textContent = fmtN(wert, cur);
    G('fin-wert-sub').textContent = wertTeilweise ? tRaw('finance.stat.value_von', { betrag: fmtN(wertAlle, cur) }) : tRaw('finance.stat.value_hint');
  } else {
    // Ohne Positionen fehlt kein Preis — dann einfach „—“.
    if (fehlt) G('fin-wert').innerHTML = `<span class="fval-hinweis">${esc(fehlt)}</span>`;
    else G('fin-wert').textContent = '—';
    G('fin-wert-sub').textContent = '';
  }
  // Die Kachel bleibt stehen, damit die Reihe nicht springt; ohne Preise mit Hinweis.
  if (mitBasis && guv != null) {
    G('fin-total-pnl').innerHTML = pnlBadge(guv);
    // Betrag und Prozent aus denselben Posten (mit Kauf- UND Marktpreis).
    // „gegenüber dem Einstand“: Das Prozent im Diagramm rechnet gegen den Anfang des Zeitraums.
    const b = basis.betrag;
    G('fin-pnl-sub').textContent = tRaw('finance.pnl_vs_purchase', { betrag: `${b >= 0 ? '+' : '−'}${fmtN(Math.abs(b), cur)}` });
  } else {
    G('fin-total-pnl').textContent = '—';
    G('fin-pnl-sub').textContent = tRaw('finance.pnl_needs_prices');
  }
  const zeile = G('fin-basis');
  if (!zeile) return;
  const teile = [];
  if (basis.ohneMarkt > 0) teile.push(tRaw('finance.basis.ohne_markt', { n: basis.ohneMarkt, betrag: fmtN(basis.ohneMarktEinstand || 0, cur) }));
  if (basis.ohneKauf > 0) teile.push(tRaw('finance.basis.ohne_kauf', { n: basis.ohneKauf, betrag: fmtN(basis.ohneKaufWert || 0, cur) }));
  if (!mitBasis || !teile.length) { zeile.hidden = true; zeile.textContent = ''; return; }
  zeile.hidden = false;
  zeile.innerHTML = `${ico('info')}<span><strong>${esc(tRaw('finance.basis.gerechnet', { n: basis.bewertet, von: basis.gesamt }))}</strong> ${esc(teile.join(' · '))}</span>`;
}

// Kategoriefilter wie in der Android-App; leere Auswahl heisst alle. Gefiltert wird durch Ausblenden,
// nicht Neuzeichnen: Die Summen beschreiben den Bestand, nicht die Auswahl, und sollen stehen bleiben.
// Ausführlich: docs/begruendungen/public/js/04-finance.js.md#finkategorien
const finKategorien = new Set();

/**
 * Zeigt der Reiter diese Zeilenart? Leere Auswahl heisst: alle.
 * @param {string} art
 */
function finZeigt(art){ return finKategorien.size === 0 || finKategorien.has(art); }

/** Abschnitte ein-/ausblenden und die Chips nachziehen. */
function finFilterAnwenden(){
  // style.display statt des hidden-Attributs: `.tw` setzt in styles.css eine
  // eigene Darstellung, und eine Autoren-Regel schlaegt das `[hidden]` des
  // Browsers. Der Abschnitt bliebe sichtbar, ohne dass etwas scheitert.
  alle('#fin-tbl [data-fin-art]').forEach(el => {
    el.style.display = finZeigt(el.dataset.finArt ?? '') ? '' : 'none';
  });
  alle('#fin-filter button').forEach(b => {
    const art = b.dataset.art;
    const an = art ? finKategorien.has(art) : finKategorien.size === 0;
    b.classList.toggle('active', an);
    b.setAttribute('aria-pressed', String(an));
  });
}

/**
 * Ein Chip wurde geklickt.
 * 
 * „alle" raeumt die Auswahl weg; die drei uebrigen schalten ihre Zeilenart
 * einzeln zu und wieder ab. Die letzte Art abzuwaehlen fuehrt auf die leere
 * Menge — und die heisst wieder ALLE. Eine Ansicht, die nach dem Abwaehlen
 * leer bliebe, waere kein Filter, sondern eine leere Seite.
 * @param {string} art
 */
function finFilter(art){
  if (art === 'alle') finKategorien.clear();
  else if (finKategorien.has(art)) finKategorien.delete(art);
  else finKategorien.add(art);
  finFilterAnwenden();
}


// ── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
registerActions({
  loadFinance,
  loadPortfolioChart,
  setChartPeriod,
  finFilter,
});
