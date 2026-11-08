# Begründungen zu `test/set-condition-aggregate.test.js`

Die ausführlichen Kommentare aus `test/set-condition-aggregate.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Zustands-Aggregat eines Sets.

Fehlerbild: Ändert man im Kaufpreis-Dialog den Zustand von "neu" auf
"gebraucht" und verlässt den Dialog, zeigt die Galerie-Kachel weiter "neu" —
erst ein Neuladen der Liste korrigiert es. Ursache waren zwei Dinge:

  1. Die Android-App aktualisierte nach dem Schreiben nur _setDetailState,
     nie die Liste in _state.sets.
  2. Die Webapp hatte zwar eine lokale Aktualisierung, benutzte aber die
     falsche Regel: sie nahm die Bedingung der ZULETZT erfassten Position.
     Der Server sagt dagegen "sobald EINE Erfassung U ist, gilt das Set als
     gebraucht". Bei der Reihenfolge [U, N] widersprachen sich beide.

Die Regel liegt jetzt einmal in utils/handlers.ts und wird von den
Schreib-Endpunkten mitgeliefert. Dieser Test hält sie fest und stellt sicher,
dass die Clients sie nicht wieder nachbauen.
```

<a id="inlinerules"></a>
## `const inlineRules = [...code.matchAll(/\b\w+ > 0 \? 'U'/g)];`

```text
Der Anker nennt bewusst KEINEN Variablennamen: Er hiess frueher
`usedCount`, und als das Typisieren daraus ein normalisiertes `used`
machte, fand das alte Muster nichts mehr — der Test meldete 0 statt 1.
Gemeint ist die REGEL, nicht ihre Schreibweise. So gefasst faengt er
ausserdem eine Ausformulierung unter anderem Namen, die er vorher
durchgelassen haette.
```

<a id="src-stelle"></a>
## `const src = fs.readFileSync(path.join(ROOT, 'src/finanzen/marketPrice.`

```text
Zwei Lücken: Der Marktpreis wurde ohne Zustand geholt (also der Neupreis,
auch bei „Gebraucht"), und es entstand gar keine Zeile in
part_acquisitions — der Kaufpreis stand nur in der Stammtabelle, während
Detailansicht und Zustandsregel mit den Erfassungen arbeiten.
── Zwei Dateien, ein Korpus ─────────────────────────────────────────────
Seit dem Schichtumbau steht die DEFINITION von getCurrentPartMarketPrice in
src/finanzen/marketPrice.ts, waehrend die AUFRUFER in routes/parts.ts geblieben
sind. Die Regel „jeder Aufruf traegt den Zustand" gilt fuer die Aufrufer —
sie muss also ueber beide Dateien gehen. Nur eine zu lesen hiesse, die
Haelfte der Aufrufstellen nicht anzusehen.
```

<a id="ohnezustand"></a>
## `const ohneZustand = [...src.matchAll(/getCurrentPartMarketPrice\(([^)]`

```text
Der Zustand muss in die Preisermittlung — sonst kommt der Neupreis, auch
bei „Gebraucht".

Geprüft wird das an JEDEM Aufruf, nicht an einer Fundstelle in
addManualPart. Die Zusicherung stand hier wörtlich als
`getCurrentPartMarketPrice(part_number, color_id, uid, condition)` und
wurde rot, als die Rechnung in resolveManualPartPurchase zusammenzog —
obwohl der Zustand dort sehr wohl mitgeht. Eine Regel, die an einem Ort
festgeschrieben ist, meldet den Umzug als Fehler und verpasst dafür die
vier anderen Aufrufer.
```

<a id="stelle"></a>
## `assert.match(fn, /price: erfassungsPreis/,`

```text
── Die Regel, nicht ihre Schreibweise (Nachtrag 139) ──────────────────

Hier stand die Umrechnung wörtlich: `effectivePurchasePrice > 0 ? … : null`.
Sie ist inzwischen dorthin gewandert, wo der Preis entsteht
(src/finanzen/preisRegel.ts liefert `erfassungsPreis` fertig), und der Test wurde
rot, obwohl die Regel weiter gilt — genau der Fehler, den der Absatz über
getCurrentPartMarketPrice zwanzig Zeilen weiter oben schon einmal
beschreibt. Zweimal dieselbe Lehre in einer Datei.

Geprüft wird deshalb beides: dass die Erfassung den Wert nimmt, der bei
unbekanntem Preis NULL ist, und dass dieser Wert die Regel wirklich
enthält. Ohne das zweite genügte ein Feld dieses Namens.
```

<a id="src-stelle-2"></a>
## `const src = fs.readFileSync(path.join(ROOT, 'src/finanzen/marketPrice.`

```text
Gemeldet: Im Detail-Dialog einer Minifigur OHNE BrickLink-Nummer standen
bei Marktpreis (Neu) und (Gebraucht) nur Striche, der Verlauf blieb leer —
obwohl Kaufpreise in beiden Zuständen erfasst waren.

Marktpreis-Zeile und Diagramm lesen minifig_price_cache bzw.
minifig_price_history (src/finanzen/priceHistory.ts). Ein echter BrickLink-Abruf
schreibt beide (fetchMinifigPrice); der Schätzpfad rechnete nur und legte
nichts ab — für genau diese Figuren blieb dort für immer alles leer.
Zwei Dateien, ein Korpus — dieselbe Begruendung wie weiter oben: Die
Schaetzung steht seit dem Schichtumbau in src/finanzen/marketPrice.ts, der
Erfassungsweg (recordAcquisitionForDay) ist in der Route geblieben.
```

<a id="stelle-2"></a>
## `assert.doesNotMatch(job.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]`

```text
── Hier stand eine Regel auf die Spiegelung ────────────────────────────

„Ein gepflegter Set-Preis darf nicht überschrieben werden":
`UPDATE sets SET purchase_price=$1 … AND purchase_price IS NULL`. Die
Vorsicht war nötig, weil der Preis an ZWEI Orten stand und der Nachtrag
den gepflegten hätte überschreiben können. Mit Migration 0032 gibt es nur
noch einen — die Frage stellt sich nicht mehr.

Die Nachfolgeregel ist die strengere: Der Job darf die sets-Zeile gar
nicht mehr anfassen. Eine Spiegelung dorthin wäre ab jetzt ein Schreiben
auf eine Spalte, die es nicht gibt.
```

<a id="job-stelle"></a>
## `const job = fs.readFileSync(path.join(ROOT, 'jobs/priceJob.ts'), 'utf8`

```text
Beim Anlegen eines neuen Sets existiert weder die sets- noch die
set_acquisitions-Zeile schon. conditionsNeededFor() fand daher nichts und
fiel auf 'N' zurück — ein als „Gebraucht" importiertes Set bekam den
Neupreis als Kaufpreis, weil die anschliessende Preisabfrage für 'U' noch
nichts im Cache fand und auf den gerade gecachten Neupreis auswich.
Gemeldeter Fall: CSV-Zeile "10214-1,1,,U,01.08.2026" (kein Preis, Zustand
U) bekam CHF 216.24 (den Neupreis) statt CHF 135.11 (Gebraucht).
```

<a id="src-stelle-4"></a>
## `const src = fs.readFileSync(path.join(ROOT, 'routes/api_v1/sets.ts'), `

```text
Gemeldet: Kaufpreis und Marktpreis stimmen überein (0.0% Entwicklung),
der Graph zeigt trotzdem einen Abfall am selben Tag. Ursache:
`const condition = DEFAULT_PRICE_CONDITION` — fest 'U', unabhängig vom
tatsächlichen Zustand des Sets. Für ein als „Neu" geführtes Set bevorzugte
die Graph-Abfrage trotzdem den Gebraucht-Preis, sobald beide Zustände am
selben Tag im Verlauf standen — der injizierte Kaufpreis-Punkt (Neu,
korrekt) und der Verlaufspunkt (fälschlich Gebraucht) erzeugten einen
Abfall, der real nicht stattfand.
Seit Etappe 5 gibt es die Route nur noch einmal (routes/api_v1/sets.ts);
die Webapp ruft dieselbe auf. Die Aussage bleibt: Die Route löst den
Zustand NICHT selbst auf, sondern überlässt das dem gemeinsamen Helfer —
genau das war das Ziel, vorher hatte jede Route ihre eigene Auflösung.
```

<a id="stelle-4"></a>
## `assert.match(helper, /import \{[^}]*\bresolveSetCondition\b[^}]*\} fro`

```text
UMFORMULIERT in Nachtrag 143: Geprüft wurde die Importzeile WÖRTLICH.
Seit dem Fix für die BrickLink-Schlüssel holt priceHistory.ts aus derselben
Datei zwei weitere Namen — die Zeile lautet jetzt
    import { resolveSetCondition, resolveBlColorId, resolveBlPartNumber } …
und die Prüfung wurde rot, ohne dass sich ihre Aussage geändert hätte.
Es zählt, DASS der gemeinsame Helfer von dort kommt.
```

<a id="server"></a>
## `const server = require('./helpers/sources').serverAll();`

```text
Gemeldet: mehrere völlig unterschiedliche Set-Nummern liefen ALLE exakt
bis zur eingestellten Zeitgrenze, ohne je eine Antwort zu bekommen — kein
Fehler, kein TCP-Reset, einfach nichts. Das ist das typische Bild einer
kaputten oder nicht gerouteten IPv6-Verbindung des Hosters: Node versucht
zuerst eine IPv6-Adresse von Cloudflares Edge, der Verbindungsaufbau
dorthin hängt lautlos, und ohne Happy-Eyeballs-Rückfall wird nie auf IPv4
gewechselt, bevor der eigene Timeout zuschlägt.
```

<a id="ohne"></a>
## `const ohne = [];`

```text
Bestätigt per curl auf dem Server selbst: "Immediate connect fail ...
Network is unreachable" für IPv6 — der Server hat GAR KEINE IPv6-Route.
Das betrifft jede ausgehende Verbindung dieses Prozesses, nicht nur
Bilder. Jede Stelle, die roh gegen Rebrickable, BrickLink, Brickset oder
UPCitemdb spricht, braucht denselben `family: 4`.

Diese Prüfung zählte früher je Datei eine feste Anzahl Fundstellen. Das
hat zweimal Aufräumarbeiten rot gemacht, obwohl sich am Verhalten nichts
änderte: Wer eine tote Zweitfassung entfernt, senkt die Zahl. Geprüft wird
deshalb jetzt die REGEL — jeder ausgehende Aufruf trägt family: 4 —
unabhängig davon, wie viele es gerade sind.
Seit src/infra/abruf.ts ruft nur er https.get und (für POST) https.request
(test/umleitungen.test.js); die Regel gilt damit an genau diesen Stellen.
```

<a id="src-stelle-5"></a>
## `const src = require('./helpers/sources').serverAll();`

```text
Gemeldet: manuell erfasste Teile (und dasselbe Muster traf auch auf
Minifiguren zu) bekamen nie eine Vorschau. Ursache: Der stündliche
Hintergrund-Job lud das Bild herunter und aktualisierte image_local,
rief aber nie generateThumb() auf — anders als bei Sets (dieselbe
Datei, "set-img-bg"-Job weiter oben), wo das schon immer korrekt
geschah. Der einmalige Startup-Job ("Generate missing thumbnails")
hätte es irgendwann nachgeholt, aber erst beim NÄCHSTEN Neustart.
```

<a id="stelle-5"></a>
## `assert.match(src, /generateThumb/,`

```text
UMFORMULIERT in Nachtrag 132: Geprüft wurde der WORTLAUT der Zeile
    const { generateThumb } = require('./src/katalog/bilder/thumbs');
Beim Umbau der späten require() auf echte import-Anweisungen wurde daraus
ein Import am Dateikopf — die Prüfung wurde rot, ohne dass sich ihre
Aussage geändert hätte. Es zählt, DASS die Schleife verkleinert, und dass
generateThumb in der Datei überhaupt zu haben ist.
```

<a id="stelle-6"></a>
## `const { buildAndRequire, handlerModul } = require('./helpers/sources')`

```text
═══════════════════════════════════════════════════════════════════════════
Welche Plaketten die Kachel zeigt (hardened-91)
═══════════════════════════════════════════════════════════════════════════
utils/handlers.ts gibt es seit Nachtrag 133 nicht mehr (aufgeteilt nach
utils/handlers/{shared,parts,sets,minifigs,stats}.ts). Der Aufruf blieb hier
stehen und liess die DATEI beim Laden sterben — die zehn Prüfungen unterhalb
dieser Zeile liefen dadurch nie, ohne dass jemand ein rotes Ergebnis sah,
solange in dist/ noch eine alte handlers.js lag. handlerModul() ist genau
dafür da: den GEGENSTAND nennen, nicht den Ablageort.
```

<a id="stelle-7"></a>
## `assert.deepEqual(conditionsFromAcquisitions(0, 0), ['N']);`

```text
Hier stand „ohne Erfassungen zählt der gespeicherte Wert" mit einem
dritten Parameter. Den gibt es seit Migration 0035 nicht mehr: Fuer
manuelle Positionen traegt sie eine Erfassung nach und prueft danach
nach, dass keine ohne geblieben ist; fuer Teile und Figuren aus einem Set
stand die Spalte seit jeher auf dem Vorgabewert.

Ein dritter Parameter wuerde jetzt stillschweigend ignoriert. Deshalb
prueft die Regel oben („die Aggregat-Regel steht nur noch an einer
Stelle") die Parameterliste mit — sonst koennte ein Aufrufer ihn weiter
mitgeben und sich auf eine Wirkung verlassen, die es nicht gibt.
```

<a id="zentral"></a>
## `const zentral = fs.readFileSync(path.join(ROOT, 'src/konto/auth.ts'), `

```text
Webapp und Android-API müssen dieselbe Regel haben — sonst funktioniert
die Anmeldung per E-Mail nur auf einem der beiden Wege.

Hier standen die beiden Login-Dateien beim Namen. Inzwischen liegt die
Prüfung in pruefeAnmeldedaten() (src/konto/auth.ts), die BEIDE aufrufen — der
Test verlangte sie danach an Stellen, an denen sie zu Recht nicht mehr
steht. Geprüft wird jetzt die Regel selbst: Der gemeinsame Prüfer nimmt
beide Formen an, und im Baum steht keine zweite Kopie des Musters, die
gegen einen Anmeldenamen läuft.
```
