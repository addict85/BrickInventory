// Die Kennzahlen über der Sammlung (Sets, Teile, Minifiguren, Anleitungen).
import { tRaw } from '../i18n.js';
import { api } from './api.js';
import { teileAufschluesselung } from './bausteine.js';
import { G } from './dom.js';
import { fmtBig } from './format.js';
import { scopeQuery } from './scope.js';

/**
 * Zahl und Etikett einer Kennzahl in Ein- oder Mehrzahl („1 Set“). Schlüssel und Zahl stehen am Etikett,
 * damit ein Sprachwechsel dieselbe Form wieder schreibt.
 * @param {string} id
 * @param {string} schluessel
 * @param {number} n
 */
function kennzahl(id, schluessel, n) {
  G(id).textContent = fmtBig(n);
  const etikett = G(id).parentElement?.querySelector('.bstat-l');
  if (!(etikett instanceof HTMLElement)) return;
  etikett.dataset.i18n = schluessel;
  etikett.dataset.i18nVars = JSON.stringify({ n });
  etikett.textContent = tRaw(schluessel, { n });
}

export async function loadStats() {
  // Kennzahlen mit demselben Kontofilter wie die Liste: Sonst stand über „nur meine“ weiter die Summe des
  // ganzen Haushalts.
  const d = await api('GET', `/v1/stats${scopeQuery('gallery')}`);
  if (d.success && d.stats) {
    // Die Kennzahlen stehen in jedem Design als Kacheln über der Sammlung. Stück wie Teile und Figuren
    // daneben; die Zahl der verschiedenen Sets steht darunter.
    const stueck = d.stats.total_quantity || d.stats.total_sets;
    kennzahl('bstat-sets', 'gallery.stat.sets', stueck);
    const verschieden = G('bstat-sets').parentElement?.querySelector('.bstat-s');
    if (verschieden)
      verschieden.textContent =
        stueck !== d.stats.total_sets ? tRaw('gallery.stat.verschieden', { n: fmtBig(d.stats.total_sets) }) : '';
    kennzahl('bstat-parts', 'gallery.stat.teile', d.stats.total_parts || 0);
    // 0 Teile trotz Sets heisst: Die Teilelisten fehlen noch. Ohne den Satz sähe es nach einem Fehler aus.
    // Am Telefon steht er in #bstat-hinweis unter der ganzen Zeile, nicht in ihr.
    const ohneListen = !d.stats.total_parts && d.stats.total_sets > 0;
    const erklaerung = ohneListen ? tRaw('parts.stat.ohne_listen', { n: d.stats.total_sets }) : '';
    G('bstat-parts-sub').textContent =
      erklaerung || teileAufschluesselung(d.stats.set_parts ?? 0, d.stats.manual_parts ?? 0);
    G('bstat-hinweis').textContent = erklaerung;
    kennzahl('bstat-minifigs', 'gallery.stat.figuren', d.stats.total_minifigs || 0);
    kennzahl('bstat-instr', 'gallery.stat.anleitungen', d.stats.total_instructions || 0);
  }
}
