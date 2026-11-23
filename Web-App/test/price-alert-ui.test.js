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
const { openUi, waitFor, tick, SIGNED_IN } = require('./helpers/ui');
const Q = require('./helpers/sources');

const SN = '10305-1';
const de = Q.loadTranslations().de;
// The same idle time as in the app (Alarmeingabe.RUHE_MS): both save while typing.
const REST = 800;

/** Open the set detail, like a click on the tile. */
async function detail(answers = {}) {
  const o = await openUi({
    [`/v2/sets/${SN}`]: {
      success: true,
      set: { set_number: SN, name: 'Burg', quantity: 1, conditions: ['N'], instructions: [] },
    },
    [`/v2/sets/${SN}/alert`]: (_u, opt) =>
      opt.method === 'PUT'
        ? {
            success: true,
            alert: {
              set_number: SN,
              condition: 'N',
              direction: 'below',
              threshold: 249,
              currency_code: 'EUR',
              triggered: true,
            },
          }
        : { success: true, alerts: [] },
    ...answers,
  });
  const button = o.d.createElement('button');
  Object.assign(button.dataset, { click: 'openModal', arg: SN });
  o.d.body.append(button);
  button.click();
  assert.ok(await waitFor(() => o.d.getElementById('m-alert-val'), 4000), 'no alert field in the set detail');
  await o.settle();
  return o;
}
const writing = o => o.calls.filter(a => /\/alert(\?|$)/.test(a.url) && a.method !== 'GET');
const tap = (o, value) => {
  const f = o.d.getElementById('m-alert-val');
  f.value = value;
  f.dispatchEvent(new o.w.Event('input', { bubbles: true }));
};

test("web app: saved while typing, debounced with the app's idle time", async () => {
  assert.ok(REST >= 300, `RUHE_MS of the app not found (${REST})`);
  const o = await detail();
  try {
    for (const w of ['2', '24', '249']) {
      tap(o, w);
      await tick(REST / 4);
    }
    await tick((REST * 3) / 4 - 120);
    assert.deepEqual(writing(o), [], 'saved before the quiet period was over');
    assert.ok(await waitFor(() => writing(o).length > 0, 400), "not saved within the app's quiet period");
    await tick(REST);
    const [put, ...more] = writing(o);
    assert.equal(more.length, 0, `${more.length + 1} write calls instead of one`);
    assert.equal(put.method, 'PUT');
    assert.deepEqual(JSON.parse(put.body), { direction: 'below', threshold: 249, condition: 'N' });
    assert.ok(
      await waitFor(() => o.d.getElementById('m-alert-state').textContent === de['detail.alert_fired']),
      `the marker shows „${o.d.getElementById('m-alert-state').textContent}“`,
    );
  } finally {
    o.w.close();
  }
});

test('web app: an empty field deletes, a condition change only loads', async () => {
  const o = await detail({
    [`/v2/sets/${SN}/alert`]: (_u, opt) =>
      opt.method === 'DELETE'
        ? { success: true }
        : {
            success: true,
            alerts: [
              {
                set_number: SN,
                condition: 'N',
                direction: 'above',
                threshold: 300,
                currency_code: 'EUR',
                triggered: false,
              },
            ],
          },
  });
  try {
    assert.equal(o.d.getElementById('m-alert-dir').value, 'above');
    const condition = o.d.getElementById('m-alert-cond');
    condition.value = 'U';
    condition.dispatchEvent(new o.w.Event('change', { bubbles: true }));
    await o.settle();
    assert.deepEqual(writing(o), [], 'a state change writes');
    condition.value = 'N';
    condition.dispatchEvent(new o.w.Event('change', { bubbles: true }));
    await o.settle();
    tap(o, '');
    assert.ok(await waitFor(() => writing(o).length === 1, REST + 1000), 'nothing deleted');
    assert.equal(writing(o)[0].method, 'DELETE');
    assert.match(writing(o)[0].url, /condition=N$/);
  } finally {
    o.w.close();
  }
});

test('web app: open alerts — the first visit only remembers, afterwards the notification as in the app', async () => {
  const NOW = '2026-11-10T08:00:00.123Z';
  const open = {
    success: true,
    now: NOW,
    alerts: [{ set_number: SN, direction: 'below', threshold: 200, last_price: 199.5, currency_code: 'CHF' }],
  };
  const messages = o => [...o.d.querySelectorAll('#toasts > *')].map(t => t.textContent.trim());
  const erst = await openUi({ '/v2/alerts/pending': open });
  try {
    await erst.settle();
    const fetching = erst.calls.filter(a => a.url.includes('/v2/alerts/pending'));
    assert.equal(fetching.length, 1, 'not asked on opening');
    assert.doesNotMatch(fetching[0].url, /since=/);
    assert.deepEqual(
      messages(erst).filter(m => m.includes(SN)),
      [],
      'reported on the first visit',
    );
    assert.equal(
      erst.w.localStorage.getItem(`bim_alert_seen_${SIGNED_IN['/v2/auth/me'].user.id}`),
      NOW,
      "not the server's marker",
    );
  } finally {
    erst.w.close();
  }
  const then = await openUi(
    { '/v2/alerts/pending': open },
    {
      before: w => w.localStorage.setItem(`bim_alert_seen_${SIGNED_IN['/v2/auth/me'].user.id}`, '2026-11-09T08:00:00Z'),
    },
  );
  try {
    await then.settle();
    assert.ok(then.calls.some(a => a.url.includes('/v2/alerts/pending?since=2026-11-09T08%3A00%3A00Z')));
    assert.ok(await waitFor(() => messages(then).some(m => m.includes(SN))), 'no message');
    // Currency of the alert, two decimals, amount as a currency amount of the language („199,50 CHF“),
    // like Alarmabholung.text() of the app.
    const money = v => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'CHF' }).format(v);
    assert.ok(
      messages(then).includes(`${SN}: ${money(199.5)} (${de['detail.alert_below']} ${money(200)})`),
      messages(then).join(' | '),
    );
  } finally {
    then.w.close();
  }
});
