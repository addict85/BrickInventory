/**
 * UX-Prüfung 26 am echten Bündel in jsdom: Kaufpreis-Kachel beim Laden (N1), Fehlerzustand der Finanzen (N2),
 * Stückpreis der manuellen Teile und Figuren (N3), leere Anmeldefelder (N4), Sprungleiste im Konto (N5) und die
 * Anmeldung ohne gespeichertes Sitzungs-Cookie (Betrieb).
 *
 * Gegenproben (15.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  index.html wieder „Kaufpreis gesamt“ / „Summe der Kaufpreise“ → rot: „N1 …“ (vor dem ersten Laden)
 *   B  finanzenFehlen() ohne titel → rot: „N2 …“ (Die Liste konnte nicht geladen werden); ohne
 *      filterBedienbar(false) → rot: ebenda (Chip „Sets“ bedienbar); ohne filterBedienbar(true) → rot: ebenda
 *      (nach „Erneut versuchen“ gesperrt)
 *   C  parts.js wieder fmtN() ohne „je“ → rot: „N3 …“ (Teil „0,12 €“); minifigs.js ebenso → rot: ebenda (Figur)
 *   D  doLogin() ohne die Prüfung der Pflichtfelder → rot: „N4 …“ (alle drei Teilfälle); fehlerPlatzieren()
 *      ohne .geheim-feld → rot: „beide leer“ (Meldung zwischen Passwortfeld und Augen-Knopf)
 *   E  kontoSprung() ohne focus() → rot: „N5 …“ (Fokus bleibt auf dem Link)
 *   F  sitzungBeendet ohne den Zweig ohneKeks → rot: „Betrieb …“ (Sitzung abgelaufen); mit isSecureContext
 *      true zeigt derselbe Ablauf „Sitzung abgelaufen“ (zweiter Teilfall, Gegenstück)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, sicht, warte, takt } = require('./helpers/oberflaeche');

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
const BEWERTUNG = {
  success: true,
  currency: 'EUR',
  totals: { min: '650', avg: '700', max: '760' },
  sets: [SET],
};
// Nur ein Teil der Positionen bewertet: Die Kachel heisst dann „Kaufpreis (bewertete Positionen)“.
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

test('N1 Kaufpreis-Kachel: beim Laden neutral, der Zusatz erst mit Daten', async () => {
  /** @type {null | ((v: unknown) => void)} */
  let freigeben = null;
  let anhalten = false;
  const { w, d, ruhig } = await oeffneOberflaeche({
    '/v1/finance/valuation': () => (anhalten ? new Promise(r => (freigeben = () => r(BEWERTUNG))) : BEWERTUNG),
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

test('N2 Finanzen-Fehler: eigener Titel, Chips und Suche gesperrt, nach Erfolg frei', async () => {
  let kaputt = true;
  const { w, d, ruhig } = await oeffneOberflaeche({
    '/v1/finance/valuation': () =>
      kaputt ? { $status: 500, success: false, error: 'interner Fehler', code: 'interner_fehler' } : { ...BEWERTUNG },
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

test('N3 Manuell erfasste Teile und Figuren: Stückpreis mit „je“', async () => {
  const { w, d, ruhig } = await oeffneOberflaeche({
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

test('N4 Anmeldung: leere Pflichtfelder melden sich am Feld', async t => {
  const { w, d, aufrufe } = await oeffneOberflaeche(
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
    await t.test('beide leer', async () => {
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
      // Die Meldung steht unter dem Passwortfeld, nicht zwischen Feld und Augen-Knopf.
      assert.equal(d.getElementById('lp-fehler').parentElement.classList.contains('geheim-feld'), false);
    });
    await t.test('nur das Passwort leer', async () => {
      d.getElementById('lu').value = 'anna';
      d.getElementById('btn-login').click();
      await takt(30);
      assert.equal(logins(), 0);
      assert.equal(d.getElementById('lu-fehler').hidden, true);
      assert.equal(d.getElementById('lu').hasAttribute('aria-invalid'), false);
      assert.equal(d.activeElement.id, 'lp');
    });
    await t.test('falsche Anmeldedaten bleiben oben', async () => {
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

test('N5 Konto: Sprungleiste zu allen Abschnitten', async () => {
  const { w, d } = await oeffneOberflaeche();
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

/** Anmelden; danach antwortet die Sammlung mit 401 wie ohne Cookie. */
async function anmeldenOhneKeks(sicher) {
  let angemeldet = false;
  const ohneSitzung = { $status: 401, success: false, error: 'Nicht angemeldet', code: 'nicht_angemeldet' };
  const o = await oeffneOberflaeche(
    {
      '/v1/auth/login': () => {
        angemeldet = true;
        return { success: true, user: { id: 1, username: 'anna', is_admin: false } };
      },
      '/v1/sets': () => (angemeldet ? ohneSitzung : { success: true, sets: [], count: 0, total: 0, themes: [] }),
      '/v1/stats': () => (angemeldet ? ohneSitzung : { success: true, stats: {} }),
    },
    {
      angemeldet: false,
      vorher: w => Object.defineProperty(w, 'isSecureContext', { value: sicher }),
      // Seit Runde 27 zählt auch http: allein als „ohne HTTPS“; die sichere Seite ist also https.
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

test('Betrieb: Anmeldung ohne gespeichertes Sitzungs-Cookie', async t => {
  await t.test('Seite ohne HTTPS: klarer Hinweis statt „abgelaufen“', async () => {
    const { w, d } = await anmeldenOhneKeks(false);
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
  await t.test('sichere Seite: wie bisher „Sitzung abgelaufen“', async () => {
    const { w, d } = await anmeldenOhneKeks(true);
    try {
      assert.match(text(d.getElementById('login-hinweis')), /Sitzung abgelaufen/);
    } finally {
      w.close();
    }
  });
});
