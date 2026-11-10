#!/usr/bin/env node
/**
 * Bild-Diagnose für EIN Set — wo bricht die Kette?
 */
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

const setNumber = (process.argv[2] || '').trim();
if (!setNumber) {
  console.error('Aufruf: node scripts/diagnose-image.js <set-nummer>   (z.B. 60445-1)');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const db = require(path.join(ROOT, 'dist/db/database.js'));
const { DATA_DIR } = require(path.join(ROOT, 'dist/src/infra/appPaths.js'));

const zeile = (/** @type {string} */ k, /** @type {any} */ v) => console.log(`   ${String(k).padEnd(14)} ${v}`);

/** @param {string} url */
function hole(url) {
  return new Promise(r => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 10000, headers: {
      // Dieselben Kopfzeilen wie der Bild-Proxy — sonst misst man die
      // Bot-Erkennung des CDN statt der Verfügbarkeit des Bildes.
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Referer': 'https://rebrickable.com/',
      'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
    } }, res => {
      let n = 0;
      res.on('data', c => { n += c.length; });
      res.on('end', () => r({ status: res.statusCode, typ: res.headers['content-type'], bytes: n }));
    });
    req.on('timeout', () => { req.destroy(); r({ status: 'Zeitüberschreitung' }); });
    req.on('error', e => r({ status: 'Fehler: ' + e.message }));
  });
}

(async () => {
  console.log(`\n═══ Bild-Diagnose für ${setNumber} ═══\n`);

  // ── 1. Die Zeilen der Konten ──────────────────────────────────────────────
  //
  // Seit Migration 0033 stehen die Bildfelder im Katalog, und alle Zeilen
  // tragen damit denselben Wert — was die Diagnose unten als Punkt 2 ohnehin
  // schon sagte. Die Liste hier beantwortet weiter „welche Konten fuehren das
  // Set?".
  const rows = await db.all(
    `SELECT s.user_id, u.username, c.image_url, c.image_local
       FROM sets s
       LEFT JOIN set_catalog c ON c.set_number = s.set_number
       LEFT JOIN users u ON u.id = s.user_id
      WHERE s.set_number = $1 ORDER BY s.user_id`, [setNumber]);
  console.log('1. Bestand je Konto (Bildfelder aus dem Katalog):');
  if (!rows.length) console.log('   ⚠️  Kein Konto besitzt dieses Set.');
  for (const r of rows) {
    console.log(`   ── ${r.username || r.user_id}`);
    zeile('image_url', r.image_url || '∅ leer');
    zeile('image_local', r.image_local || '∅ leer');
  }

  // ── 2. Der gemeinsame Katalog ─────────────────────────────────────────────
  const cat = await db.get(
    `SELECT rs.name, c.image_url, c.image_local
       FROM set_catalog c JOIN rb_sets rs ON rs.set_num = c.set_number WHERE c.set_number = $1`, [setNumber]);
  console.log('\n2. set_catalog (kontoübergreifend):');
  if (!cat) console.log('   ⚠️  Kein Katalogeintrag — dann kann auch der Rückfall nichts liefern.');
  else { zeile('name', cat.name || '∅'); zeile('image_url', cat.image_url || '∅ leer'); zeile('image_local', cat.image_local || '∅ leer'); }

  // ── 3. Was die API daraus macht ───────────────────────────────────────────
  const effektiv = rows[0]?.image_url || cat?.image_url || null;
  const lokal    = rows[0]?.image_local || cat?.image_local || null;
  console.log('\n3. Was die API ausliefert (COALESCE seither):');
  zeile('image_local', lokal || '∅ leer');
  zeile('image_url', effektiv || '∅ leer');
  if (!lokal && !effektiv) {
    console.log('   ⚠️  BEIDE leer — die Clients haben nichts anzuzeigen. Das ist die Ursache.');
  }

  // ── 4. Liegen die Dateien wirklich da? ────────────────────────────────────
  console.log('\n4. Dateien auf der Platte:');
  if (!lokal) console.log('   (keine lokale Adresse hinterlegt)');
  else {
    const abs = path.join(DATA_DIR, lokal.replace(/^\//, ''));
    const orig = abs.replace(/_thumb(\.[^.]+)$/, '$1');
    const thumb = orig.replace(/(\.[^.]+)$/, '_thumb$1');
    /** @type {Array<[string, string]>} */
    const paare = [['Original', orig], ['Vorschau', thumb]];
    for (const [was, p] of paare) {
      const st = fs.existsSync(p) ? fs.statSync(p) : null;
      zeile(was, st ? `${p}  (${st.size} Bytes)` : `FEHLT: ${p}`);
    }
    console.log('   Hinweis: Fehlt nur die Vorschau, liefert die Route seither');
    console.log('   das Original aus — das ist KEIN Fehler.');
  }

  // ── 5. Antwortet das CDN? ─────────────────────────────────────────────────
  console.log('\n5. Erreichbarkeit der CDN-Adresse:');
  if (!effektiv || effektiv.startsWith('/')) console.log('   (keine externe Adresse zu prüfen)');
  else {
    const r = await hole(effektiv);
    zeile('Adresse', effektiv);
    zeile('Antwort', `${r.status}${r.typ ? '  ' + r.typ : ''}${r.bytes ? '  ' + r.bytes + ' Bytes' : ''}`);
    if (r.status === 404) {
      console.log('   ⚠️  404 — die hinterlegte Adresse zeigt ins Leere. Bei ganz neuen Sets');
      console.log('   ist das oft der geratene BrickLink-Rückfall aus clients/bricklink.ts');
      console.log('   (img.bricklink.com/ItemImage/SN/0/<nr>.png), den es dort noch nicht gibt.');
    } else if (r.status === 200) {
      console.log('   ✅ Das Bild ist abrufbar — dann liegt es NICHT an der Adresse,');
      console.log('   sondern am Weg dorthin (Proxy, Anmeldung, Zwischenspeicher des Clients).');
    }
  }

  console.log('');
  await db.pool.end();
})().catch(e => { console.error('Abbruch:', e.message); process.exit(1); });
