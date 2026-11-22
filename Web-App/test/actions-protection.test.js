/**
 * The action dispatcher (public/js/actions.js) is not a script gadget:
 * injected markup without script triggers no dangerous action, no
 * mouse hover triggers anything at all, and global functions
 * are not reachable via data-click. Real buttons from templates and from
 * index.html keep working. Checked on the real bundle in jsdom.
 *
 * Counter-checks (measured 01.11.2026, each alone, bundle rebuilt; names
 * in English since phase 2b round 5: `GEFAEHRLICH`→`DANGEROUS`, `NUR`→`ONLY`):
 *   A  DANGEROUS check removed in handle() → red: “injected button
 *      opens the password dialog"
 *   B  mouseenter back in DELEGATED → red: “hover triggers"
 *   C  ONLY check for change removed → red: “change with a foreign handler"
 *   D  fallback to window back in resolveAction() → red: “window.open"
 *   E  genuine() removed from nutzerKnopf() in einstellungen.js → red: “real
 *      button of the user list works"
 *   F  a name deleted from ONLY.change → red: “every handler in the markup
 *      is in the list of its event"
 *   G  genuine() removed from papierkorbEndgueltig (papierkorb.js) → red:
 *      “every template with a dangerous action carries genuine()"
 */
const { isAppModule } = require('../scripts/build-frontend');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openUi, warte, takt } = require('./helpers/ui');

const ROOT = path.join(__dirname, '..');
const NUTZER = {
  success: true,
  users: [
    { id: 1, username: 'anna', is_admin: true, created_at: '2026-10-01T00:00:00Z' },
    { id: 2, username: 'bert', is_admin: false, created_at: '2026-10-02T00:00:00Z' },
  ],
};

async function oberflaeche() {
  const o = await openUi({
    '/v2/auth/users': NUTZER,
    '/v2/settings/tokens': { success: true, tokens: [{ token_id: 't1', label: 'Telefon', current: false }] },
  });
  o.inject = html => {
    const div = o.d.createElement('div');
    div.innerHTML = html;
    o.d.body.appendChild(div);
    return div;
  };
  o.openPwDialog = () => o.d.getElementById('pw-modal').classList.contains('open');
  return o;
}

test('injected markup triggers no dangerous action', async () => {
  const { w, d, aufrufe, inject, openPwDialog } = await oberflaeche();
  try {
    inject('<button id="x1" data-click="openRpw" data-arg="2">x</button>');
    d.getElementById('x1').click();
    await takt(20);
    assert.equal(openPwDialog(), false, 'injected button opens the password dialog');

    const vorher = aufrufe.length;
    inject('<button id="x2" data-click="revokeOtherTokens">x</button>');
    d.getElementById('x2').click();
    await takt(50);
    assert.deepEqual(
      aufrufe.slice(vorher).filter(a => a.url.includes('/tokens')),
      [],
      'injected button fetches the token list',
    );

    // loadGallery is harmless and registered: only the event matters here.
    const galleryFetches = ab => aufrufe.slice(ab).filter(a => /\/v2\/sets(\?|$)/.test(a.url.replace(/^.*\/api/, '')));
    let ab = aufrufe.length;
    inject('<div id="x3" data-mouseenter="loadGallery">x</div>');
    d.getElementById('x3').dispatchEvent(new w.MouseEvent('mouseenter'));
    await takt(50);
    assert.deepEqual(galleryFetches(ab), [], 'hovering triggers');

    ab = aufrufe.length;
    inject('<input id="x4" data-change="loadGallery">');
    d.getElementById('x4').dispatchEvent(new w.Event('change', { bubbles: true }));
    await takt(50);
    assert.deepEqual(galleryFetches(ab), [], 'change with a foreign handler');

    // Control: the same handler via click runs — otherwise the two above prove nothing.
    ab = aufrufe.length;
    inject('<button id="x6" data-click="loadGallery">x</button>');
    d.getElementById('x6').click();
    await takt(50);
    assert.ok(galleryFetches(ab).length > 0, 'Kontrolle: loadGallery per Klick ruft /v2/sets ab');

    let opened = 0;
    w.open = () => {
      opened++;
      return null;
    };
    inject('<button id="x5" data-click="open" data-arg="https://example.org/">x</button>');
    d.getElementById('x5').click();
    await takt(20);
    assert.equal(opened, 0, 'window.open reachable via data-click');
  } finally {
    w.close();
  }
});

test('real buttons from template and markup keep working', async () => {
  const { w, d, aufrufe, openPwDialog } = await oberflaeche();
  try {
    d.querySelector('.umenu-item[data-arg="settings"]').click();
    const knopf = () => d.querySelector('#users-tbl [data-click="openRpw"][data-arg="2"]');
    assert.ok(await warte(() => knopf()), 'user list not drawn');
    knopf().click();
    await takt(20);
    assert.equal(openPwDialog(), true, 'real button of the user list works');
    assert.equal(d.getElementById('rpw-uid').value, '2');

    const vorher = aufrufe.length;
    d.querySelector('[data-click="revokeOtherTokens"]').click();
    await takt(50);
    assert.ok(
      aufrufe.slice(vorher).some(a => a.url.includes('/tokens')),
      'static button from index.html works',
    );
  } finally {
    w.close();
  }
});

test('every handler in the markup is in the list of its event', () => {
  // Structure: the lists in aktionen.js must cover the markup, otherwise
  // a real field would be dead. The test above checks the opposite direction.
  const source = fs.readFileSync(path.join(ROOT, 'public', 'js', 'actions.js'), 'utf8');
  const liste = typ => {
    const m = source.match(new RegExp(`\\b${typ}: new Set\\(\\[([^\\]]*)\\]`));
    assert.ok(m, `List for ${typ} not found`);
    return new Set([...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]));
  };
  const dateien = [
    path.join(ROOT, 'public', 'index.html'),
    ...fs
      .readdirSync(path.join(ROOT, 'public', 'js'))
      .filter(f => isAppModule(f))
      .map(f => path.join(ROOT, 'public', 'js', f)),
  ];
  // The log window (monitor.js) is a separate popup with its own resolution.
  const LOG_WINDOW = new Set(['loadLogs', 'renderLogs']);
  const fehlt = [];
  let gesehen = 0;
  for (const typ of ['change', 'input', 'blur', 'keydown']) {
    const erlaubt = liste(typ);
    for (const f of dateien)
      for (const m of fs.readFileSync(f, 'utf8').matchAll(new RegExp(`data-${typ}="([^"$]+)"`, 'g'))) {
        gesehen++;
        if (!erlaubt.has(m[1]) && !LOG_WINDOW.has(m[1])) fehlt.push(`${path.basename(f)}: data-${typ}="${m[1]}"`);
      }
  }
  assert.ok(gesehen > 40, `only ${gesehen} matches — does the search still match?`);
  assert.deepEqual(fehlt, []);
});

test('every template with a dangerous action carries genuine()', () => {
  // Otherwise the button would be dead: the dispatcher rejects it.
  const source = fs.readFileSync(path.join(ROOT, 'public', 'js', 'actions.js'), 'utf8');
  const dangerous = new Set(
    [...source.match(/DANGEROUS = new Set\(\[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map(x => x[1]),
  );
  const ohne = [];
  let gesehen = 0;
  for (const f of fs.readdirSync(path.join(ROOT, 'public', 'js')).filter(f => isAppModule(f)))
    for (const m of fs
      .readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8')
      .matchAll(/data-click="([^"$]+)"(\$\{genuine\(\)\})?/g))
      if (dangerous.has(m[1])) {
        gesehen++;
        if (!m[2]) ohne.push(`${f}: ${m[1]}`);
      }
  assert.ok(gesehen > 15, `only ${gesehen} matches — does the search still match?`);
  assert.deepEqual(ohne, []);
});
