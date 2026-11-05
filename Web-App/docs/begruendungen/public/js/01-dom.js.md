# Begründungen zu `public/js/01-dom.js`

Die ausführlichen Kommentare aus `public/js/01-dom.js` (bis zur Teilung in `public/js/01-core.js`), wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="diese-helfer-werden-von-anderen-modulen"></a>
## Diese Helfer werden von anderen Modulen bei DEREN Top-Level-Auswertung

```text
── UTILS ──────────────────────────────────────────────
── Warum function statt const-Pfeilfunktion ────────────────────────────────
Diese Helfer werden von anderen Modulen bei DEREN Top-Level-Auswertung
benutzt (z. B. G('parts-search').addEventListener(…) in 03-parts.js). Bei
gegenseitigen Importen wertet JavaScript das importierte Modul zuerst aus —
eine `const`-Pfeilfunktion aus 01-core.js liegt dann noch in der temporalen
Todeszone und wirft "G is not a function". Funktionsdeklarationen sind
dagegen schon beim Instanziieren initialisiert und sofort erreichbar.
```

<a id="knopfbesetzt"></a>
## `knopfBesetzt`

```text
Einen Knopf für die Dauer eines Aufrufs sperren.

── Der Befund ───────────────────────────────────────────────

Fünf Stellen taten dasselbe: sperren, „läuft"-Text setzen, danach freigeben
und die Beschriftung ZURÜCKSCHREIBEN. Und alle fünf schrieben sie als
deutsches Literal zurück:

    btn.textContent = 'Registrieren'    // im HTML: data-i18n="register.submit"

Zwei Folgen, beide unbemerkt: In einer englischen Oberfläche stand nach dem
ersten Klick ein deutsches Wort auf dem Knopf. Und das Literal stimmte nicht
einmal mit dem Wörterbuch überein — `register.submit` heisst „Konto
erstellen", nicht „Registrieren"; der Knopf beschriftete sich also selbst
bei deutscher Oberfläche um.

Die Beschriftung wird deshalb nicht mehr NEU GESETZT, sondern GEMERKT. Damit
gibt es keine zweite Fassung, die auseinanderlaufen kann — und der Helfer
braucht keine Sprache zu kennen.

Die BESCHRIFTUNG BLEIBT STEHEN. Frueher tauschte der Helfer sie gegen
Auslassungspunkte; Marco am 22.09.: „Wenn ich Bereits vorhandene Teile
eintragen klicke verschwindet der Button nach wie vor kurz und man sieht
ganz kurz Punkt." Genau das war es — der Knopf sah fuer zwei
Zehntelsekunden leer aus. Dass er arbeitet, zeigen jetzt drei Dinge, die
die Breite nicht anfassen: Er ist gesperrt (.btn:disabled blendet ihn ab),
der Zeiger wird zu „progress", und ueber die Unterkante laeuft ein
schmaler Streifen (.besetzt in styles.css). Die App macht es seit demselben
Tag genauso — dort wird nur das Symbol zum Kreisel, die Beschriftung bleibt
(PartsListScreen.kt).

Sprachfrei bleibt es damit erst recht: Es kommt gar kein Wort hinzu.
```

<a id="breite"></a>
## `breite`

```text
Die Breite einfrieren, BEVOR sich etwas aendern kann.

Ohne das riss der Knopf die ganze Zeile mit: Auslassungspunkte sind rund
200 px schmaler als „Bereits vorhandene Teile eintragen", und in einer
flex-Zeile rutscht dann alles rechts daneben nach. Gemessen an Marcos
Video vom 22.09.: sieben Bilder bei 30 B/s, gut 0,2 s.

Seit die Beschriftung stehen bleibt, greift das nur noch im Fall mit
eigenem Wartetext. Es steht trotzdem hier und nicht dort, weil die Regel
fuer BEIDE Wege dieselbe ist.

offsetWidth ist die Aussenbreite inklusive Rahmen und Innenabstand; 0
heisst „wird gerade nicht angezeigt" (display:none, oder jsdom ohne
Layout) — da gibt es nichts einzufrieren.
```

<a id="xml-icon-svg"></a>
## `XML_ICON_SVG`

```text
Symbol für die BrickLink-Wanted-Listen-Knöpfe: ein XML-Dokument.

── Warum dieses Bild (Marcos Wunsch vom 20.10.) ────────────────────────────

„Kannst du das Icon der Bricklink xml-Buttons ersetzen durch ein sprechendes
 Icon für Bricklink oder xml?"

Dort stand ein Ziegelstein (🧱) — dasselbe Zeichen, das in diesem Baum für
Teile, Sets und die Marke steht; es sagte über diesen Knopf nichts.

Gezeichnet ist jetzt, was der Knopf TUT: eine Datei mit Eselsohr und den
spitzen Klammern `<` `>` darin. Das ist das übliche Bild für eine
XML-Datei und braucht keine Erklärung.

BEWUSST NICHT das BrickLink-Logo: Es ist eine fremde Marke. Dass die Liste
von dort kommt, sagt die Beschriftung daneben („BL-XML") und der Titel des
Knopfes — ein nachgezeichnetes Logo wäre eine Anmassung, die dieser Baum
nirgends sonst begeht.

Form und Bauart wie beim Papierkorb darunter: 24er-Raster, `currentColor`,
`aria-hidden` (die Beschriftung steht daneben, das Symbol ist Zierde).
```
