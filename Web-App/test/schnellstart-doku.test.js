/**
 * Der Schnellstart in README.md (Wurzel) und Web-App/README.md führt zu einer
 * Installation, die compose.yaml starten kann. Die Befehle des Blocks laufen
 * wirklich, in einem Sandkasten mit compose.yaml, .env.example und scripts/;
 * nur git und docker nicht. Danach liest `docker compose config` das Ergebnis:
 * Jedes Secret liegt als Datei da, Caddy findet die eigene CA, die App
 * veröffentlicht keinen Port, und `pull` holt das veröffentlichte Image.
 * Ohne Docker-CLI wird übersprungen, in CI nicht.
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln):
 *   A  compose.yaml: Secret-Datei ./geheimnisse/db_app_passwort statt …_password
 *      → rot: „Secret db_app_password: geheimnisse/db_app_passwort fehlt“
 *   B  README.md: `sh scripts/geheimnisse-einrichten.sh` gestrichen → rot:
 *      „Secret session_secret: … fehlt“
 *   C  Web-App/README.md: `scripts/ca-einrichten.sh` → `scripts/ca-anlegen.sh`
 *      → rot: „Schritt scheitert: sudo sh scripts/ca-anlegen.sh“
 *   D  compose.yaml: bei app `ports: ["3000:3000"]` → rot: „app veröffentlicht
 *      keinen Port“
 *   E  compose.yaml: bei jobs `image:` gestrichen → rot: „jobs zieht das
 *      veröffentlichte Image“
 *   F  README.md: `docker compose logs app worker` → rot: „unbekannter Dienst worker“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DOKUS = [
  { datei: path.join(ROOT, '..', 'README.md'), abschnitt: '## Schnellstart' },
  { datei: path.join(ROOT, 'README.md'), abschnitt: '## Docker (empfohlen)' },
];
const VEROEFFENTLICHT = fs.readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'docker-publish.yml'), 'utf8')
  .match(/^\s*IMAGE:\s*(\S+)/m)?.[1];

/** Die Zeilen des ersten ```bash-Blocks im Abschnitt, ohne Kommentare. */
function schnellstart(datei, abschnitt) {
  const text = fs.readFileSync(datei, 'utf8');
  const ab = text.indexOf(`\n${abschnitt}\n`);
  assert.ok(ab >= 0, `${path.basename(datei)}: Abschnitt „${abschnitt}“ fehlt`);
  const block = text.slice(ab).match(/```bash\n([\s\S]*?)```/)?.[1];
  assert.ok(block, `${path.basename(datei)}: kein bash-Block im Schnellstart`);
  return block.split('\n').map(z => z.replace(/\s+#.*$/, '').trim()).filter(Boolean);
}

function sandkasten(t) {
  const ort = fs.mkdtempSync(path.join(os.tmpdir(), 'schnellstart-'));
  t.after(() => fs.rmSync(ort, { recursive: true, force: true }));
  fs.copyFileSync(path.join(ROOT, 'compose.yaml'), path.join(ort, 'compose.yaml'));
  fs.copyFileSync(path.join(ROOT, '.env.example'), path.join(ort, '.env.example'));
  fs.copyFileSync(path.join(ROOT, 'Caddyfile'), path.join(ort, 'Caddyfile'));
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(ort, 'scripts'), { recursive: true });
  return ort;
}

function compose(ort, ...args) {
  return spawnSync('docker', ['compose', '-f', path.join(ort, 'compose.yaml'), ...args],
    { cwd: ort, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } });
}

for (const { datei, abschnitt } of DOKUS) {
  const name = path.relative(path.join(ROOT, '..'), datei);
  test(`${name}: der Schnellstart passt zu compose.yaml`, (t) => {
    const probe = compose(path.join(ROOT), 'version');
    if (probe.error || probe.status !== 0) {
      if (process.env.CI) assert.fail(`docker compose im CI-Lauf: ${probe.error?.message || probe.stderr}`);
      t.skip('kein docker compose'); return;
    }
    assert.ok(VEROEFFENTLICHT, 'IMAGE in docker-publish.yml nicht gefunden');
    const ort = sandkasten(t);
    const schritte = schnellstart(datei, abschnitt);
    const dockerZeilen = [];
    for (const zeile of schritte) {
      if (/^(git|cd)\s/.test(zeile)) continue;
      if (/^docker\s/.test(zeile)) { dockerZeilen.push(zeile); continue; }
      // sudo nur für die Dateirechte; CA_ORDNER nennt denselben Ordner wie die
      // Vorgabe und erlaubt den Lauf ohne root (CI).
      const r = spawnSync('sh', ['-c', zeile.replace(/^sudo\s+/, '')], { cwd: ort, encoding: 'utf8',
        env: { PATH: process.env.PATH, HOME: ort, CA_ORDNER: './caddy/ca' } });
      assert.equal(r.status, 0, `Schritt scheitert: ${zeile}\n${r.stdout}${r.stderr}`);
    }
    assert.ok(dockerZeilen.some(z => /^docker compose pull\b/.test(z)), 'der Schnellstart zieht das Image (docker compose pull)');
    assert.ok(dockerZeilen.some(z => /^docker compose up -d\b/.test(z)), 'der Schnellstart startet (docker compose up -d)');

    const k = compose(ort, 'config', '--format', 'json');
    assert.equal(k.status, 0, `docker compose config: ${k.stderr}`);
    const j = JSON.parse(k.stdout);
    const dienste = Object.keys(j.services);

    // Jeder Dienst, den ein docker-Befehl des Schnellstarts nennt, existiert.
    for (const z of dockerZeilen) {
      const [, befehl, rest = ''] = z.match(/^docker compose (\w+)((?:\s+[\w-]+)*)/) || [];
      assert.ok(befehl, `unbekannte Form: ${z}`);
      for (const d of rest.trim().split(/\s+/).filter(w => w && !w.startsWith('-')))
        assert.ok(dienste.includes(d), `unbekannter Dienst ${d} in „${z}“`);
    }

    // Die Schritte haben jede Datei angelegt, die compose als Secret einhängt.
    const brauchen = new Set(Object.values(j.services).flatMap(d => (d.profiles ? [] : (d.secrets || []).map(s => s.source))));
    assert.ok(brauchen.size >= 3, `nur ${brauchen.size} Secrets — liest der Test die richtige Datei?`);
    for (const s of brauchen) {
      const f = j.secrets[s].file;
      assert.ok(fs.existsSync(f), `Secret ${s}: ${path.relative(ort, f)} fehlt`);
    }
    for (const s of ['session_secret', 'db_password', 'db_app_password'])
      assert.ok(fs.statSync(j.secrets[s].file).size >= 16, `Secret ${s} ist leer`);

    // BRICK_HOST aus .env kommt bei Caddy an, und Caddy findet die eigene CA
    // (sein Startskript wählt sie an /ca-eigen/zwischen.key).
    assert.match(j.services.caddy.environment.BRICK_HOST, /\S/, 'BRICK_HOST ist bei Caddy leer');
    const ca = j.services.caddy.volumes.find(v => v.target === '/ca-eigen');
    for (const f of ['zwischen.key', 'zwischen-kette.crt', 'root.crt'])
      assert.ok(fs.existsSync(path.join(ca.source, f)), `Caddy findet ${f} nicht unter ${path.relative(ort, ca.source)}`);

    // Erreichbar nur über Caddy; app, jobs und schluessel teilen das veröffentlichte Image.
    assert.deepEqual(j.services.app.ports ?? [], [], 'app veröffentlicht keinen Port');
    assert.ok(j.services.caddy.ports.some(p => p.target === 443), 'Caddy veröffentlicht 443');
    for (const d of ['app', 'jobs', 'schluessel'])
      assert.equal(j.services[d].image?.replace(/:[^:/]+$/, ''), VEROEFFENTLICHT, `${d} zieht das veröffentlichte Image`);
    assert.equal(new Set(['app', 'jobs', 'schluessel'].map(d => j.services[d].image)).size, 1, 'ein Image für alle drei');
    const gebaut = dienste.filter(d => j.services[d].build);
    assert.deepEqual(gebaut, ['app'], 'genau ein Dienst baut das Dockerfile');
  });
}
