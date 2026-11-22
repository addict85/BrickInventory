/**
 * The balance query — without a single connection to the outside.
 *
 * ── Counter-checks (carried out, findings MEASURED) ───────────────────────────
 *
 * They stand at the end of the file with the assertions they act on.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const G = _req('src/vouchers/balanceLookup.js');
/** The session store that the compartment of the voucher services otherwise holds. */
const stockList = new Map();

const NUMBER = '5045076374450011166';
const PIN = '5225';

/**
 * A token that expires in five minutes or in one hour.
 *
 * Real JWT structure (three parts, base64url), because `jwtAblauf` reads it —
 * an invented string would give expiry 0, and then every test would
 * unintentionally be the case „token not readable".
 */
function token(secondsValid) {
  const kopf = Buffer.from('{"alg":"none"}').toString('base64url');
  const useIt = Buffer.from(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + secondsValid,
    }),
  ).toString('base64url');
  return `${kopf}.${useIt}.x`;
}

/** A response as `fetch` delivers it — only the four pieces used. */
function response({ status = 200, json = {}, text = '', cookies = [] } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text || JSON.stringify(json),
    json: async () => json,
    headers: { getSetCookie: () => cookies },
  };
}

const BALANCE_RESPONSE = {
  data: {
    giftCard: {
      balance: {
        centAmount: 25000,
        currencyCode: 'CHF',
        formattedAmount: 'CHF 250.00',
      },
    },
  },
};

/**
 * A fetch double: answers the three addresses of the flow and records
 * what was asked.
 *
 * `antworten` allows its own response per address or a list (then
 * it is worked through in the order of the calls) — that way
 * „first 401, then 200" can be recreated without writing a state machine.
 */
function double(antworten = {}) {
  const protokoll = [];
  const abruf = async (url, init) => {
    protokoll.push({ url, init });
    for (const [muster, wert] of Object.entries(antworten)) {
      if (!url.includes(muster)) continue;
      return Array.isArray(wert) ? (wert.shift() ?? response({ status: 500 })) : wert;
    }
    // Default: page loads, login gives a cookie with a token, query delivers
    // 250 CHF.
    if (url.includes('/gift-cards/balance')) return response({ text: '<html></html>' });
    if (url.includes('/Login')) return response({ cookies: [`gqauth=${token(3600)}; Path=/`] });
    return response({ json: BALANCE_RESPONSE });
  };
  return { abruf, protokoll };
}

test('balance query', async t => {
  await t.test('1. the path: page, login, query — and the result in francs', async () => {
    stockList.clear();
    const { abruf, protokoll } = double();
    const g = await G.fetchBalance(stockList, NUMBER, PIN, { locale: 'de-CH', fetch: abruf });
    assert.deepEqual(
      g,
      { amount: 250, currency: 'CHF', formatted: 'CHF 250.00' },
      'Erwartet 25000 Rappen / 100 = 250 — der Betrag darf NICHT aus dem ' +
        'formatierten Text geparst werden: dort haengt der Tausendertrenner am Land.',
    );
    assert.deepEqual(
      protokoll.map(p => new URL(p.url).pathname),
      ['/de-ch/gift-cards/balance', '/api/graphql/Login', '/api/graphql/giftCardBalanceQuery'],
      'Die drei Schritte des Prototyps, in dieser Reihenfolge',
    );
    // All three addresses on the same, single allowed host.
    for (const p of protokoll) {
      assert.equal(
        new URL(p.url).host,
        'www.lego.com',
        `${p.url} geht an einen anderen Host — hier gehen Nummer und PIN hinaus.`,
      );
    }
  });

  await t.test('2. the session is reused, not rebuilt per card', async () => {
    stockList.clear();
    const { abruf, protokoll } = double();
    await G.fetchBalance(stockList, NUMBER, PIN, { locale: 'de-CH', fetch: abruf });
    await G.fetchBalance(stockList, '5045076374450022277', '1234', { locale: 'de-CH', fetch: abruf });
    const logins = protokoll.filter(p => p.url.includes('/Login')).length;
    assert.equal(
      logins,
      1,
      `${logins} Anmeldungen fuer zwei Karten. Der Gast-Token lebt ~24 Stunden; ` +
        'ihn je Karte neu zu holen waere das Doppelte an Aufrufen gegen einen ' +
        'Endpunkt, der ohnehin gedrosselt werden muss.',
    );
    assert.equal(protokoll.length, 4, 'Erwartet Seite+Login+Abfrage, dann nur Abfrage');
  });

  await t.test('3. a 401 with a token FROM THE POOL leads to exactly one retry', async () => {
    stockList.clear();
    // First one query, so that a session lies in the store.
    const leadTime = double();
    await G.fetchBalance(stockList, NUMBER, PIN, { locale: 'de-CH', fetch: leadTime.abruf });

    const { abruf, protokoll } = double({
      giftCardBalanceQuery: [response({ status: 401 }), response({ json: BALANCE_RESPONSE })],
    });
    const g = await G.fetchBalance(stockList, NUMBER, PIN, { locale: 'de-CH', fetch: abruf });
    assert.equal(g.amount, 250, 'Der zweite Versuch mit frischer Sitzung muss gelingen');
    const queryList = protokoll.filter(p => p.url.includes('giftCardBalanceQuery')).length;
    assert.equal(queryList, 2, `${queryList} Abfragen — erwartet genau zwei (eine Wiederholung)`);
    assert.equal(
      protokoll.filter(p => p.url.includes('/Login')).length,
      1,
      'Dazwischen gehoert GENAU eine neue Anmeldung',
    );
  });

  await t.test('4. a 401 with a FRESH session is not retried', async () => {
    stockList.clear();
    const { abruf, protokoll } = double({
      giftCardBalanceQuery: [response({ status: 401 }), response({ status: 401 })],
    });
    await assert.rejects(
      () => G.fetchBalance(stockList, NUMBER, PIN, { locale: 'de-CH', fetch: abruf }),
      e => e instanceof G.NotLoggedIn,
      'Erwartet NichtAngemeldet',
    );
    assert.equal(
      protokoll.filter(p => p.url.includes('giftCardBalanceQuery')).length,
      1,
      'Ein 401 bei frischer Sitzung heisst: Karte oder PIN stimmt nicht. Ein ' +
        'zweiter Versuch wiederholte nur dieselbe Antwort — und kostete einen Aufruf.',
    );
  });

  await t.test('5. HTTP 403 is BOT PROTECTION and is not retried', async () => {
    stockList.clear();
    const { abruf, protokoll } = double({
      giftCardBalanceQuery: response({ status: 403, text: 'Attention Required! Cloudflare' }),
    });
    await assert.rejects(
      () => G.fetchBalance(stockList, NUMBER, PIN, { locale: 'de-CH', fetch: abruf }),
      e => e instanceof G.BotProtection,
      'Erwartet BotSchutz — daran haengt die Pause in der Schranke',
    );
    assert.equal(protokoll.filter(p => p.url.includes('giftCardBalanceQuery')).length, 1);

    // And already the PAGE can give 403 — then it is the same case.
    stockList.clear();
    const b = double({ 'gift-cards/balance': response({ status: 403, text: 'blocked' }) });
    await assert.rejects(
      () => G.fetchBalance(stockList, NUMBER, PIN, { locale: 'de-CH', fetch: b.abruf }),
      e => e instanceof G.BotProtection,
      'Ein 403 auf der Guthabenseite ist dieselbe Wand wie eines auf dem Endpunkt',
    );
    assert.equal(b.protokoll.length, 1, 'Danach wird nicht weitergefragt');
  });

  await t.test('5b. after bot protection the next attempt starts with a fresh session', async () => {
    // Where this case comes from
    stockList.clear();

    // 1. Build up a session and use it.
    const a = double();
    await G.fetchBalance(stockList, NUMBER, PIN, { locale: 'de-CH', fetch: a.abruf });
    assert.equal(
      a.protokoll.filter(p => p.url.includes('/Login')).length,
      1,
      'Selbstnachweis: es wurde eine Sitzung aufgebaut',
    );

    // 2. The bot protection strikes.
    const b = double({ giftCardBalanceQuery: response({ status: 403, text: 'blocked' }) });
    await assert.rejects(
      () => G.fetchBalance(stockList, NUMBER, PIN, { locale: 'de-CH', fetch: b.abruf }),
      e => e instanceof G.BotProtection,
    );
    assert.equal(
      b.protokoll.filter(p => p.url.includes('/gift-cards/balance')).length,
      0,
      'Selbstnachweis: dieser Versuch lief noch über die GEMERKTE Sitzung',
    );

    // 3. The next attempt (after the pause, which is not recreated
    //    here — it stands in the throttle) must reload the page.
    const c = double();
    await G.fetchBalance(stockList, NUMBER, PIN, { locale: 'de-CH', fetch: c.abruf });
    assert.equal(
      c.protokoll.filter(p => p.url.includes('/gift-cards/balance')).length,
      1,
      'Nach einem Bot-Schutz-Treffer wurde die alte Sitzung weiterbenutzt. Mit ' +
        'abgelaufenen Cookies läuft der nächste Versuch in dieselbe Wand — und ' +
        'die Pause beginnt von vorn, ohne dass je eine frische Seite geladen wird.',
    );
    assert.equal(
      c.protokoll.filter(p => p.url.includes('/Login')).length,
      1,
      'Zur frischen Seite gehört eine frische Anmeldung',
    );
  });

  await t.test('6. the PIN is in NO text that goes out', async () => {
    stockList.clear();
    // The nastiest case: the other side throws the input back in its
    // error message. Without verdecke() the PIN would thereby end up in the
    // server log and in the response to the browser.
    const echo = `Invalid gift card ${NUMBER} with pin ${PIN}`;
    const { abruf } = double({
      giftCardBalanceQuery: response({ status: 400, text: echo }),
    });
    await assert.rejects(
      () => G.fetchBalance(stockList, NUMBER, PIN, { locale: 'de-CH', fetch: abruf }),
      (/** @type {any} */ e) => {
        assert.ok(!e.message.includes(PIN), `Die PIN steht in der Meldung: ${e.message}`);
        assert.ok(!e.message.includes(NUMBER), `Die ganze Nummer steht in der Meldung: ${e.message}`);
        assert.ok(
          e.message.includes('1166'),
          'Die letzten vier Ziffern DUERFEN stehen — sonst weiss niemand, welche Karte',
        );
        return true;
      },
    );

    // And the same path for a GraphQL error in the body (HTTP 200).
    stockList.clear();
    const b = double({
      giftCardBalanceQuery: response({ json: { errors: [{ message: echo }] } }),
    });
    await assert.rejects(
      () => G.fetchBalance(stockList, NUMBER, PIN, { locale: 'de-CH', fetch: b.abruf }),
      (/** @type {any} */ e) => !e.message.includes(PIN) && !e.message.includes(NUMBER),
    );
  });

  await t.test('7. verdecke() alone — even without an error case', () => {
    assert.equal(G.redact(`Karte ${NUMBER}, PIN ${PIN}`, NUMBER, PIN), 'Karte …1166, PIN …');
    // Multiple occurrences, and a PIN that happens to sit IN the number
    // (here „5045" at the beginning): both replacements must be complete.
    assert.ok(
      !G.redact(`${NUMBER} ${NUMBER} 5045`, NUMBER, '5045').includes('5045076'),
      'Die Nummer darf nirgends stehenbleiben',
    );
    assert.equal(G.redact('nichts dabei', NUMBER, PIN), 'nichts dabei');
    // Without a PIN (not every card has one) verdecke() must not stumble.
    assert.equal(G.redact(`Karte ${NUMBER}`, NUMBER, null), 'Karte …1166');
  });

  await t.test('8. the country cannot redirect the address', async () => {
    // What I had expected here, and what came out when measured
    stockList.clear();
    const { abruf, protokoll } = double();
    await G.fetchBalance(stockList, NUMBER, PIN, { locale: '../../boese.example.com/x', fetch: abruf }).catch(
      () => null,
    );
    assert.ok(protokoll.length > 0, 'Selbstnachweis: es wurde ueberhaupt abgerufen');
    for (const p of protokoll) {
      assert.equal(
        new URL(p.url).host,
        'www.lego.com',
        `${p.url} geht an einen fremden Host — dann liesse sich mit dem Land ` +
          'bestimmen, wohin Nummer und PIN gehen.',
      );
    }

    // The check that allows the ROUTE to refuse before it asks: a
    // country outside the list results in an address that does not exist at LEGO
    // — the refusal belongs before the call, not into a 404.
    assert.equal(G.countryAllowed('de-CH'), true);
    assert.equal(G.countryAllowed('../../boese.example.com/x'), false);
    assert.equal(G.countryAllowed('de-XX'), false);
    assert.equal(G.countryAllowed(null), false);
  });

  await t.test('5c. a login with errors in the body continues as LoginAbgelehnt', async () => {
    // Counter-check (14.11.2026): `throw e` deleted in the catch of baueSitzung → red (guest token error).
    stockList.clear();
    const { abruf } = double({ Login: response({ json: { errors: [{ message: 'gesperrt' }] } }) });
    await assert.rejects(
      () => G.fetchBalance(stockList, NUMBER, PIN, { locale: 'de-CH', fetch: abruf }),
      e => e instanceof G.LoginRejected && String(Object(e).message) === 'Login: gesperrt',
    );
  });

  await t.test("9. the web app's select field carries exactly the allowed countries", () => {
    // Two lists for one thing drift apart: the HTML holds what the
    // human can choose, LAENDER what the route accepts. If the HTML had
    // one country too many, the user would get a refusal instead of a balance.
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const block = html.slice(html.indexOf('<select id="voucher-country"'));
    const values = [...block.slice(0, block.indexOf('</select>')).matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(
      values,
      [...G.COUNTRIES],
      'Das Auswahlfeld in public/index.html und LAENDER in ' + 'src/vouchers/balanceLookup.ts sagen Verschiedenes.',
    );
    assert.ok(G.COUNTRIES.includes(G.DEFAULT_COUNTRY), 'Der Standardwert muss selbst auf der Liste stehen');
  });
});
