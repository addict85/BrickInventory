# Begründungen zu `core-zustand/ui/CsvUebergang.kt`

Die ausführlichen Kommentare aus `core-zustand/src/main/java/ch/brickinventoryapp/ui/CsvUebergang.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="csvfolge"></a>
## `csvFolge`

```text
Die eigentliche Regel: Nachgeladen wird beim Übergang von „läuft“ zu „fertig“,
nicht in jedem Zustand „fertig“. Der SSE-Strom meldet den Importstatus
fortlaufend, auch lange nach dem Ende; eine Zustandsbedingung lüde alle paar
Sekunden neu und ersetzte die Galerie durch Seite 1 — die Liste spränge beim
Scrollen zurück. Ohne den vorherigen Zustand ist „gerade fertig geworden“ nicht
von „seit Stunden fertig“ zu unterscheiden.

@param warVorherAktiv Lief vor dieser Meldung ein Import? Muss der Zustand vor
        dem Überschreiben sein — danach gelesen ist er immer der neue.
@param status Der `status` der Meldung; `null`, wenn der Server keinen geschickt
        hat. Aus `null` folgt nie ein Nachladen: Eine Meldung ohne Zustand ist
        kein Abschluss, sondern eine unvollständige Meldung.
```
