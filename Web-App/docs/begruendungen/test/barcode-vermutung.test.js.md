# Begründungen zu `test/barcode-vermutung.test.js`

Die ausführlichen Kommentare aus `test/barcode-vermutung.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Eine geratene Setnummer muss als Vermutung erkennbar sein.

── Marcos Meldung ──────────────────────────────────────────────────────────
„Es werden regelmässig falsche Nummern erkannt."

Die Barcode-Route hat sieben Wege zu einer Setnummer. Fünf gleichen eine
KENNUNG ab, zwei raten — und beide antworteten mit `success: true` und einer
konkreten Nummer, für die App nicht von einem Treffer zu unterscheiden.

  rebrickable-search  wird GENAU DANN erreicht, wenn die exakte Prüfung
                      `extIds.includes(ean13)` vorher fehlschlug. Nimmt dann
                      das erste Suchergebnis mit `year > 2010 && num_parts > 0`
                      — nichts daran hat mit der gescannten EAN zu tun.
  upcitemdb           liest eine Zahl aus einem Produkttitel.

── Warum eine POSITIVliste ─────────────────────────────────────────────────
Unbekannte Quelle = Vermutung. Wer einen achten Weg einbaut, muss
ausdrücklich sagen, dass er eine Kennung abgleicht. Andersherum ginge ein
neuer Ratepfad still als geprüft durch — genau der Fehler, der hier behoben
wird.
```
