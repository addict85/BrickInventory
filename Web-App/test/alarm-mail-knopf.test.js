/**
 * Der Knopf „Set ansehen" in der Preisalarm-Mail — und was passiert, wenn er
 * nicht gebaut werden kann.
 *
 * ── Marcos Befund vom 25.09. ────────────────────────────────────────────────
 *
 *   „In der Email vom Preisalarm finde ich den direkten Link nicht."
 *
 * Er hatte recht. Der Knopf erscheint nur, wenn APP_BASE_URL gesetzt ist — und
 * das ist richtig so: Der Preislauf hat keine Anfrage, aus der sich ein Host
 * ableiten liesse, und ein geratener Link in einer Mail ist schlechter als
 * kein Knopf. Die Verifizierungsmail darf den Host-Header nehmen, weil sie aus
 * einer Anfrage entsteht; hier gibt es keine.
 *
 * Falsch war, dass es WORTLOS geschah. Aus Sicht des Empfängers fehlte das
 * Merkmal einfach, aus Sicht des Betreibers gab es nichts nachzusehen.
 *
 * ── Warum das hier eine ECHTE Prüfung ist und keine Quelltextsuche ──────────
 *
 * baueAlarmMail() lässt sich aufrufen: getMailTheme() fängt seinen eigenen
 * Fehler und fällt auf das Standard-Design zurück, es braucht also keine
 * Datenbank. Damit lässt sich die Frage so stellen, wie Marco sie gestellt
 * hat — „ist der Link in der Mail?" —, statt sie auf „steht das Muster im
 * Quelltext?" zu verbiegen.
 *
 * ── Gegenproben (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   a) Den Knopf bedingungslos setzen (auch ohne Basis) → Schritt 2 rot.
 *   b) Den Hinweis entfernt                             → Schritt 2 rot.
 *   c) Den Hinweis bei JEDEM Aufruf ausgeben            → Schritt 3 rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();

const DATEN = {
  username: 'marco', lang: 'de', setNumber: '10179-1', setName: 'Millennium Falcon',
  condition: 'N', richtung: 'unter', schwelle: 200, preis: 180, waehrung: 'CHF',
};

/** console.warn einsammeln, statt den Testlauf zuzumuellen. */
async function warnungenVon(fn) {
  const echt = console.warn;
  const gesammelt = [];
  console.warn = (...a) => gesammelt.push(a.join(' '));
  try { await fn(); } finally { console.warn = echt; }
  return gesammelt;
}

test('Preisalarm-Mail: der Knopf und sein Fehlen', async (t) => {
  // Frisch laden, damit der „einmal je Prozess"-Merker dieser Prüfung gehört
  // und nicht einem früheren Test.
  const mailer = _req('utils/mailer.js');
  const vorher = process.env.APP_BASE_URL;

  await t.test('1. mit APP_BASE_URL trägt die Mail den Link', async () => {
    process.env.APP_BASE_URL = 'https://lego.example.test/';
    const m = await mailer.baueAlarmMail(DATEN);
    // Der abschliessende Schrägstrich der Variablen darf sich nicht verdoppeln.
    assert.match(m.html, /https:\/\/lego\.example\.test\/\?set=10179-1/,
      `Der Link fehlt oder ist falsch zusammengesetzt:\n${m.html.slice(0, 400)}`);
    assert.match(m.html, /Set ansehen/, 'Der Knopf trägt keine Beschriftung.');
    assert.match(m.html, /class="btn-link"/, 'Der Link steht nicht als Knopf da.');
  });

  await t.test('2. ohne APP_BASE_URL kein geratener Link — und ein Hinweis', async () => {
    // Zwei Aussagen in EINEM Schritt, und das ist kein Zusammenlegen aus
    // Bequemlichkeit: Der Hinweis faellt genau EINMAL je Prozess, also muss
    // der erste Aufruf ohne Basis-URL beide Fragen beantworten. Ein zweiter
    // Schritt davor haette den Merker verbraucht — genau das ist beim ersten
    // Entwurf passiert, und die Pruefung meldete ein leeres Protokoll.
    //
    // Ein falscher Host in einer Mail ist schlechter als kein Knopf: Er sieht
    // aus, als funktioniere er.
    delete process.env.APP_BASE_URL;
    let m;
    const gesammelt = await warnungenVon(async () => { m = await mailer.baueAlarmMail(DATEN); });

    assert.ok(!/\?set=/.test(m.html), 'Ohne bekannte Adresse steht trotzdem ein Link in der Mail.');
    assert.ok(!/Set ansehen/.test(m.html), 'Der Knopf ist da, kann aber nirgends hinfuehren.');
    // Der Rest der Mail bleibt vollstaendig — nur der Knopf fehlt.
    assert.match(m.html, /Marktpreis/, 'Ohne Basis-URL fehlt auf einmal die halbe Mail.');
    assert.match(m.subject, /10179-1/);

    // Genau das fehlte: Marco sah einen fehlenden Knopf, der Betreiber sah
    // nichts. Dieselbe Luecke hat getBaseUrl() in routes/auth.ts laengst
    // geschlossen — mit demselben Mittel.
    assert.ok(gesammelt.some(z => z.includes('APP_BASE_URL')),
      `Kein Hinweis im Protokoll. Gesammelt: ${JSON.stringify(gesammelt)}`);
  });

  await t.test('3. aber nur EINMAL, nicht je Alarm', async () => {
    // Der Preislauf baut die Mail fuer JEDEN gerissenen Alarm. Bei zwanzig
    // Alarmen saehe zwanzigmal dieselbe Zeile aus wie ein Sturm statt wie ein
    // Hinweis. Schritt 2 hat den Hinweis bereits ausgeloest — hier darf keiner
    // mehr kommen.
    delete process.env.APP_BASE_URL;
    const gesammelt = await warnungenVon(async () => {
      for (let i = 0; i < 3; i++) await mailer.baueAlarmMail(DATEN);
    });
    const treffer = gesammelt.filter(z => z.includes('APP_BASE_URL')).length;
    assert.equal(treffer, 0, `Der Hinweis wiederholt sich (${treffer}-mal bei drei Mails).`);
  });

  if (vorher === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = vorher;
});
