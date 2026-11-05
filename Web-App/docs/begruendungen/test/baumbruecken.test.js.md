# Begründungen zu `test/baumbruecken.test.js`

Die ausführlichen Kommentare aus `test/baumbruecken.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="stelle"></a>
## `/**`

```text
Die Bruecken zwischen den beiden Baeumen duerfen nicht ins Leere zeigen.

── Woher das kommt ─────────────────────────────────────────────────────────
Vier von sechs Sicherheitsbefunden dieser Runde hatten dieselbe Ursache:
eine Regel, die nur EINE der beiden Oberflaechen kannte (der XML-Maskierer
der Merkliste, die Set-Tabelle, der Preisverlauf, die Zeitplan-Werte).

Dagegen tut dieser Baum schon das Richtige: 34 Web-Tests greifen in den
Android-Baum und halten Regeln fuer BEIDE Seiten fest. Was diese Kultur
nicht schuetzt, ist sie selbst — wird eine Kotlin-Datei umbenannt oder
verschoben, zeigt der Pfad im Web-Test ins Leere. Je nach Test heisst das:
ein Absturz mit unklarer Meldung, oder — schlimmer — eine Pruefung, die
nichts mehr findet und deshalb schweigt.

Genau diese Fehlerart hat in dieser Sitzung schon zweimal zugeschlagen
(SelbstUpdateTest mit einer Ebene zu wenig; und beim Bauen DIESER Pruefung
habe ich selbst zweimal die falsche Basis gerechnet und 14 gesunde Pfade
als kaputt gemeldet).

── Was der Test kann und was nicht ─────────────────────────────────────────
Aufgeloest werden `path.join(<basis>, …)`-Aufrufe, deren Segmente alle
Zeichenketten sind. Die Basis wird aus der Datei selbst bestimmt:
`__dirname` ist test/, eine Hilfsvariable wird ueber ihre eigene Definition
aufgeloest — REKURSIV, und das ist der Punkt.

Der erste Entwurf suchte nur Aufrufe, in denen das Wort 'Android-App'
woertlich steht. Die Tests schreiben es aber genau EINMAL:

    const APP = path.join(WURZEL, '..', 'Android-App', …);
    …
    fs.readFileSync(path.join(APP, 'util', 'BrickLinkWunschliste.kt'))

Damit prueft die erste Fassung den BASISORDNER — und der verschwindet fast
nie. Die einzelnen .kt-Dateien verschwinden. Die Gegenprobe hat es gezeigt:
BrickLinkWunschliste.kt umbenannt, und der Test schwieg.

Nicht aufloesbar sind Pfade mit einem VARIABLEN Segment
(`…, 'res', ordner, 'strings.xml'`). Die werden gezaehlt und gemeldet,
nicht stillschweigend uebergangen: Eine Pruefung, die verschweigt, was sie
ausgelassen hat, ist die naechste Luecke.
```

<a id="quelle"></a>
## `const quelle = ohneKommentare(fs.readFileSync(path.join(TESTORDNER, da`

```text
Kommentare raus, BEVOR gemessen wird: Ein Erklaerblock, der einen Pfad
als Beispiel zeigt, ist kein Zugriff. Diese Datei selbst ist der beste
Beleg — ihr eigener Block darueber nennt zwei, und der erste Entwurf
meldete sie prompt als „nicht aufloesbar".

Zeilenweise, weil ein Regex auf /* … */ an Routen wie
'/data/instructions/*' scheitert (der Fund aus test/hsts.test.js).
```

<a id="if-stelle"></a>
## `if (!basen.size && !quelle.includes('Android-App')) continue;`

```text
ZWEI Sorten von Bruecken, und beide werden gebraucht:

 1. die Definition selbst — `path.join(WURZEL, '..', 'Android-App', …)`;
    ihre Basis ist die Webapp, erkennbar am Wort im Ausdruck
 2. jeder spaetere Zugriff darauf — `path.join(APP, 'util', 'X.kt')`;
    dort steht das Wort nicht mehr, und genau DAS sind die Dateien, die
    verschwinden

Der zweite Entwurf hatte 1 durch 2 ERSETZT statt ergaenzt und fand
daraufhin fuenf statt sechzehn. Der Selbstbeweis darunter hat es
gemeldet.
```

<a id="stelle-2"></a>
## `assert.ok(offen.length <= 1,`

```text
GEMESSEN: null offene, sechzehn aufgeloeste. Der einzige Fall (preis-herkunft.test.js mit einem
variablen Ordnernamen) ist ausgeschrieben worden, als diese Pruefung ihn
meldete — der Gewinn an Kuerze war einer, den niemand sieht.

Die Schwelle steht trotzdem auf eins statt null: Es kann einen Pfad geben,
der sich nur berechnen laesst. Einer faellt auf und wird begruendet; beim
zweiten faengt eine Gewohnheit an.
```
