# Begründungen zu `test/setitem-set-tabelle.test.js`

Die ausführlichen Kommentare aus `test/setitem-set-tabelle.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
„Verwendet in" zeigt Bild, Nummer und Bezeichnung — in BEIDEN Oberflächen.

── Marcos Vorgabe ──────────────────────────────────────────────────────────

„Können die Sets in den Detail-Dialogen der Teile und Minifiguren mit den
kleinen Bildern in einer Tabelle angezeigt werden? 1. Spalte kleines Thumb
vom Set, 2. Spalte Setnummer, 3. Spalte Bezeichnung — so wie im Reiter
Finanzen."

Vorher standen Nummer und Name als Fliesstext nebeneinander („8480-1 Space
Shuttle"), ohne Bild und ohne gemeinsame Kante; bei mehreren Sets begann
jeder Name an einer anderen Stelle.

── Warum das nichts gekostet hat ───────────────────────────────────────────

Der Server liefert `image_local` und `image_url` JE SET längst mit
(src/bestand/gemeinsam.ts, verwendendeSets → VerwendendesSet). Beide
Oberflächen haben die Felder nur nie benutzt — wieder ein Wert, der über die
Leitung kommt und niemanden erreicht.

── Warum die Prüfung beide Bäume liest ─────────────────────────────────────

Genau hier laufen die zwei Oberflächen in diesem Projekt auseinander: Eine
Anzeige wird auf einer Seite verbessert, die andere bleibt stehen. Die Regel
heisst deshalb „beide", nicht „die Webapp".
```

<a id="stelle"></a>
## `assert.match(src, /rememberTileImageWithFallback\(serverUrl, s\.imageL`

```text
── Warum hier NICHT resolveThumbUrl steht ────────────────────────────────

Diese Zusicherung nannte zuerst `resolveThumbUrl(serverUrl, s.imageLocal,
s.imageUrl)` — den blossen Vorschau-Aufloeser. Der App-Lauf 128 hat die
handgeschriebene Zeile daneben verworfen (fester Eckenradius,
DesignTokensTest), und beim Ersetzen kam heraus, dass sie noch etwas
ZWEITES nicht konnte: den Rueckfall auf die volle Aufloesung, wenn es kein
Vorschaubild gibt. Die Webapp hat ihn ueber `data-orig` (11-actions.js,
„nachladen, wenn die Vorschau fehlschlaegt"); in der App heisst er
rememberTileImageWithFallback und loest die Vorschau gleich mit auf.

Geprueft wird deshalb der staerkere der beiden Wege — sonst waere die
Zusicherung mit dem schwaecheren zufrieden.
```
