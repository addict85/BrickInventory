# Nachträge 126–150

Teil der Fix-Historie — Übersicht in [CHANGELOG-fixes.md](../CHANGELOG-fixes.md).

---

## Nachtrag 127 — Aufräumen, Durchgang 3: die Anleitungs-Kette

Vier Funktionen aus `routes/sets.ts` nach `utils/instructions.ts` (221 Zeilen):
`downloadSetInstructions`, `scrapeInstructionsFromFallback`, `collectAndBuildPDF`
und `buildImagePDF_fromBuffers`.

Sie hatten drei Aufrufer ausserhalb, und keiner konnte sie importieren. Der
Brickset-Client holte sie per `require('../routes/sets')` — Kreis
`sets → brickset → sets`. Die Anleitungs-Warteschlange ging weiter:

    let fetchInstructions;
    try { fetchInstructions = require('../routes/sets').fetchInstructions; } catch(_) {}
    if (typeof fetchInstructions !== 'function') { scheduleNext(2000); return; }

Ein try/catch, eine typeof-Prüfung und ein stiller Abbruchpfad — nötig nur,
weil niemand garantieren konnte, dass der Name zur Laufzeit existiert. Genau
dieser Fall ist in Nachtrag 131 zweimal eingetreten. Mit dem echten Import
prüft tsc den Namen; die drei Zeilen entfallen ersatzlos.

Der Aliasname `fetchInstructions`, unter dem der Router die Funktion nach aussen
gab, entfällt ebenfalls — sie heisst überall `downloadSetInstructions`.

### MEIN FEHLER: ein neuer Kreis, diesmal einer, der knallt

`utils/instructions.ts` braucht den Brickset-Client. Der Client holte am Ende
seiner Wiederholungsschlange Bauanleitungen nach. Also:

    instructions → brickset → instructions

Ein spätes `require()` hätte das überlebt — es läuft erst beim Aufruf. Eine
`import`-Anweisung nicht: Zur Ladezeit ist eine der beiden Seiten `undefined`,
und das fällt erst im Betrieb auf. **Beim Umbau von require() auf import wird
aus einem harmlosen Kreis ein Fehler.** Das ist die eigentliche Lehre dieses
Durchgangs.

Aufgelöst, indem `processRetryQueue` als `jobs/bricksetRetry.ts` eigenständig
wurde: Sie ist Ablaufsteuerung (Tabelle lesen, Client rufen, Anleitungen
nachholen), keine API-Anfrage. Beim Herauslösen zuerst nur den Wrapper
erwischt und den inneren `_processRetryQueue` stehen gelassen — tsc hat es
gemeldet.

### Diagnose-Falle

Der erste Suitelauf nach dem Umzug meldete 64 rote Tests bei nur 525 statt 691
gefundenen. Das sah nach dem Kreis aus, war aber die Umgebung: Postgres war
zwischen zwei Läufen gestorben. Genau das Symptom aus der Warnung von Nachtrag
149 — plötzlich ~100 Tests WENIGER und viele rote DB-Tests auf einmal.
`pg_ctl status` zuerst, dann Ursachenforschung.

### Neue Prüfung

`test/module-layout.test.js` um „keine Zyklen über echte import-Anweisungen"
erweitert. Späte `require()` sind bewusst NICHT mitgezählt — sie abzubauen ist
das laufende Vorhaben, zur Ladezeit sind sie ungefährlich. Gegenprobe: meinen
echten Kreis wiederhergestellt → rot.

### Stand

| | Anfang | jetzt |
|---|---|---|
| Zyklen über `import` | — | **0** |
| Zyklen inkl. `require()` | 129 | 31 |
| `routes/sets.ts` | 1674 Z. | **1333 Z.** |
| Export-Anhang von sets.ts | 8 Namen | 3 (`addSet`, `updateSet`, `buildSetsCsv`) |

692 Tests grün gegen echtes Postgres 16.

---
## Nachträge 128–130 (hardened-222) — Aufräumen, Punkte 2 bis 4

### Nachtrag 128 — das Grundschema als .sql

426 Zeilen reines SQL (kein einziges `${…}`) aus `initSchema()` nach
`db/schema.sql`. `db/database.ts` von 1655 auf 824 Zeilen.

In der Funktion blieb alles mit Bedingung: nachträgliche Spalten-Migrationen,
das Anlegen des ersten Verwalters, die pg_trgm-Behandlung (CREATE EXTENSION darf
fehlschlagen) und das Aufräumen alter Token.

ZWEI BEINAHE-AUSFÄLLE:

1. Mein `ladeSchema()` nahm zuerst APP_ROOT. Im Container gibt es die Quellen
   nicht — das Laufzeit-Image enthält nur `dist/`. Richtig ist `__dirname`;
   dass die .sql überhaupt dorthin kommt, besorgt `scripts/build-ts.js`
   (ASSET_EXT). `db/migrate.ts` macht es aus demselben Grund genauso.
2. Das **Dockerfile kopierte `clients/` gar nicht** — aus Nachtrag 126
   mitgeschleppt. Im Container wäre der Server beim ersten Import gescheitert.

Neue Prüfung: Jeder Ordner mit Laufzeit-TypeScript muss in SRC_DIRS UND im
Dockerfile stehen. Reine `.d.ts`-Ordner (types/) sind ausgenommen — das hat mir
der Test selbst beigebracht, indem er beim ersten Lauf darauf ansprang.

### Nachtrag 129 — die Vorschau-Maschinerie des Bild-Proxys

`registerImgProxy()` von 729 auf 665 Zeilen; Warteschlange,
prozessübergreifende Sperre und Verkleinern liegen in `utils/proxyThumbs.ts`.

Dabei fiel eine Globalvariable: Der Fehlerzähler war eine Closure und wurde über
`(global as any).__imgProxyFailures` an die Monitoring-Route gereicht. Mit dem
Aufteilen hätte ihn auch das neue Modul über `global` holen müssen — ein
zweiter ungeprüfter Umweg. Jetzt `utils/imgProxyStats.ts`, ein gewöhnlicher
Import.

EIGENER FEHLER, ZUM DRITTEN MAL DERSELBE: Beim Umbiegen der Testpfade habe ich
`tst0.size < 200` mit auf das neue Modul gezeigt — diese Prüfung gehört zur
AUSLIEFERUNG und ist im Proxy geblieben. Gegenmittel: der Helfer
`proxyThumbQuelle()`. Tests nennen jetzt den GEGENSTAND („der Vorschau-Weg des
Proxys") statt den Ablageort; `serverAll()` umfasst beide Dateien.

### Nachtrag 130 — die zwei Frontend-Grossdateien

`js/01-core.js` (1479 Z.) nannte als Inhalt „Utils, i18n-Glue, Auth & Panels,
Login/Logout, CSV-Import-Fortschrittsbalken" — und enthielt einen kompletten
PDF-Betrachter. `js/07-admin.js` (1492 Z.) nannte „Confirm-Dialog,
Config-Export/Import, API-Tokens, Job-Status" — und enthielt das Kaufpreis-Modal
und das Detailfenster für manuelle Einträge. Beide hiessen nach ihrer
Geschichte, nicht nach ihrem Inhalt.

| neu | Zeilen | aus |
|---|---|---|
| `js/12-pdfviewer.js` | 127 | 01-core.js |
| `js/13-acquisition-modals.js` | 749 | 07-admin.js |

| | vorher | nachher |
|---|---|---|
| 01-core.js | 1479 | 1368 |
| 07-admin.js | 1492 | 775 |

Die Schnittstelle war schmal und schon vorher schmal: Der Modal-Block braucht
drei Helfer aus 07-admin (confirmDelete, renderMarketRows, priceChartSVG) und
gibt einen zurück (renderAcquisitionSummary). Genau das machte den Schnitt
möglich, ohne etwas umzubauen. Die elf Handler der beiden Fenster melden sich
jetzt dort beim Dispatcher an, wo sie umgesetzt werden.

`test/frontend-imports.test.js` fing prompt zwei fehlende Importe („ruft
fullUrl() aus 01-core.js ohne Import") — genau der Zweck dieser Prüfung.

Zwölf weitere Prüfungen lasen `07-admin.js` und meinten „irgendwo in der
Oberfläche rund um Erfassungen". Neuer Helfer `adminQuelle()`, gleiche
Begründung wie bei `proxyThumbQuelle()`.

### Stand

696 Tests grün gegen echtes Postgres 16, 0 übersprungen.

Offen: Punkt 5 (Android-Screens mit 20–26 Parametern auf das
ViewModel-lesende Muster), und aus Punkt 1 weiterhin `addSet`/`updateSet` in
routes/sets.ts.

---
## Nachtrag 131 (hardened-223) — addSet und updateSet, der Abschluss von Punkt 1

Marcos Auftrag: „Kannst du das addSet und updateSet noch abschliessen?"

Die beiden blieben durch die Nachträge 125 bis 127 als einzige in
routes/sets.ts liegen, und der Grund war kein Zufall.

### Warum es nicht ging — und was zuerst musste

`addSet()` ruft `importPartsForSet()` und `importMinifigsForSet()`. Die standen
in routes/parts.ts und routes/minifigs.ts. Ein Modul unter utils/ hätte also
ROUTER importieren müssen — die falsche Richtung: utils/ ist die Schicht, auf
der Routen aufsetzen, nicht umgekehrt. Und ein Kreis über echte
`import`-Anweisungen ist seit Nachtrag 127 als das erkannt, was er ist: ein
Fehler, der zur Ladezeit `undefined` liefert.

Also ging dem Umzug ein Unterbau voraus:

| neu | Zeilen | aus |
|---|---|---|
| `utils/partsImport.ts` | 246 | routes/parts.ts |
| `utils/minifigsImport.ts` | 60 | routes/minifigs.ts |
| `clients/bricklink.ts` | — | routes/bricklink.ts |

`routes/bricklink.ts` hat wie rebrickable und brickset (Nachtrag 126) **null
Routen** und war nie montiert. Aufgefallen ist es erst jetzt, weil
utils/setService.ts von dort `getItemImageUrl()` braucht.

### Der Umzug

`utils/setService.ts` (569 Zeilen): `addSet`, `updateSet`, `buildSetsCsv`,
`recordAcquisition`, `adjustAcquisitionsToQuantity`, `priceForNewAcquisition`,
`recomputeSetCondition`, `sanitizeSetNumber`, `addSetWithDate`.

Das ist Ablaufsteuerung: was passiert, wenn ein Set dazukommt (Bild holen, Teile
und Minifiguren übernehmen, Anleitung einreihen, Preis anstossen) und was, wenn
es sich ändert. Die HTTP-Routen bleiben in routes/sets.ts und rufen von hier.

`routes/sets.ts` ist damit von 1674 (vor Nachtrag 125) auf **813 Zeilen**
geschrumpft, und sein Export-Anhang ist leer: `export = router`.

### MEIN FEHLER — ein echter Laufzeitfehler

Mit `addSet` wanderte diese Zeile wortgleich mit:

    require('./parts').fetchMissingBlIds().catch(() => {});

Aus utils/ gesehen gibt es `./parts` nicht. Der Aufruf steht in einem
`setImmediate(...)`, also wäre der Fehler erst beim Anlegen eines Sets geflogen
— und ausserhalb jedes `.catch()`. Im Test tauchte er nur als „asynchronous
activity after the test ended" auf.

`require-exports.test.js` sieht das NICHT: Es prüft, ob ein Modul den NAMEN
exportiert, nicht ob es das Modul überhaupt gibt. Neu in
`test/module-layout.test.js`: „jedes späte require() zeigt auf eine Datei, die
es gibt". Verwandt mit „kein Modul unter blossem Namen", aber die andere Hälfte
— dort war der Pfad zu kurz, hier zeigt er ins Leere.

Beim Aufräumen sind gleich acht weitere späte `require()` in setService durch
die ohnehin vorhandenen Importe ersetzt worden.

### Neuer Testhelfer

Zwölf Prüfungen lasen `routes/sets.ts` und meinten „irgendwo im Weg, auf dem ein
Set entsteht oder sich ändert". Neu `setKernQuelle()` — dieselbe Begründung wie
bei `proxyThumbQuelle()` und `adminQuelle()`: den GEGENSTAND nennen, nicht den
Ablageort.

### Stand

| | vor Nachtrag 125 | jetzt |
|---|---|---|
| Zyklen über echte `import` | — | **0** |
| Zyklen inkl. `require()` | 129 | 35 |
| späte `require()` in Rümpfen | 247 | 204 |
| `routes/sets.ts` | 1674 | **813** |

Zwei Gegenproben nachgespielt: mein `require('./parts')` wiederhergestellt →
rot; utils importiert wieder einen Router → Zyklusprüfung rot.

697 Tests grün gegen echtes Postgres 16, 0 übersprungen. Damit ist Punkt 1 des
Aufräumens abgeschlossen und alle fünf Punkte sind umgesetzt.

---
## Nachträge 132–134 (hardened-224) — die drei Punkte aus der zweiten Messung

### Nachtrag 132 — späte require() zu echten import

**204 → 88.** Umgewandelt wurde mit einem Werkzeug, das nur anfasst, was ALLE
Bedingungen erfüllt: relativer Pfad, Ziel existiert, Name wird dort wirklich
exportiert, kein Kreis, Name nicht anderweitig belegt. 126 Umwandlungen; 14
bewusst übersprungen (7 Umbenennungen, 5 bereits importiert, 1 echter Kreis, 1
ohne Ankerpunkt).

Und genau darum ging es: `require()` liefert `any`, `import` liefert Typen. Vier
Fehler, die jahrelang verborgen waren, meldete tsc sofort:

**1. `clearSubsetsCache()` — „erwartet 1 Argument, bekam 0".** Der Parameter war
ohne Vorgabe deklariert, obwohl der else-Zweig GENAU den Aufruf ohne Argument
bedient (Verwaltung → „Alle Caches leeren").

**2. `string | string[]` an drei Stellen.** `@types/express@5` typisiert
Routen-Parameter so, und Abfrageparameter SIND es zur Laufzeit:
`?accounts=a&accounts=b` liefert ein Array. Neuer Helfer `einzelwert()` in
utils/validate.ts — bei mehreren Werten gewinnt der erste, weil ein
zusammengefügtes „a,b" eine Setnummer wäre, die es nicht gibt.

**3. `page_size` fehlte an zwei von drei Rückgabewegen von `getParts()`.** Der
Kommentar über der Route erklärt, dass genau dieses Feld dem Client sagt, ob
Teile fehlen — auf der CSV- und der Rebrickable-Ausweichebene stand dort
`undefined`, und die Prüfung „total > page_size" konnte nie greifen.

NEBENBEFUND, nicht behoben: Die Anwendung läuft auf Express 4, hat aber
`@types/express@5`. Die Typen sind strenger als die Laufzeit — kein akutes
Problem, gehört aber notiert.

### Nachtrag 133 — utils/handlers.ts nach Domänen

1313 Zeilen → `utils/handlers/{shared,parts,sets,minifigs,stats}.ts`. Die
Abhängigkeiten laufen in EINE Richtung (minifigs → sets → parts), es entsteht
kein Kreis. `getStats` spannt über alle drei und steht deshalb allein.

### Nachtrag 134 — die Startstaffel aus server.ts

`startup/backgroundJobs.ts` (168 Zeilen), server.ts von 1174 auf **1043**.

Der Grund ist die STAFFELUNG: Katalogabgleich nach 10 s, Anleitungen nach 15,
Brickset-Wiederholung nach 20, Bilder und Kaufpreis-Nachtrag nach 45. Bewusst
gewählt, aber über hundertdreissig Zeilen verstreut liess sie sich nur
rekonstruieren, indem man jedes `setTimeout` einzeln suchte. Die Bedingung
„nur im Primär-Worker" steht weiterhin an EINER Stelle, im Aufrufer.

Der Test aus Nachtrag 128 („jeder Quellordner kommt auch im Container an")
schlug prompt an: `startup/` fehlte in SRC_DIRS und im Dockerfile. Genau dafür
gibt es ihn — beim Vorgänger clients/ hatte ich denselben Fehler von Hand
gefunden.

### Testarbeit

19 + 5 Tests wurden rot, keiner wegen geänderten Verhaltens. Zwei neue Helfer,
`handlerQuelle()` und `startQuelle()` — die vierte und fünfte Anwendung
desselben Musters: den GEGENSTAND nennen, nicht den Ablageort. `serverOnly()`
bleibt bewusst nur server.ts, für Prüfungen, die „was ist dort GEBLIEBEN"
meinen.

Zwei Tests brauchten mehr als einen neuen Pfad:

- Einer schnitt „von Funktion A bis Funktion B" heraus — nach der Aufteilung
  liegen A und B in verschiedenen Dateien.
- Einer prüfte den WORTLAUT einer require()-Zeile statt ihrer Aussage.

Und einer schlug korrekt an: `require-exports.test.js` bewacht sich selbst mit
„mindestens 100 Namen geprüft, sonst greift mein Muster nicht mehr". Beim Umbau
fiel die Zahl planmässig darunter. Die Schwelle sinkt auf 60 — sie darf nicht
auf 0, sonst wäre der Selbstschutz weg.

### Stand

| | vorher | jetzt |
|---|---|---|
| späte `require()` in Rümpfen | 204 | **88** |
| `utils/handlers.ts` | 1313 | 5 Dateien, max. 509 |
| `server.ts` | 1174 | **1043** |

697 Tests grün gegen echtes Postgres 16, 0 übersprungen.

---
## Nachtrag 135 (hardened-225) — die zwei grossen Funktionen aufgeteilt

Beide standen in der zweiten Messung als „Schönheit ohne Anlass" auf der Liste;
Marco hat sie beauftragt.

### getPortfolioHistory: 449 → 182 Zeilen

| neu | Zeilen | Inhalt |
|---|---|---|
| `utils/portfolio/kurve.ts` | 222 | Rekonstruktion aus dem Preisverlauf JE SET |
| `utils/portfolio/diagrammdaten.ts` | 120 | Wertebereich, Y-Beschriftung, X-Beschriftung, Prozentänderung |

Die Funktion tat drei Dinge nacheinander: entscheiden, in welcher Auflösung
gerechnet wird; die Kurve rekonstruieren; daraus Achsen machen. Nur das dritte
ist reine Rechnung ohne Datenbank — und damit der Teil, den man beim Suchen
nach einem Achsenfehler nicht hinter zweihundert Zeilen SQL-Rekonstruktion
finden sollte.

`fmtX` (X-Beschriftung) zog mit, `downsampled` wurde zum Parameter. Bei der
Kurve blieb `bucketExpr` bewusst ein `let`: Es wird unterwegs umgestellt, wenn
verdichtet wird.

### registerImgProxy: 665 → 596 Zeilen

`utils/imgCacheServe.ts` (120 Zeilen): das Ausliefern aus dem Platten-Cache,
Original wie Verkleinerung.

Der Route-Handler ist ein langer linearer Ablauf — anmelden, Adresse prüfen,
Host zulassen, Cache-Pfad bauen, ausliefern, sonst beim CDN holen. Der
Cache-Treffer ist davon das am klarsten abgegrenzte Stück und zugleich der
HEISSESTE Pfad: Bei einer Kachelwand läuft praktisch jede Anfrage hier durch
und nirgendwo sonst.

BEINAHE-FEHLER beim Herauslösen: Aus `return res.status(304).end();` wurde beim
mechanischen Umschreiben zunächst ein blosses `res.status(304).end();` — der
Ablauf wäre weitergelaufen und hätte in eine bereits beendete Antwort
geschrieben. Jetzt `{ res.status(304).end(); return true; }`, wobei `true` dem
Aufrufer „beantwortet" meldet.

### Testarbeit

Vier Prüfungen rot, keine wegen geänderten Verhaltens. Neuer Helfer
`portfolioQuelle()` (sechster desselben Musters), `proxyThumbQuelle()` um die
neue Datei erweitert.

Zwei Prüfungen hingen wieder am WORTLAUT statt an der Aussage: eine zählte
`if (req.fresh) return res.status(304).end();` wörtlich, eine schnitt 6000
Zeichen ab `app.get('/api/img-proxy'` heraus — beides zeigte nach dem Umzug ins
Leere. Umformuliert auf „beide Auslieferpfade prüfen req.fresh und antworten
mit 304" bzw. auf die Datei, die der Ausliefer-Pfad jetzt IST.

EIGENE FALLE dabei: Der 304-Test zählte in KOMMENTAREN mit. Mein eigener
Erklärtext („aus `return res.status(304).end();` darf kein blosses … werden")
trieb die Zahl von zwei auf vier. Die Prüfung nimmt jetzt den kommentarfreien
Quelltext, den die Datei ohnehin schon vorhielt.

697 Tests grün gegen echtes Postgres 16, 0 übersprungen.

---
## Nachtrag 136 (hardened-226) — Kontofilter und Scrollbalken aus 01-core.js

Auf Marcos Frage, ob es in der Webapp ähnliche Punkte gibt wie in der
Android-App, war die gemessene Antwort: im Wesentlichen nein. Die längste
Funktion hat 191 Zeilen (`loadFinance`), keine einzige über 200 — bei Android
waren es 526, 482, 339 und 289. Als einziger Kandidat blieb `js/01-core.js` mit
1368 Zeilen.

| neu | Zeilen | Inhalt |
|---|---|---|
| `js/14-scope.js` | 68 | Kontofilter (Haushalt), je Ansicht |
| `js/15-scrollbar.js` | 147 | eigener Scrollbalken |

`01-core.js` von 1368 auf **1167**. Beide Abschnitte gehören zu keinem der
Themen, die die Kopfzeile der Datei nennt („Utils, i18n-Glue, Auth & Panels,
Login/Logout, CSV-Import-Fortschrittsbalken").

Der Kontofilter hängt an KEINEM anderen Modul, nur am localStorage; der
Scrollbalken braucht von aussen einzig `G()`. Das machte beide zu klaren
Schnitten.

### Ein Messfehler auf dem Weg dorthin

Mein Werkzeug für Funktionslängen meldete zuerst `esc` mit 498 Zeilen, dann
`tableRow` mit 493 — beide sind unter 20. Ursache waren Klammern in regulären
Ausdrücken und Zeichenketten, die meine Heuristik falsch behandelte.

Das ist derselbe Fehler wie bei Android, nur andersherum: Dort meldete der
Zähler zu WENIG und verdeckte die 526 Zeilen von SetDetailScreen. Die Zahlen
oben stammen aus einer rohen Zählung ohne Heuristik, gegengeprüft an tableRow.

### Testarbeit

16 Testdateien lasen `public/js/01-core.js`. Neuer Helfer `coreQuelle()` —
siebter desselben Musters.

`app-scrollbar.test.js` brauchte mehr: Er schnitt den Abschnitt an der
Kommentarmarke „═══ Eigener Scrollbalken" aus 01-core.js heraus, weil der Rest
der Datei beim Auswerten an die ganze Oberfläche bindet. Seit dem Umzug IST
js/15-scrollbar.js genau dieser Abschnitt — der Schnitt entfällt, dafür muss
die Importzeile weg (im Test läuft kein Modulsystem).

`frontend-imports.test.js` fing prompt einen fehlenden Import: 01-core.js ruft
`resetScopeModes()` beim Abmelden.

Zwei Gegenproben: Import in 15-scrollbar.js entfernt → rot; 14-scope.js nicht
in main.js eingetragen → das Bauskript bricht mit „Nicht im Modulgraphen" ab.

699 Tests grün gegen echtes Postgres 16, 0 übersprungen.

---
## Nachtrag 137 (hardened-227) — jpeg-exif: die Warnung kam über pdfkit

Marcos Installationslog:

    npm warn deprecated jpeg-exif@1.1.4: Package no longer supported.

`jpeg-exif` steht nirgends in package.json — es kam über **pdfkit 0.15.2**, wo
es der JPEG-Leser war. In pdfkit 0.20.1 ist es ersatzlos entfallen.

    pdfkit ^0.15.0 → ^0.20.1

Danach: keine einzige `deprecated`-Warnung mehr bei `npm ci`, 0 Schwachstellen,
44 Pakete weniger.

### Warum das mehr verlangte als „npm install"

Ein Sprung über fünf Minor-Versionen einer Bibliothek, die PDFs ZEICHNET, ist
nicht dasselbe wie ein Sicherheitsupdate. Die vorhandenen Tests prüfen die
AUFTRAGSVERWALTUNG (pdf-jobs-db) — nicht das Zeichnen. Ein pdfkit, das seine API
stillschweigend ändert, wäre grün durchgelaufen und erst bei Marcos erstem
Export aufgefallen.

Genutzt werden (ermittelt aus routes/api_v1/pdf.ts und utils/instructions.ts):
`addPage`, `circle`, `currentLineHeight`, `end`, `font`, `fontSize`, `image`,
`moveDown`, `moveTo`, `on`, `text` — durchweg Kern-API.

### Neuer Test

`test/pdfkit-render.test.js` mit drei Prüfungen:

1. Der Teilelisten-Export zeichnet ein gültiges PDF (Kopf `%PDF-`, `%%EOF`,
   plausible Grösse) — mit genau dem Methodensatz von oben.
2. Bilder werden eingebettet, JPEG UND PNG. Das ist die Stelle, an der ein
   Bruch am wahrscheinlichsten wäre: jpeg-exif WAR der JPEG-Leser, und
   Bauanleitungen bestehen ausschliesslich aus Bildseiten. Geprüft wird auf
   `/DCTDecode` und `/FlateDecode` im Dokument, nicht nur auf „es kam etwas
   heraus".
3. jpeg-exif ist nicht mehr im Abhängigkeitsbaum. Wandert es über eine andere
   Bibliothek zurück, fällt es auf — die Warnung im Installationslog liest
   niemand zuverlässig.

Zwei Gegenproben: jpeg-exif künstlich in die Lock-Datei eingetragen → Prüfung 3
rot; Erwartung der JPEG-Einbettung verfälscht → Prüfung 2 rot.

699 Tests grün gegen echtes Postgres 16 (+3 neue = 702).

---
## Nachtrag 138 (hardened-228) — ReferenceError: t is not defined

Marcos Browser-Konsole nach dem Klick auf einen Anleitungs-Link:

    Uncaught (in promise) ReferenceError: t is not defined

`js/12-pdfviewer.js` rief `t('pdf.loading')` und `t('pdf.error')` ohne Import.
Beim Herauslösen aus 01-core.js (Nachtrag 130) blieb der Import zurück — dort
war `t` über den Dateikopf verfügbar.

### Warum es so spät auffiel

Der Fehler flog erst beim ÖFFNEN eines PDFs, nicht beim Laden der Seite. Das
Bündeln bemerkt so etwas nicht (esbuild löst nur Modulpfade auf, keine freien
Namen), und die Testsuite fasst den Betrachter nicht an.

### Die eigentliche Lücke: i18n.js war unsichtbar

`test/frontend-imports.test.js` ist genau für diese Fehlerklasse gebaut und war
grün. Grund: Sie liest ausschliesslich `public/js/`. **i18n.js liegt eine Ebene
höher** (`public/i18n.js`) und war damit gar nicht in der Liste — ihre Exporte
galten als „unbekannter Name" und wurden übersprungen.

Betroffen war also nicht nur `t`, sondern jeder i18n-Export: `tRaw`, `locale`,
`applyLang`, `LANG`, `I18N`. Die Prüfung nimmt i18n.js jetzt mit auf.

Gegenprobe: Import wieder entfernt → rot, mit der richtigen Meldung
(„12-pdfviewer.js: ruft t() aus ../i18n.js ohne Import").

### Kontrolle des ganzen Frontends

Mit einem eigenständigen Werkzeug alle Dateien unter public/js/ plus i18n.js
gegen ALLE Frontend-Exporte gehalten: Ausser diesem einen Fall gibt es keinen
weiteren nicht importierten Namen.

702 Tests grün gegen echtes Postgres 16.

---
## Nachtrag 139 (hardened-229) — Kein einziger Hintergrundjob lief mehr

Marcos Befund: „Die Jobs scheinen nicht zu laufen in der webapp."

### Was passiert war

Beim Auslagern der Startstaffel nach `startup/backgroundJobs.ts` (Nachtrag 134)
wanderten ZEHN `require('./jobs/…')` und `require('./routes/…')` wortgleich mit.
Aus `startup/` gesehen gibt es `./jobs` nicht — jeder dieser Aufrufe warf sofort.

Und weil sie in `setTimeout(...)` und `.catch(() => {})` stecken, blieb es
STILL: Preis-Job, Anleitungs-Warteschlange, Bild-Warteschlange, Cache-Aufräumen,
PDF-Aufräumen, Kaufpreis-Nachtrag, Katalogabgleich, Brickset-Wiederholung —
nichts lief an, und im Log stand kein Wort.

Dieselbe Bauart wie in Nachtrag 131. Alle zehn sind jetzt echte Importe.

### Die eigentliche Lücke: eine zweite Liste von Quellordnern

`test/module-layout.test.js` hat seit Nachtrag 131 die Prüfung „jedes späte
require() zeigt auf eine Datei, die es gibt" — sie war grün.

Grund: Ihr Helfer `quellen()` durchlief eine FEST VERDRAHTETE Liste
`['db','utils','routes','jobs','clients']`. `startup/` kam in Nachtrag 134 dazu
und fehlte hier. Sämtliche sieben Prüfungen dieser Datei übersprangen den
Ordner stillschweigend.

Die Liste kommt jetzt aus `SRC_DIRS` in scripts/build-ts.js — eine zweite
Wahrheit neben der ersten war genau das Problem. Mit Untergrenze, damit ein
kaputtes Muster nicht wieder zu einer leeren Prüfung führt.

**Das ist das vierte Mal in Folge, dass eine Prüfung grün war, weil ihr
Umfang zu eng gezogen war** (Wildcards ohne `*`, `private` als Sichtbarkeit
statt Import, i18n.js ausserhalb des Ordners, jetzt startup/). Nicht die Regel
war falsch, sondern wo gesucht wurde.

### Neuer Test — zur Laufzeit, nicht im Quelltext

`test/background-jobs-start.test.js` lädt `startup/backgroundJobs.ts`, fängt die
Jobs ab und ruft `starteHintergrundlaeufe()` auf. Geprüft wird, dass die fünf
sofort startenden Läufe WIRKLICH ankommen — nicht, dass ihr Name irgendwo im
Quelltext steht.

Gegenproben: zwei require() zurückgestellt → rot; startup/ aus SRC_DIRS
entfernt → die Ordner-Prüfung rot.

### Zwei Tests umformuliert

Beide hingen am WORTLAUT `require('./jobs/imageQueue').start()` und wurden durch
den echten Import rot, ohne dass sich ihre Aussage geändert hätte. Was sie
prüfen — der Job läuft nur im Primärprozess — bleibt; DASS er läuft, prüft jetzt
der Laufzeittest.

### Und ein Fund im Prüfwerkzeug

`async-routes.test.js` entfernte Kommentare mit zwei Regex-Ersetzungen. Die
Zeilen-Variante schneidet an einem `//` INNERHALB eines Blockkommentars (etwa in
einer URL) dessen `*/` mit weg; der folgende Ausdruck lief dann über
zwanzigtausend Zeichen und frass alle Router-Requires. Jetzt `ohneKommentare()`,
den das Projekt längst hat — und `serverOnly()` statt `startQuelle()`, denn die
Aussage betrifft die Reihenfolge INNERHALB von server.ts.

703 Tests grün gegen echtes Postgres 16.

---
## Nachtrag 140 (hardened-230) — glob: der naheliegende Weg wäre ein Bruch gewesen

Marcos Installationslog:

    npm warn deprecated glob@10.5.0: Old versions of glob are not supported…

glob ist keine eigene Abhängigkeit: **archiver → archiver-utils → glob**.

### Der naheliegende Weg und warum er ausschied

`archiver` auf 8 heben — so wie bei pdfkit in Nachtrag 137. Dort war es richtig,
hier nicht:

**archiver 8 ist reines ESM und exportiert KEINE Funktion mehr**, sondern die
Klassen `Archiver`, `ZipArchive`, `TarArchive`, `JsonArchive`.
`require('archiver')` liefert kein aufrufbares Modul, und der Server ist
CommonJS. `routes/settings.ts` müsste umgeschrieben werden — für eine
Deprecation-Warnung an einer transitiven Abhängigkeit.

Bemerkt habe ich das nur, weil ich nach dem Update ein ZIP ERZEUGT habe statt
bloss die Tests laufen zu lassen. Der Export hatte keinen Test, der ihn
ausführt; `npm test` wäre grün geblieben und der Datenexport in der Verwaltung
hätte 500 geliefert.

### Gewählt: overrides auf glob ^13

    "overrides": { "glob": "^13.0.0" }

archiver bleibt bei 7, glob 10 verschwindet. glob 13 verlangt Node `20 || >=22`
— das Image ist node:20-alpine, passt.

Geprüft, dass es trägt: `archiver-utils` lädt mit glob 13, und der Export
erzeugt ein ZIP, das sich mit `unzip` wirklich entpacken lässt — samt BOM, das
Excel für die Umlaute braucht.

Nach `npm ci`: **keine einzige Deprecation-Warnung mehr**, 0 Schwachstellen,
33 Pakete weniger.

### Neuer Test

`test/zip-export.test.js`:

1. `archiver` ist als CommonJS-FUNKTION aufrufbar — fängt genau den Sprung auf
   8.x ab, in den ich fast gelaufen wäre.
2. Der Export erzeugt ein entpackbares ZIP: ZIP-Kopf, alle drei Dateinamen im
   zentralen Verzeichnis, und dann wirklich `unzip` — mit Prüfung auf BOM und
   Inhalt.
3. Kein glob unter Version 11 mehr im Baum.

Zwei Gegenproben: archiver als Objekt statt Funktion → Prüfung 1 rot; glob 10 in
die Lock-Datei geschrieben → Prüfung 3 rot.

### Anmerkung zu overrides

Ein `overrides`-Eintrag greift in einen FREMDEN Abhängigkeitsbaum ein — er
zwingt archiver-utils eine Version auf, gegen die es nie getestet wurde. Genau
deshalb steht der Export jetzt unter einem Test, der ihn ausführt. Hebt archiver
irgendwann selbst auf ein neueres glob, kann der Eintrag ersatzlos weg.

706 Tests grün gegen echtes Postgres 16.

---
## Nachtrag 141 (hardened-231) — Kaufpreis „—" im Detailfenster manueller Einträge

Marcos Befund: Auf der Kachel steht der Kaufpreis korrekt, im Detailfenster ein
„—", und die Tabelle unter „Kaufpreise bearbeiten" ist leer.

### Ursache

Elf Aufrufe in `js/13-acquisition-modals.js` sprachen

    /api/parts/…/acquisitions      /api/minifigs/…/acquisitions
    /api/parts/…/price-history     /api/minifigs/…/price-history

an. Diese Routen gibt es **nur unter /api/v1/** — `routes/parts.ts` und
`routes/minifigs.ts` haben gar keine Acquisitions-Route. `api()` hängt lediglich
`/api` davor.

Die Anfragen liefen also ins Leere. Sichtbar wurde daraus ein „—" statt einer
Fehlermeldung, weil der Aufruf ein `.catch(() => null)` trägt — der Dialog
verhält sich, als gäbe es keine Erfassungen.

Die Kachel zeigt den Preis richtig, weil sie ihn aus der LISTE bekommt
(getManualParts/getManualMinifigs), nicht über diesen Weg.

**Der Fehler ist ALT.** In hardened-221 — vor dem Aufteilen der Datei — stehen
dieselben Pfade. Nicht durch den Umbau entstanden.

### Neue Prüfung: Frontend-Pfade gegen Server-Routen

`test/frontend-api-paths.test.js` sammelt alle Routen (inklusive der von
`registerAcquisitionRoutes()` erzeugten) und hält jeden API-Pfad des Frontends
dagegen.

ZWEI ANLÄUFE: Der erste sah nur `api('GET', '/…')` — und schwieg bei der
Gegenprobe. Denn genau die kaputten Pfade entstehen vorher in einer Variablen:

    const acqUrl = type === 'fig' ? `/minifigs/…` : `/parts/…`;
    const ad = await api('GET', acqUrl);

Jetzt werden zusätzlich alle Pfad-Literale geprüft, deren erstes Segment der
Server unter /api kennt. Ihre Methode ist unbekannt; es genügt, dass irgendeine
sie bedient.

Gegenprobe: die alten Pfade wiederhergestellt → rot, mit allen sechs Stellen.

### Zum fehlenden Marktpreis bei Teilen

Der Verlaufs-Endpunkt war schon vorher richtig adressiert (`/v1/…`), scheiterte
aber am selben fehlenden `/v1/`? Nein — dort stand es. Der Marktpreis kommt aus
`part_price_cache`, und die füllt der Preis-Job. Der lief seit Nachtrag 134
nicht mehr (siehe Nachtrag 139). Nach dem Einspielen von hardened-229 und einem
Durchlauf sollte er erscheinen; falls nicht, ist es ein eigener Befund.

707 Tests grün gegen echtes Postgres 16.

---
## Nachtrag 142 (hardened-232) — Der Anleitungs-Job war extrem langsam

Marcos Befund: „Der Job, der die Handbücher herunterlädt, ist extrem langsam."

### Erster Fund: Der Takt hing am Durchgang, nicht am Abruf

Die Warteschlange wartete nach JEDEM Set 15 Sekunden. Die Pause schont Brickset
und brickinstructions.com — aber ein Set, das schon eine Anleitung hat, fällt in
`downloadSetInstructions()` sofort heraus, OHNE eine Verbindung zu öffnen.

Gemessen gegen echtes Postgres: **0 ms Arbeit, 15 Sekunden Pause.**

Das ist wörtlich derselbe Fehler wie beim Bild-Job in Nachtrag 217: Dort wurde
das CDN-Kontingent auf NOTIZEN angewandt statt auf CDN-Anfragen, und Übersprünge
bremsten wie Downloads — 37 Minuten für „10 bearbeitet: 0/0/0".

`utils/instructions.ts` meldet jetzt über `letzterAbrufWarExtern()`, ob wirklich
gefragt wurde; die Schlange wartet 15 s nur dann, sonst 250 ms.

### Zweiter Fund: Die Pause lief doppelt

Nach dem BDP-Rückfallweg legt `downloadSetInstructions()` 5 Sekunden ein —
und danach wartet die Schlange nochmal 15. Zusammen 20, ohne dass ein Server
dadurch besser geschont würde: Der nächste Abruf kommt so oder so frühestens
nach 15 Sekunden.

Neuer Parameter `eigenerTakt`. Die beiden anderen Aufrufer (Set erfassen,
Brickset-Wiederholung) haben KEINEN Takt über sich — für die bleiben die
Pausen. Deshalb ein Schalter und kein Löschen.

### Wirkung

Bei 800 Sets, von denen 700 bereits versorgt sind:

| | vorher | nachher |
|---|---|---|
| Gesamtdauer | **3 h 28 min** | **28 min** |

Im ungünstigsten Fall (alle 800 unversorgt): 4 h 26 min → 3 h 20 min. Dort
bleibt die Bremse absichtlich stehen — sie verhindert die Cloudflare-Sperre, die
weiter unten im Job eigens behandelt wird.

### Was ich NICHT angefasst habe

Die 15 Sekunden selbst und die 500 ms je Bildseite in `collectAndBuildPDF()`.
Beide begrenzen die Last auf fremden Servern; sie zu senken ist eine
Abwägung, die Marco gehört, nicht eine Aufräumarbeit. Die Seitenschleife läuft
zudem in einem `setImmediate` und blockiert die Schlange nicht.

### Tests

`test/instruction-queue-pace-db.test.js` mit drei Prüfungen: ein versorgtes Set
löst keinen Abruf aus (gegen echte DB, mit Zeitmessung), die Schlange bremst nur
nach einem echten Abruf, und der Job verzichtet auf die Pausen, die er selbst
einhält — wobei beide Pausen für die übrigen Aufrufer erhalten bleiben müssen.

Vier Gegenproben nachgespielt: Takt zurück am Durchgang → rot; Merker meldet
fälschlich einen Abruf → rot; Job meldet den eigenen Takt nicht → rot; eine
Pause ganz gelöscht statt abschaltbar → rot.

710 Tests grün gegen echtes Postgres 16.

---
## Nachtrag 143 (hardened-233) — Marktpreis fehlt im Detailfenster manueller Teile

Marcos Befund: Auf der Finanzseite steht für „Primo Brick 1 x 1 (Blau)" ein
Marktpreis von CHF 0.13. Im Detailfenster desselben Teils: „—".

### Zwei Schlüsselräume, die man nicht mischen darf

`part_price_cache` und `part_price_history` schreibt `fetchPartPrice()` — unter
der **BrickLink**-Teilenummer und der **BrickLink**-Farbnummer. BrickLink
antwortet auf Rebrickable-Nummern mit 404, deshalb wird vor dem Abruf übersetzt
(`resolveBlPartNumber` / `resolveBlColorId`), und der Cache erbt diesen Schlüssel.

`part_acquisitions` trägt dagegen die **Rebrickable**-Nummer — so hat der
Benutzer sie eingegeben.

`getPartPriceHistory()` nahm die Rebrickable-Werte für BEIDES. Für Teile ohne
Zuordnung stimmen die Schlüssel zufällig überein; für alle anderen fand die
Preisabfrage nichts, und die Zeile blieb leer.

Die Finanzseite war nie betroffen: `computePartsValuation()` übersetzt selbst
(`part.bl_part_number || part.part_number`). Genau deshalb standen zwei
verschiedene Antworten für dasselbe Teil auf zwei Seiten derselben Anwendung.

### Behebung

`manualPriceHistory()` und `conditionRows()` nehmen jetzt ZWEI Schlüssel: einen
für die Preise, einen für die Erfassungen. Ohne Angabe sind sie identisch — bei
Minifiguren stimmen sie überein, dort ändert sich nichts.

Nachgewiesen gegen echtes Postgres mit Marcos Lage (RB `31000`/Farbe 1 ↔ BL
`bl31000`/Farbe 7): Marktpreis 0.13, Kaufpreis 0.11, G&V +18.2 %.

### Tests

`test/part-price-keys-db.test.js` prüft beide Richtungen. Gegenproben:
Rebrickable-Nummer für die Preise → rot (Marcos Fehler); Erfassungen fälschlich
mit übersetzt → rot („Für den erfassten Zustand fehlt die Zeile ganz").

Eine bestehende Prüfung wurde umformuliert: Sie las die Importzeile von
priceHistory.ts WÖRTLICH und wurde rot, weil dort jetzt zwei weitere Namen
stehen. Es zählt, DASS der gemeinsame Helfer von dort kommt.

711 Tests grün gegen echtes Postgres 16.

---
## Nachtrag 144 (hardened-234) — Der geschätzte Minifiguren-Preis wurde nie gelesen

Marcos Auftrag: „Der geschätzte Marktpreis einer Minifigur soll ebenfalls im
Cache gespeichert werden, damit er nicht jedes Mal neu geholt werden muss.
Weiter soll er auch sonst gespeichert werden, damit der Preisverlauf angezeigt
werden kann."

### Der Befund war halb erfüllt — und die fehlende Hälfte kostete am meisten

GESCHRIEBEN wurde der Schätzwert längst: in `minifig_price_cache` UND
`minifig_price_history`. GELESEN wurde er nie.

Jeder Aufruf holte deshalb erneut die Teile-Zusammensetzung von Rebrickable und
danach den BrickLink-Preis JE TEIL. Eine Minifigur mit fünfzehn Teilen kostete
fünfzehn Preisabfragen — bei jedem Öffnen der Finanzseite, für jede Figur ohne
BrickLink-Nummer.

`estimateFigPriceFromParts()` sieht jetzt zuerst im Cache nach. Gemessen gegen
echtes Postgres: **2 ms statt fünfzehn Abfragen.**

### Zur Frist

Dieselbe wie beim echten Abruf (`price_cache_ttl`, Vorgabe 24 h). Der Wert ist
derselbe Marktpreis, nur anders ermittelt — er soll nicht länger gelten als ein
von BrickLink geholter. Ein 48 Stunden alter Eintrag wird übergangen und neu
gerechnet.

Dass innerhalb der Frist KEIN neuer Verlaufspunkt entsteht, ist richtig: Ein
zweiter Punkt mit demselben Wert am selben Tag trägt nichts bei. Nach Ablauf
wird gerechnet und geschrieben — dieselbe Taktung wie bei Sets.

### Tests

`test/minifig-estimate-cache-db.test.js` mit drei Prüfungen gegen echte
Datenbank: frischer Eintrag ersetzt die Neuberechnung (mit Zeitmessung und der
Kontrolle, dass kein zweiter Verlaufspunkt entsteht), veralteter Eintrag wird
übergangen, und beide Tabellen werden beschrieben.

Gegenproben: Lesepfad wieder entfernt → rot; Frist auf 1000 Stunden aufgeweitet
→ die Prüfung für den veralteten Eintrag rot.

714 Tests grün gegen echtes Postgres 16.

---
## Nachtrag 145 (hardened-235) — Gesamtwert und Teilsummen kommen vom Server

Marcos Frage: „Ist nach wie vor sichergestellt, dass die ganze Logik im Server
zentral ist und die Webapp sowie die Android-App die Daten gleich beziehen und
nur das Rendering übernehmen?"

Nachgesehen statt behauptet. Weitgehend ja — mit zwei Ausnahmen.

### 1. Eine Divergenz ZWISCHEN den Clients

Der Server liefert `total_value` für Teile und Minifiguren. Android las es von
dort; die Webapp summierte stattdessen `display_value` über alle Zeilen.

Heute kam dasselbe heraus — beide Werte stammen ja vom Server. Sobald der
Server aber entscheidet, Zeilen ohne Preis anders zu behandeln, zeigen die
beiden Clients verschiedene Summen. Die Webapp liest jetzt `total_value`.

### 2. Der Gesamtwert stand an drei Stellen

`sets.totals.avg + parts.total_value + figs.total_value` rechneten BEIDE
Clients selbst.

Derselbe Wert steckte längst in `computePnl()` als `totals.current` — dort aus
den Preisen JE ZEILE gebildet, also belastbarer als eine Addition dreier
gerundeter Endsummen. Er heisst jetzt zusätzlich `grand_total` und wird von
beiden gelesen. Kein zusätzlicher Abruf: Beide holen /finance/pnl ohnehin.

Der Rückfall auf die eigene Addition bleibt in beiden Clients — für den Fall,
dass die pnl-Abfrage scheitert oder ein älterer Server antwortet.

### Warum die bestehende Prüfung das nicht fand

`keine Oberfläche rechnet die Summe noch einmal` sucht nach zwei konkreten
Feldnamen (`purchase_price`, `unit_price`, `quantity`). `display_value` stand
nicht auf der Liste, und die Android-Seite sah sie überhaupt nicht an.

Die Regel war richtig, der Suchraum zu eng — **zum sechsten Mal in dieser
Reihe dasselbe Muster** (vgl. Nachträge 100 bis 105 und 139).

### Neue Prüfungen — nach der FORM, nicht nach Feldnamen

`test/clients-render-only.test.js` sucht `reduce(… => … .<geldfeld>)` mit einer
Liste von Feldnamen, die auf Geld deuten, und verlangt für jede Fundstelle
einen ausdrücklichen Freibrief in einer Ausnahmeliste. Dazu: Der Server MUSS
`grand_total` liefern, sonst ist die Regel nicht erfüllbar.

`ClientRendersOnlyTest` (Android) macht dasselbe für `sumOf`. Summen über
Stückzahlen bleiben erlaubt — „x7" neben einer Zeile ist Anzeige, keine
Geschäftsregel.

Fünf Gegenproben nachgespielt: Webapp summiert display_value → rot; Webapp
addiert den Gesamtwert → rot; Server liefert grand_total nicht → rot; Android
addiert selbst → rot; Geldsumme in der Android-Oberfläche → rot.

717 Tests grün gegen echtes Postgres 16.

---
## Nachtrag 146 (hardened-236) — Der Zustand der Zeile wurde verworfen

Marcos Befund: „Wenn ich bei der Minifigur einen zweiten Preis mit einem
anderen Zustand erfasse, z.B. gebraucht, wird der Marktpreis dieses Zustands
nicht angezeigt. Der Preis ist ebenfalls identisch, wenn ich das Feld leer
lasse. Es sieht so aus, als würde der Preis vom anderen Zustand übernommen."

Die Beobachtung traf genau zu.

### Ein Parameter, den zwei von drei Fassungen nicht annahmen

Wird das Kaufpreisfeld geleert, füllt `resolvePrice()` den Marktpreis nach. Der
Aufrufer reicht dafür seit Nachtrag 68 den Zustand DIESER Zeile durch:

    p = await cfg.resolvePrice(uid, keys, cond);

Die SETS-Fassung nimmt ihn entgegen. Teile und Minifiguren deklarierten den
dritten Parameter nicht und liessen ihn fallen:

    resolvePrice: async (uid, [fn]) => { … getCurrentFigMarketPrice(fn, uid, bl) }

Beide leiteten stattdessen einen Zustand aus ALLEN Erfassungen des Eintrags ab
(„eine Gebraucht-Erfassung genügt → U"). Das kann nicht stimmen, sobald zwei
Erfassungen verschiedene Zustände haben — es gibt dann keinen einen Zustand des
Eintrags mehr.

Folge: Die Gebraucht-Zeile bekam den Preis des Sammelzustands, und für
„Gebraucht" wurde nie ein Marktpreis ermittelt. Deshalb blieb die Zeile im
Detailfenster leer, während „Neu" einen Wert zeigte.

Beide Ermittler hatten den Parameter längst
(`getCurrentFigMarketPrice(…, condition = null)`,
`getCurrentPartMarketPrice(…, condition = null)`) und geben ihm auch Vorrang vor
dem abgeleiteten. Er kam nur nie an. Die Behebung sind zwei Zeilen.

### Warum das die leere Zeile mit erklärt

`getCurrentFigMarketPrice()` schreibt über `fetchMinifigPrice()` bzw. — ohne
BrickLink-Treffer — über `estimateFigPriceFromParts()` in
`minifig_price_cache`, und zwar unter dem ERMITTELTEN Zustand. Kam dort nie ein
„U" an, entstand auch nie ein U-Eintrag; und genau den liest das Detailfenster.

### Tests

`test/acquisition-condition-price-db.test.js` mit drei Prüfungen: alle drei
Erfassungsarten reichen den Zustand durch, die Ermittler nehmen ihn entgegen und
geben ihm Vorrang, und die Schätzung legt je Zustand einen eigenen Eintrag ab.

Gegenproben: Minifiguren verwerfen den Zustand wieder → rot; Teile ebenso → rot.

720 Tests grün gegen echtes Postgres 16.

---
## Nachtrag 147 (hardened-237) — Dieselbe Lücke, nur beim Erfassen

Marcos Befund: Zwei heute angelegte Einträge derselben Minifigur, einer „Neu",
einer „Gebraucht" — beide Kaufpreise CHF 2.18, obwohl die Marktpreise 2.18
(Neu) und 2.20 (Gebraucht) sind.

### Nachtrag 146 hat nur die Hälfte behoben

Dort ging es um das BEARBEITEN (`resolvePrice` in den Erfassungsrouten). Das
ERFASSEN ist ein anderer Weg, und dort stand derselbe Fehler an vier Stellen:

| Datei | Stelle |
|---|---|
| routes/minifigs.ts | Mengen-Erhöhung → neue Tageserfassung |
| routes/minifigs.ts | Kaufpreis leer → Marktpreis einsetzen |
| routes/parts.ts | dieselbe Mengen-Erhöhung |
| routes/parts.ts | derselbe leere Kaufpreis |

Bei der Mengen-Erhöhung war es besonders auffällig: Der Preis wurde geholt, und
ZWEI ZEILEN SPÄTER der Zustand bestimmt, mit dem die Erfassung dann geschrieben
wurde. Jetzt zuerst der Zustand, dann der Preis dazu.

Beim Anlegen der zweiten Zeile gab es erst die erste — der ohne Zustand geholte
Preis leitete sich also aus ihr ab. Genau Marcos 2.18 für beide.

### Warum ich es beim ersten Mal übersehen habe

Ich habe nur die Stellen angesehen, die im Fehlerbericht vorkamen. Das ist
inzwischen das siebte Mal in dieser Reihe, dass eine Prüfung oder eine Suche zu
eng gezogen war.

Deshalb prüft `acquisition-condition-price-db.test.js` jetzt JEDEN Aufruf von
`getCurrentFigMarketPrice` und `getCurrentPartMarketPrice` in routes/ und
utils/ auf die Zustandsangabe — nicht die vier, die ich gerade repariert habe.

Gegenproben: Minifiguren-Aufruf ohne Zustand → rot mit Datei und Zeile; Teile
ebenso.

721 Tests grün gegen echtes Postgres 16.

## Nachtrag 148 (hardened-238) — Ein Test, der seit Nachtrag 133 nicht mehr lief

Ausgangspunkt war eine Qualitätseinschätzung, keine Fehlermeldung. Beim
Nachmessen fiel `test/set-condition-aggregate.test.js` auf: Zeile 679 holte
`dist/utils/handlers.js` — aufgeteilt seit Nachtrag 133 nach
`utils/handlers/{shared,parts,sets,minifigs,stats}.ts`.

Der Aufruf steht auf DATEIEBENE. Die Datei starb also beim Laden, und die zehn
Prüfungen darunter liefen nie mehr. Lokal war das unsichtbar, weil in einem
gewachsenen `dist/` noch eine alte `handlers.js` lag — dieselbe Klasse wie die
veralteten Build-Artefakte aus Nachtrag 115.

Der Ersatzhelfer `handlerModul()` stand längst in `test/helpers/sources.js` und
nannte diesen Aufruf sogar im Kommentar. Eine Aufrufstelle war beim Umbau
übersehen worden.

**Prüfung:** `test/require-exports.test.js` prüft jetzt alle 39 Modulpfade, die
Tests aus `dist/` holen. Gegenprobe: alte Fassung → rot mit Datei und Pfad.

### strictNullChecks ist an

Der Schalter stand seit der TypeScript-Migration aus, zuletzt mit 93 Meldungen.
Abgeräumt in Gruppen, ohne eine einzige Verhaltensentscheidung:

| Gruppe | Umfang |
|---|---|
| `res.statusCode ?? 0` in den HTTP-Klienten | 6 Dateien |
| Funktionsköpfe mit `condition = null` typisiert | 10 |
| `new Map(rows.map(…))` mit Elementtyp | 8 |
| `let x = null` / `const x = []` ausgeschrieben | Preis-Job, PDF, `addSet` |
| `req.session.userId` hinter requireLogin | neuer Typ `LoggedInRequest` |

`LoggedInRequest` in `types/augmentations.d.ts` folgt dem Muster von
`AuthedRequest`: Die Zusicherung steht einmal geschrieben und ist an die
Middleware gebunden, statt als `!` an jeder Stelle.

Zwei Kleinigkeiten fielen dabei ab. In `routes/api_v1/parts.ts` stand
`page_size: result.page_size` VOR `...result` und war damit wirkungslos. Und der
Fortschrittszähler des Preis-Jobs hing an einem Feld, das der `finally`-Block
nebenläufig auf null setzt — jetzt eine lokale Referenz.

### Fünf Tests wurden rot, ohne dass sich Verhalten geändert hatte

`condition = null` wurde zu `condition: string | null = null`, und fünf
Prüfungen nagelten den Wortlaut der Signatur fest. Dieselbe Sorte Test, die in
Nachtrag 118 eine Sicherheitslücke festgeschrieben hat.

Neue Helfer in `test/helpers/sources.js`: `funktionsKopf()` schneidet
klammerbewusst die Parameterliste heraus, `hatParameter()` fragt nach dem
Parameter statt nach seiner Schreibweise.

### Lange Funktionen

| Funktion | vorher | nachher |
|---|---|---|
| `registerImgProxy` | 458 | 3 (Ablauf als exportiertes `bildDurchreichen`) |
| `initSchema` | 408 | 30 (fünf benannte Etappen) |
| `getParts` | 256 | ~100 (`teileFilter`, `teileErsatzquelle`) |

Bei `initSchema` steht die Reihenfolge „Indizes zuletzt" jetzt als Liste statt
als Kommentar mitten im Rumpf — sie ist eine echte Bedingung, keine Gewohnheit.

`bildDurchreichen` bleibt bei 343 Zeilen. Der CDN-Abruf ist eine
Rückruf-Kette um `res`, `activeReq` und den Referer-Rückfall; ein Schnitt
hinein braucht einen Lasttest gegen echte CDN-Antworten.

### Werkzeug

`@types/express` von ^5 auf ^4 (Express 4 läuft). `@types/bcryptjs` ersatzlos
entfernt — bcryptjs 3 bringt eigene Typen mit, das v2-Paket beschrieb eine
andere API. Neue Regel in `test/build-tooling.test.js`: Typpaket und Paket in
derselben Hauptversion, mit begründeter Ausnahmeliste für `archiver`,
`connect-pg-simple` und `nodemailer` (DefinitelyTyped zählt dort eigenständig).

`CHANGELOG-fixes.md` war auf 640 KB in einer Datei gewachsen. Jetzt ein
2,6-KB-Index mit Tabelle, die 281 Abschnitte liegen als Teile unter
`CHANGELOG/`. `test/changelog-index.test.js` hält beides zusammen.

728 Tests grün gegen echtes Postgres 16.

## Nachtrag 149 (hardened-238) — Drei Regeln, die nur der Quelltext kannte

Von 111 Testdateien lasen 38 ausschliesslich Quelltext. Für Architekturregeln
ist das richtig. Für drei Regeln war es die falsche Form — jede davon ist in
dieser Reihe schon einmal still grün geblieben, während die Regel tot war.

### Blickfeld im Haushalt

Die Regel „`owner_user_id` wird geprüft, nicht bloss übernommen" lag als
Quelltextprüfung vor: Sie suchte nach `resolveWriteTarget(` und nach einem 403
irgendwo in derselben Datei. Beides stünde auch dann noch da, wenn der
Rückgabewert nicht mehr ausgewertet würde.

Das ist der teuerste denkbare stille Fehlalarm im Projekt: Fällt die Prüfung
aus, schreibt ein Konto in ein fremdes, ohne dass etwas rot wird.

`household-db.test.js` legt jetzt über die echten v1-Routen an. Hauptkonto →
eigenes Unterkonto landet dort; Geschwisterkonto, Rückrichtung und fremdes Konto
geben 403 — und in keinem der drei Fälle entsteht still eine Zeile.

**Gegenprobe:** `canWriteFor` erlaubt heimlich auch die Gegenrichtung.
Quelltexttest 25/25 grün, Verhaltenstest rot.

### Sperr-Namensräume

Die Zahlen lagen als Konstanten in sechs Dateien, jede mit einer abgeschriebenen
Liste der belegten Namensräume. Beide Listen waren veraltet, und der Test in
`rate-limit.test.js` prüfte gegen `['42','77','11223344','99999999']` — er
kannte 55, 56, 57 und 58 nicht und hätte eine Kollision mit dreien davon
durchgelassen.

Alle Namensräume stehen jetzt in `utils/lockNamespaces.ts`; elf Aufrufstellen
importieren daraus. Keine eingetippte Zahl mehr in einem `pg_*advisory*`-Aufruf
— das prüft die einzige verbliebene Quelltextregel, und sie prüft nicht WELCHE
Zahl dasteht, sondern DASS keine dasteht.

`lock-namespaces-db.test.js` misst gegen echtes Postgres: alle gleichzeitig
belegbar, derselbe Namensraum sperrt aus, der zweite Wert unterteilt.

### Bild-Auslieferungsreihenfolge

`liefereAusCache()` entscheidet bei jeder Bildanfrage, was rausgeht. Geprüft
wurde das an drei Stellen im Quelltext. Das fängt, dass jemand die
Grössenprüfung LÖSCHT — nicht, dass sie danebengreift.

`img-cache-serve.test.js` ruft die echte Funktion gegen echte Dateien.

**Gegenprobe:** `return true` nach dem 304 weggelassen. Quelltexttests 42/42
grün, Verhaltenstest rot.

744 Tests grün.

## Nachtrag 150 (hardened-239) — Der Rechner ohne Vorgeschichte

Nachtrag 148 hätte nicht monatelang unbemerkt bleiben können, wenn irgendwo ein
Lauf ohne gewachsenes Arbeitsverzeichnis stattgefunden hätte. Es gab keinen.

`.github/workflows/ci.yml`: Postgres 18 als Dienst (dieselbe Hauptversion wie
`compose.yaml`), dann `npm ci` → `tsc --noEmit` → `typecheck:strict` →
`npm run build` → `npm test` → `npm audit`.

`REQUIRE_DB=1` ist gesetzt. Ohne die Variable überspringen die
Datenbank-Suiten sich selbst — ein grüner Lauf, der die Hälfte nie ausgeführt
hat, wäre das Schlimmste, was hier passieren kann.

Ein Wächter hält die Zeilen fest, die man beim Umbauen verliert: `REQUIRE_DB`,
die Postgres-Hauptversion gegen `compose.yaml` abgeglichen, und die Schritte.
Die Muster hängen an `run:` — beim ersten Versuch griffen sie auch, wenn der
Schritt fehlte, weil `npm ci` im Erklärtext des Workflows vorkommt.

### noImplicitAny, gestaffelt

680 Meldungen, 632 davon TS7006. Den Schalter einzuschalten hiesse, den
Übersetzer dauerhaft rot zu machen.

Eine zweite `tsconfig` mit `exclude` funktioniert NICHT: `exclude` bestimmt nur
die Einstiegspunkte, importierte Module landen trotzdem im Programm. Gemessen
blieben 471 der 631 Meldungen übrig.

Deshalb `scripts/check-noimplicitany.js` mit einer AUSNAHMELISTE: Der Schalter
ist für alles ausser den aufgeführten Dateien scharf, eine neue Datei ist
automatisch streng. Geprüft in beide Richtungen — neue Meldung in sauberer
Datei UND verwaister Eintrag. Ohne die zweite Richtung wüchse hier dieselbe
ungepflegte Abschrift heran wie bei den Namensräumen in Nachtrag 149.

### Kein Linter

`typescript-eslint` bricht bei TypeScript 7 mit einer ausdrücklichen Meldung
ab; Unterstützung ab TS 7.1 ist als Issue #10940 offen. Zum Laufen bekommt man
es nur mit einem zweiten, geschachtelten TypeScript 6 und einem Import quer
durch `node_modules` — genau die Konstruktion, gegen die Nachtrag 148 bei
`@types/express` argumentiert hat. Nicht eingetragen.

Stattdessen das ohne eslint Verfügbare: `noFallthroughCasesInSwitch` und
`noImplicitOverride` sind an (beide meldeten null). Zurückgestellt:
`noUnusedLocals` (138), `useUnknownInCatchVariables` (106),
`noImplicitReturns` (64).

746 Tests grün.
