// Finanzen: Bewertung, G&V und Wertentwicklung des Bestands.
import {
  ladeAnzeige,
  listeLadefehler,
  condBadges,
  ownerBadges,
  kontoAnzeige,
  pnlBadge,
  geschaetztKauf,
  zeilenKnopf,
} from './bausteine.js';
import { registerActions } from './registry.js';
import { colorName, t, tRaw } from '../i18n.js';
import { escJs, esc, html, ungeprueft } from './escapen.js';
import { api } from './api.js';
import { bildTag, platzhalterInhalt, imgUrl, thumbUrl } from './bilder.js';
import { leerZustand, meldeTreffer, ico, G, alle, setzeHtml } from './dom.js';
import { fmtDatum, fmtGeld, fmtN } from './format.js';
import { scopeQuery } from './scope.js';
import { _pnlCache } from './zustand.js';
import { kurveDa, loadPortfolioChart, setzeEinstand } from './wertkurve.js';
import { basisAus, zeigeKennzahlen } from './finanz-kennzahlen.js';
/** @typedef {import('./finanz-kennzahlen.js').Basis} Basis */

/**
 * Plakette „Marktpreis da oder nicht“ mit nur zwei Zuständen: Ob der Preis aus dem Cache oder frisch kam,
 * ändert an der Zahl nichts. title UND aria-label, sonst sind es unerklärte Zeichen auch für
 * Vorleseprogramme.
 */
/** @param {{ error?: string | null, no_price?: boolean | null, bl_unbekannt?: boolean | null }} s */
function priceStatusBadge(s, neutral = false) {
  // Fehlt der Preis fast überall (kein Zugang, Dienst noch nicht gelaufen), ist das kein Fehler dieser Zeile:
  // grau statt rot, der Grund im Tooltip.
  if (s.error) {
    const titel = `${t('finance.price_failed')}: ${s.error}`;
    return html`<span class="pst ${neutral ? 'pst-leer' : 'pst-err'}" title="${titel}" role="img" aria-label="${titel}">${neutral ? '–' : ico('warnung')}</span>`;
  }
  // Ohne Marktpreis kein Haken: Er sagte „vorhanden" über einer leeren Spalte.
  if (s.no_price) {
    const titel = t(s.bl_unbekannt ? 'finance.price_unknown_bl' : 'finance.price_none');
    return html`<span class="pst pst-leer" title="${titel}" role="img" aria-label="${titel}">–</span>`;
  }
  const titel = t('finance.price_loaded');
  return html`<span class="pst pst-ok" title="${titel}" role="img" aria-label="${titel}">${ico('ok')}</span>`;
}

/** Platzhalter einer Kennzahl, solange sie lädt — „—“ hiesse „kein Wert“. */
const WERT_SKELETT = '<span class="skelett-zeile skelett-wert" aria-hidden="true"></span>';
/** Alle Kennzahlen laden gleich: Gerüst statt „—“, auch Gewinn/Verlust. */
const KENNZAHLEN = ['fin-einstand', 'fin-wert', 'fin-total-pnl', 'portfolio-current'];

/** Was eine Tabellenzeile ausser ihren Daten braucht.
 * @typedef {{ cur: string, mehrereKonten: boolean, fehlerNeutral: boolean }} Zeilenlage */
/** @typedef {import('../../frontend-typen/vertrag').ValuationSet & { error?: string | null, owners?: { id: number, username: string }[] }} BewertetesSet */
/** @typedef {BewertetesSet['acquisitions'][number]} SetKauf */
/** @typedef {import('../../frontend-typen/vertrag').PartsValuationResponse['parts'][number] | import('../../frontend-typen/vertrag').FigsValuationResponse['figs'][number]} ManPosten */
/** @typedef {ManPosten['acquisitions'][number]} ManKauf */

/** Stehen Zeilen mehrerer Konten da, nennt jede ihr Konto — auch das eigene;
 * sonst sieht dasselbe Set zweimal aus wie ein Fehler. @param {{ owners?: { id: number, username: string }[] }} it @param {boolean} mehrereKonten */
function besitzer(it, mehrereKonten) {
  return mehrereKonten && it.owners?.length
    ? it.owners.map(
        o =>
          html`<span class="cond-badge besitzer-badge"><span class="vh">${tRaw('finance.konto')}: </span>${kontoAnzeige(o)}</span>`,
      )
    : ownerBadges(it);
}

const condBadge = (/** @type {string} */ c) => condBadges({ conditions: [c] });
/** Marktwert der Zeile, bei mehreren Stück mit dem Stückpreis darunter, wie beim Kaufpreis: eine eigene Spalte
 * dafür stand bei Sets fast immer leer. @param {number} gesamt @param {number} stueck @param {unknown} menge @param {string} cur */
const wertMitStueck = (gesamt, stueck, menge, cur) =>
  (parseInt(String(menge), 10) || 1) > 1 && stueck > 0
    ? html`${fmtN(gesamt, cur)}<span class="fin-je">${tRaw('finance.je', { preis: fmtN(stueck, cur) })}</span>`
    : fmtN(gesamt, cur);
/** Ein fehlender Marktwert sieht in Zeile, Summe und Kachel gleich aus: Strich, für Vorleser „Preis fehlt“. */
const ohneWert = () =>
  html`<span class="text-mut" title="${tRaw('finance.price_missing_short')}"><span aria-hidden="true">—</span><span class="vh">${tRaw('finance.price_missing_short')}</span></span>`;
// Feste Spaltenbreiten (colgroup, table-layout:fixed): Die Preisspalten der Teile- und Figurentabellen
// beginnen so genau unter denen der Sets, und man kann die Zahlen untereinander vergleichen.
const PM_COLGROUP = html`<colgroup>
    <col class="sp-60"><col class="sp-325 fin-k-name"><col class="sp-70 fin-k-zusatz"><col class="sp-100 fin-k-zusatz"><col class="sp-110"><col class="sp-110"><col class="sp-90"><col class="sp-55">
  </colgroup>`;
/**
 * Teile- und Figurenzeilen öffnen ihr Detail wie die Kachel im Reiter: Eine Tabelle, in der nur die
 * Set-Zeilen auf Klick reagieren, sieht kaputt aus.
 * @param {{ fig_number?: string, part_number?: string, color_id?: number }} it */
const manZiel = (/** @type {{ fig_number?: string, part_number?: string, color_id?: number }} */ it) =>
  it.fig_number
    ? { click: 'openManDetail', arg: 'fig', arg2: it.fig_number, arg3: 0 }
    : { click: 'openManDetail', arg: 'part', arg2: it.part_number ?? '', arg3: it.color_id || 0 };
/** @param {{ fig_number?: string, part_number?: string, color_id?: number }} it */
const manArgs = it =>
  it.fig_number
    ? `data-click="openManDetail" data-arg="fig" data-arg2="${escJs(it.fig_number)}" data-arg3="0"`
    : `data-click="openManDetail" data-arg="part" data-arg2="${escJs(it.part_number)}" data-arg3="${it.color_id || 0}"`;
/** Ein aus Teilepreisen geschätzter Figurenpreis bekommt „≈" und die Abdeckung.
 * @param {{ estimated_from_parts?: boolean | null, abdeckung?: number | null }} it @param {string} markup */
function geschaetztMarke(it, markup) {
  if (!it.estimated_from_parts) return markup;
  const p = it.abdeckung != null ? Math.round(it.abdeckung * 100) : '?';
  const hinweis = esc(tRaw('finance.aus_teilen_geschaetzt', { p }));
  return html`<span title="${hinweis}"><span role="img" aria-label="${hinweis}">≈</span> ${ungeprueft(markup)}</span>`;
}

/** Am Telefon fehlt die Kaufpreisspalte; die Zeile darunter sagt dann, dass der Kaufpreis geschätzt ist.
 * @param {{ price_estimated?: boolean } | null | undefined} acq */
function unterGeschaetzt(acq) {
  return acq?.price_estimated ? html` · ${geschaetztKauf(tRaw('finance.kauf_geschaetzt'))}` : '';
}

/** Am Telefon fehlt die Spalte Kaufpreis; der Kaufpreis der Zeile steht dann unter dem Namen.
 * @param {unknown} stueck @param {unknown} menge @param {string} cur */
function unterKauf(stueck, menge, cur) {
  const p = stueck == null || String(stueck).trim() === '' ? NaN : Number(stueck);
  if (!Number.isFinite(p)) return '';
  const betrag = fmtGeld(p * (parseInt(String(menge), 10) || 1), cur);
  return html`<span class="fin-unter-kauf"> · ${tRaw('finance.col.purchase')} ${betrag}</span>`;
}

/** Ohne Marktpreis: am Rechner ein Strich unter dem Spaltenkopf, am Telefon in Worten und ohne leere G/V-Zelle. */
const ohneMarkt = () =>
  html`<span class="fin-strich">${ohneWert()}</span><span class="fin-kein-markt">${tRaw('finance.kein_marktpreis')}</span>`;
const ohneGuv = () => html`<span class="text-mut fin-guv-leer">—</span>`;

/** @param {ManPosten} it @param {string} label @param {ManKauf | null} acq @param {Zeilenlage} lage @param {string} text sichtbarer Name ohne Markup */
function pmRow(it, label, acq, lage, text) {
  const cur = lage.cur;
  const qty = acq ? acq.quantity : it.quantity || 1;
  // avg_price zuerst — wie überall seit der Preisumstellung.
  const current = acq ? Number(acq.avg_price ?? 0) : Number(it.avg_price ?? it.qty_avg_price ?? 0);
  const purchase = acq
    ? acq.purchase_price != null
      ? Number(acq.purchase_price)
      : null
    : it.purchase_price != null
      ? Number(it.purchase_price)
      : null;
  const total = acq ? (acq.wert_gesamt ?? 0) : (it.wert_gesamt ?? 0);
  const pnl = acq ? acq.pnl_prozent : it.pnl_prozent;
  const art = it.fig_number ? 'figur' : 'teil';
  const img =
    it.image_local || it.image_url
      ? bildTag({
          src: imgUrl(thumbUrl(it.image_local || it.image_url) || it.image_local || it.image_url, true),
          orig: imgUrl(it.image_url || ''),
          alt: '',
          ph: art,
        })
      : html`<span class="bild-ph" aria-hidden="true">${platzhalterInhalt(art)}</span>`;
  // Der frühere dritte Parameter onclickAttr wurde von keinem Aufrufer gesetzt — der Zweig war tot und hätte
  // als Inline-Handler die CSP blockiert.
  return html`<tr class="zeiger" ${ungeprueft(manArgs(it))}>
    <td class="fin-bild">${img}</td>
      <td class="fin-name"><span class="fin-name-text">${zeilenKnopf(manZiel(it), ungeprueft(label), tRaw('zeile.oeffnen', { name: text, nr: it.fig_number || it.part_number || '' }))}${acq ? html` ${condBadge(acq.condition)}` : ''} ${besitzer(it, lage.mehrereKonten)}</span><span class="fin-unter">×${qty}${unterKauf(purchase, qty, cur)}${unterGeschaetzt(acq)}</span></td>
    <td class="fin-detail zahl"><span class="qbadge">×${qty}</span></td>
    <td class="fin-detail fin-datum">${acq?.created_at ? fmtDatum(acq.created_at) : ''}</td>
    <td class="fin-detail price-cell zahl">${ungeprueft(einstandZelle(purchase, qty, cur, acq))}</td>
    <td class="fin-wert price-total zahl">${total > 0 ? ungeprueft(geschaetztMarke(/** @type {{ estimated_from_parts?: boolean | null, abdeckung?: number | null }} */ (it), String(wertMitStueck(total, current, qty, cur)))) : ohneMarkt()}</td>
    <td class="fin-guv zahl">${pnlBadge(pnl, purchase) || ohneGuv()}</td>
    <td class="fin-status">${priceStatusBadge({ no_price: !(current > 0) })}</td>
  </tr>`;
}

/** Eine Zeile je Kaufpreis-Erfassung (mindestens eine), jede mit dem Marktpreis ihres Zustands.
 * @param {ManPosten} it @param {string} label @param {Zeilenlage} lage */
function pmRows(it, label, lage) {
  // Der Name des Zeilenknopfs enthält, was sichtbar dasteht (WCAG 2.5.3), ohne das Markup des Etiketts.
  const farbe = 'color_name' in it && it.color_name ? ` (${colorName(String(it.color_name))})` : '';
  const text =
    'fig_number' in it && it.fig_number
      ? String(it.fig_name || it.fig_number)
      : `${'part_name' in it ? it.part_name || it.part_number : ''}${farbe}`;
  const acqs = it.acquisitions || [];
  if (!acqs.length) return pmRow(it, label, null, lage, text);
  return acqs.map(a => pmRow(it, label, a, lage, text)).join('');
}

function pmTableHead() {
  return html`<thead><tr><th><span class="vh">${tRaw('col.image')}</span></th><th>${tRaw('col.name')}</th><th class="zahl">${tRaw('detail.qty')}</th><th>${tRaw('detail.added')}</th>${preisKoepfe()}<th title="${t('finance.price_status')}"><span aria-hidden="true">${tRaw('finance.price_status_kurz')}</span><span class="vh">${t('finance.price_status')}</span></th></tr></thead>`;
}

/** Abschnitt der manuell erfassten Teile oder Figuren; leer ohne Einträge.
 * @param {{ art: string, titel: string, symbol: string, zeilen: string, anzahl: number, kauf: number, wert: number, cur: string }} o */
function manuellerAbschnitt(o) {
  if (!o.anzahl) return '';
  const fuss = html`<tfoot><tr><td colspan="4" class="fin-fuss-l">${tRaw('finance.sum')}</td>${summenZellen(o.kauf, o.wert, o.cur)}<td colspan="2"></td></tr></tfoot>`;
  return html`
    <div class="tw abstand-o-125" data-fin-art="${o.art}" tabindex="0" role="region" aria-label="${o.titel}">
      <h2 class="ctitle fin-abschnitt">${ico(o.symbol)} ${ungeprueft(o.titel)}</h2>
      <table class="dt dt-fin" aria-label="${o.titel}">${PM_COLGROUP}${pmTableHead()}<tbody>${ungeprueft(o.zeilen)}</tbody>${fuss}</table>
    </div>`;
}

// Eine vollständige Zeile je Kaufpreis-Erfassung, jede mit dem Marktpreis ihres Zustands: Sonst bewertete
// eine Gebraucht-Erfassung auch das neu gekaufte Exemplar gebraucht. Keine Summenzeile und kein Einrücken —
// die Zeilen sind gleichrangige Käufe, keine Aufschlüsselung.
/** @param {BewertetesSet} s @param {SetKauf | null} acq @param {Zeilenlage} lage */
function setRow(s, acq, lage) {
  const { cur, fehlerNeutral } = lage;
  const mitPreis = !s.error;
  const qty = acq ? acq.quantity : s.quantity;
  const purchase = acq ? acq.purchase_price : s.purchase_price;
  const market = acq ? acq.avg_price : s.avg_price;
  const total = acq ? acq.wert_gesamt : s.wert_gesamt;
  // G&V je Zeile vom Server (gegen den Kaufpreis DIESER Erfassung). Ohne Erfassungen bleibt der bisherige
  // Wert aus der G&V-Antwort.
  const pnl = acq ? acq.pnl_prozent : (s.pnl_prozent ?? _pnlCache[s.set_number]?.pnl_pct);
  const dateSrc = acq ? acq.created_at : s.added_at;
  // Die Fehlermeldung steht im Status-Symbol (Tooltip), nicht in der Summe: Dort brach sie die Spalte
  // fünfzeilig um.
  return html`<tr class="zeiger" data-click="openModal" data-arg="${s.set_number}">
  <td class="fin-bild">${s.image_local || s.image_url ? bildTag({ src: imgUrl(thumbUrl(s.image_local || s.image_url) || s.image_local || s.image_url, true), alt: '', ph: 'set' }) : html`<span class="bild-ph" aria-hidden="true">${platzhalterInhalt('set')}</span>`}</td>
  <td class="fin-detail"><span class="nummer-klein">${s.set_number}</span></td>
    <td class="fin-name">${zeilenKnopf({ click: 'openModal', arg: s.set_number }, s.name || '—', tRaw('zeile.oeffnen', { name: s.name || s.set_number, nr: s.set_number }))}${s.year ? html` <span class="fin-jahr">${s.year}</span>` : ''}${acq ? html` ${condBadge(acq.condition)}` : ''} ${besitzer(s, lage.mehrereKonten)}<span class="fin-unter">${s.set_number}${s.year ? html` · ${s.year}` : ''} · ×${qty}${unterKauf(purchase, qty, cur)}${unterGeschaetzt(acq)}</span></td>
  <td class="fin-detail zahl"><span class="qbadge">×${qty}</span></td>
  <td class="fin-detail fin-datum">${dateSrc ? fmtDatum(dateSrc) : '—'}</td>
  <td class="fin-detail price-cell zahl">${ungeprueft(einstandZelle(purchase, qty, cur, acq))}</td>
  <td class="fin-wert zahl price-total">${mitPreis && Number(total) > 0 ? wertMitStueck(Number(total), Number(market), qty, cur) : ohneMarkt()}</td>
  <td class="fin-guv zahl">${pnlBadge(pnl, purchase) || ohneGuv()}</td>
    <td class="fin-status">${priceStatusBadge(s, fehlerNeutral)}</td>
</tr>`;
}

/** @param {string} rows @param {{ sets: number }} einstand @param {number} setsQtyAvg @param {string} cur */
function setsTabelle(rows, einstand, setsQtyAvg, cur) {
  return html`<div class="tw" data-fin-art="sets" tabindex="0" role="region" aria-label="${t('finance.filter.sets')}"><h2 class="ctitle fin-abschnitt">${ico('set')} ${tRaw('finance.filter.sets')}</h2><table class="dt dt-fin" aria-label="${tRaw('finance.filter.sets')}"><colgroup><col class="sp-60"><col class="sp-90 fin-k-zusatz"><col class="sp-235 fin-k-name"><col class="sp-70 fin-k-zusatz"><col class="sp-100 fin-k-zusatz"><col class="sp-110"><col class="sp-110"><col class="sp-90"><col class="sp-55"></colgroup><thead><tr><th><span class="vh">${tRaw('col.image')}</span></th><th>${tRaw('col.nr')}</th><th${sortStand('name', true)}>${sortKnopf('name', true, tRaw('col.name'))}</th><th class="zahl">${tRaw('detail.qty')}</th><th>${tRaw('detail.added')}</th>${preisKoepfe(true)}<th title="${t('finance.price_status')}"><span aria-hidden="true">${tRaw('finance.price_status_kurz')}</span><span class="vh">${t('finance.price_status')}</span></th></tr></thead><tbody>${ungeprueft(rows)}</tbody><tfoot><tr><td colspan="5" class="fin-fuss-l">${tRaw('finance.sum')}</td>${summenZellen(einstand.sets, setsQtyAvg, cur)}<td colspan="2"></td></tr></tfoot></table></div>${legende()}`;
}

/** Gesamtübersicht: Einstand und Wert je Bereich und zusammen.
 * @param {{ sets: number, parts: number, figs: number, alle: number }} einstand
 * @param {{ sets: number, parts: number, figs: number, alle: number }} wert @param {string} cur
 * @param {{ ohneMarkt: number }} basis */
function summenTabelle(einstand, wert, cur, basis) {
  const zeile = (/** @type {string} */ name, /** @type {number} */ kauf, /** @type {number} */ w, zusatz = '') =>
    html`<tr><td class="fin-fuss-name">${ungeprueft(name)}</td>${summenZellen(kauf, w, cur, zusatz)}</tr>`;
  return html`
    <div class="tw abstand-o-125">
      <table class="dt dt-summe" aria-label="${tRaw('finance.sum')}">
        <thead><tr><th><span class="vh">${tRaw('finance.bereich')}</span></th><th>${tRaw('finance.col.purchase')}</th><th>${tRaw('finance.grand.value')}</th></tr></thead>
        <tbody>
          ${zeile(tRaw('finance.filter.sets'), einstand.sets, wert.sets)}
          ${zeile(tRaw('finance.grand.parts'), einstand.parts, wert.parts)}
          ${zeile(tRaw('finance.figs_section'), einstand.figs, wert.figs)}
        </tbody>
        <tfoot>${zeile(tRaw('finance.grand.total'), einstand.alle, wert.alle, basis.ohneMarkt > 0 ? tRaw('finance.ohne_n', { n: basis.ohneMarkt }) : '')}</tfoot>
      </table>
      ${basis.ohneMarkt > 0 ? html`<p class="fin-fussnote">${tRaw('finance.summe_ohne_markt', { n: basis.ohneMarkt })}</p>` : ''}
    </div>`;
}

/** Platzhalter, solange geladen wird; eine vorhandene Tabelle bleibt stehen. @returns {boolean} ob schon eine Tabelle da war */
function finanzenLaedt() {
  const hatteTabelle = !!G('fin-tbl').querySelector('table');
  if (!hatteTabelle) setzeHtml(G('fin-tbl'), ladeAnzeige(tRaw('finance.fetch_prices')));
  G('fin-sum').hidden = false;
  if (!G('fin-sum').dataset.geladen) {
    G('fin-sum').setAttribute('aria-busy', 'true');
    for (const id of KENNZAHLEN) setzeHtml(G(id), ungeprueft(WERT_SKELETT));
  }
  // Ein Fehler vom letzten Mal bleibt nicht stehen, während neu geladen wird.
  const kurve = G('portfolio-chart');
  if (kurve?.querySelector('.fehler-zustand')) setzeHtml(kurve, ladeAnzeige(tRaw('common.loading'), { klein: true }));
  return hatteTabelle;
}

/** Ladefehler: Grund und „Erneut versuchen“ einmal, oben im Diagrammkasten; Karten ohne Zahl fallen weg (fünfmal
 * „—“ über der Meldung sah aus wie eine leere Sammlung). @param {Parameters<typeof listeLadefehler>[1]} d
 * @param {boolean} hatteTabelle @returns {boolean} true, wenn es ein Fehler war */
function finanzenFehlen(d, hatteTabelle) {
  const imKasten = !hatteTabelle && !kurveDa();
  const ziel = G(imKasten ? 'portfolio-chart' : 'fin-tbl');
  const titel = tRaw('finance.fehler_titel');
  if (!listeLadefehler(ziel, d, { erneut: 'loadFinance', behalten: hatteTabelle, titel })) return false;
  if (imKasten) {
    setzeHtml(G('fin-tbl'), '');
    // Wieder frei gibt sie loadPortfolioChart(), sobald ein Verlauf da ist.
    for (const b of document.querySelectorAll('.zeitraum-wahl .period-btn')) b.setAttribute('disabled', '');
    filterBedienbar(false);
  }
  if (!G('fin-sum').dataset.geladen) {
    G('fin-sum').removeAttribute('aria-busy');
    G('fin-sum').hidden = true;
    G('portfolio-current').textContent = '—';
  }
  return true;
}

/** Ohne Liste filtern Chips und Suche nichts; bedienbar sähen sie aus, als gäbe es etwas zu filtern.
 * @param {boolean} frei */
function filterBedienbar(frei) {
  for (const el of alle('#fin-filter button, #fin-suche')) /** @type {HTMLButtonElement} */ (el).disabled = !frei;
}

export async function loadFinance() {
  const hatteTabelle = finanzenLaedt();
  // Alle vier mit demselben Kontofilter — sonst stünde eine Summe aus einem Blickfeld neben einer Aufstellung
  // aus einem anderen.
  const [d, partsVal, figsVal, pnlData] = await Promise.all([
    api('GET', `/v1/finance/valuation${scopeQuery('finance')}`),
    api('GET', `/v1/finance/parts-valuation${scopeQuery('finance')}`),
    api('GET', `/v1/finance/minifigs-valuation${scopeQuery('finance')}`),
    api('GET', `/v1/finance/pnl${scopeQuery('finance')}`),
  ]);
  if (finanzenFehlen(d, hatteTabelle) || !d?.success) return;
  filterBedienbar(true);
  const cur = d.currency;
  const extra =
    parseFloat(partsVal.success ? partsVal.total_value || '0' : '0') +
    parseFloat(figsVal.success ? figsVal.total_value || '0' : '0');
  // Ohne vergleichbaren Posten keine G&V — auch nicht die vom letzten Filter: Eine stehengebliebene Zahl sähe
  // aus wie die Antwort auf den neuen.
  const gesamtGuv = pnlData.success ? pnlData.totals?.pnl_prozent : null;
  const alleZeilen = [
    ...(d.sets || []),
    ...(partsVal.success ? partsVal.parts : []),
    ...(figsVal.success ? figsVal.figs : []),
  ];
  const mehrereKonten = new Set(alleZeilen.flatMap(z => (z.owners || []).map(o => o.id))).size > 1;
  const partsItems = partsVal.success ? partsVal.parts : [];
  const figsItems = figsVal.success ? figsVal.figs : [];
  // Einstand je Abschnitt: vom Server (pnl), sonst aus den Zeilen gerechnet.
  /** @type {Partial<import('../../frontend-typen/vertrag').PnlTotals>} */
  const pt = pnlData.success ? pnlData.totals || {} : {};
  const einstand = {
    sets: zahlOder(pt.sets_purchase, einstandAus(d.sets)),
    parts: zahlOder(pt.parts_purchase, einstandAus(partsItems)),
    figs: zahlOder(pt.figs_purchase, einstandAus(figsItems)),
    alle: 0,
  };
  einstand.alle = zahlOder(pt.purchase, einstand.sets + einstand.parts + einstand.figs);
  const ohnePreis =
    d.sets.filter(s => s.error || !(Number(s.avg_price) > 0)).length +
    [...partsItems, ...figsItems].filter(it => !(Number(it.avg_price ?? it.qty_avg_price) > 0)).length;
  // Summen vom Server (`total_value`), wie in der App.
  const setsQtyAvg = parseFloat(d.totals.avg || '0');
  // Der Gesamtwert kommt vom Server (totals.grand_total, je Zeile gerechnet): Die Regel, was mitzählt, soll
  // an einer Stelle liegen. Die eigene Summe ist nur Rückfall, wenn die pnl-Abfrage scheitert.
  const grandTotal = parseFloat(pnlData?.totals?.grand_total || '0') || setsQtyAvg + extra;
  const basis = basisAus(pt, ohnePreis);
  const wert = {
    sets: setsQtyAvg,
    parts: parseFloat(partsVal?.total_value || '0'),
    figs: parseFloat(figsVal?.total_value || '0'),
    alle: grandTotal,
  };
  window._finPartsExtra = extra;
  // Diagramm, Kopfzahl und Karten zeigen denselben Marktwert und Einstand.
  const kopfWert = basis.bewertet > 0 ? basis.wert : grandTotal;
  window._finGrandTotal = kopfWert;
  if (G('portfolio-current')) G('portfolio-current').textContent = kopfWert > 0 ? fmtN(kopfWert, cur) : '—';
  // Die Linie vergleicht mit der Wertkurve; fehlt Positionen der Marktpreis, nennt sie ihren Bezug.
  setzeEinstand(
    basis.bewertet > 0 ? basis.einstand : einstand.alle,
    cur,
    basis.bewertet > 0 && Math.abs(basis.einstand - einstand.alle) >= 0.005 ? tRaw('finance.chart.kaufpreis') : '',
  );
  const leer = !d.sets.length && !partsItems.length && !figsItems.length;
  G('tab-finance')?.classList.toggle('finanzen-leer', leer);
  loadPortfolioChart();
  zeigeKennzahlen({
    basis,
    einstandAlle: einstand.alle,
    wertAlle: grandTotal,
    guv: gesamtGuv,
    cur,
    fremdeWaehrung: pnlData?.totals?.kaufpreise_fremde_waehrung || 0,
    geschaetzt: alleZeilen.flatMap(z => z.acquisitions || []).filter(a => a.price_estimated).length,
    zeilen: alleZeilen.reduce((n, z) => n + Math.max(1, z.acquisitions?.length || 0), 0),
  });
  // Nichts erfasst: ein Leerzustand statt Tabellen, die fünfmal „Preis fehlt“ melden.
  if (leer) {
    setzeHtml(
      G('fin-tbl'),
      leerZustand({
        ico: 'finanzen',
        titel: tRaw('finance.empty'),
        text: tRaw('finance.empty_text'),
        knopf: { text: tRaw('gallery.add.title'), click: 'oeffneErfassen', arg: 'set' },
      }),
    );
    return;
  }
  // Fehlt der Preis bei den meisten Sets, ist es eine Störung, kein Einzelfall: neutral statt rot.
  const fehlerZeilen = d.sets.filter(s => s.error).length;
  /** @type {Zeilenlage} */
  const lage = { cur, mehrereKonten, fehlerNeutral: fehlerZeilen >= 3 && fehlerZeilen * 2 >= d.sets.length };
  _finStand = { sets: d.sets, parts: partsItems, figs: figsItems, einstand, wert, setsQtyAvg, cur, basis, lage };
  zeichneFinanzTabellen();
}

/**
 * Die Kaufpreisspalte zeigt den Einstand der Zeile (Menge × Stückpreis), damit die Summe darunter sich aus
 * der Spalte nachrechnen lässt; der Stückpreis steht bei Menge > 1 als „je …“ darunter.
 * @param {unknown} stueck
 * @param {unknown} menge
 * @param {string} cur
 * @param {{ kaufpreis_original?: number, kaufpreis_waehrung?: string, price_estimated?: boolean } | null} [acq]
 */
function einstandZelle(stueck, menge, cur, acq) {
  const betrag = einstandBetrag(stueck, menge, cur, acq);
  return acq?.price_estimated ? geschaetztKauf(betrag) : betrag;
}

/**
 * @param {unknown} stueck @param {unknown} menge @param {string} cur
 * @param {{ kaufpreis_original?: number, kaufpreis_waehrung?: string } | null} [acq]
 */
function einstandBetrag(stueck, menge, cur, acq) {
  const p = stueck == null || String(stueck).trim() === '' ? NaN : Number(stueck);
  // In fremder Währung ohne Kurs zählt der Preis nicht mit, steht aber da: Ein Strich hiesse „unbekannt“.
  if (!Number.isFinite(p) && acq?.kaufpreis_original != null)
    return html`${fmtGeld(acq.kaufpreis_original * (parseInt(String(menge), 10) || 1), acq.kaufpreis_waehrung)}<span class="fin-je">${tRaw('finance.nicht_umgerechnet')}</span>`;
  if (!Number.isFinite(p)) return '<span class="text-mut">—</span>';
  const n = parseInt(String(menge), 10) || 1;
  if (n <= 1) return fmtGeld(p, cur);
  return html`${fmtGeld(p * n, cur)}<span class="fin-je">${tRaw('finance.je', { preis: fmtGeld(p, cur) })}</span>`;
}

/**
 * Die Köpfe der Preisspalten. Sie brechen nicht um: „Gewinn/Verlust“ steht gekürzt da, der volle Name im
 * title und für Vorleser.
 */
function preisKoepfe(sortierbar = false) {
  const kurz = (/** @type {string} */ lang, /** @type {string} */ kurzTxt) =>
    html`<th class="zahl" title="${tRaw(lang)}"${sortStand('guv', sortierbar)}>${sortKnopf('guv', sortierbar, html`<span aria-hidden="true">${ungeprueft(kurzTxt)}</span><span class="vh">${tRaw(lang)}</span>`)}</th>`;
  return html`${html`<th class="zahl"${sortStand('kauf', sortierbar)}>${sortKnopf('kauf', sortierbar, tRaw('finance.col.purchase'))}</th>`}${html`<th class="zahl"${sortStand('wert', sortierbar)}>${sortKnopf('wert', sortierbar, tRaw('finance.grand.value'))}</th>`}${kurz('finance.total_pnl', tRaw('finance.pnl_kurz'))}`;
}

// ── Viele Positionen: Suche, Sortierung, blockweise ──────────────────────────
// 1.500 Sets ergaben 1.578 Zeilen auf einmal (101.738 px, 51.000 Knoten). Gezeigt wird blockweise; Suche und
// Sortierung wirken auf alle Positionen, die Summen beschreiben weiter den ganzen Bestand.
const FIN_BLOCK = 100;
let _finSuche = '',
  _finGrenze = FIN_BLOCK;
/** @type {{ feld: string, ab: boolean }} */
let _finSort = { feld: '', ab: false };
/** @type {null | { sets: BewertetesSet[], parts: import('../../frontend-typen/vertrag').PartsValuationResponse['parts'], figs: import('../../frontend-typen/vertrag').FigsValuationResponse['figs'], einstand: { sets: number, parts: number, figs: number, alle: number }, wert: { sets: number, parts: number, figs: number, alle: number }, setsQtyAvg: number, cur: string, basis: Basis, lage: Zeilenlage }} */
let _finStand = null;

/** @param {string} feld @param {boolean} an */
function sortStand(feld, an) {
  if (!an) return '';
  return html` aria-sort="${_finSort.feld === feld ? (_finSort.ab ? 'descending' : 'ascending') : 'none'}"`;
}
/** @param {string} feld @param {boolean} an @param {import('./escapen.js').Markup | string} inhalt */
function sortKnopf(feld, an, inhalt) {
  return an
    ? html`<button type="button" class="sort-knopf" data-click="finSortiere" data-arg="${feld}">${inhalt}</button>`
    : inhalt;
}

/** @param {BewertetesSet} s @returns {number | string} */
function sortWert(s) {
  const f = _finSort.feld;
  if (f === 'name') return String(s.name || s.set_number).toLocaleLowerCase();
  if (f === 'kauf') return (Number(s.purchase_price) || 0) * (s.quantity || 1);
  if (f === 'wert') return Number(s.wert_gesamt) || 0;
  return Number(s.pnl_prozent ?? -Infinity);
}

/** Tabellen aus dem Stand: Suche, Sortierung und Blockgrenze. */
function zeichneFinanzTabellen() {
  const st = _finStand;
  if (!st) return;
  const q = _finSuche.toLocaleLowerCase();
  const passt = (/** @type {unknown[]} */ ...felder) =>
    !q ||
    felder.some(f =>
      String(f ?? '')
        .toLocaleLowerCase()
        .includes(q),
    );
  const sets = st.sets.filter(s => passt(s.name, s.set_number));
  if (_finSort.feld)
    sets.sort((a, b) => {
      const x = sortWert(a),
        y = sortWert(b);
      const r = x < y ? -1 : x > y ? 1 : 0;
      return _finSort.ab ? -r : r;
    });
  const parts = st.parts.filter(p => passt(p.part_name, p.part_number, p.color_name));
  const figs = st.figs.filter(f => passt(f.fig_name, f.fig_number));
  const setZeilen = sets.flatMap(s => {
    const acqs = s.acquisitions || [];
    return acqs.length <= 1 ? [setRow(s, acqs[0] || null, st.lage)] : acqs.map(a => setRow(s, a, st.lage));
  });
  const grenzeMan = Math.round(_finGrenze / 2);
  const partsRows = parts
    .slice(0, grenzeMan)
    .map(p =>
      pmRows(
        p,
        `${esc(p.part_name || p.part_number)}${p.color_name ? html` <span class="text-mut schrift-1">(${colorName(p.color_name)})</span>` : ''}`,
        st.lage,
      ),
    )
    .join('');
  const figsRows = figs
    .slice(0, grenzeMan)
    .map(f => pmRows(f, esc(f.fig_name || f.fig_number), st.lage))
    .join('');
  const rest =
    Math.max(0, setZeilen.length - _finGrenze) +
    Math.max(0, parts.length - grenzeMan) +
    Math.max(0, figs.length - grenzeMan);
  const mehr = rest ? html`<div class="ladepunkt" id="fin-sentinel" aria-hidden="true"></div>` : '';
  const leer =
    q && !setZeilen.length && !parts.length && !figs.length
      ? html`<p class="text-mut">${tRaw('common.no_hits', { query: _finSuche })}</p>`
      : '';
  setzeHtml(
    G('fin-tbl'),
    html`${leer}${setsTabelle(setZeilen.slice(0, _finGrenze).join(''), st.einstand, st.setsQtyAvg, st.cur)}${manuellerAbschnitt(
      {
        art: 'parts',
        titel: tRaw('parts.manual_section'),
        symbol: 'teil',
        zeilen: partsRows,
        anzahl: parts.length,
        kauf: st.einstand.parts,
        wert: st.wert.parts,
        cur: st.cur,
      },
    )}${manuellerAbschnitt({
      art: 'figs',
      titel: tRaw('finance.figs_section'),
      symbol: 'figur',
      zeilen: figsRows,
      anzahl: figs.length,
      kauf: st.einstand.figs,
      wert: st.wert.figs,
      cur: st.cur,
    })}${mehr}${summenTabelle(st.einstand, st.wert, st.cur, st.basis)}`,
  );
  if (q) meldeTreffer(tRaw('treffer.eintraege', { n: sets.length + parts.length + figs.length }));
  // Der Filter überlebt das Neuzeichnen; sonst zeigten die Chips eine Auswahl, die die Tabelle nicht mehr hat.
  finFilterAnwenden();
  finSentinelBinden();
}

/** @type {IntersectionObserver | null} */
let _finIO = null;
/** Wie im Katalog: Kommt das Ende der Tabelle in Sicht, folgt der nächste Block. Die Markierung entsteht mit
 * jedem Neuzeichnen neu; ein neuer Beobachter meldet sofort, ob sie schon sichtbar ist (hohe Fenster). */
function finSentinelBinden() {
  _finIO?.disconnect();
  const s = G('fin-sentinel');
  if (!s) return;
  if (typeof IntersectionObserver === 'function') {
    _finIO = new IntersectionObserver(
      es => {
        if (es.some(e => e.isIntersecting)) finMehr();
      },
      { rootMargin: '600px' },
    );
    _finIO.observe(s);
  } else {
    // Ohne Beobachter gibt es kein Scrollen zu verfolgen: lieber alles zeigen als Zeilen unerreichbar lassen.
    _finGrenze = Infinity;
    zeichneFinanzTabellen();
  }
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let _finSucheUhr;
/** @this {HTMLInputElement} */
function finSuchen() {
  const wert = this.value.trim();
  clearTimeout(_finSucheUhr);
  _finSucheUhr = setTimeout(() => {
    _finSuche = wert;
    _finGrenze = FIN_BLOCK;
    zeichneFinanzTabellen();
  }, 200);
}
/** @param {string} feld */
function finSortiere(feld) {
  _finSort = { feld, ab: _finSort.feld === feld ? !_finSort.ab : feld !== 'name' };
  zeichneFinanzTabellen();
  /** @type {HTMLElement | null} */ (
    document.querySelector(`#fin-tbl [data-click="finSortiere"][data-arg="${feld}"]`)
  )?.focus();
}
function finMehr() {
  _finGrenze += FIN_BLOCK;
  zeichneFinanzTabellen();
}
/** Was die Zeichen der Spalte „Status“ heissen; je Eintrag ohne Umbruch, sonst stand „⚠“ allein am Zeilenende. */
function legende() {
  const eintrag = (
    /** @type {string} */ klasse,
    /** @type {import('./escapen.js').Markup | string} */ zeichen,
    /** @type {string} */ text,
  ) =>
    html`<span class="legende-eintrag"><span class="legende-zeichen pst ${klasse}" aria-hidden="true">${zeichen}</span> ${text}</span>`;
  return html`<p class="fin-legende"><span>${tRaw('finance.legende.titel')}</span>${eintrag('pst-ok', ico('ok'), tRaw('finance.legende.ok'))}<span aria-hidden="true">·</span>${eintrag('pst-leer', '–', tRaw('finance.legende.fehlt'))}<span aria-hidden="true">·</span>${eintrag('pst-err', ico('warnung'), tRaw('finance.legende.fehler'))}<span>${tRaw('finance.legende.text')}</span></p>`;
}

/**
 * Zahl aus der Serverantwort, sonst der Ersatzwert.
 * @param {unknown} v
 * @param {number} ersatz
 */
function zahlOder(v, ersatz) {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : ersatz;
}

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
      if (Number.isFinite(p)) s += p * (parseInt(String(a.quantity), 10) || 1);
    }
  }
  return s;
}

/**
 * Die Zellen einer Summenzeile: Einstand und Marktwert, unter den gleichnamigen Spalten. Am Telefon tragen
 * beide ihre Beschriftung selbst (data-kurz).
 * @param {number} kauf
 * @param {number} wert
 * @param {string} cur
 */
function summenZellen(kauf, wert, cur, zusatz = '') {
  const k = html`<td class="price-total fin-fuss-wert" data-kurz="${t('finance.col.purchase')}">${kauf > 0 ? fmtN(kauf, cur) : html`<span class="text-mut">—</span>`}</td>`;
  const w = html`<td class="price-total fin-fuss-wert" data-kurz="${t('finance.grand.value')}">${wert > 0 ? html`${fmtN(wert, cur)}${zusatz ? html`<span class="fin-je">${zusatz}</span>` : ''}` : ohneWert()}</td>`;
  return html`${k}${w}`;
}
// Kategoriefilter wie in der Android-App; leere Auswahl heisst alle. Gefiltert wird durch Ausblenden, nicht
// Neuzeichnen: Die Summen beschreiben den Bestand, nicht die Auswahl, und sollen stehen bleiben.
const finKategorien = new Set();

/**
 * Zeigt der Reiter diese Zeilenart? Leere Auswahl heisst: alle.
 * @param {string} art
 */
function finZeigt(art) {
  return finKategorien.size === 0 || finKategorien.has(art);
}

/** Abschnitte ein-/ausblenden und die Chips nachziehen. */
function finFilterAnwenden() {
  // style.display statt des hidden-Attributs: `.tw` setzt in styles.css eine eigene Darstellung, und eine
  // Autoren-Regel schlaegt das `[hidden]` des Browsers. Der Abschnitt bliebe sichtbar, ohne dass etwas
  // scheitert.
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
 * „alle" raeumt die Auswahl weg; die drei uebrigen schalten ihre Zeilenart einzeln zu und wieder ab. Die
 * letzte Art abzuwaehlen fuehrt auf die leere Menge — und die heisst wieder ALLE. Eine Ansicht, die nach dem
 * Abwaehlen leer bliebe, waere kein Filter, sondern eine leere Seite.
 * @param {string} art
 */
function finFilter(art) {
  if (art === 'alle') finKategorien.clear();
  else if (finKategorien.has(art)) finKategorien.delete(art);
  else finKategorien.add(art);
  finFilterAnwenden();
}

// ── Handler beim Dispatcher anmelden (siehe js/registry.js) ──────────────
registerActions({
  loadFinance,
  finSuchen,
  finSortiere,
  finFilter,
});
