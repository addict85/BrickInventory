/**
 * The environment variables got English names; an existing .env with the old
 * German names keeps working and startup names what to switch over.
 *
 * Counter-checks (22.11.2026, each on its own):
 *   A  entry `JOB_PARALLEL: 'AUFTRAG_PARALLEL'` removed from RENAMED_VARIABLES →
 *      red at „the old name still counts" (jobParallel 4 instead of 7).
 *   B  withRenamedVariables copies the old value even when the new one is set →
 *      red at „the new name wins" (7 instead of 5).
 *   C  roleFrom without the `beides` case → red at „ROLLE=beides" (ConfigError).
 *   D  startBans without withRenamedVariables → red at „startBans reads the old
 *      names too" (APP_BASE_URL ban despite ROLLE=jobs).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const { loadConfig, startBans, RENAMED_VARIABLES } = _req('src/infra/config.js');

test('the old name still counts and is reported', () => {
  const k = loadConfig({ AUFTRAG_PARALLEL: '7' });
  assert.equal(k.jobParallel, 7);
  assert.deepEqual(k.renamed, ['AUFTRAG_PARALLEL → JOB_PARALLEL']);
  assert.deepEqual(loadConfig({ JOB_PARALLEL: '7' }).renamed, [], 'the new name alone is no hint');
});

test('the new name wins over the old one', () => {
  assert.equal(loadConfig({ JOB_PARALLEL: '5', AUFTRAG_PARALLEL: '7' }).jobParallel, 5);
});

test('ROLLE=beides still means both, the new value is both', () => {
  assert.equal(loadConfig({ ROLLE: 'beides' }).role, 'both');
  assert.equal(loadConfig({ ROLE: 'both' }).role, 'both');
  assert.equal(loadConfig({ ROLLE: 'jobs' }).role, 'jobs');
  assert.equal(loadConfig({}).role, 'both');
});

test('startBans reads the old names too', () => {
  const base = { NODE_ENV: 'production', DATABASE_URL: 'postgres://u:eigenes@db/x', TRUST_PROXY: '' };
  const ban = bans => bans.some(b => b.includes('APP_BASE_URL'));
  assert.equal(ban(startBans(base)), true, 'without an address the web start is banned');
  assert.equal(ban(startBans({ ...base, ROLLE: 'jobs' })), false, 'the jobs process needs no address');
  assert.equal(ban(startBans({ ...base, APP_BASE_URL_FEHLT_OK: '1' })), false);
});

test('every renamed variable maps an old German name to a new one', () => {
  const pairs = Object.entries(RENAMED_VARIABLES);
  assert.ok(pairs.length >= 20, `only ${pairs.length} renamed variables`);
  for (const [fresh, alt] of pairs) {
    assert.notEqual(fresh, alt);
    assert.match(fresh, /^[A-Z][A-Z0-9_]*$/);
    assert.equal(loadConfig({ [alt]: undefined }).renamed.length, 0);
  }
});
