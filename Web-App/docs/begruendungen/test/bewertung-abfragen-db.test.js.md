# Begründungen zu `test/bewertung-abfragen-db.test.js`

Die ausführlichen Kommentare aus `test/bewertung-abfragen-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Teile-Bewertung darf nicht je Teil viermal nachfragen.

── Was gemessen wurde ──────────────────────────────────────────────────────

Datenbank-Abfragen JE STÜCK, bei warmem Preis-Cache, 50 Stück je Art:

    Sets           10 Abfragen   0,2 je Stück
    Minifiguren    55 Abfragen   1,1 je Stück
    Teile         205 Abfragen   4,1 je Stück      ← vorher
    Teile          57 Abfragen   1,1 je Stück      ← nachher

Die drei überzähligen Fragen je Teil steckten in fetchPartPrice:

    50x SELECT bl_color_id FROM rb_colors WHERE id=$1     ← 50x dieselbe Farbe
    50x SELECT bl_part_num FROM rb_bl_mapping WHERE …     ← einzeln statt ANY
    50x SELECT bl_part_number FROM parts WHERE …          ← dito, dazu ohne Index

Abhilfe in src/finanzen/financeCalc.ts: die Farbtabelle als Ganzes merken
(farbkarte), die Teilenummern einer Bewertung vorladen (ladeBlNummernVor)
und in db/database.ts der Teilindex idx_parts_blnum.

── Warum dieser Test die ZÄHLUNG prüft und nicht die Zeit ──────────────────
Eine Zeitmessung im Testlauf sagt mehr über die Maschine als über den Code.
Die Zahl der Umläufe zur Datenbank ist dagegen eine Eigenschaft des Codes —
genau die, die hier kaputtgehen kann, wenn jemand das Vorladen entfernt oder
eine weitere Einzelabfrage in die Schleife legt.

Gezählt wird am POOL, nicht an db.get/db.all: database.js exportiert seine
Funktionen als Getter (esbuild), sie sind von aussen nicht überschreibbar.
Ein Patch dort zählt still NICHTS mit — nachgemessen: 0 statt 205.

Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
Ohne DB: skip. Ausführen: REQUIRE_DB=1 npm test
```
