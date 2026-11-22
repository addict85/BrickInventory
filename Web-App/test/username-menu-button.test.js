/**
 * The three lines sit INSIDE the username — and stay there.
 *
 * ── Counter-checks (carried out, results copied) ────────────────────
 *
 * A  name and lines merged into ONE element called `ubadge`:
 *      <button class="ubadge" id="ubadge" data-click="userMenu">— ☰</button>
 *    → “the lines sit in the button”           GREEN (the glyph is in there after all)
 *      “the lines survive the username”        red: „Die drei Striche sind nach
 *                                              dem Setzen des Namens verschwunden"
 *      “tells a screen reader …”               red (no glyph of its own that one
 *                                              could hide)
 *
 * B  the glyph removed from the button      → all three red
 *
 * C  back to the old, separate structure (badge, next to it a button):
 *    → “the lines sit in the button”           red: „Name und Striche sind
 *                                              wieder getrennt"
 *      “the lines survive the username”        red
 *      “tells a screen reader …”               GREEN — and that is right:
 *                                              the old button was accessible,
 *                                              it just was not the name tag.
 *
 * A is the case that matters: there case 1 stays green and only case 2
 * falls. So the two really measure different things — “the lines are in the
 * button” and “they stay there when somebody logs in”.
 *
 * And a counter-check that measured NOTHING, as a warning: on the first
 * attempt the check searched for the button via `getElementById('btn-umenu')` and
 * the variant accidentally gave the button two `id` attributes. The parser
 * takes the first, `btn-umenu` was thus not there at all, and all three cases
 * fell on `assert.ok(button)` — for a formal reason, not on the damage. Three
 * red cases looked like a sharp check and were a broken
 * template. Hence the search via `data-click`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { openUi, ANMELDUNG, sicht, warte } = require('./helpers/ui');

const ROOT = path.join(__dirname, '..');
/** Since 27.10. the lines are a symbol of the symbol family instead of „☰“. */
const dashes = knopf => knopf.querySelector('.ubadge-stripes use[href="#i-menu"]');

function kopfleiste() {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const auf = html.indexOf('<header');
  const zu = html.indexOf('</header>');
  assert.ok(auf > 0 && zu > auf, 'No <header> in index.html — does the search still work?');
  return new JSDOM('<!doctype html><html><body>' + html.slice(auf, zu + 9) + '</body></html>');
}

/**
 * Find the menu button via its HANDLER, not via the ID.
 */
function menuButton(document) {
  const knopf = document.querySelector('[data-click="userMenu"]');
  assert.ok(knopf, 'No element with data-click="userMenu" in the header bar');
  assert.equal(knopf.tagName, 'BUTTON');
  return knopf;
}

test('the lines sit in the button, not next to it', () => {
  const { document } = kopfleiste().window;
  const knopf = menuButton(document);

  assert.ok(dashes(knopf), 'The three bars are not in the menu button — are they a separate element next to it again?');

  // And the name stands in the SAME button. Exactly that is „integrating": not
  // two elements that lie side by side, but one.
  const name = document.getElementById('ubadge');
  assert.ok(name, 'No #ubadge in the header bar');
  assert.ok(knopf.contains(name), 'The name label is not in the menu button — name and bars are separated again');
});

test('the lines survive the username', () => {
  const { document } = kopfleiste().window;
  const knopf = menuButton(document);
  const name = document.getElementById('ubadge');
  assert.ok(name, 'No #ubadge — konto.js writes the name exactly there');

  // Exactly what konto.js does in showApp().
  name.textContent = 'marco';

  assert.ok(
    dashes(knopf),
    'The three bars disappeared after setting the name — ' +
      'is `id="ubadge"` on the button instead of on the inner field?',
  );
  assert.ok(knopf.textContent.includes('marco'), 'The user name is not in the button after setting it');
});

test('the button tells a screen reader that it is a menu', () => {
  const { document } = kopfleiste().window;
  const knopf = menuButton(document);

  // The ID stays required: closeMenu() and userMenu() in
  // js/sammlung.js keep `aria-expanded` updated via G('btn-umenu').
  assert.equal(
    knopf.id,
    'btn-umenu',
    'The menu button is no longer called `btn-umenu` — sammlung.js keeps `aria-expanded` up to date through it',
  );

  assert.equal(knopf.getAttribute('aria-haspopup'), 'true');
  assert.equal(
    knopf.getAttribute('aria-expanded'),
    'false',
    'At the start the menu is closed — `aria-expanded` must say so',
  );
  assert.equal(knopf.getAttribute('aria-controls'), 'umenu-pop');

  // NO aria-label: that replaces the visible name, the screen reader
  // would then not have named the username at all any more. The addition stands
  // instead as read-aloud text in the button.
  assert.equal(
    knopf.getAttribute('aria-label'),
    null,
    'An `aria-label` on the button would hide the user name from screen readers',
  );

  const zusatz = knopf.querySelector('.vh');
  assert.ok(
    zusatz && zusatz.textContent.trim().length >= 2,
    'The spoken addition („Menü“) is missing — the button would then only be called „marco ☰“',
  );

  // The lines themselves are worth nothing to a screen reader.
  const glyph = knopf.querySelector('.ubadge-stripes');
  assert.ok(glyph, 'No .ubadge-stripes in the button');
  assert.equal(
    glyph.getAttribute('aria-hidden'),
    'true',
    '„☰" read aloud yields nothing — the glyph should be hidden',
  );
});

/**
 * The admin hint stands IN the name. Counter-checks (08.11.2026, on the bundle): showUsernames() without
 * `angemeldetesKonto.isAdmin &&` or with fixed „Admin“ instead of tRaw('users.admin_badge') →
 * red (in English „Verwalter“ would stand); the profile page again with its own `G('ubadge').textContent =
 * username` instead of showUsernames() → red (after saving).
 */
test('the signature carries the administrator hint, the tile is gone', () => {
  const { document } = kopfleiste().window;
  assert.equal(
    document.getElementById('abadge'),
    null,
    'The admin badge is in the header bar again — then it says the same ' +
      'as the name next to it, and the menu no longer sits at the far right.',
  );

  // The name button is the LAST element of the row.
  const rowList = document.querySelector('.umenu');
  assert.ok(rowList, 'No .umenu in the header bar');
  const lastOne = [...rowList.children].at(-1);
  assert.ok(
    lastOne.contains(document.getElementById('btn-umenu')),
    'There is still something in the row after the menu button — then it is not at the far right.',
  );
});

test('with administrator rights (Administrator) follows, without only the name', async () => {
  // On the bundle in jsdom: log in as admin and as user, in English, and after saving the profile.
  const ich = u => ({
    '/v2/auth/me': { ...ANMELDUNG['/v2/auth/me'], user: { ...ANMELDUNG['/v2/auth/me'].user, ...u } },
  });
  const name = async (antworten, opt) => {
    const o = await openUi(antworten, opt);
    await warte(() => o.d.getElementById('ubadge').textContent.trim());
    return o;
  };
  for (const [u, opt, soll] of [
    [{}, {}, 'anna (Administrator)'],
    [{ is_admin: false }, {}, 'anna'],
    [{}, { language: 'en' }, 'anna (Administrator)'],
  ]) {
    const { w, d } = await name(ich(u), opt);
    try {
      assert.equal(d.getElementById('ubadge').textContent.trim(), soll, JSON.stringify([u, opt]));
    } finally {
      w.close();
    }
  }
  // The profile page sets the name via the same rule — the hint stays after saving.
  const { w, d } = await name({
    '/v2/auth/profile': { success: true, user: { username: 'anna', email: 'anna@example.org', email_verified: true } },
  });
  try {
    await sicht(w, 'profile');
    await warte(() => d.getElementById('prof-user').value === 'anna');
    d.getElementById('prof-user').value = 'anna2';
    d.getElementById('btn-sav-prof').click();
    await warte(() => d.getElementById('confirm-modal').style.display === 'flex');
    d.getElementById('cd-pw').value = 'Mein-Passwort-1';
    d.getElementById('cd-confirm').click();
    assert.ok(
      await warte(() => d.getElementById('ubadge').textContent.trim() === 'anna2 (Administrator)'),
      `after saving: ${d.getElementById('ubadge').textContent}`,
    );
  } finally {
    w.close();
  }
});
