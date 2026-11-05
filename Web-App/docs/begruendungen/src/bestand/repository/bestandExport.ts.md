# Begründungen zu `src/bestand/repository/bestandExport.ts`

Die ausführlichen Kommentare aus `src/bestand/repository/bestandExport.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="parts-csv-sql"></a>
## `PARTS_CSV_SQL`

```text
Shared logic to build the Teile CSV export content (manuell erfasst only).
Used by both the standalone CSV download and the combined ZIP export in settings.js.

── EINE Abfrage statt einer je Teil (Nachtrag 134) ──────────────────────────

Hier stand `for (const p of parts) { await db.all(...) }` — bei 2000 manuell
erfassten Teilen also 2001 Abfragen fuer einen Export. Die beiden
ZWILLINGSFUNKTIONEN sind laengst umgestellt: buildFigsCsv (routes/minifigs.ts,
FIGS_CSV_SQL) und buildSetsCsv (src/sets/setService.ts, SETS_CSV_SQL). Ihre
Kommentare beschreiben genau diesen Umbau; die Teile blieben als einzige
zurueck. Wieder eine Regel, die an zwei von drei Stellen gilt.

── Der Rueckfall auf die Stammzeile ist weg ─────────────────────────────────

Hier stand je Spalte ein `CASE WHEN a.id IS NULL THEN p.<spalte>` und
darunter eine zweite, vollstaendige Abfrage fuer den Fall, dass
part_acquisitions ganz fehlt. Beides griff auf p.unit_price und p.condition
zu, und die hat Migration 0035 geloescht.

Gebraucht wird der Rueckfall auch nicht mehr: 0035 traegt fuer jede manuelle
Position eine Erfassung nach und prueft danach nach, dass keine ohne
geblieben ist. Der LEFT JOIN bleibt trotzdem — loescht jemand die letzte
Erfassung, entfernt cleanupWhenEmpty() die Bestandszeile mit, aber ein
Export soll an einer unerwarteten Lage nicht ganz ausfallen.
```
