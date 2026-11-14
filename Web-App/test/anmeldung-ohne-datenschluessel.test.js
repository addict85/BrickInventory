/**
 * Ohne Datenschlüssel bricht die Anmeldebremse ab, statt Name und Adresse mit
 * einem ungeschlüsselten SHA-256 abzulegen (der sich für kleine Wertebereiche
 * durchprobieren liesse).
 *
 * Gegenprobe (14.11.2026 gemessen): in namensAbdruck() und adressAbdruck() wieder
 * `try { suchwert(…) } catch { createHash('sha256')… }` → rot: „Missing expected
 * rejection“ (die Bremse zählte ohne Schlüssel weiter).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// Ein Ort, an dem kein Schlüssel liegt und keiner angelegt werden kann.
const sperre = fs.mkdtempSync(path.join(os.tmpdir(), 'ohne-schluessel-'));
fs.writeFileSync(path.join(sperre, 'datei'), '');
delete process.env.DATA_KEY;
process.env.DATA_KEY_FILE = path.join(sperre, 'datei', 'unter', 'datenschluessel');

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const limiter = _req('src/konto/loginLimiter.js');

test('ohne Datenschlüssel sagt die Anmeldebremse ab, statt ungeschlüsselt zu hashen', async () => {
  await assert.rejects(limiter.checkLoginAllowed('203.0.113.5', `ohne_schluessel_${process.pid}`), e => {
    assert.match(String(e?.message), /unter[\\/]datenschluessel|ENOTDIR/);
    return true;
  });
  fs.rmSync(sperre, { recursive: true, force: true });
});
