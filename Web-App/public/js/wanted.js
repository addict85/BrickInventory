import { emit } from './events.js';
import { echt, registerActions } from './registry.js';
import { locale, t, tRaw } from '../i18n.js';
import { esc, html, rawHtml, joinHtml } from './escaping.js';
import { api } from './api.js';
import { bildTag, platzhalterInhalt, fullUrl, imgUrl, thumbUrl, setzeDialogbild } from './bilder.js';
import {
  leerZustand,
  meldeTreffer,
  ico,
  G,
  TRASH_ICON_SVG,
  knopfBesetzt,
  zuruecksetzenKnopf,
  setzeHtml,
} from './dom.js';
import { fmtDatum, fmtN, leseBetrag } from './format.js';
import { setnummerFeldGueltig, betragAusFeld, mengeAusFeld } from './formular.js';
import { toast } from './meldungen.js';
import { detailZeile, kachelName, listeLadefehler, skelettZeilen, csvHochladen } from './bausteine.js';
import { addScopeParam } from './kontofilter.js';
import { accountCurrency } from './state.js';
import { alarmBlock, ladeAlarm, setzeAlarmFeld } from './detailfelder.js';
import { diagrammBreite, priceChartSVG, renderMarketRows } from './diagramme.js';
import { leereLagerortFeld, selectedOwner, selectedStorage, haushaltsKonten } from './konten-orte.js';

// What you want, kept apart from what you own — hence its own table: in `sets` a wanted item
// would count in the gallery, parts, portfolio and finances, and every view would need a filter.

/** The most recently loaded list — for the buttons that point to a row. */
/** @typedef {import('../../frontend-typen/vertrag').Merkposten} Merkposten */
/** @type {Merkposten[]} */
let _wantedItems = [];

/** The item the take-into-collection dialog currently shows. */
/** @type {string | null} */
let _takeover = null;

/**
 * The item whose detail is open.
 * @type {string | null}
 */
let _detail = null;

/**
 * @param {string} c
 */
function conditionText(c) {
  return t(c === 'U' ? 'common.condition_used' : 'common.condition_new');
}

/**
 * One row.
 *
 * Deliberately a LIST, not a wall of tiles like the gallery: a wanted list is read and worked through,
 * not admired. The note ("gift for grandson") matters here as much as the image, and a tile would have
 * no room for it.
 */
/** @param {Merkposten} w */
function row(w) {
  // Image via imgUrl(), not thumbUrl() alone: thumbUrl() passes a foreign address through unchanged, the
  // browser would call the CDN directly, and the security policy blocked that.
  const raw = w.image_local || w.image_url;
  const img = raw
    ? bildTag({ src: imgUrl(thumbUrl(raw) || raw, 'nur'), alt: '', klasse: 'bild-56', ph: 'set' })
    : html`<span class="bild-ph bild-56" aria-hidden="true">${platzhalterInhalt('set')}</span>`;

  // No name means: rb_sets doesn't know the set – the price paid for not keeping a second copy of the catalog data here.
  const title = w.name ? esc(w.name) : esc(w.set_number);
  // Without a name, the number is already the title — not again underneath.
  const sub = [
    w.name ? esc(w.set_number) : esc(tRaw('wanted.unbekannt_kurz')),
    w.year ? String(w.year) : null,
    conditionText(w.condition),
  ]
    .filter(Boolean)
    .join(' · ');

  const alarm = w.alarm
    ? html`<span class="mk-etikett">
         ${ico(w.alarm.triggered ? 'alarm' : 'uhr')}
         ${tRaw(w.alarm.direction === 'ueber' ? 'detail.alert_above' : 'detail.alert_below')}
         ${fmtN(Number(w.alarm.threshold), accountCurrency)}
       </span>`
    : '';

  // "Do I already have this?" is the question that comes up right away in the list — and it means the
  // whole HOUSEHOLD: for the grandfather, "I have it" also means "the grandson has it".
  const already = w.owned ? html`<span class="mk-etikett mk-etikett-ok">${tRaw('wanted.owned')}</span>` : '';

  // The row shows the market price, not "Add to gallery": taking it into the collection still happens in
  // the detail, where quantity, price and condition are asked for anyway.
  const price =
    w.marktpreis != null
      ? html`<span title="${tRaw('detail.market_price')}" class="preis mk-preis">${fmtN(w.marktpreis, w.waehrung || accountCurrency)}</span>`
      : html`<span class="mk-preis text-mut mk-preis-offen" title="${tRaw('wanted.preis_offen_hint')}">${tRaw('wanted.preis_offen')}</span>`;

  const arg = `${w.set_number}|${w.condition}|${w.user_id}`;
  const k = kachelName(2);
  return html`
    <div class="mk-zeile" tabindex="0" role="button"${k.attr} aria-keyshortcuts="Delete" data-click="oeffneMerkpostenDetail" data-arg="${arg}">
      <div class="ca"><span class="delbtn" data-click="merkpostenLoeschenStop"${echt()} aria-hidden="true" data-arg="${arg}"
           data-taste="${tRaw('kachel.entf')}" title="${tRaw('wanted.remove')}">${TRASH_ICON_SVG}</span></div>
      ${img}
      <div class="mk-text">
        <div class="mk-titel">${rawHtml(title)}</div>
        <div class="mk-unter"${k.teil(0)}>${rawHtml(sub)}</div>
      </div>
      <div class="mk-rechts"${k.teil(1)}>
        ${alarm}${already}${price}
      </div>
    </div>`;
}

/**
 * Search, condition, sort and owner as request parameters, in the same shape as galleryParams() — without
 * a page (the list doesn't paginate) and without a storage location (a wanted item has none). Filtering
 * happens on the server.
 */
function wantedParams() {
  const p = new URLSearchParams();
  const q = G('mks')?.value?.trim();
  if (q) p.set('search', q);
  const c = G('mkcond')?.value;
  if (c) p.set('condition', c);
  const so = G('mksort')?.value;
  if (so) p.set('sort', so);
  addScopeParam(p, 'merkliste');
  return p.toString();
}

/** Clear search and condition; the sort order is not a filter and stays. */
export function resetWantedFilter() {
  if (G('mks')) G('mks').value = '';
  if (G('mkcond')) G('mkcond').value = '';
  ladeMerkliste();
}

/** Load and draw the list. */
export async function ladeMerkliste() {
  const target = G('mk-list');
  if (!target) return;
  // The question mark lives here, not in wantedParams(): frontend-api-paths reads the path from this line.
  // An error state also carries .leer; it steps aside for the skeleton, otherwise a retry looked like the old error.
  if (!_wantedItems.length && !target.querySelector('.mk-zeile, .leer:not(.fehler-zustand)'))
    setzeHtml(target, skelettZeilen(4, tRaw('common.loading')));
  const d = await api('GET', `/v1/wanted?${wantedParams()}`);
  const box = /** @type {HTMLDetailsElement | null} */ (document.getElementById('mk-kasten'));
  if (listeLadefehler(target, d, { erneut: 'ladeMerkliste', behalten: _wantedItems.length > 0 })) {
    // The open form pushed the error message below the fold.
    if (box && !box.dataset.entschieden) box.open = false;
    return;
  }
  _wantedItems = d.merkposten || [];
  // Once per page load: collapsed on a phone with entries, so the list fits the first screen; after that
  // whatever the user chose stays.
  if (box && !box.dataset.entschieden) {
    box.dataset.entschieden = '1';
    box.open = !(_wantedItems.length && window.matchMedia?.('(max-width: 640px)').matches);
  }
  // Two empty-state messages: "No wanted items yet" says something about the list, "Nothing found" about
  // the filter — otherwise an unsuccessful search would look like a cleared list. Sorting doesn't count as a filter.
  const filter = new URLSearchParams(wantedParams());
  filter.delete('sort');
  const filtered = !!filter.toString();
  if (filtered)
    meldeTreffer(
      _wantedItems.length
        ? tRaw('treffer.merkliste', { n: _wantedItems.length })
        : G('mks')?.value.trim()
          ? tRaw('common.no_hits', { query: G('mks').value.trim() })
          : tRaw('wanted.no_results'),
    );
  setzeHtml(
    target,
    _wantedItems.length
      ? joinHtml(_wantedItems.map(row))
      : filtered
        ? leerZustand({
            ico: 'suche',
            titel: G('mks')?.value.trim()
              ? tRaw('common.no_hits', { query: G('mks').value.trim() })
              : tRaw('wanted.no_results'),
            knopf: zuruecksetzenKnopf('merkliste'),
          })
        : leerZustand({
            ico: 'merkliste',
            titel: tRaw('wanted.empty'),
            text: tRaw('wanted.empty_hint'),
            knopf: { text: tRaw('wanted.erster'), click: 'feldFokussieren', arg: 'mk-num', art: 'bs' },
          }),
  );
}

/**
 * From the tab's own form — "just like sets": the same fields in the same order as the gallery's box.
 */
export async function merkpostenHinzufuegen() {
  const num = (G('mk-num')?.value || '').trim();
  if (!setnummerFeldGueltig('mk-num', num)) return;
  const release = knopfBesetzt(G('mk-add'));
  try {
    const d = await api('POST', '/v1/wanted', {
      set_number: num,
      condition: G('mk-cond')?.value || 'N',
      owner_user_id: selectedOwner('mk-owner'),
    });
    if (!d?.success) {
      toast(d?.error || tRaw('settings.error'), 'error');
      return;
    }
    // "was already on it" is not an error message, but not a new addition either — anyone who clicks the
    // same button twice should see the difference.
    await wantedAddedToast(d.war_neu, num);
    G('mk-num').value = '';
    await ladeMerkliste();
  } finally {
    release();
  }
}

/**
 * From the catalog detail onto the wanted list, with the condition from cat-m-cond (a second selector
 * could disagree). The alert is optional; empty means no alert, not threshold 0.
 */
export async function katalogAufMerkliste() {
  const sn = G('cat-modal')?.dataset.setNumber;
  if (!sn) return;
  const condition = G('cat-m-cond')?.value === 'U' ? 'U' : 'N';
  const owner = selectedOwner('cat-m-owner');
  const release = knopfBesetzt(G('cat-m-wish'));
  try {
    const d = await api('POST', '/v1/wanted', { set_number: sn, condition, owner_user_id: owner });
    if (!d.success) {
      toast(d.error || tRaw('settings.error'), 'error');
      return;
    }

    // The alert is its own request: it lives in price_alerts, the same table as in the set detail – no second source of truth.
    const threshold = leseBetrag(G('cat-m-alert-val')?.value);
    const alarm =
      threshold != null && threshold > 0
        ? await api('PUT', `/v1/sets/${encodeURIComponent(sn)}/alert`, {
            richtung: G('cat-m-alert-dir')?.value || 'unter',
            schwelle: threshold,
            condition,
          })
        : null;
    await wantedAddedToast(d.war_neu, sn);
    // The set is remembered; if the alert failed, that should show (after the toast, which would otherwise sit above it).
    if (alarm && !alarm.success) toast(alarm.error || tRaw('settings.error'), 'error');
  } finally {
    release();
  }
}

/**
 * Feedback after adding to the wanted list. If the set is already in the collection, the toast says so:
 * the "already have it" badge was otherwise only visible in the list.
 * @param {boolean | undefined} isNew @param {string} num
 */
async function wantedAddedToast(isNew, num) {
  const nr = /-\d+$/.test(num) ? num : num + '-1';
  const own = isNew ? await api('GET', `/v1/sets/${encodeURIComponent(nr)}`) : null;
  const owned = own?.success && own.set ? own.set : null;
  toast(
    owned ? tRaw('wanted.added_schon_da', { n: owned.quantity || 1 }) : tRaw(isNew ? 'wanted.added' : 'wanted.already'),
    'success',
  );
}

/** setNumber|condition|user_id — a row's key, as built by row(). */
/** @param {string | null | undefined} arg */
function parseKey(arg) {
  const [set_number, condition, owner] = String(arg || '').split('|');
  return { set_number, condition, owner_user_id: parseInt(owner, 10) };
}

/** @param {string} arg */
export async function merkpostenLoeschen(arg) {
  const { set_number, condition, owner_user_id } = parseKey(arg);
  if (!set_number) return;
  const p = new URLSearchParams({ owner_user_id: String(owner_user_id) });
  const d = await api('DELETE', `/v1/wanted/${encodeURIComponent(set_number)}/${encodeURIComponent(condition)}?${p}`);
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  // Undo recreates the item; besides number, condition and owner it has nothing of its own.
  toast(tRaw('wanted.deleted'), 'success', {
    text: tRaw('trash.undo'),
    bleibt: true,
    fn: async () => {
      const r = await api('POST', '/v1/wanted', { set_number, condition, owner_user_id });
      if (!r?.success) {
        toast(r?.error || tRaw('settings.error'), 'error');
        return;
      }
      toast(tRaw('trash.restored'), 'success');
      await ladeMerkliste();
    },
  });
  await ladeMerkliste();
}

/**
 * Taking it into the gallery, step 1: ask. Quantity, purchase price and condition at purchase time are
 * rarely those of the wanted item; the condition is pre-filled but stays editable.
 */
/** @param {string} arg */
export function merkpostenUebernehmen(arg) {
  const { set_number, condition } = parseKey(arg);
  if (!set_number) return;
  _takeover = arg;
  const w = _wantedItems.find(x => x.set_number === set_number && x.condition === condition);
  G('mk-take-tit').textContent = w?.name || set_number;
  G('mk-take-qty').value = '1';
  G('mk-take-price').value = '';
  G('mk-take-cond').value = condition === 'U' ? 'U' : 'N';
  leereLagerortFeld('mk-take-storage');
  G('mk-take-modal').classList.add('open');
}

export function schliesseUebernahme() {
  G('mk-take-modal').classList.remove('open');
  _takeover = null;
}

/**
 * Step 2: do it. The rule lives on the server (addSet, then the wanted item and alert go away). The
 * condition is sent twice — in the path the wanted item's, in the body the recorded one — because you can
 * end up buying something other than what you wished for.
 */
export async function bestaetigeUebernahme() {
  if (!_takeover) return;
  const { set_number, condition, owner_user_id } = parseKey(_takeover);
  const price = betragAusFeld('mk-take-price');
  const qty = mengeAusFeld('mk-take-qty');
  if (!price.ok || !qty.ok) return;
  const release = knopfBesetzt(G('mk-take-ok'));
  try {
    const d = await api(
      'POST',
      `/v1/wanted/${encodeURIComponent(set_number)}/${encodeURIComponent(condition)}/uebernehmen`,
      {
        owner_user_id,
        quantity: qty.wert,
        // Empty means "no purchase price" — the server then inserts the market price, exactly as on the
        // normal recording path.
        purchase_price: price.wert ?? undefined,
        condition: G('mk-take-cond').value,
        storage: selectedStorage('mk-take-storage'),
      },
    );
    if (!d?.success) return;
    schliesseUebernahme();
    // 'exists' means: the set was already in view. The wanted item is still fulfilled and disappears —
    // otherwise it would stand for something you already have.
    toast(tRaw(d.action === 'exists' ? 'wanted.taken_existing' : 'wanted.taken'), 'success');
    await ladeMerkliste();
    emit('sammlungLaden');
  } finally {
    release();
  }
}

/**
 * The detail of a wanted item from three existing sources: the loaded row, the catalog detail and the
 * price history. No new endpoint, so the figures match the ones shown elsewhere.
 * @param {string} arg
 */
export async function oeffneMerkpostenDetail(arg) {
  const { set_number, condition } = parseKey(arg);
  const w = _wantedItems.find(x => x.set_number === set_number && x.condition === condition);
  if (!w) return;
  _detail = arg;

  G('mk-m-tit').textContent = w.name || w.set_number;
  // Without a name, the number is already in the title.
  G('mk-m-sub').textContent = [w.name ? w.set_number : '', conditionText(w.condition)].filter(Boolean).join(' · ');
  // Full resolution, but also through our own server: fullUrl() sends an absolute CDN address through the
  // image proxy (bilder.js). The local image takes priority — it's already there.
  const img = w.image_local || w.image_url ? fullUrl(w.image_local || w.image_url) : '/assets/set-placeholder.svg';
  setzeDialogbild(G('mk-m-img'), img, img);
  setzeHtml(G('mk-m-sparkline-content'), html`<span class="text-mut schrift-1">${tRaw('common.loading')}</span>`);
  G('mk-m-market-rows').replaceChildren();
  setzeHtml(G('mk-m-det'), rawHtml(detailRows(w)));
  G('mk-m-bricklink').style.display = 'none';
  // The price comparison link hangs off the wanted item, not the catalog: a set unknown there still has its own address.
  showLink('mk-m-vergleich', w.preisvergleich_url);
  document.querySelector('#mk-detail-modal .mehr-menue')?.removeAttribute('open');
  G('mk-detail-modal').classList.add('open');
  // From here on, the alert handlers mean THIS dialog.
  setzeAlarmFeld('mk-m');
  ladeAlarm(set_number).catch(() => {});

  // ── The price, RIGHT AWAY ─────────────────────────────────────────────────
  //
  // Marco's question: "Why aren't the prices shown right away?" Because /price-history only READS the
  // cache, and until this change nothing wrote one for wanted items. This route fetches it (with a TTL, so
  // not freshly on every open) and fills the cache at the same time.
  api('GET', `/v1/wanted/${encodeURIComponent(set_number)}/preise`)
    .then(pr => {
      if (_detail !== arg || !pr?.success) return;
      // Same shape as `current` in /price-history — so the same render function works here too.
      renderMarketRows({ by_condition: toDisplayFormat(pr.current) }, 'mk-m-market-rows');
    })
    .catch(() => {});

  // Catalog: theme, parts, minifigs, BrickLink. If it fails (a set rb_sets doesn't know), the block stays
  // as is — the row's own figures are then all there is.
  // Without a name the catalog doesn't know the set (see row()); the request would only end in a 404 in
  // the console.
  if (w.name)
    api('GET', `/v1/catalog/sets/${encodeURIComponent(set_number)}`)
      .then(d => {
        if (_detail !== arg || !d?.success) return;
        fillCatalogInfo(d.set, w);
        showLink('mk-m-bricklink', d.set?.bricklink?.url);
        // With the catalog name the search gets better ("LEGO 75192 Millennium Falcon" instead of just the
        // number) — but only when one really came back.
        showLink('mk-m-vergleich', d.set?.preisvergleich_url || w.preisvergleich_url);
      })
      .catch(() => {});

  // The HISTORY — the rows above it are already there. It comes from price_history, which the hourly
  // price job fills; since this change, for a wanted item too (src/finanzen/preisLauf.ts). A fresh wanted
  // item therefore starts with only one point, and a line needs two — that's not a bug, it's the start.
  api('GET', `/v1/sets/${encodeURIComponent(set_number)}/price-history`)
    .then(ph => {
      if (_detail !== arg) return;
      setzeHtml(
        G('mk-m-sparkline-content'),
        ph?.success
          ? priceChartSVG(
              ph,
              'wl' + set_number.replace(/[^a-zA-Z0-9]/g, ''),
              diagrammBreite(G('mk-m-sparkline-content')),
            )
          : html`<span class="text-mut schrift-1">${tRaw(ph?.networkError ? 'chart.offline' : 'detail.no_history')}</span>`,
      );
    })
    .catch(() => {});
}

/**
 * A link that leads nowhere is worse than none.
 * @param {string} id
 * @param {string | null | undefined} url
 */
function showLink(id, url) {
  const el = G(id);
  if (!el) return;
  if (url) {
    el.href = url;
    el.style.display = '';
  } else {
    el.removeAttribute('href');
    el.style.display = 'none';
  }
}

const DASH = '—';
const formatNumber = (/** @type {unknown} */ n) => (n == null ? DASH : Number(n).toLocaleString(locale()));

/**
 * The rows as in the set dialog, without anything that assumes ownership. Built exactly once per open,
 * catalog data is filled in afterwards in place: redrawing would lose an alert's in-progress input.
 */
/** @param {Merkposten} w */
function detailRows(w) {
  // When the catalog doesn't know the set, one row says so instead of four dashes for year, theme, parts, figs.
  /** @type {[string, string | import('./escaping.js').SafeHtml, string | null][]} */
  const catalog = w.name
    ? [
        ['detail.year', w.year != null ? String(w.year) : DASH, null],
        ['detail.theme', DASH, 'mk-m-theme'],
        ['detail.pieces', formatNumber(w.num_parts), 'mk-m-pieces'],
        ['detail.minifigs', DASH, 'mk-m-minifigs'],
      ]
    : [['nav.catalog', esc(tRaw('wanted.unbekannt')), null]];
  /** @type {[string, string | import('./escaping.js').SafeHtml, string | null][]} */
  const z = [
    ...catalog,
    ['common.condition', esc(conditionText(w.condition)), null],
    ['household.for_account', ownerSelect(w), null],
    ['wanted.since', w.created_at ? `${ico('kalender')} ${esc(fmtDatum(w.created_at))}` : DASH, null],
    // The same block as in the set dialog, not a second one: it's the same entry in price_alerts, under the
    // same key (account, set, condition). Filled in by ladeAlarm() on open.
    ['detail.alert', alarmBlock(w.set_number, 'mk-m'), null],
  ];
  return z.map(([k, v, id]) => detailZeile(t(k), v, id ? { wertId: id } : {})).join('');
}

/**
 * The owner as a select field: anyone who got it wrong when adding the item had to delete it and lost the
 * alert and the date. With a single account the row stays empty — as in the recording forms.
 */
/** @param {Merkposten} w */
function ownerSelect(w) {
  const accounts = haushaltsKonten();
  if (accounts.length < 2) return '';
  return html`${html`<select id="mk-m-owner" class="alarm-feld" aria-label="${tRaw('household.for_account')}"
                  data-change="merkpostenInhaberGewaehlt" data-arg="${`${w.set_number}|${w.condition}|${w.user_id}`}">`}${accounts.map(k => html`${html`<option value="${k.id}"${k.id === w.user_id ? ' selected' : ''}>`}${html`${k.username}${k.is_self ? html`${' '}${tRaw('household.ich')}` : ''}</option>`}`)}${html`</select>`}`;
}

/**
 * Give the wanted item to another account.
 *
 * The key in data-arg carries the OLD owner — the server needs to know WHERE it's moving from, and the
 * select only knows the target.
 */
/** @param {string} arg */
export async function merkpostenInhaberGewaehlt(arg) {
  const { set_number, condition, owner_user_id } = parseKey(arg);
  const sel = G('mk-m-owner');
  const next = parseInt(sel?.value || '', 10);
  if (!Number.isFinite(next) || next === owner_user_id) return;
  const d = await api('PUT', `/v1/wanted/${encodeURIComponent(set_number)}/${encodeURIComponent(condition)}/inhaber`, {
    owner_user_id,
    neuer_inhaber: next,
  });
  if (!d?.success) {
    toast(d?.error || tRaw('settings.error'), 'error');
    return;
  }
  // "was already there" is not an error, but not a move either — as with adding, the message tells the two
  // cases apart. settings.saved instead of a new text: "Saved" already exists in the language file, and
  // two identically-worded entries drift apart at the next polish pass.
  toast(tRaw(d.zusammengefuehrt ? 'wanted.already' : 'settings.saved'), 'success');
  await ladeMerkliste();
  // The detail is tied to the old key (it carries the owner) — reopen with the new one, otherwise it shows
  // an entry that no longer exists in that form.
  if (d.zusammengefuehrt) schliesseMerkpostenDetail();
  else await oeffneMerkpostenDetail(`${set_number}|${condition}|${next}`);
}

/**
 * Fill in theme, parts and minifigs — as TEXT, not as new markup.
 *
 * textContent, not innerHTML: the theme name comes from the catalog and is therefore foreign text. This
 * way it can never be read as markup, and no esc() is needed in yet another place.
 */
/** @param {import('../../frontend-typen/vertrag').CatalogSetDetail | null | undefined} catalog @param {Merkposten} w */
function fillCatalogInfo(catalog, w) {
  const set = (/** @type {string} */ id, /** @type {string} */ value) => {
    const el = G(id);
    if (el) el.textContent = value;
  };
  set('mk-m-theme', catalog?.theme_name || DASH);
  set('mk-m-pieces', formatNumber(catalog?.num_parts ?? w.num_parts));
  set('mk-m-minifigs', formatNumber(catalog?.minifigs));
}

export function schliesseMerkpostenDetail() {
  G('mk-detail-modal').classList.remove('open');
  _detail = null;
}

/** Deleting and taking over from the detail — the same paths as from the list. */
export async function merkpostenDetailLoeschen() {
  const arg = _detail;
  if (!arg) return;
  schliesseMerkpostenDetail();
  await merkpostenLoeschen(arg);
}

export function merkpostenDetailUebernehmen() {
  const arg = _detail;
  if (!arg) return;
  schliesseMerkpostenDetail();
  merkpostenUebernehmen(arg);
}

// Search debounced (250 ms like the gallery and parts), otherwise one request per keystroke. The `?.`
// guard because this file is also loaded in tests without a DOM.
G('mks')?.addEventListener('input', () => {
  clearTimeout(G('mks')._t);
  G('mks')._t = setTimeout(ladeMerkliste, 250);
});

/**
 * Read a wanted list in from a CSV, like importFigsCsv(): both evaluate the same server response
 * (csvImportAntwort) and use the same texts — a second version of the same message would drift apart.
 */
async function importMerklisteCsv() {
  const owner = selectedOwner('mk-owner');
  const status = G('mk-status');
  const d = await csvHochladen({
    feld: 'mk-csv-file',
    pfad: '/v1/wanted/import/csv',
    felder: owner ? { owner_user_id: String(owner) } : {},
    zeige: l => {
      if (status) status.textContent = l ? tRaw('import.running') : '';
    },
  });
  if (d) ladeMerkliste();
}

registerActions({
  ladeMerkliste,
  merkpostenHinzufuegen,
  katalogAufMerkliste,
  merkpostenLoeschen,
  merkpostenUebernehmen,
  schliesseUebernahme,
  bestaetigeUebernahme,
  oeffneMerkpostenDetail,
  schliesseMerkpostenDetail,
  merkpostenDetailLoeschen,
  merkpostenDetailUebernehmen,
  merkpostenInhaberGewaehlt,
  importMerklisteCsv,
});

/**
 * Bring the price response's `current` into the shape renderMarketRows() expects: the same number is
 * called avg_price there. pnl_pct stays empty, because a wanted item has no purchase price.
 */
/** @param {import('../../frontend-typen/vertrag').CurrentByCondition | null | undefined} current */
function toDisplayFormat(current) {
  /** @type {Record<string, { market_price: number | null | undefined, pnl_pct: null }>} */
  const out = {};
  for (const c of /** @type {const} */ (['N', 'U'])) {
    const d = current?.[c];
    if (d) out[c] = { market_price: d.avg_price, pnl_pct: null };
  }
  return out;
}
