# Begründungen zu `core-ui/ui/theme/Abstaende.kt`

Die ausführlichen Kommentare aus `core-ui/src/main/java/ch/brickinventoryapp/ui/theme/Abstaende.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abstaende"></a>
## `Abstaende`

```text
Die Abstandsskala der App — damit Abstände einen Namen haben statt als blanke
Zahlen in den Bildschirmen zu stehen, wie die CSS-Klassen der Webapp.

Die Skala ist die übliche (Zweierschritt unten, Viererschritt oben). Die
Abstände im Baum bilden ein 2-dp-Kontinuum; 6, 10 und 14 einzeln zu benennen
wäre eine Umbenennung, keine Skala. Die Stellen, die nicht auf die Skala fallen,
stehen weiter als Zahl da: Sie zu verschieben ist eine Gestaltungsentscheidung
für den, der die App vor sich sieht. AbstandsskalaTest zählt sie und lässt die
Zahl nur sinken.
```

<a id="rand"></a>
## `rand`

```text
Der Seitenrand der Bildschirme — 14 dp. Kein Abstand zwischen Dingen, sondern
der Rand, an dem eine Seite beginnt; er steht vielfach im Baum
(ScopeFilterZeile, Suchfeld, Chip-Zeilen), und ihn auf 16 zu ziehen wäre eine
Gestaltungsänderung an all diesen Stellen. Der Name lässt neue Bildschirme sich
an demselben Wert ausrichten, ohne eine blanke 14 zu schreiben, die
AbstandsskalaTest zählt — und wandert der Rand einmal, dann an einer Stelle.
```
