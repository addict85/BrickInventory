# Begründungen zu `test/catalog-images-button-db.test.js`

Die ausführlichen Kommentare aus `test/catalog-images-button-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Knopf „Katalogbilder holen" und die Vorschau dazu.

── Marcos Wunsch ───────────────────────────────────────────────────────────
„Kannst du im Monitoring beim Bilder-Download-Job noch einen Button
erstellen. Wenn dieser geklickt wird, sollen alle fehlenden Bilder des
Katalogs heruntergeladen werden resp. in die Queue gestellt werden. Bitte
auch prüfen, dass für Katalogbilder jeweils ein Thumbs-Image erstellt wird,
wenn es heruntergeladen wurde."

Bisher füllte sich der lokale Bildbestand nur beim Blättern: Was man nie
ansieht, wird nie geholt. Für ein gezieltes Vorbefüllen fehlte der Anstoss.

── Die Aufteilung, die hier geprüft wird ───────────────────────────────────
Der Knopf REIHT NUR EIN — in einer einzigen Anweisung, ohne je Datei zu
prüfen. Bei 25 000 Sets wären das ebenso viele Dateizugriffe in einer
Anfrage; auf einem Raspberry Pi eine spürbare Blockade.

Die Prüfung gehört dorthin, wo ohnehin gedrosselt gearbeitet wird: Der Job
überspringt, was schon lokal liegt — und holt dort eine FEHLENDE Vorschau
nach. Das ist der zweite Teil von Marcos Frage, und er betrifft alle Bilder,
die vor dem Hintergrund-Job abgelegt wurden.

── Gemessen ────────────────────────────────────────────────────────────────
Zehn Katalog-Sets; eines mit Bild ohne Vorschau, eines mit beidem, eines mit
bekannter Fehlanzeige:

    eingereiht        9   (die Fehlanzeige bleibt aussen vor)
    Downloads         7   (die beiden vorhandenen werden übersprungen)
    Vorschau für das Bild ohne Vorschau: ja
    Vorschau für das Bild mit Vorschau:  nein

Voraussetzung: Test-DB via TEST_DATABASE_URL.
```

<a id="stelle"></a>
## `assert.equal(d.queued, 8,`

```text
── Fertiges bleibt aussen vor (Nachtrag 119) ────────────────────────

Marcos Befund: „Wenn ich auf den Button klicke, werden immer ca. 29 000
Bilder eingereiht. Auch wenn der Job bereits einmal erfolgreich
durchgelaufen ist."

In der Bühne oben liegt _2 mit Bild UND Vorschau — das ist fertig und
gehört nicht in die Warteschlange. _1 hat nur das Bild, ihm fehlt die
Vorschau: Das gehört hinein, der Job holt sie nach, ohne erneut zu
laden. _3 trägt einen BESTÄTIGTEN 404 und bleibt draussen. _4 trägt
eine Fehlanzeige ohne Grund — die wird zurückgenommen (Nachtrag 124),
ist also dabei.

Bleiben also acht von zehn — und _4 ist eine davon. Ohne die Rücknahme
wären es sieben.
```

<a id="stelle-2"></a>
## `await db.run('DELETE FROM image_wanted');`

```text
Der eigentliche Befund: Nach einem vollen Durchlauf brachte jeder Klick
den ganzen Katalog zurück in die Warteschlange. Der Job arbeitete das
richtig ab (Datei da → überspringen), aber die Kachel zeigte
Zehntausende offene Bilder, und jede Notiz kostete einen Durchgang.

Hier wird der Durchlauf nachgestellt: ALLE Sets bekommen Bild und
Vorschau. Danach darf nichts mehr eingereiht werden.
```
