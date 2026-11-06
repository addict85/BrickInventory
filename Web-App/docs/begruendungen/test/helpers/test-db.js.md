# Begründungen zu `test/helpers/test-db.js`

Die ausführlichen Kommentare aus `test/helpers/test-db.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="path"></a>
## `const path = require('node:path');`

```text
Datenbanken für den parallelen Testlauf anlegen und löschen, als eigener
Prozess: Der Vorlader (eigene-db.js) muss synchron fertig sein, bevor die
Testdatei ihre erste Zeile ausführt.

  node test/helpers/test-db.js anlegen <name> <vorlage>
  node test/helpers/test-db.js loeschen <name>

Verbunden wird mit TEST_DB_BASIS (der Datenbank aus TEST_DATABASE_URL), nie
mit der Vorlage: CREATE DATABASE … TEMPLATE verlangt, dass niemand an ihr hängt.
```
