// The metrics above the collection (sets, parts, minifigs, instructions).
import { tRaw } from '../i18n.js';
import { api } from './api.js';
import { partsBreakdown } from './components.js';
import { G } from './dom.js';
import { fmtBig } from './format.js';
import { scopeQuery } from './account-filter.js';

/**
 * A metric's number and label, singular or plural ("1 set"). The key and the number sit on the label, so
 * a language switch writes the same shape again.
 * @param {string} id
 * @param {string} key
 * @param {number} n
 */
function metric(id, key, n) {
  G(id).textContent = fmtBig(n);
  const label = G(id).parentElement?.querySelector('.bstat-l');
  if (!(label instanceof HTMLElement)) return;
  label.dataset.i18n = key;
  label.dataset.i18nVars = JSON.stringify({ n });
  label.textContent = tRaw(key, { n });
}

export async function loadStats() {
  // Metrics with the same account filter as the list: otherwise the whole household's total kept
  // showing under "mine only".
  const d = await api('GET', `/v1/stats${scopeQuery('gallery')}`);
  if (d.success && d.stats) {
    // The metrics show as tiles above the collection in every theme. Pieces, like parts and minifigs,
    // sit beside them; the number of distinct sets sits below.
    const qty = d.stats.total_quantity || d.stats.total_sets;
    metric('bstat-sets', 'gallery.stat.sets', qty);
    const distinct = G('bstat-sets').parentElement?.querySelector('.bstat-s');
    if (distinct)
      distinct.textContent =
        qty !== d.stats.total_sets ? tRaw('gallery.stat.verschieden', { n: fmtBig(d.stats.total_sets) }) : '';
    metric('bstat-parts', 'gallery.stat.teile', d.stats.total_parts || 0);
    // 0 parts despite having sets means: the part lists are still missing. Without this sentence it
    // would look like a bug. On a phone it sits in #bstat-hinweis below the whole row, not inside it.
    const noLists = !d.stats.total_parts && d.stats.total_sets > 0;
    const explanation = noLists ? tRaw('parts.stat.ohne_listen', { n: d.stats.total_sets }) : '';
    G('bstat-parts-sub').textContent = explanation || partsBreakdown(d.stats.set_parts ?? 0, d.stats.manual_parts ?? 0);
    G('bstat-hinweis').textContent = explanation;
    metric('bstat-minifigs', 'gallery.stat.figuren', d.stats.total_minifigs || 0);
    metric('bstat-instr', 'gallery.stat.anleitungen', d.stats.total_instructions || 0);
  }
}
