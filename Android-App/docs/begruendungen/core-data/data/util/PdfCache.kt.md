# Begründungen zu `core-data/util/PdfCache.kt`

Die ausführlichen Kommentare aus `core-data/src/main/java/ch/brickinventoryapp/data/util/PdfCache.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="pdfschritt"></a>
## `PdfSchritt`

```text
Was mit einer zwischengespeicherten Anleitung als Nächstes zu tun ist.

Der Zustand hängt am Dateinamen, nicht an einer Grösse: Eine Zahl allein sagt
nicht, ob sie eine fertige Datei oder einen abgebrochenen Download beschreibt.
Nach einem vollständigen Download fragte `Range: bytes=<vorhanden>-` hinter dem
letzten Byte, und der Server antwortet zu Recht mit 416 (über die
Anleitungs-Route als 404, siehe Web-App/utils/dateiAusliefern.ts). Der laufende
Download schreibt deshalb in `<name>.part` und wird erst beim Abschluss
umbenannt; `<name>` existiert = vollständig. `rename` ist der eine Schritt, der
nicht halb passieren kann.

So öffnet eine schon angesehene Anleitung ohne Netzanfrage, wie prunePdfCache es
verspricht.
```
