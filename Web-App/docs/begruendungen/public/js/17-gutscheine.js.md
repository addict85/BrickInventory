# Begründungen zu `public/js/17-gutscheine.js`

Die ausführlichen Kommentare aus `public/js/17-gutscheine.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="im-eigenen-profil-sollen-lego-gutscheine"></a>
## „Im Eigenen Profil sollen Lego-Gutscheine mit Gutscheinnummer und Pins und

```text
═══ Gutscheine (LEGO-Geschenkkarten) ══════════════════════════════════════

── Marcos Vorgabe ─────────────────────────────────────────────────────────

„Im Eigenen Profil sollen Lego-Gutscheine mit Gutscheinnummer und Pins und
Betrag hinterlegt werden können. […] Die Erfassung, Änderung und Anzeige
soll sowohl in der Android-App als auch in der Webapp möglich sein und
möglichst einfach erreichbar sein."

Deshalb steht der Abschnitt direkt in den Profil-Einstellungen und nicht in
einem eigenen Reiter: „möglichst einfach erreichbar" heisst hier, am selben
Ort wie alles andere, was einem selbst gehört.

── Was hier NICHT passiert ────────────────────────────────────────────────

Kein Auslesen des PDFs im Browser. Die Datei geht zum Server, der liest sie
und schickt die Werte zurück. Das ist Marcos Vorgabe („die gleichen
Services des Backends") und zugleich das einzig Sinnvolle: Eine zweite
Fassung der Leselogik in JavaScript müsste mit der auf dem Server Schritt
halten, und die Android-App bräuchte eine dritte.
```

<a id="speichern-der-eine-knopf-fuer-beide-wege"></a>
## Speichern — der eine Knopf für beide Wege.

```text
Speichern — der eine Knopf für beide Wege.

Liegt eine Datei im Feld, geht sie mit: Dann liest der Server die Werte und
die ausgefüllten Felder gewinnen gegen das Gelesene. Liegt keine da, ist es
eine ganz gewöhnliche manuelle Erfassung. Marcos „entweder … oder" ist
damit kein Entweder-oder in der Bedienung — man kann ein PDF hochladen UND
den Betrag selbst eintragen, wenn das PDF ihn nicht hergibt.
```

<a id="ob-ein-pdf-einen-oder"></a>
## `if`

```text
── Ein PDF, zwei mögliche Antworten ────────────────────────────────────

Marcos Vorgabe: „Wenn ein PDF mit mehreren Seiten selektiert wird,
sollen mehrere Gutscheine erfasst werden." Welcher Fall es ist,
entscheidet der SERVER — er liest die Datei. Hier wird nur die Antwort
gezeigt, und `mehrere` sagt, welche es ist.

Dieselben Felder wie bei den CSV-Importen (added/updated/errors), also
dieselbe Meldung: Wer drei Gutscheine auf einmal erfasst, soll nicht
„Gutschein gespeichert" lesen und raten, wie viele es wurden.
```

<a id="gutscheinpdfoeffnen"></a>
## `gutscheinPdfOeffnen`

```text
Das PDF im Betrachter der App — derselbe wie bei den Bauanleitungen.

── Marcos Vorgabe ─────────────────────────────────────────────────────────

  „Die beiden Buttons PDF Download und PDF im neuen Fenster öffnen
   entfernen und durch den PDF-Viewer der Anleitungen ersetzen → Analog wie
   es in der Android-App umgesetzt ist."

Hier standen zwei Knöpfe: `window.open` für die Anzeige und ein zweiter
mit `?download=1` für das Herunterladen. Beide sind entfallen, und zwar
ersatzlos — der Betrachter trägt seinen Download-Knopf selbst
(`pdf-viewer-download` in index.html, er bekommt dieselbe Adresse).
Zwei Knöpfe für eine Sache waren eine Zeile Platz und eine Entscheidung
zu viel.

Damit verhalten sich beide Apps gleich: Die Android-App zeigt Gutschein-
PDFs im PdfViewerScreen, demselben, der auch Anleitungen und Teilelisten
zeigt. Genau das meint „analog".
```

<a id="gutscheinkopieren"></a>
## `gutscheinKopieren`

```text
Gutscheinnummer oder PIN in die Zwischenablage.

── Marcos Vorgabe ─────────────────────────────────────────────────────────

  „Kannst du in der Webapp hinter den Gutscheincode und den Pin jeweils
   einen Kopieren Button einfügen (mit einem Icon)."

Kopiert wird die ROHE Nummer, nicht die mit Leerzeichen gruppierte Anzeige:
Die Gruppierung ist eine Lesehilfe fürs Abtippen an der Kasse — ein
Bezahlfeld nimmt sie nicht an.

`navigator.clipboard` braucht einen sicheren Kontext (HTTPS oder
localhost). Auf einem Server, der nur über HTTP läuft, fehlt das Objekt
ganz; deshalb der Rückfall über ein unsichtbares Textfeld und
`execCommand('copy')`. Das ist veraltet, aber es ist der einzige Weg, der
dort noch funktioniert — und ein Kopieren-Knopf, der auf halben Servern
stumm nichts tut, wäre schlimmer als sein Fehlen.
```

<a id="gutscheineexportieren"></a>
## `gutscheineExportieren`

```text
Alle Gutscheine als EIN PDF herunterladen.

── Warum fetch und kein Link ───────────────────────────────────────────────

Die Antwort trägt neben dem PDF eine Kopfzeile `X-Gutschein-Befunde`: je
Gutschein, ob der Betrag ersetzt wurde, schon stimmte, unverändert blieb
(mit Grund) oder die Seite erzeugt wurde. Ein `<a href>` bekäme die Datei
und würde die Auskunft wegwerfen — und genau die ist hier wichtig: Ein
Gutschein, dessen Betrag NICHT ersetzt werden konnte, zeigt auf dem Papier
den alten Wert. Das muss dastehen, nicht verschwiegen werden.

── Was hier NICHT mehr steht (Marcos Durchsicht vom 15.10.) ───────────────

Die Liste der Befunde unter den Knöpfen. Sie zeigte „⚠ …: Der Betrag im PDF
stimmt schon" — also eine Warnung davor, dass alles in Ordnung ist. Der
Fehler lag nicht in dieser Anzeige, sondern eine Schicht tiefer: „stimmte
schon" und „liess sich nicht ersetzen" trugen dieselbe Art. Seit es
'stimmte_schon' gibt (src/gutscheine/gutscheinPdfSchreiben.ts), zählt `offen` nur
noch das, was wirklich offen ist — und das sagt die Meldung.
```

<a id="toast"></a>
## `toast`

```text
tRaw und nicht t: Das Ziel ist ein TOAST, also reiner Text. t()
maskiert die eingesetzten Werte, und die Maskierung erscheint dort
WOERTLICH — aus 9'325 wurde im Katalog sichtbar „9&#39;325".
test/frontend-escaping.test.js faengt genau das, und es hat es
gefangen: Mein erster Entwurf stand hier mit t().
Die Nummern stehen IN der Meldung: Ohne sie wüsste niemand, welche
Karte auf dem Papier den alten Betrag trägt — und eine Liste, die
dauerhaft unter den Knöpfen steht, will Marco nicht.
```

<a id="kannst-du-dies-bei-den-gutscheinen-einba"></a>
## „Kannst du dies bei den Gutscheinen einbauen, damit dies auf Knopfdruck

```text
═══ Guthaben bei LEGO abfragen ════════════════════════════════════════════

── Marcos Vorgaben ────────────────────────────────────────────────────────

„Kannst du dies bei den Gutscheinen einbauen, damit dies auf Knopfdruck
 abgefragt und gespeichert werden kann?"

„Bitte auch dafür sorgen dass maximal 1 Request pro 30sek abgesetzt werden
 kann. (über alle Benutzer)"

── Warum die OBERFLÄCHE taktet und nicht der Server ───────────────────────

Die Grenze selbst steht auf dem Server (src/gutscheine/gutscheinGuthabenSchranke.ts)
und gilt dort für alle Benutzer und alle Arbeitsprozesse — hier wird sie
nicht nachgebaut, sondern BEFOLGT: Kommt 429 mit `wartenSek`, wartet diese
Schleife die Zeit ab und fragt dieselbe Karte erneut.

Eine Sammelroute auf dem Server hätte dieselbe Wartezeit innerhalb EINER
HTTP-Anfrage absitzen müssen — bei fünf Karten über zwei Minuten mit offener
Verbindung. Die Begründung steht ausführlich an der Route.

Und deshalb zählt der Fortschritt mit: Wer „alle abfragen" drückt, wartet
Minuten, und ein Knopf, der nur ausgegraut ist, sagt ihm nicht, ob noch
etwas passiert.
```
