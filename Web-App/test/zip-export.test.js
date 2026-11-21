/**
 * The ZIP export produces a valid archive — with exactly the API that
 * routes/api_v1/settings.ts uses.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PassThrough } = require('node:stream');

/** Builds an archive like routes/api_v1/settings.ts and returns the bytes. */
function zippen(dateien) {
  const { ZipArchive } = require('archiver');
  return new Promise((fertig, fehler) => {
    const teile = [];
    const out = new PassThrough();
    out.on('data', c => teile.push(c));
    out.on('end', () => fertig(Buffer.concat(teile)));
    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('error', fehler);
    archive.pipe(out);
    for (const [name, inhalt] of Object.entries(dateien)) {
      archive.append('\uFEFF' + inhalt, { name });
    }
    archive.finalize().catch(fehler);
  });
}

test('archiver is usable from CommonJS', () => {
  // The statement has stayed the same: the server is CommonJS, and what it
  // `require()`s, it must also be able to use. What has changed is what
  // "use" means — in archiver 7 calling a function, since 8 constructing a
  // class.
  const mod = require('archiver');
  assert.equal(
    typeof mod.ZipArchive,
    'function',
    'archiver exportiert kein ZipArchive mehr — routes/api_v1/settings.ts baut darauf. ' +
      "Vor 8.x hiess derselbe Weg archiver('zip', opts).",
  );
  const a = new mod.ZipArchive({ zlib: { level: 9 } });
  for (const m of ['append', 'pipe', 'finalize', 'on']) {
    assert.equal(typeof a[m], 'function', `Dem Archiv fehlt ${m}() — genau das benutzt der Datenexport.`);
  }
});

test('the data export produces an unpackable ZIP', async () => {
  const b = await zippen({
    'sets.csv': 'set_number;name\n10294-1;Titanic\n',
    'teile.csv': 'part;color\n3001;Rot\n',
    'minifiguren.csv': 'fig;name\nsw0001;Luke\n',
  });

  assert.equal(b.slice(0, 4).toString('hex'), '504b0304', 'kein ZIP-Kopf (PK)');
  assert.ok(b.length > 200, `nur ${b.length} Bytes`);

  // The names are in the central directory at the end — if it is missing, the
  // archive is empty for every unpacker.
  const text = b.toString('latin1');
  for (const name of ['sets.csv', 'teile.csv', 'minifiguren.csv']) {
    assert.ok(text.includes(name), `${name} fehlt im Archiv`);
  }

  // And really unpack — not just look inside.
  const os = require('node:os'),
    fs = require('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-'));
  try {
    const zip = path.join(dir, 'e.zip');
    fs.writeFileSync(zip, b);
    require('node:child_process').execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
    const inhalt = fs.readFileSync(path.join(dir, 'sets.csv'));
    assert.equal(inhalt.slice(0, 3).toString('hex'), 'efbbbf', 'Das BOM fehlt — Excel liest die Umlaute dann falsch');
    assert.ok(inhalt.toString('utf8').includes('Titanic'), 'Der Inhalt kam nicht an');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('no outdated glob in the dependency tree anymore', () => {
  // The trigger. If glob 10 comes back via another library, that should
  // stand out — nobody reliably reads the warning in the install log.
  const lock = require(path.join(__dirname, '..', 'package-lock.json'));
  const alt = Object.entries(lock.packages || {})
    .filter(([p, v]) => p.endsWith('node_modules/glob') && parseInt(v.version, 10) < 11)
    .map(([p, v]) => `${p}@${v.version}`);
  assert.deepEqual(
    alt,
    [],
    'Ein glob unter Version 11 ist zurück. Es gilt als nicht mehr unterstützt. ' +
      'Wer es hereinzieht, steht oben in der Liste — entweder dort heben oder ' +
      'einen overrides-Eintrag setzen (bis 05.10. stand einer auf ^13).',
  );
});

test('no minimatch below 11.0.1 in the dependency tree', () => {
  // GHSA-g3hv-75wg-m249 via archiver → readdir-glob; held by the overrides entry.
  // Counter-check (01.11.2026): package-lock.json from e21f747 (minimatch 10.2.6) → red.
  const lock = require(path.join(__dirname, '..', 'package-lock.json'));
  const versions = Object.entries(lock.packages || {})
    .filter(([p]) => p.endsWith('node_modules/minimatch'))
    .map(([p, v]) => [p, v.version.split('.').map(Number)]);
  assert.ok(versions.length > 0, 'minimatch nicht im Lockfile — greift die Suche noch?');
  const alt = versions
    .filter(([, [a, b, c]]) => a < 11 || (a === 11 && b === 0 && c < 1))
    .map(([p, v]) => `${p}@${v.join('.')}`);
  assert.deepEqual(alt, []);
});
