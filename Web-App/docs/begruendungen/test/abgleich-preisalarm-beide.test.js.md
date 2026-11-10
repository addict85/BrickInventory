# Begründungen zu `test/preisalarm-beide.test.js`

Die ausführlichen Kommentare aus `test/preisalarm-beide.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kt-einst"></a>
## `const KT_EINST  = lies(path.join(__dirname, '..', '..', 'Android-App',`

```text
Die Einstellungen der App liegen in mehreren Dateien: Der Bildschirm
selbst traegt nur die Liste, jede Rubrik hat ihre eigene Seite
(EinstellungenUnterseiten.kt) mit der Karte in Einstellungen*.kt. Gelesen
werden deshalb alle, die es betrifft — die
Zusicherung lautet „die App tut das in ihren Einstellungen" und nicht
„in dieser Datei".
```
