# Begründungen zu `test/zweiter-faktor-heikel-db.test.js`

Die ausführlichen Kommentare aus `test/zweiter-faktor-heikel-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Bei aktivem zweitem Faktor verlangen Passwortwechsel, Passkey löschen und
E-Mail ändern zusätzlich einen Code (bestaetigeMitFaktor in
src/konto/http/anmeldung.ts). Ein fehlender Code wird abgewiesen, bevor
etwas geprüft wird; ein falscher zählt in der Bremse. Ohne zweiten Faktor
bleibt alles wie bisher. Die E-Mail eines Verwalters gilt nach dem Ändern
erst nach dem Link als bestätigt.
```
