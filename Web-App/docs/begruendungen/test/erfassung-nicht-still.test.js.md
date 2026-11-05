# Begründungen zu `test/erfassung-nicht-still.test.js`

Die ausführlichen Kommentare aus `test/erfassung-nicht-still.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Eine verlorene Erfassung verschwindet nicht stillschweigend.

── Woher diese Prüfung kommt ───────────────────────────────────────────────
`recordAcquisitionForDay()` schreibt die Kaufhistorie: Menge, Preis, Zustand,
Datum. Schlägt der Aufruf fehl, steht der Artikel in der Sammlung, aber in
der Historie klafft ein Loch — und die Finanzansicht rechnet mit einer
Erfassung weniger.

Drei der Aufrufe fingen den Fehler mit `.catch(()=>{})` ab, also ohne jede
Spur. Und zwar über Kreuz, was zeigt, dass es niemand entschieden hat:

  routes/parts.ts     manuelles Anlegen  protokolliert
  routes/parts.ts     CSV-Import         STILL
  routes/minifigs.ts  manuelles Anlegen  STILL
  routes/minifigs.ts  CSV-Import         protokolliert

Genau bei einem dieser stillen Aufrufe wäre der Datumsfehler aus demselben
Durchgang unsichtbar geblieben: Ein Datum mit Tag über 12 lässt Postgres
abbrechen, und der stille catch hätte es verschluckt.

── Was geprüft wird ────────────────────────────────────────────────────────
Kein Aufruf von recordAcquisitionForDay darf einen leeren catch tragen. Ohne
catch ist in Ordnung — dann trägt der Aufrufer den Fehler weiter, meist
innerhalb einer Transaktion. Gesucht wird also nur der LEERE.

Die Aufrufer werden gefunden, nicht aufgezählt.
```
