# Begründungen zu `test/require-exports.test.js`

Die ausführlichen Kommentare aus `test/require-exports.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Späte require()-Aufrufe zwischen Servermodulen gibt es nicht mehr.

Für `import` prüft TypeScript Pfad und Namen; ein `require('./x')` ergibt
`any`, ein falscher Name wird erst beim Aufruf zum TypeError, und beim
Verschieben einer Datei zieht kein Werkzeug den Pfad mit. Mit geschichteten
Modulen braucht es keinen Zyklus-Umweg mehr; übrig bleiben nur Pakete, die
bewusst spät geladen werden (sharp, Jimp, archiver).
```

<a id="kein-test-holt-ein-modul-aus-dist-das-es"></a>
## `test('kein Test holt ein Modul aus dist/, das es nicht gibt', () => {`

```text
Der Anlass (Nachtrag 148): set-condition-aggregate.test.js holte auf Zeile
679 `utils/handlers.js` — aufgeteilt seit Nachtrag 133. Der Aufruf steht auf
DATEIEBENE, also starb die ganze Datei beim Laden; die zehn Prüfungen
darunter liefen nie mehr. Sichtbar war das nur an einer Zahl („nicht ok" für
die Datei), und solange in einem gewachsenen dist/ noch eine alte
handlers.js lag, nicht einmal daran.

Diese Prüfung stellt die einzige Frage, die zählt: Gibt es die Datei, die
ein Test aus dist/ holen will? Ein Umbau, der ein Modul aufteilt oder
umbenennt, wird dadurch an der Stelle rot, an der er etwas übersehen hat —
nicht erst dort, wo jemand die fehlenden Prüfungen vermisst.
```
