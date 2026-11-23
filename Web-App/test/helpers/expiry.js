/**
 * Preloaded into every test file (scripts/test-run.js, `--require`): if the
 * child does not end after its last test, it ends itself red and names what stayed
 * open. Since Node 26 --test-timeout only aborts tests, not the file; the
 * runner would otherwise wait for the child until CI aborts the whole job.
 */
if (process.env.NODE_TEST_CONTEXT === 'child-v8' && !process.env.TEST_EXPIRY_ACTIVE) {
  process.env.TEST_EXPIRY_ACTIVE = '1';
  const path = require('node:path');
  const file = path.relative(process.cwd(), process.argv[1] ?? '?');
  const afterLastTest = Number(process.env.TEST_EXPIRY_MS) || 30_000;
  const total = Number(process.env.TEST_FILE_DEADLINE_MS) || 0;
  const finish = (/** @type {string} */ reason) => {
    process.stderr.write(`[auslauf] ${file}: ${reason} — offen: ${process.getActiveResourcesInfo().join(', ')}\n`);
    process.exit(1);
  };
  require('node:test').after(() => {
    setTimeout(() => finish(`${afterLastTest / 1000} s nach dem letzten Test nicht beendet`), afterLastTest).unref();
  });
  if (total) setTimeout(() => finish(`nach ${total / 1000} s nicht fertig`), total).unref();
}
