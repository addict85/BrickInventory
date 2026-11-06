'use strict';

/**
 * Die Bild-Warteschlange leeren, bevor ein Test sie benutzt.
 * Ausführlich: docs/begruendungen/test/helpers/bildwarteschlange.js.md#leerewarteschlange
 * @param {{ run: (sql: string, p?: unknown[]) => Promise<unknown> }} db
 */
async function leereWarteschlange(db) {
  await db.run('DELETE FROM image_wanted').catch(() => {});
  // Eine Drosselpause eines Vorgängers hielte den Stapel sonst an (auftrag_pausen).
  await db.run(`DELETE FROM auftrag_pausen WHERE art = 'bildbedarf'`).catch(() => {});
}

module.exports.leereWarteschlange = leereWarteschlange;
