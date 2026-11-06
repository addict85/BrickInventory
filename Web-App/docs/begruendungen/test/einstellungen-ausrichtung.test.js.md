# Begründungen zu `test/einstellungen-ausrichtung.test.js`

Die ausführlichen Kommentare aus `test/einstellungen-ausrichtung.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Einstellungen richten ihre Spalten aneinander aus, nicht an der Textlänge.

── Marcos Befunde (mit Bildern) ────────────────────────────────────────────

  1. „Kannst du einen kleinen Abstand zwischen dem Einladungscode und dem
     Verknüpfen Button einfügen? die sind zu nahe bei einander."
  2. „Kannst du sicherstellen dass die Felder alle schön gleich ausgerichtet
     sind wie in einer Tabelle? aktuell sind sie alle unterschiedlich lang."
     (Lagerorte)
  3. „dass alle Entfernen Buttons schön in einer Spalte sind? aktuell sind
     sie nicht alle gleich ausgerichtet."

2 und 3 haben dieselbe Ursache: Jede Zeile war ein EIGENES Flexfeld. Damit
beginnt die nächste Spalte dort, wo der Inhalt der vorigen aufhört — und
„emily.bigolin" endet woanders als „alessio.bigolin", „406 Sets, 0
Teilesorten, 0 Figuren" woanders als „leer".

Die Abhilfe ist dieselbe: Das Raster steht auf der LISTE, die Zeilen sind
`display:contents`. Nur so teilen sich alle Zeilen DIESELBEN Spaltenbreiten.
Wäre jede Zeile ein eigenes Raster, hätte jede wieder ihre eigenen Breiten —
also genau den Zustand von vorher. Genau diesen Unterschied prüfen die Fälle
unten: Es reicht nicht, dass irgendwo „grid" steht.

── Warum das hier prüfbar IST ──────────────────────────────────────────────

jsdom rechnet kein Layout — eine Breite in Pixeln liesse sich hier nicht
messen. Was die Ausrichtung entscheidet, steht aber vollständig im Markup:
WO das Raster sitzt und ob die Zeilen einen eigenen Kasten erzeugen. Genau
das wird geprüft, und zwar an der ERZEUGTEN Struktur, nicht am Quelltext.
```
