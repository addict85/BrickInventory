# Begründungen zu `test/dom-ids.test.js`

Die ausführlichen Kommentare aus `test/dom-ids.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
DOM-Konsistenz: Jede statisch per G('...') referenzierte Element-ID aus den
Frontend-Modulen muss in index.html existieren. Genau diese Fehlerklasse
(JS greift auf umbenannte/entfernte IDs zu) fällt sonst erst zur Laufzeit
als stiller TypeError auf.

Geprüft werden die statischen String-Literale G('id') — dynamische Aufrufe
wie G('tab-'+name) werden bewusst ignoriert.
```

<a id="for-stelle"></a>
## `for (const m of src.matchAll(/\.id\s*=\s*'([^']+)'/g)) knownIds.add(m[`

```text
Auch Elemente, die der Code SELBST erzeugt: `el.id = 'name'`.

Der Prüfer kannte bisher nur Auszeichnung — ein `<div id="…">` im Markup
oder in einem Template-String. Der eigene Scrollbalken (Nachtrag 94)
entsteht aber in JavaScript, und zwar aus gutem Grund: app.bundle.js läuft
vor dem Ende des Body, ein dort notiertes Element gäbe es beim Start noch
nicht. Ohne diese Zeile meldete der Prüfer es als fehlend, und man
gewöhnte sich an, ihn zu übergehen.
```

<a id="for-stelle-2"></a>
## `for (const m of src.matchAll(/wertId:\s*'([^']+)'/g)) knownIds.add(m[1`

```text
Und der vierte Weg: Der Ansichts-Baustein setzt die id als OPTION.

    detailZeile(t('detail.purchase_price'), inhalt, { wertId: 'm-acq-summary' })

Genau dieselbe Lage wie beim Scrollbalken eine Zeile darüber: Das Element
entsteht wirklich — 01-bausteine.js schreibt ` id="${o.wertId}"` —, nur
steht das id-Literal nicht mehr an der Aufrufstelle. Ohne diese Zeile
meldete der Prüfer drei Modal-IDs als fehlend, obwohl sie da sind.
```

<a id="for-stelle-3"></a>
## `for (const m of src.matchAll(/lagerortBlock\(\s*'([^']+)'/g)) {`

```text
Und der fuenfte Weg: Der Lagerort-Baustein erzeugt ZWEI Elemente aus
einer Kennung — das Textfeld `id` und die Auswahl `id-sel`
(07-admin.js, lagerortBlock). Seit das Feld ein Auswahlfeld mit
Neuerfassung ist, steht das id-Literal nicht mehr an der Aufrufstelle,
sondern als `id="${id}"` im Baustein. Ohne diese Zeile meldete der
Pruefer m-storage und setitem-storage als fehlend, obwohl beide entstehen.
```

<a id="allowed-missing"></a>
## `const ALLOWED_MISSING = new Set();`

```text
Ausnahmen — und die Liste ist LEER, mit Absicht.

Hier stand `uname`, mit der Begründung „Referenz ist im Code null-geprüft
(if(uel)), das Element wurde aus dem Header entfernt". Der zweite Halbsatz
war falsch: Der Namenszug im Kopf steht sehr wohl noch da, er heisst nur
`ubadge` (index.html). Gesetzt wurde er ausserdem nur ein einziges Mal —
in showApp() beim Anmelden. Wer seinen Benutzernamen änderte, sah bis zum
nächsten Neuladen weiter den alten; die Zeile, die das hätte richten
sollen, schlug ins Leere.

Daran liegt der Reiz dieser Liste: Ein Eintrag hier sieht aus wie eine
Entscheidung und ist doch nur eine Vermutung, sobald niemand mehr
nachsieht. Wer hier etwas einträgt, muss NACHGESEHEN haben, dass es das
Element wirklich nicht mehr gibt — und den Fundort nennen.
```

<a id="src-stelle"></a>
## `const src = ohneKommentare(fs.readFileSync(path.join(PUB, 'js', file),`

```text
ohneKommentare: Gesucht wird nach IDs im CODE. Ein Erklärkommentar, der
beschreibt, welches G('…') hier früher stand und warum es weg ist, ist
keine Verwendung — ohne diesen Schritt meldet der Test eine ID, die
niemand mehr abruft. Dieselbe Falle, gegen die es helpers/sources.js
überhaupt gibt (dort in der Begründung: „der eigene Erklärkommentar
über einer Prüfung enthält den gesuchten Namen").
```

<a id="stelle"></a>
## `const { STANDALONE } = require('../scripts/build-frontend.js');`

```text
── Was diese beiden Tests früher prüften ────────────────────────────────
Hier standen zwei Prüfungen auf doppelte Top-Level-Deklarationen über die
Dateigrenzen hinweg. Sie waren nötig, weil alle Dateien sich EINEN globalen
Gültigkeitsbereich teilten: Ein zweites `const X` in einer anderen Datei
brach die betroffene Datei komplett ab ("Identifier has already been
declared"), und dann war keine ihrer Funktionen mehr definiert.

Mit ES-Modulen kann das nicht mehr passieren — jede Datei hat ihren eigenen
Bereich, gleichnamige Deklarationen sind unabhängig voneinander. esbuild
meldet eine echte Doppeldeklaration INNERHALB einer Datei beim Bauen als
harten Fehler (genau so ist die doppelte closeAcqModal() in 07-admin.js
aufgefallen, die vorher jahrelang als toter Code danebenlag).

Was dafür neu abgesichert werden muss: dass jede Datei überhaupt im
Modulgraphen hängt. Eine nicht importierte Datei würde stillschweigend nie
ausgeliefert.
```
