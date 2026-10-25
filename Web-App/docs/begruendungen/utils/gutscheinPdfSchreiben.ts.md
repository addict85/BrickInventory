# Begründungen zu `utils/gutscheinPdfSchreiben.ts`

Die ausführlichen Kommentare aus `utils/gutscheinPdfSchreiben.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Gutschein-PDFs ändern, verbinden und seitenweise lesen.

── Woher das kommt ─────────────────────────────────────────────────────────

Marcos Vorgabe: „Gutscheine sollen exportiert werden können inkl. Guthaben.
Bitte den Text im Gutschein mit dem in der App hinterlegten Betrag
ersetzen. Wenn alle Gutscheine exportiert werden sollen, ein PDF erstellen
mit allen Gutscheinen. Das PDF soll auch wieder importiert werden können."

Der Betrag auf der Karte ist der AUSGESTELLTE; in der App steht der, der
noch drauf ist. Wer den Gutschein weitergibt, will das Papier mit dem
heutigen Stand.

── Warum eine Bibliothek, und warum diese ──────────────────────────────────

GEMESSEN: `pdfkit` (schon im Baum) kann nur SCHREIBEN — `loadPDF`,
`importPage`, `embedPDF` existieren alle nicht. Mehrere Original-PDFs zu
einem zu verbinden ist damit nicht schwierig, sondern unmöglich.

`@cantoo/pdf-lib` ist die gepflegte Abspaltung von `pdf-lib`: 2.11.1 vom
15.09.2026 gegen 1.17.1 vom 06.11.2021. Reines JavaScript, vier kleine
Abhängigkeiten, keine Laufzeit eines Browsers. Marco hat die Aufnahme
entschieden, nachdem die Messung oben vorlag.

── Warum ERSETZEN und nicht ÜBERDRUCKEN ────────────────────────────────────

Ein weisses Rechteck mit neuer Zahl darüber wäre viel einfacher. Dann stünde
aber die ALTE Zahl weiter im Text des PDFs — und der Importer dieser
Anwendung liest genau diesen Text. Der Rundlauf läse 400, wo 250 gedruckt
steht. Ersetzt wird deshalb im Inhaltsstrom selbst.

── Die Schriftschranke ─────────────────────────────────────────────────────

Ersetzt wird eine Zeichenkette durch eine LITERALE (ASCII). Das stimmt nur,
wenn die Schrift des Operators ASCII auf sich selbst abbildet. GEMESSEN an
zwei von pdfkit erzeugten PDFs:

    Standard (Helvetica)     /Type1  Encoding=/WinAnsiEncoding
    eingebettete Teilmenge   /Type0  Encoding=/Identity-H

Bei Identity-H liest der Leser GAR NICHTS (betrag: null) — über diesen Weg
käme also nie ein Betrag zum Ersetzen. Die Schranke macht daraus trotzdem
ein „ausgeschlossen" statt eines „unwahrscheinlich": Angefasst wird nur ein
Operator, dessen aktive Schrift (das letzte `Tf` davor) eine der drei
Standardkodierungen trägt oder gar keine (die vierzehn Standardschriften).

Ohne diese Schranke bliebe eine Lage, die keine Nachprüfung fängt: Eine
literale Kette in einer Identity-H-Schrift LIEST sich als „250" und DRUCKT
sich als Zeichensalat. Prüfung grün, Papier falsch.

── Und trotzdem wird nachgeprüft ───────────────────────────────────────────

`ersetzeBetrag()` liest das Ergebnis mit demselben Leser wieder und gibt
`null` zurück, wenn nicht genau der neue Betrag herauskommt und Nummer und
PIN unverändert sind. Ein nicht ersetzter Gutschein ist eine Auskunft; ein
falsch ersetzter wäre eine Falschaussage über Geld.
```

<a id="ersetzeimstrom"></a>
## `ersetzeImStrom`

```text
In EINEM Inhaltsstrom jeden Textoperator ersetzen, der `suchen` enthält.

Der ganze Operator wird durch eine literale Kette ersetzt — die
Kerning-Zahlen eines TJ-Feldes gehen dabei verloren. Der Text sitzt dadurch
minimal anders; er steht aber vollständig da, und der Betrag ist der
richtige. Die Buchstabenabstände einer Geschenkkarte sind der Preis, den
diese Genauigkeit kostet.
```

<a id="stroemevon"></a>
## `stroemeVon`

```text
Die Inhaltsströme einer Seite, aufgelöst.

── Ohne `any`, und warum das hier zählt ────────────────────────────────────

Der erste Entwurf nahm `seite: any` und zweimal `(x: any)` in den
Rückrufen. test/ratschen.test.js zählt jedes `any` im Baum und lässt die
Zahl nur SINKEN („any wird weniger, nie mehr") — 401 statt 398, und die
Ratsche hat es gemeldet. Die Typen sind alle da: PDFPage für die Seite,
PDFObject für einen Eintrag im Inhalts-Feld. Es war Bequemlichkeit, keine
Notwendigkeit.

`Contents()` liefert laut Typ einen PDFArray, einen PDFRawStream oder
undefined — ein Einzelstrom, ein Feld von Verweisen oder nichts. Alle drei
Fälle stehen unten ausdrücklich da.
```

<a id="marke-kopf"></a>
## `MARKE_KOPF`

```text
Die Marke, mit der ein exportiertes PDF sich selbst erklärt.

── Warum es sie gibt ───────────────────────────────────────────────────────

„Das PDF soll auch wieder importiert werden können (mehrere Seiten in einem
PDF ergeben mehrere Gutschein-Einträge)." Ohne Marke müsste der Import jede
Seite nach dem Muster durchsuchen, mit dem auch ein fremdes LEGO-PDF gelesen
wird — und das ist Raten: Die längste Ziffernfolge ist die Nummer, die Zahl
neben einem Währungscode der Betrag. Auf einer Seite geht das; über zwanzig
Seiten verschiedener Jahrgänge vervielfacht sich jede Unschärfe.

Mit Marke ist der Import eine Ablesung. Das Raten bleibt als RÜCKFALL für
fremde PDFs (siehe seitenweiseLesen) — die Marke ersetzt es nicht, sie geht
ihm voraus.

Die Zeile steht sichtbar klein am unteren Rand und nicht unsichtbar: Was in
einem Dokument steht, soll man sehen können. Wer das PDF weitergibt, gibt
Nummer und PIN ohnehin weiter — die stehen gross darüber.
```

<a id="exportbefund"></a>
## `ExportBefund`

```text
Was aus einem Gutschein im Export geworden ist.

── Warum es 'stimmte_schon' gibt (Marcos Befund vom 15.10.) ───────────────

Es waren drei Arten, und „der Betrag stand schon richtig im PDF" fiel unter
`unveraendert` — mit einem Grund daneben. Die Oberflaeche zeigte alles mit
Grund als Warnung, und Marco las in seinem Export zweimal
„⚠ …: Der Betrag im PDF stimmt schon". Das ist eine WARNUNG VOR EINEM
ERFOLG: Nichts zu ersetzen, weil nichts falsch war, ist der beste Fall.

Der Fehler lag nicht in der Anzeige, sondern hier: Zwei verschiedene
Sachverhalte trugen dieselbe Art. Jetzt sind es vier, und 'unveraendert'
heisst wieder genau eines — es haette ersetzt werden sollen und ging nicht.
```

<a id="erzeugeseite"></a>
## `erzeugeSeite`

```text
Eine Seite für einen Gutschein OHNE Original-PDF.

Das ist kein Umgehen von Marcos Entscheidung („Betrag im Original
ersetzen"), sondern ein Fall, den sie nicht abdeckt: Ein von Hand erfasster
Gutschein hat kein Original, in dem etwas zu ersetzen wäre. Ohne diese Seite
fehlte er im Export ganz — und „alle Gutscheine" hiesse dann „alle mit
PDF".
```

<a id="verbindegutscheine"></a>
## `verbindeGutscheine`

```text
Alle Gutscheine in EIN PDF — eine Seite (oder mehrere) je Gutschein.

Reihenfolge und Ablauf:
  1. Mit Original: Betrag ersetzen. Geht das nicht sicher, kommt das
     Original UNVERÄNDERT hinein und der Befund sagt, warum. Ein nicht
     ersetzter Gutschein ist eine Auskunft; ein falsch ersetzter wäre eine
     Falschaussage über Geld.
  2. Ohne Original: erzeugte Seite.
  3. Auf JEDE erste Seite eines Gutscheins kommt die Marke, damit der Import
     ablesen kann statt zu raten.

Die Befunde gehen mit zurück, nicht ins Protokoll: Der Nutzer, der auf
„exportieren" geklickt hat, ist der, der es wissen muss.
```

<a id="verbindegutscheine-2"></a>
## Abschnitt

```text
Die Marke nur auf die ERSTE Seite eines Gutscheins.

GEMESSEN: Dass daraus EIN Eintrag wird, garantiert nicht diese Zeile,
sondern die Dublettenprüfung in seitenweiseLesen() — eine Gegenprobe
(„Marke auf ALLE Seiten") machte keinen Fall rot. Hier stand deshalb
zuerst zu viel („sonst zählte der Import mehrfach"). Richtig ist: Die
Dublettenprüfung trägt die Aussage, diese Zeile hält das Dokument
sauber — zwanzig gleiche Fusszeilen auf einem zwanzigseitigen Original
wären Unrat, kein Fehler.
```

<a id="seitenweiselesen"></a>
## `seitenweiseLesen`

```text
Ein PDF in Gutscheine zerlegen — Marken zuerst, Raten als Rückfall.

── Zwei Wege, und warum in dieser Reihenfolge ──────────────────────────────

1. MARKEN. Ein von dieser Anwendung exportiertes PDF sagt selbst, was drin
   steht. Das ist eine Ablesung, kein Schluss.
2. SEITENWEISE RATEN. Ein fremdes PDF (die Karte, wie LEGO sie schickt) hat
   keine Marke. Dann wird es in Einzelseiten zerlegt und jede mit
   werteAusPdf() gelesen — dasselbe Verfahren wie bisher für eine Seite, nur
   für jede. Zerlegen und NICHT das Ganze lesen: Sonst gewinnt über zwanzig
   Seiten die längste Ziffernfolge des ganzen Stapels, und es käme EIN
   Gutschein heraus statt zwanzig.

Doppelte Nummern fallen weg: Ein Stapel, in dem dieselbe Karte zweimal
liegt, soll keinen zweiten Eintrag ergeben (die Tabelle hat UNIQUE
(user_id, number), aber ein Fehler je Zeile wäre eine schlechtere Auskunft
als „einmal gezählt").
```
