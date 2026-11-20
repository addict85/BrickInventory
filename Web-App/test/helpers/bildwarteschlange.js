'use strict';
/**
 * Die Bild-Warteschlange leeren, bevor ein Test sie benutzt.
 * @param {{ run: (sql: string, p?: unknown[]) => Promise<unknown> }} db
 */
async function emptyQueue(db) {
  await db.run('DELETE FROM image_wanted').catch(() => {});
  // Eine Drosselpause eines Vorgängers hielte den Stapel sonst an (job_pauses).
  await db.run(`DELETE FROM job_pauses WHERE type = 'bildbedarf'`).catch(() => {});
}

module.exports.emptyQueue = emptyQueue;
