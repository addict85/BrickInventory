/**
 * UX-Prüfung 27 am echten Bündel in jsdom: Anmeldung, wenn der Server das Sitzungs-Cookie nicht setzt (M1),
 * der Hinweis ohne HTTPS vorab (N1), der Fehlerzustand der Finanzen (N3) und das Set-Bild als Knopf (N7).
 *
 * Gegenproben (15.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  doLogin() ohne den Zweig d.keks_fehlt → rot: „M1 … Server meldet …“ (App geht auf und lädt ohne Sitzung)
 *   B  ohneHttps() nur mit isSecureContext (ohne location.protocol) → rot: „M1 … älterer Server …“
 *      („Sitzung abgelaufen“) und „N1 … http://localhost“ (Hinweis verborgen)
 *   C  Hinweis login-ohne-https nie eingeblendet → rot: „N1“ in beiden Fällen ohne HTTPS
 *   D  filterBedienbar() ohne die Klasse finanzen-fehler → rot: „N3 …“ (im Fehlerfall)
 *   E  zoomStand() ohne den Zweig für den Knopf → rot: „N7 …“ (Knopf bleibt mit Bild gesperrt)
 *   F  sitzungBeendet ohne !_keksGesetzt → rot: „M1 … Server bestätigt …“ (Cookie-Hinweis statt „abgelaufen“)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const COOKIE_FEHLT = /^Anmeldung erfolgreich, aber der Browser hat das Sitzungs-Cookie nicht gespeichert\./;
const OHNE_SITZUNG = { $status: 401, success: false, error: 'Nicht angemeldet', code: 'nicht_angemeldet' };

/** @param {{ sicher: boolean, url?: string, login: object, danach?: object }} f */
async function anmelden(f) {
  let angemeldet = false;
  const o = await oeffneOberflaeche(
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

test('M1 Anmeldung ohne gesetztes Sitzungs-Cookie', async t => {
  await t.test('Server meldet keks_fehlt: App bleibt zu, Hinweis statt „abgelaufen“', async () => {
    const { w, d, aufrufe } = await anmelden({
      sicher: true,
      url: 'https://localhost/',
      login: { success: true, user: { id: 1, username: 'anna', is_admin: false }, keks_fehlt: true },
    });
    try {
      assert.match(text(d.getElementById('login-hinweis')), COOKIE_FEHLT);
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
  await t.test('Server bestätigt das Cookie (keks_fehlt: false): ein 401 heisst abgelaufen', async () => {
    const { w, d } = await anmelden({
      sicher: true,
      login: { success: true, user: { id: 1, username: 'anna', is_admin: false }, keks_fehlt: false },
      danach: OHNE_SITZUNG,
    });
    try {
      assert.match(text(d.getElementById('login-hinweis')), /Sitzung abgelaufen/);
    } finally {
      w.close();
    }
  });
  await t.test('älterer Server ohne Angabe, http://localhost: trotzdem der Cookie-Hinweis', async () => {
    const { w, d } = await anmelden({
      sicher: true,
      login: {
        $vertragswidrig: 'älterer Server ohne keks_fehlt',
        success: true,
        user: { id: 1, username: 'anna', is_admin: false },
      },
      danach: OHNE_SITZUNG,
    });
    try {
      assert.match(text(d.getElementById('login-hinweis')), COOKIE_FEHLT);
    } finally {
      w.close();
    }
  });
});

test('N1 Hinweis ohne HTTPS schon auf der Anmeldeseite', async t => {
  for (const [fall, url, sicher, sichtbar] of /** @type {[string, string, boolean, boolean][]} */ ([
    ['http://localhost', 'http://localhost/', true, true],
    ['http über eine IP (kein sicherer Kontext)', 'http://192.168.1.20/', false, true],
    ['https', 'https://brick.example.org/', true, false],
  ])) {
    await t.test(fall, async () => {
      const { w, d } = await oeffneOberflaeche(
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

test('N3 Finanzen-Fehler: Zeitraum, Chips und Suche weg, nach Erfolg zurück', async () => {
  let kaputt = true;
  const { w, d, ruhig } = await oeffneOberflaeche({
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

test('N7 Set-Bild im Detail: ein echter Knopf, mit Bild bedienbar', async () => {
  const BILD = '/images/sets/10300-1.jpg';
  const { w, d } = await oeffneOberflaeche({
    '/v1/sets': {
      success: true,
      total: 1,
      themes: [],
      sets: [{ set_number: '10300-1', name: 'Back to the Future', year: 2022, quantity: 1, image_local: BILD }],
    },
    '/v1/sets/10300-1': {
      success: true,
      set: { set_number: '10300-1', name: 'Back to the Future', year: 2022, quantity: 1, image_local: BILD },
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
    assert.equal(d.getElementById('lightbox-img').getAttribute('src'), BILD);
  } finally {
    w.close();
  }
});
