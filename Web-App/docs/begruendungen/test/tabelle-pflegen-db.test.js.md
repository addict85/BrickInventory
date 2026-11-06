# Begründungen zu `test/tabelle-pflegen-db.test.js`

Die ausführlichen Kommentare aus `test/tabelle-pflegen-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Nach einem Masseneinfuegen wird die Tabelle aufgefrischt — sonst nimmt der
Planer den falschen Index.

── Woher dieser Test kommt ─────────────────────────────────────────────────

Mit den Trigramm-Indizes aus Migration 0029 kam eine Eigenheit mit, die ich
beim Messen zuerst falsch gedeutet habe. GEMESSEN an 72 000 Zeilen in
parts_summary, Suche nach einem seltenen Begriff:

  direkt nach dem Masseneinfuegen        94,1 / 100,2 ms
  nach ANALYZE                            4,8 /  10,3 ms
  nach VACUUM (Statistik war schon da)     0,2 /   0,8 ms

Zwei verschiedene Fehler: ANALYZE richtet die PLANWAHL (ohne frische
Statistik schaetzt der Planer eine Zeile und greift zu einem beliebigen
anderen Index — gemessen idx_parts_summary_cat, der dann alle 72 000 Zeilen
durchgeht), VACUUM leert die WARTELISTE von GIN. Keiner ersetzt den anderen.

── Warum pg_stat_user_tables und keine Zeitmessung ─────────────────────────

Die naheliegende Zusicherung waere „die Suche dauert jetzt unter 1 ms". Die
waere auf einem ausgelasteten Laeufer wackelig und haette mit der Regel nichts
zu tun: Geprueft werden soll, dass die Pflege STATTFINDET, nicht wie schnell
die Maschine ist. `last_vacuum` und `last_analyze` beantworten genau das, und
zwar eindeutig.

Voraussetzung: Test-DB. Ohne DB: skip (mit REQUIRE_DB=1: Fehler).
```
