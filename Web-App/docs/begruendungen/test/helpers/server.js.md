# Begründungen zu `test/helpers/server.js`

Die ausführlichen Kommentare aus `test/helpers/server.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Ein Express-Server für einen Test.

── Warum es diesen Helfer gibt ─────────────────────────────────────────────

Achtunddreissig Testdateien bauen sich einen Server, und zwanzig davon taten
es zeichengleich:

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { userId: uid };
      req.apiUser = { user_id: uid, is_admin: 0 };
      next();
    });
    app.use('/api/v1', _req('routes/api_v1/index.js'));
    const srv = app.listen(0);
    const base = `http://localhost:${srv.address().port}`;

Das ist Gerüst, keine Regel — zwei Fassungen davon können nicht
auseinanderlaufen und dabei ein falsches Ergebnis erzeugen. Deshalb ist es
auch nicht dringend gewesen. Der Gewinn liegt woanders:

 1. Das ABRÄUMEN steht an einer Stelle. Etliche Dateien schlossen den Server
    gar nicht; wer es tat, tat es am Ende des Rumpfes — und damit NICHT
    mehr, sobald eine Zusicherung davor scheitert. Aus einem roten Test wird
    dann ein hängender, und die Meldung sieht niemand. Genau das ist in
    dieser Reihe zweimal passiert (schema-start-ohne-fehler,
    background-jobs-start), beide Male beim Gegenprobieren.

 2. Wer einen neuen Testserver braucht, findet hier die Form, statt sie aus
    einer beliebigen Nachbardatei zu kopieren.

Die achtzehn abweichenden Dateien bleiben, wie sie sind: Sie hängen zwei
Server nebeneinander, schieben eigene Middleware davor oder stellen die
Sitzung je Aufruf um. Sie hier hineinzuzwingen hiesse, dem Helfer für jeden
Sonderfall einen Schalter zu geben — dann liest sich der Aufruf schlechter
als die fünf Zeilen, die er ersetzt.
```
