/**
 * No response field without a consumer.
 *
 * The rule itself stands in scripts/check-response-fields.js — there because it
 * should also be callable by hand. What the app reads it takes from
 * shared/app-schnittstelle.json. This test runs it in the normal run;
 * without it it would be a script nobody starts.
 *
 * Counter-checks (carried out):
 *   a) `rate_limit_neu` put into the valuation response → red.
 *   b) the exception for `db_pool` deleted → red (27.10.; before that `uptime_seconds`,
 *      which since /health only for admins no longer stands at the top of a response).
 *   c) an exception entered for a key that does not exist → red
 *      ("tote Ausnahme").
 *   e) (11.11.2026) Since services answer without `success` (the route spreads
 *      its result), the check also reads their return: `feld_ohne_leser`
 *      in the return of cacheStats() → red.
 *   f) (14.11.2026) in shared/app-schnittstelle.json `"is_main"` deleted from the response fields
 *      → red: OHNE VERBRAUCHER is_main.
 *   d) the path to the consumers bent → red with its own message (without
 *      consumers EVERY field would count as unread).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('no response field without a consumer', () => {
  const script = path.join(__dirname, '..', 'scripts', 'check-response-fields.js');
  try {
    execFileSync(process.execPath, [script], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    assert.fail(
      `${e.stdout || ''}${e.stderr || ''}`.trim() ||
        'check-response-fields.js ist fehlgeschlagen, ohne etwas zu melden',
    );
  }
});
