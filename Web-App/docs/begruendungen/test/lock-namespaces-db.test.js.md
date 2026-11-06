# Begründungen zu `test/lock-namespaces-db.test.js`

Die ausführlichen Kommentare aus `test/lock-namespaces-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Sperr-Namensräume gegen eine ECHTE Datenbank.

── Was hier anders ist als vorher (Nachtrag 149) ───────────────────────────
Die Regel „zwei Vorgänge dürfen sich nicht denselben Namensraum teilen" war
bisher nur als Quelltextprüfung da, in test/rate-limit.test.js:

    const belegt = ['42', '77', '11223344', '99999999'];
    const gewaehlt = job.match(/const PRICE_JOB_LOCK = (\d+)/)[1];
    assert.ok(!belegt.includes(gewaehlt));

Das prüfte EINE Konstante gegen eine von Hand gepflegte Liste — die 55, 56,
57 und 58 nicht enthielt, obwohl es alle vier längst gab. Eine Kollision mit
dreien davon wäre durchgegangen, und der Test wäre dabei grün geblieben.

Hier wird stattdessen gemessen, worum es geht: Zwei Verbindungen greifen
gleichzeitig nach Sperren. Verschiedene Namensräume dürfen sich nicht
behindern, derselbe muss es. Das ist eine Aussage über PostgreSQL-Verhalten,
und sie lässt sich nicht durch eine Umbenennung, ein neues Zahlenformat
(918_273_645) oder eine vergessene Listenpflege aushebeln.
```
