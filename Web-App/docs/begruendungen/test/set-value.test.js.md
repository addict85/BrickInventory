# Begründungen zu `test/set-value.test.js`

Die ausführlichen Kommentare aus `test/set-value.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Marktwert eines Sets je Zustand (src/finanzen/setValue.ts).

Gemeldet an 10290-1: angezeigt CHF 92.68, obwohl das Set nur eine
Neu-Erfassung hat und BrickLink für Neu einen Avg Price von US$ 148.72
ausweist. Drei Ursachen, alle in dieselbe Richtung wirkend:

  1. Die Auswahl aus price_cache sortierte nach
     `(hat einen Preis) DESC, (Zustand passt) DESC` — also gewann ein
     vorhandener Gebraucht-Preis über den angefragten Neu-Zustand.
  2. Überall wurde `qty_avg_price || avg_price` benutzt. qty_avg_price ist
     der mengengewichtete Schnitt und liegt unter BrickLinks "Avg Price".
     Dazu ist `"0.00"` aus Postgres truthy und verdeckte einen gültigen
     avg_price.
  3. getPriceGuide() hatte 'U' als Vorgabe.

Ausführen: npm test
```

<a id="stelle"></a>
## `});`

```text
Der Abschnitt zu routes/finance.ts ist entfallen: Die Datei gibt es nicht
mehr. Ihr Router trug NULL Routen und war trotzdem unter /api/finance
eingehaengt; die Preisrechnung selbst liegt seit Etappe 5 in
src/finanzen/financeCalc.ts. Die Regel „Set-Preise ueber avg_price" wird deshalb
dort geprueft, wo die Abfragen heute stehen — utils/ und routes/api_v1/,
siehe die Pruefung „KEINE Abfrage stellt mehr …" weiter unten.
```

<a id="job-stelle"></a>
## `const job = fs.readFileSync(path.join(ROOT, 'jobs/priceJob.ts'), 'utf8`

```text
Seit der zustandsabhängigen Bewertung braucht ein Set mit einem neuen UND
einem gebrauchten Exemplar beide Preise im Cache. Vorher holte der Job
immer nur einen Zustand und wich nur bei komplett fehlendem Preis auf den
anderen aus — bei gemischten Sets fehlte damit dauerhaft eine Hälfte.
.ts statt .js: jobs/ ist TypeScript, das .js ist nur noch ein Build-Ergebnis
in dist/ und im Repo nicht mehr vorhanden.
```

<a id="stelle-2"></a>
## `assert.match(bl, /hatPreis/, 'Prüfung auf brauchbaren Preis fehlt');`

```text
Frueher stand hier `/function hasUsablePrice/` — ein Name. Die Pruefung
heisst inzwischen hatPreis() und liegt in src/katalog/bricklinkPreise.ts, weil sie
DIESELBE sein muss wie beim Lesen: Solange der Torwaechter hier weiter war
als der Leser dort, unterblieb der Rueckfall auf 'stock' fuer genau die
Artikel, fuer die er gebaut wurde (siehe test/preisregel-db.test.js).
Geprueft wird deshalb die Herkunft der Regel, nicht ihr Name.
```

<a id="src-stelle"></a>
## `const src = require('./helpers/sources').adminQuelle();`

```text
── Marcos Konsole (Nachtrag 109) ─────────────────────────────────────────
    [promise] TypeError: Cannot read properties of null (reading 'minifigs')

Als [promise] gemeldet, also aus einer Fortsetzung. openModal() fragt die
Minifiguren-Zahl nach, NACHDEM der Dialog schon steht. Wer ihn vorher
schliesst (closeModal setzt curSet auf null) oder ein anderes Set öffnet,
lief in diesen Fehler.

Die Prüfung auf das ELEMENT allein genügt nicht: Beim Öffnen eines anderen
Sets gibt es das Element weiterhin — die Zahl landete dann im falschen
Dialog. Verglichen wird deshalb die Setnummer.
```

<a id="server"></a>
## `const server = require('./helpers/sources').serverAll();`

```text
── Marcos Messung ────────────────────────────────────────────────────────
329 % CPU im Container bei 15 MB Netzverkehr. Also keine Warterei auf
fremde Server, sondern Rechnen — und die teuerste Rechnung im Server ist
das Verkleinern von Bildern.

Jimp ist reines JavaScript; auf schwacher Hardware (Raspberry Pi) kostet
ein JPEG spürbar Zeit. Der Server läuft im CLUSTER, die Grenze gilt JE
Arbeitsprozess — bei vier Prozessen also viermal. Vorher: 2 × 4 = acht
gleichzeitige Läufe, dazu eine Warteschlange ohne Ende.

Bis zum Umbau der Katalogliste fiel das nicht auf: Sie zeigte nur, wozu man
sich hingescrollt hatte. Seit dem Fensterladen kommen bei jedem Sprung
hunderte neue Bilder ins Blickfeld.
```

<a id="stelle-3"></a>
## `assert.match(server, /pg_try_advisory_lock\(\$1\)/,`

```text
── Und die Grenze muss für den GANZEN Server gelten ──────────────────────

Marcos Beobachtung: „Es rechnen alle gleichzeitig und beginnen erst, wenn
ich das erste Mal richtig scrolle." Vier Prozesse mal ein Lauf sind immer
noch vier gleichzeitige Verkleinerungen — auf einem Raspberry Pi praktisch
alle Kerne. Eine Grenze im Arbeitsspeicher kann das nicht lösen, weil kein
Prozess von den anderen weiss.
```

<a id="stelle-4"></a>
## `assert.match(server, /const darfErzeugen = req\.query\.gen !== '0'/,`

```text
── Und der Katalog erzeugt gar keine Vorschauen ──────────────────────────

Marcos Frage: „Der Proxy sollte das Bild in Originalgrösse weitergeben und
die Bilder mit einem Job nachladen. Dadurch sollte die Last doch klein
bleiben?" — Das Ausliefern des Originals tut er längst (er wartet NICHT auf
die Verkleinerung). Die Last kam daher, dass er für JEDES neue Bild eine
Verkleinerung anstiess, und der Katalog zeigt rund 25 000 fremde Sets.

Für einen Bestand von ein paar hundert Bildern, die man täglich
wiedersieht, lohnt die Verkleinerung. Für 25 000 Sets, an denen man
vorbeiscrollt, nie.
```

<a id="server-2"></a>
## `const server = require('./helpers/sources').serverAll();`

```text
403 kommt beim CDN auch als Drosselung vor. Es zu merken hiesse, dass
Bilder „teilweise" fehlen, obwohl sie existieren. Diese Aussage gilt
unverändert.

Der WEG hat sich geändert (Nachtrag 98): Der Merker lag im Arbeitsspeicher
EINES Prozesses und verfiel nach 15 Minuten. Der Server läuft im Cluster —
dasselbe fehlende Bild wurde deshalb einmal je Arbeitsprozess geholt, nach
jedem Neustart erneut, und nach 15 Minuten wieder. In den alten
Katalogjahrgängen, wo fast jedes Bild fehlt, war das der Grossteil der
Last. Jetzt steht es in der Datenbank, für alle Prozesse.
```

<a id="uses"></a>
## `const uses = (ph.match(/buildChart\(/g) || []).length;`

```text
Teile- und Minifiguren-Verlauf sind seit hardened-96 ebenfalls in
src/finanzen/priceHistory.ts (die Android-Routen brauchen dieselbe Antwort) — sie
teilen sich dort EINEN Aufbau, deshalb steht buildChart zweimal in der
Datei: einmal für Sets, einmal für beide manuellen Arten.

Die Klammer gehört nicht in die Prüfung: Der Set-Verlauf übergibt seit
Nachtrag 83 eine ZUSAMMENGESTELLTE Liste (nur die Zustände, die im Bestand
liegen) statt eines festen Arrays. Ein Test, der `buildChart([` verlangt,
hätte diese Verbesserung verhindert, ohne etwas Zusätzliches zu sichern.
```
