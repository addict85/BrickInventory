# Begründungen zu `test/diagramm-achse-oberflaeche.test.js`

Die ausführlichen Kommentare aus `test/diagramm-achse-oberflaeche.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Diagramme ohne leere Fläche und ohne Überdeckung (UI-Prüfung 03.11.2026, N1):
  - Der Preisverlauf beginnt beim ersten Marktpreis; ein früherer Kauf steht
    als Punkt am linken Rand statt drei leere Monate aufzuspannen.
  - Die Beschriftung der Einstand-Linie steht unter der Linie, wenn die
    Kurve rechts knapp darüber endet.
Am echten Bündel in jsdom.
```
