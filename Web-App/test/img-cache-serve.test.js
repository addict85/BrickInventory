/**
 * Die Auslieferungsreihenfolge des Bild-Proxys — AUSGEFÜHRT, nicht gelesen.
 *
 * ── Warum (Nachtrag 149) ────────────────────────────────────────────────────
 * `liefereAusCache()` entscheidet bei jeder einzelnen Bildanfrage, was
 * rausgeht: Vorschau, wenn eine brauchbare dasteht; sonst das Original, und
 * die Vorschau wird angestossen; sonst gar nichts, dann holt der Aufrufer beim
 * CDN. Bei einer Kachelwand läuft praktisch jede Anfrage hier durch.
 *
 * Geprüft wurde diese Reihenfolge bisher an drei Stellen im Quelltext
 * (test/img-proxy.test.js, test/parts-paging.test.js, test/thumb-atomic.test.js)
 * — jede sucht nach einem Muster in utils/imgCacheServe.ts. Das fängt, dass
 * jemand die Grössenprüfung LÖSCHT. Es fängt nicht, dass sie danebengreift:
 * ein `<` statt `<=`, eine vertauschte Reihenfolge der beiden Zweige, ein
 * `return` ohne `true`. Genau solche Fehler sind in diesem Modul schon
 * passiert — der Kommentar bei der 304-Behandlung nennt einen davon.
 *
 * Hier läuft die echte Funktion gegen echte Dateien in einem Temp-Verzeichnis.
 * Die Antwort ist ein Attrappen-`res`, das mitschreibt, was gesetzt und
 * gesendet wurde; alles andere ist der Produktivcode.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const { liefereAusCache } = _req('utils/imgCacheServe.js');

/** Ein res, das nur festhält, was mit ihm geschehen ist. */
function attrappeRes() {
  const r = {
    kopf: {}, status: 200, beendet: false, gestreamt: null,
    setHeader(k, v) { this.kopf[k.toLowerCase()] = String(v); },
    status_(c) { this.status = c; return this; },
    end() { this.beendet = true; return this; },
  };
  r.status = function (c) { this._code = c; return this; };
  Object.defineProperty(r, 'code', { get() { return this._code ?? 200; } });
  return r;
}

/** Ein Aufruf von liefereAusCache mit sinnvollen Vorgaben. */
async function ruf(dir, { wantThumb, darfErzeugen = true, fresh = false }) {
  const res = attrappeRes();
  const gestreamt = [];
  const notiert   = [];
  const erledigt = await liefereAusCache({
    res,
    req: { fresh },
    cacheFile: path.join(dir, 'bild'),
    thumbFile: path.join(dir, 'bild_thumb.jpg'),
    wantThumb,
    darfErzeugen,
    notiere: () => notiert.push(1),
    streamFileToResponse: (_res, datei) => gestreamt.push(datei),
  });
  return { erledigt, res, gestreamt, notiert };
}

/** Eine Datei mit `n` Bytes anlegen. */
function datei(p, n) { fs.writeFileSync(p, Buffer.alloc(n, 0x41)); }

test('Auslieferungsreihenfolge des Bild-Caches', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgcache-'));
  const orig  = path.join(dir, 'bild');
  const thumb = path.join(dir, 'bild_thumb.jpg');
  const aufraeumen = () => { for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f)); };

  await t.test('nichts im Cache → der Aufrufer muss beim CDN holen', async () => {
    aufraeumen();
    const { erledigt, gestreamt } = await ruf(dir, { wantThumb: false });
    assert.equal(erledigt, false, 'false heisst: nicht beantwortet, bitte holen');
    assert.deepEqual(gestreamt, []);
  });

  await t.test('Original da, Vorschau gewünscht → Original SOFORT, Vorschau vorgemerkt', async () => {
    aufraeumen();
    datei(orig, 5000);
    const { erledigt, gestreamt, res } = await ruf(dir, { wantThumb: true });
    assert.equal(erledigt, true);
    assert.deepEqual(gestreamt, [orig],
      'Es darf NICHT auf die Verkleinerung gewartet werden — das war einmal ' +
      'rund 150 ms je Bild und bei einer Kachelwand Sekunden');
    assert.equal(res.kopf['content-length'], '5000');
    assert.match(res.kopf['cache-control'] || '', /max-age=86400/);
  });

  await t.test('Vorschau da → Vorschau statt Original', async () => {
    aufraeumen();
    datei(orig, 5000);
    datei(thumb, 900);
    const { gestreamt, res } = await ruf(dir, { wantThumb: true });
    assert.deepEqual(gestreamt, [thumb], 'Die Vorschau hat Vorrang, wenn es sie gibt');
    assert.equal(res.kopf['content-type'], 'image/jpeg');
    assert.equal(res.kopf['content-length'], '900');
  });

  await t.test('Vorschau da, aber NICHT gewünscht → Original', async () => {
    aufraeumen();
    datei(orig, 5000);
    datei(thumb, 900);
    const { gestreamt } = await ruf(dir, { wantThumb: false });
    assert.deepEqual(gestreamt, [orig],
      'Ohne ?thumb=1 gehört das Original raus, auch wenn eine Vorschau daliegt');
  });

  await t.test('Rumpf-Vorschau wird verworfen und das Original geliefert', async () => {
    // Die Grenze liegt bei 200 Bytes. Eine leere oder abgeschnittene Datei ist
    // kein Bild — ausgeliefert sähe sie im Browser als kaputtes Kästchen aus,
    // und zwar dauerhaft, weil sie ja im Cache liegt.
    aufraeumen();
    datei(orig, 5000);
    datei(thumb, 50);
    const { gestreamt } = await ruf(dir, { wantThumb: true });
    assert.deepEqual(gestreamt, [orig], 'Die unbrauchbare Vorschau wurde ausgeliefert');
    assert.equal(fs.existsSync(thumb), false,
      'Die unbrauchbare Vorschau muss gelöscht werden, sonst bleibt sie ewig liegen');
  });

  await t.test('gen=0 rechnet nichts, sondern hinterlässt nur eine Notiz', async () => {
    // Die ANFRAGE darf keine Verkleinerung anstossen — das macht der
    // Hintergrund-Job, gedrosselt und nur im Primärprozess.
    aufraeumen();
    datei(orig, 5000);
    const { notiert } = await ruf(dir, { wantThumb: true, darfErzeugen: false });
    assert.deepEqual(notiert, [1], 'Ohne Erzeugungsrecht muss vorgemerkt werden');
  });

  await t.test('bekannter Stand → 304 und KEIN Bild', async () => {
    // Der Fall, bei dem beim Herauslösen fast ein Fehler entstanden wäre:
    // Aus `return res.status(304).end()` darf kein blosses `res.status(304)`
    // werden — sonst liefe der Ablauf weiter und schriebe in eine bereits
    // beendete Antwort.
    aufraeumen();
    datei(orig, 5000);
    datei(thumb, 900);

    const v = await ruf(dir, { wantThumb: true, fresh: true });
    assert.equal(v.erledigt, true, '304 ist eine FERTIGE Antwort');
    assert.equal(v.res.code, 304);
    assert.equal(v.res.beendet, true);
    assert.deepEqual(v.gestreamt, [], 'Bei 304 darf kein Bild mehr rausgehen');

    fs.unlinkSync(thumb);
    const o = await ruf(dir, { wantThumb: false, fresh: true });
    assert.equal(o.erledigt, true);
    assert.equal(o.res.code, 304);
    assert.deepEqual(o.gestreamt, [], 'Auch der Original-Zweig darf bei 304 nichts senden');
  });

  await t.test('nur Bild-Typen verlassen den Cache', async () => {
    // Der Content-Type liegt als Datei daneben und stammt ursprünglich vom
    // CDN. Ein SVG ist das einzige Bildformat, das als Dokument geöffnet
    // aktiv wird — es darf nicht unter der eigenen Herkunft ausgeliefert
    // werden, auch wenn ein alter Cache-Eintrag es behauptet.
    for (const [abgelegt, erwartet] of [
      ['image/png',      'image/png'],
      ['image/svg+xml',  'image/jpeg'],
      ['text/html',      'image/jpeg'],
      ['application/pdf','image/jpeg'],
    ]) {
      aufraeumen();
      datei(orig, 5000);
      fs.writeFileSync(orig + '.ct', abgelegt);
      const { res } = await ruf(dir, { wantThumb: false });
      assert.equal(res.kopf['content-type'], erwartet,
        `Abgelegt als ${abgelegt} → ausgeliefert werden muss ${erwartet}`);
    }
  });

  fs.rmSync(dir, { recursive: true, force: true });
});
