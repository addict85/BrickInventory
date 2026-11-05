# Begründungen zu `test/set-add-exists-db.test.js`

Die ausführlichen Kommentare aus `test/set-add-exists-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Ein Set, das schon im Blickfeld steht, wird beim Erfassen NICHT erhöht.

── Marcos Festlegung ───────────────────────────────────────────────────────
„Besitzt der Account oder einer der Unteraccounts das Set bereits, soll sich
nur der Detail-Dialog des Sets öffnen. Egal ob die Erfassung via
Barcodescanner, OCR oder per Nummer-Erfassung erfolgt."

Vorher hing das am Client: Die App prüfte selbst vor dem Anlegen, die Webapp
gar nicht — dort erhöhte der Server still die Menge und meldete
„aktualisiert". Dieselbe Eingabe, zwei Ausgänge.

Jetzt entscheidet src/sets/setAdd.ts, und beide Erfassungs-Routen fragen es.
Der Test prüft die WIRKUNG, nicht den Wortlaut: Nach dem Aufruf muss die
Menge unverändert sein und keine neue Erfassung entstanden sein — genau das
würde ein Rückfall auf das alte Verhalten verletzen, auch wenn die Antwort
weiterhin `success: true` sagt.

── Die Ausnahme, die mitgeprüft wird ───────────────────────────────────────
Der CSV-Import ruft addSet() direkt und soll weiterhin zusammenfassen. Wer
500 Zeilen einliest, will keine 500 Rückfragen. Ohne diesen Teilschritt
würde ein späterer Umbau die Regel womöglich in addSet() selbst schieben und
den Import dabei stillschweigend lahmlegen.
```

<a id="module"></a>
## `const Module = require('node:module');`

```text
Der Nachzug nach dem Erfassen (jobs/nachErfassung.ts) wird abgefangen.

Er haengt an einem setTimeout von zwei bis fuenf Sekunden und laeuft damit
NACH diesem Test — gegen einen dann geschlossenen Verbindungspool:
  [weiter-trotz-fehler] instr-queue:trigger: Cannot use a pool after ...
Sichtbar war nur dieser eine Schritt, weil nur er protokolliert; die
uebrigen sechs schluckten ihren Fehler und liefen genauso ins Leere.
```

<a id="stelle"></a>
## `const { normalizeSetNumber } = _req('src/sets/setAdd.js');`

```text
── Warum das jetzt anders geprueft wird ────────────────────────────────

Hier stand: den Rumpf von sanitizeSetNumber per funktionsRumpf() aus der
Quelle schneiden und mit `new Function` ausfuehren. Das war noetig,
solange die beiden Fassungen getrennt nebeneinander standen — und es
hatte einen Preis, der laenger wog als der Nutzen: In BEIDEN Funktionen
stand deshalb der Kommentar „Bewusst OHNE den vorDem()-Helfer … ein
externer Aufruf waere hier nicht aufloesbar". Der Test schrieb dem Code
vor, wie er auszusehen hat.

Beide sind ausdruecklich EXPORTIERT. Sie werden jetzt einfach beide
geholt und verglichen — und weil beide an
src/infra/setNummer.ts -> normalisiereSetNummer() durchreichen, koennen sie
gar nicht mehr auseinanderlaufen. Die Aussage bleibt dieselbe: Weichen
sie ab, prueft die Regel eine ANDERE Nummer als die, die danach
geschrieben wird — und das Set landet trotz Pruefung doppelt.
```
