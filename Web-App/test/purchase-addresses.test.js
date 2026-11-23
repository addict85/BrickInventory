/**
 * The two purchase addresses on the set detail: BrickLink and price comparison.
 *
 * Counter-check (09.11.2026): suchUrl() without encodeURIComponent → red: “the search address masks what goes in”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const P = require('./helpers/sources').buildAndRequire()('src/catalog/priceComparison.js');

test('the search address masks what goes in', () => {
  const u = P.suchUrl('LEGO 75192 Millennium Falcon');
  assert.match(u, /^https:\/\/www\.toppreise\.ch\/produktsuche\?q=/);
  assert.ok(!u.includes(' '), 'spaces are not escaped — the address breaks');
  assert.ok(u.includes('Millennium'), 'The search term got lost on the way');
});

test('empty stays empty — and is therefore NOT a button', () => {
  // An empty string is the statement „there is no address for this".
  // The UIs then hide the button instead of leading to a search for
  // nothing.
  for (const roh of ['', '   ', null, undefined]) {
    assert.equal(P.suchUrl(roh), '', `${JSON.stringify(roh)} yielded an address`);
    assert.equal(P.forSet(roh), '', `${JSON.stringify(roh)} yielded a set address`);
  }
});

test('the variant is dropped, the name is added', () => {
  // „-1" is a Rebrickable peculiarity and stands on no packaging; a
  // price comparison site finds nothing with it. The name, on the other hand, is exactly what
  // is searched for there.
  const mit = decodeURIComponent(P.forSet('75192-1', 'Millennium Falcon'));
  assert.ok(mit.includes('75192 '), `The number is missing or still carries the variant: ${mit}`);
  assert.ok(!mit.includes('75192-1'), 'The variant „-1" is still in it');
  assert.ok(mit.includes('Millennium Falcon'), 'The name is missing');
  assert.ok(mit.includes('LEGO'), 'Without „LEGO" the comparison site finds too much unrelated stuff');

  // Without a name the number remains — better than nothing.
  const ohne = decodeURIComponent(P.forSet('10276-1', null));
  assert.ok(ohne.includes('10276'), ohne);
});

test('the price comparison address exists in exactly ONE place', () => {
  // The guard. Server: only src/catalog/priceComparison.ts; UI and app take the
  // address from the response (preisvergleich_url).
  const wurzel = path.join(__dirname, '..', '..');
  const treffer = [];
  /** @type {[string, (f: string) => boolean][]} */
  const roots = [[path.join(wurzel, 'Web-App'), f => /\.(ts|js)$/.test(f)]];
  for (const [basis, filter] of roots) {
    const stapel = [basis];
    while (stapel.length) {
      const d = stapel.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (['node_modules', '.git', 'build', 'dist'].includes(e.name)) continue;
          stapel.push(p);
          continue;
        }
        if (!filter(e.name) || e.name === 'app.bundle.js') continue;
        if (fs.readFileSync(p, 'utf8').includes('toppreise.ch')) {
          treffer.push(path.relative(wurzel, p));
        }
      }
    }
  }
  assert.deepEqual(
    treffer.sort(),
    [
      path.join('Web-App', 'test', 'purchase-addresses.test.js'),
      path.join('Web-App', 'src/catalog/priceComparison.ts'),
    ].sort(),
    'The address of the price comparison appears in another place. Either ' +
      'it comes from the server there (set detail: preisvergleich_url), or the ' +
      'new place should be listed here — otherwise two versions drift apart.',
  );
});
