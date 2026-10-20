/**
 * Die Wanted-Liste, die der Teileliste-Export zu BrickLink schickt.
 *
 * ── Woher dieser Test kommt ─────────────────────────────────────────────────
 *
 * Marcos Hinweis vom 20.10.: „Den Export gibt es ja ebenfalls in der
 * Teileliste." Er hatte recht — ich hatte danebenher einen zweiten gebaut.
 * Beim Nachsehen im bestehenden (plExportBricklink in js/08-init.js) standen
 * drei Dinge, die erst BEI BRICKLINK auffallen und hier gar nichts anzeigen:
 *
 *   1. Die Datei begann mit `<?xml version="1.0" encoding="UTF-8"?>`.
 *      BrickLinks Hilfe sagt wörtlich, ein Wanted-List-XML „can not have an
 *      XML declaration". Der LESER in js/18-wanted-xml.js verträgt beides —
 *      von dort stammte die Zeile.
 *   2. Keine Grössengrenze. BrickLink nimmt höchstens 204 800 Bytes je
 *      Upload und weist eine grössere Datei GANZ ab.
 *   3. Die Farbe fiel auf die REBRICKABLE-Nummer zurück:
 *          p.bl_color_id ?? _rbToBlColor[p.color_id] ?? p.color_id ?? 0
 *      Fehlte die Zuordnung, ging eine Rebrickable-Farbnummer als
 *      BrickLink-Farbnummer hinaus. Das ergibt eine gültige Datei, die das
 *      FALSCHE Teil bestellt — und das fällt erst auf, wenn das Paket da ist.
 *      Spiegelverkehrt derselbe Fehler, den der Import am 19.10. hatte
 *      (dort wurde `color_id: 0` erfunden, also Schwarz).
 *
 * ── Warum das Bauteil DOM-frei ist ──────────────────────────────────────────
 *
 * js/08-init.js greift schon beim Laden auf das Dokument zu und lässt sich
 * deshalb hier nicht einlesen. Das Format steht darum in
 * js/19-bricklink-xml.js, das nur Daten kennt — eingelesen wie
 * test/bundle-smoke.test.js es mit js/01-core.js macht.
 *
 * Was der AUFRUFER damit tut (welche Posten er weglässt und wie er das
 * meldet), prüft test/teileliste-bl-export.test.js am Quelltext.
 *
 * ── Gegenproben (am 20.10. GEMESSEN, Zahlen abgeschrieben) ──────────────────
 *
 * Ausgangslage beider Dateien zusammen: `# pass 13 / # fail 0`. Jede
 * Gegenprobe ist EINE Änderung, danach zurückgenommen (die Dateien wurden
 * gegen ihre Sicherung verglichen, `diff` sagte identisch).
 *
 *   A  die XML-Deklaration wieder vorangestellt (der Zustand von gestern)
 *      → `pass 10 / fail 3`. Rot sind die Fälle 1, 7 und 9 — nicht nur der
 *        erste: Die Deklaration zählt bei der Stückelung mit und wirft auch
 *        die Grössenfälle um.
 *   B  unbekannte Farbe als 0 geschrieben (`Number(p.color) || 0`)
 *      → `pass 12 / fail 1`. Rot ist genau Fall 3.
 *   C  in Zeichen gedeckelt statt in Bytes (`s.length`)
 *      → `pass 12 / fail 1`. Rot ist genau Fall 8 — Fall 7 bleibt grün, weil
 *        seine Posten keine Umlaute tragen. Genau dafür gibt es Fall 8.
 *   D  die Stückelung ganz entfernt (immer ein Stück)
 *      → `pass 11 / fail 2`. Rot sind die Fälle 7 und 8.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const modul = () => import(`file://${path.join(ROOT, 'public', 'js', '19-bricklink-xml.js')}`);

test('1. keine XML-Deklaration — BrickLink lehnt eine Datei mit ihr ab', async () => {
  const { baueWantedXml } = await modul();
  const xml = baueWantedXml([{ type: 'P', part: '3001', color: 5, qty: 10 }]);
  assert.ok(!/<\?xml/i.test(xml),
    `Die Datei beginnt mit einer XML-Deklaration:\n${xml.slice(0, 80)}\n` +
    'BrickLinks Hilfe sagt wörtlich „can not have an XML declaration". Mit ihr ' +
    'scheitert der Upload — und hier wäre alles grün.');
  assert.ok(xml.startsWith('<INVENTORY>'), `Beginnt mit: ${JSON.stringify(xml.slice(0, 30))}`);
  assert.ok(xml.trimEnd().endsWith('</INVENTORY>'));
});

test('2. die Pflichtfelder stehen da, mit BrickLinks Artencodes', async () => {
  const { baueWantedXml } = await modul();
  const xml = baueWantedXml([
    { type: 'P', part: '3001', color: 5, qty: 10 },
    { type: 'M', part: 'cas123', color: null, qty: 1 },
  ]);
  for (const tag of ['ITEMTYPE', 'ITEMID', 'COLOR', 'MINQTY'])
    assert.match(xml, new RegExp(`<${tag}>`), `<${tag}> fehlt in:\n${xml}`);
  assert.match(xml, /<ITEMID>3001<\/ITEMID>/);
  assert.match(xml, /<MINQTY>10<\/MINQTY>/);
  // Eine Minifigur hat keine Farbe. Eine 0 dort hiesse bei BrickLink „not
  // applicable" — dasselbe wie nichts, nur länger.
  assert.equal((xml.match(/<COLOR>/g) || []).length, 1,
    `Es steht mehr als eine COLOR in der Datei:\n${xml}`);
});

test('3. eine UNBEKANNTE Farbe wird nicht erfunden', async () => {
  // Der Kern des dritten Befunds. `null` heisst „keine BrickLink-Nummer
  // bekannt" und ist etwas anderes als 0: 0 ist bei BrickLink „(Not
  // Applicable)" und bei Rebrickable SCHWARZ.
  const { baueWantedXml } = await modul();
  const xml = baueWantedXml([{ type: 'P', part: '3001', color: null, qty: 2 }]);
  assert.ok(!/<COLOR>/.test(xml),
    `Ohne bekannte Farbe darf kein COLOR dastehen:\n${xml}`);
  assert.ok(!/<COLOR>0<\/COLOR>/.test(xml),
    'Eine 0 wäre eine Behauptung — bei BrickLink „nicht zutreffend", bei ' +
    'Rebrickable Schwarz. Genau diese Verwechslung hat am 19.10. den Import ' +
    'verdorben.');
});

test('4. Zustand nur, wenn er etwas sagt', async () => {
  const { baueWantedXml } = await modul();
  assert.ok(!/CONDITION/.test(baueWantedXml([{ type: 'P', part: '3001', color: 5, qty: 1, condition: 'X' }])),
    'X ist BrickLinks Vorgabe („egal"); sie hinzuschreiben ist dasselbe wie ' +
    'sie wegzulassen, nur länger.');
  assert.match(baueWantedXml([{ type: 'P', part: '3001', color: 5, qty: 1, condition: 'N' }]),
    /<CONDITION>N<\/CONDITION>/);
});

test('5. Sonderzeichen werden maskiert, und & zuerst', async () => {
  // Teilenummern kommen aus dem Bestand; bei einem manuell erfassten Teil hat
  // sie der Mensch getippt. Ein `&` darin machte sonst die ganze Datei
  // unlesbar — wegen EINES Zeichens in EINER Zeile.
  const { baueWantedXml } = await modul();
  const xml = baueWantedXml([{ type: 'P', part: 'x<&"1', color: 5, qty: 1 }]);
  assert.match(xml, /<ITEMID>x&lt;&amp;&quot;1<\/ITEMID>/, `Falsch maskiert:\n${xml}`);
  // Die Reihenfolge: Wird & nicht zuerst ersetzt, wird aus `<` erst `&lt;`
  // und daraus `&amp;lt;` — BrickLink zeigte dann wörtlich „&lt;".
  assert.ok(!/&amp;lt;|&amp;quot;/.test(xml), `Doppelt maskiert:\n${xml}`);
});

test('6. die Menge ist mindestens 1', async () => {
  const { baueWantedXml } = await modul();
  assert.match(baueWantedXml([{ type: 'P', part: '3001', color: 5, qty: 0 }]),
    /<MINQTY>1<\/MINQTY>/,
    'MINQTY 0 gibt es nicht — BrickLink wiese die Zeile ab.');
});

test('7. zu grosse Listen werden in Stücke geschnitten, die BrickLink annimmt', async () => {
  const { baueWantedXml, baueWantedXmlStuecke, BL_UPLOAD_MAX_BYTES } = await modul();
  // 3000 Posten sind erreichbar: Eine Teileliste aus mehreren grossen Sets
  // kommt leicht dorthin, und jedes fehlende Teil ist eine Zeile.
  const alle = Array.from({ length: 3000 }, (_, i) => ({
    type: 'P', part: `300${i % 10}`, color: (i % 60) + 1, qty: (i % 9) + 1,
  }));
  assert.ok(Buffer.byteLength(baueWantedXml(alle)) > BL_UPLOAD_MAX_BYTES,
    'Vorbedingung: die Liste muss über der Grenze liegen, sonst prüft dieser ' +
    'Fall die Stückelung nicht.');

  const stuecke = baueWantedXmlStuecke(alle);
  assert.ok(stuecke.length > 1, `Nur ${stuecke.length} Stück bei ${alle.length} Posten`);
  for (const [i, s] of stuecke.entries()) {
    assert.ok(Buffer.byteLength(s) <= BL_UPLOAD_MAX_BYTES,
      `Stück ${i + 1} ist ${Buffer.byteLength(s)} Bytes gross, erlaubt sind ` +
      `${BL_UPLOAD_MAX_BYTES} — BrickLink lehnt es ab.`);
    assert.ok(s.startsWith('<INVENTORY>') && s.trimEnd().endsWith('</INVENTORY>'),
      `Stück ${i + 1} ist keine vollständige Datei — ein Stück muss für sich ` +
      'hochladbar sein, sonst ist die Stückelung wertlos.');
    assert.ok(!/<\?xml/i.test(s), `Stück ${i + 1} trägt eine XML-Deklaration`);
  }
  const summe = stuecke.reduce((n, s) => n + (s.match(/<ITEM>/g) || []).length, 0);
  assert.equal(summe, alle.length,
    `${summe} Posten in den Stücken statt ${alle.length} — beim Schneiden ist ` +
    'etwas verlorengegangen oder doppelt gelandet.');
});

test('8. in Bytes gemessen, nicht in Zeichen', async () => {
  // Ein Teilename mit Umlaut wird in UTF-8 zu mehr Bytes als er Zeichen hat.
  // Wer in Zeichen deckelt, liefert Stücke, die BrickLink ablehnt — und zwar
  // nur bei Umlauten, also genau in Marcos Sprache.
  const { baueWantedXmlStuecke } = await modul();
  const grenze = 20000;
  const posten = Array.from({ length: 400 }, (_, i) => ({
    type: 'P', part: `grösser-türkis-weiss-${i}`, color: 4, qty: 1,
  }));
  const stuecke = baueWantedXmlStuecke(posten, grenze);
  assert.ok(stuecke.length > 1, 'Vorbedingung: es muss geschnitten werden');
  for (const [i, s] of stuecke.entries())
    assert.ok(Buffer.byteLength(s) <= grenze,
      `Stück ${i + 1}: ${Buffer.byteLength(s)} Bytes bei ${s.length} Zeichen — ` +
      `Grenze ${grenze}. Gemessen wurde offenbar in Zeichen.`);
});

test('9. eine leere Liste ergibt eine gültige, leere Datei', async () => {
  // Die Gegenrichtung: Ohne diesen Fall wäre auch ein leeres Array „in
  // Ordnung" — und der Export böte einen Download ohne Inhalt an.
  const { baueWantedXmlStuecke } = await modul();
  const stuecke = baueWantedXmlStuecke([]);
  assert.equal(stuecke.length, 1, 'Genau eine Datei, auch wenn sie leer ist');
  assert.match(stuecke[0], /^<INVENTORY>[\s\S]*<\/INVENTORY>\s*$/);
  assert.equal((stuecke[0].match(/<ITEM>/g) || []).length, 0);
});
