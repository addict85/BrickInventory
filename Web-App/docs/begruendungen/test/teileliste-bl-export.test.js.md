# Begründungen zu `test/teileliste-bl-export.test.js`

Die ausführlichen Kommentare aus `test/teileliste-bl-export.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der BrickLink-Export der Teileliste — was er weglässt und was er sagt.

── Marcos Hinweis vom 20.10. ───────────────────────────────────────────────

  „Den Export gibt es ja ebenfalls in der Teileliste"

Er hatte recht, und beim Nachsehen standen dort drei Dinge, die erst BEI
BRICKLINK auffallen. Das FORMAT prüft test/bricklink-wanted-xml.test.js am
ausgelagerten Bauteil; hier steht das, was nur der Aufrufer entscheiden
kann: welche Posten überhaupt mitgehen.

── Warum am Quelltext und nicht am Verhalten ───────────────────────────────

plExportBricklink lebt in js/08-init.js, und die Datei greift schon beim
Laden auf das Dokument zu — einlesen lässt sie sich hier nicht. Geprüft
wird deshalb der Quelltext, und zwar OHNE Kommentare: Ein Absatz, der die
alte Schreibweise ERKLÄRT, nennt sie zwangsläufig. In diesem Baum hat genau
das schon einmal eine Prüfung stillschweigend grün gehalten.
```
