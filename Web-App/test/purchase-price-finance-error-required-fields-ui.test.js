/**
 * UX check 26 on the real bundle in jsdom: purchase price tile while loading (N1), error state of the finances (N2),
 * unit price of the manual parts and figures (N3), empty login fields (N4), jump bar in the account (N5) and the
 * login without a stored session cookie (operation).
 *
 * Counter-checks (measured 15.11.2026, each on its own, bundle rebuilt):
 *   A  index.html again „Kaufpreis gesamt“ / „Summe der Kaufpreise“ → red: “N1 …” (before the first load)
 *   B  finanzenFehlen() without titel → red: “N2 …” (Die Liste konnte nicht geladen werden); without
 *      filterBedienbar(false) → red: same place (chip „Sets“ operable); without filterBedienbar(true) → red: same place
 *      (locked after „Erneut versuchen“)
 *   C  teile.js again fmtN() without „je“ → red: “N3 …” (part „0,12 €“); minifigs.js likewise → red: same place (figure)
 *   D  doLogin() without the check of the required fields → red: “N4 …” (all three subcases); errorPlace()
 *      without .secret-field → red: “both empty” (message between password field and eye button)
 *   E  jumpToAccount() without focus() → red: “N5 …” (focus stays on the link)
 *   F  sessionEnded without the branch withoutCookie → red: “operation …” (Sitzung abgelaufen); with isSecureContext
 *      true the same flow shows „Sitzung abgelaufen“ (second subcase, counterpart)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, sicht, warte, takt } = require('./helpers/ui');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();

const SET = {
  set_number: '10294-1',
  name: 'Titanic',
  quantity: 1,
  purchase_price: 629,
  avg_price: 700,
  total_avg: '700',
  value_total: 700,
  acquisitions: [{ id: 1, condition: 'N', quantity: 1, purchase_price: 629, avg_price: 700, value_total: 700 }],
};
const VALUATION = {
  success: true,
  currency: 'EUR',
  totals: { min: '650', avg: '700', max: '760' },
  sets: [SET],
};
// Only part of the positions valued: the tile is then called „Kaufpreis (bewertete Positionen)“.
const PNL = {
  success: true,
  totals: {
    purchase: '829',
    sets_purchase: '629',
    pnl_percent: 11.3,
    positions: 2,
    positions_valued: 1,
    positions_without_market_price: 1,
    positions_without_purchase_price: 0,
    baseline_cost: '629',
    baseline_market_value: '700',
    baseline_pnl_amount: '71',
    cost_without_market_price: '200',
    market_value_without_purchase_price: '0',
  },
};

test('N1 purchase price tile: neutral while loading, the addition only with data', async () => {
  /** @type {null | ((v: unknown) => void)} */
  let freigeben = null;
  let anhalten = false;
  const { w, d, ruhig } = await openUi({
    '/v2/finance/valuation': () => (anhalten ? new Promise(r => (freigeben = () => r(VALUATION))) : VALUATION),
    '/v2/finance/pnl': PNL,
  });
  try {
    const titel = () => text(d.getElementById('fin-cost-basis-title'));
    const zusatz = () => text(d.getElementById('fin-cost-basis-sub'));
    assert.equal(titel(), 'Kaufpreis', 'before the first load');
    assert.equal(zusatz(), '');
    anhalten = true;
    await reiter(w, 'finance');
    await warte(() => freigeben);
    assert.equal(titel(), 'Kaufpreis', 'while loading');
    assert.equal(zusatz(), '', 'no addition while loading');
    freigeben?.(null);
    await ruhig();
    assert.equal(titel(), 'Kaufpreis (bewertete Positionen)');
    assert.match(zusatz(), /^Insgesamt bezahlt: 829/);
  } finally {
    w.close();
  }
});

test('N2 finances error: own title, chips and search locked, free after success', async () => {
  let kaputt = true;
  const { w, d, ruhig } = await openUi({
    '/v2/finance/valuation': () =>
      kaputt ? { $status: 500, success: false, error: 'interner Fehler', code: 'internal_error' } : { ...VALUATION },
    '/v2/finance/pnl': PNL,
  });
  try {
    const bedienbar = () =>
      [...d.querySelectorAll('#fin-filter button, #fin-search')].map(el => `${el.id || text(el)}:${!el.disabled}`);
    await reiter(w, 'finance');
    await warte(() => d.querySelector('#portfolio-chart .error-state'));
    await ruhig();
    assert.equal(text(d.querySelector('#portfolio-chart .error-state h2')), 'Finanzen konnten nicht geladen werden');
    assert.deepEqual(bedienbar(), ['Alle:false', 'Sets:false', 'Teile:false', 'Minifiguren:false', 'fin-search:false']);
    kaputt = false;
    d.querySelector('#portfolio-chart .error-state button[data-click]').click();
    await warte(() => d.querySelector('#fin-tbl table'));
    await ruhig();
    assert.deepEqual(bedienbar(), ['Alle:true', 'Sets:true', 'Teile:true', 'Minifiguren:true', 'fin-search:true']);
  } finally {
    w.close();
  }
});

test('N3 manually entered parts and minifigures: unit price with “je”', async () => {
  const { w, d, ruhig } = await openUi({
    '/v2/parts/manual': {
      success: true,
      parts: [
        {
          part_number: '3001',
          part_name: 'Brick 2 x 4',
          color_id: 4,
          color_name: 'Red',
          color_hex: 'C91A09',
          quantity: 3,
          conditions: ['U'],
          avg_purchase_price: 0.12,
        },
      ],
    },
    '/v2/minifigs/manual': {
      success: true,
      figs: [
        { fig_number: 'fig-000123', fig_name: 'Chewbacca', quantity: 2, conditions: ['N'], avg_purchase_price: 4.5 },
      ],
    },
  });
  try {
    await reiter(w, 'parts');
    await warte(() => d.querySelector('#manual-parts-list .man-price'));
    await ruhig();
    assert.equal(text(d.querySelector('#manual-parts-list .man-price')), 'je 0,12 €', 'Teil');
    await reiter(w, 'minifigs');
    await warte(() => d.querySelector('#figs-list .man-price, #manual-figs-list .man-price'));
    await ruhig();
    assert.equal(text(d.querySelector('.man-tile[data-arg="fig"] .man-price')), 'je 4,50 €', 'figure');
  } finally {
    w.close();
  }
});

test('N4 login: empty required fields report at the field', async t => {
  const { w, d, aufrufe } = await openUi(
    {
      '/v2/auth/login': {
        $status: 401,
        success: false,
        error: 'Benutzername oder Passwort falsch',
        code: 'credentials_invalid',
      },
    },
    { loggedIn: false },
  );
  try {
    await warte(() => typeof d.getElementById('btn-login')?.onclick === 'function');
    const logins = () => aufrufe.filter(a => a.url.includes('/v2/auth/login')).length;
    await t.test('both empty', async () => {
      d.getElementById('btn-login').click();
      await takt(30);
      assert.equal(logins(), 0, 'server asked');
      assert.equal(text(d.getElementById('lerr')), '', 'combined message at the top');
      for (const [id, meldung] of [
        ['lu', 'Bitte Benutzername oder E-Mail eingeben.'],
        ['lp', 'Bitte Passwort eingeben.'],
      ]) {
        const f = d.getElementById(id);
        assert.equal(f.getAttribute('aria-invalid'), 'true', id);
        const ids = (f.getAttribute('aria-describedby') || '').split(/\s+/);
        assert.ok(ids.includes(`${id}-error`), `${id}: aria-describedby`);
        assert.equal(text(d.getElementById(`${id}-error`)), meldung);
      }
      assert.equal(d.activeElement.id, 'lu', 'focus in the first faulty field');
      // The message stands below the password field, not between field and eye button.
      assert.equal(d.getElementById('lp-error').parentElement.classList.contains('secret-field'), false);
    });
    await t.test('only the password empty', async () => {
      d.getElementById('lu').value = 'anna';
      d.getElementById('btn-login').click();
      await takt(30);
      assert.equal(logins(), 0);
      assert.equal(d.getElementById('lu-error').hidden, true);
      assert.equal(d.getElementById('lu').hasAttribute('aria-invalid'), false);
      assert.equal(d.activeElement.id, 'lp');
    });
    await t.test('wrong credentials stay at the top', async () => {
      d.getElementById('lp').value = 'wrong';
      d.getElementById('btn-login').click();
      await warte(() => text(d.getElementById('lerr')));
      assert.equal(logins(), 1);
      assert.equal(text(d.getElementById('lerr')), 'Benutzername oder Passwort falsch');
      assert.equal(d.getElementById('lp-error').hidden, true);
    });
  } finally {
    w.close();
  }
});

test('N5 account: jump bar to all sections', async () => {
  const { w, d } = await openUi();
  try {
    await sicht(w, 'profile');
    const nav = d.querySelector('#tab-profile [role="navigation"].account-nav');
    assert.ok(nav, 'no bar');
    assert.equal(nav.getAttribute('aria-label'), 'Abschnitte');
    const links = [...nav.querySelectorAll('a')];
    assert.deepEqual(links.map(text), [
      'Darstellung',
      'Profil',
      'Passwort',
      'Zweiter Faktor',
      'Passkeys',
      'Gefahrenzone',
    ]);
    const vorher = w.location.hash;
    for (const a of links) {
      /** @type {Element[]} */
      const gerollt = [];
      w.HTMLElement.prototype.scrollIntoView = function () {
        gerollt.push(this);
      };
      a.click();
      await takt(10);
      const ziel = d.getElementById(a.dataset.arg);
      assert.equal(d.activeElement, ziel, `${text(a)}: focus on the heading`);
      assert.ok(gerollt[0]?.contains(ziel), `${text(a)}: not scrolled there`);
      assert.equal(w.location.hash, vorher, `${text(a)}: the hash belongs to the router`);
    }
  } finally {
    w.close();
  }
});

/** Log in; afterwards the collection answers with 401 as without a cookie. */
async function signInWithoutCookie(sicher) {
  let angemeldet = false;
  const withoutSession = { $status: 401, success: false, error: 'Nicht angemeldet', code: 'not_signed_in' };
  const o = await openUi(
    {
      '/v2/auth/login': () => {
        angemeldet = true;
        // Like an older server without keks_fehlt: the UI then concludes the missing HTTPS by itself.
        return {
          $contractViolating: 'älterer Server ohne keks_fehlt',
          success: true,
          user: { id: 1, username: 'anna', is_admin: false },
        };
      },
      '/v2/sets': () => (angemeldet ? withoutSession : { success: true, sets: [], count: 0, total: 0, themes: [] }),
      '/v2/stats': () => (angemeldet ? withoutSession : { success: true, stats: {} }),
    },
    {
      loggedIn: false,
      before: w => Object.defineProperty(w, 'isSecureContext', { value: sicher }),
      // Since round 27 http: alone also counts as „without HTTPS“; the secure page is therefore https.
      ...(sicher ? { url: 'https://localhost/' } : {}),
    },
  );
  await warte(() => typeof o.d.getElementById('btn-login')?.onclick === 'function');
  o.d.getElementById('lu').value = 'anna';
  o.d.getElementById('lp').value = 'richtig-richtig';
  o.d.getElementById('btn-login').click();
  await warte(() => angemeldet && !o.d.getElementById('login-hint').hidden);
  return o;
}

test('operation: login without a stored session cookie', async t => {
  await t.test('page without HTTPS: clear hint instead of “expired”', async () => {
    const { w, d } = await signInWithoutCookie(false);
    try {
      const h = text(d.getElementById('login-hint'));
      assert.match(h, /^Anmeldung erfolgreich, aber der Browser hat das Sitzungs-Cookie nicht gespeichert\./);
      assert.match(h, /HTTPS/);
      assert.match(h, /COOKIE_SECURE=0/);
      assert.doesNotMatch(h, /abgelaufen/);
    } finally {
      w.close();
    }
  });
  await t.test('secure page: as before “session expired”', async () => {
    const { w, d } = await signInWithoutCookie(true);
    try {
      assert.match(text(d.getElementById('login-hint')), /Sitzung abgelaufen/);
    } finally {
      w.close();
    }
  });
});
