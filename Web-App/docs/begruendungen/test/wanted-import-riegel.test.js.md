# Begründungen zu `test/wanted-import-riegel.test.js`

Die ausführlichen Kommentare aus `test/wanted-import-riegel.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Import einer Wanted-Liste lässt sich nicht zweimal anstossen.

── Marcos Vorgabe vom 20.10. ───────────────────────────────────────────────

  „Wenn der Import der Wanted-Liste läuft, soll der Button nicht nochmals
   geklickt werden können."

── Warum das mehr ist als Kosmetik ─────────────────────────────────────────

Der zweite Schritt SCHREIBT, und er schreibt über recordAcquisitionForDay().
Eine zweite Anfrage mit derselben Datei legt für denselben Tag keine zweite
Erfassung an, sondern ADDIERT auf die bestehende (idx_part_acq_tag_zustand). Zwei
Klicks ergäben also die doppelte Stückzahl — lautlos, denn beide Antworten
melden Erfolg.

── Was hier geprüft wird ───────────────────────────────────────────────────

Der Riegel liegt an zwei Stellen, und beide werden gelesen:
  1. `disabled` am Knopf (ein deaktivierter Knopf löst kein click-Ereignis
     aus) — gesetzt an GENAU EINER Stelle, knoepfeStand().
  2. die Abfrage in lies() selbst — gegen die Eingabetaste, gegen den
     Dateiknopf daneben und gegen jeden späteren Aufrufer.

Dass der Riegel nach einem Fehler wieder aufgeht, hängt am try/finally; ohne
das bliebe der Dialog nach einem Netzfehler tot und sähe aus wie ein
hängender Import. Auch das steht als Zusicherung da.

Der Fortschrittsbalken gehört in dieselbe Prüfung, weil er dasselbe Fenster
betrifft: Was während des Laufs passiert, steht hier.
```
