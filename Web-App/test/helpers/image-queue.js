'use strict';
/**
 * Empty the image queue before a test uses it.
 * @param {{ run: (sql: string, p?: unknown[]) => Promise<unknown> }} db
 */
async function emptyQueue(db) {
  await db.run('DELETE FROM image_wanted').catch(() => {});
  // A predecessor's throttle pause would otherwise hold the batch (job_pauses).
  await db.run(`DELETE FROM job_pauses WHERE type = 'bildbedarf'`).catch(() => {});
}

module.exports.emptyQueue = emptyQueue;
