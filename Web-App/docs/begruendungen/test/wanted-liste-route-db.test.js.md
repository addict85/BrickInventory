# Begründungen zu `test/wanted-liste-route-db.test.js`

Die ausführlichen Kommentare aus `test/wanted-liste-route-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Wanted-Listen-Import über seine echte Adresse.

── Warum neben test/wanted-liste-db.test.js ────────────────────────────────

Dort steht der Leser und die Abbildung. Hier läuft der WEG:
POST /api/v1/wanted-list/import/xml, mit echter Datenbank, und was danach
im Bestand steht. Diese Trennung ist in dieser Sitzung mehrfach teuer
geworden — ein Modul kann stimmen, während die Route es falsch ruft.

── Die Vorschau ist der wichtigste Fall ────────────────────────────────────

Ohne `schreiben=1` darf NICHTS entstehen. Fall 2 prüft das an der Tabelle
und nicht an der Antwort: Eine Route, die „vorschau: true" meldet und
trotzdem schreibt, sähe in der Antwort richtig aus.
```

<a id="preise"></a>
## `const preise = await db.all(`

```text
MAXPRICE ist eine SUCHGRENZE, kein bezahlter Preis. Hier steht -1, und
selbst ein echter Wert dürfte nicht als Kaufpreis landen — sonst stünde
in der Finanzansicht ein Betrag, den niemand ausgegeben hat.
Die Spalte heisst `unit_price`, nicht `price` — nachgesehen, nachdem mein
erster Entwurf mit „column price does not exist" rot wurde. Ein
erfundener Spaltenname macht aus einer Zusicherung eine Fehlermeldung,
und die sieht aus wie ein Fehler im Code.
```

<a id="7-mit-strom-1-kommen-fortschrittszeilen"></a>
## `await t.test('7. mit strom=1 kommen Fortschrittszeilen, zuletzt der Be`

```text
── Der Fortschritt (Marcos Wunsch vom 20.10.) ────────────────────────────

„kannst du beim Import auch den Fortschritt mit einem Fortschrittsbalken
 anzeigen?"

Geprüft wird, was die Oberfläche tatsächlich liest: die ANTWORT, Zeile für
Zeile. Ein Test gegen den Rückruf im Kern wäre leichter zu schreiben und
sagte nichts darüber, ob die Meldungen durch die Leitung kommen.
```

<a id="9-ein-import-hinterlaesst-einen-abgeschl"></a>
## `await t.test('9. ein Import hinterlässt einen abgeschlossenen Auftrag'`

```text
── Derselbe Balken wie beim Set-Import (Marcos Wunsch vom 20.10.) ───────

„bitte auch noch umsetzen, dass der Import der BL-XML Importe in der
 Android-App angezeigt werden (analog den Set-Importen)."

Die App und der Kopf der Webapp lesen `import_stand` über den Strom
/api/v1/sets/import/csv/stream. Hier wird deshalb genau das geprüft: was
in diesem Datensatz steht, wenn ein Wanted-Import läuft und wenn er durch
ist. Dass der Strom ihn ausliefert, steht schon — das ist der Weg, den der
CSV-Import seit jeher geht.
```

<a id="stelle"></a>
## `assert.equal(results.length, 3, 'Je Posten eine Zeile, auch für den of`

```text
── Jede Zeile BENENNT ihren Posten (Marcos Befund vom 21.10.) ──────────

  „Nach dem Import erscheint dann ganz viele Zeilen mit
   Undefined - aktualisiert"

Dieselbe Liste, aus der oben ok/warn/err gerechnet wird, füllt in der
zweiten Sitzung auch das PROTOKOLL: public/js/01-fortschritt.js schreibt
je Eintrag eine Zeile und liest dafür `set_number`. Hier standen reine
Zähl-Platzhalter (`{ success: true }`) — gebaut, damit die Zahlen
stimmen, und ohne Blick darauf, wer sie sonst noch liest. Bei Marco
wurden daraus 322 Zeilen „undefined – aktualisiert".

Geprüft wird deshalb BEIDES: dass die Zahlen stimmen (oben) und dass
jede Zeile etwas benennt (hier). Die erste Prüfung allein war grün,
während die Anzeige unbrauchbar war.
```
