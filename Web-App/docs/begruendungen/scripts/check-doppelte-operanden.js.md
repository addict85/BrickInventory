# Begründungen zu `scripts/check-doppelte-operanden.js`

Die ausführlichen Kommentare aus `scripts/check-doppelte-operanden.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="fs-stelle"></a>
## `const fs = require('fs');`

```text
Derselbe Operand zweimal — der Tippfehler, der sich am besten versteckt.

── Woher diese Prüfung kommt ───────────────────────────────────────────────
In src/finanzen/financeCalc.ts stand dieselbe Verwechslung an drei Formen:

  achtmal   if (parseFloat(x.avg_price) > 0 || parseFloat(x.avg_price) > 0)
  sechsmal  qty_avg_price: parseFloat(x.avg_price)
  zweimal   SELECT avg_price, avg_price FROM part_price_cache

Gemeint war jedes Mal qty_avg_price. Die erste Form ist folgenlos — ein
doppelter Operand ändert am Ergebnis nichts —, und genau deshalb überlebt
sie: Nichts schlägt fehl, kein Test wird rot, der Compiler schweigt. Die
zweite und dritte Form liefern dagegen still den falschen WERT: Bei Teilen
und Minifiguren war qty_avg_price nie der mengengewichtete Schnitt, sondern
immer eine Kopie des einfachen.

Alle drei stecken in Funktionen, die voneinander kopiert wurden. Das ist das
Muster: nicht falsch gedacht, sondern vervielfältigt — und beim Kopieren
verrutscht.

── Was geprüft wird ────────────────────────────────────────────────────────
  A) Derselbe Ausdruck beidseits von || oder && — auf JEDER Klammerebene.
  B) Dieselbe Spalte zweimal in einer SELECT-Liste.

Beides über die Webapp UND die Android-App: Kotlin kennt denselben Fehler.

── Was beim Bauen dieser Prüfung schiefging (und hier steht, damit es nicht
   noch einmal passiert) ────────────────────────────────────────────────────
Die erste Fassung trennte nur auf oberster Klammerebene und fand den
bekannten Fehler nicht — er steht innerhalb von `if (…)`. Die zweite entfernte
Leerraum auch INNERHALB von Regex-Literalen und hielt daraufhin `/^  \S/` und
`/^\S/` für denselben Ausdruck. Eine Prüfung, die sich nicht zuerst am
bekannten Fall bewährt, meldet „nichts gefunden" und man glaubt ihr.
```
