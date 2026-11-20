/**
 * Befunde der UI-Prüfung vom 01.11.2026, am echten Bündel in jsdom: was die
 * Oberfläche aus einer Serverantwort macht (Beschriftung, Rückmeldung,
 * Zustand der Umschalter), nicht welche Zeile im Quelltext steht.
 *
 * Gegenproben (01.11.2026 gemessen, je einzeln zurückgedreht):
 *   A  groupNumber ohne das Entfernen der Trenner → rot „Gutscheinnummer“
 *   B  role="alert" an #lerr entfernt → rot „Anmeldefehler“
 *   C  aria-pressed in setChartPeriod nicht nachgezogen → rot „Zeitraum“
 *   D  ps-total wieder nur total_parts → rot „Teile-Zahl“
 *   E  priceRow ohne Beschriftung (art = '') → rot „Preis auf der Kachel“
 *   F  diagrammNichtDa im Fehlerzweig von loadFinance entfernt → rot „offline“
 *   G  Teile-Leerzustand wieder „Keine Teile gefunden“ ohne Knopf → rot „Teile-Suche ohne Treffer“
 *   H  fehlerKasten wieder als roher Text → rot „Hintergrundarbeiten“
 *
 * Gegenproben (13.11.2026 gemessen):
 *   I  in monitor.js zeile() `wartet` fest false → rot „verschobener Auftrag wartet“
 *      (Fehlerkasten und „Versuch 3 von 5“ in der Zeile)
 *   J  den Fehlerkasten wieder für jeden Status ausser 'laeuft' → rot: derselbe
 *      Test (Fehlerkasten beim abgebrochenen)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, sicht, warte, takt } = require('./helpers/ui');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();

const SET = {
  set_number: '21318-1',
  name: '',
  theme: 'Ideas',
  year: 2019,
  quantity: 1,
  conditions: ['N'],
  avg_purchase_price: 199.99,
  letzter_kauf: '2026-06-01T10:00:00Z',
  added_at: '2026-11-01T10:00:00Z',
  instructions: [],
};

test('voucher number: separators off first, then groups of four; without a PDF it is in the text', async () => {
  const { w, d } = await openUi({
    '/v1/vouchers': {
      success: true,
      vouchers: [{ id: 1, number: '6123-4567-8901', pin: '4711', amount: 50, currency: 'EUR', hat_pdf: false }],
    },
  });
  try {
    await sicht(w, 'gutscheine');
    await warte(() => d.querySelector('.voucher-num'));
    assert.equal(text(d.querySelector('.voucher-num')), '6123 4567 8901');
    assert.equal(text(d.querySelector('.voucher-nopdf')), 'kein PDF');
  } finally {
    w.close();
  }
});

test('login error is read aloud (role=alert) and stays', async () => {
  const { w, d } = await openUi(
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
    assert.equal(d.getElementById('lerr').getAttribute('role'), 'alert');
    assert.equal(text(d.getElementById('lerr')), 'Benutzername oder Passwort falsch');
  } finally {
    w.close();
  }
});

test('period and filter of the finances report their state (aria-pressed)', async () => {
  // Zwei Messpunkte: Ohne Verlauf sind die Zeitraum-Knöpfe gesperrt.
  const { w, d } = await openUi({
    '/v1/finance/portfolio-history': {
      success: true,
      messpunkte: 2,
      points: [
        { x_label: '1.10.', value: 100 },
        { x_label: '1.11.', value: 110 },
      ],
    },
  });
  try {
    await reiter(w, 'finance');
    await warte(() => !d.querySelector('.zeitraum-wahl [data-period="week"]').disabled);
    const knopf = sel => d.querySelector(sel);
    knopf('.zeitraum-wahl [data-period="week"]').click();
    await takt(20);
    assert.deepEqual(
      [...d.querySelectorAll('.zeitraum-wahl .period-btn')].map(
        b => `${b.dataset.period}:${b.getAttribute('aria-pressed')}`,
      ),
      ['week:true', 'month:false', 'year:false', 'max:false'],
    );
    knopf('#fin-filter [data-art="sets"]').click();
    await takt(20);
    assert.deepEqual(
      [...d.querySelectorAll('#fin-filter button')].map(b => b.getAttribute('aria-pressed')),
      ['false', 'true', 'false', 'false'],
    );
    await reiter(w, 'parts');
    assert.deepEqual(
      [...d.querySelectorAll('#tab-parts .sammlung-wahl button')].map(b => b.getAttribute('aria-current')),
      [null, 'page', null],
    );
  } finally {
    w.close();
  }
});

test('part count: collection and parts tab show the same sum with breakdown', async () => {
  const { w, d } = await openUi({
    '/v1/stats': {
      success: true,
      stats: {
        total_sets: 4,
        total_parts: 394,
        set_parts: 144,
        manual_parts: 250,
        total_minifigs: 3,
        total_instructions: 0,
      },
    },
    '/v1/parts/stats': {
      success: true,
      stats: { total_parts: 144, manual_parts: 250, unique_parts: 3, unique_colors: 4 },
    },
  });
  try {
    await warte(() => text(d.getElementById('bstat-parts')) === '394');
    assert.equal(text(d.getElementById('bstat-parts-sub')), '144 aus Sets · 250 einzeln');
    await reiter(w, 'parts');
    await warte(() => text(d.getElementById('ps-total')) !== '—');
    assert.equal(text(d.getElementById('ps-total')), '394');
    assert.equal(text(d.getElementById('ps-total-sub')), '144 aus Sets · 250 einzeln');
  } finally {
    w.close();
  }
});

test('price on the tile is labeled, condition and date named (de and en)', async () => {
  for (const [sprache, art, zustand, gekauft, unbekannt] of [
    ['de', 'Kaufpreis', 'Neuware', 'Gekauft', 'Unbekannt'],
    ['en', 'Purchase price', 'New', 'Bought', 'Unknown'],
  ]) {
    const { w, d } = await openUi(
      { '/v1/sets': { success: true, sets: [SET], total: 1, themes: ['Ideas'] } },
      { sprache },
    );
    try {
      await warte(() => d.querySelector('#gallery .sc'));
      const kachel = d.querySelector('#gallery .sc');
      assert.equal(text(kachel.querySelector('.price-badge .preis-art')), art);
      assert.match(text(kachel.querySelector('.cond-new')), new RegExp(`: ${zustand}$`));
      assert.match(text(kachel.querySelector('.kachel-datum')), new RegExp(`^${gekauft} `));
      assert.equal(text(kachel.querySelector('.sname')), unbekannt);
    } finally {
      w.close();
    }
  }
});

test('offline: the chart says “not available” with reason and button instead of “Loading…”', async () => {
  const netzweg = () => {
    throw new TypeError('Failed to fetch');
  };
  const { w, d } = await openUi({
    '/v1/finance/valuation': netzweg,
    '/v1/finance/portfolio-history': netzweg,
  });
  try {
    await reiter(w, 'finance');
    // Grund und Knopf stehen einmal, seit UX-Prüfung 24 (M2) oben im Diagrammkasten; die Liste darunter bleibt leer.
    await warte(() => /nicht erreichbar/.test(text(d.getElementById('portfolio-chart'))));
    assert.match(text(d.getElementById('portfolio-chart')), /Keine Verbindung zum Server.*Erneut versuchen/);
    assert.equal(text(d.getElementById('fin-tbl')), '');
    assert.equal(
      d.querySelectorAll('#tab-finance [data-click="loadFinance"], #tab-finance [data-click="loadPortfolioChart"]')
        .length,
      1,
    );
  } finally {
    w.close();
  }
});

// UX-Prüfung 24 (M2): Ohne geladenen Stand fallen die Karten weg, statt „—“ ohne Fehlerbezug zu zeigen; die
// Zeitraumknöpfe sind gesperrt. Gegenprobe (14.11.2026): in finanzenFehlen() `hidden = true` entfernt → rot
// (Karten sichtbar); das Sperren der Knöpfe entfernt → rot (Zeitraum bedienbar).
test('offline: the key figure cards of the finances drop, the period buttons are locked', async () => {
  const netzweg = () => {
    throw new TypeError('Failed to fetch');
  };
  {
    const { w, d } = await openUi({
      '/v1/finance/valuation': netzweg,
      '/v1/finance/portfolio-history': netzweg,
    });
    try {
      await reiter(w, 'finance');
      await warte(() => /nicht erreichbar/.test(text(d.getElementById('portfolio-chart'))));
      assert.equal(d.getElementById('fin-sum').hidden, true, 'Karten ohne Zahl sichtbar');
      assert.equal(text(d.getElementById('portfolio-current')), '—');
      assert.deepEqual(
        [...d.querySelectorAll('.zeitraum-wahl .period-btn')].map(k => k.disabled),
        [true, true, true, true],
        'Zeitraum bedienbar',
      );
    } finally {
      w.close();
    }
  }
  const { w, d } = await openUi({
    '/v1/finance/valuation': { $status: 500, success: false, error: 'kaputt', code: 'intern' },
  });
  try {
    await reiter(w, 'finance');
    await warte(() => d.getElementById('fin-sum').hidden === true);
    assert.match(text(d.getElementById('portfolio-chart')), /Erneut versuchen/);
  } finally {
    w.close();
  }
});

test('parts search without results: “No results for …” with a button that clears the search', async () => {
  const { w, d } = await openUi({});
  try {
    await reiter(w, 'parts');
    const feld = d.getElementById('parts-search');
    feld.value = 'xyz';
    feld.dispatchEvent(new w.Event('input', { bubbles: true }));
    await warte(() => /xyz/.test(text(d.querySelector('#tab-parts .leer'))), 3000);
    assert.equal(text(d.querySelector('#tab-parts .leer h2')), 'Keine Treffer für „xyz“');
    d.querySelector('#tab-parts .leer [data-click="filterZuruecksetzen"]').click();
    await warte(() => text(d.querySelector('#tab-parts .leer h2')) === 'Noch keine Teile', 3000);
    assert.equal(feld.value, '');
  } finally {
    w.close();
  }
});

test('background jobs: technical error as a sentence, details expandable', async () => {
  const roh = 'getaddrinfo ENOTFOUND rebrickable.com';
  const { w, d } = await openUi({
    '/v1/admin/job-status': { success: true, job: { running: false } },
    '/v1/admin/jobs': { success: true, jobs: {}, schedules: {}, db: { csvCache: {}, blMapping: {} } },
    '/v1/admin/auftraege': {
      success: true,
      zusammenfassung: [{ type: 'anleitung', status: 'fehler', anzahl: 1 }],
      job_prozess: { laeuft: true },
      pausen: [],
      bildbedarf: 0,
      auftraege: [
        {
          id: '7',
          type: 'anleitung',
          status: 'fehler',
          set_number: '10294-1',
          error_message: roh,
          attempts: 3,
          max_attempts: 3,
        },
      ],
    },
  });
  try {
    await reiter(w, 'monitor');
    await warte(() => d.querySelector('#auftraege-karte .fehler-kasten'), 3000);
    const kasten = d.querySelector('#auftraege-karte .fehler-kasten');
    assert.equal(text(kasten.querySelector('summary')), 'Dienst nicht erreichbar — Netz oder Server gestört.');
    assert.equal(text(kasten.querySelector('code')), roh);
  } finally {
    w.close();
  }
});

test('background jobs: a postponed job waits, an aborted one has not failed', async () => {
  const bis = new Date(Date.now() + 3 * 3600_000).toISOString();
  const zeile = (id, mehr) => ({
    id,
    type: 'preise_nachladen',
    set_number: null,
    attempts: 3,
    max_attempts: 5,
    due_at: bis,
    geplant: false,
    waiting: false,
    progress: null,
    ...mehr,
  });
  const { w, d } = await openUi({
    '/v1/admin/job-status': { success: true, job: { running: false } },
    '/v1/admin/jobs': { success: true, jobs: {}, schedules: {}, db: { csvCache: {}, blMapping: {} } },
    '/v1/admin/auftraege': {
      success: true,
      zusammenfassung: [{ type: 'preise_nachladen', status: 'offen', anzahl: 2 }],
      job_prozess: { laeuft: true },
      pausen: [],
      bildbedarf: 0,
      auftraege: [
        zeile('1', { status: 'offen', waiting: true, error_message: 'BrickLink-Tageskontingent erschöpft' }),
        zeile('2', { status: 'offen', error_message: 'getaddrinfo ENOTFOUND api.bricklink.com' }),
        zeile('3', { status: 'abgebrochen', error_message: 'abgebrochen', due_at: null }),
      ],
    },
  });
  try {
    await reiter(w, 'monitor');
    await warte(() => d.querySelectorAll('#auftraege-karte .mon-einzeln tbody tr').length === 3, 3000);
    const [wartend, wieder, ab] = [...d.querySelectorAll('#auftraege-karte .mon-einzeln tbody tr')];
    assert.equal(wartend.querySelector('.fehler-kasten'), null, `als Fehler gezeigt: ${text(wartend)}`);
    assert.match(text(wartend), /wartet bis .*\d{1,2}:\d{2}.*BrickLink-Tageskontingent erschöpft/);
    assert.doesNotMatch(text(wartend), /Versuch/);
    assert.ok(wieder.querySelector('.fehler-kasten'), 'ein Fehler vor dem nächsten Versuch bleibt sichtbar');
    assert.equal(ab.querySelector('.fehler-kasten'), null, `abgebrochen als Fehler gezeigt: ${text(ab)}`);
    assert.equal(d.querySelector('[data-click="retryJob"]'), null);
  } finally {
    w.close();
  }
});
