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
 * Der naheliegende Weg — archiver auf 8 heben — wäre damals ein Bruch gewesen:
 * archiver 8 ist `type: module` und exportiert KEINE Funktion mehr, sondern
 * die Klassen Archiver/ZipArchive. Bemerkt habe ich das nur, weil ich nach dem
 * Update ein ZIP erzeugt habe statt bloss die Tests laufen zu lassen — der
 * Export hatte keinen Test, der ihn ausführt. Diese Datei ist die Antwort
 * darauf.
 *
 * Gewählt wurde zunächst ein `overrides`-Eintrag auf glob ^13: archiver blieb
 * bei 7, die veraltete Abhängigkeit verschwand.
 *
 * ── Und jetzt doch auf 8 (05.10.) ───────────────────────────────────────────
 *
 * Marco wollte die Abhängigkeiten auffrischen. Der Umbau ist zwei Zeilen in
 * routes/settings.ts: `archiver('zip', opts)` wird `new ZipArchive(opts)`.
 *
 * NACHGEMESSEN gegen archiver 8.0.0, bevor etwas umgeschrieben wurde:
 *   require('archiver')  → Objekt mit Archiver/JsonArchive/TarArchive/ZipArchive
 *   new ZipArchive(opts) → trägt append, pipe, finalize und on('error')
 *   und erzeugt ein Archiv mit PK-Signatur.
 *
 * Dass CommonJS das ESM-Paket überhaupt holen kann, ist kein Zufall und kein
 * Risiko: `require()` eines ESM-Moduls ist seit Node 22.12 stabil, und wir
 * fahren im Bild wie in der CI Node 26.
 *
 * Die erste Prüfung unten hat deshalb ihre AUSSAGE gewechselt, nicht bloss
 * ihren Wortlaut: Sie hielt fest, dass der Export aus CommonJS heraus
 * benutzbar ist. Das tut sie weiterhin — nur heisst „benutzbar" jetzt
 * „konstruierbar" statt „aufrufbar".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PassThrough } = require('node:stream');

/** Baut ein Archiv wie routes/settings.ts und gibt die Bytes zurück. */
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

test('archiver ist aus CommonJS heraus benutzbar', () => {
  // Die Aussage ist dieselbe geblieben: Der Server ist CommonJS, und was er
  // `require()`t, muss er auch benutzen können. Geändert hat sich, was
  // „benutzen" heisst — in archiver 7 eine Funktion aufrufen, seit 8 eine
  // Klasse konstruieren.
  //
  // Geprüft wird beides und nicht nur der Name: Ein Export, der zwar da ist,
  // sich aber nicht konstruieren lässt, wäre für routes/settings.ts genauso
  // wertlos wie gar keiner.
  const mod = require('archiver');
  assert.equal(typeof mod.ZipArchive, 'function',
    'archiver exportiert kein ZipArchive mehr — routes/settings.ts baut darauf. ' +
    'Vor 8.x hiess derselbe Weg archiver(\'zip\', opts).');
  const a = new mod.ZipArchive({ zlib: { level: 9 } });
  for (const m of ['append', 'pipe', 'finalize', 'on']) {
    assert.equal(typeof a[m], 'function',
      `Dem Archiv fehlt ${m}() — genau das benutzt der Datenexport.`);
  }
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
  //
  // ── Was sich am 05.10. geändert hat ──────────────────────────────────────
  // Der `overrides`-Eintrag auf glob ^13 ist WEG. Er war der Preis dafür, auf
  // archiver 7 zu bleiben; mit archiver 8 zieht GAR NIEMAND mehr glob.
  // Nachgemessen: Eintrag entfernt, neu aufgelöst, kein glob im Baum.
  //
  // Diese Prüfung bleibt und ist jetzt die einzige Absicherung. Das ist kein
  // Verlust, sondern die Umkehrung: Vorher erzwang ein Eingriff in einen
  // fremden Abhängigkeitsbaum das Ergebnis, und die Prüfung bestätigte es.
  // Jetzt stellt die Prüfung fest, wenn es jemand zurückbringt — und dann
  // entscheidet man neu, statt eine Festlegung weiterzuschleppen, die ihren
  // Anlass überlebt hat.
  const lock = require(path.join(__dirname, '..', 'package-lock.json'));
  const alt = Object.entries(lock.packages || {})
    .filter(([p, v]) => p.endsWith('node_modules/glob') && parseInt(v.version) < 11)
    .map(([p, v]) => `${p}@${v.version}`);
  assert.deepEqual(alt, [],
    'Ein glob unter Version 11 ist zurück. Es gilt als nicht mehr unterstützt. ' +
    'Wer es hereinzieht, steht oben in der Liste — entweder dort heben oder ' +
    'einen overrides-Eintrag setzen (bis 05.10. stand einer auf ^13).');
});
