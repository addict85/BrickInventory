# Begründungen zu `test/instruction-queue-pace-db.test.js`

Die ausführlichen Kommentare aus `test/instruction-queue-pace-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Takt der Anleitungs-Warteschlange gilt echten Abrufen, nicht Durchgängen.

── Marcos Befund (Nachtrag 142) ────────────────────────────────────────────
„Der Download der Handbücher ist extrem langsam."

Die Warteschlange wartete nach JEDEM Set 15 Sekunden. Die Pause ist dazu da,
Brickset und brickinstructions.com zu schonen — aber Sets, die schon eine
Anleitung haben, fallen in `downloadSetInstructions()` sofort heraus, OHNE
eine Verbindung zu öffnen. Für die gibt es nichts zu schonen.

Gemessen: ein solcher Durchgang dauert 0 ms und fragt niemanden. Bei 800
Sets, von denen 700 versorgt sind, waren das knapp DREI STUNDEN Warten für
nichts.

── Derselbe Fehler wie beim Bild-Job ───────────────────────────────────────
Nachtrag 217 (hardened-217): Dort wurde das CDN-Kontingent auf NOTIZEN
angewandt statt auf CDN-Anfragen; Übersprünge bremsten wie Downloads. 37
Minuten Wartezeit für „10 bearbeitet: 0/0/0 bereits vorhanden".

Die Lehre gilt für jede Drosselung: Sie muss an der Handlung hängen, die
geschont werden soll — nicht an der Schleife darüber. Dass der Auftrag nur
nach einem echten Abruf pausiert, prüft test/anleitung-auftrag-db.test.js.
```
