# Begründungen zu `test/household.test.js`

Die ausführlichen Kommentare aus `test/household.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="p-stelle"></a>
## `const p = require('./helpers/sources').portfolioQuelle();`

```text
Die Aussage bleibt, der Weg dahin hat sich geändert (Nachtrag 82): Die
Portfolio-Schnappschüsse ('__portfolio__<id>') gibt es nicht mehr. Sie
lagen je Konto zu unterschiedlichen Zeitpunkten — addiert ergäben sie
Einbrüche, die nie stattgefunden haben — und sie hielten fest, was AN
JENEM TAG erfasst war, konnten also nicht rückwirkend rechnen.

Jetzt wird für JEDE Kontoauswahl aus dem Verlauf JE SET rekonstruiert. Der
ist nicht kontogebunden, also gilt die Kurve auch für die Zeit vor einer
Verknüpfung.
```

<a id="mv-stelle"></a>
## `const mv = require('./helpers/sources').ohneKommentare(require('./help`

```text
Ein direktes UPDATE hinterliesse im Zielkonto zwei Erfassungen desselben
Tages — genau den Zustand, den der Bearbeiten-Pfad ablehnt.
ohneKommentare(): Die BEGRÜNDUNGEN dieser Regeln stehen in setMove.ts als
Kommentar, und sie ZITIEREN die Anweisungen, die es nicht mehr geben darf
(„hier stand dafuer UPDATE sets SET quantity=$1"). Auf dem Rohtext meldete
die Regel genau diesen Erklärtext — gemessen. Dieselbe Falle wie bei der
Haushaltsregel weiter oben.
```

<a id="acq-stelle"></a>
## `const acq = read('routes/api_v1/acquisitions.ts');`

```text
Ganzes Set und einzelne Kaufpreise laufen durch DIESELBE Umsetzung — der
Teilfall ist kein Sonderweg, sondern der allgemeine Fall mit Auswahl.

Seit Nachtrag 70 zählen wir über BEIDE Dateien: Die Erfassungs-Routen
wurden aus routes/sets.ts entfernt und leben nur noch in der v1-Fabrik,
die jetzt Webapp UND App bedient. Vorher standen beide Aufrufe in einer
Datei; die Regel („beide Wege nutzen denselben Helfer") ist unverändert,
nur ihr Ort hat sich geändert.
```

<a id="for-stelle-2"></a>
## `for (const feld of ['add-owner', 'ap-owner', 'af-owner', 'cat-m-owner'`

```text
Alle drei Erfassen-Formulare bekommen dieselbe Liste — Set, manuelles
Teil, manuelle Minifigur. Vorher war die Kontoauswahl nur bei Sets da.
Seit Nachtrag 66 sind es VIER Formulare — der Katalog-Dialog („In Galerie
aufnehmen") war als einziger nicht angeschlossen und erfasste immer aufs
eigene Konto. Der Test pinnt deshalb nicht mehr die Liste als Ganzes,
sondern jeden Erfassungsweg einzeln: So wird er rot, wenn einer FEHLT,
aber nicht, wenn ein weiterer dazukommt.
```

<a id="for-stelle-3"></a>
## `for (const f of ['routes/api_v1/sets.ts']) {`

```text
Ein Set als Ganzes zu verschieben klingt bequem, verdeckt aber, was
tatsächlich wandert: Drei Erfassungen sind drei Käufe, die im Haushalt
verschiedenen Kindern gehören können. Wer alles verschieben will, ändert
jede Zeile — und sieht dabei, wie viele es sind.
Nur noch die Fabrik: Die /move-Route der Webapp ist mit Nachtrag 74
entfallen, beide Clients nutzen dieselbe. Regel unverändert.
```

<a id="auch-manuelle-teile-und-minifiguren-wand"></a>
## `test('auch manuelle Teile und Minifiguren wandern über den Kaufpreis',`

```text
── Was diese Regel prüft, und was NICHT ────────────────────────────────────

Sie prüft den QUELLTEXT. Das reicht für die Aussage „alle drei Arten gehen
durch DIESELBE Umsetzung" — eine Einzige-Stelle-Regel, die kein Lauf
beweisen kann, weil zwei Kopien sich ja gleich verhalten würden.

Sie reicht NICHT für die Aussage „der Weg lebt". Genau daran ist sie einmal
vorbeigegangen: `moveManualAcquisition` wurde gerufen, wie hier zugesichert
— und löschte beim Absender den gesamten Bestand, weil sie eine Spalte las,
die Migration 0038 entfernt hatte. Das Muster bestand, der Weg war kaputt.

Der Lauf über die Route steht deshalb in
test/kontowechsel-ueber-die-route-db.test.js (alle drei Arten, beide
Abweisungen), die Mengenerhaltung in
test/erfassung-verschieben-rest-bleibt-db.test.js. Diese Regel hier bleibt
als Ergänzung — sie fängt, was ein Lauf nicht sieht.
```
