# Begründungen zu `jobs/rebrickableCsvSync.ts`

Die ausführlichen Kommentare aus `jobs/rebrickableCsvSync.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Downloads Rebrickable CSV files daily and imports them into local DB tables.
CSVs used:
  parts.csv          — part_num, name, part_cat_id, part_url, part_img_url, print_of
  colors.csv         — id, name, rgb, is_trans
  inventories.csv    — id, set_num, version
  inventory_parts.csv— inventory_id, part_num, color_id, quantity, is_spare, img_url
  sets.csv           — set_num, name, year, theme_id, num_parts, set_img_url

Der Download läuft hier im Hauptprozess, der Import in einem geforkten
jobs/csvImportWorker.ts (eigener Heap). Die BrickLink-Nummern zieht
jobs/backfillBlPartNumbers.ts nach.
```

<a id="abschnitt-2"></a>
## Abschnitt

```text
── Schema ────────────────────────────────────────────────────────────────────
Hier stand ensureSchema(): sieben CREATE TABLE IF NOT EXISTS und vier
CREATE INDEX IF NOT EXISTS, ausgefuehrt bei jedem Start des Abgleichs.

Sieben der Tabellen standen damit ZWEIMAL im Baum, wortgleich zu
db/schema.sql. Zwei — rb_themes und rb_inventory_minifigs — standen NUR
hier, das zentrale Schema war also unvollstaendig. Das ist die schlechtere
Haelfte derselben Doppelung: Auf einer frischen Installation gab es die
beiden erst, wenn dieser Abgleich durchgelaufen war, waehrend die uebrigen
Arbeitsprozesse schon Anfragen annahmen. Eine Abfrage in dieser Spanne
bekommt kein leeres Ergebnis, sondern "relation does not exist".

Zwei der Indizes waren ueberzaehlig, nicht fehlend:
  idx_rb_inv_parts_set (inventory_id) — derselbe wie idx_rb_inv_parts in
                                        schema.sql, nur anders benannt
  idx_rb_sets_theme    (theme_id)     — Praefix von idx_rb_sets_theme_year
Beide kosteten beim Massenimport Schreibarbeit, ohne eine Abfrage zu
beschleunigen, die nicht schon bedient war. Auf BESTEHENDEN Datenbanken
liegen sie weiterhin; sie zu entfernen waere eine Migration und damit eine
Entscheidung ueber fremde Daten.

Alles Noetige steht jetzt in db/schema.sql und laeuft beim Start —
server.ts ruft csvSync.run() erst im then() von initSchemaOnce() auf.
```
