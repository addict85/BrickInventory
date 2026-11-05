import { vergissManItem } from './13-acquisition-modals.js';
import { detailZeile, ladeAnzeige, zeilenKnopf } from './01-bausteine.js';
import { colorName, locale, t, tRaw } from '../i18n.js';
import { escHex, escJs, esc, html, ungeprueft } from './00-escapen.js';
import { api } from './01-api.js';
import { bildTag, platzhalterInhalt, fullUrl, imgUrl, thumbUrl, setzeDialogbild } from './01-bilder.js';
import { ico, G, setzeHtml } from './01-dom.js';
import { toast } from './01-meldungen.js';
import { scopeQuery } from './14-scope.js';
import { ladeLagerorte, lagerortBlock, ladeOrtAuswahl } from './02-detailfelder.js';
import { springe } from './00-ziele.js';
import { registerActions } from './00-registry.js';
// Detail-Dialog für Teile und Figuren aus Sets: mit Zoom und der Liste der Sets, in denen sie stecken, ohne
// Marktpreis und ohne änderbare Anzahl — die Menge entsteht aus den Inventaren. Derselbe Rahmen wie
// openManDetail.
// Ausführlich: docs/begruendungen/public/js/13-set-teile.js.md#opensetitemdetail
/** Die Sets, in denen ein Teil oder eine Figur steckt, als klickbare Liste. @param {{ set_number: string, name?: string | null, set_name?: string | null, image_local?: string | null, image_url?: string | null, quantity?: number | null }[]} sets */
function verwendetInListe(sets) {
  // Die Sets als Tabelle (Bild, Nummer, Name) wie im Reiter Finanzen: Als Fliesstext stand jeder Name
  // woanders. Jede Zeile öffnet das Set-Detail und schliesst diesen Dialog, zwei offene Fenster wären nicht
  // zu schliessen.
  // Ausführlich: docs/begruendungen/public/js/13-set-teile.js.md#setbild
  const setBild = (/** @type {{ image_local?: string | null, image_url?: string | null }} */ s) => {
    const klein = thumbUrl(s.image_local || s.image_url) || s.image_local || s.image_url || '';
    return klein
      ? bildTag({ src: imgUrl(klein, true), orig: imgUrl(s.image_url || ''), alt: '', klasse: 'bild-34', ph: 'set' })
      : html`<span class="bild-ph bild-34" aria-hidden="true">${platzhalterInhalt('set')}</span>`;
  };
  return sets.length
    ? html`<table aria-label="${tRaw('setitem.used_in')}" data-stil="width:100%;border-collapse:collapse"><tbody>${sets.map(s => html`
        <tr data-click="openSetAusItem" data-arg="${s.set_number}"
            title="${t('setitem.open_set')}" data-stil="cursor:pointer">
          <td data-stil="width:34px;padding:4px 8px 4px 0">${setBild(s)}</td>
          <td data-stil="width:1%;white-space:nowrap;padding:4px 10px 4px 0;font-family:var(--mono);font-size:var(--fs-1);color:var(--b600)">${zeilenKnopf({ click: 'openSetAusItem', arg: s.set_number }, s.set_number, tRaw('zeile.oeffnen', { name: s.set_name || s.set_number, nr: s.set_number }))}</td>
          <td data-stil="padding:4px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:0">${s.set_name || ''}</td>
          <td data-stil="width:1%;white-space:nowrap;padding:4px 0 4px 10px;text-align:right;color:var(--mut);font-size:var(--fs-1)">×${ungeprueft((s.quantity || 0).toLocaleString(locale()))}</td>
        </tr>`)}</tbody></table>`
    : html`<span data-stil="color:var(--mut);font-size:var(--fs-2)">${t('setitem.used_in_none')}</span>`;
}

/**
 * @param {string} type
 * @param {string} id
 * @param {string | number} colorId
 */
export async function openSetItemDetail(type, id, colorId) {
  const farbe = parseInt(String(colorId)) || 0;
  vergissManItem();
  const modal  = G('setitem-modal');
  const bodyEl = G('setitem-body');
  const imgEl  = G('setitem-img');

  G('setitem-tit').textContent = id;
  G('setitem-sub').textContent = '';
  imgEl.style.display = 'none';
  setzeHtml(bodyEl, ladeAnzeige('', { stil: 'padding:1rem' }));
  modal.classList.add('open');

  // Blickfeld mitgeben wie überall: Im Haushalt gehört das Set des Geschwisterkontos dazu. scopeQuery()
  // angehängt, nicht im Pfad, damit test/frontend-api-paths.test.js die Adresse lesen kann.
  // Ausführlich: docs/begruendungen/public/js/13-set-teile.js.md#url
  const url = (type === 'fig'
    ? `/v1/minifigs/${encodeURIComponent(id)}/sets`
    : `/v1/parts/${encodeURIComponent(id)}/${farbe}/sets`)
    + scopeQuery(type === 'fig' ? 'minifigs' : 'parts');
  const d = await api('GET', url).catch(() => null);
  // Zwischenzeitlich geschlossen? Dann nichts mehr hineinschreiben.
  if (!modal.classList.contains('open')) return;

  const item = d?.item || null;
  const sets = d?.sets || [];

  G('setitem-tit').textContent = item?.name || id;
  G('setitem-sub').textContent = id + (item?.color_name ? ' · ' + colorName(item.color_name) : '');

  // Bild wie im manuellen Dialog: über den Server-Proxy in voller Auflösung. data-orig speist den Zoom
  // (openImageLightboxFromEl in 11-actions.js) — ohne dieses Attribut gäbe es kein Vergrössern, und genau das
  // war Teil des Wunsches.
  const roh = item?.image_local || item?.image_url || '';
  const voll = roh ? imgUrl(fullUrl(roh), false) : '';
  if (voll) {
    setzeDialogbild(imgEl, voll, voll);
    imgEl.style.display = '';
  } else {
    imgEl.style.display = 'none';
  }

  const zeilen = [];
  // Anzahl nur zur Anzeige: Sie entsteht aus den Inventaren der Sets. Mit toLocaleString wie auf der
  // Teilekachel — fmtN() ist der Geldformatierer und machte aus 6 „EUR 6.00×“.
  // Ausführlich: docs/begruendungen/public/js/13-set-teile.js.md#anzahl-nur-anzeige-marcos-vorgabe-eine-m
  zeilen.push(detailZeile(t('setitem.total_qty'),
    html`<span data-stil="font-family:var(--mono);font-weight:600">×${String((item?.total_quantity || 0).toLocaleString(locale()) ?? '')}</span>`));

  if (type === 'part' && item?.color_name) {
    const punkt = item.color_hex
      ? html`<span data-stil="display:inline-block;width:12px;height:12px;border-radius:50%;border:1px solid rgba(0,0,0,.15);margin-right:4px;vertical-align:middle" data-farbe="${escHex(item.color_hex, 'var(--s300)')}"></span>`
      : '';
    zeilen.push(detailZeile(t('parts.color_label'), `${punkt}${esc(colorName(item.color_name))}`));
  }
  if (item?.category_name) zeilen.push(detailZeile(t('setitem.category'), esc(item.category_name)));
  if (item?.is_spare) zeilen.push(detailZeile(t('parts.spare_tag'), ico('ok')));

  // Lagerort nur für Teile: Eine Figur steckt in ihrem Set, dessen Ort im Set-Detail steht. Das Feld schreibt
  // auf alle Zeilen des Teil-Farb-Paares, weil man das Teil meint, nicht eine seiner Zeilen.
  // Ausführlich: docs/begruendungen/public/js/13-set-teile.js.md#if
  if (type === 'part') {
    // Die Ortsliste gehört dem Besitzer, wie beim Set. owner_ids statt owners, weil gruppierte Teilezeilen
    // keine Besitzerplakette tragen.
    // Ausführlich: docs/begruendungen/public/js/13-set-teile.js.md#ladeortauswahl
    ladeOrtAuswahl(item?.owner_ids).catch(() => {});
    zeilen.push(detailZeile(t('detail.storage'),
      lagerortBlock('setitem-storage', item?.storage,
        `data-change="speichereTeilLagerort" data-typ="part" data-part="${escJs(id)}" data-color="${farbe}" ` +
        `data-owners="${esc((item?.owner_ids || []).join(','))}"`),
      { wertStil: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end' }));
  }

  const liste = verwendetInListe(sets);
  // Die Tabelle steht unter der Beschriftung (flex-direction:column): In der .dr-Zeile rutschte sie bei einem
  // einzigen Set neben „Verwendet in“, und das Bild berührte den Text.
  // Ausführlich: docs/begruendungen/public/js/13-set-teile.js.md#marcos-befund-am-bild-der-text-verwendet
  zeilen.push(detailZeile(t('setitem.used_in'), liste,
    { zeilenStil: 'flex-direction:column;align-items:stretch;gap:4px',
      wertStil: 'flex-direction:column;align-items:stretch;gap:0;min-width:0' }));

  setzeHtml(bodyEl, ungeprueft(zeilen.join('')));
}

/**
 * Lagerort eines Teils oder einer Figur speichern, beim Verlassen des Feldes (sonst ein Zwischenstand je
 * Zeichen). `this` statt fester Kennung, weil zwei Dialoge denselben Handler nutzen.
 * Ausführlich: docs/begruendungen/public/js/13-set-teile.js.md#speichereteillagerort
 * @this {unknown}
 */
async function speichereTeilLagerort() {
  const el = this instanceof HTMLInputElement ? this : G('setitem-storage');
  if (!el) return;
  const nummer = el.dataset.part ?? '';
  const farbe  = parseInt(el.dataset.color ?? '') || 0;
  const adresse = el.dataset.typ === 'fig'
    ? `/v1/minifigs/${encodeURIComponent(nummer)}/storage`
    : `/v1/parts/${encodeURIComponent(nummer)}/${farbe}/storage`;
  const d = await api('PUT', adresse, { storage: el.value });
  if (!d?.success) { toast(d?.error || tRaw('settings.error'), 'error'); return; }
  await ladeLagerorte();
  // Ein frisch getippter Ort ist jetzt im Vorrat — ohne das stünde er am Teil, fehlte aber in der Liste, aus
  // der er beim nächsten Mal gewählt wird.
  await ladeOrtAuswahl(el.dataset.owners ? el.dataset.owners.split(',').map(Number) : []);
}

function closeSetItemDetail() {
  G('setitem-modal').classList.remove('open');
}
G('setitem-modal').addEventListener('click',
  e => e.target === e.currentTarget && closeSetItemDetail());

/**
 * Aus dem Teil-Dialog ins Set-Detail — der eine schliesst, der andere öffnet.
 * @param {string} setNumber
 */
function openSetAusItem(setNumber) {
  closeSetItemDetail();
  springe('setDetail', setNumber);
}

registerActions({
  openSetAusItem,
  openSetItemDetail,
  closeSetItemDetail,
  speichereTeilLagerort,
});
