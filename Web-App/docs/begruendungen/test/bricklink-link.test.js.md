# Begründungen zu `test/bricklink-link.test.js`

Die ausführlichen Kommentare aus `test/bricklink-link.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
BrickLink-Link-Auflösung für Katalog-Sets (src/katalog/bricklinkLink.ts).

Der Katalog steht auf Rebrickable-Daten und hat den Kauf-Link bisher direkt
aus rb_sets.set_num gebaut — immer als Set (`?S=75192-1`). Für alles, was
BrickLink nicht als Set führt (Gear, Bücher), war damit sowohl der Parameter
als auch die Nummer falsch: BrickLink vergibt dort keinen "-1"-Suffix.

Die reinen Funktionen sind hier ohne DB testbar; resolveMany() braucht
Postgres und wird im Integrationstest abgedeckt.

Ausführen: npm test
```
