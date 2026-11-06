# Begründungen zu `test/gutschein-guthaben-db.test.js`

Die ausführlichen Kommentare aus `test/gutschein-guthaben-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Guthaben-Abfrage über ihre echte Adresse — Schranke inbegriffen.

── Was hier geprüft wird, und was gutschein-guthaben.test.js prüft ─────────

Dort: der Client (Sitzung, Rappen, verdecke, Bot-Schutz) mit injiziertem
Abruf. Hier: der WEG — POST /api/v1/vouchers/:id/guthaben mit echter
Datenbank, echter Schranke und der Frage, was danach in der Tabelle steht.
Beides ist nötig; ein Modul kann stimmen, während die Route es falsch ruft
(genau das ist beim Gutschein-Export passiert: `/vouchers/export/pdf` lief
in `/vouchers/:id/pdf` und gab 400).

── Es geht NICHTS nach draussen ────────────────────────────────────────────

Die Route kann keinen Abruf injiziert bekommen — sie ruft die Schranke, und
die den Client. Dessen Abruf wird hier ersetzt (`_ersetzeAbruf`; den echten
Weg prüft gutschein-guthaben-abruf): Jeder Aufruf wird protokolliert, und die Zusicherungen messen
daran, WIE OFT hinausgerufen wurde. Ohne diesen Ersatz ginge Marcos echte
Kartennummer an lego.com.

── Marcos Vorgaben, die hier ihre Gegenprobe haben ─────────────────────────

  „Der Zurückgemeldete Betrag soll im Feld Betrag gespeichert werden."
  „Bitte auch dafür sorgen dass maximal 1 Request pro 30sek abgesetzt
   werden kann. (über alle Benutzer)"
  „Der Botschutz beibehalten, dass nicht mehr Aufrufe generiert werden wenn
   ein Schutz greift."

Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip, ausser
REQUIRE_DB=1.
```
