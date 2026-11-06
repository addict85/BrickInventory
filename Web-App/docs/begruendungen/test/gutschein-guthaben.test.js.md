# Begründungen zu `test/gutschein-guthaben.test.js`

Die ausführlichen Kommentare aus `test/gutschein-guthaben.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Guthaben-Abfrage — ohne eine einzige Verbindung nach draussen.

── Warum das wichtig ist ───────────────────────────────────────────────────

Diese Datei prueft einen Weg, auf dem eine KARTENNUMMER UND EINE PIN zu
lego.com gehen. Ein Test, der dabei wirklich hinausruft, wuerde Marcos
echte Karte abfragen oder eine erfundene — beides nicht. Deshalb bekommt
`holeGuthaben` seinen Abruf INJIZIERT (`opt.abruf`), und jeder Test hier
zaehlt mit, welche Adressen angefragt wurden. Nichts geht hinaus.
```

<a id="stelle"></a>
## `G.vergesseSitzungen();`

```text
── Woher dieser Fall kommt ───────────────────────────────────────────

Marcos Frage: „schlägt cloudflare an, wenn ich 1nen Request pro 30sek
für die Guthaben sende oder wird dies noch nicht als Bot eingestuft?"
Beim Beantworten fiel diese Lücke auf: Der Sitzungsvorrat hält eine
Sitzung, solange ihr Token lebt (~24 h). Die Cookies darin altern
schneller — Cloudflares `__cf_bm` lebt etwa 30 Minuten. Ohne das
Verwerfen nähme der Versuch NACH der Pause wieder dieselben alten
Cookies, bekäme wieder 403 und pausierte wieder: eine Schleife, die nie
eine frische Seite lädt.
```

<a id="stelle-2"></a>
## `G.vergesseSitzungen();`

```text
── Was ich hier erwartet hatte, und was gemessen herauskam ────────────

Erwartet: Ein praeparierter Wert wie `../../boese.example.com/x` als
Land laesst `holeGuthaben` an der Hostpruefung scheitern.
GEMESSEN: Er scheitert NICHT — und das ist die bessere Nachricht. Das
Land wird in den PFAD eingesetzt (`https://www.lego.com/<land>/…`), und
`new URL()` normalisiert `..` innerhalb des Pfades. Der Host bleibt
www.lego.com, egal was im Land steht; eine Umlenkung auf einen fremden
Host ist ueber diesen Weg gar nicht moeglich.

Die Zusicherung sagt deshalb jetzt das, was wirklich gilt — und nicht
mehr das, was ich angenommen hatte.
```
