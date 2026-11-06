# Begründungen zu `test/einstellungen-browser.test.js`

Die ausführlichen Kommentare aus `test/einstellungen-browser.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Das Port-Feld der SMTP-Einstellungen bleibt in seiner Karte — gemessen in
Chrome mit den echten Stylesheets und dem echten Markup der Karte aus
index.html, bei 1440 und 390 px Breite.

Vorher: grid-template-columns:1fr 120px, aber .fg hat min-width:145px; die
Port-Spalte wurde 145 px breit und ragte rechts über die Karte hinaus.

Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
```
