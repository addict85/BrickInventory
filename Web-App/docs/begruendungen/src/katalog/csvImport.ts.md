# Begründungen zu `src/katalog/csvImport.ts`

Die ausführlichen Kommentare aus `src/katalog/csvImport.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="parsecsvline"></a>
## `parseCsvLine`

```text
Eine CSV-Zeile in Felder zerlegen.

Verdoppelte Anführungszeichen ("" innerhalb eines Feldes) sind die
CSV-Schreibweise für EIN Anführungszeichen. Vorher wurde bei jedem " nur der
Zustand umgeschaltet und das Zeichen verworfen: Aus `3 "Zoll"` wurde
`3 Zoll`. Kommas in Anführungszeichen waren nie betroffen, deshalb ist es
lange nicht aufgefallen — es traf nur die Zeichen selbst, in Teile- und
Setnamen mit Zollangaben oder Zitaten.
```

<a id="importieremittausch"></a>
## `importiereMitTausch`

```text
Einen Katalog-Import durchführen, OHNE die Tabelle währenddessen zu leeren.

── Warum der Umweg über eine Schattentabelle ───────────────────────────────
Vorher stand am Anfang jedes Imports ein TRUNCATE/DELETE ohne Transaktion,
danach liefen minutenlang die Chunk-Inserts (rb_inventory_parts: rund 1,5
Mio. Zeilen). Jede andere Verbindung sah in dieser Zeit eine LEERE Tabelle —
mit zwei Verbindungen gegen echtes Postgres nachgestellt, der Leser bekam
sofort 0 Zeilen. Für die Anwendung heisst das: Sets ohne Teile, fehlende
Farb- und Teilenamen, und zwar täglich. Brach der Import mittendrin ab,
blieb die Tabelle bis zum nächsten Tageslauf unvollständig.

Der naheliegende Griff — einfach eine Transaktion drumherum — macht es
schlimmer: TRUNCATE nimmt eine ACCESS-EXCLUSIVE-Sperre, Leser blockieren
dann für die volle Importdauer statt kurz falsche Daten zu sehen (ebenfalls
nachgestellt: die Leseabfrage hing).

Deshalb: Neue Daten zuerst vollständig in eine Schattentabelle laden (ohne
WAL-Aufwand, UNLOGGED), und erst danach in EINER Transaktion umschwenken.
Das DELETE dort nimmt nur Zeilensperren — dank MVCC sehen Leser bis zum
COMMIT den alten, vollständigen Bestand und danach den neuen. Nie einen
leeren.

Zusätzlich die Plausibilitätsbremse: 0 Zeilen bedeutet abgebrochener
Download oder kaputte Datei — dann bleibt der alte Bestand stehen, statt
durch nichts ersetzt zu werden.

── Warum die Sperre (Nachtrag 29) ──────────────────────────────────────────
Der Name der Schattentabelle leitet sich allein vom Tabellennamen ab, ist
also für ALLE Läufe derselbe. Zwei gleichzeitige Importe derselben Tabelle
sind möglich: Der Tageslauf ruft csvSync.run(), und ein Admin kann parallel
/admin/trigger-csv-sync auslösen — der Riegel `_csvSyncRunning` in server.ts
schützt nur den manuellen Weg gegen sich selbst, nicht gegen den Tageslauf,
und liegt ohnehin im Speicher EINES Prozesses.

Nachgestellt gegen echtes Postgres 16: Starten beide gleichzeitig, scheitert
einer beim CREATE mit „duplicate key value violates unique constraint
pg_type_typname_nsp_index" — einem Fehler, der nichts über die Ursache
verrät. In csvSync.run() bricht das den ganzen Durchgang ab (`return`), der
Tagesmarker bleibt ungesetzt und die anschliessenden Schritte entfallen.
Die DATEN bleiben dabei heil — das Tausch-Verfahren oben trägt auch diesen
Fall, ebenfalls nachgestellt (versetzter Start, unterscheidbare Daten: der
Endbestand entsprach genau einem Lauf, nie einer Mischung).

pg_advisory_lock statt pg_try_advisory_lock: Der zweite Lauf soll WARTEN und
danach sauber durchlaufen, nicht ausfallen. Die Sperre hängt an einer
eigenen Verbindung und fällt weg, sobald diese zurückgeht — auch wenn der
Prozess abstürzt.
```
