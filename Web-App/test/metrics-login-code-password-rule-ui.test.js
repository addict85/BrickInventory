/**
 * UX-Prüfung 28 am echten Bündel in jsdom: Ein- und Mehrzahl der Kennzahlen und ihr Erklärsatz (M1), der leere
 * Code im zweiten Anmeldeschritt (M2), alle Feldfehler der Passwortregel auf einmal (N6), keine doppelten
 * Summen in den Finanzen (N7) und der Hinweis ohne HTTPS in Nutzersprache (N10).
 *
 * Gegenproben (15.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  kennzahl() schreibt nur die Zahl (Etikett bleibt „Sets“) → rot: „M1 ein Set …“ („Set“ ≠ „Sets“)
 *   B  #bstat-hinweis nicht gefüllt → rot: „M1 ein Set …“ (Erklärsatz fehlt unter der Leiste)
 *   C  lc nicht in die Pflichtprüfung von doLogin → rot: „M2 …“ (zweite Anfrage geschickt, kein Feldfehler)
 *   D  lc-status nicht gesetzt → rot: „M2 …“ (Satz „Passwort stimmt …“ fehlt)
 *   E  btn-sav-pw wieder mit return nach dem Fehler am ersten Feld → rot: „N6 …“ (Wiederholung ohne Meldung)
 *   F  summenTabelle wieder mit Bereichszeilen im tbody → rot: „N7 …“ („Bereichssummen doppelt“)
 *   G  auth.ohne_https wieder mit COOKIE_SECURE=0 → rot: „N10 …“ (Betreiberhinweis vorab)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, ANMELDUNG, reiter, sicht, warte, takt } = require('./helpers/ui');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
/** @param {Document} d */
const labels = d =>
  ['bstat-sets', 'bstat-parts', 'bstat-minifigs', 'bstat-instr'].map(id =>
    text(d.getElementById(id)?.parentElement?.querySelector('.bstat-l')),
  );
/** @param {Record<string, number>} s */
const stats = s => ({
  '/v1/stats': {
    success: true,
    stats: { ...ANMELDUNG['/v1/stats'].stats, ...s },
  },
});

test('M1 a set without a parts list: singular, explanation below the bar', async () => {
  const { w, d } = await openUi(
    stats({ total_sets: 1, total_quantity: 1, total_parts: 0, total_minifigs: 1, total_instructions: 1 }),
  );
  try {
    await warte(() => text(d.getElementById('bstat-sets')) === '1');
    assert.deepEqual(labels(d), ['Set', 'Teile', 'Minifigur', 'Anleitung']);
    assert.equal(text(d.getElementById('bstat-hinweis')), 'Teileliste für das Set fehlt noch');
    assert.equal(d.querySelector('.bstat-erklaert'), null, 'die Kennzahl selbst wird nicht mehr umgebaut');
  } finally {
    w.close();
  }
});

test('M1 several sets with parts: plural, no explanation', async () => {
  const { w, d } = await openUi(
    stats({ total_sets: 3, total_quantity: 4, total_parts: 120, set_parts: 120, total_minifigs: 2 }),
  );
  try {
    await warte(() => text(d.getElementById('bstat-sets')) === '4');
    assert.deepEqual(labels(d), ['Sets', 'Teile', 'Minifiguren', 'Anleitungen']);
    assert.equal(text(d.getElementById('bstat-hinweis')), '');
  } finally {
    w.close();
  }
});

test('M2 empty code in the second step: message at the field, no second request', async () => {
  const { w, d, aufrufe } = await openUi(
    {
      '/v1/auth/login': {
        $status: 401,
        success: false,
        error: 'Code aus der Authenticator-App nötig',
        code: 'zweiter_faktor_noetig',
        zweiter_faktor: true,
      },
    },
    { angemeldet: false },
  );
  try {
    await warte(() => typeof d.getElementById('btn-login')?.onclick === 'function');
    const logins = () => aufrufe.filter(a => a.url.includes('/v1/auth/login')).length;
    d.getElementById('lu').value = 'anna';
    d.getElementById('lp').value = 'richtig-Passwort-1';
    d.getElementById('btn-login').click();
    await warte(() => d.getElementById('lc-zeile').style.display === '');
    assert.equal(logins(), 1);
    const status = d.getElementById('lc-status');
    assert.equal(status.getAttribute('role'), 'status');
    assert.equal(text(status), 'Passwort stimmt – jetzt den Code eingeben.');
    assert.match(d.getElementById('lc').getAttribute('aria-describedby') || '', /\blc-status\b/);
    assert.equal(text(d.getElementById('lerr')), '', 'ohne Code noch keine Sammelmeldung');

    d.getElementById('btn-login').click();
    await takt(50);
    assert.equal(logins(), 1, 'leerer Code ging an den Server');
    assert.equal(text(d.getElementById('lc-fehler')), 'Bitte Code eingeben.');
    assert.equal(d.getElementById('lc').getAttribute('aria-invalid'), 'true');
    assert.equal(d.activeElement?.id, 'lc');

    // Mit Code geht die Anfrage, und die Feldmeldung verschwindet beim Tippen.
    const lc = d.getElementById('lc');
    lc.value = '123456';
    lc.dispatchEvent(new w.Event('input', { bubbles: true }));
    assert.equal(text(d.getElementById('lc-fehler')), '');
    d.getElementById('btn-login').click();
    await warte(() => logins() === 2);
    assert.equal(JSON.parse(aufrufe.filter(a => a.url.includes('/v1/auth/login'))[1].body).code, '123456');
  } finally {
    w.close();
  }
});

test('M2 first step without a code field: the code is not required', async () => {
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
    d.getElementById('lu').value = 'anna';
    d.getElementById('lp').value = 'falsch';
    d.getElementById('btn-login').click();
    await warte(() => text(d.getElementById('lerr')));
    assert.equal(aufrufe.filter(a => a.url.includes('/v1/auth/login')).length, 1);
    assert.equal(text(d.getElementById('lc-fehler')), '');
  } finally {
    w.close();
  }
});

test('N6 change password: length and repetition reported at once', async () => {
  const { w, d, aufrufe } = await openUi({
    '/v1/auth/profile': { success: true, user: { username: 'anna', email: 'anna@example.org', email_verified: true } },
  });
  try {
    await sicht(w, 'profil');
    d.getElementById('pw-n').value = 'kurz';
    d.getElementById('pw-r').value = 'anders';
    d.getElementById('btn-sav-pw').click();
    await takt(30);
    assert.match(text(d.getElementById('pw-n-fehler')), /mindestens \d+ Zeichen/);
    assert.equal(text(d.getElementById('pw-r-fehler')), 'Passwörter stimmen nicht überein');
    assert.equal(d.activeElement?.id, 'pw-n');
    assert.equal(d.getElementById('confirm-modal').style.display === 'flex', false, 'Rückfrage trotz Fehler');
    assert.equal(aufrufe.filter(a => a.url.endsWith('/v1/auth/change-password')).length, 0);

    // Nur die Wiederholung falsch: nur dort eine Meldung, die alte am ersten Feld ist weg.
    d.getElementById('pw-n').value = 'lang-genug-Passwort-1';
    d.getElementById('btn-sav-pw').click();
    await takt(30);
    assert.equal(text(d.getElementById('pw-n-fehler')), '');
    assert.equal(text(d.getElementById('pw-r-fehler')), 'Passwörter stimmen nicht überein');
    assert.equal(d.activeElement?.id, 'pw-r');
  } finally {
    w.close();
  }
});

test('N7 finances: sum per area below the area, at the bottom only the grand total', async () => {
  const { w, d } = await openUi({
    '/v1/finance/valuation': {
      success: true,
      currency: 'EUR',
      totals: { min: '650', avg: '700', max: '760' },
      sets: [
        {
          set_number: '10294-1',
          name: 'Titanic',
          quantity: 1,
          purchase_price: 629,
          avg_price: 700,
          total_avg: '700',
          wert_gesamt: 700,
          acquisitions: [{ id: 1, condition: 'N', quantity: 1, purchase_price: 629, avg_price: 700, wert_gesamt: 700 }],
        },
      ],
    },
    '/v1/finance/parts-valuation': {
      success: true,
      currency: 'EUR',
      total_value: '0',
      parts: [
        {
          part_number: '3001',
          part_name: 'Brick 2 x 4',
          color_name: 'Red',
          quantity: 7,
          purchase_price: 9.99,
          avg_price: 0,
          acquisitions: [{ id: 3, condition: 'U', quantity: 7, purchase_price: 9.99 }],
        },
      ],
    },
  });
  try {
    await reiter(w, 'finance');
    await warte(() => d.querySelector('#fin-tbl .dt-summe tfoot'));
    assert.equal(d.querySelectorAll('#fin-tbl .dt-summe tbody tr').length, 0, 'Bereichssummen doppelt');
    assert.match(text(d.querySelector('#fin-tbl .dt-summe tfoot')), /^Gesamt/);
    assert.ok(d.querySelector('[data-fin-art="sets"] tfoot'), 'Summe unter den Sets fehlt');
    assert.ok(d.querySelector('[data-fin-art="parts"] tfoot'), 'Summe unter den Teilen fehlt');
  } finally {
    w.close();
  }
});

test('N10 without HTTPS: up front only "unencrypted", the operator hint only with a missing cookie', async () => {
  const { w, d } = await openUi(
    {
      '/v1/auth/login': {
        success: true,
        user: { id: 1, username: 'anna', is_admin: false },
        keks_fehlt: true,
      },
    },
    { angemeldet: false, url: 'http://192.168.1.20/' },
  );
  try {
    await warte(() => typeof d.getElementById('btn-login')?.onclick === 'function');
    const upfront = d.getElementById('login-ohne-https');
    assert.equal(upfront.hidden, false);
    assert.equal(text(upfront), 'Verbindung unverschlüsselt: Passwort und Sitzung gehen ungeschützt durchs Netz.');
    assert.doesNotMatch(text(d.getElementById('login-screen')), /COOKIE_SECURE/);
    d.getElementById('lu').value = 'anna';
    d.getElementById('lp').value = 'richtig-Passwort-1';
    d.getElementById('btn-login').click();
    await warte(() => !d.getElementById('login-hinweis').hidden);
    assert.match(text(d.getElementById('login-hinweis')), /COOKIE_SECURE=0/);
  } finally {
    w.close();
  }
});
