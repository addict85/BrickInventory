/**
 * Der Knopf „Set ansehen" in der Preisalarm-Mail — und was passiert, wenn er
 * nicht gebaut werden kann.
 *
 * ── Gegenproben (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   a) Den Knopf bedingungslos setzen (auch ohne Basis) → Schritt 2 rot.
 *   b) Den Hinweis entfernt                             → Schritt 2 rot.
 *   c) Den Hinweis bei JEDEM Aufruf ausgeben            → Schritt 3 rot.
 */
const test = require('node:test');
const { environment } = require('./helpers/sources');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();

const DATEN = {
  username: 'marco',
  lang: 'de',
  setNumber: '10179-1',
  setName: 'Millennium Falcon',
  condition: 'N',
  direction: 'unter',
  threshold: 200,
  price: 180,
  currency: 'CHF',
};

/** console.warn einsammeln, statt den Testlauf zuzumuellen. */
async function warningsOf(fn) {
  const echt = console.warn;
  const collected = [];
  console.warn = (...a) => collected.push(a.join(' '));
  try {
    await fn();
  } finally {
    console.warn = echt;
  }
  return collected;
}

test('Preisalarm-Mail: der Knopf und sein Fehlen', async t => {
  // Frisch laden, damit der „einmal je Prozess"-Merker dieser Prüfung gehört
  // und nicht einem früheren Test.
  const mailer = _req('src/mail/mailer.js');
  const vorher = process.env.APP_BASE_URL;

  await t.test('1. mit APP_BASE_URL trägt die Mail den Link', async () => {
    environment({ APP_BASE_URL: 'https://lego.example.test/' });
    const m = await mailer.buildAlertMail(DATEN);
    // Der abschliessende Schrägstrich der Variablen darf sich nicht verdoppeln.
    assert.match(
      m.html,
      /https:\/\/lego\.example\.test\/\?set=10179-1/,
      `Der Link fehlt oder ist falsch zusammengesetzt:\n${m.html.slice(0, 400)}`,
    );
    assert.match(m.html, /Set ansehen/, 'Der Knopf trägt keine Beschriftung.');
    assert.match(m.html, /class="btn-link"/, 'Der Link steht nicht als Knopf da.');
  });

  await t.test('2. ohne APP_BASE_URL kein geratener Link — und ein Hinweis', async () => {
    // Zwei Aussagen in EINEM Schritt, und das ist kein Zusammenlegen aus
    // Bequemlichkeit: Der Hinweis faellt genau EINMAL je Prozess, also muss
    // der erste Aufruf ohne Basis-URL beide Fragen beantworten. Ein zweiter
    // Schritt davor haette den Merker verbraucht — genau das ist beim ersten …
    environment({ APP_BASE_URL: undefined });
    let m;
    const collected = await warningsOf(async () => {
      m = await mailer.buildAlertMail(DATEN);
    });

    assert.ok(!/\?set=/.test(m.html), 'Ohne bekannte Adresse steht trotzdem ein Link in der Mail.');
    assert.ok(!/Set ansehen/.test(m.html), 'Der Knopf ist da, kann aber nirgends hinfuehren.');
    // Der Rest der Mail bleibt vollstaendig — nur der Knopf fehlt.
    assert.match(m.html, /Marktpreis/, 'Ohne Basis-URL fehlt auf einmal die halbe Mail.');
    assert.match(m.subject, /10179-1/);

    // Genau das fehlte: Marco sah einen fehlenden Knopf, der Betreiber sah
    // nichts. Dieselbe Luecke hat getBaseUrl() in routes/auth.ts laengst
    // geschlossen — mit demselben Mittel.
    assert.ok(
      collected.some(z => z.includes('APP_BASE_URL')),
      `Kein Hinweis im Protokoll. Gesammelt: ${JSON.stringify(collected)}`,
    );
  });

  await t.test('3. aber nur EINMAL, nicht je Alarm', async () => {
    // Der Preislauf baut die Mail fuer JEDEN gerissenen Alarm. Bei zwanzig
    // Alarmen saehe zwanzigmal dieselbe Zeile aus wie ein Sturm statt wie ein
    // Hinweis. Schritt 2 hat den Hinweis bereits ausgeloest — hier darf keiner
    // mehr kommen.
    environment({ APP_BASE_URL: undefined });
    const collected = await warningsOf(async () => {
      for (let i = 0; i < 3; i++) await mailer.buildAlertMail(DATEN);
    });
    const treffer = collected.filter(z => z.includes('APP_BASE_URL')).length;
    assert.equal(treffer, 0, `Der Hinweis wiederholt sich (${treffer}-mal bei drei Mails).`);
  });

  // Marcos Befund vom 25.09.: die Kacheln stiessen aneinander
  //
  // Gegenproben (durchgefuehrt, je rot, danach wieder gruen):
  //   a) zurueck auf 50 / 12px / 50  -> rot: „Gefunden: 2" (der Abstand steht
  //                                    dann in Pixeln und faellt aus der Zaehlung)
  //   b) Kacheln ungleich (44/12/40) -> rot: „Die Breiten ergeben 96 %"
  await t.test('4. die beiden Kacheln lassen in der Mitte Platz', async () => {
    environment({ APP_BASE_URL: 'https://lego.example.org' });
    const m = await mailer.buildAlertMail(DATEN);
    const breiten = [...m.html.matchAll(/<td width="(\d+)%"/g)].map(t => Number(t[1]));
    assert.equal(
      breiten.length,
      3,
      `Erwartet: zwei Kacheln und ein Abstand, alle in Prozent. Gefunden: ${breiten.length}.`,
    );
    const [links, mitte, rechts] = breiten;
    assert.equal(
      links + mitte + rechts,
      100,
      `Die Breiten ergeben ${links + mitte + rechts} % — der Klient muss dann etwas stauchen.`,
    );
    assert.equal(links, rechts, 'Die beiden Kacheln sind unterschiedlich breit.');
    assert.ok(mitte > 0, 'In der Mitte steht kein Abstand.');
  });

  if (vorher === undefined) environment({ APP_BASE_URL: undefined });
  else environment({ APP_BASE_URL: vorher });
});
