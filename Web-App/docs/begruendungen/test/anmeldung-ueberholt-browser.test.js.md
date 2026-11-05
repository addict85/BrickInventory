# Begründungen zu `test/anmeldung-ueberholt-browser.test.js`

Die ausführlichen Kommentare aus `test/anmeldung-ueberholt-browser.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Wer sich anmeldet, während die Startfrage „bin ich angemeldet?“ noch
unterwegs ist, bleibt angemeldet: Die späte Antwort „nein“ darf die App
nicht zurück auf die Anmeldemaske werfen.

Nachgestellt in Chrome am echten Server: /api/v1/auth/me antwortet erst
nach 4 s mit loggedIn: false, die Anmeldung läuft in dieser Zeit durch.

Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
Voraussetzung: Test-DB via TEST_DATABASE_URL.
```
