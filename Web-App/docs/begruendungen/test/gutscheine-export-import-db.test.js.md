# Begründungen zu `test/gutscheine-export-import-db.test.js`

Die ausführlichen Kommentare aus `test/gutscheine-export-import-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Gutschein-Export und -Import über ihre echten Adressen.

── Warum es diese Datei NEBEN gutschein-pdf-schreiben.test.js gibt ─────────

Die dort prüft das Modul: ersetzen, verbinden, zurücklesen. Hier läuft der
WEG — GET /api/v1/vouchers/export/pdf und POST /api/v1/vouchers/pdf,
mit echter Datenbank und echten Dateien auf der Platte. Genau diese
Trennung ist in dieser Sitzung zweimal teuer geworden: Ein Modul kann
stimmen, während die Route es falsch oder gar nicht ruft.
```

<a id="sandkasten"></a>
## `const SANDKASTEN = fs.mkdtempSync(path.join(os.tmpdir(), 'gutschein-wu`

```text
── APP_ROOT, nicht DATA_DIR ──────────────────────────────────────────────

src/infra/appPaths kennt KEINE Umgebungsvariable DATA_DIR; es leitet
DATA_DIR = <APP_ROOT>/data ab und liest nur APP_ROOT. Mein erster Versuch
setzte DATA_DIR — wirkungslos, und der Lauf meldete drei „erzeugt" statt
„ersetzt/unveraendert/erzeugt", weil die Route die Dateien nicht fand.
Festgehalten, weil die falsche Variable eine Lage erzeugt, die nach einem
Fehler im Code aussieht und einer im Testaufbau ist.

Gesetzt werden MUSS es vor dem Laden: appPaths rechnet die Pfade beim
Einlesen aus. Ohne das schriebe der Test in das echte Datenverzeichnis.
```
