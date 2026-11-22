/**
 * The index of the fix history and the parts in CHANGELOG/ must match.
 *
 * Counter-check: a file name in the table of CHANGELOG-fixes.md misspelled → red “every part is in the index and vice versa”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROOT } = require('./helpers/sources');
const INDEX = path.join(ROOT, 'CHANGELOG-fixes.md');
const DIR = path.join(ROOT, 'CHANGELOG');

/** The file names the table in the index names. */
function fromTable() {
  const src = fs.readFileSync(INDEX, 'utf8');
  return [...src.matchAll(/^\|\s*\[([^\]]+\.md)\]\(CHANGELOG\/[^)]+\)/gm)].map(m => m[1]);
}

/** The files that really exist. */
function onDisk() {
  return fs
    .readdirSync(DIR)
    .filter(f => f.endsWith('.md'))
    .sort();
}

test('every part is in the index and vice versa', () => {
  const tabelle = fromTable().sort();
  const disk = onDisk();

  assert.ok(disk.length >= 5, `Nur ${disk.length} Teile gefunden — liegt die Historie noch in CHANGELOG/?`);
  assert.deepEqual(tabelle, disk, 'Tabelle in CHANGELOG-fixes.md und Ordner CHANGELOG/ laufen auseinander');
});

test('no addendum is in two parts', () => {
  const gesehen = new Map(); // number → file
  const doppelt = [];
  for (const f of onDisk()) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    for (const m of src.matchAll(/^## Nachtrag (\d+)\b/gm)) {
      const n = Number(m[1]);
      if (gesehen.has(n)) doppelt.push(`Nachtrag ${n}: ${gesehen.get(n)} und ${f}`);
      else gesehen.set(n, f);
    }
  }
  assert.deepEqual(doppelt, [], `Nachtrag mehrfach abgelegt:\n  ${doppelt.join('\n  ')}`);

  // Lower bound for the same reason as in require-exports.test.js: if the
  // search pattern breaks (say because headings are named differently), this rule would
  // silently check nothing anymore and stay green.
  assert.ok(gesehen.size > 100, `Nur ${gesehen.size} nummerierte Nachträge gefunden — greift das Muster noch?`);
});

test('the file name matches the content', () => {
  // The occasion: when adding entries 148–153, entries
  // 151, 152 and 153 landed in `12-nachtraege-126-150.md`. All previous checks
  // stayed green — the numbers did not overlap, every file was in the
  // index, every reference was right. Only the file was named something other than …
  const daneben = [];
  for (const f of onDisk()) {
    const spanne = f.match(/nachtraege-(\d+)-(\d+)\.md$/);
    if (!spanne) continue; // 01-frueh-N.md
    const [von, bis] = [Number(spanne[1]), Number(spanne[2])];
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    for (const m of src.matchAll(/^## Nachtrag (\d+)\b/gm)) {
      const n = Number(m[1]);
      if (n < von || n > bis) daneben.push(`${f} enthält Nachtrag ${n} (Spanne ${von}–${bis})`);
    }
  }
  assert.deepEqual(
    daneben,
    [],
    'Eintrag in der falschen Datei — beim Überschreiten einer Fünfundzwanziger-' +
      'Grenze gehört eine neue Datei angelegt:\n  ' +
      daneben.join('\n  '),
  );
});

test('every part names at the start where it belongs', () => {
  const ohne = onDisk().filter(
    f => !fs.readFileSync(path.join(DIR, f), 'utf8').slice(0, 400).includes('CHANGELOG-fixes.md'),
  );
  assert.deepEqual(ohne, [], 'Diese Teile verweisen nicht zurück auf den Index: ' + ohne.join(', '));
});

test('the index itself stays short', () => {
  // The whole purpose of the split. 20 KB is generous — the table grows
  // by one line per 25 addenda.
  const kb = fs.statSync(INDEX).size / 1024;
  assert.ok(
    kb < 20,
    `CHANGELOG-fixes.md ist wieder auf ${kb.toFixed(0)} KB gewachsen — ` +
      'gehören die neuen Einträge in einen Teil unter CHANGELOG/?',
  );
});
