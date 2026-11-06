# Begründungen zu `test/acquisition-scope-db.test.js`

Die ausführlichen Kommentare aus `test/acquisition-scope-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Kaufpreis einer Erfassung des UNTERKONTOS ändern — beide Routenfamilien.

── Woher dieser Test kommt (Marcos Fehlerbericht, Nachtrag 45) ─────────────
„Wenn ich den Kaufpreis im Kaufpreis-Dialog anpasse (Android oder Webapp),
wird er nicht gespeichert. In der Webapp kommt die Meldung Not found."
Sein Server-Log zeigte zwei 404 aus derselben Wurzel:
  routes/sets.js:1225            → „Not found" (heute src/sammlung/erfassungen.ts)
  routes/api_v1/acquisitions.js  → „Erfassung nicht gefunden"

Ursache: Beide Wege suchten die Zeile mit `WHERE id=$1 AND user_id=$2` und
der EIGENEN Betrachter-ID. Im Haushalt gehört die Erfassung aber oft einem
Unterkonto — das Hauptkonto darf sie sehen UND ändern, fand sie hier aber
nicht. Wieder das Muster „Regel fehlt am zweiten Weg", diesmal an vier
Stellen gleichzeitig (Ändern und Löschen, Webapp und App).

Bewusst NICHT scopeIds(): Das ist das LESE-Blickfeld und enthält für ein
Unterkonto auch dessen Hauptkonto — damit dürfte es rückwärts schreiben.
writableIds() ist enger und deckt sich mit canWriteFor(). Die Asymmetrie
„Lesen weit, Schreiben eng" prüft der letzte Teilschritt ausdrücklich mit.

Zweiter Teil des Fixes: Nach dem Finden zählt der BESITZER der Zeile, nicht
der Betrachter. Sonst liefe die Spiegelung nach `sets` (Menge, Preis,
Zustand) in das falsche Konto. Beim ersten Anlauf hatte ich genau das
übersehen — drei `latest`-Abfragen suchten weiter mit der Betrachter-ID, und
die Spiegelung blieb still auf dem alten Wert stehen.
```
