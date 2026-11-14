// Finanzen: die Karten über der Tabelle (Kaufpreis, Marktwert, Gewinn/Verlust) und die Zeile, worüber sie rechnen.
import { pnlBadge } from './bausteine.js';
import { tRaw } from '../i18n.js';
import { html } from './escapen.js';
import { ico, G, setzeHtml } from './dom.js';
import { fmtN } from './format.js';

/**
 * Die gemeinsame Basis der Karten vom Server; ohne sie (pnl gescheitert) keine G/V.
 * @typedef {{ bewertet: number, ohneMarkt: number, ohneKauf: number, einstand: number, wert: number, betrag: number,
 *   gesamt?: number, ohneMarktEinstand?: number, ohneKaufWert?: number }} Basis
 * @param {Partial<import('../../frontend-typen/vertrag').PnlTotals>} pt @param {number} ohnePreis
 * @returns {Basis}
 */
export function basisAus(pt, ohnePreis) {
  const z = (/** @type {unknown} */ v) => parseFloat(String(v)) || 0;
  if (pt.basis_einstand == null)
    return { bewertet: 0, ohneMarkt: ohnePreis, ohneKauf: 0, einstand: 0, wert: 0, betrag: 0 };
  return {
    gesamt: pt.positionen || 0,
    bewertet: pt.positionen_bewertet || 0,
    ohneMarkt: pt.positionen_ohne_marktpreis || 0,
    ohneKauf: pt.positionen_ohne_kaufpreis || 0,
    einstand: z(pt.basis_einstand),
    wert: z(pt.basis_marktwert),
    betrag: z(pt.basis_guv_betrag),
    ohneMarktEinstand: z(pt.ohne_marktpreis_einstand),
    ohneKaufWert: z(pt.ohne_kaufpreis_marktwert),
  };
}

/** Kurzer Titel; was „bewertet“ heisst, sagt der Tooltip, ausführlich die Zeile unter den Karten.
 * @param {HTMLElement} el @param {string} titel @param {boolean} mitHilfe */
function hilfe(el, titel, mitHilfe) {
  el.textContent = titel;
  if (mitHilfe) el.title = tRaw('finance.stat.bewertet_hilfe');
  else el.removeAttribute('title');
}

/**
 * Die Kacheln über der Tabelle. Der Einstand ist immer bekannt; Gesamtwert und G&V nur, wenn es Marktpreise
 * gibt — sonst sagt die Kachel, für wie viele Positionen der Preis fehlt, statt „—“ zu zeigen.
 */
/** @param {{ basis: Basis, einstandAlle: number, wertAlle: number, guv: number | null | undefined, cur: string, fremdeWaehrung?: number, geschaetzt?: number, zeilen?: number }} p */
export function zeigeKennzahlen({
  basis,
  einstandAlle,
  wertAlle,
  guv,
  cur,
  fremdeWaehrung = 0,
  geschaetzt = 0,
  zeilen = 0,
}) {
  G('fin-sum').dataset.geladen = '1';
  G('fin-sum').removeAttribute('aria-busy');
  const mitBasis = basis.bewertet > 0;
  const einstand = mitBasis ? basis.einstand : einstandAlle;
  const wert = mitBasis ? basis.wert : wertAlle;
  const teilweise = mitBasis && Math.abs(einstandAlle - basis.einstand) >= 0.005;
  hilfe(G('fin-einstand-titel'), tRaw(teilweise ? 'finance.stat.purchase_basis' : 'finance.stat.purchase'), teilweise);
  G('fin-einstand').textContent = einstand > 0 || mitBasis ? fmtN(einstand, cur) : '—';
  // Kaufpreise in anderer Währung zählt der Server nicht mit (keine Kurse); ihre Zahl steht darunter.
  G('fin-einstand-sub').textContent =
    fremdeWaehrung > 0
      ? tRaw('finance.fremde_waehrung_n', { n: fremdeWaehrung })
      : teilweise
        ? tRaw('finance.stat.purchase_von', { betrag: fmtN(einstandAlle, cur) })
        : tRaw('finance.stat.purchase_hint');
  const fehlt = basis.ohneMarkt > 0 ? tRaw('finance.price_missing_n', { n: basis.ohneMarkt }) : '';
  // Rechnet die Kachel nur über bewertete Posten, sagt sie es; sonst stünden zwei „Marktwerte“ verschieden da.
  const wertTeilweise = mitBasis && Math.abs(wertAlle - basis.wert) >= 0.005;
  hilfe(G('fin-wert-titel'), tRaw(wertTeilweise ? 'finance.stat.value_basis' : 'finance.stat.value'), wertTeilweise);
  if (wert > 0) {
    G('fin-wert').textContent = fmtN(wert, cur);
    G('fin-wert-sub').textContent = wertTeilweise
      ? tRaw('finance.stat.value_von', { betrag: fmtN(wertAlle, cur) })
      : tRaw('finance.stat.value_hint');
  } else {
    // Ohne Positionen fehlt kein Preis — dann einfach „—“.
    if (fehlt) setzeHtml(G('fin-wert'), html`<span class="fval-hinweis">${fehlt}</span>`);
    else G('fin-wert').textContent = '—';
    G('fin-wert-sub').textContent = '';
  }
  // Die Kachel bleibt stehen, damit die Reihe nicht springt; ohne Preise mit Hinweis.
  if (mitBasis && guv != null) {
    setzeHtml(G('fin-total-pnl'), pnlBadge(guv));
    // Betrag und Prozent aus denselben Posten (mit Kauf- UND Marktpreis). „gegenüber dem Einstand“: Das
    // Prozent im Diagramm rechnet gegen den Anfang des Zeitraums.
    const b = basis.betrag;
    G('fin-pnl-sub').textContent = tRaw('finance.pnl_vs_purchase', {
      betrag: `${b >= 0 ? '+' : '−'}${fmtN(Math.abs(b), cur)}`,
    });
  } else {
    G('fin-total-pnl').textContent = '—';
    G('fin-pnl-sub').textContent = tRaw('finance.pnl_needs_prices');
  }
  const zeile = G('fin-basis');
  if (!zeile) return;
  const teile = [];
  if (basis.ohneMarkt > 0)
    teile.push(
      tRaw('finance.basis.ohne_markt', { n: basis.ohneMarkt, betrag: fmtN(basis.ohneMarktEinstand || 0, cur) }),
    );
  if (basis.ohneKauf > 0)
    teile.push(tRaw('finance.basis.ohne_kauf', { n: basis.ohneKauf, betrag: fmtN(basis.ohneKaufWert || 0, cur) }));
  // Geschätzte Kaufpreise rechnen mit, sind aber nicht bezahlt: Die Zahl gehört neben das Ergebnis.
  if (geschaetzt > 0) teile.push(tRaw('finance.basis.geschaetzt', { n: geschaetzt }));
  if (!mitBasis || !teile.length) {
    zeile.hidden = true;
    zeile.textContent = '';
    return;
  }
  zeile.hidden = false;
  setzeHtml(
    zeile,
    // Der Server zählt je Position, die Tabelle zeigt je Kauf und Konto eine Zeile; weichen die Zahlen ab,
    // sagt der Tooltip, warum.
    html`${ico('info')}<span>${basisSatz(tRaw('finance.basis.gerechnet', { n: basis.bewertet, von: basis.gesamt }), zeilen > (basis.gesamt ?? 0))} ${teile.join(' · ')}</span>`,
  );
}

/** @param {string} satz @param {boolean} zeilenHilfe */
function basisSatz(satz, zeilenHilfe) {
  if (!zeilenHilfe) return html`<strong>${satz}</strong>`;
  const h = tRaw('finance.basis.zeilen_hilfe');
  return html`<strong title="${h}">${satz}<span class="vh"> ${h}</span></strong>`;
}
