# Begründungen zu `public/js/02-set-csv-import.js`

Die ausführlichen Kommentare aus `public/js/02-set-csv-import.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="derselbe-zeilenbauer-wie-in-01"></a>
## `z`

```text
Derselbe Bauer wie oben und in 01-fortschritt.js. Hier war die
DRITTE Fassung derselben drei Zeilen — und es ist die, die Marco
am 21.10. fotografiert hat: der Dialog NACH dem Import, in der
Sitzung, die ihn gestartet hat.

Ohne esc(): addCsvLog setzt textContent, nicht innerHTML. Eine
Maskierung davor wird dort nicht aufgeloest, sondern sichtbar
(„Brick &amp; Co"). Der Zeitueberschreitungs-Hinweis bleibt — er
gilt nur fuer den CSV-Import und reist deshalb als Zusatz mit.
```
