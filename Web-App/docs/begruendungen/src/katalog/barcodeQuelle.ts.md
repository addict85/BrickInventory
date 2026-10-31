# Begründungen zu `src/katalog/barcodeQuelle.ts`

Die ausführlichen Kommentare aus `src/katalog/barcodeQuelle.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="geprueft"></a>
## `GEPRUEFT`

```text
Kam eine Barcode-Antwort aus einem GEPRÜFTEN Abgleich oder aus einer
Vermutung?

── Warum das eine eigene Stelle braucht ────────────────────────────────────

Marcos Meldung: „Es werden regelmässig falsche Nummern erkannt."

Die Barcode-Route hat sieben Wege zu einer Setnummer, und sie sind
unterschiedlich verlässlich. Fünf davon gleichen eine KENNUNG ab — die
gescannte Zeichenkette ist selbst eine Setnummer, oder die EAN steht
nachweislich in den external_ids des Treffers. Zwei raten:

  rebrickable-search  Der Zweig wird GENAU DANN erreicht, wenn die exakte
                      Prüfung `extIds.includes(ean13)` vorher fehlschlug.
                      Er nimmt dann das erste Suchergebnis, das nur zwei
                      Bedingungen erfüllt: nach 2010 und hat Teile. Mit der
                      gescannten Nummer hat es nichts zu tun.

  upcitemdb           Eine Zahl aus einem PRODUKTTITEL. Titel sind Fliesstext
                      von Händlern; dort steht neben der Setnummer auch das
                      Jahr und die Teilezahl.

Beide antworteten mit `success: true` und einer konkreten Setnummer — für
die App nicht von einem geprüften Treffer zu unterscheiden. Der
Bestätigungsdialog zeigt Bild und Namen, also KÖNNTE man es sehen; aber
niemand sieht genau hin, wenn nichts darauf hinweist.

── Die Liste ist eine Positivliste, und das ist Absicht ────────────────────

Eine unbekannte Quelle gilt als Vermutung. Wer einen achten Weg einbaut, muss
hier ausdrücklich sagen, dass er eine Kennung abgleicht — sonst ist die
Antwort automatisch als unsicher markiert. Andersherum (Negativliste) würde
ein neuer Ratepfad still als geprüft durchgehen, und das ist genau der
Fehler, der hier behoben wird.
```
