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
 *      roles are called …”; maillink.abbrechen.ok back to “übrigen Verwalter”, FEHLER.nur_admins (de)
 *      back to “Nur für Admins”, settings.admins_only (en) back to “Admins only” → each red: “the roles are called …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openUi, reiter, warte } = require('./helpers/ui');

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
  assert.deepEqual(onlyDe, [], `Nur in DE vorhanden: ${onlyDe.join(', ')}`);
  assert.deepEqual(onlyEn, [], `Nur in EN vorhanden: ${onlyEn.join(', ')}`);
});

test('placeholders match between DE and EN', () => {
  const { de, en } = loadTranslations();
  for (const k of Object.keys(de)) {
    if (!(k in en)) continue; // is reported by the parity test
    assert.deepEqual(
      placeholders(de[k]),
      placeholders(en[k]),
      `Platzhalter weichen ab bei "${k}": DE=${de[k]}  EN=${en[k]}`,
    );
  }
});

/**
 * The same text in both languages means: not translated.
 */
test('no text stands untranslated in both languages', () => {
  // Terms, proper names and number formats that are the same in both
  // languages. Every entry is a decision, not leniency.
  const gewolltGleich = new Set([
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
    // The feedback of the balance query: “{nummer}: {betrag}" — a pure
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
    'users.protokoll.verwalter',
    'settings.users_admin_badge',
    // The label of the button that reads in a BrickLink wanted list:
    // a proper name and a file format. “BrickLink XML" is the same in both
    // languages, and a Germanized brand would be wrong.
    'wanted.pick_short',
  ]);

  const { de, en } = loadTranslations();
  assert.ok(Object.keys(en).length > 400, `Zu wenige Texte geladen (${Object.keys(en).length}) — Helfer kaputt?`);

  const gleich = Object.keys(en).filter(k => k in de && de[k] === en[k]);
  const untranslated = gleich.filter(k => !gewolltGleich.has(k)).sort();
  assert.deepEqual(
    untranslated,
    [],
    'Diese Texte stehen auf Deutsch wortgleich wie auf Englisch — sehr wahrscheinlich ' +
      'beim Anlegen kopiert und nicht übersetzt:\n  ' +
      untranslated.map(k => `${k} = "${en[k]}"`).join('\n  ') +
      '\nIst er wirklich in beiden Sprachen gleich, gehört er in `gewolltGleich`.',
  );

  const veraltet = [...gewolltGleich].filter(k => !gleich.includes(k)).sort();
  assert.deepEqual(
    veraltet,
    [],
    `Diese Einträge in \`gewolltGleich\` stimmen nicht mehr: ${veraltet.join(', ')} — raus damit.`,
  );
  checkTerms(de, en);
});

/** Terms uniform: Konto instead of Benutzer, CSV-Import, English email. @param {Record<string, string>} de @param {Record<string, string>} en */
function checkTerms(de, en) {
  const fund = (/** @type {Record<string, string>} */ w, /** @type {RegExp} */ r) =>
    Object.entries(w)
      .filter(([, v]) => r.test(v))
      .map(([k, v]) => `${k} = ${v}`);
  assert.deepEqual(fund(en, /\be-mail/i), [], 'EN schreibt email');
  assert.deepEqual(fund(de, /CSV Import/), [], 'DE schreibt CSV-Import');
  // An account is called Konto; the role is called “Standard”, no longer “Benutzer”.
  assert.deepEqual(fund(de, /\bBenutzer(?!name)/), [], 'Konto statt Benutzer');
}

test('the roles are called Standard and Administrator, also in server error texts', () => {
  const { de, en } = loadTranslations();
  assert.equal(de['users.role.user'], 'Standard');
  assert.equal(de['users.role.admin'], 'Administrator');
  assert.equal(en['users.role.user'], 'Standard');
  assert.equal(en['users.role.admin'], 'Administrator');
  const { ERRORS } = require('./helpers/sources').buildAndRequire()('src/infra/errorTexts.js');
  assert.match(ERRORS.letzter_verwalter.de, /Administrator/, 'Server-Fehlertext ohne Rollennamen — Code umbenannt?');
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
    assert.ok(k in de, `Schlüssel fehlt: ${k}`);
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
  assert.doesNotMatch(fn, /rgba\(255,255,255,\.22\)/, 'Der schwache Ruhezustand darf nicht mehr vorkommen');
  assert.match(
    fn,
    /\[data-theme="brick"\] \.sc \.delbtn\{\s*background:#fff;/,
    'Der Ruhezustand muss bereits voll weiss hinterlegt sein',
  );
});

const GRAY = 'Dark Bluish Gray';
const COLORS = {
  '/v1/parts': {
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
  '/v1/parts/colors': {
    success: true,
    colors: [{ color_name: GRAY, color_hex: '6C6E68', unique_parts: 1, total_quantity: 2 }],
  },
  '/v1/parts/brick-colors': { success: true, colors: [{ id: 72, name: GRAY, hex: '6C6E68' }] },
};

test('color names: displayed in German, stored and filtered in English', async () => {
  for (const [sprache, sichtbar] of [
    ['de', 'Dunkelbläulichgrau'],
    ['en', GRAY],
  ]) {
    const { w, d } = await openUi(COLORS, { sprache });
    try {
      await reiter(w, 'parts');
      assert.ok(
        await warte(
          () => d.querySelector('#ap-color-select option[data-name]') && d.querySelector('#parts-main .group-title'),
        ),
      );
      const option = d.querySelector('#ap-color-select option[data-name]');
      // data-name goes to the backend and to BrickLink on saving: English.
      assert.deepEqual([option.textContent.trim(), option.dataset.name], [sichtbar, GRAY], sprache);
      assert.equal(
        d.querySelector('#parts-main .group-title').textContent.trim(),
        sichtbar,
        `${sprache}: Gruppenüberschrift`,
      );
      assert.match(d.querySelector('#parts-main .part-color').textContent, new RegExp(sichtbar), `${sprache}: Kachel`);
      const filter = [...d.querySelectorAll('#parts-color option')].find(o => o.value === GRAY);
      assert.ok(filter, 'Der Filterwert bleibt englisch');
      assert.match(filter.textContent, new RegExp(`^${sichtbar} `), `${sprache}: Filterbeschriftung`);
    } finally {
      w.close();
    }
  }
});

test('the purchase price detail dialog loads the part image in full size via the proxy', async () => {
  const CDN = 'https://cdn.rebrickable.com/media/parts/elements/300121.jpg';
  const { w, d } = await openUi({
    ...COLORS,
    '/v1/parts/manual': {
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
    await reiter(w, 'parts');
    assert.ok(await warte(() => d.querySelector('#manual-parts-list [data-click="openManDetail"]')));
    d.querySelector('#manual-parts-list [data-click="openManDetail"]').click();
    assert.ok(await warte(() => d.getElementById('man-detail-img').getAttribute('src')));
    assert.equal(
      d.getElementById('man-detail-img').getAttribute('src'),
      `/api/v1/img-proxy?url=${encodeURIComponent(CDN)}`,
    );
    assert.match(d.getElementById('man-detail-sub').textContent, /Dunkelbläulichgrau/);
  } finally {
    w.close();
  }
});
