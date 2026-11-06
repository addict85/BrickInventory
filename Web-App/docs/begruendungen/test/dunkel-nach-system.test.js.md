# Begründungen zu `test/dunkel-nach-system.test.js`

Die ausführlichen Kommentare aus `test/dunkel-nach-system.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
„Dunkel, wenn das System dunkel ist" — je Gerät, über 00-theme-boot.js.
Seit dem 29.10. heisst das: dasselbe Design in seiner dunklen Variante
(data-dunkel am <html>, Farben aus tokens.css), nicht mehr „werkbank".
Ohne gespeicherte Wahl folgt das Gerät dem System (Vorgabe „system“).

Ausgeführt in jsdom mit nachgestelltem matchMedia: Das Skript läuft wie im
Browser im <head>, mit einem vom Server gesetzten data-theme.
```
