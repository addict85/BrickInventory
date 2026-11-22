#!/usr/bin/env node
/**
 * Image diagnostics for ONE set — where does the chain break?
 */
const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');
const http = require('node:http');

const setNumber = (process.argv[2] || '').trim();
if (!setNumber) {
  console.error('Aufruf: node scripts/diagnose-image.js <set-nummer>   (z.B. 60445-1)');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const dbModule = require(path.join(ROOT, 'dist/db/database.js'));
const db = dbModule.createDb(dbModule.dbConfigFromEnvironment());
const { DATA_DIR } = require(path.join(ROOT, 'dist/src/infra/appPaths.js'));

const row = (/** @type {string} */ k, /** @type {any} */ v) => console.log(`   ${String(k).padEnd(14)} ${v}`);

/** @param {string} url */
function hole(url) {
  return new Promise(r => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(
      url,
      {
        timeout: 10000,
        headers: {
          // The same headers as the image proxy — otherwise one measures the
          // CDN's bot detection instead of the image's availability.
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Referer: 'https://rebrickable.com/',
          Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
        },
      },
      res => {
        let n = 0;
        res.on('data', c => {
          n += c.length;
        });
        res.on('end', () => r({ status: res.statusCode, typ: res.headers['content-type'], bytes: n }));
      },
    );
    req.on('timeout', () => {
      req.destroy();
      r({ status: 'Zeitüberschreitung' });
    });
    req.on('error', e => r({ status: 'Fehler: ' + e.message }));
  });
}

/** @param {Array<{ username?: string, user_id: number, image_url?: string, image_local?: string }>} rows */
function reportAccounts(rows) {
  console.log('1. Bestand je Konto (Bildfelder aus dem Katalog):');
  if (!rows.length) console.log('   ⚠️  Kein Konto besitzt dieses Set.');
  for (const r of rows) {
    console.log(`   ── ${r.username || r.user_id}`);
    row('image_url', r.image_url || '∅ leer');
    row('image_local', r.image_local || '∅ leer');
  }
}

/** @param {{ name?: string, image_url?: string, image_local?: string } | undefined} cat */
function reportCatalog(cat) {
  console.log('\n2. set_catalog (kontoübergreifend):');
  if (!cat) {
    console.log('   ⚠️  Kein Katalogeintrag — dann kann auch der Rückfall nichts liefern.');
    return;
  }
  row('name', cat.name || '∅');
  row('image_url', cat.image_url || '∅ leer');
  row('image_local', cat.image_local || '∅ leer');
}

/** @param {string | null} local */
function reportFiles(local) {
  console.log('\n4. Dateien auf der Platte:');
  if (!local) {
    console.log('   (keine lokale Adresse hinterlegt)');
    return;
  }
  const abs = path.join(DATA_DIR, local.replace(/^\//, ''));
  const orig = abs.replace(/_thumb(\.[^.]+)$/, '$1');
  const thumb = orig.replace(/(\.[^.]+)$/, '_thumb$1');
  /** @type {Array<[string, string]>} */
  const pairs = [
    ['Original', orig],
    ['Vorschau', thumb],
  ];
  for (const [was, p] of pairs) {
    const st = fs.existsSync(p) ? fs.statSync(p) : null;
    row(was, st ? `${p}  (${st.size} Bytes)` : `FEHLT: ${p}`);
  }
  console.log('   Hinweis: Fehlt nur die Vorschau, liefert die Route seither');
  console.log('   das Original aus — das ist KEIN Fehler.');
}

/** @param {string | null} effective */
async function reportCdn(effective) {
  console.log('\n5. Erreichbarkeit der CDN-Adresse:');
  if (!effective || effective.startsWith('/')) {
    console.log('   (keine externe Adresse zu prüfen)');
    return;
  }
  const r = await hole(effective);
  row('Adresse', effective);
  row('Antwort', `${r.status}${r.typ ? '  ' + r.typ : ''}${r.bytes ? '  ' + r.bytes + ' Bytes' : ''}`);
  if (r.status === 404) {
    console.log('   ⚠️  404 — die hinterlegte Adresse zeigt ins Leere. Bei ganz neuen Sets');
    console.log('   ist das oft der geratene BrickLink-Rückfall aus clients/bricklink.ts');
    console.log('   (img.bricklink.com/ItemImage/SN/0/<nr>.png), den es dort noch nicht gibt.');
  } else if (r.status === 200) {
    console.log('   ✅ Das Bild ist abrufbar — dann liegt es NICHT an der Adresse,');
    console.log('   sondern am Weg dorthin (Proxy, Anmeldung, Zwischenspeicher des Clients).');
  }
}

(async () => {
  console.log(`\n═══ Bild-Diagnose für ${setNumber} ═══\n`);

  // ── 1. The accounts' rows ───────────────────────────────────────────────────
  // Since migration 0033 the image fields are in the catalog, and all rows thus carry the same
  // value. The list here still answers "which accounts hold the set?".
  const rows = await db.all(
    `SELECT s.user_id, u.username, c.image_url, c.image_local
       FROM sets s
       LEFT JOIN set_catalog c ON c.set_number = s.set_number
       LEFT JOIN users u ON u.id = s.user_id
      WHERE s.set_number = $1 ORDER BY s.user_id`,
    [setNumber],
  );
  reportAccounts(rows);

  // ── 2. The shared catalog ───────────────────────────────────────────────────
  const cat = await db.get(
    `SELECT rs.name, c.image_url, c.image_local
       FROM set_catalog c JOIN rb_sets rs ON rs.set_num = c.set_number WHERE c.set_number = $1`,
    [setNumber],
  );
  reportCatalog(cat);

  // ── 3. What the API makes of it ─────────────────────────────────────────────
  const effective = rows[0]?.image_url || cat?.image_url || null;
  const local = rows[0]?.image_local || cat?.image_local || null;
  console.log('\n3. Was die API ausliefert (COALESCE seither):');
  row('image_local', local || '∅ leer');
  row('image_url', effective || '∅ leer');
  if (!local && !effective) {
    console.log('   ⚠️  BEIDE leer — die Clients haben nichts anzuzeigen. Das ist die Ursache.');
  }

  reportFiles(local);
  await reportCdn(effective);

  console.log('');
  await db.pool.end();
})().catch(e => {
  console.error('Abbruch:', e.message);
  process.exit(1);
});
