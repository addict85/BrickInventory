# Begründungen zu `test/erfassen-parallel-db.test.js`

Die ausführlichen Kommentare aus `test/erfassen-parallel-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Erfassen: gleichzeitig, und mit unsinnigen Eingaben.

── Warum echte Nebenläufigkeit ─────────────────────────────────────────────
Der Fehler war am laufenden Server sichtbar: Zehn parallele Erfassungen
desselben Sets ergaben sets.quantity = 10, aber drei Erfassungszeilen mit
Summe 7 — drei verlorene Exemplare und drei Tageszeilen, wo genau eine
erlaubt ist. Eine Quelltextprüfung („steht withInventoryLock im
Erfassen-Pfad?") würde das erste Symptom bemerken, aber nicht das zweite,
und sie sagt nichts darüber, ob die Sperre auch GREIFT.

Deshalb hier: echte parallele Aufrufe gegen echte Postgres-Verbindungen.
Ohne Sperre schlagen die Prüfungen sofort an — nachgewiesen per Gegenprobe.

Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
Ohne DB: skip.
```

<a id="addsetintern"></a>
## `const beginn = sets.indexOf('async function addSetIntern(');`

```text
Nur der Rumpf von addSet(): bis zur NÄCHSTEN Funktion auf oberster Ebene.
Ein Schnitt bis addSetWithDate() umfasste 1200 Zeilen samt fremder Routen
und zählte deren Sperren mit.

Gelesen wird addSetIntern(): Seit dem 24.09. traegt addSet() nur noch die
Huelle, die den Lagerort setzt (Marcos Befund „beim Hinzufuegen kann ich
den Lagerort nicht waehlen"), und reicht alles Weitere an addSetIntern
durch. Der Rumpf mit den Erfassungen und der Sperre steht dort. Wuerde
hier weiter die Huelle gelesen, faende die Regel null Schreibstellen und
waere still zufrieden — genau das hat sie beim Umbau gemeldet.
```

<a id="stelle"></a>
## `assert.ok(H.SET_PARTS_MAX_PAGE_SIZE > H.MAX_PAGE_SIZE,`

```text
── Die Teileliste EINES Sets darf mehr als eine normale Seite liefern ────

Die Set-Detailansicht der App fragt page_size=2000 und holt nur Seite 1.
clampPageSize deckelte auf 500: Ein Set mit 915 Teilezeilen kam als 500
Zeilen an — und die Antwort meldete „page_size: 2000", spiegelte also die
Anfrage zurück. Damit konnte kein Client merken, dass Teile fehlen. Auch
die PDF-Teileliste baut auf dieser Antwort auf.
```

<a id="setliste"></a>
## `const getSets = src.slice(src.indexOf('async function setListe'));`

```text
── Und die SET-Liste bleibt unbegrenzt ──────────────────────────────────

Nicht mehr, weil die App nicht blättern könnte — sie kann es längst
(SetsRepository.getSets nimmt page und pageSize). Sondern weil der Weg
ohne page_size absichtlich offen bleibt: Skripte und ältere App-Stände
holen darüber alles, und eine stille Grenze unterschlüge ihnen ab dem
Grenzwert Sets. Die Begründung steht einmal, in routes/api_v1/sets.ts.
```
