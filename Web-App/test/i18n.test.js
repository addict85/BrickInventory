/**
 * i18n consistency: German and English must have exactly the same keys
 * (otherwise missing translations only show up in the UI as a raw key),
 * and placeholders ({name}) must match in both languages.
 *
 * Runs without a browser: i18n.js is executed in a sandbox context; the
 * display of the color names on the real bundle in jsdom.
 *
 * Counter-checks (measured 08.11.2026, each alone):
 *   A  in renderColorDropdown `${c.name}` instead of colorName(c.name) → red:
 *      “color names: displayed in German, stored in English”
 *   B  the parts group heading back to `${g.color}` → red: the same check
 *   C  colorName() without `if (LANG !== 'de') return en;` → red: the same
 *      check (English UI)
 *   D  openManDetail with `imgUrl(rawImgSrc, true)` (preview) instead of
 *      imgUrl(fullUrl(…), false) → red: “the purchase price detail dialog …”.
 *      `fullUrl(rawImgSrc)` alone stays green: fullUrl() now routes a
 *      CDN address via the proxy itself (bilder-proxy-oberflaeche D).
 *   E  (16.11.2026) in en.js “email” once back to “e-mail” → red: “no text stands untranslated in both languages” (checkTerms); in de.js
 *      csv.import_title back to “CSV Import” → red: same place; settings.users_new back to “Neuen Benutzer
 *      erstellen” → red: same place
 *   F  (16.11.2026) users.role.user (de) back to “Benutzer” → red: “no text … untranslated” and “the
 *      roles are called …”; maillink.cancel.ok back to “übrigen Verwalter”, FEHLER.admins_only (de)
 *      back to “Nur für Admins”, settings.admins_only (en) back to “Admins only” → each red: “the roles are called …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openUi, switchTab, waitFor } = require('./helpers/ui');

// Since the split the dictionaries live in public/locales/{de,en}.js —
// index.html only loads the active language, loadLang() fetches the rest.
// The helper joins both so that the check here can stay unchanged.
const { loadTranslations } = require('./helpers/sources');

const PLACEHOLDER = /\{(\w+)\}/g;
const placeholders = s => [...String(s).matchAll(PLACEHOLDER)].map(m => m[1]).sort();

test('DE and EN have identical key sets', () => {
  const { de, en } = loadTranslations();
  const deKeys = Object.keys(de).sort();
  const enKeys = Object.keys(en).sort();
  const onlyDe = deKeys.filter(k => !(k in en));
  const onlyEn = enKeys.filter(k => !(k in de));
  assert.deepEqual(onlyDe, [], `Only present in DE: ${onlyDe.join(', ')}`);
  assert.deepEqual(onlyEn, [], `Only present in EN: ${onlyEn.join(', ')}`);
});

test('placeholders match between DE and EN', () => {
  const { de, en } = loadTranslations();
  for (const k of Object.keys(de)) {
    if (!(k in en)) continue; // is reported by the parity test
    assert.deepEqual(
      placeholders(de[k]),
      placeholders(en[k]),
      `Placeholders differ at "${k}": DE=${de[k]}  EN=${en[k]}`,
    );
  }
});

/**
 * The same text in both languages means: not translated.
 */
test('no text stands untranslated in both languages', () => {
  // Terms, proper names and number formats that are the same in both
  // languages. Every entry is a decision, not leniency.
  const intendedEqual = new Set([
    'catalog.sort.name',
    'col.name',
    'col.sets',
    'currency.eur',
    // “Passkey” and “Name” are called that in both languages.
    'pk.title',
    'pk.col.name',
    // “Filter” is called that in both languages.
    'common.filter',
    'finance.filter.sets',
    'finance.period.max',
    'gallery.sort.name',
    'gallery.sort.name_desc',
    'header.sets',
    'gallery.stat.sets',
    'gallery.stat.sets_one',
    'log.auto',
    'monitor.api.bricklink',
    'monitor.api.brickset',
    'monitor.api.rebrickable',
    // PIN is PIN in both languages — a term, not a sentence.
    'vouchers.pin',
    // The feedback of the balance query: “{number}: {amount}" — a pure
    // frame of two placeholders without a word of its own. Nothing in it is
    // translated; the amount comes formatted from LEGO.
    'vouchers.balance_done',
    // USA is called USA in German. The other seven issuing countries
    // (country_de_ch … country_en_gb) differ, this one does not.
    'vouchers.country_en_us',
    // The role names “Administrator” and “Standard” are the same in both languages.
    'users.role.admin',
    'users.role.user',
    'users.admin_badge',
    'users.log.admin',
    'settings.users_admin_badge',
    // The label of the button that reads in a BrickLink wanted list:
    // a proper name and a file format. “BrickLink XML" is the same in both
    // languages, and a Germanized brand would be wrong.
    'wanted.pick_short',
  ]);

  const { de, en } = loadTranslations();
  assert.ok(Object.keys(en).length > 400, `Too few texts loaded (${Object.keys(en).length}) — helper broken?`);

  const same = Object.keys(en).filter(k => k in de && de[k] === en[k]);
  const untranslated = same.filter(k => !intendedEqual.has(k)).sort();
  assert.deepEqual(
    untranslated,
    [],
    'These texts are identical in German and English — very likely ' +
      'copied on creation and not translated:\n  ' +
      untranslated.map(k => `${k} = "${en[k]}"`).join('\n  ') +
      '\nIf it really is the same in both languages, it belongs in `gewolltGleich`.',
  );

  const stale = [...intendedEqual].filter(k => !same.includes(k)).sort();
  assert.deepEqual(
    stale,
    [],
    `These entries in \`gewolltGleich\` are no longer correct: ${stale.join(', ')} — remove them.`,
  );
  checkTerms(de, en);
});

/** Terms uniform: Konto instead of Benutzer, CSV-Import, English email. @param {Record<string, string>} de @param {Record<string, string>} en */
function checkTerms(de, en) {
  const fund = (/** @type {Record<string, string>} */ w, /** @type {RegExp} */ r) =>
    Object.entries(w)
      .filter(([, v]) => r.test(v))
      .map(([k, v]) => `${k} = ${v}`);
  assert.deepEqual(fund(en, /\be-mail/i), [], 'EN writes email');
  assert.deepEqual(fund(de, /CSV Import/), [], 'DE writes CSV-Import');
  // An account is called Konto; the role is called “Standard”, no longer “Benutzer”.
  assert.deepEqual(fund(de, /\bBenutzer(?!name)/), [], '„Konto“ instead of „Benutzer“');
}

test('the roles are called Standard and Administrator, also in server error texts', () => {
  const { de, en } = loadTranslations();
  assert.equal(de['users.role.user'], 'Standard');
  assert.equal(de['users.role.admin'], 'Administrator');
  assert.equal(en['users.role.user'], 'Standard');
  assert.equal(en['users.role.admin'], 'Administrator');
  const { ERRORS } = require('./helpers/sources').buildAndRequire()('src/infra/errorTexts.js');
  assert.match(ERRORS.last_admin.de, /Administrator/, 'Server error text without role names — code renamed?');
  const serverDe = Object.fromEntries(Object.entries(ERRORS).map(([k, v]) => [`fehler.${k}`, v.de]));
  const serverEn = Object.fromEntries(Object.entries(ERRORS).map(([k, v]) => [`fehler.${k}`, v.en]));
  const alt = [
    ...Object.entries({ ...de, ...serverDe }).filter(([, v]) => /Verwalter|\bAdmins?\b|Admin-/.test(v)),
    ...Object.entries({ ...en, ...serverEn }).filter(([, v]) => /\b[Aa]dmins?\b/.test(v)),
  ].map(([k, v]) => `${k} = ${v}`);
  assert.deepEqual(alt, [], 'Alter Rollenname „Verwalter“ bzw. „Admin“');
});

test('catalog keys present', () => {
  const { de } = loadTranslations();
  for (const k of [
    'nav.catalog',
    'catalog.title',
    'catalog.filter.year_from',
    'catalog.filter.year_to',
    'catalog.buy_bricklink',
    'catalog.add_to_gallery',
  ]) {
    assert.ok(k in de, `Key is missing: ${k}`);
  }
});

test('the trash in the brick theme has a white background from the start, not only on direct hover', () => {
  // Reported via screenshot: when hovering over the tile the
  // trash appeared only faintly (rgba(255,255,255,.22)) — only when hovering
  // directly over THE BUTTON did it become fully white. Now fully
  // white from the start as soon as the tile itself is hovered (the visibility of the
  // whole .ca container is already governed by .sc:hover .ca in styles.css).
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'themes', 'brick.css'), 'utf8');
  const fn = src.slice(src.indexOf('[data-theme="brick"] .sc .delbtn{'), src.indexOf('[data-theme="brick"] .qbadge'));
  assert.doesNotMatch(fn, /rgba\(255,255,255,\.22\)/, 'The weak idle state must no longer occur');
  assert.match(
    fn,
    /\[data-theme="brick"\] \.sc \.delbtn\{\s*background:#fff;/,
    'The resting state must already have a fully white background',
  );
});

const GRAY = 'Dark Bluish Gray';
const COLORS = {
  '/v2/parts': {
    success: true,
    total: 1,
    page: 1,
    page_size: 100,
    parts: [
      {
        part_number: '3001',
        part_name: 'Brick 2 x 4',
        color_id: 72,
        color_name: GRAY,
        color_hex: '6C6E68',
        total_quantity: 2,
      },
    ],
  },
  '/v2/parts/colors': {
    success: true,
    colors: [{ color_name: GRAY, color_hex: '6C6E68', unique_parts: 1, total_quantity: 2 }],
  },
  '/v2/parts/brick-colors': { success: true, colors: [{ id: 72, name: GRAY, hex: '6C6E68' }] },
};

test('color names: displayed in German, stored and filtered in English', async () => {
  for (const [language, visible] of [
    ['de', 'Dunkelbläulichgrau'],
    ['en', GRAY],
  ]) {
    const { w, d } = await openUi(COLORS, { language });
    try {
      await switchTab(w, 'parts');
      assert.ok(
        await waitFor(
          () => d.querySelector('#ap-color-select option[data-name]') && d.querySelector('#parts-main .group-title'),
        ),
      );
      const option = d.querySelector('#ap-color-select option[data-name]');
      // data-name goes to the backend and to BrickLink on saving: English.
      assert.deepEqual([option.textContent.trim(), option.dataset.name], [visible, GRAY], language);
      assert.equal(
        d.querySelector('#parts-main .group-title').textContent.trim(),
        visible,
        `${language}: group heading`,
      );
      assert.match(d.querySelector('#parts-main .part-color').textContent, new RegExp(visible), `${language}: tile`);
      const filter = [...d.querySelectorAll('#parts-color option')].find(o => o.value === GRAY);
      assert.ok(filter, 'The filter value stays English');
      assert.match(filter.textContent, new RegExp(`^${visible} `), `${language}: Filterbeschriftung`);
    } finally {
      w.close();
    }
  }
});

test('the purchase price detail dialog loads the part image in full size via the proxy', async () => {
  const CDN = 'https://cdn.rebrickable.com/media/parts/elements/300121.jpg';
  const { w, d } = await openUi({
    ...COLORS,
    '/v2/parts/manual': {
      success: true,
      parts: [
        {
          part_number: '3002',
          part_name: 'Brick 2 x 3',
          color_id: 72,
          color_name: GRAY,
          color_hex: '6C6E68',
          quantity: 1,
          image_url: CDN,
        },
      ],
    },
  });
  try {
    await switchTab(w, 'parts');
    assert.ok(await waitFor(() => d.querySelector('#manual-parts-list [data-click="openManDetail"]')));
    d.querySelector('#manual-parts-list [data-click="openManDetail"]').click();
    assert.ok(await waitFor(() => d.getElementById('man-detail-img').getAttribute('src')));
    assert.equal(
      d.getElementById('man-detail-img').getAttribute('src'),
      `/api/v1/img-proxy?url=${encodeURIComponent(CDN)}`,
    );
    assert.match(d.getElementById('man-detail-sub').textContent, /Dunkelbläulichgrau/);
  } finally {
    w.close();
  }
});
