# Begründungen zu `test/dialoge-grosse-schrift-browser.test.js`

Die ausführlichen Kommentare aus `test/dialoge-grosse-schrift-browser.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Dialoge bei 200 % Browser-Schrift (Page.setFontSizes 32 px) auf 320 und
390 px: Das Benutzermenü bleibt im Bildschirm, die Knöpfe des Bestätigens
überlappen nicht, Felder im Erfassen- und Kaufpreis-Dialog sind hoch genug
für ihre Schrift und ragen nicht hinaus. Dazu der Weg einer Geldeingabe bis
in die Datenbank: „149,95“ im Kaufpreis-Dialog wird 149.95 gespeichert.
Zuletzt die Anmeldemaske: Was der Server nicht kann, steht nicht da.
```
