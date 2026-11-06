# Begründungen zu `test/catalog-frontend.test.js`

Die ausführlichen Kommentare aus `test/catalog-frontend.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Frontend-Tests für public/js/09-catalog.js in jsdom (devDependency).

── Was sich geändert hat (Nachtrag 90) ─────────────────────────────────────
Dieser Test war ganz um den Von-Bis-Schieber gebaut. Den gibt es nicht mehr:
Marcos Vorgabe war, dass die Jahres-Leiste rechts SPRINGT statt zu filtern,
„analog wie es in der Android-Galerie-Foto-App der Fall ist" — und dass der
Schieber entsprechend entfallen kann.

Damit ändert sich auch das Laden: Kein Endlos-Scroll mehr, der anhängt,
sondern ein Block je Seite über das GANZE Ergebnis; geladen wird der Block,
der ins Bild kommt — vorwärts wie rückwärts. Ohne das könnte ein Sprung
mitten in den Bestand nirgends landen.

Geprüft wird jetzt genau das, plus: Der Jahresfilter über die beiden
Auswahlfelder bleibt (die Leiste ersetzt ihn NICHT), und der Sprung fragt
den Server statt selbst zu rechnen.

Ausführen: npm test   (oder: node --test test/catalog-frontend.test.js)
```

<a id="stripmodulesyntax"></a>
## `function stripModuleSyntax(src) {`

```text
import-/export-Syntax aus einer Moduldatei entfernen.

Diese Tests werten den Quelltext in einer vm-Sandbox bzw. in jsdom als
KLASSISCHES Skript aus. Seit der Umstellung auf ES-Module enthalten die
Dateien import- und export-Anweisungen, die dort einen SyntaxError erzeugen
("Cannot use import statement outside a module"). Die geprüfte Logik ändert
sich dadurch nicht — nur die Modulverpackung muss weg.
```

<a id="registeractions"></a>
## `return 'function registerActions() {}\n'`

```text
registerActions() kommt sonst aus js/00-registry.js und ist nach dem
Entfernen der Importe nicht definiert. In der Sandbox interessiert die
Anmeldung nicht — dass sie aufgerufen WIRD, prüfen test/csp-actions.test.js
und test/bundle-smoke.test.js gegen den echten Quelltext.
tRaw() lebt in i18n.js und wird hier nicht mitgeladen. In der Sandbox
genügt die Weiterleitung an t(): Der Unterschied liegt allein in der
Maskierung der eingesetzten Werte, die diese Tests nicht prüfen.
```

<a id="bausteine"></a>
## `const BAUSTEINE = stripModuleSyntax(fs.readFileSync(path.join(__dirnam`

```text
Die Ansichts-Bausteine kommen MIT in die Sandbox, nicht als Attrappe.

09-catalog.js baut seine Detailzeilen seit dem Zusammenziehen über
detailZeile()/ladeAnzeige() aus 01-bausteine.js. Nach dem Entfernen der
Importe waeren sie undefiniert — der Test scheiterte mit
„ladeAnzeige is not defined", ohne dass am Katalog etwas kaputt war.

Eingesetzt wird der ECHTE Baustein: Dieser Test prueft unter anderem, was
im Katalogfenster steht; mit einer Attrappe pruefte er die Attrappe.
```

<a id="stelle"></a>
## `await sleep(80);`

```text
jsdom rechnet KEIN Layout: getBoundingClientRect() liefert überall Nullen,
also hält _ladeSichtbareSeiten() jeden Block für sichtbar und lädt sofort
alles. Im Browser passiert das nicht — dort haben die Blöcke echte
Koordinaten. Geprüft wird hier deshalb das ERGEBNIS des Nachladens; dass
Platzhalter überhaupt eine Höhe bekommen, prüft die Quelltextregel weiter
unten.
```

<a id="css-stelle"></a>
## `const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styl`

```text
── Der Scrollbalken gehört der ganzen Anwendung ────────────────────────

Marcos Vorgabe: „Der rechte Scrollbalken ist der vom Browser, der durch den
eigenen ersetzt werden soll. Gerne gleich in der ganzen App."

Meine vorige Fassung war ein eigener Scrollkasten NUR im Katalog. Der sass
mitten im Fenster statt am Rand — und schlimmer: Der Beobachter mass gegen
diesen Kasten, weshalb beim Scrollen nach unten nichts nachkam. Jetzt rollt
die Seite, der Balken ist fest am Fensterrand, und der Katalog steuert nur
das Etikett bei.
```

<a id="check"></a>
## `check('Blocklagen kommen aus dem Gedächtnis',`

```text
── Die Last beim Ziehen (Nachtrag 96) ──────────────────────────────────
Zwei Regeln, die zusammen verhindern, dass ein Zug über die ganze Leiste
den Rechner blockiert:

1. Die Lagen der Blöcke werden EINMAL gemessen, nicht bei jedem Bild. Bei
   über vierhundert Blöcken zwingt jede Abfrage den Browser zu einer
   Layout-Neuberechnung — sechzigmal je Sekunde.
```

<a id="check-2"></a>
## `check('Laden wartet auf Ruhe',`

```text
2. Geladen wird erst, wenn das Rollen zur Ruhe kommt. Sonst fordert ein Zug
   über die Leiste hunderte Seiten an, von denen nur die letzte zählt.

   Das hier ist eine Aussage über den TEXT: die Zeile steht da. Dass sie
   auch WIRKT, misst katalog-zug-entprellt.test.js — dort fährt ein
   wirklicher Zug über die Leiste, und die Gegenprobe nimmt genau diese
   Ruhe heraus (2 Abrufe gegen 48). Beide sagen dasselbe, keine
   widerspricht der anderen; wer die Zeile umbenennt, muss dort nachziehen.
```

<a id="kotlin"></a>
## `const kotlin = [];`

```text
── Und dasselbe in der App (Marcos Vorgabe: „die gleiche Leiste") ────────

Die Leiste der Android-App rechnete bis zuletzt LINEAR zwischen yearMin
und yearMax — genau das Modell, das hier oben schon einmal danebenlag.
Die Regel steht deshalb ueber BEIDEN Baeumen: Wer die eine Oberflaeche
wieder auf eine Schaetzung zurueckdreht, faellt hier auf.

Gefunden, nicht aufgezaehlt: Die App-Quellen werden gesucht, und ein
leerer Fund gilt nicht (Selbstnachweis unten).
```
