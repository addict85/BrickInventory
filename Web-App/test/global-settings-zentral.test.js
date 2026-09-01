/**
 * `global_settings` wird über utils/settings.ts angefasst.
 *
 * Der Wächter selbst steht in scripts/check-global-settings.js — dort mit der
 * Bestandsliste und der ausführlichen Begründung. Dieser Test ruft ihn im
 * normalen Lauf mit auf: Eine Prüfung, die man eigens starten muss, wird
 * vergessen.
 *
 * Dasselbe Verhältnis wie bei check-noimplicitany.js und `npm run
 * typecheck:strict` — nur dass diese Prüfung keinen Übersetzerlauf braucht und
 * deshalb im Testlauf nichts kostet.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('kein neuer Direktzugriff auf global_settings', () => {
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'check-global-settings.js')],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const p = /** @type {{ stdout?: unknown, stderr?: unknown }} */ (e);
    assert.fail(String(p.stderr || '') + String(p.stdout || ''));
  }
});
