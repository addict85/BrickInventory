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

<a id="abschnitt"></a>
## Abschnitt

```text
Sperrschlüssel für den Katalog-Import.

Belegt sind (Liste gepflegt in jobs/instructionQueue.ts): 42 Bild-Download
je Set, 55 Preislauf, 56 Anleitungs-Warteschlange, 57 fehlende Bilder neu
laden, 77 Teile-Zusammenfassung, 11223344 Brickset-Retry, 99999999
Start-Orchestrierung, Benutzer-ID als Namensraum in db/txLock.ts.
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

<a id="importieremittauschintern"></a>
## Abschnitt

```text
Nach einem VOLLSTAENDIGEN Tausch ist die Statistik der Tabelle
bedeutungslos — der Planer rechnet mit den Zahlen von vorher, und bei
einer eben noch leeren Tabelle schaetzt er eine Zeile. Gemessen greift er
dann zu einem beliebigen anderen Index und geht alle Zeilen durch; das
sieht wie ein fehlender Index aus, obwohl der richtige daliegt. Die
Begruendung samt Zahlen steht in db/tabellePflegen.ts.

Hier, nach dem COMMIT, und nicht darin: VACUUM ist in einer Transaktion
nicht erlaubt.
```
