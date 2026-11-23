/**
 * UX check 21 in real Chrome, in the household (patternHousehold): session question without an answer (M1), queries of the
 * background jobs (M1), ResizeObserver at 200 % font (M2), calculation basis of the finances (N1), clearing without
 * a number (N2), reloading after an error (N3), theme immediately (N4), creating users (N5), wishlist item detail (N6, N11),
 * reference line in the chart (N7), job roles (N9), locked period buttons without a connection (N11).
 *
 * Counter-checks (measured 13.11.2026 in three runs, at most one change per check, bundle rebuilt):
 *   A  checkAuth() without the check for `loggedIn` → red: „Sitzung ungeklärt“ (login form visible)
 *   B  monitor.js schedules the next round without ifVisible() → red: „Hintergrundarbeiten“ (query in the
 *      hidden tab)
 *   C  fehlerfang.js again reports every event without an error object → red: „200 % Schrift“ (red toast)
 *   D  finanzen.js always with 'finance.basis.computed' → red: „Rechenbasis“
 *   T  wertkurve.js redraws itself again in the ResizeObserver → red: „200 % Schrift“ (loop)
 *   E  einstellungen.js again with `z?.prices || 0` without a substitute text → red: „Leeren ohne Zahl“ („Löscht 0 …“)
 *   F  merkliste.js again with the selector `.mk-row, .empty-state` → red: „Neuladen nach Fehler“ (wishlist)
 *   G  loadMinifigs() without the skeleton → red: same place (figures)
 *   H  #mon-app-theme without data-change → red: „Design sofort“
 *   I  btn-cu aborts again after the first field error → red: „Benutzer anlegen“ (only one message)
 *   K  styles.css without `.user-new{align-items:flex-start}` → red: same place (input fields offset)
 *   L  mobile.css without the full width for .user-new > .fg → red: same place (390 px)
 *   M  #mk-m-del again free in the footer instead of under „Weitere Aktionen“ → red: „Merkposten-Detail“
 *   N  mk-m-sub again with the number without a name → red: same place
 *   O  portfolioChartSVG() without a legend (belowTheImage = false) → red: „Bezugslinie bei 320 px“
 *   R  monitor.js without a role on the job name → red: „Hintergrundarbeiten“
 *   S  styles.css without `.period-btn:disabled` → red: „Finanzen ohne Verbindung“
 *   U  (13.11.2026) sessionUnresolved() without its own branch for 429 → red: „Sitzung ungeklärt“ (title
 *      „Anmeldung konnte nicht geprüft werden“, text with minutes and seconds)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, sleep } = require('./helpers/app-browser');
const { patternHousehold } = require('./helpers/inventory');

const CLOSE = `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.querySelectorAll('.ovl.open').forEach(o => o.classList.remove('open')); return true; })()`;
const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;
const NETWORK = { latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
const CACHE_CLEAR = `Object.keys(sessionStorage).filter(k => k.startsWith('bim_api:')).forEach(k => sessionStorage.removeItem(k)); true`;

async function size(b, width, height = 900) {
  await b.tab('Emulation.setDeviceMetricsOverride', {
    width: width,
    height: height,
    deviceScaleFactor: 1,
    mobile: width <= 640,
  });
}
const switchTab = (b, tab) =>
  b.evaluate(`document.querySelector('.ntab[data-tab="${tab}"]').click(); scrollTo(0, 0); true`);

/**
 * Requests whose URL contains `contains` are answered by `tun(requestId)` (CDP Fetch); the end comes back.
 * @param {{ contains: string, tun: (id: string) => Promise<unknown> }[]} rules
 */
async function intercept(b, rules) {
  await b.tab('Fetch.enable', {
    patterns: rules.map(r => ({ urlPattern: `*${r.contains}*`, requestStage: 'Request' })),
  });
  const listener = d => {
    if (d.method !== 'Fetch.requestPaused') return;
    const r = rules.find(x => d.params.request.url.includes(x.contains));
    (r ? r.tun(d.params.requestId) : b.tab('Fetch.continueRequest', { requestId: d.params.requestId })).catch(() => {});
  };
  b.listener.push(listener);
  return async () => {
    b.listener.splice(b.listener.indexOf(listener), 1);
    await b.tab('Fetch.disable');
  };
}
const respond = (b, id, status, body, head = []) =>
  b.tab('Fetch.fulfillRequest', {
    requestId: id,
    responseCode: status,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, ...head],
    body: Buffer.from(JSON.stringify(body)).toString('base64'),
  });
const subsequent = (b, ms) => id =>
  new Promise(r => setTimeout(r, ms)).then(() => b.tab('Fetch.continueRequest', { requestId: id }));

async function financesOffline(_t, a) {
  const { b, until } = a;
  await b.tab('Network.emulateNetworkConditions', { offline: true, ...NETWORK });
  try {
    await switchTab(b, 'finance');
    await until(`!!document.querySelector('#portfolio-chart .error-state')`, 'Diagramm nicht verfügbar');
    const k = await b.evaluate(`[...document.querySelectorAll('.period-choice .period-btn')].map(k => {
      const s = getComputedStyle(k); return { out: k.disabled, coverage: +s.opacity, zeiger: s.cursor }; })`);
    assert.equal(k.length, 4);
    for (const z of k) {
      assert.equal(z.out, true, 'period button operable');
      assert.ok(z.coverage < 1 && z.zeiger === 'not-allowed', `disabled looks like operable: ${JSON.stringify(z)}`);
    }
  } finally {
    await b.tab('Network.emulateNetworkConditions', { offline: false, ...NETWORK });
  }
  await b.evaluate(`document.querySelector('#fin-tbl [data-click="loadFinance"]')?.click(); true`);
  await until(`!!document.querySelector('#fin-tbl [data-fin-kind="sets"] tfoot')`, 'Finanzen nach dem Neuladen', 200);
}

async function rechenbasis(_t, a) {
  const { b, until } = a;
  await switchTab(b, 'finance');
  await until(
    `!!document.querySelector('#fin-tbl [data-fin-kind="sets"] tbody tr') && !document.getElementById('fin-basis').hidden`,
    'Basiszeile',
  );
  const z = await b.evaluate(`({ basis: ${text('#fin-basis')},
    lines: [...document.querySelectorAll('#fin-tbl [data-fin-kind] tbody tr')].length })`);
  const from = Number(/von (\d+) Positionen/.exec(z.basis)?.[1]);
  assert.ok(from > 0, `no number in „${z.basis}“`);
  assert.ok(z.lines > from, `test setup: ${z.lines} rows, ${from} items`);
  assert.match(
    z.basis,
    /Jede Position zählt einmal, auch wenn die Tabelle sie in mehreren Zeilen zeigt \(je Kauf und Konto\)\./,
  );
}

async function referenceLineNarrow(_t, a) {
  const { b, until, settle } = a;
  await size(b, 320, 800);
  await b.evaluate(`document.documentElement.style.setProperty('font-size', '200%', 'important'); true`);
  try {
    await switchTab(b, 'finance');
    await until(`!!document.querySelector('#portfolio-chart svg.chart-value')`, 'Wertkurve');
    await b.evaluate(`document.querySelector('.period-choice [data-arg="max"]').click(); true`);
    await until(`!!document.querySelector('#portfolio-chart svg.chart-value')`, 'Wertkurve neu');
    await settle();
    const d = await b.evaluate(`(() => { const s = document.querySelector('#portfolio-chart svg.chart-value');
      const flaeche = s.querySelector('polyline').getBoundingClientRect();
      const leg = s.querySelector('[data-legend="basis"] text');
      return { inImage: [...s.querySelectorAll('.cost-basis-line text')].map(t => t.textContent),
        legend: leg?.textContent.replace(/\\s+/g, ' ') ?? '', legTop: leg?.getBoundingClientRect().top ?? 0,
        surfaceBottom: flaeche.bottom }; })()`);
    assert.deepEqual(d.inImage, [], 'multi-line label above the curve');
    assert.match(d.legend, /^Kaufpreis/);
    assert.ok(d.legTop > d.surfaceBottom, `legend ${d.legTop} px, curve ends ${d.surfaceBottom} px`);
  } finally {
    await b.evaluate(`document.documentElement.style.removeProperty('font-size'); true`);
    await size(b, 1280);
  }
}

async function schrift200(_t, a) {
  const { b, until, settle } = a;
  await b.evaluate(
    `window.__ro = 0; addEventListener('error', e => { if (/ResizeObserver/.test(e.message)) window.__ro++; }); true`,
  );
  const errorToasts = `[...document.querySelectorAll('#toasts .toast.error')].filter(t => /Unerwarteter Fehler/.test(t.textContent)).length`;
  // The event as Chrome sends it: without an error object.
  await b.evaluate(
    `dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop completed with undelivered notifications.' })); true`,
  );
  assert.equal(await b.evaluate(errorToasts), 0, 'red toast for the ResizeObserver message');
  await b.evaluate(`window.__ro = 0; true`);
  await b.evaluate(`document.documentElement.style.setProperty('font-size', '200%', 'important'); true`);
  try {
    for (const width of [320, 390])
      for (const tab of ['settings', 'gallery', 'finance']) {
        await size(b, width, 760);
        await switchTab(b, tab);
        await until(`document.querySelector('.ntab[data-tab="${tab}"]').classList.contains('active')`, tab);
        await settle();
        await b.evaluate(`(async () => { for (let y = 0; y < document.body.scrollHeight; y += 300) {
          scrollTo(0, y); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); } return true; })()`);
      }
    const z = await b.evaluate(`({ ro: window.__ro, toasts: ${errorToasts} })`);
    assert.equal(z.toasts, 0, 'roter Toast „Unerwarteter Fehler“');
    assert.equal(z.ro, 0, 'ResizeObserver-Schleife');
  } finally {
    await b.evaluate(`document.documentElement.style.removeProperty('font-size'); scrollTo(0, 0); true`);
    await size(b, 1280);
  }
}

async function clearWithoutNumber(_t, a) {
  const { b, until } = a;
  const out = await intercept(b, [
    {
      contains: '/api/v2/admin/cache-stats',
      tun: id => respond(b, id, 503, { success: false, error: 'Server ausgelastet' }),
    },
  ]);
  try {
    await b.evaluate(`document.getElementById('btn-clr-prices').click(); true`);
    await until(`getComputedStyle(document.getElementById('confirm-modal')).display !== 'none'`, 'Rückfrage');
    const msg = await b.evaluate(text('#cd-msg'));
    assert.doesNotMatch(msg, /\b0 gespeicherte/, 'unknown number as 0');
    assert.match(msg, /^Löscht alle gespeicherten Marktpreise\./);
  } finally {
    await b.evaluate(`document.getElementById('cd-cancel').click(); true`);
    await out();
  }
}

/** First offline into the error state, then slowly on the network: during the new attempt the skeleton stands there. */
async function newAfterError(b, until, tab, target, path) {
  await b.evaluate(CACHE_CLEAR);
  await b.tab('Network.emulateNetworkConditions', { offline: true, ...NETWORK });
  let out = async () => {};
  try {
    await switchTab(b, tab);
    await until(`!!document.querySelector('${target} .error-state')`, `${tab}: Fehlerzustand`);
    out = await intercept(b, [{ contains: path, tun: subsequent(b, 3000) }]);
  } finally {
    await b.tab('Network.emulateNetworkConditions', { offline: false, ...NETWORK });
  }
  try {
    await b.evaluate(`document.querySelector('${target} .error-state [data-click]')?.click(); true`);
    await until(
      `!document.querySelector('${target} .error-state') && !!document.querySelector('${target} [aria-busy="true"]')`,
      `${tab}: Gerüst statt altem Fehler`,
      25,
    );
    await until(
      `!document.querySelector('${target} [aria-busy="true"], ${target} .error-state')`,
      `${tab}: geladen`,
      100,
    );
  } finally {
    await out();
  }
}

async function reloadAfterError(_t, a) {
  await newAfterError(a.b, a.until, 'wanted', '#mk-list', '/api/v2/wanted?');
  await newAfterError(a.b, a.until, 'minifigs', '#figs-list', '/api/v2/minifigs?');
}

async function wantedItemDetail(_t, a) {
  const { b, until, settle } = a;
  await switchTab(b, 'wanted');
  await until(`!!document.querySelector('#mk-list .mk-row[data-arg^="10276-1|"]')`, 'Merkposten');
  await b.evaluate(`document.querySelector('#mk-list .mk-row[data-arg^="10276-1|"]').click(); true`);
  await until(`document.getElementById('mk-detail-modal').classList.contains('open')`, 'Detail');
  await settle();
  const d = await b.evaluate(`(() => { const f = document.querySelector('#mk-detail-modal .mfooter');
    const visible = [...f.querySelectorAll('button, a, summary')].filter(e => e.checkVisibility());
    const remove = document.getElementById('mk-m-del');
    return { first: visible[0]?.className, deleteVisible: remove.checkVisibility(),
      inMenu: !!remove.closest('details.more-menu'), title: ${text('#mk-m-tit')}, sub: ${text('#mk-m-sub')} }; })()`);
  assert.doesNotMatch(d.first || '', /\bbd\b/, 'red button as the first action');
  assert.equal(d.deleteVisible, false, '„Löschen“ visible without „Weitere Aktionen“');
  assert.equal(d.inMenu, true, '„Löschen“ not under „Weitere Aktionen“');
  assert.equal(d.title, '10276-1', 'test setup: wanted items without catalogue names');
  assert.equal(d.sub, 'Neuware', 'number twice in the header');
  await b.evaluate(`document.querySelector('#mk-detail-modal .more-menu summary').click(); true`);
  await until(`document.getElementById('mk-m-del').checkVisibility()`, 'Löschen im Menü');
  await b.evaluate(CLOSE);
}

async function createUser(_t, a) {
  const { b, until } = a;
  await size(b, 1280);
  await switchTab(b, 'settings');
  await b.evaluate(`document.querySelector('.settings-link[data-arg="usermgmt"]').click(); true`);
  await until(`document.getElementById('btn-cu')?.checkVisibility()`, 'Benutzerverwaltung');
  const put = (id, value) =>
    b.evaluate(`(() => { const f = document.getElementById('${id}'); f.value = ${JSON.stringify(value)};
      f.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const state = `(() => { const r = id => document.getElementById(id).getBoundingClientRect();
    const view = id => !!document.getElementById(id)?.checkVisibility();
    const line = document.querySelector('.user-new').getBoundingClientRect();
    return { nameError: view('nu-n-error') ? ${text('#nu-n-error')} : '', pwError: view('nu-p-error') ? ${text('#nu-p-error')} : '',
      nameRule: view('nu-n-rule'), pwRule: view('nu-p-rule'),
      upper: [r('nu-n').top, r('nu-p').top].map(Math.round), hook: (r('nu-a').top + r('nu-a').bottom) / 2,
      field: [r('nu-n').top, r('nu-n').bottom], line: line.width,
      widths: ['nu-p', 'nu-a'].map(id => document.getElementById(id).closest('.fg').getBoundingClientRect().width) }; })()`;
  await put('nu-n', '');
  await put('nu-p', '');
  await b.evaluate(`document.getElementById('btn-cu').click(); true`);
  await until(`!!document.getElementById('nu-p-error')?.checkVisibility()`, 'Meldungen');
  let s = await b.evaluate(state);
  assert.equal(s.nameError, 'Bitte einen Benutzernamen eintragen.');
  assert.equal(s.pwError, 'Bitte ein Passwort eintragen.', 'only one message at a time');
  assert.deepEqual([s.nameRule, s.pwRule], [false, false], 'rule and message at the same time');
  assert.equal(await b.evaluate('document.activeElement.id'), 'nu-n', 'focus on the first error');
  // Only the name wrong: next to the message stands the password rule, the fields stay at one height.
  await put('nu-p', 'Ziegel-Turm-Fenster-42');
  await put('nu-n', 'a b');
  await b.evaluate(`document.getElementById('btn-cu').click(); true`);
  await until(`!!document.getElementById('nu-n-error')?.checkVisibility()`, 'Meldung am Namen');
  s = await b.evaluate(state);
  assert.equal(s.pwError, '');
  assert.equal(s.pwRule, true, 'password rule is missing');
  assert.equal(s.upper[0], s.upper[1], `Eingabefelder versetzt: ${s.upper}`);
  assert.ok(s.hook > s.field[0] && s.hook < s.field[1], `tick ${s.hook} next to field ${s.field}`);
  try {
    await size(b, 390, 844);
    await until(`innerWidth === 390`, 'Telefonbreite');
    s = await b.evaluate(state);
    for (const w of s.widths) assert.ok(w >= s.line - 1, `${w} px von ${s.line} px`);
  } finally {
    await put('nu-n', '');
    await put('nu-p', '');
    await size(b, 1280);
  }
}

async function designImmediately(_t, a) {
  const { b, until, db } = a;
  await switchTab(b, 'settings');
  await until(`!!document.getElementById('mon-app-theme')?.value`, 'Design-Auswahl');
  assert.equal(await b.evaluate(`!!document.getElementById('btn-save-theme')`), false, 'Speichern-Knopf');
  await b.evaluate(`(() => { const s = document.getElementById('mon-app-theme'); s.value = 'brick';
    s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await until(
    `/Gespeichert/.test(document.getElementById('mon-app-theme').nextElementSibling?.textContent || '')`,
    'Bestätigung am Feld',
  );
  const w = await db.get(`SELECT value FROM global_settings WHERE key = 'app_theme'`);
  assert.equal(w?.value, 'brick');
  await b.evaluate(`(() => { const s = document.getElementById('mon-app-theme'); s.value = 'classic';
    s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await until(`document.documentElement.dataset.theme !== 'brick'`, 'zurück auf Klassisch');
}

async function hintergrundarbeiten(_t, a) {
  const { b, until, settle, db } = a;
  await db.run(`DELETE FROM jobs WHERE type = 'exchange_rates'`);
  await db.run(
    `INSERT INTO jobs (type, dedupe_key, due_at) VALUES ('exchange_rates', 'plan:exchange_rates', NOW() + interval '5 hours')`,
  );
  await db.run(`INSERT INTO jobs (type, attempts, max_attempts, error_message, due_at)
                VALUES ('exchange_rates', 3, 6, 'ECONNRESET', NOW() + interval '1 hour')`);
  const fetches = [];
  const counter = d => {
    if (d.method === 'Network.requestWillBeSent' && d.params.request.url.includes('/api/v2/admin/jobs'))
      fetches.push(Date.now());
  };
  b.listener.push(counter);
  try {
    await b.evaluate(`document.getElementById('ntab-monitor').click(); true`);
    await until(`/Wechselkurse/.test(document.getElementById('tab-monitor').textContent)`, 'Aufträge');
    await b.evaluate(`document.querySelector('.mon-single')?.setAttribute('open', ''); true`);
    const lines = await b.evaluate(`[...document.querySelectorAll('#tab-monitor .mon-single tbody tr')]
      .filter(r => r.textContent.includes('Wechselkurse')).map(r => r.querySelector('.mon-role')?.textContent || '')`);
    assert.deepEqual(lines.sort(), ['Wiederholung nach Fehler', 'regulärer Lauf'], 'roles of the two runs');
    await settle();
    // Hidden: no query, even beyond the 15 s of the calm beat.
    await b.evaluate(`Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange')); true`);
    const ab = Date.now();
    for (const end = ab + 17_000; Date.now() < end; ) await sleep(250);
    assert.deepEqual(
      fetches.filter(z => z > ab),
      [],
      'polling in the hidden tab',
    );
    await b.evaluate(`delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); true`);
    await until(`true`, 'visible');
    for (const end = Date.now() + 3000; !fetches.some(z => z > ab) && Date.now() < end; ) await sleep(100);
    assert.ok(
      fetches.some(z => z > ab),
      'visible again: no polling',
    );
  } finally {
    b.listener.splice(b.listener.indexOf(counter), 1);
    await b.evaluate(`delete document.hidden; true`);
    await switchTab(b, 'gallery');
  }
}

async function sessionUnresolved(_t, a) {
  const { b, until } = a;
  let type = '429';
  const out = await intercept(b, [
    {
      contains: '/api/v2/auth/me',
      tun: id =>
        type === '429'
          ? respond(
              b,
              id,
              429,
              {
                success: false,
                code: 'too_many_requests',
                error: 'Zu viele Anfragen — bitte in 1 Min. erneut versuchen',
              },
              [{ name: 'Retry-After', value: '40' }],
            )
          : type === 'network'
            ? b.tab('Fetch.failRequest', { requestId: id, errorReason: 'InternetDisconnected' })
            : b.tab('Fetch.continueRequest', { requestId: id }),
    },
  ]);
  try {
    await b.tab('Page.reload');
    await until(
      `!document.getElementById('start-offline')?.hidden && !!document.getElementById('start-offline')`,
      'Kasten',
      200,
    );
    const z = await b.evaluate(`({ mask: getComputedStyle(document.getElementById('login-screen')).display,
      app: getComputedStyle(document.getElementById('app')).display, title: ${text('#start-offline-title')},
      text: ${text('#start-offline-text')}, button: document.getElementById('start-again').checkVisibility() })`);
    assert.equal(z.mask, 'none', 'login form despite a valid session');
    assert.equal(z.app, 'none');
    // Throttled: an own title and only one time statement (UI check 22, N4).
    assert.equal(z.title, 'Zu viele Anfragen');
    assert.match(z.text, /^Der Server nimmt gerade keine weiteren Anfragen an\. Neuer Versuch in (40|39|38) s\.$/);
    assert.equal(z.button, true, '„Erneut versuchen“ is missing');
    type = 'network';
    await b.evaluate(`document.getElementById('start-again').click(); true`);
    await until(`/Keine Verbindung zum Server/.test(${text('#start-offline-text')})`, 'Grund: kein Netz');
    assert.equal(await b.evaluate(`getComputedStyle(document.getElementById('login-screen')).display`), 'none');
    type = 'through';
    await b.evaluate(`document.getElementById('start-again').click(); true`);
    await until(
      `getComputedStyle(document.getElementById('app')).display !== 'none' && document.getElementById('start-offline').hidden`,
      'App nach dem neuen Versuch',
      200,
    );
  } finally {
    await out();
  }
}

test('session, monitor, error catching, wishlist', { concurrency: 1, timeout: 400_000 }, async t => {
  const a = await startApp(t, { name: `r21_pruefer_${process.pid}`, holding: patternHousehold });
  if (a.reason) {
    t.skip(a.reason);
    return;
  }
  await a.settle();
  /** @type {[string, (t: import('node:test').TestContext, a: object) => Promise<void>][]} */
  const pruefungen = [
    ['Finanzen ohne Verbindung', financesOffline],
    ['Rechenbasis', rechenbasis],
    ['Bezugslinie bei 320 px', referenceLineNarrow],
    ['200 % Schrift', schrift200],
    ['Leeren ohne Zahl', clearWithoutNumber],
    ['Neuladen nach Fehler', reloadAfterError],
    ['Merkposten-Detail', wantedItemDetail],
    ['Benutzer anlegen', createUser],
    ['Design sofort', designImmediately],
    ['Hintergrundarbeiten', hintergrundarbeiten],
    ['Sitzung ungeklärt', sessionUnresolved],
  ];
  for (const [name, fn] of pruefungen) {
    await a.b.evaluate(CLOSE);
    await t.test(name, () => fn(t, a));
  }
});
