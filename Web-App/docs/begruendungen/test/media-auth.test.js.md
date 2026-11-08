# Begründungen zu `test/media-auth.test.js`

Die ausführlichen Kommentare aus `test/media-auth.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Bilder und PDFs verlangen ausnahmslos eine Anmeldung.

── Was vorher offen war ────────────────────────────────────────────────────
Set-Bilder liefen über `app.use('/images', express.static(IMAGES_DIR))` — also
ohne jede Prüfung. Die Begründung im Code lautete, es seien öffentliche
Katalogfotos, die dieselben CDNs ohnehin ausliefern.

Für das einzelne Bild stimmt das. Für die SAMMLUNG nicht: Wer die Adressen
durchprobiert, liest ab, welche Sets jemand besitzt — und das ist der Teil,
der schützenswert ist. Teile- und Minifiguren-Bilder verlangten schon immer
eine Anmeldung; die Ungleichbehandlung war historisch, nicht begründet.

Dieser Test hält fest, dass keine Datei aus dem Datenverzeichnis mehr ohne
Anmeldung erreichbar ist.
```

<a id="ohnekommentare"></a>
## `function ohneKommentare(src) {`

```text
Kommentare weg — der Erklärtext oben nennt express.static selbst.

── Warum das mehr braucht als zwei replace() ───────────────────────────────
Die frühere Fassung war `.replace(/\/\*[\s\S]*?\*\//g, '')`. Sie sieht harmlos
aus, hat aber einen Startpunkt mitten in einer ZEICHENKETTE: `'/images/*'`
enthält `/*`. Von dort frass sie alles bis zum nächsten `*​/` — und wie viel
das ist, hing davon ab, wo zufällig der nächste Blockkommentar stand.

Aufgefallen ist es, als ein einziger neuer Inline-Kommentar (`catch { /*…*​/ }`)
weiter unten dazukam: Danach fand die Prüfung NULL Datei-Routen und meldete
„liefe ins Leere" — vier Sicherheitsprüfungen auf einmal, ohne dass sich an
der Sicherheit irgendetwas geändert hatte.

Genau das ist der Schaden: Ein Sicherheitstest, der aus einem unbeteiligten
Grund rot wird, wird beim nächsten Mal übergangen.

Der Ersatz läuft einmal durch den Text und merkt sich, ob er gerade in einer
Zeichenkette steht. Zeilenkommentare und Blockkommentare fallen weg,
Zeichenketten bleiben unangetastet.
```

<a id="build"></a>
## `const build = read('scripts/build-ts.js');`

```text
── Woher dieser Test kommt ──────────────────────────────────────────────
scripts/build-ts.js verarbeitete nur .ts. Die Migrationen in
db/migrations/ sind .sql und landeten damit NIE in dist/ — und weil das
Laufzeit-Image ausschliesslich dist/ übernimmt, fand runMigrations() dort
gar kein Verzeichnis vor.

Der Fehler war still: Die Datenbank behielt die alten Bildpfade, und der
davon abhängige (inzwischen entfernte) Dateiumzug ordnete jede Datei als
"verwaist" ein. Es sah aus, als sei die Umsortierung wirkungslos.

Die Prüfung bleibt, obwohl 0002 weg ist: db/migrations/0001-baseline.sql
liegt weiterhin dort, und jede künftige Migration ist wieder eine .sql.
```

<a id="fs2-stelle"></a>
## `const fs2 = require('node:fs');`

```text
── Woher dieser Test kommt ──────────────────────────────────────────────
Der Dispatcher (public/js/11-actions.js) baut die Argumentliste so:
    if (el.dataset.self === '1') args.push(el);
    for (const key of ['data-arg', …]) args.push(…);
Das Element kommt also VOR den data-arg-Werten.

retryBricksetQueueEntry und deleteBricksetQueueEntry hatten die Signatur
(setNumber, btn) — verdreht. setNumber war damit das Knopf-Element: Die
Meldung lautete "[object HTMLButtonElement] wird erneut versucht", und die
Adresse zeigte auf einen Eintrag, den es nicht gibt. Der Knopf sah aus, als
täte er etwas, und traf nie den gemeinten Datensatz.
```

<a id="vm-stelle"></a>
## `const vm   = require('node:vm');`

```text
── Woher dieser Test kommt ──────────────────────────────────────────────
Nach der Umstellung "jede absolute Adresse über /api/img-proxy" schlug der
Zoom fehl:
  GET /api/img-proxy?url=https%3A%2F%2F<server>%2Fimages%2Fsets%2F9396-1.jpg
  → 403

Der Proxy lehnte zu Recht ab — seine Allowlist kennt nur die Bild-CDNs,
und ein Proxy, der auf sich selbst zeigt, wäre eine offene Weiterleitung.

Die Adresse entstand, weil `imgEl.src` nicht den Attributwert liefert,
sondern die vom Browser AUFGELÖSTE absolute Adresse. Der Zoom greift
darauf zurück, wenn data-orig nur den Platzhalter trägt (#m-img im
Set-Detail). Die Kacheln waren nicht betroffen: Sie beziehen ihre
Adressen relativ aus den Vorlagen — deshalb fiel es nur beim Zoom auf.
```
