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
      'Expected 25000 cents / 100 = 250 — the amount must NOT be parsed from the ' +
        'formatted text: there the thousands separator depends on the country.',
    );
    assert.deepEqual(
      protokoll.map(p => new URL(p.url).pathname),
      ['/de-ch/gift-cards/balance', '/api/graphql/Login', '/api/graphql/giftCardBalanceQuery'],
      'The three steps of the prototype, in this order',
    );
    // All three addresses on the same, single allowed host.
    for (const p of protokoll) {
      assert.equal(new URL(p.url).host, 'www.lego.com', `${p.url} goes to another host — number and PIN go out here.`);
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
      `${logins} logins for two cards. The guest token lives ~24 hours; ` +
        'fetching it anew per card would double the calls against an ' +
        'endpoint that has to be throttled anyway.',
    );
    assert.equal(protokoll.length, 4, 'Expected page+login+query, then only query');
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
    assert.equal(g.amount, 250, 'The second attempt with a fresh session must succeed');
    const queryList = protokoll.filter(p => p.url.includes('giftCardBalanceQuery')).length;
    assert.equal(queryList, 2, `${queryList} queries — expected exactly two (one retry)`);
    assert.equal(
      protokoll.filter(p => p.url.includes('/Login')).length,
      1,
      'In between there must be EXACTLY one new login',
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
      'Expected NichtAngemeldet',
    );
    assert.equal(
      protokoll.filter(p => p.url.includes('giftCardBalanceQuery')).length,
      1,
      'A 401 with a fresh session means: card or PIN is wrong. A ' +
        'second attempt would only repeat the same answer — and cost a call.',
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
      'Expected BotSchutz — the pause in the gate depends on it',
    );
    assert.equal(protokoll.filter(p => p.url.includes('giftCardBalanceQuery')).length, 1);

    // And already the PAGE can give 403 — then it is the same case.
    stockList.clear();
    const b = double({ 'gift-cards/balance': response({ status: 403, text: 'blocked' }) });
    await assert.rejects(
      () => G.fetchBalance(stockList, NUMBER, PIN, { locale: 'de-CH', fetch: b.abruf }),
      e => e instanceof G.BotProtection,
      'A 403 on the balance page is the same wall as one on the endpoint',
    );
    assert.equal(b.protokoll.length, 1, 'After that no further queries are made');
  });

  await t.test('5b. after bot protection the next attempt starts with a fresh session', async () => {
    // Where this case comes from
    stockList.clear();

    // 1. Build up a session and use it.
    const a = double();
    await G.fetchBalance(stockList, NUMBER, PIN, { locale: 'de-CH', fetch: a.abruf });
    assert.equal(a.protokoll.filter(p => p.url.includes('/Login')).length, 1, 'self-proof: a session was set up');

    // 2. The bot protection strikes.
    const b = double({ giftCardBalanceQuery: response({ status: 403, text: 'blocked' }) });
    await assert.rejects(
      () => G.fetchBalance(stockList, NUMBER, PIN, { locale: 'de-CH', fetch: b.abruf }),
      e => e instanceof G.BotProtection,
    );
    assert.equal(
      b.protokoll.filter(p => p.url.includes('/gift-cards/balance')).length,
      0,
      'self-proof: this attempt still ran via the REMEMBERED session',
    );

    // 3. The next attempt (after the pause, which is not recreated
    //    here — it stands in the throttle) must reload the page.
    const c = double();
    await G.fetchBalance(stockList, NUMBER, PIN, { locale: 'de-CH', fetch: c.abruf });
    assert.equal(
      c.protokoll.filter(p => p.url.includes('/gift-cards/balance')).length,
      1,
      'After a bot protection hit the old session was kept in use. With ' +
        'expired cookies the next attempt runs into the same wall — and ' +
        'the pause starts over, without a fresh page ever being loaded.',
    );
    assert.equal(c.protokoll.filter(p => p.url.includes('/Login')).length, 1, 'A fresh page comes with a fresh login');
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
        assert.ok(!e.message.includes(PIN), `The PIN is in the message: ${e.message}`);
        assert.ok(!e.message.includes(NUMBER), `The whole number is in the message: ${e.message}`);
        assert.ok(e.message.includes('1166'), 'The last four digits MAY stay — otherwise nobody knows which card');
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
      'The number must not remain anywhere',
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
    assert.ok(protokoll.length > 0, 'self-proof: something was fetched at all');
    for (const p of protokoll) {
      assert.equal(
        new URL(p.url).host,
        'www.lego.com',
        `${p.url} goes to a foreign host — then the country could be used ` + 'to decide where number and PIN go.',
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
      'The select field in public/index.html and LAENDER in ' + 'src/vouchers/balanceLookup.ts say different things.',
    );
    assert.ok(G.COUNTRIES.includes(G.DEFAULT_COUNTRY), 'The default value must itself be on the list');
  });
});
