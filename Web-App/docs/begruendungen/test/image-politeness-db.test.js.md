# Begründungen zu `test/image-politeness-db.test.js`

Die ausführlichen Kommentare aus `test/image-politeness-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Schonender Umgang mit dem Bildserver.

── Marcos Vorgaben ─────────────────────────────────────────────────────────
„Throttling & Delays: Baue eine künstliche Verzögerung von mindestens 500 bis
1000 ms zwischen den einzelnen Bild-Requests ein.
 Kein paralleler Download: Lade Bilder nacheinander herunter.
 Passender User-Agent: Nutze einen sauberen, eindeutigen User-Agent-Header.
 Nur 30 Requests pro Minute."

── Gemessen ────────────────────────────────────────────────────────────────
    Bilder im Durchgang       10
    gleichzeitige Downloads    1
    Abstände (ms)              754 … 1002
    Rate                       10 je 20 s = 30 je Minute

── Warum unbedingt und nicht erst ab 200 Bildern ───────────────────────────
Marco hatte die Vorgaben für Läufe über 200 Bildern gestellt. Zwei Verhalten
einzubauen hiesse, beide zu pflegen und zu prüfen — für den Gewinn, beim
Blättern drei Bilder eine Sekunde früher zu haben. Der Vorablauf ist ohnehin
nichts, worauf jemand wartet.

Voraussetzung: Test-DB via TEST_DATABASE_URL.
```

<a id="stelle"></a>
## `try { await db.initSchemaOnce(); }`

```text
── Marcos Log (Nachtrag 116) ─────────────────────────────────────────────
Zeile um Zeile „[image-queue] N Bilder lokal abgelegt", dazwischen
`Connection terminated due to connection timeout` — bis hin zum
Sitzungsspeicher, der keine Verbindung mehr bekam.

Die Pause hing an einem Zähler, der nur echte DOWNLOADS zählte. Lag ein
Bild bereits lokal, fehlte ihm aber die Vorschau, lief ein anderer Zweig:
Vorschau rechnen, weiter — ohne Pause. Nach dem Knopf „Katalogbilder holen"
ist genau das der Normalfall, denn tausende Bilder lagen schon.

Eine Verkleinerung ist die TEUERSTE Einzelarbeit im Server. Dass die Pause
ausgerechnet den teuren Teil nicht betraf, war der Fehler.
```

<a id="dist"></a>
## `const dist = path.join(ROOT, 'dist', 'src/katalog/bilder/setImages.js'`

```text
── Und die Version muss die ECHTE sein (Nachtrag 114) ────────────────────

Marcos Frage „Was wird neu als user_agent gesendet?" deckte auf, dass dort
„3.0" stand statt der Installationsversion. Grund war
`require('../package.json')`: Die Auflösung geht vom Ordner des MODULS aus,
nicht vom Projekt. Übersetzt liegt das Modul unter `dist/routes/`, sucht
also `dist/package.json` — die es nicht gibt. Der Fehler landete im
`catch`, übrig blieb ein Vorgabewert, der seit Jahren nicht stimmt.

Geprüft wird deshalb am ÜBERSETZTEN Stand, nicht an der Quelle: Genau
zwischen beiden lag der Fehler.
Die Version kommt seit dem Versionsumbau aus dist/version.json (scripts/version.js).
```
