# Begründungen zu `test/bricklink-zuordnung-db.test.js`

Die ausführlichen Kommentare aus `test/bricklink-zuordnung-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Seit db/basis.sql gibt es den Stand VOR dieser Migration nicht mehr: Die
Fälle zu Riegel, Nachtrag und Zwischenstand sind entfallen. Geprüft werden
der Endstand und die Lesewege.

Die BrickLink-Nummern stehen in EINER Zuordnungstabelle.

── Marcos Vorgabe ──────────────────────────────────────────────────────────

  „ich würde mir für die bl_*_number Spalten eine Mapping-Tabelle vorstellen
   mit der Spalte RB_id und BL_id dort werden alle alle Minifiguren, Parts
   und Sets mit den Mappings abgelegt."

Und auf die Rückfrage: „ja, eigene Tabelle mit Art-Unterscheidung ist
richtig."

── Was vorher wo stand (GEMESSEN) ──────────────────────────────────────────

  rb_bl_mapping(part_num, bl_part_num)   katalogweit   die Zuordnung selbst
  parts.bl_part_number                   JE KONTO      Abschrift
  set_parts_catalog.bl_part_number       je Set+Teil   Abschrift
  minifigs.bl_fig_number                 JE KONTO      Abschrift

Dass die drei Abschriften genau das waren, stand im Baum selbst:
src/katalog/partsImport.ts trug eine Funktion syncBlPartNumbers(), deren ganze
Aufgabe das Kopieren von rb_bl_mapping in die beiden anderen war.

── Was dieser Test prüft ───────────────────────────────────────────────────

  1. Nach der GANZEN Kette gibt es die drei Abschriften und rb_bl_mapping
     nicht mehr — und vorher gibt es sie, weil Migration 0037 sie LIEST.
  2. Der Nachtrag trägt alle vier Quellen zusammen, mit EINER Schreibweise
     für „keine abweichende Nummer".
  3. Der Riegel greift, wenn eine Nummer verloren ginge. Mit GEGENPROBE:
     ohne Riegel läuft dieselbe Lage durch und die Nummern sind weg.
  4. Der Riegel greift beim WIDERSPRUCH — zwei Konten, derselben Figur
     verschiedene Nummern gegeben. Dann entscheidet ein Mensch.
  5. Die Lesewege liefern die Nummer weiter, aus der Zuordnung. Mit
```
