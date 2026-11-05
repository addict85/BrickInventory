# Begründungen zu `test/lagerort-vorgabe-neuerfassung-db.test.js`

Die ausführlichen Kommentare aus `test/lagerort-vorgabe-neuerfassung-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Marcos Stern gilt auch dort, wo kein Formular steht.

── Marcos Befund vom 20.10. ────────────────────────────────────────────────

  „Der Default Lagerort wird nicht gesetzt."

GEMESSEN, bevor etwas geaendert wurde: Vorgabe auf „Kiste 7" gesetzt
(vorgabeVon lieferte sie), dann ein Teil und eine Figur so angelegt, wie es
der Wanted-Listen-Import tut — also ohne `storage`:

    Vorgabe steht auf: {"id":1,"user_id":2,"name":"Kiste 7"}
    Teil   — Lagerort: null
    Figur  — Lagerort: null

Der Stern wurde bis dahin ALLEIN im Browser eingelöst: ladeLagerortVorgabe()
in public/js/02-gallery.js befuellt die Felder der fuenf
Erfassungsformulare vor. Wer kein Formular benutzt — der Wanted-Import, der
CSV-Import, die API mit Token —, bekam nichts. Marcos Wunsch lautete aber
„bei einer Neuerfassung", nicht „in einem Formular".

── Die Unterscheidung, um die es hier eigentlich geht ──────────────────────

Fehlt `storage` GANZ, hat niemand etwas gesagt → die Vorgabe gilt.
Kommt es LEER herein, hat jemand sie weggeraeumt → sie gilt nicht. Diese
zweite Haelfte ist die wichtigere: Eine Vorgabe, die sich in ein
ausdrueckliches „keiner" zurueckdraengt, waere ein Ort, den niemand
wegbekommt. Der Browser kann das jetzt sagen, weil selectedStorage() fuer
ein leeres Feld `''` liefert statt `undefined` (vorher fiel der Schluessel
aus dem Rumpf und ein geleertes Feld sah aus wie ein Import).

Die drei PUT-Wege …/storage bleiben unberuehrt — dort heisst leer
„loeschen". Der letzte Fall unten prueft genau das.

── Was hier NICHT geprueft wird ────────────────────────────────────────────

addSet(): Die Huelle holt den Ort auf demselben Weg (src/sets/setService.ts),
aber der Rumpf braucht Rebrickable, und in dieser Umgebung ist
rebrickable.com nicht erreichbar (ENOTFOUND). Geprueft ist deshalb
ortFuerNeuerfassung() selbst, mit genau den Werten, die addSet
durchreicht — nicht der Weg durch addSet hindurch.
```
