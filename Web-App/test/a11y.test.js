/**
 * Barrierefreiheit an der geladenen Oberfläche (jsdom, echtes Bündel): Was
 * ein Vorleseprogramm zu Feldern, Knöpfen, Dialogen und den Preiszeichen der
 * Finanztabelle sagen kann, nachdem die Sprache angewandt ist.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, zurückgenommen, Bündel neu gebaut):
 *   A  in index.html `for="s-cur"` vom Label entfernt → rot: „jedes Formularfeld
 *      ist beschriftet“ (s-cur)
 *   B  dasselbe Label auf `for="s-curx"` → rot: „jedes Formularfeld …“ und „jedes for= …“
 *   C  role="dialog" an #confirm-modal entfernt → rot: „modale Overlays …“
 *   D  in i18n.js `document.documentElement.lang = lang;` gestrichen → rot:
 *      „die Sprache steht am <html>-Element“
 *   E  in priceStatusBadge() (finance.js) aria-label der Fehler-Plakette
 *      entfernt → rot: „bedeutungstragende Zeichen …“
 *   F  #btn-sav-pw ohne Text und data-i18n, mit aria-label="btn-sav-pw" →
 *      rot: „kein aria-label, das nur der Bezeichner ist“
 *   G  #btn-sav-pw ohne Text und data-i18n → rot: „jedes sichtbare Bedienelement …“
 * Ersetzt bedienelement-name.test.js, das dieselben Regeln per Regex am Markup prüfte.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

/** Felder, die bewusst keine sichtbare Beschriftung brauchen. */
const EXEMPT = new Set([
  'cfg-import-file', // verstecktes <input type="file">, ausgelöst über einen beschrifteten Knopf
]);

const FIN_SETS = [
  { set_number: '10294-1', name: 'Titanic', avg_price: 600, wert_gesamt: 600 },
  { set_number: '10295-1', name: 'Porsche', error: 'Zeitüberschreitung', avg_price: null, wert_gesamt: 0 },
  { set_number: '10296-1', name: 'Mini', no_price: true, avg_price: null, wert_gesamt: 0 },
].map(s => ({
  quantity: 1,
  from_cache: true,
  is_fallback: false,
  no_price: false,
  mixed: false,
  acquisitions: [],
  ...s,
}));

let _o;
/** Eine Oberfläche für alle Fälle: Laden dauert, geprüft wird nur gelesen. */
async function oberflaeche() {
  _o ??= await oeffneOberflaeche({
    '/v1/finance/valuation': {
      success: true,
      currency: 'EUR',
      condition: 'N',
      total_value: '600',
      kaufpreise_fremde_waehrung: 0,
      totals: { min: '0', avg: '600', max: '0', qty_avg: '600' },
      sets: FIN_SETS,
    },
  });
  return _o;
}
test.after(() => _o?.w.close());

const felder = d =>
  [...d.querySelectorAll('input[id], select[id], textarea[id]')].filter(f => f.type !== 'hidden' && !EXEMPT.has(f.id));

test('jedes Formularfeld ist beschriftet', async () => {
  const { d } = await oberflaeche();
  const alle = felder(d);
  assert.ok(alle.length >= 50, `nur ${alle.length} Felder gefunden`);
  const ohne = alle.filter(
    f => !f.labels?.length && !f.getAttribute('aria-label') && !f.getAttribute('aria-labelledby'),
  );
  assert.deepEqual(
    ohne.map(f => f.id),
    [],
  );
});

test('jedes for= zeigt auf ein existierendes Feld, ein umschliessendes Label auf sein eigenes', async () => {
  const { d } = await oberflaeche();
  const labels = [...d.querySelectorAll('label[for]')];
  assert.ok(labels.length >= 30, `nur ${labels.length} Labels mit for=`);
  assert.deepEqual(
    labels.filter(l => !l.control).map(l => l.htmlFor),
    [],
    'for= ohne Ziel',
  );
  // Ein Klick setzt den Fokus auf das Ziel von for=, nicht auf das umschlossene Feld.
  const fremd = labels.filter(l => {
    const innen = l.querySelector('input, select, textarea');
    return innen && l.control !== innen;
  });
  assert.deepEqual(
    fremd.map(l => `${l.htmlFor} → ${l.querySelector('input, select, textarea').id}`),
    [],
  );
});

test('modale Overlays sind als Dialog ausgezeichnet', async () => {
  const { d } = await oberflaeche();
  const modals = [...d.querySelectorAll('div.ovl[id$="modal"]')];
  assert.ok(modals.length >= 5, `Nur ${modals.length} Modals gefunden`);
  assert.deepEqual(
    modals.filter(m => m.getAttribute('role') !== 'dialog' || m.getAttribute('aria-modal') !== 'true').map(m => m.id),
    [],
  );
});

test('die Sprache steht am <html>-Element', async () => {
  // Ohne lang= rät der Screenreader die Aussprache — bei gemischt deutsch-englischen Oberflächen hörbar falsch.
  const en = await oeffneOberflaeche({}, { sprache: 'en' });
  try {
    assert.equal(en.d.documentElement.lang, 'en');
  } finally {
    en.w.close();
  }
  assert.equal((await oberflaeche()).d.documentElement.lang, 'de');
});

test('bedeutungstragende Zeichen in der Finanztabelle sind erklärt', async () => {
  // Die Preisstatus-Spalte ist ein einziges Zeichen; ohne title (Maus) und aria-label (Vorleser) unlesbar.
  // Die Zeichen der Legende sind aria-hidden: Der Satz daneben erklärt sie.
  const { w, d } = await oberflaeche();
  await reiter(w, 'finance');
  assert.ok(await warte(() => d.querySelectorAll('#fin-tbl .pst:not([aria-hidden])').length >= 3), 'Plaketten fehlen');
  const zustaende = new Set();
  for (const p of d.querySelectorAll('#fin-tbl .pst:not([aria-hidden])')) {
    zustaende.add([...p.classList].find(k => k.startsWith('pst-')));
    for (const a of ['title', 'aria-label'])
      assert.ok(
        p.getAttribute(a) && !/^finance\./.test(p.getAttribute(a)),
        `${p.className}: ${a}="${p.getAttribute(a)}"`,
      );
  }
  assert.deepEqual([...zustaende].sort(), ['pst-err', 'pst-leer', 'pst-ok']);
});

/** Sichtbar heisst hier: kein Vorfahr mit display:none (Markup oder Skript). */
const sichtbar = el => {
  for (let e = el; e; e = e.parentElement) if (e.style?.display === 'none' || e.hidden) return false;
  return true;
};

test('jedes sichtbare Bedienelement hat einen vorlesbaren Namen', async () => {
  const { d } = await oberflaeche();
  const name = el =>
    el.getAttribute('aria-label') ||
    el.getAttribute('title') ||
    (el.getAttribute('aria-labelledby') || '')
      .split(/\s+/)
      .map(id => d.getElementById(id)?.textContent || '')
      .join(' ') ||
    [...(el.labels || [])].map(l => l.textContent).join(' ') ||
    el.textContent;
  const elemente = [...d.querySelectorAll('button, a[href], select, textarea')].filter(sichtbar);
  assert.ok(elemente.length >= 50, `Nur ${elemente.length} Bedienelemente gefunden`);
  // Mindestens zwei Buchstaben — ein Symbol oder ein ✕ ist kein Name.
  const ohne = elemente
    .filter(el => !/[^\W\d_]{2,}/u.test(name(el) || ''))
    .map(el => `<${el.tagName.toLowerCase()}> ${el.id || el.className}`);
  assert.deepEqual(ohne, []);
});

test('kein aria-label, das nur der Bezeichner ist', async () => {
  // Vorgelesen wird der Wert — „mon-default-condition" hilft niemandem.
  const { d } = await oberflaeche();
  const mit = [...d.querySelectorAll('[aria-label]')].filter(sichtbar);
  assert.ok(mit.length >= 20, `Nur ${mit.length} aria-label gefunden`);
  const schlecht = mit
    .filter(el => {
      const v = el.getAttribute('aria-label');
      return v === el.id || (!/\s/.test(v) && /[-_.]/.test(v) && v === v.toLowerCase());
    })
    .map(el => `${el.id}: ${el.getAttribute('aria-label')}`);
  assert.deepEqual(schlecht, []);
});
