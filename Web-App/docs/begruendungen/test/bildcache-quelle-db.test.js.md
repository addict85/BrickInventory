# Begründungen zu `test/bildcache-quelle-db.test.js`

Die ausführlichen Kommentare aus `test/bildcache-quelle-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Bildordner gilt für alle Konten: Was dort unter einer Teile- oder
Setnummer liegt, sehen alle. Deshalb holt der Server Bilder nur von
Adressen aus dem Katalog, die aus geprüfter Quelle stammen — nie von einer,
die ein Client mitschickt oder eingetippt hat.

Geprüft am PDF-Auftrag (src/katalog/pdf/pdfErzeugung.ts) mit abgefangenem https.get:
Welche Adressen werden wirklich abgerufen? Und am Bild-Proxy: Welche
Adresse ergibt eine Setnummer?
```
