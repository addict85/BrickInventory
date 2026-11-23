/**
 * Images and PDFs require a login without exception.
 *
 * Counter-checks for the cases deleted on 08.11.2026 that run elsewhere:
 * login and `private` on image and instructions → image-scope-db.test.js
 * (deliverImage without 401 or with `public` → red there); PDF download without
 * requireToken → wiring-running-db.test.js red.
 * “the web app never calls a CDN directly” → images-proxy-ui.test.js
 * (imgUrl() or fullUrl() return a CDN address raw → red there, H or D).
 */
const { isAppModule } = require('../scripts/build-frontend');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
// The image route stands in routes/pages.ts, its body in src/images/http/imageDelivery.ts.
const SERVER = ['startup/app.ts', 'routes/pages.ts', 'src/images/http/imageDelivery.ts'].map(read).join('\n');
/**
 * Comments gone — the explanatory text above names express.static itself.
 */
function ohneKommentare(src) {
  let out = '',
    i = 0,
    str = null;
  while (i < src.length) {
    const c = src[i],
      n = src[i + 1];
    if (str) {
      // in a string
      if (c === '\\') {
        out += c + (n ?? '');
        i += 2;
        continue;
      }
      if (c === str) str = null;
      out += c;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      str = c;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && n === '*') {
      // block comment
      const e = src.indexOf('*/', i + 2);
      const bis = e < 0 ? src.length : e + 2;
      for (const ch of src.slice(i, bis)) if (ch === '\n') out += '\n'; // keep lines
      i = bis;
      continue;
    }
    if (c === '/' && n === '/') {
      // line comment
      const e = src.indexOf('\n', i);
      i = e < 0 ? src.length : e;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
const CODE = ohneKommentare(SERVER);

test('no static mount delivers files from the data directory', () => {
  // express.static knows no login check. For PUBLIC_DIR that is right
  // (CSS, JavaScript, fonts), for IMAGES_DIR it was the gap.
  const mounts = [...CODE.matchAll(/express\.static\(([A-Za-z_$][\w$]*)/g)].map(m => m[1]);
  assert.deepEqual(
    mounts,
    ['PUBLIC_DIR'],
    `express.static over: ${mounts.join(', ')} — only PUBLIC_DIR may be served without login`,
  );
});

test('the placeholder lies outside of /images/', () => {
  // It is a build asset like CSS and JavaScript and is also shown
  // when there is no image at all — under /images/ it would have punched a hole in
  // the rule "everything here requires a login".
  assert.ok(
    fs.existsSync(path.join(ROOT, 'public', 'assets', 'set-placeholder.svg')),
    'public/assets/set-placeholder.svg is missing',
  );
  assert.ok(
    !fs.existsSync(path.join(ROOT, 'public', 'images')),
    'public/images/ must no longer exist — otherwise it shadows data/images/',
  );

  const refs = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'public', 'js'))) {
    if (!f.endsWith('.js') || f === 'app.bundle.js') continue;
    const src = fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8');
    if (src.includes('/images/set-placeholder')) refs.push(f);
  }
  if (read('public/index.html').includes('/images/set-placeholder')) refs.push('index.html');
  assert.deepEqual(refs, [], `Old placeholder address in: ${refs.join(', ')}`);
});

test('the SQL migrations end up in the build', () => {
  // Where this test comes from
  const build = read('scripts/build-ts.js');
  assert.match(build, /ASSET_EXT/, 'build-ts.js does not copy non-TS files — .sql migrations are missing in the build');
  assert.match(build, /'\.sql'/, '.sql must be among the copied extensions');
});

test('data-self handlers take the element as the FIRST argument', () => {
  // Where this test comes from
  const fs2 = require('node:fs');
  const jsDir = path.join(ROOT, 'public', 'js');
  const files = fs2.readdirSync(jsDir).filter(f => isAppModule(f) && f !== 'registry.js');
  const withSelfAndArg = new Set();
  for (const f of files) {
    const src = fs2.readFileSync(path.join(jsDir, f), 'utf8');
    for (const m of src.matchAll(/data-click="([A-Za-z_$][\w$]*)"[^>]*?data-arg=/g)) {
      const after = src.slice(m.index, m.index + 400);
      if (after.includes('data-self="1"')) withSelfAndArg.add(m[1]);
    }
  }
  assert.ok(withSelfAndArg.size > 0, 'No data-self+data-arg handlers found — the check would test nothing');

  const wrong = [];
  for (const f of files) {
    const src = fs2.readFileSync(path.join(jsDir, f), 'utf8');
    for (const name of withSelfAndArg) {
      const m = src.match(new RegExp(`function ${name}\\(([^)]*)\\)`));
      if (!m) continue;
      const first = m[1].split(',')[0].trim();
      // The element is consistently called btn/el in this project.
      if (!/^(btn|el)\b/.test(first)) wrong.push(`${name}(${m[1]})`);
    }
  }
  assert.deepEqual(wrong, [], `Element belongs in first position: ${wrong.join(', ')}`);
});

test('addresses to the own server do not go through the proxy', () => {
  // Where this test comes from
  const vm = require('node:vm');
  const src = require('./helpers/sources')
    .coreSource()
    .replace(/^export /gm, '')
    .replace(/^import[^;]*;\s*$/gm, '');
  const ctx = { console, encodeURIComponent, decodeURIComponent, location: { origin: 'https://example.test' } };
  vm.createContext(ctx);
  // From the ADDRESS HELPERS on, not only from stripOwnOrigin: fullUrl() recognizes
  // a proxy address via isProxyPath(), and that stands with the two
  // constants right above. Before, this test bench ended in
  // „isProxyPath is not defined" — the function was there, only not in the
  // cut-out piece.
  vm.runInContext(
    src.slice(src.indexOf('const IMG_PROXY ='), src.indexOf('function thumbUrl', src.indexOf('const IMG_PROXY ='))),
    ctx,
  );
  const { imgUrl, fullUrl } = vm.runInContext('({ imgUrl, fullUrl })', ctx);

  assert.equal(
    fullUrl('https://example.test/images/sets/9396-1_thumb.jpg'),
    '/images/sets/9396-1.jpg',
    'Own addresses must be treated as a path, not proxied',
  );
  assert.equal(
    imgUrl('https://example.test/images/sets/9396-1.jpg', true),
    '/images/sets/9396-1.jpg',
    'imgUrl must not put the own address into the proxy either',
  );

  // Foreign hosts still run via the proxy — that is the purpose of the
  // switch and must not get lost through this fix.
  assert.match(
    fullUrl('https://cdn.rebrickable.com/media/sets/9396-1.jpg'),
    /^\/api\/v1\/img-proxy\?url=/,
    'CDN addresses must still go through the backend',
  );
});

// Who may read uploaded instructions is checked by test/data-files-db.test.js at the handler.

// “a shared instruction file survives until the last row is gone” is checked by
// test/sets-routes-db.test.js on the running router (deleting by both accounts).
