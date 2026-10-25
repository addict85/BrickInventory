# Begründungen zu `jobs/csvImportWorker.ts`

Die ausführlichen Kommentare aus `jobs/csvImportWorker.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="send"></a>
## `send`

```text
Nachricht an den Elternprozess.

`process.send` gibt es nur, wenn der Prozess MIT IPC-Kanal geforkt wurde.
Dieser Worker wird ausschliesslich per fork() aus jobs/rebrickableCsvSync.ts
gestartet, der Kanal ist also da — aber TypeScript kann das nicht wissen, und
ein `process.send!` würde die Annahme nur unsichtbar machen.

Der Helfer prüft stattdessen einmal. Fehlt der Kanal (jemand startet die
Datei direkt zum Ausprobieren), geht die Meldung nach stderr statt den
Prozess mit einem TypeError abzubrechen.

@param {any} msg
```

<a id="sp"></a>
## `sp`

```text
Eine Spalte einer CSV-Zeile, die fehlen darf.

── Warum benannt und nicht `?? ''` an vierzig Stellen ──────────────────────
Die Rebrickable-Dateien haben nicht in jeder Zeile alle Spalten: parts.csv
fuehrt `print_of` nur bei bedruckten Teilen, und eine Zeile endet dann
frueher. Der Code hat das immer schon abgefangen (`sp(c,0)`), nur stand
nirgends, DASS es Absicht ist — mit noUncheckedIndexedAccess wurde daraus
ein Uebersetzungsfehler an vierzig Stellen.

Der Name sagt es jetzt: Eine fehlende Spalte ist der leere Wert, kein
Fehler. Fuer die Zahlenspalten steht darunter `parseInt(sp(c,2))||0` —
`parseInt('')` ergibt NaN, und das `||0` faengt es wie zuvor.
```

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

<a id="abschnitt"></a>
## Abschnitt

```text
Sperrschlüssel für den Katalog-Import.

Belegt sind (Liste gepflegt in jobs/instructionQueue.ts): 42 Bild-Download
je Set, 55 Preislauf, 56 Anleitungs-Warteschlange, 57 fehlende Bilder neu
laden, 77 Teile-Zusammenfassung, 11223344 Brickset-Retry, 99999999
Start-Orchestrierung, Benutzer-ID als Namensraum in utils/txLock.ts.
58 ist frei.

(Nachtrag 29 vergab hier zunächst irrtümlich die 56, also den Schlüssel der
Anleitungs-Warteschlange. Praktisch kollidierte das nicht — die
Warteschlange nimmt (56, 0), der Import (56, Tabellen-Hash), und keiner der
acht Katalog-Tabellennamen hasht auf 0; nachgemessen. Verlassen sollte man
sich darauf nicht: Ein neuer Tabellenname könnte den Import künftig hinter
der Warteschlange blockieren, und der Fehler wäre kaum auffindbar.)

Der zweite Wert von pg_advisory_lock(a, b) ist eine Zahl aus dem
Tabellennamen: Verschiedene Tabellen dürfen weiterhin parallel importiert
werden, dieselbe Tabelle nicht zweimal gleichzeitig.
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

<a id="importieremittauschintern"></a>
## Abschnitt

```text
Nach einem VOLLSTAENDIGEN Tausch ist die Statistik der Tabelle
bedeutungslos — der Planer rechnet mit den Zahlen von vorher, und bei
einer eben noch leeren Tabelle schaetzt er eine Zeile. Gemessen greift er
dann zu einem beliebigen anderen Index und geht alle Zeilen durch; das
sieht wie ein fehlender Index aus, obwohl der richtige daliegt. Die
Begruendung samt Zahlen steht in utils/tabellePflegen.ts.

Hier, nach dem COMMIT, und nicht darin: VACUUM ist in einer Transaktion
nicht erlaubt.
```
