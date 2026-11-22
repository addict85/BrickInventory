/**
 * The wanted list that the parts list export sends to BrickLink.
 *
 * ── Counter-checks (MEASURED on 20.10., numbers copied down) ─────────────────
 *
 * Starting point of both files together: `# pass 13 / # fail 0`. Every
 * counter-check is ONE change, reverted afterwards (the files were
 * compared against their backup, `diff` said identical).
 *
 *   A  the XML declaration prepended again (yesterday's state)
 *      → `pass 10 / fail 3`. Red are cases 1, 7 and 9 — not only the
 *        first: the declaration counts in the chunking and also upsets
 *        the size cases.
 *   B  unknown color written as 0 (`Number(p.color) || 0`)
 *      → `pass 12 / fail 1`. Red is exactly case 3.
 *   C  capped in characters instead of bytes (`s.length`)
 *      → `pass 12 / fail 1`. Red is exactly case 8 — case 7 stays green because
 *        its items carry no umlauts. Case 8 exists exactly for that.
 *   D  chunking removed entirely (always one piece)
 *      → `pass 11 / fail 2`. Red are cases 7 and 8.
 * Counter-checks (measured 08.11.2026):
 *   E  `<ITEMTYPE>${p.type}</ITEMTYPE>` without esc() → red: case 5
 *   F  in esc() the replacement for ' deleted → red: case 5b
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const modul = () => import(`file://${path.join(ROOT, 'public', 'js', 'bricklink-xml.js')}`);

test('1. no XML declaration — BrickLink rejects a file with it', async () => {
  const { buildWantedXml } = await modul();
  const xml = buildWantedXml([{ type: 'P', part: '3001', color: 5, qty: 10 }]);
  assert.ok(
    !/<\?xml/i.test(xml),
    `The file starts with an XML declaration:\n${xml.slice(0, 80)}\n` +
      'BrickLink’s help literally says „can not have an XML declaration“. With it ' +
      'the upload fails — and everything here would be green.',
  );
  assert.ok(xml.startsWith('<INVENTORY>'), `Starts with: ${JSON.stringify(xml.slice(0, 30))}`);
  assert.ok(xml.trimEnd().endsWith('</INVENTORY>'));
});

test("2. the required fields are there, with BrickLink's kind codes", async () => {
  const { buildWantedXml } = await modul();
  const xml = buildWantedXml([
    { type: 'P', part: '3001', color: 5, qty: 10 },
    { type: 'M', part: 'cas123', color: null, qty: 1 },
  ]);
  for (const tag of ['ITEMTYPE', 'ITEMID', 'COLOR', 'MINQTY'])
    assert.match(xml, new RegExp(`<${tag}>`), `<${tag}> is missing in:\n${xml}`);
  assert.match(xml, /<ITEMID>3001<\/ITEMID>/);
  assert.match(xml, /<MINQTY>10<\/MINQTY>/);
  // A minifigure has no color. A 0 there would mean “not
  // applicable" at BrickLink — the same as nothing, only longer.
  assert.equal((xml.match(/<COLOR>/g) || []).length, 1, `There is more than one COLOR in the file:\n${xml}`);
});

test('3. an UNKNOWN color is not invented', async () => {
  // The core of the third finding. `null` means “no BrickLink number
  // known" and is something other than 0: 0 is “(Not
  // Applicable)" at BrickLink and BLACK at Rebrickable.
  const { buildWantedXml } = await modul();
  const xml = buildWantedXml([{ type: 'P', part: '3001', color: null, qty: 2 }]);
  assert.ok(!/<COLOR>/.test(xml), `Without a known color there must be no COLOR:\n${xml}`);
  assert.ok(
    !/<COLOR>0<\/COLOR>/.test(xml),
    'A 0 would be a claim — „not applicable“ at BrickLink, black at ' +
      'Rebrickable. Exactly this mix-up spoiled the import ' +
      'on 19.10.',
  );
});

test('4. condition only if it says something', async () => {
  const { buildWantedXml } = await modul();
  assert.ok(
    !/CONDITION/.test(buildWantedXml([{ type: 'P', part: '3001', color: 5, qty: 1, condition: 'X' }])),
    'X is BrickLink’s default („any“); writing it out is the same as ' + 'leaving it out, only longer.',
  );
  assert.match(
    buildWantedXml([{ type: 'P', part: '3001', color: 5, qty: 1, condition: 'N' }]),
    /<CONDITION>N<\/CONDITION>/,
  );
});

test('5. special characters are escaped, and & first', async () => {
  // Part numbers come from the stock; for a manually entered part a
  // human typed it. An `&` in it would otherwise make the whole file
  // unreadable — because of ONE character in ONE line.
  const { buildWantedXml } = await modul();
  const xml = buildWantedXml([{ type: 'P', part: 'x<&"1', color: 5, qty: 1 }]);
  assert.match(xml, /<ITEMID>x&lt;&amp;&quot;1<\/ITEMID>/, `Escaped wrongly:\n${xml}`);
  // The order: if & is not replaced first, `<` first becomes `&lt;`
  // and then `&amp;lt;` — BrickLink then literally showed “&lt;".
  assert.ok(!/&amp;lt;|&amp;quot;/.test(xml), `Escaped twice:\n${xml}`);
  // The kind too: every text field goes through esc(), not only the number.
  assert.match(buildWantedXml([{ type: 'P<&', part: '1', color: 5, qty: 1 }]), /<ITEMTYPE>P&lt;&amp;<\/ITEMTYPE>/);
});

test('5b. esc() knows all five XML entities — the wishlist has no escaper of its own', async () => {
  const { esc } = await import(`file://${path.join(ROOT, 'public', 'js', 'escaping.js')}`);
  assert.equal(esc(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('6. the quantity is at least 1', async () => {
  const { buildWantedXml } = await modul();
  assert.match(
    buildWantedXml([{ type: 'P', part: '3001', color: 5, qty: 0 }]),
    /<MINQTY>1<\/MINQTY>/,
    'MINQTY 0 does not exist — BrickLink would reject the line.',
  );
});

test('7. lists that are too large are cut into pieces BrickLink accepts', async () => {
  const { buildWantedXml, buildWantedXmlPieces, BL_UPLOAD_MAX_BYTES } = await modul();
  // 3000 items are reachable: a parts list from several big sets
  // easily gets there, and every missing part is a line.
  const alle = Array.from({ length: 3000 }, (_, i) => ({
    type: 'P',
    part: `300${i % 10}`,
    color: (i % 60) + 1,
    qty: (i % 9) + 1,
  }));
  assert.ok(
    Buffer.byteLength(buildWantedXml(alle)) > BL_UPLOAD_MAX_BYTES,
    'Precondition: the list must be above the limit, otherwise this ' + 'case does not check the splitting.',
  );

  const stuecke = buildWantedXmlPieces(alle);
  assert.ok(stuecke.length > 1, `Only ${stuecke.length} chunks for ${alle.length} items`);
  for (const [i, s] of stuecke.entries()) {
    assert.ok(
      Buffer.byteLength(s) <= BL_UPLOAD_MAX_BYTES,
      `Chunk ${i + 1} is ${Buffer.byteLength(s)} bytes, allowed are ` +
        `${BL_UPLOAD_MAX_BYTES} — BrickLink rejects it.`,
    );
    assert.ok(
      s.startsWith('<INVENTORY>') && s.trimEnd().endsWith('</INVENTORY>'),
      `Chunk ${i + 1} is not a complete file — a chunk must be ` +
        'uploadable on its own, otherwise the splitting is worthless.',
    );
    assert.ok(!/<\?xml/i.test(s), `Chunk ${i + 1} carries an XML declaration`);
  }
  const summe = stuecke.reduce((n, s) => n + (s.match(/<ITEM>/g) || []).length, 0);
  assert.equal(
    summe,
    alle.length,
    `${summe} items in the chunks instead of ${alle.length} — while cutting ` + 'something got lost or landed twice.',
  );
});

test('8. measured in bytes, not in characters', async () => {
  // A part name with an umlaut becomes more bytes in UTF-8 than it has characters.
  // Whoever caps in characters delivers pieces BrickLink rejects — and
  // only with umlauts, i.e. exactly in Marco's language.
  const { buildWantedXmlPieces } = await modul();
  const grenze = 20000;
  const items = Array.from({ length: 400 }, (_, i) => ({
    type: 'P',
    part: `grösser-türkis-weiss-${i}`,
    color: 4,
    qty: 1,
  }));
  const stuecke = buildWantedXmlPieces(items, grenze);
  assert.ok(stuecke.length > 1, 'Precondition: it must be cut');
  for (const [i, s] of stuecke.entries())
    assert.ok(
      Buffer.byteLength(s) <= grenze,
      `Chunk ${i + 1}: ${Buffer.byteLength(s)} bytes for ${s.length} characters — ` +
        `limit ${grenze}. Apparently it was measured in characters.`,
    );
});

test('9. an empty list yields a valid, empty file', async () => {
  // The opposite direction: without this case an empty array would also be “in
  // order" — and the export would offer a download without content.
  const { buildWantedXmlPieces } = await modul();
  const stuecke = buildWantedXmlPieces([]);
  assert.equal(stuecke.length, 1, 'Exactly one file, even if it is empty');
  assert.match(stuecke[0], /^<INVENTORY>[\s\S]*<\/INVENTORY>\s*$/);
  assert.equal((stuecke[0].match(/<ITEM>/g) || []).length, 0);
});
