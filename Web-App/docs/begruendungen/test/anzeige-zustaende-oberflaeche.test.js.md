# Begründungen zu `test/anzeige-zustaende-oberflaeche.test.js`

Die ausführlichen Kommentare aus `test/anzeige-zustaende-oberflaeche.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Zahlen, Achsen und Zwischenzustände — am echten Bündel in jsdom.

  - Die Kopfleiste zeigt 1300 Teile als „1’300“ (de-CH), nicht „1.3k“.
  - Das Wertdiagramm teilt die Werte nach 1-2-5, legt die Punkte auf eine
    Zeitachse (ein Monat ist breiter als ein Tag) und beschriftet sie
    einheitlich mit Monatsnamen — ohne „29.10“ neben „12/25“.
  - Solange Finanzen laden, stehen in den Kacheln Platzhalter (aria-busy)
    statt „—“.
  - Solange die Teile laden, steht die leere Box „Manuell erfasste Teile“
    nicht da.
  - Ohne E-Mail-Adresse steht im Konto nicht „verifiziert“.
  - Der Hinweis „Rebrickable-API-Schlüssel“ erscheint nicht über dem
    Einrichtungsassistenten, der genau ihn abfragt.
  - Das Konto wählt ein eigenes Design oder die Vorgabe des Verwalters.
```
