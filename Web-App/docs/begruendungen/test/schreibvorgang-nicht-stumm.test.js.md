# Begründungen zu `test/schreibvorgang-nicht-stumm.test.js`

Die ausführlichen Kommentare aus `test/schreibvorgang-nicht-stumm.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Ein verschluckter SCHREIBVORGANG auf Nutzerdaten.

── Warum nur Schreibvorgänge, und nur auf Nutzerdaten ──────────────────────
Im Baum stehen knapp vierhundert `.catch(() => {})`. Die meisten sind
richtig: Auf einem SELECT heisst ein stiller catch „kein Wert", und ein
fehlgeschlagener Cache-Eintrag wird beim nächsten Mal neu geholt.

Ein Schreibvorgang ist etwas anderes. Scheitert er still, fehlt die Zeile —
und niemand erfährt es, weder der Nutzer noch der Betreiber im Protokoll.

Und nicht jeder Schreibvorgang wiegt gleich: Ein Vorschaubild, das nicht
entsteht, holt der Startlauf nach. Eine Zeile in `sets`, `parts`,
`minifigs`, den Erfassungstabellen, `users` oder `user_settings` holt
niemand nach — das sind die Daten, die der Nutzer selbst eingegeben hat.

── Der Fund, der die Grenze gezogen hat ────────────────────────────────────
`src/sets/setService.ts` legt beim Aufstocken eine eigene Set-Zeile an, falls
das Set bisher nur einem anderen Haushaltskonto gehörte. Der Kommentar dort
sagt: „sonst liefe die Mengenanpassung ins Leere." Genau das passierte,
wenn das INSERT scheiterte: Das UPDATE zwei Zeilen weiter traf null Zeilen,
die Mengenänderung war weg — und `adjustAcquisitionsToQuantity()` schrieb
die Erfassungen trotzdem. Erfassungen ohne Bestand, lautlos.

── Was geprüft wird ────────────────────────────────────────────────────────
Kein `.catch(() => {})`, `.catch(() => null)` oder `.catch(() => undefined)`
unmittelbar hinter einem INSERT/UPDATE/DELETE auf einer dieser Tabellen.
`logAndContinue(kontext)` ist der Weg; gar kein catch (Fehler weiterreichen)
ebenfalls.

Die Stellen werden gefunden, nicht aufgezählt.
```

<a id="aufruf"></a>
## `const aufruf = /\b(?:db|tx|dbh|client)\.(?:run|query)\(|\bpool\.query\`

```text
── Warum hier geklammert und nicht nur ein Fenster gelesen wird ──────────
Der erste Entwurf nahm die sechs Zeilen vor dem catch und suchte darin ein
INSERT/UPDATE/DELETE. Das meldete vier Stellen, die keine sind: drei
KOMMENTARE, die erklären, warum der catch dort entfernt wurde, und ein
generateThumb(...).catch(), dem zufällig ein UPDATE vorausging.

Jetzt wird vom Aufruf aus geklammert: db.run(/tx.run(/pool.query( mit einem
schreibenden SQL, dann bis zur schliessenden Klammer, und erst was DANN
folgt, zählt als dessen catch.
```
