# Begründungen zu `test/lesbarkeit-browser.test.js`

Die ausführlichen Kommentare aus `test/lesbarkeit-browser.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Lesbar und erreichbar — gemessen im Browser mit den echten Stylesheets.

  - Text auf Primär- und Fehlerflächen hat mindestens 4,5:1 (WCAG AA), auch
    im dunklen Design „werkbank". Ebenso die 11-px-Etiketten (Zustand,
    Besitzer, Menge), die Sammlungswahl und der Admin-Hinweis.
  - Die Datei-Felder in den Knopf-Labels (CSV, BrickLink XML) lassen sich
    fokussieren; mit display:none übersprang Tab sie.
  - Nummer und Jahr auf der Set-Kachel stehen in mindestens 12 px.
  - Die dunkle Variante jedes Designs (data-dunkel): Primärknopf, Text,
    Nebentext, Preis, Gewinn, Verlust und Markenfarbe je mindestens 4,5:1
    auf der Karte; die Markenfarben der Designs bleiben verschieden.
  - Preise und Kennzahl-Beträge stehen in „noppe“ und „hochglanz“ nicht in
    Rot (die Marke ist rot; Rot heisst sonst Verlust); die Reiter auf der
    roten bzw. schwarzen Leiste, das Ersatzteil-Etikett und die Unterzeile
    der hellblauen Kachel haben mindestens 4,5:1.
  - Zwischen zwei Wörtern auf einem Knopf steht mindestens 0,22 em.
  - Der Fokusring des Knopfs „Anmelden“ ist mindestens 3 px breit und hebt
    sich mit 3:1 vom Grund der Anmeldekarte ab, hell wie dunkel.

Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
```
