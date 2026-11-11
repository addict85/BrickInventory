'use strict';

/**
 * Die Bild-Warteschlange leeren, bevor ein Test sie benutzt.
 * @param {{ run: (sql: string, p?: unknown[]) => Promise<unknown> }} db
 */
async function leereWarteschlange(db) {
  await db.run('DELETE FROM image_wanted').catch(() => {});
  // Eine Drosselpause eines Vorgängers hielte den Stapel sonst an (auftrag_pausen).
  await db.run(`DELETE FROM auftrag_pausen WHERE art = 'bildbedarf'`).catch(() => {});
}

module.exports.leereWarteschlange = leereWarteschlange;
