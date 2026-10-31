# Begründungen zu `src/gutscheine/gutscheinPdf.ts`

Die ausführlichen Kommentare aus `src/gutscheine/gutscheinPdf.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Die drei Werte eines LEGO-Gutscheins aus dessen PDF lesen.

── Warum das hier steht und nicht in einer Bibliothek ──────────────────────

Der Baum hat `pdfkit` — das SCHREIBT PDFs und kann keines lesen. Zum Lesen
gibt es hier nichts, und eine neue Abhaengigkeit fuer diese eine Aufgabe
waere zu viel: Die PDF-Leser im npm-Oekosystem bringen entweder eine ganze
Browser-Laufzeit mit (pdfjs-dist) oder sind unbetreut.

Entscheidend fuer diese Abwaegung ist, dass der Auszug eine BEQUEMLICHKEIT
ist, kein tragender Weg: Marcos Vorgabe nennt die manuelle Erfassung
gleichberechtigt zuerst. Schlaegt das Auslesen fehl, sagt die Oberflaeche
das und der Nutzer tippt drei Felder. Deshalb darf dieser Auszug schmal
sein — er muss nur ehrlich scheitern.

── Was GEMESSEN wurde ──────────────────────────────────────────────────────

An Marcos Beispiel-PDF (06.10., 210'802 Bytes, PDF 1.7): eine Seite, vier
Bilder, fuenf Schriften, neun Stroeme, davon acht mit zlib entpackbar, und
24 Textoperatoren. Es ist KEIN Scan — die Werte stehen als Text da:

    'Ihre LEGO-Geschenkkarte im Wert von 400 CHF:'
    '5045076374450011166'
    'PIN: 5225'

Deshalb reicht Entpacken + Textoperatoren lesen, und es braucht keine
Texterkennung. Waere es ein Scan, saehe die Antwort anders aus (die
Android-App haette mit ML-Kit eine, der Server nicht).

── Was dieser Leser NICHT kann ─────────────────────────────────────────────

Er versteht Stroeme mit FlateDecode und sonst nichts; verschachtelte
Klammern in Zeichenketten zaehlt er nicht mit; Objektstroeme (PDF 1.5+,
/ObjStm) mit darin versteckten Seiteninhalten sieht er nicht; und eine
Schrift mit eigener Kodierung liefert Buchstabensalat statt Text.

Jeder dieser Faelle endet in `null` — also im manuellen Weg. Das ist der
Grund, warum hier nichts geraten wird: Ein falsch ausgelesener Gutschein
ist schlimmer als ein nicht ausgelesener, weil niemand ihn nachprueft.
```

<a id="zahllesen"></a>
## `zahlLesen`

```text
Eine Zahl aus dem PDF in eine Zahl verwandeln — ohne zu raten.

Drei Schreibweisen kommen vor und widersprechen einander:
  1'234.50   (Schweiz)      1.234,50   (Deutschland)      1,234.50   (USA)

Der Apostroph ist immer ein Tausendertrenner. Punkt und Komma sind es
NICHT immer — deshalb entscheidet die Stellung: Was zuletzt kommt und
hoechstens zwei Ziffern hinter sich hat, ist das Dezimalzeichen; alles
andere ist Trennung. Steht ein Trenner mit genau drei Ziffern dahinter und
es gibt keinen zweiten Kandidaten, ist es ein Tausendertrenner (1.234).
```

<a id="abschnitt-2"></a>
## Abschnitt

```text
Den sichtbaren Text eines PDFs herausholen.

Jeder Textoperator wird zu einer eigenen Zeile. Das ist kein Schoenheits-
fehler, sondern Absicht: Im Beispiel steht die Kartennummer ALLEIN in einem
Operator. Wuerde alles zu einem Fliesstext verklebt, grenzte sie an den
Doppelpunkt der Zeile davor und an „PIN" dahinter — und jede Suche muesste
raten, wo sie anfaengt.
```

<a id="text-op-re"></a>
## `TEXT_OP_RE`

```text
Ein Textoperator im Inhaltsstrom: (…)Tj, […]TJ, (…)' und (…)".

── Warum das jetzt hier oben steht und exportiert wird ─────────────────────

Der Ausdruck stand im Rumpf von pdfText(). Seit es einen SCHREIBER gibt
(src/gutscheine/gutscheinPdfSchreiben.ts, der den Betrag im Original ersetzt), brauchen
zwei Stellen dieselbe Zerlegung. Zwei Abschriften desselben Ausdrucks wären
genau die Bauart, an der in diesem Baum schon mehrfach etwas auseinander
gelaufen ist: Der Leser fände einen Operator, den der Schreiber nicht
anfasst — und dann stünde im Text ein anderer Betrag als auf dem Papier.

`g` ist gesetzt, also trägt der Ausdruck einen Zustand (lastIndex). Jeder
Benutzer setzt ihn vor der Schleife zurück.
```

<a id="werteaustext-kandidaten"></a>
## `kandidaten`

```text
── Kartennummer ─────────────────────────────────────────────────────────

Die laengste zusammenhaengende Ziffernfolge ab 13 Stellen. Die untere
Grenze haelt Jahreszahlen, Postleitzahlen und den PIN draussen; „laengste"
statt „erste", damit eine Telefonnummer im Kleingedruckten die echte
Nummer nicht verdraengt. GEMESSEN am Beispiel: 19 Stellen.

Hier stand `.filter(k => k !== pin)` mit der Begruendung, der PIN duerfe
nicht zur Nummer werden. ENTFALLEN, weil es nie greifen konnte: Der
PIN-Ausdruck oben faengt hoechstens acht Ziffern, ein Kandidat hat
mindestens dreizehn — die beiden Mengen beruehren sich nicht. Eine
Pruefung, die nicht ausloesen kann, sieht nach Sorgfalt aus und ist
keine; getrennt werden die beiden allein durch die Laenge.

Aufgefallen bei der Gegenprobe zu dieser Datei, nicht beim Schreiben.
```
