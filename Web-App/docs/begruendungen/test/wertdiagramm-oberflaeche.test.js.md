# Begründungen zu `test/wertdiagramm-oberflaeche.test.js`

Die ausführlichen Kommentare aus `test/wertdiagramm-oberflaeche.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Das Wertdiagramm in Finanzen — am echten Bündel in jsdom.

  - Vorgewählt ist „Max“; die erste Abfrage fragt period=max.
  - Mit weniger als zwei echten Messpunkten (der Server ergänzt dann einen
    künstlichen Startwert) steht ein Leerzustand statt einer flachen Linie,
    und neben dem Titel steht keine Veränderung.
  - Mit Verlauf steht die Veränderung mit ihrem Zeitraum da.
  - Der Leerzustand ist übersetzt (vorher fest „Noch keine Verlaufsdaten.“).
```
