'use strict';

/**
 * Die Bild-Warteschlange leeren, bevor ein Test sie benutzt.
 *
 * ── Warum das noetig ist, und zwar GEMESSEN ─────────────────────────────────
 *
 * `imageQueue._arbeiteStapel()` holt sich die aeltesten Notizen der GANZEN
 * Tabelle:
 *
 *     DELETE FROM image_wanted
 *      WHERE url IN (SELECT url FROM image_wanted
 *                     WHERE requested_at > … ORDER BY requested_at ASC LIMIT $2)
 *
 * Die Tests grenzen ihre eigenen Zeilen dagegen ueber ein Praefix ab
 * (`DR<pid>_1` …) — aber nur beim ZAEHLEN und beim Aufraeumen, nicht beim
 * Stapel. Laesst eine frueher gelaufene Testdatei Zeilen zurueck, nimmt der
 * Stapel DEREN Zeilen und der Test misst etwas anderes, als er glaubt.
 *
 * NACHGESTELLT, nicht vermutet: zehn fremde Zeilen von Hand eingefuegt
 * (`FREMD_1` … `FREMD_10`), dann image-throttle-db.test.js laufen lassen:
 *
 *     not ok 1 - eine hoffnungslose Vorschau wird nur EINMAL versucht
 *         0 Versuche in drei Durchgaengen
 *     not ok 1 - 403 sperrt kein Bild aus und verliert keine Notiz
 *         0 Versuche — nach der ersten Drosselung muss der Stapel abbrechen
 *     # pass 1  # fail 4
 *
 * Das ist WORTGLEICH der Fehlschlag, der in dieser Reihe gelegentlich auftrat
 * und sich allein nie nachstellen liess — acht Laeufe hintereinander gruen,
 * und im Zusammenhang der ganzen Reihe rot.
 *
 * ── Warum die ganze Tabelle und nicht nur das Praefix ───────────────────────
 *
 * Weil genau das die Luecke war. Jede Datei raeumt ihr eigenes Praefix weg —
 * aber eine Datei, die mittendrin scheitert, kommt nicht mehr dazu, und
 * catalog-images-button-db.test.js raeumte ueberhaupt nicht auf. Vor dem
 * Benutzen zu leeren ist die einzige Form, die nicht davon abhaengt, ob der
 * Vorgaenger ordentlich war.
 *
 * Unbedenklich, weil die Testreihe mit `--test-concurrency=1` laeuft: Es
 * arbeitet immer nur EINE Datei an der Datenbank. Und `image_wanted` ist eine
 * Warteschlange, kein Bestand — eine verlorene Notiz wird beim naechsten
 * Seitenaufruf neu geschrieben.
 *
 * @param {{ run: (sql: string, p?: unknown[]) => Promise<unknown> }} db
 */
async function leereWarteschlange(db) {
  await db.run('DELETE FROM image_wanted').catch(() => {});
}

module.exports.leereWarteschlange = leereWarteschlange;
