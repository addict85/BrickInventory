# Begründungen zu `test/helpers/textausgabe.js`

Die ausführlichen Kommentare aus `test/helpers/textausgabe.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="if-stelle"></a>
## `if (process.env.NODE_TEST_CONTEXT === 'child-v8') {`

```text
Vorgeladen in jede Testdatei (scripts/test-lauf.js, `--require`): Text auf
stdout geht nach stderr. node:test liest Berichtsrahmen und Text des Kindes
aus demselben Strom; folgt Text mit einem Nicht-ASCII-Byte an Stelle 2
(„✅ …", „╔══…") im selben Lesestück direkt auf einen Rahmen, rechnet der
Leser (Node 22) dessen Länge vorzeichenbehaftet und deserialisiert den Text:
„Unable to deserialize cloned data". Rahmen sind Buffer, Text ist String.
```
