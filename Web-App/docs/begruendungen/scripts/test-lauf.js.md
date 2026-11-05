# Begründungen zu `scripts/test-lauf.js`

Die ausführlichen Kommentare aus `scripts/test-lauf.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="stelle"></a>
## `const { execFileSync, spawn } = require('child_process');`

```text
`npm test`: einmal bauen, einmal eine Vorlage-Datenbank aufsetzen (basis.sql
und Migrationen), dann die Testdateien parallel — jede mit eigener Kopie der
Vorlage (test/helpers/eigene-db.js). Browser-Tests laufen danach einzeln:
Mehrere Chromium nebeneinander reissen auf schwachen Rechnern die Fristen.

  TEST_DATABASE_URL  Basis; ohne sie laufen die Tests ohne Datenbank
  TEST_PARALLEL      gleichzeitige Testdateien (Vorgabe: doppelte Kernzahl, höchstens 8)
  TEST_FRIST_MS      feste Frist je Datei; ohne sie 60 s, mit der Last wachsend
  TEST_NACHLAUF=aus  eine Fristüberschreitung ist rot statt nachzulaufen
  TEST_PARALLEL_BROWSER  gleichzeitige Browser-Dateien (Vorgabe 1; je Datei eigene DB, Port, Profil)
  --abdeckung        V8-Abdeckung samt Oberfläche (Bündel mit Sourcemap), Bericht in coverage/
  --seriell          alles nacheinander auf der Basis-Datenbank, wie früher
  weitere Argumente  Testdateien statt test/*.test.js
```
