# Begründungen zu `routes/datenDateien.ts`

Die ausführlichen Kommentare aus `routes/datenDateien.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="servedatafile"></a>
## `serveDataFile`

```text
Ausliefern einer Datei unter data/<subDir>/<benutzer-id>/…

── Wer darf das lesen? ─────────────────────────────────────────────────────
Hier stand `parseInt(segments[0]) !== userId` — also „nur deine eigene ID".
Das war richtig, solange ein Konto für sich allein stand, und passte nach dem
Haushalt an zwei Stellen nicht mehr:

  • Das Hauptkonto SIEHT die Anleitung eines Unterkontos (getSet listet sie
    mit user_id = ANY(uids), also haushaltsweit) — und lief beim Klick in
    ein 403. Sichtbar, aber nicht zu öffnen.
  • Nach dem Verschieben eines Sets gehört die Anleitungs-Zeile dem neuen
    Konto, ihr local_path zeigt aber weiter in den Ordner des alten
    (moveSetBetweenAccounts kopiert den Pfad wörtlich). Das Hauptkonto
    bekam also für seine EIGENE Zeile 403.

Deshalb entscheidet jetzt scopeIds() — dieselbe Stelle, die überall sonst
beantwortet, wessen Daten jemand sehen darf. Die Benutzer-ID im Pfad ist
damit das, was sie ohnehin schon war: eine Ablagestruktur, keine
Zugriffsregel. Die Regel steht in src/haushalt/haushalt.ts.

Die Asymmetrie bleibt gewahrt: Ein Unterkonto hat nur sich selbst im
Blickfeld (resolveHousehold: memberIds = [self, …eigene Subs]), kommt also
NICHT an die Uploads des Hauptkontos. Geprüft wird weiterhin gegen eine
Liste erlaubter IDs, nicht gegen „irgendwer im System".
```
