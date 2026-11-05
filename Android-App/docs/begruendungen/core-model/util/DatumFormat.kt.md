# Begründungen zu `core-model/util/DatumFormat.kt`

Die ausführlichen Kommentare aus `core-model/src/main/java/ch/brickinventoryapp/util/DatumFormat.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="fmtuhrzeit"></a>
## `fmtUhrzeit`

```text
ISO-Zeitstempel aus einer Serverantwort als Uhrzeit — HH:MM:SS, für das
Protokoll der Verwaltung wie in der Webapp (public/js/logviewer.js): Ohne Zeit
ist „von eben oder von gestern?“ nicht zu beantworten.

Hier wird umgerechnet, in [fmtDatum] nicht: Ein Erfassungsdatum ist ein
gewählter Kalendertag, ein Protokolleintrag ein Zeitpunkt, der auf die Uhr
dessen gehört, der ihn liest. Ohne Zeitzonen-Angabe im Text gilt UTC: Der Server
speichert `timestamptz` und schreibt das „Z“ mit.

@return "14:03:07", oder null wenn nichts Brauchbares dasteht
```
