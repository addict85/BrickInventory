# Begründungen zu `src/bestand/repository/lagerort.ts`

Die ausführlichen Kommentare aus `src/bestand/repository/lagerort.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="setzelagerort-setzen"></a>
## `setzen`

```text
── Die Zuordnung ist seit Migration 0031 eine ID ────────────────────────

Aufgelöst wird sie in einer Unterabfrage je ZEILE und nicht einmal
vorher. Das hat einen Grund, der im Haushalt sichtbar wird: Derselbe
Name kann in zwei Konten liegen, und jedes hat seine eigene Zeile im
Vorrat (ein Regal ist ein Regal in EINER Wohnung, Migration 0020). Die
Unterabfrage greift über `l.user_id = t.user_id` genau die des
Besitzers — eine vorher aufgelöste ID träfe für das zweite Konto die
falsche Wohnung.

`lower(...)`: Der Vorrat ist ohne Rücksicht auf Gross-/Kleinschreibung
eindeutig. Genau hier lag der Fehler des alten Entwurfs — er schrieb die
GETIPPTE Schreibweise an den Bestand, und die musste nicht die des
Vorrats sein (nachgestellt in der Migration).

Dieselbe Anweisung leert auch: Mit `ort = null` ist `lower($2)` NULL, die
Unterabfrage findet nichts und setzt NULL. Eine zweite Anweisung dafür
wäre eine zweite Stelle, die stimmen muss.
```
