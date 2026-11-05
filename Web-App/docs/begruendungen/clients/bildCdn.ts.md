# Begründungen zu `clients/bildCdn.ts`

Die ausführlichen Kommentare aus `clients/bildCdn.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="cdnagent"></a>
## `_cdnAgent`

```text
Verbindungs-Pool für CDN-Abrufe.

Die Obergrenze schützt den Server davor, bei einer Kachelwand beliebig viele
gleichzeitige TLS-Verbindungen zu öffnen.

── Zur Wahl von 32 ────────────────────────────────────────────────────────
Mit 8 war die Grenze zu eng: Ein einzeln geöffnetes Bild reihte sich hinter
die laufenden Kachel-Anfragen und wartete messbar mit — nachgestellt 1199 ms
gegenüber 152 ms ohne Begrenzung. Eine Kachelwand fordert rund 60 Bilder an;
mit 32 laufen sie in zwei Wellen statt in acht, und eine einzelne Anfrage
wartet höchstens eine Antwortzeit.

Wichtig dazu: `res.on('close')` weiter unten gibt die Verbindung frei, sobald
der Browser abbricht. Ohne das belegten abgebrochene Anfragen ihren Platz und
die Warteschlange verhungerte — das war der eigentliche Schaden der ersten
Fassung, nicht die Grenze selbst.
```
