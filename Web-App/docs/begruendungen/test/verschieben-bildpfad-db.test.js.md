# Begründungen zu `test/verschieben-bildpfad-db.test.js`

Die ausführlichen Kommentare aus `test/verschieben-bildpfad-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Nach dem Verschieben eines Sets hat JEDER Bestandteil im Zielkonto sein Bild.

── Der Befund, der zu diesem Test führte ───────────────────────────────────
copyContents() in src/sets/setMove.ts kopiert Teile, Minifiguren und
Anleitungen ins Zielkonto. Die Teile wurden mit 14 Spalten kopiert, die
Minifiguren mit 7 — und die einzige, die dabei WIRKLICH fehlte, war
`image_local`.

Wer ein Set ins Konto seines Kindes verschob, sah dort danach die Teilebilder
aus dem Zwischenspeicher und die Figurenbilder wieder über den Proxy vom CDN
— bis zum nächsten Serverstart, denn nur dann läuft der Bild-Job.

── Warum der Test jetzt etwas STÄRKERES prüft ──────────────────────────────
Mit Migration 0034 steht das Bild nicht mehr an der Bestandszeile, sondern
im Katalog: part_color_catalog je (Teil, Farbe), minifigs_catalog je Figur.
Beim Verschieben ist damit nichts mitzunehmen — und folglich auch nichts zu
vergessen. Die FEHLERQUELLE ist weg, nicht nur der Fehler.

Geprüft wird deshalb die Wirkung und nicht der Weg: Nach dem Verschieben
liefert die Teile- bzw. Figurenliste des ZIELKONTOS für beide Bestandteile
denselben Bildpfad wie vorher. Das ist die Frage, die den Nutzer angeht, und
sie bleibt dieselbe, ob der Pfad nun kopiert oder nachgeschlagen wird.

Voraussetzung: Test-DB via TEST_DATABASE_URL.
```
