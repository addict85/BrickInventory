# Begründungen zu `test/teil-farbe-aendern-db.test.js`

Die ausführlichen Kommentare aus `test/teil-farbe-aendern-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Farbe eines manuell erfassten Teils NACHTRÄGLICH ändern.

── Marcos Bitte ────────────────────────────────────────────────────────────

  „Ich habe mehrere wanted listen importiert. Die Farbe wurde nicht immer
   übernommen und die Teile sind nun mehrfach vorhanden (bsp 3001). … Weiter
   möchte ich die Farbe nachträglich anpassen können für den Fall dass diese
   nicht korrekt geladen wurde."

Der Import erfindet seit dem 19.10. keine Farbe mehr (src/merkliste/wantedListe.ts).
Marcos BESTEHENDER Bestand trägt die falschen Farben aber schon — dieser Weg
ist der, auf dem er sie geradezieht, OHNE die Erfassungshistorie zu
verlieren. Löschen und neu erfassen wäre der Preis dafür gewesen.

── Warum der schwierige Fall der Normalfall ist ────────────────────────────

Bei Marco steht dasselbe Teil DANEBEN schon in der richtigen Farbe — das war
ja sein Befund. Die Korrektur läuft also fast immer auf ein
ZUSAMMENLEGEN hinaus, nicht auf einen Umzug. Beides hat seinen eigenen
eindeutigen Index, an dem ein naives UPDATE abbricht:

    idx_parts_eindeutig   (user_id, set_number, part_number, color_id)
    idx_part_acq_tag_zustand      (user_id, part_number, color_id, Tag)

Der zweite ist der unangenehmere: Er schlägt nur zu, wenn beide Farben am
GLEICHEN Tag erfasst wurden. Ein Fehler, der von der Uhr abhängt — deshalb
hat er hier einen eigenen Fall.
```

<a id="ein-schon-vorhandenes-farbbild-wird-nich"></a>
## `await t.test('ein schon vorhandenes Farbbild wird nicht überschrieben'`

```text
── Das Bild der neuen Farbe (Marcos Befund vom 20.10.) ────────────────────

„Wenn ich die Farbe der manuell erfassten Teile ändere wird das Bild nicht
 aktualisiert."

part_color_catalog führt das Bild je Teil UND Farbe. Vorher schrieb die
Änderung die Zielzeile ohne Bild und verliess sich auf einen Job, der
dafür nie zuständig war — die Kachel zeigte danach den Platzhalter.
```
