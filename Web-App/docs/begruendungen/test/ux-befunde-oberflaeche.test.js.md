# Begründungen zu `test/ux-befunde-oberflaeche.test.js`

Die ausführlichen Kommentare aus `test/ux-befunde-oberflaeche.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Befunde der UX-Prüfung vom 30.10.2026, am echten Bündel in jsdom:
  - Kaufpreis 0: „Geschenk“ statt Prozent in Kachel, Finanztabelle und
    Set-Detail; der Kaufpreis steht als „0,00 €“ da.
  - Seiten hinter dem Menü: kein Reiter bleibt markiert, der Seitenname
    steht im Kopf und im Fenstertitel.
  - Importwege als ein Menü neben der Hauptaktion.
  - Das Thema der Kachel ist ganz da (Ellipsis per CSS, voller Name im title).
  - Wertdiagramm: Währung an der Achse, Einstand-Linie, Achsenbruch,
    Fadenkreuz per Tastatur; Zeitraum-Knöpfe ohne Verlauf gesperrt, und
    sie lassen die Filterchips in Ruhe.
  - Der Preis-Platzhalter folgt der Sprache.
  - Ein Set ohne Bild zeigt im Detail denselben Würfel wie in der Kachel.
```
