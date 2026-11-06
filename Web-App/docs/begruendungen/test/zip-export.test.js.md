# Begründungen zu `test/zip-export.test.js`

Die ausführlichen Kommentare aus `test/zip-export.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der ZIP-Export erzeugt ein gültiges Archiv — mit genau der API, die
routes/settings.ts benutzt.

── Warum es diesen Test gibt (Nachtrag 140) ────────────────────────────────

`npm install` warnte:
    npm warn deprecated glob@10.5.0: Old versions of glob are not supported…

glob ist keine eigene Abhängigkeit: archiver → archiver-utils → glob.

Der naheliegende Weg — archiver auf 8 heben — wäre damals ein Bruch gewesen:
archiver 8 ist `type: module` und exportiert KEINE Funktion mehr, sondern
die Klassen Archiver/ZipArchive. Bemerkt habe ich das nur, weil ich nach dem
Update ein ZIP erzeugt habe statt bloss die Tests laufen zu lassen — der
Export hatte keinen Test, der ihn ausführt. Diese Datei ist die Antwort
darauf.

Gewählt wurde zunächst ein `overrides`-Eintrag auf glob ^13: archiver blieb
bei 7, die veraltete Abhängigkeit verschwand.

── Und jetzt doch auf 8 (05.10.) ───────────────────────────────────────────

Marco wollte die Abhängigkeiten auffrischen. Der Umbau ist zwei Zeilen in
routes/settings.ts: `archiver('zip', opts)` wird `new ZipArchive(opts)`.

NACHGEMESSEN gegen archiver 8.0.0, bevor etwas umgeschrieben wurde:
  require('archiver')  → Objekt mit Archiver/JsonArchive/TarArchive/ZipArchive
  new ZipArchive(opts) → trägt append, pipe, finalize und on('error')
  und erzeugt ein Archiv mit PK-Signatur.

Dass CommonJS das ESM-Paket überhaupt holen kann, ist kein Zufall und kein
Risiko: `require()` eines ESM-Moduls ist seit Node 22.12 stabil, und wir
fahren im Bild wie in der CI Node 26.

Die erste Prüfung unten hat deshalb ihre AUSSAGE gewechselt, nicht bloss
ihren Wortlaut: Sie hielt fest, dass der Export aus CommonJS heraus
benutzbar ist. Das tut sie weiterhin — nur heisst „benutzbar" jetzt
„konstruierbar" statt „aufrufbar".
```

<a id="mod-stelle"></a>
## `const mod = require('archiver');`

```text
Die Aussage ist dieselbe geblieben: Der Server ist CommonJS, und was er
`require()`t, muss er auch benutzen können. Geändert hat sich, was
„benutzen" heisst — in archiver 7 eine Funktion aufrufen, seit 8 eine
Klasse konstruieren.

Geprüft wird beides und nicht nur der Name: Ein Export, der zwar da ist,
sich aber nicht konstruieren lässt, wäre für routes/settings.ts genauso
wertlos wie gar keiner.
```

<a id="lock"></a>
## `const lock = require(path.join(__dirname, '..', 'package-lock.json'));`

```text
Der Auslöser. Wandert glob 10 über eine andere Bibliothek zurück, soll das
auffallen — die Warnung im Installationslog liest niemand zuverlässig.

── Was sich am 05.10. geändert hat ──────────────────────────────────────
Der `overrides`-Eintrag auf glob ^13 ist WEG. Er war der Preis dafür, auf
archiver 7 zu bleiben; mit archiver 8 zieht GAR NIEMAND mehr glob.
Nachgemessen: Eintrag entfernt, neu aufgelöst, kein glob im Baum.

Diese Prüfung bleibt und ist jetzt die einzige Absicherung. Das ist kein
Verlust, sondern die Umkehrung: Vorher erzwang ein Eingriff in einen
fremden Abhängigkeitsbaum das Ergebnis, und die Prüfung bestätigte es.
Jetzt stellt die Prüfung fest, wenn es jemand zurückbringt — und dann
entscheidet man neu, statt eine Festlegung weiterzuschleppen, die ihren
Anlass überlebt hat.
```
