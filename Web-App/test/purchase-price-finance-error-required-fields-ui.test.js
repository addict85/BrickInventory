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
 *      without .geheim-feld → red: “both empty” (message between password field and eye button)
 *   E  kontoSprung() without focus() → red: “N5 …” (focus stays on the link)
 *   F  sitzungBeendet without the branch withoutCookie → red: “operation …” (Sitzung abgelaufen); with isSecureContext
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
  wert_gesamt: 700,
  acquisitions: [{ id: 1, condition: 'N', quantity: 1, purchase_price: 629, avg_price: 700, wert_gesamt: 700 }],
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
    pnl_prozent: 11.3,
    positionen: 2,
    positionen_bewertet: 1,
    positionen_ohne_marktpreis: 1,
    positionen_ohne_kaufpreis: 0,
    basis_einstand: '629',
    basis_marktwert: '700',
    basis_guv_betrag: '71',
    ohne_marktpreis_einstand: '200',
    ohne_kaufpreis_marktwert: '0',
  },
};

test('N1 purchase price tile: neutral while loading, the addition only with data', async () => {
  /** @type {null | ((v: unknown) => void)} */
  let freigeben = null;
  let anhalten = false;
  const { w, d, ruhig } = await openUi({
    '/v1/finance/valuation': () => (anhalten ? new Promise(r => (freigeben = () => r(VALUATION))) : VALUATION),
    '/v1/finance/pnl': PNL,
  });
  try {
    const titel = () => text(d.getElementById('fin-einstand-titel'));
    const zusatz = () => text(d.getElementById('fin-einstand-sub'));
    assert.equal(titel(), 'Kaufpreis', 'vor dem ersten Laden');
    assert.equal(zusatz(), '');
    anhalten = true;
    await reiter(w, 'finance');
    await warte(() => freigeben);
    assert.equal(titel(), 'Kaufpreis', 'während des Ladens');
    assert.equal(zusatz(), '', 'während des Ladens kein Zusatz');
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
    '/v1/finance/valuation': () =>
      kaputt ? { $status: 500, success: false, error: 'interner Fehler', code: 'interner_fehler' } : { ...VALUATION },
    '/v1/finance/pnl': PNL,
  });
  try {
    const bedienbar = () =>
      [...d.querySelectorAll('#fin-filter button, #fin-suche')].map(el => `${el.id || text(el)}:${!el.disabled}`);
    await reiter(w, 'finance');
    await warte(() => d.querySelector('#portfolio-chart .fehler-zustand'));
    await ruhig();
    assert.equal(text(d.querySelector('#portfolio-chart .fehler-zustand h2')), 'Finanzen konnten nicht geladen werden');
    assert.deepEqual(bedienbar(), ['Alle:false', 'Sets:false', 'Teile:false', 'Minifiguren:false', 'fin-suche:false']);
    kaputt = false;
    d.querySelector('#portfolio-chart .fehler-zustand button[data-click]').click();
    await warte(() => d.querySelector('#fin-tbl table'));
    await ruhig();
    assert.deepEqual(bedienbar(), ['Alle:true', 'Sets:true', 'Teile:true', 'Minifiguren:true', 'fin-suche:true']);
  } finally {
    w.close();
  }
});

test('N3 manually entered parts and minifigures: unit price with “je”', async () => {
  const { w, d, ruhig } = await openUi({
    '/v1/parts/manual': {
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
    '/v1/minifigs/manual': {
      success: true,
      figs: [
        { fig_number: 'fig-000123', fig_name: 'Chewbacca', quantity: 2, conditions: ['N'], avg_purchase_price: 4.5 },
      ],
    },
  });
  try {
    await reiter(w, 'parts');
    await warte(() => d.querySelector('#manual-parts-list .man-preis'));
    await ruhig();
    assert.equal(text(d.querySelector('#manual-parts-list .man-preis')), 'je 0,12 €', 'Teil');
    await reiter(w, 'minifigs');
    await warte(() => d.querySelector('#figs-list .man-preis, #manual-figs-list .man-preis'));
    await ruhig();
    assert.equal(text(d.querySelector('.man-tile[data-arg="fig"] .man-preis')), 'je 4,50 €', 'Figur');
  } finally {
    w.close();
  }
});

test('N4 login: empty required fields report at the field', async t => {
  const { w, d, aufrufe } = await openUi(
    {
      '/v1/auth/login': {
        $status: 401,
        success: false,
        error: 'Benutzername oder Passwort falsch',
        code: 'anmeldedaten_ungueltig',
      },
    },
    { angemeldet: false },
  );
  try {
    await warte(() => typeof d.getElementById('btn-login')?.onclick === 'function');
    const logins = () => aufrufe.filter(a => a.url.includes('/v1/auth/login')).length;
    await t.test('both empty', async () => {
      d.getElementById('btn-login').click();
      await takt(30);
      assert.equal(logins(), 0, 'Server gefragt');
      assert.equal(text(d.getElementById('lerr')), '', 'Sammelmeldung oben');
      for (const [id, meldung] of [
        ['lu', 'Bitte Benutzername oder E-Mail eingeben.'],
        ['lp', 'Bitte Passwort eingeben.'],
      ]) {
        const f = d.getElementById(id);
        assert.equal(f.getAttribute('aria-invalid'), 'true', id);
        const ids = (f.getAttribute('aria-describedby') || '').split(/\s+/);
        assert.ok(ids.includes(`${id}-fehler`), `${id}: aria-describedby`);
        assert.equal(text(d.getElementById(`${id}-fehler`)), meldung);
      }
      assert.equal(d.activeElement.id, 'lu', 'Fokus ins erste fehlerhafte Feld');
      // The message stands below the password field, not between field and eye button.
      assert.equal(d.getElementById('lp-fehler').parentElement.classList.contains('geheim-feld'), false);
    });
    await t.test('only the password empty', async () => {
      d.getElementById('lu').value = 'anna';
      d.getElementById('btn-login').click();
      await takt(30);
      assert.equal(logins(), 0);
      assert.equal(d.getElementById('lu-fehler').hidden, true);
      assert.equal(d.getElementById('lu').hasAttribute('aria-invalid'), false);
      assert.equal(d.activeElement.id, 'lp');
    });
    await t.test('wrong credentials stay at the top', async () => {
      d.getElementById('lp').value = 'falsch';
      d.getElementById('btn-login').click();
      await warte(() => text(d.getElementById('lerr')));
      assert.equal(logins(), 1);
      assert.equal(text(d.getElementById('lerr')), 'Benutzername oder Passwort falsch');
      assert.equal(d.getElementById('lp-fehler').hidden, true);
    });
  } finally {
    w.close();
  }
});

test('N5 account: jump bar to all sections', async () => {
  const { w, d } = await openUi();
  try {
    await sicht(w, 'profil');
    const nav = d.querySelector('#tab-profil [role="navigation"].konto-nav');
    assert.ok(nav, 'keine Leiste');
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
      assert.equal(d.activeElement, ziel, `${text(a)}: Fokus auf der Überschrift`);
      assert.ok(gerollt[0]?.contains(ziel), `${text(a)}: nicht hingerollt`);
      assert.equal(w.location.hash, vorher, `${text(a)}: der Hash gehört dem Router`);
    }
  } finally {
    w.close();
  }
});

/** Log in; afterwards the collection answers with 401 as without a cookie. */
async function signInWithoutCookie(sicher) {
  let angemeldet = false;
  const withoutSession = { $status: 401, success: false, error: 'Nicht angemeldet', code: 'nicht_angemeldet' };
  const o = await openUi(
    {
      '/v1/auth/login': () => {
        angemeldet = true;
        // Like an older server without keks_fehlt: the UI then concludes the missing HTTPS by itself.
        return {
          $contractViolating: 'älterer Server ohne keks_fehlt',
          success: true,
          user: { id: 1, username: 'anna', is_admin: false },
        };
      },
      '/v1/sets': () => (angemeldet ? withoutSession : { success: true, sets: [], count: 0, total: 0, themes: [] }),
      '/v1/stats': () => (angemeldet ? withoutSession : { success: true, stats: {} }),
    },
    {
      angemeldet: false,
      vorher: w => Object.defineProperty(w, 'isSecureContext', { value: sicher }),
      // Since round 27 http: alone also counts as „without HTTPS“; the secure page is therefore https.
      ...(sicher ? { url: 'https://localhost/' } : {}),
    },
  );
  await warte(() => typeof o.d.getElementById('btn-login')?.onclick === 'function');
  o.d.getElementById('lu').value = 'anna';
  o.d.getElementById('lp').value = 'richtig-richtig';
  o.d.getElementById('btn-login').click();
  await warte(() => angemeldet && !o.d.getElementById('login-hinweis').hidden);
  return o;
}

test('operation: login without a stored session cookie', async t => {
  await t.test('page without HTTPS: clear hint instead of “expired”', async () => {
    const { w, d } = await signInWithoutCookie(false);
    try {
      const h = text(d.getElementById('login-hinweis'));
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
      assert.match(text(d.getElementById('login-hinweis')), /Sitzung abgelaufen/);
    } finally {
      w.close();
    }
  });
});
