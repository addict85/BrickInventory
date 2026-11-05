# Begründungen zu `test/kopfleiste-lesbar.test.js`

Die ausführlichen Kommentare aus `test/kopfleiste-lesbar.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="ohnekommentare"></a>
## `const ohneKommentare = css => css.replace(/\/\*[\s\S]*?\*\//g, '');`

```text
Was in der Kopfleiste steht, muss auf ihr lesbar sein.

── Der Befund ──────────────────────────────────────────────────────────────

Marco: „Die Zahlen oben rechts sind im neuen Design nicht wirklich lesbar."
Im Browser GEMESSEN war es schlimmer als „nicht wirklich":

    Zahlen (466, 280,5k …)   Kontrast 1.00
    „Manager" im Titel       Kontrast 1.00
    Beschriftungen (SETS …)  Kontrast 1.22

1.00 heisst: exakt dieselbe Farbe wie der Untergrund. styles.css faerbt die
Kennzahlen mit `var(--b600)`, weil die Kopfleiste dort WEISS ist. Das
Steindesign streicht die Kopfleiste mit genau diesem --b600 — und schreibt
rot auf rot.

── Warum die Regel der KONTRAST ist und nicht „ueberschreiben" ─────────────

Die naheliegende Fassung waere: „Wer die Kopfleiste streicht, muss auch die
Texte darin neu faerben." Die waere falsch. themes/werkbank.css streicht die
Kopfleiste dunkel und faerbt NICHTS davon um — dort ist --b600 ein helles
Blau und --mut ein helles Grau, beides GEMESSEN ueber 5.0. Ein Zwang zum
Ueberschreiben haette ein funktionierendes Design gemeldet.

Genau derselbe Irrtum ist dieser Sitzung eine Runde vorher bei
design-haftung.test.js unterlaufen (dort brick.css). Deshalb hier gleich
die Eigenschaft, um die es geht.

── Woher die Liste der Stellen kommt ───────────────────────────────────────

Nicht von Hand: aus index.html. Gesucht sind Klassen, die AUSSCHLIESSLICH im
<header> vorkommen; Regeln in styles.css, die eine solche Klasse nennen, eine
Textfarbe setzen und KEINEN eigenen Hintergrund haben, erben den Grund der
Kopfleiste. GEMESSEN sind das genau drei — und genau die drei waren rot.
Kommt eine vierte dazu, ist sie automatisch mitgeprueft.
```

<a id="kopfstellen"></a>
## `Kopf der Datei`

```text
Stellen in der Kopfleiste mit ihrer Textfarbe — und mit dem Grund, auf dem
sie steht.

Zwei Arten, und BEIDE zaehlen:

  erbt  — kein eigener Hintergrund, steht also auf der Kopfleiste
          (.logo h1 span, .hs .v, .hs .l)
  eigen — bringt seinen Grund mit (.ubadge, .abadge)

Die erste Fassung liess die zweite Art weg, weil der gemeldete Fehler in der
ersten lag. Das war zu eng: Die Admin-Plakette stand GEMESSEN bei 1.93:1 —
bernsteinfarben auf bernstein —, direkt neben den Kennzahlen, und diese
Pruefung sah daran vorbei. Eine eigene Flaeche schuetzt nicht vor zu
schwachem Text; sie verschiebt nur, wogegen man misst.
```

<a id="lies"></a>
## `const lies = (css, nurBlock) => {`

```text
ALLE Bloecke des Designs, in Reihenfolge — und der spaetere gewinnt.

Die erste Fassung nahm den ERSTEN Fund und liess ihn stehen. Bei
"hochglanz" griff damit ein beliebiger Regelrumpf aus hochglanz.css statt
des Variablenblocks in noppe.css, und --mut loeste anders auf als im
Browser: Die Gegenprobe rechnete 1.06, wo der Browser 1.22 misst. Das
URTEIL war in beiden Faellen dasselbe (viel zu schwach) — die ZAHL aber
falsch, und eine Pruefung, deren Zahlen nicht stimmen, ist als Beleg
nichts wert.

Alle genannten Selektoren haben dieselbe Spezifitaet (0-1-0), damit
entscheidet allein die Reihenfolge.
```

<a id="designs"></a>
## `function designs() {`

```text
Jedes Design mit ALLEM, was fuer es gilt — nicht nur mit seiner eigenen
Datei.

"hochglanz" hat keine eigene Kopfleistenregel: Es ist "noppe" in einem
anderen Material, und die Anatomie steht in themes/noppe.css, deren Regeln
beide Designs nennen. Die erste Fassung las nur die gleichnamige Datei und
hat hochglanz deshalb STILL uebersprungen — ausgerechnet eines der beiden,
um die es hier geht. Aufgefallen ist das erst beim Abgleich mit dem
Browser: Der zeigte dreizehn Zeilen, die Rechnung acht.
```

<a id="eigenschaftfuer"></a>
## `function eigenschaftFuer(css, design, stelle, grundwert, eigenschaft) `

```text
Was gilt fuer `stelle` in diesem Design — die Ueberschreibung oder der Wert
aus styles.css? `eigenschaft` ist `color` oder `background`.

Auch der GRUND muss so gesucht werden, nicht nur die Schrift: themes/brick.css
gibt den Plaketten eigene Flaechen (`rgba(255,255,255,.16)` und
`var(--brick-petrol)`). Die erste Fassung las nur die Schrift nach und mass
sie gegen den Grund aus styles.css — und meldete brick mit 1.29 und 1.11,
obwohl dort weiss auf Petrol steht. Wieder ein Design, das die Sache richtig
macht, und wieder haette die Pruefung es als Fehler ausgegeben.
```

<a id="trifft"></a>
## `const trifft = sels.some(s => {`

```text
`endsWith` und kein Gleichheitszeichen: themes/brick.css schreibt
`header .hstats .hs .v`, die Grundregel `.hs .v`. Ein Vergleich auf
Gleichheit hat brick deshalb als ungefaerbt gelesen und ein Design
gemeldet, das die Sache laengst richtig macht — dieselbe Falle wie bei
design-haftung.test.js, hier von der Gegenprobe gefangen. Mehr Vorfahren
heisst hoehere Spezifitaet, die Regel gewinnt also wirklich.
```

<a id="stelle"></a>
## `assert.equal(stellen.length, 5,`

```text
Selbstbeweis: GEMESSEN sind es sechs — .logo h1 span, .hs .v und .hs .l
auf der Leiste, dazu .ubadge, .abadge und .umenu-item auf eigenem Grund.
Findet die Ableitung nichts, waere die Schleife darunter still gruen.

Von fuenf auf sechs am 16.10.: Das Menue hinter dem Benutzernamen
(Marcos Vorgabe) steht im <header> und faellt damit in die Ableitung. Es
liegt aber auf der Klappe und nicht auf dem Streifen — deshalb traegt
`.umenu-item` in styles.css ausdruecklich seinen eigenen Grund, und die
Pruefung misst die richtige Paarung.

Von sechs auf SIEBEN am 17.10.: „Abmelden" ist aus der Kopfleiste in die
Menueklappe gezogen (Marcos Vorgabe) und hat dort eine eigene Farbe
bekommen — es beendet die Sitzung, waehrend die sieben Punkte darueber
nur die Sicht wechseln. Eine eigene Farbe heisst: eine eigene Stelle,
die gegen ihren eigenen Grund gemessen werden muss. Deshalb traegt
`.umenu-abmelden` in styles.css ausdruecklich auch einen Hintergrund.

Und von sieben auf SECHS, noch am 17.10.: Die Admin-Plakette ist aus der
Kopfleiste verschwunden. Der Hinweis steht jetzt IM Namen —
„marco.bigolin (Admin)" —, auf Marcos Vorgabe. Damit faellt `.abadge`
aus der Ableitung: Die Klasse steht nicht mehr im <header>.

Die REGEL in styles.css bleibt stehen, und das ist Absicht:
themes/brick.css faerbt `header .abadge` eigens um, und die
Benutzerverwaltung zeigt dieselbe Plakette weiter an.
Und auf FÜNF am 30.10.: Die Kennzahlen (.hs .v, .hs .l) stehen in jedem
Design als Kacheln im Inhalt; dazu kam der Seitenname (.kopf-sicht).
```

<a id="unterlage"></a>
## `const unterlage = /\bumenu-(item|abmelden)\b/.test(stelle)`

```text
Gemessen wird gegen den Grund, auf dem der Text WIRKLICH steht: die
eigene Flaeche, wenn es eine gibt, sonst die Leiste. Eine
halbdurchsichtige eigene Flaeche wird ueber den Grund DARUNTER
gerechnet.

── Und der Grund darunter ist nicht immer die Leiste ──────────────

Bis zum 17.10. wurde IMMER ueber die Leiste gerechnet. Fuer die
Eintraege der Menueklappe ist das falsch: Sie liegen auf der KLAPPE,
und die ist weiss. GEMESSEN an einer Gegenprobe: Faerbt ein Design
`.umenu-abmelden` weiss auf `rgba(255,255,255,.14)`, ergibt das ueber
der blauen Leiste ein helles Blau — weisse Schrift darauf besteht.
In Wahrheit liegt es ueber WEISS, und der Text ist unsichtbar. Genau
diese Fehlerklasse hat Marco dreimal gemeldet, und genau hier ist sie
durchgerutscht.
```

<a id="stelle-2"></a>
## `/**`

```text
── Nachtrag 17.10.: die Lücke, durch die der Fehler gegangen ist ───────────

Marcos Befund, dreimal gemeldet: „Beim Logout-Eintrag fehlt der Text."

Die Ursache war eine Regel in themes/brick.css:

    [data-theme="brick"] header #btn-logout{
      background:rgba(255,255,255,.14);color:#fff;…}

Sie stammte aus der Zeit, als „Abmelden" ein Knopf IN DER KOPFLEISTE war —
weiss auf dem blauen Streifen, richtig so. Seit der Knopf in die WEISSE
Menüklappe gezogen ist, malt sie weisse Schrift auf weissen Grund.
GEMESSEN im echten Browser: `rgb(255,255,255)` auf `rgba(255,255,255,.14)`.

── Warum die Prüfung darüber sie NICHT gefangen hat ────────────────────────

`kopfStellen()` leitet die Textstellen aus den KLASSEN in styles.css ab und
fragt dann jedes Design, ob es sie umfärbt (`eigenschaftFuer`). Eine
Design-Regel, die über eine ID zielt, kommt in dieser Ableitung gar nicht
vor — sie ist für die ganze Maschinerie unsichtbar.

Darum diese Regel: In der Kopfleiste fassen Design-Regeln KLASSEN an, keine
IDs. Das ist keine Stilfrage. Eine Klassenregel wird oben mitgemessen, eine
ID-Regel nicht — und sie wiegt obendrein schwerer als alles, was styles.css
setzen kann. Genau deshalb blieb auch der Rückfallwert
`color:var(--r700,#b91c1c)` wirkungslos: (1,1,1) schlägt (0,1,0).
```

<a id="id-erlaubt"></a>
## `const ID_ERLAUBT = new Set(['#gib-text', '#gib-chevron']);`

```text
IDs, die ein Design faerben DARF — mit Grund, und der Grund ist gemessen.

Beide gehoeren zur Import-Leiste (`#global-import-bar`). NACHGESEHEN in
index.html liegt sie im <header>, aber NICHT in der Menueklappe: Sie sitzt
wirklich auf dem gestrichenen Streifen, und dort ist weisse Schrift richtig.

Sie stehen trotzdem hier und nicht einfach ungeprueft da: Ein Eintrag in
dieser Liste sieht aus wie eine Entscheidung und ist doch nur eine
Vermutung, sobald niemand mehr nachsieht. Wer hier etwas eintraegt, muss
NACHGESEHEN haben, wo das Element wirklich sitzt.

Gemessen bleiben beide damit NICHT — die Ableitung oben sieht keine IDs.
Das ist der Preis dafuer, dass sie als IDs dastehen; er faellt nur deshalb
nicht ins Gewicht, weil ihr Grund derselbe ist wie der der Leiste.
```
