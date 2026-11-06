# Begründungen zu `test/gutschein-pdf-schreiben.test.js`

Die ausführlichen Kommentare aus `test/gutschein-pdf-schreiben.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Den Betrag im Original-PDF ersetzen, Gutscheine verbinden, zurueckeinlesen.

── Marcos Vorgabe ──────────────────────────────────────────────────────────

  „Gutscheine sollen exportiert werden können inkl. Guthaben. Bitte den Text
   im Gutschein mit dem in der App hinterlegten Betrag ersetzen. Wenn alle
   Gutscheine exportiert werden sollen, ein PDF erstellen mit allen
   Gutscheinen. Das PDF soll auch wieder importiert werden können (mehrere
   Seiten in einem PDF ergeben mehrere Gutschein-Einträge)."

Ich hatte abgeraten (ein neu erzeugtes PDF ist beherrschbarer) und die
Brüchigkeit genannt. Marco hat entschieden; dieser Test ist der Preis
dafür, dass die Entscheidung tragfähig ist.

── Was BELEGT wird, und was nicht ──────────────────────────────────────────

Belegt wird alles an PDFs, die hier erzeugt werden. NICHT belegt ist Marcos
echtes LEGO-PDF: Es liegt nicht im Baum (und darf nicht hinein — das
Verzeichnis ist öffentlich, und auf der Karte stehen Nummer und PIN). Was
darüber bekannt ist, steht in src/gutscheine/gutscheinPdf.ts, gemessen am 06.10.

Deshalb ist die NACHPRÜFUNG Teil der Sache und nicht Zierde: ersetzeBetrag()
liest sein eigenes Ergebnis zurück und gibt `null`, wenn nicht genau der
neue Betrag herauskommt. Ein nicht ersetzter Gutschein ist eine Auskunft;
ein falsch ersetzter wäre eine Falschaussage über Geld.

── Die Schriftschranke ─────────────────────────────────────────────────────

Fall 6 ist der wichtigste des ganzen Tests. Eine literale ASCII-Kette LIEST
sich in einer Schrift mit eigener Kodierung als „250" und DRUCKT sich als
Zeichensalat — eine Nachprüfung über den Text fängt das NICHT. Deshalb wird
nur angefasst, was eine Standardkodierung trägt, und Fall 6 baut genau den
Fall, in dem die Schranke auslösen muss: derselbe lesbare Betrag, nur die
Kodierung unterscheidet sich.

Ohne Fall 6 wäre die Schranke eine Behauptung — sie löst in keinem der
anderen Fälle aus (bei Identity-H findet der Leser schon gar keinen Betrag).
```

<a id="nummermit400"></a>
## `const nummerMit400 = '5045076374400011166';`

```text
── Woher dieser Fall kommt (Gegenprobe) ────────────────────────────────

Die Gegenprobe „Nachprüfung entfernt" machte zunächst GAR NICHTS rot. Eine
Schranke ohne Fall ist keine Schranke, also musste der Fall her, für den
sie da ist — und er ist nicht konstruiert, sondern naheliegend:

Die Kartennummer ist eine 19-stellige Ziffernfolge. Steht der Betrag
(„400") AUCH darin, trifft ein Ersetzen über den ganzen Strom die Nummer
mit. Hier endet sie auf …400…, und aus 250 würde eine falsche Karte.

Eine falsche Kartennummer ist schlimmer als ein nicht ersetzter Betrag:
Der Gutschein wäre unbrauchbar, und es stünde nirgends.
```
