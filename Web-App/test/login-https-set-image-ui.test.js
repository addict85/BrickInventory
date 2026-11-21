/**
 * UX check 27 on the real bundle in jsdom: login when the server does not set the session cookie (M1),
 * the hint without HTTPS up front (N1), the error state of the finances (N3) and the set image as a button (N7).
 *
 * Counter-checks (measured 15.11.2026, each on its own, bundle rebuilt):
 *   A  doLogin() without the branch d.keks_fehlt → red: “M1 … server reports …” (app opens and loads without session)
 *   B  withoutHttps() only with isSecureContext (without location.protocol) → red: “M1 … older server …”
 *      („Sitzung abgelaufen“) and “N1 … http://localhost” (hint hidden)
 *   C  hint login-ohne-https never shown → red: “N1” in both cases without HTTPS
 *   D  filterBedienbar() without the class finanzen-fehler → red: “N3 …” (in the error case)
 *   E  zoomStand() without the branch for the button → red: “N7 …” (button stays disabled with an image)
 *   F  sitzungBeendet without !_cookieSet → red: “M1 … server confirms …” (cookie hint instead of „abgelaufen“)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, warte } = require('./helpers/ui');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const COOKIE_MISSING = /^Anmeldung erfolgreich, aber der Browser hat das Sitzungs-Cookie nicht gespeichert\./;
const WITHOUT_SESSION = { $status: 401, success: false, error: 'Nicht angemeldet', code: 'nicht_angemeldet' };

/** @param {{ sicher: boolean, url?: string, login: object, danach?: object }} f */
async function anmelden(f) {
  let angemeldet = false;
  const o = await openUi(
    {
      '/v1/auth/login': () => {
        angemeldet = true;
        return f.login;
      },
      ...(f.danach
        ? {
            '/v1/sets': () => (angemeldet ? f.danach : { success: true, sets: [], count: 0, total: 0, themes: [] }),
            '/v1/stats': () => (angemeldet ? f.danach : { success: true, stats: {} }),
          }
        : {}),
    },
    {
      angemeldet: false,
      url: f.url,
      vorher: w => Object.defineProperty(w, 'isSecureContext', { value: f.sicher }),
    },
  );
  await warte(() => typeof o.d.getElementById('btn-login')?.onclick === 'function');
  o.d.getElementById('lu').value = 'anna';
  o.d.getElementById('lp').value = 'richtig-richtig';
  o.d.getElementById('btn-login').click();
  await warte(() => angemeldet && !o.d.getElementById('login-hinweis').hidden);
  return o;
}

test('M1 login without a set session cookie', async t => {
  await t.test('server reports keks_fehlt: the app stays closed, hint instead of "expired"', async () => {
    const { w, d, aufrufe } = await anmelden({
      sicher: true,
      url: 'https://localhost/',
      login: { success: true, user: { id: 1, username: 'anna', is_admin: false }, keks_fehlt: true },
    });
    try {
      assert.match(text(d.getElementById('login-hinweis')), COOKIE_MISSING);
      assert.equal(d.getElementById('app').style.display, 'none', 'App geöffnet');
      assert.equal(d.getElementById('login-screen').style.display, 'flex');
      assert.equal(d.getElementById('lu').value, 'anna', 'Name bleibt stehen');
      assert.equal(d.getElementById('lp').value, '', 'Passwort bleibt nicht stehen');
      const nachher = aufrufe.slice(aufrufe.findIndex(a => a.url.includes('/v1/auth/login')));
      assert.equal(nachher.filter(a => a.url.includes('/v1/sets')).length, 0, 'Sammlung ohne Sitzung gefragt');
    } finally {
      w.close();
    }
  });
  await t.test('server confirms the cookie (keks_fehlt: false): a 401 means expired', async () => {
    const { w, d } = await anmelden({
      sicher: true,
      login: { success: true, user: { id: 1, username: 'anna', is_admin: false }, keks_fehlt: false },
      danach: WITHOUT_SESSION,
    });
    try {
      assert.match(text(d.getElementById('login-hinweis')), /Sitzung abgelaufen/);
    } finally {
      w.close();
    }
  });
  await t.test('older server without the information, http://localhost: the cookie hint anyway', async () => {
    const { w, d } = await anmelden({
      sicher: true,
      login: {
        $contractViolating: 'älterer Server ohne keks_fehlt',
        success: true,
        user: { id: 1, username: 'anna', is_admin: false },
      },
      danach: WITHOUT_SESSION,
    });
    try {
      assert.match(text(d.getElementById('login-hinweis')), COOKIE_MISSING);
    } finally {
      w.close();
    }
  });
});

test('N1 hint without HTTPS already on the login page', async t => {
  for (const [fall, url, sicher, sichtbar] of /** @type {[string, string, boolean, boolean][]} */ ([
    ['http://localhost', 'http://localhost/', true, true],
    ['http über eine IP (kein sicherer Kontext)', 'http://192.168.1.20/', false, true],
    ['https', 'https://brick.example.org/', true, false],
  ])) {
    await t.test(fall, async () => {
      const { w, d } = await openUi(
        {},
        { angemeldet: false, url, vorher: w => Object.defineProperty(w, 'isSecureContext', { value: sicher }) },
      );
      try {
        await warte(() => typeof d.getElementById('btn-login')?.onclick === 'function');
        const h = d.getElementById('login-ohne-https');
        assert.equal(!h.hidden, sichtbar);
        if (sichtbar) assert.match(text(h), /Verbindung unverschlüsselt/);
      } finally {
        w.close();
      }
    });
  }
});

test('N3 finance error: period, chips and search gone, back after success', async () => {
  let kaputt = true;
  const { w, d, ruhig } = await openUi({
    '/v1/finance/valuation': () =>
      kaputt
        ? { $status: 500, success: false, error: 'interner Fehler', code: 'interner_fehler' }
        : {
            success: true,
            currency: 'EUR',
            totals: { min: '650', avg: '700', max: '760' },
            sets: [{ set_number: '10294-1', name: 'Titanic', quantity: 1, purchase_price: 629, avg_price: 700 }],
          },
  });
  try {
    const tab = d.getElementById('tab-finance');
    await reiter(w, 'finance');
    await warte(() => d.querySelector('#portfolio-chart .fehler-zustand'));
    await ruhig();
    assert.equal(tab.classList.contains('finanzen-fehler'), true, 'im Fehlerfall');
    kaputt = false;
    d.querySelector('#portfolio-chart .fehler-zustand button[data-click]').click();
    await warte(() => d.querySelector('#fin-tbl table'));
    await ruhig();
    assert.equal(tab.classList.contains('finanzen-fehler'), false, 'nach Erfolg');
  } finally {
    w.close();
  }
});

test('N7 set image in the detail: a real button, operable with an image', async () => {
  const IMAGE = '/images/sets/10300-1.jpg';
  const { w, d } = await openUi({
    '/v1/sets': {
      success: true,
      total: 1,
      themes: [],
      sets: [{ set_number: '10300-1', name: 'Back to the Future', year: 2022, quantity: 1, image_local: IMAGE }],
    },
    '/v1/sets/10300-1': {
      success: true,
      set: { set_number: '10300-1', name: 'Back to the Future', year: 2022, quantity: 1, image_local: IMAGE },
    },
    '/v1/sets/10300-1/acquisitions': { success: true, acquisitions: [] },
  });
  try {
    const bild = d.getElementById('m-img');
    const knopf = bild.parentElement;
    assert.equal(knopf.tagName, 'BUTTON');
    assert.equal(knopf.getAttribute('aria-label'), 'Bild vergrössern');
    assert.equal(bild.getAttribute('alt'), '', 'das Bild trägt keinen zweiten Namen');
    assert.equal(knopf.disabled, true, 'ohne Bild gesperrt');
    await reiter(w, 'gallery');
    await warte(() => d.querySelector('#gallery [data-click="openModal"]'));
    d.querySelector('#gallery [data-click="openModal"]').click();
    await warte(() => /10300-1\.jpg/.test(bild.getAttribute('src') || ''));
    assert.equal(knopf.disabled, false, 'mit Bild bedienbar');
    assert.equal(knopf.hasAttribute('aria-hidden'), false);
    knopf.click();
    await warte(() => d.getElementById('lightbox-img').getAttribute('src'));
    assert.equal(d.getElementById('lightbox-img').getAttribute('src'), IMAGE);
  } finally {
    w.close();
  }
});
