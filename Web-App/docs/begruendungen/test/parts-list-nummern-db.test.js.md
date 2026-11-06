# Begründungen zu `test/parts-list-nummern-db.test.js`

Die ausführlichen Kommentare aus `test/parts-list-nummern-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Teileliste liefert die REBRICKABLE-Nummer, nicht die BrickLink-Nummer.

── Marcos Befund, in drei Schritten ────────────────────────────────────────

  „Ich besitze das Set 2x wie kann es dann sein, dass Teile fehlen?"
  „Ist evtl. die BL und Rebrickable-ID das Problem (werden diese
   verglichen)?"
  — und nach der ersten Reparatur: „Leider nicht."

Er hatte recht, und zwar eine Ebene tiefer, als zuerst gesucht wurde. In
/sets/:setNumber/parts-list stand:

    const blId = cat.bl_part_number || p.bl_part_number || p.part_number;
    const key  = `${blId}|${p.color_id}`;
    …
    part_number:    blId,     ← die Rebrickable-Nummer wurde ueberschrieben
    bl_part_number: blId,

Der Endpunkt gab in BEIDEN Feldern die BrickLink-Nummer zurueck. Der
Bestandsabgleich fragt danach `parts` ab, und dort steht die
Rebrickable-Nummer: Ein Tile 1x1 heisst bei Rebrickable `3070b`, bei
BrickLink `3070`. Gefragt wurde nach `3070`, gefunden wurde nichts — und
„nicht gefunden" sieht aus wie „habe ich nicht".

NACHGEMESSEN an Marcos Bestand (60052-1, 291 Positionen): 45 galten als
fehlend, und KEINE der gemeldeten Nummern (3070, 3068, x1687, 55423c01 …)
stand ueberhaupt in `rb_inventory_parts` — sie waren alle erst in diesem
Schritt entstanden.

── Warum mit DB und nicht am Quelltext ─────────────────────────────────────

Eine Quelltext-Regel haette hier nichts genuetzt: Die vorige Fassung sah
richtig aus (`part_number` stand da, nur mit dem falschen Wert). Was zaehlt,
ist die Antwort — und die entsteht aus drei Tabellen (rb_inventory_parts,
rb_bl_mapping, set_parts_catalog), die sich gegenseitig ueberschreiben.

Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
```
