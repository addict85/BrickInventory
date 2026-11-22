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
  assert.ok(auf > 0 && zu > auf, 'Kein <header> in index.html — greift die Suche noch?');
  return new JSDOM('<!doctype html><html><body>' + html.slice(auf, zu + 9) + '</body></html>');
}

/**
 * Find the menu button via its HANDLER, not via the ID.
 */
function menuButton(document) {
  const knopf = document.querySelector('[data-click="userMenu"]');
  assert.ok(knopf, 'Kein Element mit data-click="userMenu" in der Kopfleiste');
  assert.equal(knopf.tagName, 'BUTTON');
  return knopf;
}

test('the lines sit in the button, not next to it', () => {
  const { document } = kopfleiste().window;
  const knopf = menuButton(document);

  assert.ok(dashes(knopf), 'Die drei Striche stehen nicht im Menüknopf — sind sie wieder ein eigenes Element daneben?');

  // And the name stands in the SAME button. Exactly that is „integrating": not
  // two elements that lie side by side, but one.
  const name = document.getElementById('ubadge');
  assert.ok(name, 'Kein #ubadge in der Kopfleiste');
  assert.ok(knopf.contains(name), 'Der Namenszug liegt nicht im Menüknopf — Name und Striche sind wieder getrennt');
});

test('the lines survive the username', () => {
  const { document } = kopfleiste().window;
  const knopf = menuButton(document);
  const name = document.getElementById('ubadge');
  assert.ok(name, 'Kein #ubadge — konto.js schreibt den Namen genau dorthin');

  // Exactly what konto.js does in showApp().
  name.textContent = 'marco';

  assert.ok(
    dashes(knopf),
    'Die drei Striche sind nach dem Setzen des Namens verschwunden — ' +
      'liegt `id="ubadge"` am Knopf statt am inneren Feld?',
  );
  assert.ok(knopf.textContent.includes('marco'), 'Der Benutzername steht nach dem Setzen nicht im Knopf');
});

test('the button tells a screen reader that it is a menu', () => {
  const { document } = kopfleiste().window;
  const knopf = menuButton(document);

  // The ID stays required: closeMenu() and userMenu() in
  // js/sammlung.js keep `aria-expanded` updated via G('btn-umenu').
  assert.equal(
    knopf.id,
    'btn-umenu',
    'Der Menüknopf heißt nicht mehr `btn-umenu` — sammlung.js führt `aria-expanded` darüber mit',
  );

  assert.equal(knopf.getAttribute('aria-haspopup'), 'true');
  assert.equal(
    knopf.getAttribute('aria-expanded'),
    'false',
    'Zu Beginn ist das Menü zu — `aria-expanded` muss das sagen',
  );
  assert.equal(knopf.getAttribute('aria-controls'), 'umenu-pop');

  // NO aria-label: that replaces the visible name, the screen reader
  // would then not have named the username at all any more. The addition stands
  // instead as read-aloud text in the button.
  assert.equal(
    knopf.getAttribute('aria-label'),
    null,
    'Ein `aria-label` am Knopf würde den Benutzernamen für Bildschirmleser verdecken',
  );

  const zusatz = knopf.querySelector('.vh');
  assert.ok(
    zusatz && zusatz.textContent.trim().length >= 2,
    'Der vorgelesene Zusatz („Menü") fehlt — der Knopf hiesse dann nur „marco ☰"',
  );

  // The lines themselves are worth nothing to a screen reader.
  const glyph = knopf.querySelector('.ubadge-stripes');
  assert.ok(glyph, 'Kein .ubadge-stripes im Knopf');
  assert.equal(
    glyph.getAttribute('aria-hidden'),
    'true',
    '„☰" vorgelesen ergibt nichts — die Glyphe gehört versteckt',
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
    'Die Admin-Plakette steht wieder in der Kopfleiste — dann sagt sie dasselbe ' +
      'wie der Name daneben, und das Menü sitzt nicht mehr ganz rechts.',
  );

  // The name button is the LAST element of the row.
  const rowList = document.querySelector('.umenu');
  assert.ok(rowList, 'Keine .umenu in der Kopfleiste');
  const lastOne = [...rowList.children].at(-1);
  assert.ok(
    lastOne.contains(document.getElementById('btn-umenu')),
    'Nach dem Menüknopf steht noch etwas in der Reihe — dann ist er nicht ganz rechts.',
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
      `nach dem Speichern: ${d.getElementById('ubadge').textContent}`,
    );
  } finally {
    w.close();
  }
});
