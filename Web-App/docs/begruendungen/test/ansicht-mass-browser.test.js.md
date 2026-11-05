# Begründungen zu `test/ansicht-mass-browser.test.js`

Die ausführlichen Kommentare aus `test/ansicht-mass-browser.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Masse der Oberfläche, gemessen in Chrome an der echten App.

Telefon (390 × 844):
  - Kein Betrag in den Finanzkacheln bricht um oder ragt über die Kachel.
  - Der Löschknopf (44 × 44) überdeckt weder das Bild einer manuellen
    Teilekachel noch den Preis einer Merklistenzeile.
  - Kennzahlen (in jedem Design als Kacheln): höchstens zwei Reihen und
    140 px hoch, ohne waagrechten Rollbereich.
  - Noppe: Die Reiter der unteren Leiste haben mindestens 4,5:1.
Rechner (1280 × 900):
  - Der Fokusring der Reiter liegt innen und wird von der rollenden Leiste
    nicht abgeschnitten.
  - Die Zahlenspalten der Finanztabelle sind samt Kopf rechtsbündig.
  - „Set hinzufügen“: Beschriftungen einer Zeile auf einer Höhe, Felder
    bündig unter ihnen, der Knopf schliesst rechts mit dem Raster ab.
  - Konto: Die Karte ist höchstens 52 rem breit.
```
