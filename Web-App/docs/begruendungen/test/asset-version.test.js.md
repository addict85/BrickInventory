# Begründungen zu `test/asset-version.test.js`

Die ausführlichen Kommentare aus `test/asset-version.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Jede versionierte Referenz in index.html trägt die Version aus package.json.

── Warum das zählt ─────────────────────────────────────────────────────────

server.ts liefert alles unter public/ mit `maxAge: '7d'` aus und begründet
das dort ausdrücklich: „index.html bekommt no-cache, damit Deploys sofort
sichtbar sind — die versionierten Referenzen darin ziehen dann frische
Assets nach."

Der Satz stimmt nur, solange die `?v=` auch wirklich wechseln. Bleibt eine
zurück, holt der Browser genau diese Datei bis zu sieben Tage lang aus dem
Cache — und der Deploy ist für sie wirkungslos. Nichts hat das bisher
geprüft; die acht Werte standen von Hand da und mussten von Hand
mitgeändert werden.

NACHGEMESSEN aufgefallen ist es beim Ergänzen der Sprachdateien (Nachtrag
142): Neue Schlüssel in locales/de.js hätten zurückkehrende Browser erst mit
der nächsten Versionsänderung erreicht — und ohne Prüfung merkt das niemand,
weil ein frisch geleerter Cache alles richtig zeigt.

── Was der Test NICHT prüft ────────────────────────────────────────────────

Ob die Version überhaupt erhöht WURDE, nachdem sich eine Datei geändert hat.
Das ist eine Freigabe-Entscheidung und keine Eigenschaft des Quelltextes.
Geprüft wird nur, dass die acht Verweise unter sich und mit package.json
einig sind — der Teil, der still falsch werden kann.
```
