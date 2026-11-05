# Begründungen zu `test/preis-rueckfall-db.test.js`

Die ausführlichen Kommentare aus `test/preis-rueckfall-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Finanzen: Ein gebrauchtes Set ohne Gebraucht-Preis bekommt den Preis für
„Neu" — auch wenn der nur noch alt im Cache liegt.

Fall vom 25.10. (Holiday House, 2026): Für „Gebraucht" stand ein frischer
Eintrag ohne Preis, der Neu-Preis war älter als die Cache-Dauer. Die
Detailansicht zeigte ihn (sie liest jeden Cache-Eintrag), Finanzen zeigte
„—": fetchPrice sah im frischen Cache nach „Neu" nach und rief es nie ab.
```
