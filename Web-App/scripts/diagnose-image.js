#!/usr/bin/env node
/**
 * Bild-Diagnose für EIN Set — wo bricht die Kette?
 *
 *   node scripts/diagnose-image.js 60445-1
 *
 * Die leere Kachel hatte in den Nachträgen 36, 37 und 40 drei verschiedene
 * Ursachen. Damit die vierte nicht wieder erraten werden muss, geht dieses
 * Skript dieselbe Kette entlang, die auch Webapp und App gehen, und sagt bei
 * jedem Glied, was es vorfindet:
 *
 *   1. Was steht in der Tabelle `sets` (je Konto)?
 *   2. Was steht im gemeinsamen `set_catalog`?
 *   3. Welche Adresse liefert die API daraus (COALESCE, seit Nachtrag 36)?
 *   4. Liegt die lokale Datei wirklich da — Original und Vorschau getrennt?
 *   5. Antwortet die CDN-Adresse, und mit welchem Inhaltstyp?
 *
 * Nur lesend; es verändert nichts.
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
const { DATA_DIR } = require(path.join(ROOT, 'dist/utils/appPaths.js'));

const zeile = (k, v) => console.log(`   ${String(k).padEnd(14)} ${v}`);

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
  const rows = await db.all(
    `SELECT s.user_id, u.username, s.image_url, s.image_local
       FROM sets s LEFT JOIN users u ON u.id = s.user_id
      WHERE s.set_number = $1 ORDER BY s.user_id`, [setNumber]);
  console.log('1. Tabelle sets (je Konto):');
  if (!rows.length) console.log('   ⚠️  Kein Konto besitzt dieses Set.');
  for (const r of rows) {
    console.log(`   ── ${r.username || r.user_id}`);
    zeile('image_url', r.image_url || '∅ leer');
    zeile('image_local', r.image_local || '∅ leer');
  }

  // ── 2. Der gemeinsame Katalog ─────────────────────────────────────────────
  const cat = await db.get(
    `SELECT name, image_url, image_local FROM set_catalog WHERE set_number = $1`, [setNumber]);
  console.log('\n2. set_catalog (kontoübergreifend):');
  if (!cat) console.log('   ⚠️  Kein Katalogeintrag — dann kann auch der Rückfall nichts liefern.');
  else { zeile('name', cat.name || '∅'); zeile('image_url', cat.image_url || '∅ leer'); zeile('image_local', cat.image_local || '∅ leer'); }

  // ── 3. Was die API daraus macht ───────────────────────────────────────────
  const effektiv = rows[0]?.image_url || cat?.image_url || null;
  const lokal    = rows[0]?.image_local || cat?.image_local || null;
  console.log('\n3. Was die API ausliefert (COALESCE seit Nachtrag 36):');
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
    for (const [was, p] of [['Original', orig], ['Vorschau', thumb]]) {
      const st = fs.existsSync(p) ? fs.statSync(p) : null;
      zeile(was, st ? `${p}  (${st.size} Bytes)` : `FEHLT: ${p}`);
    }
    console.log('   Hinweis: Fehlt nur die Vorschau, liefert die Route seit Nachtrag 40');
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
