# Begründungen zu `test/indizes-anfragepfad-db.test.js`

Die ausführlichen Kommentare aus `test/indizes-anfragepfad-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Drei Indizes für Abfragen, die im Anfragepfad ohne sie die ganze Tabelle lesen.

── Was gemessen wurde ──────────────────────────────────────────────────────
EXPLAIN (ANALYZE, BUFFERS) an je 100'000 Zeilen:

  parts, BL-Rückfall in resolveBlPartNumber (src/finanzen/financeCalc.ts) —
  läuft einmal je Teil der Bewertung:
      ohne Index   Seq Scan,   2479 Buffer, 10,1   ms
      mit  Index   Index Scan,    2 Buffer,  0,012 ms   (Teilindex, 8 KB)

  set_minifigs_catalog nach fig_number (routes/api_v1/minifigs.ts):
      ohne Index   Seq Scan,    572 Buffer, 5,19  ms
      mit  Index   Index Scan,    4 Buffer, 0,041 ms   (3 MB)

  sets nach set_number OHNE user_id (src/verwaltung/repository/verwaltung.ts, Bilddiagnose):
      Der vorhandene Index beginnt mit user_id, das diese Abfrage nicht
      nennt — sie las bisher die Sets aller Konten.

── Warum der Test den PLAN prüft und nicht nur den Namen ───────────────────
Ein Teilindex hilft nur, wenn sein Prädikat zur WHERE-Bedingung passt. Wer
die Abfrage später um eine Bedingung ergänzt oder das Prädikat ändert,
bekommt einen Index, den es GIBT und den der Planer trotzdem nie nimmt —
ein Fehler, den eine reine Namensprüfung nicht sieht.

`enable_seqscan = off` statt 100'000 Testzeilen: Bei einer kleinen Tabelle
ist der Tabellenscan die richtige Wahl, der Planer nähme den Index also zu
Recht nicht. Abgeschaltet zeigt sich, ob er ihn überhaupt NEHMEN KÖNNTE —
und genau das ist die Eigenschaft, die kaputtgehen kann.

Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip.
Ausführen: REQUIRE_DB=1 npm test
```

<a id="erwartet"></a>
## `const ERWARTET = ['idx_set_figuren_fig', 'idx_sets_setnum'];`

```text
idx_parts_blnum stand hier und ist weg: Er war ein Teilindex auf
parts.bl_part_number, und Migration 0037 hat die Spalte geloescht (die
BrickLink-Nummer steht jetzt in bl_zuordnung). Postgres entfernt
abhaengige Indizes beim DROP COLUMN selbst.

Was an seine Stelle tritt, prueft der zweite Teil dieses Tests: Die
Nachschlage-Abfrage laeuft jetzt ueber den Primaerschluessel von
bl_zuordnung. Der steht in der MIGRATION und nicht in initSchema(),
gehoert also nicht in diese Liste — sie sagt, was der Schema-Aufbau
anlegt.
idx_set_figuren_fig ersetzt seit Migration 0072 idx_set_minifigs_fig (die Tabelle wurde zur Sicht).
```

<a id="blplan"></a>
## `const blPlan = await plan(`

```text
Zeichengleich die Abfrage aus src/katalog/blZuordnung.ts (blAbrufNummer).

Geprueft wird „ueber einen INDEX" und nicht „ueber genau diesen
Index": Auf einer leeren Tabelle waehlt der Planer den kleineren von
beiden und filtert den Rest — gemessen nahm er
idx_bl_zuordnung_bl statt bl_zuordnung_pkey. Beides ist ein
Indexzugriff und damit die Aussage, auf die es ankommt; welchen er
nimmt, entscheidet er mit echten Daten neu.
```
