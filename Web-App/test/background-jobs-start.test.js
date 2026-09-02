/**
 * Die Hintergrundläufe starten wirklich.
 *
 * ── Marcos Befund (Nachtrag 139) ────────────────────────────────────────────
 * „Die Jobs scheinen nicht zu laufen in der webapp."
 *
 * Beim Auslagern der Startstaffel nach startup/backgroundJobs.ts (Nachtrag 134)
 * wanderten zehn `require('./jobs/…')` WORTGLEICH mit. Aus startup/ gesehen
 * gibt es './jobs' nicht — jeder Aufruf warf sofort.
 *
 * Und weil sie in `setTimeout(...)` und `.catch(() => {})` stecken, blieb es
 * STILL: kein Job lief an, kein Fehler im Log. Genau die Bauart, die in
 * Nachtrag 131 schon einmal zugeschlagen hat.
 *
 * Diese Prüfung lädt das Modul und ruft es auf — mit abgefangenen Jobs. Damit
 * ist belegt, dass jeder Start WIRKLICH ankommt, nicht nur, dass sein Name
 * irgendwo im Quelltext steht.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const gestartet = [];
const echtesRequire = Module.prototype.require;

// Die Jobs abfangen, BEVOR das Startmodul geladen wird — es importiert sie am
// Dateikopf, also zählt nur, was vor dem Laden gesetzt ist.
Module.prototype.require = function (name) {
  const m = echtesRequire.apply(this, arguments);
  if (typeof name !== 'string') return m;
  // Ein aufgeloestes Promise, nicht undefined: Die gestaffelten Laeufe werden
  // als `job.run().catch(() => {})` aufgerufen — auf undefined gaebe es kein
  // .catch, und der Fehler flaege NACH dem Test als uncaughtException hoch.
  // Fuer die fuenf sofortigen ist der Rueckgabewert gleichgueltig.
  const merke = (job, fn) => (...args) => { gestartet.push(job); return Promise.resolve(); };
  if (/jobs[/\\]priceJob(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) => k === 'start' ? merke('priceJob') : t[k] });
  if (/jobs[/\\]instructionQueue(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) =>
      k === 'start' ? merke('instructionQueue') :
      k === 'processNext' ? () => {} :
      k === 'enqueue' ? async () => {} : t[k] });
  if (/jobs[/\\]imageQueue(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) => k === 'start' ? merke('imageQueue') : t[k] });
  if (/routes[/\\]imgProxy(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) => k === 'startImgCacheCleanup' ? merke('imgCacheCleanup') : t[k] });
  if (/api_v1[/\\]pdf(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) => k === 'startPdfJobCleanup' ? merke('pdfJobCleanup') : t[k] });

  // ── Auch die GESTAFFELTEN Laeufe abfangen (Nachtrag) ─────────────────────
  //
  // Sie werden unten nicht abgefragt — sie haengen an setTimeout von 10 bis 45
  // Sekunden, und so lange wartet hier niemand. Abgefangen werden muessen sie
  // trotzdem, denn sonst laufen sie WIRKLICH:
  //
  //   [weiter-trotz-fehler] kaufpreis-nachtrag:teile:
  //       Cannot use a pool after calling end on the pool
  //
  // Der Kaufpreis-Nachtrag feuerte nach 45 Sekunden gegen den Pool, den dieser
  // Test laengst geschlossen hatte. Zwei Dinge daran sind schlecht: Er
  // veraendert waehrend des Testlaufs echte Daten in der Testdatenbank
  // (UPDATE parts SET purchase_price=…), und er verstopft genau den Kanal, an
  // dem verschluckte Fehler sichtbar werden — schema-start-ohne-fehler-db
  // horcht darauf.
  //
  // `.unref()` an den Staffeln waere das falsche Mittel: Gemessen haelt ein
  // ref'd Timer aus pg-pool (connectionTimeoutMillis) die Schleife ohnehin am
  // Leben, die Rueckrufe kaemen also trotzdem dran.
  if (/jobs[/\\]purchasePriceBackfill(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) => k === 'run' ? merke('purchasePriceBackfill') : t[k] });
  if (/jobs[/\\]catalogSync(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) => k === 'syncAllMissing' ? merke('catalogSync') : t[k] });
  if (/jobs[/\\]bricksetRetry(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) => k === 'processRetryQueue' ? merke('bricksetRetry') : t[k] });

  // Die drei einmaligen Nachlaeufe. Sie standen bis eben als anonyme Bloecke
  // IM setTimeout und liessen sich deshalb gar nicht abfangen — sie liefen
  // echt, gegen die Testdatenbank und nach Testende gegen einen geschlossenen
  // Pool ("Thumb gen error: Cannot use a pool after calling end on the pool").
  // Als Modul sind sie abfangbar wie alles andere auch.
  if (/jobs[/\\]startNachlaeufe(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) =>
      k === 'anleitungenNachtragen'   ? merke('anleitungenNachtragen') :
      k === 'setBilderNachladen'      ? merke('setBilderNachladen') :
      k === 'vorschaubilderNachtragen' ? merke('vorschaubilderNachtragen') : t[k] });

  // Und die zwei Aufraeumer, die SOFORT loslaufen, ohne abgewartet zu werden:
  //   purge()      -> purgeExpiredTokens()   (utils/auth)
  //   beschneiden() -> purgeAltePreise()     (utils/priceHistory)
  // Beide sind async und stehen ohne await da; sie kamen deshalb erst NACH
  // dem Testende an die Reihe, als der Pool schon zu war:
  //   [tokens] Aufraeumen ungenutzter Tokens: Cannot use a pool after ...
  if (/utils[/\\]auth(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) => k === 'purgeExpiredTokens' ? merke('purgeExpiredTokens') : t[k] });
  if (/utils[/\\]priceHistory(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) => k === 'purgeAltePreise' ? merke('purgeAltePreise') : t[k] });
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();

test('jeder Hintergrundlauf wird tatsächlich angestossen', async (t) => {
  const db = _req('db/database.js');
  // Aufräumen IM NACHLAUF, nicht am Ende des Rumpfes: Sonst bleibt bei einer
  // scheiternden Zusicherung der Pool offen, der Prozess endet nicht, und aus
  // einem roten Test wird ein hängender — der schlechteste aller Ausgänge,
  // weil niemand die Meldung zu sehen bekommt. (Beim Gegenprobieren der
  // Zusicherungen unten ist genau das passiert.)
  t.after(async () => {
    await db.pool.end().catch(() => {});
    Module.prototype.require = echtesRequire;
  });
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }

  gestartet.length = 0;
  await _req('startup/backgroundJobs.js').starteHintergrundlaeufe();

  // Die fünf, die SOFORT starten (die übrigen hängen an setTimeout-Staffeln
  // von 10 bis 45 Sekunden und werden hier nicht abgewartet).
  for (const job of ['imgCacheCleanup', 'pdfJobCleanup', 'priceJob',
                     'instructionQueue', 'imageQueue']) {
    assert.ok(gestartet.includes(job),
      `${job} wurde nicht angestossen. Angekommen sind: ${gestartet.join(', ') || '(nichts)'}. ` +
      'Genau so sah Marcos Ausfall aus — die Aufrufe warfen in einem catch, ' +
      'das nichts meldet.');
  }

  // ── Und die, die OHNE Zeitstaffel loslaufen ────────────────────────────
  //
  // Seit die drei Nachläufe ein Modul sind (jobs/startNachlaeufe.ts), lässt
  // sich auch von ihnen etwas behaupten: Die Vorschaubilder hängen an
  // setImmediate, die zwei Aufräumer werden direkt gerufen. Alle drei sind
  // also nach EINEM Durchlauf der Ereignisschleife da.
  //
  // Das ist der eigentliche Gewinn des Umbaus: Vorher liefen sie echt und
  // liessen sich weder abfangen noch prüfen.
  await new Promise((r) => setImmediate(r));
  for (const job of ['vorschaubilderNachtragen', 'purgeExpiredTokens', 'purgeAltePreise']) {
    assert.ok(gestartet.includes(job),
      `${job} wurde nicht angestossen. Angekommen sind: ${gestartet.join(', ') || '(nichts)'}.`);
  }

});
