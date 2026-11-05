# Begründungen zu `test/helpers/oberflaeche-pruefung.js`

Die ausführlichen Kommentare aus `test/helpers/oberflaeche-pruefung.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die ganze Oberfläche in Chrome, für ein Design und ein Gerät (Rechner
1280 × 900 oder Telefon 390 × 844), hell und dunkel: jeder Reiter, alle
Abschnitte der Einstellungen, die Seiten hinter dem Menü und die
wichtigsten Dialoge. Je Zustand:
  - axe-core: kein Verstoss, gleich welcher Stufe;
  - Layout (layout-messung.js): kein waagrechter Überlauf, jedes Tippziel
    ≥ 44 × 44 px am Telefon und ≥ 24 × 24 px am Rechner, keine überlappenden
    Bedienelemente, kein abgeschnittener Text ohne „…“, Text und Platzhalter
    ≥ 4,5:1 (gross 3:1), Feldgrenzen, Sinnbild-Knöpfe, Knopfgrenzen und
    aktive Zustände (Ansicht, Sammlungswahl, Zeitraum, Reiter) ≥ 3:1;
  - in jedem Dialog: Tab erreicht jedes Bedienelement, jede Klickfläche
    nimmt den Fokus, und der Fokus bleibt im Dialog.
Gemessen werden Eigenschaften statt Bilder: Pixelvergleiche hingen an den
Schriften der Maschine. Je Design und Gerät eine Testdatei, damit jede
unter der Zeitgrenze einer Datei (60 s) bleibt.
```
