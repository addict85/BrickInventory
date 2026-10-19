/**
 * Aus dem Bestand eine BrickLink-Wanted-Liste bauen.
 *
 * ── Marcos Frage vom 19.10. ─────────────────────────────────────────────────
 *
 *   „Kannst du auch prüfen ob es nicht eine api mit bricklink gibt damit die
 *    wanted listen direkt gelesen und Importiert werden können oder aus den
 *    Teileliste direkt die Teile in eine existierende oder neue wanted list
 *    exportiert werden können"
 *
 * Geprüft, und die Antwort steht im Kopf von utils/wantedListeSchreiben.ts:
 * Die BrickLink-Store-API hat keine Wanted-Listen. Der dokumentierte Weg ist
 * der Massen-Upload, und der nimmt BrickLinks eigenes XML.
 *
 * ── Die drei Stellen, an denen man dieses Format falsch macht ───────────────
 *
 * Alle drei haben hier einen eigenen Fall, weil BrickLink in allen drei
 * Fällen die DATEI ABLEHNT — und zwar beim Hochladen, nicht hier:
 *
 *   1. Eine XML-Deklaration (`<?xml …?>`) ist VERBOTEN. Unsere eigenen
 *      Testvorlagen für den LESER tragen eine (test/wanted-liste-db.test.js),
 *      weil der sie verträgt. Wer sie von dort übernimmt, baut sie ein.
 *   2. Höchstens 204 800 Bytes je Upload (BrickLink-Hilfe 207).
 *   3. COLOR gehört zu Teilen. Für ein Set wäre sie sinnlos, und eine 0
 *      heisst dort „not applicable" — bei Rebrickable aber SCHWARZ.
 *
 * Dieser Test braucht KEINE Datenbank: Er prüft das Umformen, nicht das
 * Nachschlagen. Die Farbübersetzung (die eine Datenbank braucht) steht in
 * test/wanted-liste-vorschau-db.test.js.
 *
 * ── Gegenproben (am 19.10. GEMESSEN, Zahlen abgeschrieben) ──────────────────
 *
 * Ausgangslage `# pass 11 / # fail 0`. Jede Gegenprobe ist EINE Änderung in
 * utils/wantedListeSchreiben.ts, danach zurückgenommen (die Datei wurde gegen
 * ihre Sicherung verglichen, `diff` sagte identisch).
 *
 *   A  `<?xml version="1.0" encoding="UTF-8"?>` vor das `<INVENTORY>`
 *      → `pass 7 / fail 4`. Rot sind die Fälle 1, 9, 10 und 11 — nicht nur
 *        der erste: Die Deklaration zählt bei der Stückelung mit und wirft
 *        auch die Grössenfälle um. Eine Gegenprobe darf mehr treffen als den
 *        Fall, für den sie gedacht war.
 *   B  COLOR immer schreiben (`${p.blFarbe ?? 0}`)
 *      → `pass 10 / fail 1`. Rot ist genau Fall 3: drei COLOR statt einer,
 *        also eine Farbe an Set und Figur.
 *   C  `&` ZULETZT maskiert statt zuerst
 *      → `pass 10 / fail 1`. Rot ist genau Fall 6: aus `<` wird `&amp;lt;`,
 *        BrickLink zeigte wörtlich „&lt;".
 *   D  in Zeichen gedeckelt statt in Bytes (`.length` statt
 *      `Buffer.byteLength`)
 *      → `pass 10 / fail 1`. Rot ist genau Fall 10 — Fall 9 bleibt grün,
 *        weil seine Posten keine Umlaute tragen. Genau deshalb gibt es Fall
 *        10 getrennt.
 *   E  die Untergrenze der Menge entfernt (beide Stellen)
 *      → `pass 10 / fail 1`. Rot ist genau Fall 7: `<MINQTY>0</MINQTY>`.
 *   F  `baueWantedXmlStuecke([])` liefert `[]`
 *      → `pass 10 / fail 1`. Rot ist genau Fall 11.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const { baueWantedXml, baueWantedXmlStuecke, teileZuXmlPosten, BL_UPLOAD_MAX_BYTES } =
  _req('utils/wantedListeSchreiben.js');

const posten = (n) => Array.from({ length: n }, (_, i) => ({
  art: 'part', blId: `300${i % 10}`, blFarbe: (i % 60) + 1, menge: (i % 9) + 1,
}));

test('1. keine XML-Deklaration — BrickLink lehnt eine Datei mit ihr ab', () => {
  const xml = baueWantedXml([{ art: 'part', blId: '3001', blFarbe: 5, menge: 10 }]);
  assert.ok(!/<\?xml/i.test(xml),
    `Die Datei beginnt mit einer XML-Deklaration:\n${xml.slice(0, 80)}\n` +
    'BrickLinks Hilfe sagt wörtlich, ein Wanted-List-XML „can not have an XML ' +
    'declaration". Mit ihr scheitert der Upload — hier wäre alles grün.');
  assert.ok(xml.startsWith('<INVENTORY>'), `Beginnt mit: ${JSON.stringify(xml.slice(0, 30))}`);
  assert.ok(xml.trimEnd().endsWith('</INVENTORY>'));
});

test('2. die vier Pflichtfelder stehen da', () => {
  const xml = baueWantedXml([{ art: 'part', blId: '3001', blFarbe: 5, menge: 10 }]);
  // ITEMTYPE, ITEMID, COLOR, MINQTY — ohne eines davon weist BrickLink die
  // ZEILE ab, und zwar still: Die Datei geht durch, der Posten fehlt.
  for (const tag of ['ITEMTYPE', 'ITEMID', 'COLOR', 'MINQTY']) {
    assert.match(xml, new RegExp(`<${tag}>`), `<${tag}> fehlt in:\n${xml}`);
  }
  assert.match(xml, /<ITEMTYPE>P<\/ITEMTYPE>/, 'Ein Teil ist bei BrickLink „P"');
  assert.match(xml, /<ITEMID>3001<\/ITEMID>/);
  assert.match(xml, /<COLOR>5<\/COLOR>/);
  assert.match(xml, /<MINQTY>10<\/MINQTY>/);
});

test('3. die Artencodes sind die von BrickLink, nicht unsere Wörter', () => {
  const xml = baueWantedXml([
    { art: 'part', blId: '3001', blFarbe: 5, menge: 1 },
    { art: 'fig',  blId: 'cas123', blFarbe: null, menge: 1 },
    { art: 'set',  blId: '10497-1', blFarbe: null, menge: 1 },
  ]);
  assert.match(xml, /<ITEMTYPE>P<\/ITEMTYPE>/);
  assert.match(xml, /<ITEMTYPE>M<\/ITEMTYPE>/, 'Eine Minifigur ist „M", nicht „F" oder „fig"');
  assert.match(xml, /<ITEMTYPE>S<\/ITEMTYPE>/);
  // Eine Figur und ein Set haben keine Farbe. Eine 0 dort hiesse bei
  // BrickLink „not applicable" — dasselbe wie nichts, nur länger; bei
  // Rebrickable hiesse sie SCHWARZ. Genau diese Verwechslung hat am 19.10.
  // Marcos Bestand verdorben, nur in der anderen Richtung.
  assert.equal((xml.match(/<COLOR>/g) || []).length, 1,
    `Es steht mehr als eine COLOR in der Datei:\n${xml}`);
});

test('4. WANTEDLISTID trägt die bestehende Liste — leer heisst Standardliste', () => {
  // Marcos Wunsch wörtlich: „in eine existierende oder neue wanted list".
  // Das ist genau dieses Feld: gesetzt → diese Liste, leer → die Vorgabe.
  const ohne = baueWantedXml([{ art: 'part', blId: '3001', blFarbe: 5, menge: 1 }]);
  assert.ok(!/WANTEDLISTID/.test(ohne),
    'Ohne Nummer darf das Feld nicht dastehen — ein leeres <WANTEDLISTID> ' +
    'wäre eine Angabe, die niemand gemacht hat.');
  const mit = baueWantedXml([{ art: 'part', blId: '3001', blFarbe: 5, menge: 1 }], '1234567');
  assert.match(mit, /<WANTEDLISTID>1234567<\/WANTEDLISTID>/);
});

test('5. Zustand nur, wenn er etwas sagt', () => {
  const egal = baueWantedXml([{ art: 'part', blId: '3001', blFarbe: 5, menge: 1, zustand: 'X' }]);
  assert.ok(!/CONDITION/.test(egal),
    'X ist BrickLinks Vorgabe („egal"); sie hinzuschreiben ist dasselbe wie ' +
    'sie weglassen. Dasselbe gilt für null und für Unsinn.');
  const neu = baueWantedXml([{ art: 'part', blId: '3001', blFarbe: 5, menge: 1, zustand: 'N' }]);
  assert.match(neu, /<CONDITION>N<\/CONDITION>/);
});

test('6. Sonderzeichen werden maskiert, und & zuerst', () => {
  // Der Lagerort ist Freitext. „Kiste <A> & B" würde das XML sonst zerreissen,
  // und BrickLink lehnte die ganze Datei ab — wegen eines Ortsnamens.
  const xml = baueWantedXml([{ art: 'part', blId: '3001', blFarbe: 5, menge: 1,
                              notiz: 'Kiste <A> & "B"' }]);
  assert.match(xml, /<REMARKS>Kiste &lt;A&gt; &amp; &quot;B&quot;<\/REMARKS>/,
    `Falsch maskiert:\n${xml}`);
  // Die Reihenfolge: Wird & NICHT zuerst ersetzt, wird aus `<` erst `&lt;`
  // und daraus `&amp;lt;` — BrickLink zeigte dann wörtlich „&lt;".
  assert.ok(!/&amp;lt;|&amp;quot;/.test(xml), `Doppelt maskiert:\n${xml}`);
});

test('7. die Menge kommt aus dem Bestand und ist mindestens 1', () => {
  const p = teileZuXmlPosten([
    { part_number: '3001', color_id: 4, total_quantity: 17 },
    { part_number: '3002', color_id: 7, total_quantity: 0 },
    { part_number: '3003', color_id: null },
  ]);
  assert.deepEqual(p.map(x => x.menge), [17, 1, 1],
    'MINQTY 0 gibt es nicht — BrickLink wies die Zeile ab. Eine fehlende oder ' +
    'leere Menge wird 1, nicht 0.');
  assert.deepEqual(p.map(x => x.blFarbe), [4, 7, null]);
  assert.ok(p.every(x => x.art === 'part'));
});

test('8. der Lagerort reist nur mit, wenn er verlangt wird', () => {
  const zeilen = [{ part_number: '3001', color_id: 4, total_quantity: 2, storage: 'Kiste 3' }];
  assert.equal(teileZuXmlPosten(zeilen)[0].notiz, undefined,
    'Ohne Verlangen gehört der Lagerort nicht in eine Liste, die zu BrickLink ' +
    'hochgeht — das ist eine Angabe über Marcos Wohnung.');
  assert.equal(teileZuXmlPosten(zeilen, { mitLagerort: true })[0].notiz, 'Kiste 3');
});

test('9. zu grosse Listen werden in Stücke geschnitten, die BrickLink annimmt', () => {
  // 2000 Posten sind bei Marco realistisch (seine castle.xml hat 224, eine
  // ganze Teileliste hat mehr). Eine Datei über 204 800 Bytes lehnt BrickLink
  // ab — ohne diese Stückelung also ein Export, der nicht hochladbar ist.
  const alle = posten(2000);
  const einStueck = baueWantedXml(alle);
  assert.ok(Buffer.byteLength(einStueck) > BL_UPLOAD_MAX_BYTES,
    `Die Vorbedingung stimmt nicht: ${Buffer.byteLength(einStueck)} Bytes sind ` +
    'nicht über der Grenze — dann prüft dieser Fall die Stückelung nicht.');

  const stuecke = baueWantedXmlStuecke(alle);
  assert.ok(stuecke.length > 1, `Nur ${stuecke.length} Stück bei ${alle.length} Posten`);
  for (const [i, s] of stuecke.entries()) {
    assert.ok(Buffer.byteLength(s) <= BL_UPLOAD_MAX_BYTES,
      `Stück ${i + 1} ist ${Buffer.byteLength(s)} Bytes gross, erlaubt sind ` +
      `${BL_UPLOAD_MAX_BYTES}. BrickLink lehnt es ab.`);
    assert.ok(s.startsWith('<INVENTORY>') && s.trimEnd().endsWith('</INVENTORY>'),
      `Stück ${i + 1} ist keine vollständige Datei — ein Stück muss für sich ` +
      'hochladbar sein, sonst ist die Stückelung wertlos.');
  }
  // Kein Posten darf verlorengehen oder doppelt auftauchen.
  const summe = stuecke.reduce((n, s) => n + (s.match(/<ITEM>/g) || []).length, 0);
  assert.equal(summe, alle.length,
    `${summe} Posten in den Stücken statt ${alle.length} — beim Schneiden ist ` +
    'etwas verlorengegangen oder doppelt gelandet.');
});

test('10. in Bytes gemessen, nicht in Zeichen', () => {
  // Ein Lagerort „Kiste Grün" wird in UTF-8 zu mehr Bytes als er Zeichen hat.
  // Wer in Zeichen deckelt, liefert Stücke, die BrickLink ablehnt — und zwar
  // nur bei Umlauten, also genau in Marcos Sprache.
  const mitUmlaut = Array.from({ length: 400 }, (_, i) => ({
    art: 'part', blId: `300${i % 10}`, blFarbe: 4, menge: 1,
    notiz: 'Schublade für große Grundplatten — oben rechts, grün',
  }));
  const grenze = 20_000;
  const stuecke = baueWantedXmlStuecke(mitUmlaut, null, grenze);
  for (const [i, s] of stuecke.entries()) {
    assert.ok(Buffer.byteLength(s) <= grenze,
      `Stück ${i + 1}: ${Buffer.byteLength(s)} Bytes bei ${s.length} Zeichen — ` +
      `Grenze ${grenze}. Gemessen wurde offenbar in Zeichen.`);
  }
  assert.ok(stuecke.length > 1, 'Vorbedingung: es muss geschnitten werden');
});

test('11. eine leere Liste ergibt eine gültige, leere Datei', () => {
  // Die Gegenrichtung: Ohne diesen Fall wäre `baueWantedXmlStuecke([])` auch
  // „in Ordnung", wenn es ein leeres Array lieferte — und die Oberfläche
  // zeigte einen Download-Knopf, der eine Datei ohne Inhalt gibt.
  const stuecke = baueWantedXmlStuecke([]);
  assert.equal(stuecke.length, 1, 'Genau eine Datei, auch wenn sie leer ist');
  assert.match(stuecke[0], /^<INVENTORY>[\s\S]*<\/INVENTORY>\s*$/);
  assert.equal((stuecke[0].match(/<ITEM>/g) || []).length, 0);
});
