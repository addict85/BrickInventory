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
 *   key without event → red „a pull-request run does not push out the push run of its branch“
 *   skipped runs allowed as the newest → red „a skipped run does not push out the last real one“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { deletable } = require(path.join(__dirname, '..', '..', '.github', 'scripts', 'old-runs.js'));

const run = (
  id,
  workflow_id,
  head_branch,
  created_at,
  status = 'completed',
  conclusion = 'success',
  event = 'push',
) => ({
  id,
  workflow_id,
  head_branch,
  event,
  created_at,
  status,
  conclusion: status === 'completed' ? conclusion : null,
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

test('a skipped run does not push out the last real one', () => {
  const runs = [
    run(1, 30, 'main', '2026-11-28T06:12:49Z'),
    run(2, 30, 'main', '2026-11-28T07:00:00Z', 'completed', 'skipped'),
    run(3, 30, 'main', '2026-11-28T07:30:00Z', 'completed', 'skipped'),
  ];
  assert.deepEqual(deletable(runs).sort(), [2, 3]);
});

test('a pull-request run does not push out the push run of its branch', () => {
  const runs = [
    run(1, 10, 'feature', '2026-11-28T09:00:00Z', 'completed', 'failure', 'push'),
    run(2, 10, 'feature', '2026-11-28T09:01:00Z', 'completed', 'success', 'pull_request'),
  ];
  assert.deepEqual(deletable(runs), []);
});
