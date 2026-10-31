# Begründungen zu `src/finanzen/portfolio/diagrammdaten.ts`

Die ausführlichen Kommentare aus `src/finanzen/portfolio/diagrammdaten.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="bauediagrammdaten"></a>
## `baueDiagrammdaten`

```text
Aus den rekonstruierten Rohpunkten die fertigen Diagrammdaten machen:
Wertebereich mit Rand, fünf Y-Beschriftungen, X-Beschriftungen und die
Prozentänderung über den Zeitraum.

── Warum eigene Datei (Nachtrag 135) ───────────────────────────────────────

getPortfolioHistory() war 449 Zeilen und tat drei Dinge nacheinander:
entscheiden, in welcher Auflösung gerechnet wird; die Kurve aus dem
Preisverlauf JE SET rekonstruieren; und daraus Achsen und Beschriftungen
machen. Nur das dritte ist reine Rechnung ohne Datenbank — und damit der
Teil, den man beim Suchen nach einem Achsenfehler nicht in zweihundert
Zeilen SQL-Rekonstruktion suchen sollte.

Die Schnittstelle ist schmal: rein die Rohpunkte und die Währung, raus die
fertigen Diagrammdaten. Keine Datenbank, kein Zustand.
```
