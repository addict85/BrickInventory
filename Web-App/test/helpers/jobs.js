'use strict';
/**
 * Imports run as a job in the job process (src/jobQueue/importAsJob.ts);
 * in the test a worker in this process processes them, otherwise the
 * request would wait in vain.
 *
 *   importWorker(t, _req);
 *
 * @param {{ after: (f: () => unknown) => void }} t
 * @param {(path: string) => any} _req  buildAndRequire() of the test file
 */
function importWorker(t, _req) {
  const { startJobWorker } = _req('jobs/startJobs.js');
  const worker = startJobWorker(require('./sources').testServices(), { kinds: ['csv_import'], tickMs: 50 });
  // The LISTEN connection too: it would otherwise keep the test process alive.
  t.after(async () => {
    await worker.stop();
    await require('./sources').testAccess().notification.close();
  });
}

module.exports = { importWorker };
