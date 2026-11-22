/**
 * Price alert in the web app. It runs in the real bundle (jsdom), with the same
 * idle time as the app (800 ms). Whether the message comes at the
 * right time and is separated per account is checked by
 * price-alert-db.test.js against real data.
 *
 * Counter-checks (measured 10.11.2026, each on its own, bundle rebuilt), in
 * public/js/detail-fields.js:
 *   A  ALERT_REST 800 → 300 → red: “web app: saved while typing …” (PUT before the idle time)
 *   B  in alertTyped the idle time not reset (no clearTimeout) →
 *      red: same place (three PUTs instead of one)
 *   C  in sendAlert `const loeschen = number == null` → `false` → red: “web app:
 *      an empty field …”
 *   D  toggleAlertState calls saveAlert → red: same place (condition change writes)
 *   E  `if (!brand) return;` removed in showOpenAlerts → red: “web app: open
 *      alerts …” (message on the first visit)
 *   F  there the marker from Date.now() instead of d.now → red: same place
 *   I  (12.11.2026) there the amounts again with toFixed(2) and the code in front →
 *      red: same place („CHF 199.50“ instead of „199,50 CHF“)
 *   G  in showAlertMarker alert_fired/alert_armed swapped → red: “web app: saved while typing …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte, takt, ANMELDUNG } = require('./helpers/ui');
const Q = require('./helpers/sources');

const SN = '10305-1';
const de = Q.loadTranslations().de;
// The same idle time as in the app (Alarmeingabe.RUHE_MS): both save while typing.
const REST = 800;

/** Open the set detail, like a click on the tile. */
async function detail(antworten = {}) {
  const o = await openUi({
    [`/v1/sets/${SN}`]: {
      success: true,
      set: { set_number: SN, name: 'Burg', quantity: 1, conditions: ['N'], instructions: [] },
    },
    [`/v1/sets/${SN}/alert`]: (_u, opt) =>
      opt.method === 'PUT'
        ? {
            success: true,
            alert: {
              set_number: SN,
              condition: 'N',
              direction: 'unter',
              threshold: 249,
              currency_code: 'EUR',
              triggered: true,
            },
          }
        : { success: true, alerts: [] },
    ...antworten,
  });
  const knopf = o.d.createElement('button');
  Object.assign(knopf.dataset, { click: 'openModal', arg: SN });
  o.d.body.append(knopf);
  knopf.click();
  assert.ok(await warte(() => o.d.getElementById('m-alert-val'), 4000), 'kein Alarmfeld im Set-Detail');
  await o.ruhig();
  return o;
}
const schreibend = o => o.aufrufe.filter(a => /\/alert(\?|$)/.test(a.url) && a.method !== 'GET');
const tap = (o, wert) => {
  const f = o.d.getElementById('m-alert-val');
  f.value = wert;
  f.dispatchEvent(new o.w.Event('input', { bubbles: true }));
};

test("web app: saved while typing, debounced with the app's idle time", async () => {
  assert.ok(REST >= 300, `RUHE_MS der App nicht gefunden (${REST})`);
  const o = await detail();
  try {
    for (const w of ['2', '24', '249']) {
      tap(o, w);
      await takt(REST / 4);
    }
    await takt((REST * 3) / 4 - 120);
    assert.deepEqual(schreibend(o), [], 'gespeichert, bevor die Ruhezeit um war');
    assert.ok(await warte(() => schreibend(o).length > 0, 400), 'nicht in der Ruhezeit der App gespeichert');
    await takt(REST);
    const [put, ...mehr] = schreibend(o);
    assert.equal(mehr.length, 0, `${mehr.length + 1} Schreibaufrufe statt einem`);
    assert.equal(put.method, 'PUT');
    assert.deepEqual(JSON.parse(put.body), { direction: 'unter', threshold: 249, condition: 'N' });
    assert.ok(
      await warte(() => o.d.getElementById('m-alert-state').textContent === de['detail.alert_fired']),
      `der Merker zeigt „${o.d.getElementById('m-alert-state').textContent}“`,
    );
  } finally {
    o.w.close();
  }
});

test('web app: an empty field deletes, a condition change only loads', async () => {
  const o = await detail({
    [`/v1/sets/${SN}/alert`]: (_u, opt) =>
      opt.method === 'DELETE'
        ? { success: true }
        : {
            success: true,
            alerts: [
              {
                set_number: SN,
                condition: 'N',
                direction: 'ueber',
                threshold: 300,
                currency_code: 'EUR',
                triggered: false,
              },
            ],
          },
  });
  try {
    assert.equal(o.d.getElementById('m-alert-dir').value, 'ueber');
    const zustand = o.d.getElementById('m-alert-cond');
    zustand.value = 'U';
    zustand.dispatchEvent(new o.w.Event('change', { bubbles: true }));
    await o.ruhig();
    assert.deepEqual(schreibend(o), [], 'ein Zustandswechsel schreibt');
    zustand.value = 'N';
    zustand.dispatchEvent(new o.w.Event('change', { bubbles: true }));
    await o.ruhig();
    tap(o, '');
    assert.ok(await warte(() => schreibend(o).length === 1, REST + 1000), 'nichts gelöscht');
    assert.equal(schreibend(o)[0].method, 'DELETE');
    assert.match(schreibend(o)[0].url, /condition=N$/);
  } finally {
    o.w.close();
  }
});

test('web app: open alerts — the first visit only remembers, afterwards the notification as in the app', async () => {
  const JETZT = '2026-11-10T08:00:00.123Z';
  const offen = {
    success: true,
    now: JETZT,
    alerts: [{ set_number: SN, direction: 'unter', threshold: 200, last_price: 199.5, currency_code: 'CHF' }],
  };
  const meldungen = o => [...o.d.querySelectorAll('#toasts > *')].map(t => t.textContent.trim());
  const erst = await openUi({ '/v1/alerts/pending': offen });
  try {
    await erst.ruhig();
    const abruf = erst.aufrufe.filter(a => a.url.includes('/v1/alerts/pending'));
    assert.equal(abruf.length, 1, 'beim Öffnen nicht nachgefragt');
    assert.doesNotMatch(abruf[0].url, /since=/);
    assert.deepEqual(
      meldungen(erst).filter(m => m.includes(SN)),
      [],
      'beim ersten Besuch gemeldet',
    );
    assert.equal(
      erst.w.localStorage.getItem(`bim_alert_seen_${ANMELDUNG['/v1/auth/me'].user.id}`),
      JETZT,
      'nicht die Marke des Servers',
    );
  } finally {
    erst.w.close();
  }
  const dann = await openUi(
    { '/v1/alerts/pending': offen },
    {
      before: w => w.localStorage.setItem(`bim_alert_seen_${ANMELDUNG['/v1/auth/me'].user.id}`, '2026-11-09T08:00:00Z'),
    },
  );
  try {
    await dann.ruhig();
    assert.ok(dann.aufrufe.some(a => a.url.includes('/v1/alerts/pending?since=2026-11-09T08%3A00%3A00Z')));
    assert.ok(await warte(() => meldungen(dann).some(m => m.includes(SN))), 'keine Meldung');
    // Currency of the alert, two decimals, amount as a currency amount of the language („199,50 CHF“),
    // like Alarmabholung.text() of the app.
    const geld = v => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'CHF' }).format(v);
    assert.ok(
      meldungen(dann).includes(`${SN}: ${geld(199.5)} (${de['detail.alert_below']} ${geld(200)})`),
      meldungen(dann).join(' | '),
    );
  } finally {
    dann.w.close();
  }
});
