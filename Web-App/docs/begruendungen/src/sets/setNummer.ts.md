# Begründungen zu `src/sets/setNummer.ts`

Die ausführlichen Kommentare aus `src/sets/setNummer.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Wie eine Set-Nummer geschrieben wird — die eine Stelle dafür.

Rebrickable und BrickLink führen Sets MIT Versionsanhang: „10179-1". Wer
eine Nummer ohne ihn bekommt (Eingabe, Barcode, alter Bestand), muss sie
ergänzen, bevor er damit in eine Tabelle greift — sonst findet er nichts.

── Warum das eine eigene Datei ist ─────────────────────────────────────────
Die Zeile

    setNumber.includes('-') ? setNumber : `${setNumber}-1`

stand VIERUNDZWANZIGMAL im Baum, in zwölf Dateien. Solange alle
Fundstellen sie gleich schreiben, fällt das nicht auf — aber es reicht
eine, die es nicht tut, und dann suchen zwei Stellen unter verschiedenen
Namen nach derselben Sache.

NACHGEMESSEN an genau so einem Fall: Ein Set, das clients/bricklink.ts im
Katalog als „kein BrickLink-Preis" markiert hatte (abgelegt unter der
Nummer MIT Anhang), wurde von der Vorprüfung im Preis-Job und im
Anfrageweg unter der ROHEN Nummer gesucht:

    Eingabe                Job                    Anfrageweg
    ohne Versionsanhang    error, 1 Abruf         wirft, 2 Abrufe
    mit  Versionsanhang    skipped_gear, 0        still,  0

Drei BrickLink-Abrufe für ein Set, von dem im Katalog steht, dass es
keinen Preis hat — je Lauf, auf Kosten des Tageskontingents. Und der Job
zählte es als Fehler statt als übersprungen.
```

<a id="mitversion"></a>
## `mitVersion`

```text
Die Schreibweise, unter der Kataloge und Zwischenspeicher ein Set führen.

Geprüft wird auf einen VERSIONSANHANG (`-` und Ziffern), nicht auf
irgendeinen Bindestrich. Die 24 zusammengeführten Fundstellen schrieben
`includes('-')`, drei weitere (src/sets/setAdd, src/sets/setService,
routes/api_v1/catalog) und utils/bricklinkLink schrieben `/-\d+$/`. Die
beiden stimmen auf jeder echten Nummer überein und gehen erst bei einem
Bindestrich OHNE Ziffernanhang auseinander:

    Eingabe     includes('-')   /-\d+$/
    10179       10179-1         10179-1
    fig-000123  fig-000123      fig-000123
    10179-a     10179-a         10179-a-1   <- verschieden

NACHGESEHEN im gemeinsamen Prüfkorpus (shared/setnummer-korpus.json): keine
einzige Nummer dieser Art. Genommen wird die genauere Fassung — dann sagen
auch die beiden bewusst doppelten Normalisierer in setAdd/setService (die
ihren eigenen Vergleichstest haben und deshalb nichts importieren dürfen)
dasselbe wie diese Stelle, statt nur beinahe.
```

<a id="normalisieresetnummer"></a>
## `normalisiereSetNummer`

```text
Eine EINGABE zu einer Set-Nummer machen — aus einem Barcode, einem
abgetippten Feld, einer CSV-Zeile.

Was wegfaellt: alles ab dem ersten Semikolon oder Leerzeichen (so kommen
Scanner-Ausgaben und Produkttitel daher) und jedes Zeichen, das weder
Ziffer noch Buchstabe noch Bindestrich ist. Was dazukommt: der
Versionsanhang, falls er fehlt.

── Warum das hier steht und nicht zweimal daneben ──────────────────────────
Diese Funktion stand in zwei Fassungen nebeneinander — src/sets/setAdd.ts
(normalizeSetNumber) und src/sets/setService.ts (sanitizeSetNumber) —, und
beide trugen denselben Kommentar: „Bewusst OHNE den vorDem()-Helfer: Ein
Import baute einen Kreis, und set-add-exists-db.test.js fuehrt ihren Rumpf
ISOLIERT aus."

Beides gilt hier nicht mehr. Der Kreis war zwischen jenen beiden Modulen;
diese Datei ist ein Blatt und baut keinen. Und die Isolation war eine
Eigenart des TESTS, nicht des Codes: Er zog den Rumpf per `new Function`
heraus, obwohl beide Funktionen ausdruecklich exportiert sind — er
vergleicht sie jetzt als Funktionen.

Beide Namen bleiben, wo sie waren; die Aufrufer aendern sich nicht.

`unknown` statt `string`: Die beiden Fassungen hatten verschiedene
Signaturen (setAdd nahm `string`, setService `unknown`), der Rumpf machte
aber immer `String(input)`. `unknown` sagt, was wirklich hereinkommt.
```
