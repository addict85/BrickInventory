# Begründungen zu `test/teile-katalogspalten-db.test.js`

Die ausführlichen Kommentare aus `test/teile-katalogspalten-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Seit db/basis.sql gibt es den Stand VOR dieser Migration nicht mehr: Die
Fälle zu Riegel, Nachtrag und Zwischenstand sind entfallen. Geprüft werden
der Endstand und die Lesewege.

Teile und Minifiguren: Bestand und Beschreibung sind getrennt.

── Marcos Vorgabe ──────────────────────────────────────────────────────────

  „in der parts-tabelle benötigt es doch nur id, user_id, set_number,
   part_number, color_id, source, storage_od, added_at den Rest ist wieder
   in partAcquisitions, rb_parts gespeichert? oder wenn noch Spalten in
   rb_parts fehlen dann würde ich eher ein pandant zu set_catalog erstellen
   mit part_catalog?"

  „bitte das gleiche auch noch für minifigs umsetzen. Auch dort gehören
   fig_name, image_url, bl_fig_number, image_local nicht in die
   minifigs-Tabelle sondern eher in eine minifigs_catalog tabelle."

Die Antwort auf die Rückfrage, GEMESSEN und nicht vermutet: In rb_parts und
rb_colors kann nichts von uns liegen. jobs/csvImportWorker.ts füllt beide
über importiereMitTausch(), und das macht `DELETE FROM <tabelle>` und
schreibt den CSV-Inhalt neu — Nachgetragenes wäre beim nächsten Tageslauf
weg. Also das Pendant, genau wie Marco vermutet hat: part_catalog,
part_color_catalog, minifigs_catalog (Migration 0034).

── Was dieser Test prüft ───────────────────────────────────────────────────

  1. Nach der GANZEN Migrationskette tragen parts und minifigs nur noch
     Bestandsspalten — und die Beschreibung steht in den Katalogen.
  2. Der Riegel in Schritt 2 greift, wenn ein Name verloren ginge. Mit
```

<a id="inkiste"></a>
## `const inKiste = await handlers.getParts(uid, { exclude_manual: '1', st`

```text
── Der Lagerortfilter — und seine ZAEHLUNG ──────────────────────────────

Das ist der Teil, der vor dieser Aenderung nicht ging: Die Zaehlabfrage in
getParts() stand auf `FROM parts p` allein, waehrend die Filterbedingung
auf lo.name zeigt. GEMESSEN war die Folge „missing FROM-clause entry for
table lo" und damit eine 500er-Antwort fuer die ganze Teileliste.

`total` ist deshalb die eigentliche Zusicherung: Sie kommt NUR aus der
Zaehlabfrage. Stimmt die Liste und total ist 0 oder die Abfrage wirft,
ist genau dieser Fehler zurueck.
```
