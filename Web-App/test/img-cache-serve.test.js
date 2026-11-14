/**
 * Die Auslieferungsreihenfolge des Bild-Proxys — AUSGEFÜHRT, nicht gelesen.
 *
 * Gegenprobe (04.11.2026 gemessen): bildTyp() gibt wie vorher den rohen Wert
 * zurück, sobald er mit `image/` beginnt und kein SVG ist → rot: „Abgelegt als
 * image/png, text/html …“.
 * (11.11.2026) in cacheTreffer() die ETag-Angabe weggelassen (`etag: null`) →
 * rot: „der Dienst nennt Datei, Typ, Länge und ETag, ohne zu senden“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const liefereAusCache = (...a) =>
  _req('src/katalog/http/bildCacheAuslieferung.js').liefereAusCache(
    require('./helpers/sources').testDienste().katalog,
    ...a,
  );

/** Ein res, das nur festhält, was mit ihm geschehen ist. */
function attrappeRes() {
  const r = {
    kopf: {},
    status: 200,
    beendet: false,
    gestreamt: null,
    setHeader(k, v) {
      this.kopf[k.toLowerCase()] = String(v);
    },
    status_(c) {
      this.status = c;
      return this;
    },
    end() {
      this.beendet = true;
      return this;
    },
  };
  r.status = function (c) {
    this._code = c;
    return this;
  };
  Object.defineProperty(r, 'code', {
    get() {
      return this._code ?? 200;
    },
  });
  return r;
}

/** Ein Aufruf von liefereAusCache mit sinnvollen Vorgaben. */
async function ruf(dir, { wantThumb, darfErzeugen = true, fresh = false }) {
  const res = attrappeRes();
  const gestreamt = [];
  const notiert = [];
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
function datei(p, n) {
  fs.writeFileSync(p, Buffer.alloc(n, 0x41));
}

test('Auslieferungsreihenfolge des Bild-Caches', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgcache-'));
  const orig = path.join(dir, 'bild');
  const thumb = path.join(dir, 'bild_thumb.jpg');
  const aufraeumen = () => {
    for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
  };

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
    assert.deepEqual(
      gestreamt,
      [orig],
      'Es darf NICHT auf die Verkleinerung gewartet werden — das war einmal ' +
        'rund 150 ms je Bild und bei einer Kachelwand Sekunden',
    );
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
    assert.deepEqual(gestreamt, [orig], 'Ohne ?thumb=1 gehört das Original raus, auch wenn eine Vorschau daliegt');
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
    assert.equal(
      fs.existsSync(thumb),
      false,
      'Die unbrauchbare Vorschau muss gelöscht werden, sonst bleibt sie ewig liegen',
    );
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
      ['image/png', 'image/png'],
      ['image/svg+xml', 'image/jpeg'],
      ['text/html', 'image/jpeg'],
      ['application/pdf', 'image/jpeg'],
      ['image/png, text/html', 'image/jpeg'],
      ['image/webp; charset=binary', 'image/webp'],
      ['image/x-icon', 'image/jpeg'],
    ]) {
      aufraeumen();
      datei(orig, 5000);
      fs.writeFileSync(orig + '.ct', abgelegt);
      const { res } = await ruf(dir, { wantThumb: false });
      assert.equal(
        res.kopf['content-type'],
        erwartet,
        `Abgelegt als ${abgelegt} → ausgeliefert werden muss ${erwartet}`,
      );
    }
  });

  await t.test('der Dienst nennt Datei, Typ, Länge und ETag, ohne zu senden', async () => {
    // Gesendet wird in src/katalog/http/; der Dienst bekommt keine Antwort zu sehen.
    aufraeumen();
    datei(orig, 5000);
    fs.writeFileSync(orig + '.ct', 'image/png');
    const { cacheTreffer } = _req('src/katalog/bilder/imgCacheServe.js');
    const treffer = await cacheTreffer({
      cacheFile: orig,
      thumbFile: thumb,
      wantThumb: false,
      darfErzeugen: false,
      notiere() {},
    });
    assert.equal(treffer.datei, orig);
    assert.equal(treffer.typ, 'image/png');
    assert.equal(treffer.groesse, 5000);
    assert.match(String(treffer.etag), /^"c-5000-\d+"$/);
    aufraeumen();
    assert.equal(
      await cacheTreffer({ cacheFile: orig, thumbFile: thumb, wantThumb: false, darfErzeugen: false, notiere() {} }),
      null,
    );
  });

  fs.rmSync(dir, { recursive: true, force: true });
});
