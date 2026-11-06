# Begründungen zu `test/schema-am-start.test.js`

Die ausführlichen Kommentare aus `test/schema-am-start.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Keine Schema-Anweisung im Anfragepfad.

Der Wächter selbst steht in scripts/check-schema-am-start.js — samt der
Begründung, woher die Regel kommt und was der erste, zu weit gefasste
Entwurf gemeldet hat. Hier wird er nur ausgeführt, damit er beim normalen
`npm test` mitläuft und nicht nur, wenn jemand daran denkt.

Dasselbe Muster wie bei check-antwortfelder.js und
check-doppelte-operanden.js.
```
