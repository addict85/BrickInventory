/**
 * Preloaded into every test file (scripts/test-run.js, `--require`): if the
 * child does not end after its last test, it ends itself red and names what stayed
 * open. Since Node 26 --test-timeout only aborts tests, not the file; the
 * runner would otherwise wait for the child until CI aborts the whole job.
 */
if (process.env.NODE_TEST_CONTEXT === 'child-v8' && !process.env.TEST_AUSLAUF_AKTIV) {
  process.env.TEST_AUSLAUF_AKTIV = '1';
  const path = require('node:path');
  const datei = path.relative(process.cwd(), process.argv[1] ?? '?');
  const afterLastTest = Number(process.env.TEST_AUSLAUF_MS) || 30_000;
  const gesamt = Number(process.env.TEST_DATEI_FRIST_MS) || 0;
  const beende = (/** @type {string} */ grund) => {
    process.stderr.write(`[auslauf] ${datei}: ${grund} — offen: ${process.getActiveResourcesInfo().join(', ')}\n`);
    process.exit(1);
  };
  require('node:test').after(() => {
    setTimeout(() => beende(`${afterLastTest / 1000} s nach dem letzten Test nicht beendet`), afterLastTest).unref();
  });
  if (gesamt) setTimeout(() => beende(`nach ${gesamt / 1000} s nicht fertig`), gesamt).unref();
}
