# Begründungen zu `test/workmanager-abruf.test.js`

Die ausführlichen Kommentare aus `test/workmanager-abruf.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
WorkManager faehrt auf ABRUF hoch — und die beiden Haelften davon bleiben
zusammen.

── Woher diese Datei kommt ─────────────────────────────────────────────────

Marco: „Die Android-App startet nicht mehr." Absturz beim Oeffnen, kein
Geraetezugriff, kein logcat.

Der einzige neue Code im Startpfad war WorkManager. Der meldet sich ueber
androidx.startup an, und das laeuft in einem ContentProvider — also VOR
Application.onCreate(). Alles, was dort schiefgeht, toetet die App, bevor
eine eigene Zeile gelaufen ist; das `runCatching` um den Alarm sitzt eine
Stufe zu spaet und kann gar nichts auffangen.

Ein abschaltbarer stuendlicher Abruf, in der Vorgabe AUS, gehoert nicht in
den Pfad, den jeder Start durchlaufen muss. Deshalb steht der Eintrag jetzt
per tools:node="remove" nicht mehr im Manifest, und WorkManager faehrt beim
ersten getInstance() hoch — das ist einplanen(), und das steht im
runCatching.

── Warum es dafuer eine Pruefung braucht ───────────────────────────────────

Die Umstellung hat ZWEI Haelften, und wer nur eine macht, baut einen
Absturz ein, den kein Uebersetzer findet:

  * Nur das Manifest geaendert  -> der erste getInstance() wirft
    „WorkManager is not initialized properly … your Application does not
    implement Configuration.Provider". Uebersetzt sauber.
  * Nur die Application geaendert -> WorkManager faehrt weiter beim Start
    hoch, die Configuration.Provider wird nie gefragt. Uebersetzt sauber,
    und der Grund fuer die ganze Uebung ist stillschweigend weg.

Beides faellt erst auf dem Geraet auf. Hier faellt es vor dem Push auf.

── Warum im Web-Testbaum ───────────────────────────────────────────────────

Dieselbe Begruendung wie bei app-vm-importe.test.js: In diesem Baum ist die
GitHub-Action der einzige Kotlin-Compiler. Ein Kotlin-Test meldete dasselbe
neun Minuten spaeter. Die Pfade sind ausgeschrieben (baumbruecken.test.js).
```

<a id="stelle"></a>
## `const stelle = app.indexOf('.einplanen(');`

```text
`.einplanen(` und nicht `PreisalarmWorker.einplanen`: Der Aufruf steht seit
dem 25.09. ueber zwei Zeilen, weil er sein Ergebnis auswertet. Eine Suche
nach der zusammenhaengenden Zeichenkette fand ihn dadurch nicht mehr — und
diese Pruefung meldete, der Alarm werde beim Start gar nicht mehr
eingeplant. Sie hatte recht in der Form und unrecht in der Sache; das ist
der Unterschied zwischen „liest den Quelltext" und „liest den Baum".
```

<a id="worker"></a>
## `const worker = fs.readFileSync(path.join(__dirname, '..', '..', 'Andro`

```text
── Die zweite Haelfte, seit dem 25.09. ──────────────────────────────────

Dieses runCatching hier war die EINZIGE Absicherung, und genau darin lag
der naechste Absturz: Am Schalter im Einstellungsbildschirm stand derselbe
Aufruf nackt, und dort ist es der Hauptthread einer sichtbaren
Oberflaeche. Marco: „Sobald ich den Schalter Preisalarm in der App
aktivieren will, wird die App geschlossen."

Seither faengt einplanen() selbst. Diese Pruefung bleibt trotzdem stehen:
Sie sichert den START, und das Lesen der Einstellung davor kann ebenfalls
scheitern. Dass die Funktion nicht mehr werfen KANN, prueft
test/alarm-einplanen-faellt-nicht.test.js — hier steht nur der Verweis,
damit niemand die eine fuer die andere haelt.
```
