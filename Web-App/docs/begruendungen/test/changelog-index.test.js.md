# Begründungen zu `test/changelog-index.test.js`

Die ausführlichen Kommentare aus `test/changelog-index.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Index der Fix-Historie und die Teile in CHANGELOG/ müssen zusammenpassen.

── Warum es diese Prüfung gibt (Nachtrag 148) ──────────────────────────────
CHANGELOG-fixes.md war auf 640 KB in EINER Datei gewachsen und liegt jetzt
als Teile im Ordner CHANGELOG/. Eine Aufteilung hat genau einen wunden
Punkt: Sie hält, solange jemand daran denkt. Wird ein Teil ergänzt und die
Tabelle nicht, führt der Index in die Irre — und ein Index, dem man nicht
trauen kann, ist schlechter als keiner, weil man ihm erst glaubt und dann
doch alles durchsucht.

Geprüft wird deshalb die BEZIEHUNG, nicht der Wortlaut: jede Datei steht in
der Tabelle, jede Tabellenzeile hat eine Datei, und die Nachtragsnummern
überschneiden sich nicht. Der Text der Einträge selbst wird nicht angefasst.
```

<a id="daneben"></a>
## `const daneben = [];`

```text
Der Anlass (Nachtrag 154): Beim Nachtragen der Einträge 148–153 landeten
151, 152 und 153 in `12-nachtraege-126-150.md`. Alle bisherigen Prüfungen
blieben grün — die Nummern überschnitten sich nicht, jede Datei stand im
Index, jeder Verweis stimmte. Nur hiess die Datei etwas anderes, als sie
enthielt, und genau davon lebt die Auffindbarkeit: Wer Nachtrag 152 sucht,
sieht in der Tabelle nach und öffnet die Datei mit der passenden Spanne.

Geprüft wird deshalb der Dateiname gegen seinen Inhalt. Die frühen Teile
ohne Nummerierung sind ausgenommen — bei ihnen gibt es nichts abzugleichen.
```
