/**
 * Vorgeladen in jede Testdatei (scripts/test-lauf.js, `--require`): Endet das
 * Kind nach seinem letzten Test nicht, beendet es sich rot und nennt, was offen
 * blieb. Seit Node 26 bricht --test-timeout nur Tests ab, nicht die Datei; der
 * Runner wartete sonst auf das Kind, bis die CI den ganzen Job abbricht.
 */
if (process.env.NODE_TEST_CONTEXT === 'child-v8' && !process.env.TEST_AUSLAUF_AKTIV) {
  process.env.TEST_AUSLAUF_AKTIV = '1';
  const path = require('node:path');
  const datei = path.relative(process.cwd(), process.argv[1] ?? '?');
  const nachLetztemTest = Number(process.env.TEST_AUSLAUF_MS) || 30_000;
  const gesamt = Number(process.env.TEST_DATEI_FRIST_MS) || 0;
  const beende = (/** @type {string} */ grund) => {
    process.stderr.write(`[auslauf] ${datei}: ${grund} — offen: ${process.getActiveResourcesInfo().join(', ')}\n`);
    process.exit(1);
  };
  require('node:test').after(() => {
    setTimeout(
      () => beende(`${nachLetztemTest / 1000} s nach dem letzten Test nicht beendet`),
      nachLetztemTest,
    ).unref();
  });
  if (gesamt) setTimeout(() => beende(`nach ${gesamt / 1000} s nicht fertig`), gesamt).unref();
}
