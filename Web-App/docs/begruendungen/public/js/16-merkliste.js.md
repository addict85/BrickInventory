# Begründungen zu `public/js/16-merkliste.js`

Die ausführlichen Kommentare aus `public/js/16-merkliste.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="was-man-haben-moechte-getrennt-vom-besit"></a>
## Was man haben möchte — getrennt vom Besitz. Die Trennung ist der ganze

```text
═══ Merkliste ═════════════════════════════════════════════════════════════

── Was sie ist, und was sie NICHT ist ──────────────────────────────────────

Was man haben möchte — getrennt vom Besitz. Die Trennung ist der ganze
Grund für eine eigene Tabelle (db/migrations/0021-merkliste.sql): Stünde
ein Merkposten in `sets`, zählte er in Galerie, Teileliste, Portfolio-Wert und
Finanzansicht mit, und jede dieser Ansichten bräuchte ab dann einen Filter,
den sie heute nicht hat.

── Warum der Zustand überall mitgeht ───────────────────────────────────────

Neu und gebraucht sind zwei Merkposten mit zwei Schwellen — wer ein
gebrauchtes zum Bauen und ein verpacktes zum Aufheben sucht, hat beide.
Er steht deshalb im Schlüssel, genau wie beim Preisalarm seit 0019, und
jeder Knopf hier trägt ihn mit.
```

<a id="roh"></a>
## `roh`

```text
── Warum imgUrl() und nicht die Adresse selbst ─────────────────────────

Marcos Befund: „Die Bilder in der Merkliste werden nicht geladen.
Anscheinend wird direkt das CDN aufgerufen." Genau so war es: Hier stand
`thumbUrl(w.image_url)`, und thumbUrl() reicht seine Eingabe unveraendert
durch (01-core.js) — gedacht fuer LOKALE Pfade. Fuer eine CDN-Adresse
kommt sie unveraendert wieder heraus, der Browser ruft cdn.rebrickable.com
direkt auf, und die Sicherheitsrichtlinie der Seite blockt das:

    img-src 'self' data: blob:

Jede andere Liste schreibt deshalb imgUrl(thumbUrl(lokal || cdn), …) —
erst das nimmt den Weg ueber den eigenen Server.

'nur' und nicht `true`: Dieselbe Wahl wie im Katalog. Sie NUTZT eine
Vorschau, laesst aber keine erzeugen — und hinterlaesst dabei die Notiz,
an der jobs/imageQueue.ts das Bild ueberhaupt erst lokal ablegt
(routes/imgProxy.ts, notiere()). Sobald es liegt, kommt es als
image_local mit und der Proxy ist ganz aus dem Weg.
```

<a id="preis"></a>
## `preis`

```text
── Marktpreis statt Knopf ────────────────────────────────────────────────

Marcos Vorgabe vom 24.09.: „Bitte in der Tabelle der Merkliste der Button
In die Galerie aufnehme entfernen und dafuer den Marktpreis anzeigen."

Der Knopf verschwindet nur aus der ZEILE, nicht aus der App: Das
Merkposten-Detail hat ihn weiterhin (merkpostenDetailUebernehmen), und
dort steht ohnehin der Dialog mit Anzahl, Kaufpreis und Zustand. In der
Liste stand er neben „Loeschen" — zwei Knoepfe, von denen der eine ein
Formular oeffnet und der andere sofort fragt.

Ein Strich, wenn noch kein Preis im Cache liegt. Das ist kein Fehler:
jobs/priceJob.ts holt die Preise der Merkposten taeglich; bis zum ersten
Lauf nach dem Eintragen gibt es schlicht noch keinen.
```

<a id="merklisteparams"></a>
## `merklisteParams`

```text
Suche, Zustand, Sortierung und Inhaber als Anfrageparameter.

Marcos Vorgabe vom 24.09.: „In der Merkliste noch einen Filter analog den
Sets einbauen inkl. Inhaber." Dieselbe Form wie galleryParams() in
02-gallery.js, dieselben Parameternamen am Server — nur ohne `page`, weil
die Merkliste nicht blaettert, und ohne Lagerort, weil ein Merkposten
nirgends liegt.

Gefiltert wird am SERVER. Clientseitig ueber _merkposten zu sieben waere
hier zwar machbar (die Liste ist kurz), aber die Sortierung nach Marktpreis
braucht price_cache, und beide Oberflaechen sollen dasselbe Ergebnis
zeigen — die App kann es ohnehin nicht anders.
```

<a id="filter"></a>
## `filter`

```text
Zwei verschiedene Leermeldungen: „Noch keine Merkposten" ist eine Aussage
ueber die Liste, „Nichts gefunden" eine ueber den Filter. Stuende hier
immer die erste, saehe eine Suche ohne Treffer wie eine geleerte Merkliste
aus — genau die Verwechslung, wegen der der Kontofilter beim Anmelden
zurueckgesetzt wird (14-scope.js).
Die Sortierung ist kein Filter: Sie steht immer in den Parametern.
```

<a id="katalogaufmerkliste"></a>
## `katalogAufMerkliste`

```text
Aus dem Katalog-Detail — Marcos „inkl. Zustand und einem Preisalarm".

Der Zustand kommt aus cat-m-cond, demselben Feld, das auch „In Galerie
aufnehmen" benutzt. Ein zweiter Zustandswähler nur für den Alarm wäre eine
Wahl, bei der man sich widersprechen kann.

Der Alarm ist OPTIONAL: Ein Merkposten ohne Schwelle ist ein gültiger Merkposten.
Leer heisst „kein Alarm", nicht „Schwelle 0" — dieselbe Regel wie im
Set-Detail (07-admin.js).
```

<a id="merkpostenuebernehmen"></a>
## `merkpostenUebernehmen`

```text
In die Galerie übernehmen — Schritt 1: fragen.

Marcos Nachtrag: „gewisse Inhalte wie zB. Preis und Zustand, Anzahl müssen
beim Übernehmen angepasst werden." Vorher ging die Übernahme wortlos mit
Anzahl 1, ohne Kaufpreis und im Zustand des Merkpostens durch — für ein Set,
das man gerade gekauft hat, ist keins davon zuverlässig richtig.

Der Zustand ist mit dem des MERKPOSTENS vorbelegt, weil das der häufigste
Fall ist; änderbar, weil der zweithäufigste ist, dass man etwas anderes
gefunden hat.
```

<a id="bestaetigeuebernahme"></a>
## `bestaetigeUebernahme`

```text
Schritt 2: tun.

Die Regel steht am Server (src/merkliste/merkliste.ts): Er ruft addSet() — die
eine Wahrheit fürs Erfassen — und räumt danach Eintrag UND Preisalarm weg.

Der ZUSTAND geht zweimal mit, und das ist Absicht: Im Pfad steht der des
Merkpostens (die Zeile, die verschwindet), im Rumpf der, in dem erfasst wird.
Sie fallen auseinander, sobald jemand etwas anderes kauft, als er sich
gewünscht hat.

Danach werden Galerie und Kennzahlen neu geladen: Das Set ist jetzt dort,
und wer hinüberwechselt, soll es sehen und nicht eine Ansicht von vorhin.
```

<a id="oeffnemerkpostendetail"></a>
## `oeffneMerkpostenDetail`

```text
Das Detail eines Merkpostens.

── Woher die Angaben kommen ────────────────────────────────────────────────

Aus DREI Quellen, und keine davon ist neu:

  * die Zeile selbst (Zustand, Notiz, Alarm, auf der Liste seit) — sie
    liegt bereits geladen vor, GET /wanted bringt alles mit;
  * /catalog/sets/:sn für Thema, Teile, Minifiguren und die
    BrickLink-Adresse — derselbe Aufruf, den das Katalog-Detail macht;
  * /sets/:sn/price-history für Marktpreis UND Verlauf.

Der dritte ist der interessante: Er verlangt KEINEN Besitz (die Route ruft
getSetPriceHistory ohne Besitzprüfung, und price_cache/price_history hängen
am Set, nicht am Konto). /sets/:sn/price dagegen antwortet mit 404, wenn
einem das Set nicht gehört — für einen Merkposten also unbrauchbar. Nachgesehen,
nicht vermutet.

Damit braucht dieses Detail keinen einzigen neuen Endpunkt, und gezeichnet
wird es von denselben Funktionen wie der Set-Dialog.
```

<a id="zeilen"></a>
## `zeilen`

```text
Die Zeilen — dieselbe Auswahl und Reihenfolge wie im Set-Dialog, abzüglich
dessen, was einen Besitz voraussetzt.

Sie werden GENAU EINMAL je Öffnen gebaut. Die drei Angaben, die erst der
Katalog liefert, tragen eine eigene Kennung und werden später an Ort und
Stelle nachgetragen (katalogNachtragen).

── Warum nicht einfach neu zeichnen ───────────────────────────────────────

Genau das stand hier, und es war Marcos Befund „die Werte werden nicht
gespeichert": In dieser Zeilenliste steckt der ALARMBLOCK. Beim Öffnen lief
ladeAlarm() und füllte Richtung und Schwelle; kurz darauf kam die
Katalogantwort, zeichnete die Zeilen neu — und damit ein frisches, leeres
Alarmfeld. Der gespeicherte Wert war weg, und wer in dieser Sekunde schon
getippt hatte, verlor die Eingabe gleich mit.
```

<a id="inhaberwahl"></a>
## `inhaberWahl`

```text
Der Inhaber — als AUSWAHLFELD, nicht als Text.

── Marcos Befund ──────────────────────────────────────────────────────────

„Auf dem Detail-Dialog der Merkliste kann der Inhaber nicht geändert
werden." Wählbar war er nur beim Erfassen; wer sich vertippt hatte, musste
löschen und neu anlegen — und verlor dabei Preisalarm und Aufnahmedatum.

Bei EINEM Konto bleibt die Zeile leer: „gehört mir" an jeder Zeile ist
keine Auskunft. Dieselbe Regel wie bei den Erfassungsmasken
(02-gallery.js: `if (members.length < 2)`).
```

<a id="mks"></a>
## `mks`

```text
Suche entprellt, 250 ms wie in Galerie und Teileliste: Jeder Tastendruck
waere sonst ein Abruf. Zustand und Sortierung haengen ueber data-change
direkt an ladeMerkliste() — eine Auswahl trifft man einmal, nicht buchstabenweise.

Die Merkliste liegt in einem Reiter, der erst nach dem Anmelden im Baum
steht? Nein — index.html traegt alle Reiter von Anfang an, nur verborgen.
Der Wächter ist trotzdem da, weil dieselbe Datei in den Regeln ohne DOM
geladen wird (test/app-vm-importe.test.js und Geschwister).
```

<a id="importmerklistecsv"></a>
## `importMerklisteCsv`

```text
Eine Merkliste aus einer CSV einlesen.

── Warum diese Funktion so aussieht wie importFigsCsv() ────────────────────

Weil sie dasselbe tut, und weil beide Oberflächen dieselbe Antwort
auswerten: `added`, `updated`, `errors`, `skipped_hint` kommen aus
csvImportAntwort() — einer Stelle am Server. Die Übersetzungsschlüssel
(import.running, import.summary) sind ebenfalls die bestehenden; ein
eigener Satz Texte für dieselbe Aussage wäre nur eine zweite Fassung.

`skipped_hint` wird angehängt und nicht verschluckt: Ein Import mit stillen
Lücken sah sonst aus wie ein vollständiger — dieselbe Begründung steht bei
den Minifiguren.

Der Inhaber kommt aus demselben Auswahlfeld wie beim Erfassen
(selectedOwner), nicht aus dem Filter oben: Importiert wird IN ein Konto,
und das ist eine andere Frage als „wessen Liste sehe ich".
```

<a id="umaufanzeige"></a>
## `umAufAnzeige`

```text
`current` aus der Preis-Antwort in die Form, die renderMarketRows() liest.

Die Zeichenfunktion erwartet `by_condition[c].market_price`; die
Preisantwort nennt es `avg_price` — dieselbe Zahl, anderer Name, weil die
eine aus dem Cache und die andere aus der Verlaufsrechnung kommt. Eine
Umbenennung am Server hiesse, an drei Stellen gleichzeitig zu ändern.

`pnl_pct` bleibt leer: Es ist Gewinn gegen den Kaufpreis, und den hat ein
Merkposten nicht.
```
