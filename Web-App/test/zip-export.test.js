/**
 * Der ZIP-Export erzeugt ein gültiges Archiv — mit genau der API, die
 * routes/settings.ts benutzt.
 *
 * ── Warum es diesen Test gibt (Nachtrag 140) ────────────────────────────────
 *
 * `npm install` warnte:
 *     npm warn deprecated glob@10.5.0: Old versions of glob are not supported…
 *
 * glob ist keine eigene Abhängigkeit: archiver → archiver-utils → glob.
 *
 * Der naheliegende Weg — archiver auf 8 heben — wäre ein Bruch gewesen:
 * archiver 8 ist reines ESM und exportiert KEINE Funktion mehr, sondern die
 * Klassen Archiver/ZipArchive. `require('archiver')` liefert dort schlicht
 * kein aufrufbares Modul. Bemerkt habe ich das nur, weil ich nach dem Update
 * ein ZIP erzeugt habe statt bloss die Tests laufen zu lassen — der Export
 * hat keinen Test, der ihn ausführt.
 *
 * Gewählt wurde deshalb ein `overrides`-Eintrag auf glob ^13: archiver bleibt
 * bei 7, die veraltete Abhängigkeit verschwindet. Das ist die kleinere
 * Änderung — aber sie greift in einen fremden Abhängigkeitsbaum ein, und genau
 * deshalb braucht sie einen Test, der den Export WIRKLICH ausführt.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PassThrough } = require('node:stream');

/** Baut ein Archiv wie routes/settings.ts und gibt die Bytes zurück. */
function zippen(dateien) {
  const archiver = require('archiver');
  return new Promise((fertig, fehler) => {
    const teile = [];
    const out = new PassThrough();
    out.on('data', c => teile.push(c));
    out.on('end', () => fertig(Buffer.concat(teile)));
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', fehler);
    archive.pipe(out);
    for (const [name, inhalt] of Object.entries(dateien)) {
      archive.append('\uFEFF' + inhalt, { name });
    }
    archive.finalize().catch(fehler);
  });
}

test('archiver ist als CommonJS-Funktion aufrufbar', () => {
  // Der Bruch, in den ich fast gelaufen wäre: In archiver 8 ist dies ein
  // Objekt mit Klassen, kein aufrufbares Modul. Der Server ist CommonJS.
  const archiver = require('archiver');
  assert.equal(typeof archiver, 'function',
    'archiver ist keine Funktion mehr — vermutlich auf 8.x gehoben. Das ist ' +
    'reines ESM mit anderer API; routes/settings.ts müsste umgeschrieben werden.');
});

test('der Datenexport erzeugt ein entpackbares ZIP', async () => {
  const b = await zippen({
    'sets.csv':         'set_number;name\n10294-1;Titanic\n',
    'teile.csv':        'part;color\n3001;Rot\n',
    'minifiguren.csv':  'fig;name\nsw0001;Luke\n',
  });

  assert.equal(b.slice(0, 4).toString('hex'), '504b0304', 'kein ZIP-Kopf (PK)');
  assert.ok(b.length > 200, `nur ${b.length} Bytes`);

  // Die Namen stehen im zentralen Verzeichnis am Ende — fehlt es, ist das
  // Archiv für jeden Entpacker leer.
  const text = b.toString('latin1');
  for (const name of ['sets.csv', 'teile.csv', 'minifiguren.csv']) {
    assert.ok(text.includes(name), `${name} fehlt im Archiv`);
  }

  // Und wirklich entpacken — nicht nur hineinschauen.
  const os = require('node:os'), fs = require('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-'));
  try {
    const zip = path.join(dir, 'e.zip');
    fs.writeFileSync(zip, b);
    require('node:child_process').execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
    const inhalt = fs.readFileSync(path.join(dir, 'sets.csv'));
    assert.equal(inhalt.slice(0, 3).toString('hex'), 'efbbbf',
      'Das BOM fehlt — Excel liest die Umlaute dann falsch');
    assert.ok(inhalt.toString('utf8').includes('Titanic'), 'Der Inhalt kam nicht an');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('kein veraltetes glob mehr im Abhängigkeitsbaum', () => {
  // Der Auslöser. Wandert glob 10 über eine andere Bibliothek zurück, soll das
  // auffallen — die Warnung im Installationslog liest niemand zuverlässig.
  const lock = require(path.join(__dirname, '..', 'package-lock.json'));
  const alt = Object.entries(lock.packages || {})
    .filter(([p, v]) => p.endsWith('node_modules/glob') && parseInt(v.version) < 11)
    .map(([p, v]) => `${p}@${v.version}`);
  assert.deepEqual(alt, [],
    'Ein glob unter Version 11 ist zurück. Es gilt als nicht mehr unterstützt; ' +
    'der overrides-Eintrag in package.json hält es auf ^13.');
});
