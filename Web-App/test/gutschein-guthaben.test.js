/**
 * Die Guthaben-Abfrage — ohne eine einzige Verbindung nach draussen.
 *
 * ── Warum das wichtig ist ───────────────────────────────────────────────────
 *
 * Diese Datei prueft einen Weg, auf dem eine KARTENNUMMER UND EINE PIN zu
 * lego.com gehen. Ein Test, der dabei wirklich hinausruft, wuerde Marcos
 * echte Karte abfragen oder eine erfundene — beides nicht. Deshalb bekommt
 * `holeGuthaben` seinen Abruf INJIZIERT (`opt.abruf`), und jeder Test hier
 * zaehlt mit, welche Adressen angefragt wurden. Nichts geht hinaus.
 *
 * ── Gegenproben (durchgefuehrt, Befunde GEMESSEN) ───────────────────────────
 *
 * Sie stehen am Ende der Datei bei den Zusicherungen, auf die sie wirken.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const G = _req('utils/gutscheinGuthaben.js');

const NUMMER = '5045076374450011166';
const PIN    = '5225';

/**
 * Ein Token, der in fuenf Minuten ablaeuft oder in einer Stunde.
 *
 * Echter JWT-Aufbau (drei Teile, base64url), weil `jwtAblauf` ihn liest —
 * eine erfundene Zeichenkette ergaebe Ablauf 0, und dann waere jeder Test
 * unbeabsichtigt der Fall „Token nicht lesbar".
 */
function token(sekundenGueltig) {
  const kopf = Buffer.from('{"alg":"none"}').toString('base64url');
  const nutz = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + sekundenGueltig,
  })).toString('base64url');
  return `${kopf}.${nutz}.x`;
}

/** Eine Antwort, wie `fetch` sie liefert — nur die vier benutzten Stuecke. */
function antwort({ status = 200, json = {}, text = '', kekse = [] } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (text || JSON.stringify(json)),
    json: async () => json,
    headers: { getSetCookie: () => kekse },
  };
}

const GUTHABEN_ANTWORT = {
  data: { giftCard: { balance: {
    centAmount: 25000, currencyCode: 'CHF', formattedAmount: "CHF 250.00",
  } } },
};

/**
 * Ein Abruf-Doppel: beantwortet die drei Adressen des Ablaufs und schreibt
 * mit, was gefragt wurde.
 *
 * `antworten` erlaubt je Adresse eine eigene Antwort oder eine Liste (dann
 * wird sie in der Reihenfolge der Aufrufe abgearbeitet) — damit laesst sich
 * „erst 401, dann 200" nachstellen, ohne eine Zustandsmaschine zu schreiben.
 */
function doppel(antworten = {}) {
  const protokoll = [];
  const abruf = async (url, init) => {
    protokoll.push({ url, init });
    for (const [muster, wert] of Object.entries(antworten)) {
      if (!url.includes(muster)) continue;
      return Array.isArray(wert) ? (wert.shift() ?? antwort({ status: 500 })) : wert;
    }
    // Vorgabe: Seite laedt, Login gibt einen Keks mit Token, Abfrage liefert
    // 250 CHF.
    if (url.includes('/gift-cards/balance')) return antwort({ text: '<html></html>' });
    if (url.includes('/Login')) return antwort({ kekse: [`gqauth=${token(3600)}; Path=/`] });
    return antwort({ json: GUTHABEN_ANTWORT });
  };
  return { abruf, protokoll };
}

test('Guthaben-Abfrage', async (t) => {

  await t.test('1. der Weg: Seite, Login, Abfrage — und das Ergebnis in Franken', async () => {
    G.vergesseSitzungen();
    const { abruf, protokoll } = doppel();
    const g = await G.holeGuthaben(NUMMER, PIN, { locale: 'de-CH', abruf });
    assert.deepEqual(g, { betrag: 250, waehrung: 'CHF', angezeigt: 'CHF 250.00' },
      'Erwartet 25000 Rappen / 100 = 250 — der Betrag darf NICHT aus dem ' +
      'formatierten Text geparst werden: dort haengt der Tausendertrenner am Land.');
    assert.deepEqual(protokoll.map(p => new URL(p.url).pathname), [
      '/de-ch/gift-cards/balance', '/api/graphql/Login', '/api/graphql/giftCardBalanceQuery',
    ], 'Die drei Schritte des Prototyps, in dieser Reihenfolge');
    // Alle drei Adressen auf demselben, einzigen erlaubten Host.
    for (const p of protokoll) {
      assert.equal(new URL(p.url).host, 'www.lego.com',
        `${p.url} geht an einen anderen Host — hier gehen Nummer und PIN hinaus.`);
    }
  });

  await t.test('2. die Sitzung wird wiederverwendet, nicht je Karte neu aufgebaut', async () => {
    G.vergesseSitzungen();
    const { abruf, protokoll } = doppel();
    await G.holeGuthaben(NUMMER, PIN, { locale: 'de-CH', abruf });
    await G.holeGuthaben('5045076374450022277', '1234', { locale: 'de-CH', abruf });
    const logins = protokoll.filter(p => p.url.includes('/Login')).length;
    assert.equal(logins, 1,
      `${logins} Anmeldungen fuer zwei Karten. Der Gast-Token lebt ~24 Stunden; ` +
      'ihn je Karte neu zu holen waere das Doppelte an Aufrufen gegen einen ' +
      'Endpunkt, der ohnehin gedrosselt werden muss.');
    assert.equal(protokoll.length, 4, 'Erwartet Seite+Login+Abfrage, dann nur Abfrage');
  });

  await t.test('3. ein 401 mit Token AUS DEM VORRAT fuehrt zu genau einem Neuversuch', async () => {
    G.vergesseSitzungen();
    // Erst eine Abfrage, damit eine Sitzung im Vorrat liegt.
    const vorlauf = doppel();
    await G.holeGuthaben(NUMMER, PIN, { locale: 'de-CH', abruf: vorlauf.abruf });

    const { abruf, protokoll } = doppel({
      giftCardBalanceQuery: [antwort({ status: 401 }), antwort({ json: GUTHABEN_ANTWORT })],
    });
    const g = await G.holeGuthaben(NUMMER, PIN, { locale: 'de-CH', abruf });
    assert.equal(g.betrag, 250, 'Der zweite Versuch mit frischer Sitzung muss gelingen');
    const abfragen = protokoll.filter(p => p.url.includes('giftCardBalanceQuery')).length;
    assert.equal(abfragen, 2, `${abfragen} Abfragen — erwartet genau zwei (eine Wiederholung)`);
    assert.equal(protokoll.filter(p => p.url.includes('/Login')).length, 1,
      'Dazwischen gehoert GENAU eine neue Anmeldung');
  });

  await t.test('4. ein 401 mit FRISCHER Sitzung wird nicht wiederholt', async () => {
    G.vergesseSitzungen();
    const { abruf, protokoll } = doppel({
      giftCardBalanceQuery: [antwort({ status: 401 }), antwort({ status: 401 })],
    });
    await assert.rejects(
      () => G.holeGuthaben(NUMMER, PIN, { locale: 'de-CH', abruf }),
      (e) => e instanceof G.NichtAngemeldet,
      'Erwartet NichtAngemeldet');
    assert.equal(protokoll.filter(p => p.url.includes('giftCardBalanceQuery')).length, 1,
      'Ein 401 bei frischer Sitzung heisst: Karte oder PIN stimmt nicht. Ein ' +
      'zweiter Versuch wiederholte nur dieselbe Antwort — und kostete einen Aufruf.');
  });

  await t.test('5. HTTP 403 ist BOT-SCHUTZ und wird nicht wiederholt', async () => {
    G.vergesseSitzungen();
    const { abruf, protokoll } = doppel({
      giftCardBalanceQuery: antwort({ status: 403, text: 'Attention Required! Cloudflare' }),
    });
    await assert.rejects(
      () => G.holeGuthaben(NUMMER, PIN, { locale: 'de-CH', abruf }),
      (e) => e instanceof G.BotSchutz,
      'Erwartet BotSchutz — daran haengt die Pause in der Schranke');
    assert.equal(protokoll.filter(p => p.url.includes('giftCardBalanceQuery')).length, 1);

    // Und schon die SEITE kann 403 geben — dann ist es derselbe Fall.
    G.vergesseSitzungen();
    const b = doppel({ 'gift-cards/balance': antwort({ status: 403, text: 'blocked' }) });
    await assert.rejects(
      () => G.holeGuthaben(NUMMER, PIN, { locale: 'de-CH', abruf: b.abruf }),
      (e) => e instanceof G.BotSchutz,
      'Ein 403 auf der Guthabenseite ist dieselbe Wand wie eines auf dem Endpunkt');
    assert.equal(b.protokoll.length, 1, 'Danach wird nicht weitergefragt');
  });

  await t.test('5b. nach Bot-Schutz beginnt der nächste Versuch mit frischer Sitzung', async () => {
    // ── Woher dieser Fall kommt ───────────────────────────────────────────
    //
    // Marcos Frage: „schlägt cloudflare an, wenn ich 1nen Request pro 30sek
    // für die Guthaben sende oder wird dies noch nicht als Bot eingestuft?"
    // Beim Beantworten fiel diese Lücke auf: Der Sitzungsvorrat hält eine
    // Sitzung, solange ihr Token lebt (~24 h). Die Cookies darin altern
    // schneller — Cloudflares `__cf_bm` lebt etwa 30 Minuten. Ohne das
    // Verwerfen nähme der Versuch NACH der Pause wieder dieselben alten
    // Cookies, bekäme wieder 403 und pausierte wieder: eine Schleife, die nie
    // eine frische Seite lädt.
    G.vergesseSitzungen();

    // 1. Eine Sitzung aufbauen und benutzen.
    const a = doppel();
    await G.holeGuthaben(NUMMER, PIN, { locale: 'de-CH', abruf: a.abruf });
    assert.equal(a.protokoll.filter(p => p.url.includes('/Login')).length, 1,
      'Selbstnachweis: es wurde eine Sitzung aufgebaut');

    // 2. Der Bot-Schutz schlägt zu.
    const b = doppel({ giftCardBalanceQuery: antwort({ status: 403, text: 'blocked' }) });
    await assert.rejects(() => G.holeGuthaben(NUMMER, PIN, { locale: 'de-CH', abruf: b.abruf }),
      (e) => e instanceof G.BotSchutz);
    assert.equal(b.protokoll.filter(p => p.url.includes('/gift-cards/balance')).length, 0,
      'Selbstnachweis: dieser Versuch lief noch über die GEMERKTE Sitzung');

    // 3. Der nächste Versuch (nach der Pause, die hier nicht nachgestellt
    //    wird — sie steht in der Schranke) muss die Seite neu laden.
    const c = doppel();
    await G.holeGuthaben(NUMMER, PIN, { locale: 'de-CH', abruf: c.abruf });
    assert.equal(c.protokoll.filter(p => p.url.includes('/gift-cards/balance')).length, 1,
      'Nach einem Bot-Schutz-Treffer wurde die alte Sitzung weiterbenutzt. Mit ' +
      'abgelaufenen Cookies läuft der nächste Versuch in dieselbe Wand — und ' +
      'die Pause beginnt von vorn, ohne dass je eine frische Seite geladen wird.');
    assert.equal(c.protokoll.filter(p => p.url.includes('/Login')).length, 1,
      'Zur frischen Seite gehört eine frische Anmeldung');
  });

  await t.test('6. die PIN steht in KEINEM Text, der hinausgeht', async () => {
    G.vergesseSitzungen();
    // Der boeseste Fall: Die Gegenseite wirft die Eingabe in ihrer
    // Fehlermeldung zurueck. Ohne verdecke() landete die PIN damit im
    // Serverprotokoll und in der Antwort an den Browser.
    const echo = `Invalid gift card ${NUMMER} with pin ${PIN}`;
    const { abruf } = doppel({
      giftCardBalanceQuery: antwort({ status: 400, text: echo }),
    });
    await assert.rejects(
      () => G.holeGuthaben(NUMMER, PIN, { locale: 'de-CH', abruf }),
      (e) => {
        assert.ok(!e.message.includes(PIN), `Die PIN steht in der Meldung: ${e.message}`);
        assert.ok(!e.message.includes(NUMMER), `Die ganze Nummer steht in der Meldung: ${e.message}`);
        assert.ok(e.message.includes('1166'),
          'Die letzten vier Ziffern DUERFEN stehen — sonst weiss niemand, welche Karte');
        return true;
      });

    // Und derselbe Weg fuer einen GraphQL-Fehler im Rumpf (HTTP 200).
    G.vergesseSitzungen();
    const b = doppel({
      giftCardBalanceQuery: antwort({ json: { errors: [{ message: echo }] } }),
    });
    await assert.rejects(
      () => G.holeGuthaben(NUMMER, PIN, { locale: 'de-CH', abruf: b.abruf }),
      (e) => !e.message.includes(PIN) && !e.message.includes(NUMMER));
  });

  await t.test('7. verdecke() allein — auch ohne Fehlerfall', () => {
    assert.equal(G.verdecke(`Karte ${NUMMER}, PIN ${PIN}`, NUMMER, PIN),
      'Karte …1166, PIN …');
    // Mehrfaches Vorkommen, und eine PIN, die zufaellig IN der Nummer steckt
    // (hier „5045" am Anfang): Beide Ersetzungen muessen vollstaendig sein.
    assert.ok(!G.verdecke(`${NUMMER} ${NUMMER} 5045`, NUMMER, '5045').includes('5045076'),
      'Die Nummer darf nirgends stehenbleiben');
    assert.equal(G.verdecke('nichts dabei', NUMMER, PIN), 'nichts dabei');
    // Ohne PIN (nicht jede Karte hat eine) darf verdecke() nicht stolpern.
    assert.equal(G.verdecke(`Karte ${NUMMER}`, NUMMER, null), 'Karte …1166');
  });

  await t.test('8. das Land kann die Adresse nicht umlenken', async () => {
    // ── Was ich hier erwartet hatte, und was gemessen herauskam ────────────
    //
    // Erwartet: Ein praeparierter Wert wie `../../boese.example.com/x` als
    // Land laesst `holeGuthaben` an der Hostpruefung scheitern.
    // GEMESSEN: Er scheitert NICHT — und das ist die bessere Nachricht. Das
    // Land wird in den PFAD eingesetzt (`https://www.lego.com/<land>/…`), und
    // `new URL()` normalisiert `..` innerhalb des Pfades. Der Host bleibt
    // www.lego.com, egal was im Land steht; eine Umlenkung auf einen fremden
    // Host ist ueber diesen Weg gar nicht moeglich.
    //
    // Die Zusicherung sagt deshalb jetzt das, was wirklich gilt — und nicht
    // mehr das, was ich angenommen hatte.
    G.vergesseSitzungen();
    const { abruf, protokoll } = doppel();
    await G.holeGuthaben(NUMMER, PIN, { locale: '../../boese.example.com/x', abruf })
      .catch(() => null);
    assert.ok(protokoll.length > 0, 'Selbstnachweis: es wurde ueberhaupt abgerufen');
    for (const p of protokoll) {
      assert.equal(new URL(p.url).host, 'www.lego.com',
        `${p.url} geht an einen fremden Host — dann liesse sich mit dem Land ` +
        'bestimmen, wohin Nummer und PIN gehen.');
    }

    // Die Pruefung, die der ROUTE die Absage erlaubt, bevor sie fragt: Ein
    // Land ausserhalb der Liste ergibt eine Adresse, die es bei LEGO nicht
    // gibt — die Absage gehoert vor den Aufruf, nicht in einen 404.
    assert.equal(G.landErlaubt('de-CH'), true);
    assert.equal(G.landErlaubt('../../boese.example.com/x'), false);
    assert.equal(G.landErlaubt('de-XX'), false);
    assert.equal(G.landErlaubt(null), false);
  });

  await t.test('9. das Auswahlfeld der Webapp traegt genau die erlaubten Laender', () => {
    // Zwei Listen fuer eine Sache laufen auseinander: Im HTML steht, was der
    // Mensch waehlen kann, in LAENDER, was die Route annimmt. Waere im HTML
    // ein Land zu viel, bekaeme der Nutzer eine Absage statt eines Guthabens.
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const block = html.slice(html.indexOf('<select id="gutschein-land"'));
    const werte = [...block.slice(0, block.indexOf('</select>'))
      .matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(werte, [...G.LAENDER],
      'Das Auswahlfeld in public/index.html und LAENDER in ' +
      'utils/gutscheinGuthaben.ts sagen Verschiedenes.');
    assert.ok(G.LAENDER.includes(G.LAND_STANDARD),
      'Der Standardwert muss selbst auf der Liste stehen');
  });
});
