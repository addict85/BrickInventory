/**
 * The ZIP export produces a valid archive — with exactly the API that
 * routes/api/settings.ts uses.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PassThrough } = require('node:stream');

/** Builds an archive like routes/api/settings.ts and returns the bytes. */
function zipIt(dateien) {
  const { ZipArchive } = require('archiver');
  return new Promise((fertig, error) => {
    const parts = [];
    const out = new PassThrough();
    out.on('data', c => parts.push(c));
    out.on('end', () => fertig(Buffer.concat(parts)));
    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('error', error);
    archive.pipe(out);
    for (const [name, inhalt] of Object.entries(dateien)) {
      archive.append('\uFEFF' + inhalt, { name });
    }
    archive.finalize().catch(error);
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
    'archiver no longer exports ZipArchive — routes/api/settings.ts relies on it. ' +
      "Before 8.x the same path was called archiver('zip', opts).",
  );
  const a = new mod.ZipArchive({ zlib: { level: 9 } });
  for (const m of ['append', 'pipe', 'finalize', 'on']) {
    assert.equal(typeof a[m], 'function', `The archive lacks ${m}() — exactly what the data export uses.`);
  }
});

test('the data export produces an unpackable ZIP', async () => {
  const b = await zipIt({
    'sets.csv': 'set_number;name\n10294-1;Titanic\n',
    'teile.csv': 'part;color\n3001;Rot\n',
    'minifiguren.csv': 'fig;name\nsw0001;Luke\n',
  });

  assert.equal(b.slice(0, 4).toString('hex'), '504b0304', 'no ZIP header (PK)');
  assert.ok(b.length > 200, `nur ${b.length} Bytes`);

  // The names are in the central directory at the end — if it is missing, the
  // archive is empty for every unpacker.
  const text = b.toString('latin1');
  for (const name of ['sets.csv', 'teile.csv', 'minifiguren.csv']) {
    assert.ok(text.includes(name), `${name} is missing in the archive`);
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
    assert.equal(
      inhalt.slice(0, 3).toString('hex'),
      'efbbbf',
      'The BOM is missing — Excel then reads the umlauts wrongly',
    );
    assert.ok(inhalt.toString('utf8').includes('Titanic'), 'The content did not arrive');
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
    'A glob below version 11 is back. It counts as no longer supported. ' +
      'Whoever pulls it in is at the top of the list — either raise it there or ' +
      'set an overrides entry (until 05.10. there was one at ^13).',
  );
});

test('no minimatch below 11.0.1 in the dependency tree', () => {
  // GHSA-g3hv-75wg-m249 via archiver → readdir-glob; held by the overrides entry.
  // Counter-check (01.11.2026): package-lock.json from e21f747 (minimatch 10.2.6) → red.
  const lock = require(path.join(__dirname, '..', 'package-lock.json'));
  const versions = Object.entries(lock.packages || {})
    .filter(([p]) => p.endsWith('node_modules/minimatch'))
    .map(([p, v]) => [p, v.version.split('.').map(Number)]);
  assert.ok(versions.length > 0, 'minimatch not in the lockfile — does the search still work?');
  const alt = versions
    .filter(([, [a, b, c]]) => a < 11 || (a === 11 && b === 0 && c < 1))
    .map(([p, v]) => `${p}@${v.join('.')}`);
  assert.deepEqual(alt, []);
});
