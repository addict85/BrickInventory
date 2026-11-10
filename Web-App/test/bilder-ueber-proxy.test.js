/**
 * Jedes Bild geht über den eigenen Server — sonst blockt die Richtlinie es.
 *
 * ── Gegenprobe (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   Die alte Zeile in 16-merkliste.js wiederhergestellt → rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ohneKommentare } = require('./helpers/sources');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'public', 'js');

/** Felder, die eine FREMDE Adresse tragen können. */
const BILDFELD = /image_url|image_local|imageUrl|set_img_url|thumbUrl\(/;

// Dass die Richtlinie nur img-src 'self' data: blob: erlaubt, prüft sicherheit-querschnitt-db.test.js
// an jeder Antwort des echten Servers; darauf beruht die Regel unten.
test('kein src-Attribut setzt ein Bildfeld ohne imgUrl()/fullUrl() ein', () => {
  const dateien = fs.readdirSync(JS)
    .filter(f => f.endsWith('.js') && f !== 'app.bundle.js');
  assert.ok(dateien.length >= 10, `Nur ${dateien.length} Skripte — greift die Suche noch?`);

  const treffer = [];
  let geprueft = 0;
  for (const name of dateien) {
    const src = ohneKommentare(fs.readFileSync(path.join(JS, name), 'utf8'));
    // src="${ … }" in einem Template — die Form, in der die Oberflächen
    // Bilder schreiben.
    const pruefe = (ausdruck, index) => {
      geprueft++;
      if (!BILDFELD.test(ausdruck)) return;            // kein Bildfeld — egal
      if (/\b(imgUrl|fullUrl)\(/.test(ausdruck)) return;
      treffer.push(`${name}:${src.slice(0, index).split('\n').length}`);
    };
    for (const m of src.matchAll(/\bsrc="\$\{([^}]*(?:\}[^"]*\{[^}]*)*)\}"/g)) pruefe(m[1], m.index);
    // Und die Vorlagen über bildTag({ src: … }) — bis zum Komma auf Klammertiefe 0.
    for (const m of src.matchAll(/bildTag\(\{\s*src:\s*/g)) {
      let i = m.index + m[0].length, tiefe = 0, ausdruck = '';
      for (; i < src.length; i++) {
        const c = src[i];
        if ('([{'.includes(c)) tiefe++;
        else if (')]}'.includes(c)) { if (tiefe === 0) break; tiefe--; }
        else if (c === ',' && tiefe === 0) break;
        ausdruck += c;
      }
      pruefe(ausdruck, m.index);
    }
  }
  assert.ok(geprueft >= 5, `Nur ${geprueft} src-Einsetzungen gefunden — greift die Suche noch?`);
  assert.deepEqual(treffer, [],
    'Hier steht eine Bildadresse ungefiltert im src. Ist sie absolut (CDN), ' +
    "blockt die Richtlinie img-src 'self' das Laden — genau Marcos Befund.");
});
