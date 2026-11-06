# Begründungen zu `src/bestand/repository/gemeinsam.ts`

Die ausführlichen Kommentare aus `src/bestand/repository/gemeinsam.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="katalogjoin"></a>
## `KATALOGJOIN`

```text
Die Katalog-JOINs je Tabelle.

Seit Migration 0034 steht die Beschreibung nicht mehr an der Bestandszeile:
Name und Kategorie in part_catalog, Farbbezeichnung/Farbcode/Bild in
part_color_catalog, das Ersatzteilkennzeichen in set_parts_catalog, und bei
den Figuren alles in minifigs_catalog.

Alle ueber ihren Primaerschluessel verbunden, also hoechstens eine Zeile je
Treffer — die Gruppierung bleibt unberuehrt.

Dass das hier gebraucht wird, ist nicht aufgefallen, weil die Abfrage unten
ein `.catch(() => [])` traegt: Aus „column x.part_name does not exist" wurde
eine LEERE LISTE. GEMESSEN an test/verwendende-sets-db.test.js — „Erwartet
drei Sets in Nummernfolge, bekam []".
```
