# Begründungen zu `test/noppe-design.test.js`

Die ausführlichen Kommentare aus `test/noppe-design.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="die-deckelfarben-stehen-in-beiden-oberfl"></a>
## `test('die Deckelfarben stehen in beiden Oberflaechen aus DERSELBEN Que`

```text
Das Design "noppe" — der Klemmbaustein als Bauteil der Oberflaeche.

── Warum diese Pruefung eigen ist ─────────────────────────────────────────

Marcos Vorgabe zu diesem Projekt steht ueber allem: zwei Apps, dieselben
Funktionen, EINHEITLICHE Ansichten. Bei den bisherigen Designs traegt
shared/design-tokens.json die Farben, und design-abschrift.test.js haelt die
beiden erzeugten Dateien daran fest.

"noppe" bringt zwei Dinge mit, die es vorher nicht gab und die genau
deshalb auseinanderlaufen koennen:

  • sechs DECKELFARBEN, die die Kachelwand durchzaehlt, und
  • eine TINTE, auf der Rahmen, Schatten und Text gemeinsam stehen.

Beides sind Listen bzw. ein Ton, die man in jeder Oberflaeche „mal eben"
hinschreiben koennte. Genau das soll hier auffallen.
```

<a id="webtakt"></a>
## `const webTakt = new Set([...css.matchAll(/nth-child\(6n\+?(\d*)\)/g)].`

```text
Modulo sechs, und zwar an derselben Zahl: Laeuft das Web durch sechs und
die App durch vier, zeigt dasselbe Set auf Telefon und Rechner einen
anderen Deckel — und niemand kaeme auf die Idee, das fuer einen Fehler zu
halten, weil die Farbe ja nichts bedeutet.
Die UNTERSCHIEDLICHEN Positionen zaehlen, nicht die Treffer: Seit
"hochglanz" nennt jede Regel in noppe.css zwei Designs, und damit steht
jedes nth-child zweimal da. Ein Zaehlen der Treffer haette das gemeldet,
obwohl sich am Takt nichts geaendert hat — genau der Fehlalarm, gegen den
CatalogUsesLocalImagesTest eine Runde vorher geschaerft wurde.
```

<a id="hochglanz-erbt-die-palette-statt-sie-abz"></a>
## `test('hochglanz erbt die Palette, statt sie abzuschreiben', () => {`

```text
────────────────────────────────────────────────────────────────────────────
"hochglanz" — dasselbe Design in einem anderen Material (Nachtrag 162)

Marcos Wunsch: „so wie eine hochglanzproschuerr". Es ist NICHT ein sechstes
Design neben "noppe", sondern "noppe" mit Lack: dieselbe Anatomie, dieselbe
Palette, dazu Schichten, die kein Farbwert sind.

Genau daran kann es scheitern: Ein zweites Stylesheet mit denselben achtzig
Zeilen, eine zweite Farbtabelle, ein zweiter Deckel-Baustein — und beim
naechsten Nachbessern zieht eine Haelfte nicht mit. Dagegen sind diese
Pruefungen gebaut.
────────────────────────────────────────────────────────────────────────────
```

<a id="stelle"></a>
## `/** Die beiden Regeln, die eine Noppenreihe zeichnen. */`

```text
────────────────────────────────────────────────────────────────────────────
Die Form der Noppe (Nachtrag 163)

Marco: „Die Noppen sehen noch komisch aus." Sie waren ein
repeating-linear-gradient — ein Verlauf kennt keine runden Ecken, und das
`border-radius` daneben rundete den BALKEN statt der einzelnen Noppe. In der
laufenden App standen deshalb scharfkantige Striche, obwohl im Entwurf
Noppen mit runder Oberkante stehen.

Der Ersatz ist eine Maske: Sie traegt die FORM, der Hintergrund die FARBE.
Damit bleibt die Farbe in den Token — und die Form an genau einer Stelle.
────────────────────────────────────────────────────────────────────────────
```

<a id="maskentakte"></a>
## `const maskenTakte = [...css.matchAll(/\bmask-size:(\d+)px \d+px/g)].ma`

```text
── Die Stelle, an der es still falsch wird ──────────────────────────────

hochglanz.css legt je Noppe einen radialen Verlauf darueber. Der
wiederholt sich ueber `background-size`, die Form ueber `mask-size` in
noppe.css. Das sind ZWEI Zahlen fuer denselben Takt: Laufen sie
auseinander, wandert der Lichtpunkt von Noppe zu Noppe aus der Mitte —
und im Quelltext sieht jede der beiden Zahlen fuer sich richtig aus.
```

<a id="farbregeln"></a>
## `const farbregeln = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}')`

```text
── Der Fehler, den diese Zusicherung verhindert (Nachtrag 165) ───────────

Marco: „In der Android App ist der Glanz zu stark. In der Webapp ist
dieser gar nicht sichtbar." Der zweite Teil war woertlich wahr, und der
Grund stand zwei Zeilen weiter oben in dieser Datei:

  `background:var(--stein-1)`   — die KURZFORM

Die Kurzform setzt alle Hintergrund-Eigenschaften zurueck,
`background-image` eingeschlossen. Und `:nth-child()` zaehlt wie eine
Klasse: Die Farbregeln sind damit eine Stufe spezifischer als die
Glanzschicht in hochglanz.css. GEMESSEN im Browser stand bei fuenf von
sechs Kacheln `background-image: none` am Deckel.

Die Pruefung „beide Oberflaechen bauen den Glanz aus denselben
Haltepunkten" war dabei die ganze Zeit gruen: Sie vergleicht die ZAHLEN im
Quelltext und nicht, ob der Verlauf am Ende ankommt. Genau diese Luecke
schliesst die Regel hier.
Kommentare zuerst weg: Der Kopf dieser Datei ERKLAERT die Deckelfarben und
nennt --stein-0 dabei im Fliesstext. Ohne diesen Schritt zaehlte die
Selbstpruefung sieben statt sechs — gemerkt, weil sie angeschlagen hat.
```

<a id="stein"></a>
## `const stein = fs.readFileSync(path.join(BAUM, 'Web-App', 'public', 'th`

```text
────────────────────────────────────────────────────────────────────────────
Die Steinkante — EIN Satz Masse fuer beide Oberflaechen (Nachtrag 166)

Marco: „Kannst du beim Design Stein (Blau) die Kante noch so anpassen, dass
es mehr nach Lego aussieht? Aktuell sieht man einfach oberhalb einen blauen
Balken mit Punkten. […] In der Android-App sieht es ebenfalls nicht gleich
aus. Es soll in beiden Apps gleich aussehen."

Beides stimmte: Das Web zeichnete flache KREISE aus einem radialen Verlauf
ueber die ganze Breite, die App vier abgerundete Noppen links. Zwei
Oberflaechen, zwei Formen, zwei Zahlenreihen — und nichts, was sie
aneinander gebunden haette.
────────────────────────────────────────────────────────────────────────────
```
