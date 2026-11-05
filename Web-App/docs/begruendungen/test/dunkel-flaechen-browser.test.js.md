# Begründungen zu `test/dunkel-flaechen-browser.test.js`

Die ausführlichen Kommentare aus `test/dunkel-flaechen-browser.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Im Dunkelmodus jedes Designs bleibt keine Fläche hell und kein Text
unlesbar. Gemessen in Chrome an der echten App: je Design data-dunkel
setzen, jeden Reiter und das Set-Detail öffnen und jedes sichtbare Element
prüfen — eigene Hintergrundfarbe nicht hell (relative Helligkeit ≤ 0,4),
Text mindestens 4,5:1 (gross 3:1) gegen den tatsächlichen Grund.

Ausgenommen sind Inhalte, deren Farbe Information ist (Farbpunkte, Bilder,
Diagramme), und Flächen in Marken- oder Diagrammfarbe — deren Text wird
trotzdem auf Kontrast geprüft. Die Bildfläche .sci ist seit dem 29.10.
dunkel und wird mitgeprüft.

Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
```
