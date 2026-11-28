'use strict';

/**
 * Which Actions runs the cleanup (.github/scripts/old-runs.js) deletes.
 *
 * Counter-checks (measured 28.11.2026, each individually):
 *   `if (r.status !== 'completed') continue;` removed and the final filter on status dropped
 *     → red „a running or waiting run is never deleted“
 *   key without head_branch → red „the newest run per workflow and branch stays“ (the tag's
 *     green build is deleted)
 *   newest chosen by id only, created_at ignored → red „the later created run stays …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { deletable } = require(path.join(__dirname, '..', '..', '.github', 'scripts', 'old-runs.js'));

const run = (id, workflow_id, head_branch, created_at, status = 'completed') => ({
  id,
  workflow_id,
  head_branch,
  created_at,
  status,
});

test('the newest run per workflow and branch stays, older finished ones go', () => {
  const runs = [
    run(1, 10, 'main', '2026-11-01T00:00:00Z'),
    run(2, 10, 'main', '2026-11-02T00:00:00Z'),
    run(3, 10, 'android-v2026.11.27.6', '2026-11-01T12:00:00Z'),
    run(4, 20, 'main', '2026-11-01T00:00:00Z'),
    run(5, 20, 'main', '2026-11-03T00:00:00Z'),
  ];
  assert.deepEqual(deletable(runs).sort(), [1, 4]);
});

test('a running or waiting run is never deleted', () => {
  const runs = [
    run(1, 10, 'main', '2026-11-01T00:00:00Z', 'in_progress'),
    run(2, 10, 'main', '2026-11-02T00:00:00Z'),
    run(3, 10, 'main', '2026-11-03T00:00:00Z', 'waiting'),
    run(4, 10, 'main', '2026-11-04T00:00:00Z', 'queued'),
  ];
  assert.deepEqual(deletable(runs), []);
});

test('the later created run stays even when its id is lower', () => {
  const runs = [run(9, 10, 'main', '2026-11-01T00:00:00Z'), run(7, 10, 'main', '2026-11-05T00:00:00Z')];
  assert.deepEqual(deletable(runs), [9]);
});
