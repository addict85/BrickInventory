# Begründungen zu `test/image-queue-pace-db.test.js`

Die ausführlichen Kommentare aus `test/image-queue-pace-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="ladenschlaegtfehl"></a>
## `let ladenSchlaegtFehl = false;`

```text
Schalter für den abgefangenen Download.

EIGENE FALLE (Nachtrag 122): Der erste Anlauf stellte `downloadSetImage` im
Teilschritt per Object.defineProperty auf null um. Wirkungslos — der
require-Abfang oben in dieser Datei liefert für diesen Namen IMMER seinen
eigenen Ersatz und überschreibt den Patch stillschweigend. (Dieselbe Klasse
wie die esbuild-Getter aus Nachtrag 143: Ein Monkeypatch, dessen WIRKUNG man
nicht beobachtet, ist keine Prüfung.) Der Ersatz trägt den Schalter deshalb
selbst.
```

<a id="stelle"></a>
## `try { await db.initSchemaOnce(); }`

```text
── Was der Kommentar behauptete und der Code nicht tat ───────────────────
Bei NOTIZ_GILT_MS stand „Ältere Notizen als diese verfallen". Die Abfrage
des Stapels grenzte aber nur ein, was sie AUSWÄHLT — gelöscht wurde nie
etwas. Alte Notizen blieben also für immer liegen, zählten weiter in der
Kachel und liessen den Job verstummen, weil die Logzeile an `gesamt > 0`
hängt. Von aussen: eine Warteschlange, die bei einer Zahl stehenbleibt.
```

<a id="execfilesync"></a>
## `execFileSync(process.execPath, ['-e', '`

```text
Der Kindprozess kennt NICHTS aus diesem hier — er baut nicht, sondern nutzt
das bereits erzeugte dist/ und legt nur einen Takt hin.
── Warum das Kind die Adresse NICHT selbst setzt ────────────────────────
Hier stand als erste Zeile des Kind-Skripts
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
und genau das hat diesen Test in einer Umgebung ohne TEST_DATABASE_URL nie
laufen lassen: Der Elternprozess faellt oben auf
'postgres://tester:test@localhost/cattest' zurueck, das Kind nicht. Es
bekam undefined, die Verbindung scheiterte, execFileSync warf.

Dass dieser Untertest rot ist, war dabei noch das Harmlose. Mehrfach
beobachtet: Der Lauf der ganzen Datei brach danach ab mit
    Unable to deserialize cloned data due to invalid or unsupported version
— 2 statt 13 Untertests, und die Meldung sagt nichts ueber die Ursache.
Nicht jedes Mal; die Reparatur zielt deshalb auf die Ursache, nicht auf
das Abbruchverhalten.

DATABASE_URL ist ueber env: process.env ohnehin geerbt, und zwar mit dem
Wert, den der Elternprozess WIRKLICH benutzt. Es gibt also nichts zu setzen.
```

<a id="iqhier"></a>
## `const IQhier = _req('jobs/imageQueue.js');`

```text
── Und jetzt bis zur KACHEL ──────────────────────────────────────────────

Die Zeile in der Datenbank allein sagt nichts: Läse die Route weiterhin den
Modulspeicher, bliebe alles beim Alten. Gefragt wird deshalb der Endpunkt,
den die Überwachung fragt — in diesem Prozess, der den Job NIE ausgeführt
hat.
Der Modulspeicher DIESES Prozesses wird geleert: Frühere Prüfungen dieser
Datei haben den Job hier laufen lassen, ein Worker, der nur Anfragen
bedient, hätte den Merker aber nie gefüllt. Genau dieser Zustand ist der
Normalfall — in drei von vier Prozessen.
```

<a id="jeder-ausgang-der-schleife-hat-einen-zae"></a>
## `test('jeder Ausgang der Schleife hat einen Zähler', { concurrency: 1 }`

```text
── Nachtrag 122 ────────────────────────────────────────────────────────────
Marcos Log: „2 bearbeitet: 0 geladen, 0 Vorschau erzeugt, 0 bereits
vorhanden" — zweimal, und seine Frage: „Wieso werden die 2 Bilder nicht
geladen?" Die Zahlen gingen nicht auf, weil VIER Wege durch die Schleife
endeten, ohne einen der drei Zähler zu erhöhen. Die Meldung konnte die vier
nicht unterscheiden.
```
