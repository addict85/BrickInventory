/**
 * Numbers, axes and intermediate states — on the real bundle in jsdom.
 *
 * Counter-checks (measured on 29.10.2026):
 *   A  fmtBig again with “k” → red: “key figures without k” (“1.3k”)
 *   B  in portfolioChartSVG again px(i) by index → red: “time axis”
 *      (spacing of a day equal to spacing of a month); niceSplit replaced by five equal
 *      parts → red: “1-2-5” (4'219 …)
 *   C  VALUE_SKELETON not set in loadFinance → red: “placeholder while
 *      loading” (“—”)
 *   D  reconcilePartsEmpty again with `_manualEmpty ? 'none' : ''` → red:
 *      “no empty box”
 *   E  the check `!u.email` removed in loadProfile → red: “without e-mail”
 *   F  the check for the open wizard removed in showRbHint
 *      → red: “no hint above the wizard” (measured again 02.11.2026)
 *   G  applyTheme() removed in setOwnTheme → red: “own design”
 *      (data-theme stayed classic)
 *   H  (04.11.2026) in loadProfile the hint on new_email removed → red:
 *      “pending address” (the hint stayed empty)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, sicht, warte, takt } = require('./helpers/ui');

test('metrics without k: 1300 parts are shown as the full number', async () => {
  const { w, d } = await openUi({
    '/v1/stats': {
      success: true,
      stats: { total_sets: 14, total_parts: 1300, total_minifigs: 19, total_instructions: 0 },
    },
  });
  try {
    await warte(() => d.getElementById('bstat-parts').textContent !== '—');
    const text = d.getElementById('bstat-parts').textContent;
    assert.doesNotMatch(text, /k$/i);
    assert.match(text, /^1.300$/);
  } finally {
    w.close();
  }
});

/** Twelve months, with a single day in between — as period=max delivers them. */
const HISTORY = (() => {
  const tage = [
    '2025-10-29',
    '2025-11-29',
    '2025-12-29',
    '2026-01-29',
    '2026-02-28',
    '2026-03-29',
    '2026-04-29',
    '2026-05-29',
    '2026-06-29',
    '2026-07-29',
    '2026-08-29',
    '2026-09-29',
    '2026-10-28',
    '2026-10-29',
  ];
  const werte = tage.map((_, i) => 4219 + i * 63.7);
  return {
    success: true,
    currency: 'EUR',
    messpunkte: tage.length,
    period_change_pct: 15,
    points: werte.map((value, i) => ({ x_label: i % 3 ? '' : 'x', value, y_frac: 0.5 })),
    y_axis: [],
    chart: {
      x: tage,
      values: [{ name: 'total', firstRealIndex: 0, values: tage.map((x, i) => ({ x, y: werte[i] })) }],
    },
  };
})();

test('value chart: division by 1-2-5, real time axis, month names', async () => {
  const { w, d } = await openUi({
    '/v1/finance/portfolio-history': HISTORY,
    '/v1/finance/pnl': { success: true, currency: 'EUR', sets: [], totals: { grand_total: String(4219 + 13 * 63.7) } },
  });
  try {
    await reiter(w, 'finance');
    await warte(() => d.querySelector('#portfolio-chart svg'));
    const svg = d.querySelector('#portfolio-chart svg');
    const texte = [...svg.querySelectorAll('text')];
    const y = texte
      .filter(x => x.getAttribute('text-anchor') === 'end' && +x.getAttribute('x') < 80)
      .map(x => Number(x.textContent.replace(/\D/g, '')));
    assert.ok(y.length >= 3, `nur ${y.length} Werte an der Achse`);
    const schritt = y[1] - y[0];
    assert.ok(
      y.every((v, i) => i === 0 || v - y[i - 1] === schritt),
      `ungleiche Schritte: ${y}`,
    );
    assert.match(String(schritt), /^[125]0*$/, `Schritt ${schritt} ist nicht 1, 2 oder 5 mal 10^k`);
    assert.ok(
      y.every(v => v % schritt === 0),
      `krumme Werte: ${y}`,
    );
    const x = texte.filter(t => +t.getAttribute('y') > 160).map(t => t.textContent);
    assert.ok(x.length >= 3, `nur ${x.length} Beschriftungen an der Zeitachse`);
    // Whole year: “Juli 26” also read as 26 July.
    assert.ok(
      x.every(t => /^[A-Za-zäÄ]{3,5}\.? \d{4}$/.test(t)),
      `uneinheitlich: ${x.join(' | ')}`,
    );
    // Between the last two points lies a day, before that a month.
    const cx = JSON.parse(svg.dataset.punkte).map(p => p.x);
    const tag = cx[13] - cx[12],
      monat = cx[12] - cx[11];
    assert.ok(monat > 10 * tag, `Zeitachse: ein Tag ${tag.toFixed(1)}, ein Monat ${monat.toFixed(1)}`);
  } finally {
    w.close();
  }
});

test('finances: placeholder while loading instead of "—"', async () => {
  let freigeben;
  const spaeter = new Promise(r => {
    freigeben = r;
  });
  const { w, d } = await openUi({
    '/v1/finance/valuation': () =>
      spaeter.then(() => ({
        success: true,
        currency: 'EUR',
        sets: [],
        totals: { min: '0', avg: '0', max: '0', qty_avg: '0' },
      })),
  });
  try {
    await reiter(w, 'finance');
    await takt(30);
    assert.equal(d.getElementById('fin-sum').getAttribute('aria-busy'), 'true');
    assert.ok(
      d.querySelector('#fin-einstand .skelett-wert'),
      `Einstand: „${d.getElementById('fin-einstand').textContent}“`,
    );
    assert.ok(d.querySelector('#fin-wert .skelett-wert'), 'Gesamtwert ohne Platzhalter');
    freigeben();
    await warte(() => !d.getElementById('fin-sum').hasAttribute('aria-busy'));
    assert.equal(d.querySelector('#fin-sum .skelett-wert'), null, 'der Platzhalter bleibt stehen');
  } finally {
    w.close();
  }
});

test('parts: while they load, no empty box "manually captured parts"', async () => {
  let freigeben;
  const spaeter = new Promise(r => {
    freigeben = r;
  });
  const { w, d } = await openUi({
    '/v1/parts/manual': () =>
      spaeter.then(() => ({
        success: true,
        parts: [{ part_number: '3001', part_name: 'Brick 2 x 4', color_name: 'Red', color_id: 4, quantity: 3 }],
      })),
  });
  try {
    await reiter(w, 'parts');
    await takt(30);
    const box = d.getElementById('manual-parts-box');
    assert.equal(box.style.display, 'none', 'die leere Box steht beim Laden da');
    freigeben();
    await warte(() => box.style.display !== 'none');
    assert.equal(box.style.display, '', 'mit manuellen Teilen erscheint die Box nicht');
  } finally {
    w.close();
  }
});

test('account: without email it does not say "verified"', async () => {
  const { w, d } = await openUi({
    '/v1/auth/profile': {
      success: true,
      user: { username: 'anna', email: '', email_verified: true, first_name: '', last_name: '' },
    },
  });
  try {
    await sicht(w, 'profil');
    await warte(() => d.getElementById('prof-user').value === 'anna');
    assert.equal(d.getElementById('prof-email-verified').textContent.trim(), '');
  } finally {
    w.close();
  }
});

test('account: a pending address stands below the field, the valid one in the field', async () => {
  const { w, d } = await openUi({
    '/v1/auth/profile': {
      success: true,
      user: {
        username: 'anna',
        email: 'alt@example.org',
        email_verified: true,
        new_email: 'neu@example.org',
        first_name: '',
        last_name: '',
      },
    },
  });
  try {
    await sicht(w, 'profil');
    await warte(() => d.getElementById('prof-user').value === 'anna');
    assert.equal(d.getElementById('prof-email').value, 'alt@example.org');
    assert.match(d.getElementById('prof-email-hint').textContent, /^Ausstehend: neu@example\.org\. Sie gilt erst/);
  } finally {
    w.close();
  }
});

test('no hint about the Rebrickable key above the setup wizard', async () => {
  const { w, d, ruhig } = await openUi({
    '/v1/settings/raw': { success: true, settings: { currency: 'EUR', language: 'de', rebrickable_api_key: '' } },
    '/v1/settings/einrichtung': {
      success: true,
      offen: true,
      passwort_aendern: false,
      quellen: { rebrickable: false },
    },
  });
  try {
    await warte(() => d.getElementById('einrichtung-modal').classList.contains('open'));
    await ruhig();
    assert.ok(d.getElementById('einrichtung-modal').classList.contains('open'), 'der Assistent ist zu');
    const hinweise = [...d.querySelectorAll('#toasts .toast')]
      .map(t => t.textContent)
      .filter(t => /Rebrickable/.test(t));
    assert.deepEqual(hinweise, []);
    assert.equal(d.getElementById('rb-hinweis').hidden, true, 'Hinweisband über dem Assistenten');
  } finally {
    w.close();
  }
});

test("account: own theme or the admin's default", async () => {
  const aufrufe = [];
  let eigenes = null;
  const { w, d } = await openUi({
    '/v1/auth/profile': { success: true, user: { username: 'anna', email: 'anna@example.org', email_verified: true } },
    '/v1/settings/theme': () => ({ success: true, theme: eigenes || 'noppe', vorgabe: 'noppe', eigenes }),
    '/v1/settings/user/theme': (_url, o) => {
      aufrufe.push(JSON.parse(o.body));
      eigenes = JSON.parse(o.body).theme || null;
      return { success: true, theme: eigenes || 'noppe', vorgabe: 'noppe', eigenes };
    },
  });
  try {
    // The boot script stands in the <head>, which the helper does not execute; it provides applyTheme.
    w.eval(
      require('node:fs').readFileSync(
        require('node:path').join(__dirname, '..', 'public', 'js', 'theme-boot.js'),
        'utf8',
      ),
    );
    await sicht(w, 'profil');
    const sel = d.getElementById('design-wahl');
    await warte(() => /Noppe/.test(sel.options[0].textContent));
    assert.equal(sel.options[0].textContent, 'Vorgabe: Noppe (poppig)');
    assert.equal(sel.value, '');
    sel.value = 'werkbank';
    sel.dispatchEvent(new w.Event('change', { bubbles: true }));
    await warte(() => d.documentElement.getAttribute('data-theme') === 'werkbank');
    assert.deepEqual(aufrufe, [{ theme: 'werkbank' }]);
    assert.equal(d.documentElement.getAttribute('data-theme'), 'werkbank', 'eigenes Design nicht angewendet');
    sel.value = '';
    sel.dispatchEvent(new w.Event('change', { bubbles: true }));
    await warte(() => d.documentElement.getAttribute('data-theme') === 'noppe');
    assert.deepEqual(aufrufe.at(-1), { theme: '' });
  } finally {
    w.close();
  }
});
