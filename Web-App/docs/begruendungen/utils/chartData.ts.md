# Begründungen zu `utils/chartData.ts`

Die ausführlichen Kommentare aus `utils/chartData.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="chartpoint"></a>
## `ChartPoint`

```text
Diagrammdaten in einer einheitlichen Form — für alle Verlaufs-Endpunkte.

── Warum der Server das ausrechnet ─────────────────────────────────────────
Vorher lieferte jede Route rohe Zeilen, und jeder Client baute daraus selbst
eine Zeitachse: die Webapp in priceChartSVG(), Android noch einmal. Zwei
Umsetzungen derselben Rechnung — genau das Muster, das in diesem Projekt
schon mehrfach auseinandergelaufen ist (Zustandsauflösung, Bild-Allowlist,
Preisverlauf-Route).

Jetzt liefert der Server fertige Reihen mit gemeinsamer x-Achse. Ein Client
muss nur noch zeichnen.

── Form ────────────────────────────────────────────────────────────────────
  { values: [ { name: "Neu", values: [ { x: "2026-01-01", y: 12.5 }, … ] },
              { name: "Gebraucht", values: [ … ] } ] }

Alle Reihen haben dieselben x-Werte in derselben Reihenfolge und damit
dieselbe Länge.

── Zu den Nullen ───────────────────────────────────────────────────────────
Beginnt eine Reihe später, werden die vorderen Positionen mit 0 aufgefüllt —
so angefordert, und für Diagrammbibliotheken, die gleich lange Achsen
verlangen, ist das der übliche Weg.

ACHTUNG beim Zeichnen: Eine 0 ist hier "kein Wert", nicht "Preis null". Wer
sie als Punkt zeichnet, erhält eine Linie, die bei null beginnt und dann
senkrecht hochspringt — das sieht aus wie ein Kurssturz, den es nie gab.
Renderer sollten führende Nullen überspringen; `firstRealIndex` unten sagt
je Reihe, ab wo echte Werte stehen.
```
