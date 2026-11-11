/**
 * Der Kaufpreis wird übernommen — und seine Herkunft benannt: Führt BrickLink
 * für den gewählten Zustand keinen Preis, gilt der des anderen Zustands, und
 * die Antwort sagt es (price_from_condition). Server gegen die Test-DB (der
 * Preis-Cache kennt „Neuware ohne Preis“ und „Gebraucht mit Preis“, also kein
 * Abruf), Webapp im echten Bündel (jsdom), App als Kotlin-Struktur.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, dist bzw. Bündel neu gebaut):
 *   A  in preise.ts fetchPartPrice beim Cache-Rückfall ohne `is_fallback: true`
 *      → rot: „Teil und Figur ohne Preis …“ (Teil)
 *   B  dasselbe in fetchMinifigPrice → rot: ebenda (Figur)
 *   C  in preisRegel.ts den Markt auch bei eingetippter Zahl gefragt → rot:
 *      „eine eingetippte Zahl …“ (Herkunft 'U' an einem eigenen Preis)
 *   D  in teil-erfassen.js den Hinweis weggelassen → rot: „die Webapp nennt …“
 */
// Abgleich Web↔App: läuft in web-ci auch bei Änderungen unter Android-App/ (paths-Filter).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { oeffneOberflaeche, ANMELDUNG, warte } = require('./helpers/oberflaeche');

const U = 990811, TEIL = `ph-teil-${process.pid}`, FIG = `ph-fig-${process.pid}`, FARBE = 4;

function ohneKommentare(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(z => !z.trim().startsWith('//') && !z.trim().startsWith('*')).join('\n');
}

test.after(() => _req('db/database.js').pool.end().catch(() => {}));

async function aufbau(t) {
  const db = await dbOderSkip(t, _req);
  if (!db) return null;
  const weg = async () => {
    for (const tab of ['part_acquisitions', 'minifig_acquisitions', 'parts', 'minifigs']) await db.run(`DELETE FROM ${tab} WHERE user_id=$1`, [U]).catch(() => {});
    await db.run('DELETE FROM part_price_cache WHERE part_number=$1', [TEIL]);
    await db.run('DELETE FROM minifig_price_cache WHERE fig_number=$1', [FIG]);
    await db.run('DELETE FROM users WHERE id=$1', [U]).catch(() => {});
  };
  await weg();
  t.after(weg);
  await db.run("INSERT INTO users (id,username,password_hash) VALUES ($1,$2,'x')", [U, `ph${process.pid}`]);
  await db.run("INSERT INTO rb_colors (id,name,bl_color_id) VALUES ($1,'Rot',$1) ON CONFLICT (id) DO UPDATE SET bl_color_id=$1", [FARBE]);
  for (const { zustand, preis } of [{ zustand: 'N', preis: 0 }, { zustand: 'U', preis: 0.9 }]) {
    await db.run(`INSERT INTO part_price_cache (part_number,color_id,condition,currency_code,avg_price,qty_avg_price,fetched_at)
      VALUES ($1,$2,$3,'EUR',$4,$4,NOW())`, [TEIL, FARBE, zustand, preis]);
    await db.run(`INSERT INTO minifig_price_cache (fig_number,condition,currency_code,avg_price,qty_avg_price,fetched_at)
      VALUES ($1,$2,'EUR',$3,$3,NOW())`, [FIG, zustand, preis * 10]);
  }
  return db;
}

test('Teil und Figur ohne Preis im gewählten Zustand übernehmen den anderen und sagen es', async (t) => {
  if (!await aufbau(t)) return;
  const { addManualPart } = _req('src/teile/manuelleTeile.js');
  const { addManualFig } = _req('src/figuren/manuelleFiguren.js');
  const teil = await addManualPart(U, { part_number: TEIL, color_id: FARBE, condition: 'N' });
  const fig = await addManualFig(U, { fig_number: FIG, condition: 'N' });
  assert.deepEqual([teil.price_from_condition, fig.price_from_condition], ['U', 'U']);
  const { resolveManualPartPurchase } = _req('src/teile/manuelleTeile.js');
  const r = await resolveManualPartPurchase(U, { partNumber: TEIL, colorId: FARBE, condition: 'N' });
  assert.deepEqual([r.effectivePurchasePrice, r.preisAusZustand], [0.9, 'U'], 'der übernommene Preis fehlt');
  const gleich = await resolveManualPartPurchase(U, { partNumber: TEIL, colorId: FARBE, condition: 'U' });
  assert.deepEqual([gleich.effectivePurchasePrice, gleich.preisAusZustand], [0.9, null], 'ohne Rückfall keine Herkunft');
});

test('eine eingetippte Zahl hat keine Herkunft', async (t) => {
  if (!await aufbau(t)) return;
  const { resolveManualPartPurchase } = _req('src/teile/manuelleTeile.js');
  const r = await resolveManualPartPurchase(U, { partNumber: TEIL, colorId: FARBE, unitPrice: '2.50', condition: 'N' });
  assert.deepEqual([r.effectivePurchasePrice, r.preisAusZustand, r.geschaetzt], [2.5, null, false]);
});

test('die Webapp nennt die Herkunft bei Teil und Figur', async () => {
  const de = require('./helpers/sources').loadTranslations().de;
  const posten = (art) => (_url, o) => (o.method === 'POST'
    ? { success: true, action: 'added', [`${art}_number`]: `${art}-1`, price_from_condition: 'U' }
    : ANMELDUNG[`/v1/${art === 'part' ? 'parts' : 'minifigs'}`]);
  const o = await oeffneOberflaeche({ '/v1/parts': posten('part'), '/v1/minifigs': posten('fig') });
  try {
    await o.ruhig();
    for (const [art, nr, knopf, ergebnis] of [['part', 'ap-num-inline', 'btn-add-part', 'ap-inline-result'],
                                              ['fig', 'af-num-inline', 'btn-add-fig', 'af-inline-result']]) {
      o.d.getElementById(nr).value = `${art}-1`;
      o.d.getElementById(knopf).click();
      await warte(() => o.d.getElementById(ergebnis).textContent.startsWith(`${art}-1`));
      assert.ok(o.d.getElementById(ergebnis).textContent.includes(de['price.from_other_condition_used']),
        `${art}: ${o.d.getElementById(ergebnis).textContent}`);
    }
  } finally { o.w.close(); }
});

test('die App zeigt den Hinweis aus EINER Stelle bei beiden Erfassungen', () => {
  const app = ohneKommentare(fs.readFileSync(
    path.join(__dirname, '..', '..', 'Android-App', 'feature-teile', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'teile', 'ui', 'viewmodel', 'TeileViewModel.kt'), 'utf8'));
  assert.strictEqual((app.match(/fun erfassungsMeldung\(/g) || []).length, 1,
    'Der Hinweis der App ist nicht an genau einer Stelle gebaut');
  // `zeigeMeldung(erfassungsMeldung(` misst die AUFRUFE; ein blosses
  // `erfassungsMeldung\(` zaehlte die Definition mit und meldete 3 statt 2.
  assert.strictEqual((app.match(/(?:zeigeMeldung|meldungen\.zeige)\(erfassungsMeldung\(/g) || []).length, 2,
    'Der Hinweis fehlt bei einer der beiden Erfassungen der App');
  assert.match(app, /r\.data\.priceFromCondition/,
    'Die App liest die Herkunft nicht aus der Antwort');
});

test('die App führt beide Texte in beiden Sprachen', () => {
  // Die Webapp: siehe oben (de) und i18n-duplicates.test.js (gleicher Schlüsselvorrat de/en).
  const STRINGS = [
    path.join(__dirname, '..', '..', 'Android-App', 'core-ressourcen', 'src', 'main', 'res', 'values', 'strings.xml'),
    path.join(__dirname, '..', '..', 'Android-App', 'core-ressourcen', 'src', 'main', 'res', 'values-de', 'strings.xml'),
  ];
  for (const datei of STRINGS) {
    const xml = fs.readFileSync(datei, 'utf8');
    for (const schluessel of ['price_from_other_condition_new', 'price_from_other_condition_used'])
      assert.ok(xml.includes(`name="${schluessel}"`),
        `${schluessel} fehlt in ${path.basename(path.dirname(datei))}/strings.xml`);
  }
});
