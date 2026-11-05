# Begründungen zu `test/setnummer-schreibweise-db.test.js`

Die ausführlichen Kommentare aus `test/setnummer-schreibweise-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Eine Set-Nummer wird ueberall gleich geschrieben.

── Der Fehler, den das verhindert ──────────────────────────────────────────
Die Zeile

    setNumber.includes('-') ? setNumber : `${setNumber}-1`

stand VIERUNDZWANZIGMAL im Baum, in zwoelf Dateien. Solange alle
Fundstellen sie gleich schreiben, faellt das nicht auf. Es reicht aber
eine, die es nicht tut — und dann suchen zwei Stellen unter verschiedenen
Namen nach derselben Sache.

Genau das war der Fall bei der Frage „kennt BrickLink dafuer gar keinen
Preis?". Die Markierung schreibt clients/bricklink.ts unter der Nummer MIT
Anhang; die Vorpruefungen im Preis-Job und im Anfrageweg suchten unter der
ROHEN. NACHGEMESSEN, gleiche Markierung, gleiches Set:

    Eingabe                Job                    Anfrageweg
    ohne Versionsanhang    error, 1 Abruf         wirft, 2 Abrufe
    mit  Versionsanhang    skipped_gear, 0        still,  0

Drei BrickLink-Abrufe fuer ein Set, von dem im Katalog steht, dass es
keinen Preis hat — je Lauf, auf Kosten des Tageskontingents. Und der Job
zaehlte es als Fehler statt als uebersprungen.

── Warum das ein Verhaltenstest ist ────────────────────────────────────────
Die Aussage ist „beide Wege antworten gleich, egal wie der Aufrufer die
Nummer schreibt". Am Quelltext waere nur zu sehen, dass beide dieselbe
Funktion rufen — nicht, dass dabei dasselbe herauskommt.
```

<a id="for-stelle"></a>
## `for (const m of [/\.includes\('-'\)\s*\?/,             // die haeufigs`

```text
── Warum drei Muster ──────────────────────────────────────────────
Der erste Entwurf suchte NUR nach `.includes('-') ?`. Damit ging
src/katalog/bricklinkLink.ts durch: Dort stand dieselbe Regel als
`/-\d+$/.test(n) ? n : `${n}-1``, also eine dritte Fassung — und die
Prueflung blieb gruen, obwohl die Regel weiter zweimal dastand.
Eine Suche, die nur EINE Schreibweise kennt, findet nur, was schon
gleich geschrieben ist.
```

<a id="stelle"></a>
## `assert.deepEqual(eigene, ['src/infra/setNummer.ts'],`

```text
KEINE Ausnahmen mehr. src/sets/setAdd.ts und src/sets/setService.ts trugen den
Normalisierer zuletzt noch absichtlich doppelt, mit zwei Begruendungen:
ein Import baue einen Kreis, und set-add-exists-db.test.js fuehre beide
Ruempfe ISOLIERT aus. Beides galt nicht mehr — der Kreis war zwischen
JENEN BEIDEN Modulen, und src/infra/setNummer.ts ist ein Blatt; die Isolation
war eine Eigenart des Tests, der den Rumpf per `new Function`
heraussschnitt, obwohl beide Funktionen exportiert sind. Er vergleicht
sie jetzt als Funktionen, und beide reichen an normalisiereSetNummer()
durch.
```
