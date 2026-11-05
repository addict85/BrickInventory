# Begründungen zu `test/klickflaechen-tastatur-browser.test.js`

Die ausführlichen Kommentare aus `test/klickflaechen-tastatur-browser.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Jede Klickfläche ist mit der Tastatur bedienbar (WCAG 2.1.1, Stufe A): Auf
allen Hauptseiten, in Karten- und Tabellenansicht und im Haushalt, hat jedes
sichtbare Element mit data-click, das kein Knopf, Link oder Feld ist,
tabindex="0" und eine Rolle (eine Tabellenzeile hat ihre eigene). Ausgenommen
sind nur aria-hidden-Abkürzungen in einer selbst bedienbaren Karte (der
Papierkorb der Kachel löscht, was ihr Dialog auch löscht) und stopEvent,
das nur den Klick der Zeile von ihren Knöpfen fernhält. Dazu der Befund
selbst: Die Figur aus einem Set wird mit Tab erreicht und öffnet mit Eingabe.
```
