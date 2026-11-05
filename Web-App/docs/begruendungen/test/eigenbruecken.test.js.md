# Begründungen zu `test/eigenbruecken.test.js`

Die ausführlichen Kommentare aus `test/eigenbruecken.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Jeder Pfad, mit dem ein Test eine QUELLDATEI liest, muss auch dorthin zeigen.

── Woher das kommt ─────────────────────────────────────────────────────────
test/baumbruecken.test.js tut genau das fuer den ANDEREN Baum: Es loest alle
Pfade auf, mit denen Web-Tests in den Android-Baum greifen, und meldet jeden,
der ins Leere zeigt. Fuer den EIGENEN Baum gab es nichts dergleichen — und
das ist die haeufiger benutzte Richtung: 56 Testdateien lesen Quelltext.

Aufgefallen beim Verschieben von routes/thumbs.ts nach utils/: Neun Nutzer
waren umgehaengt, die Suite trotzdem rot. Der Grund war test/thumbs-sharp.js
mit

    path.join(ROOT, 'routes', 'thumbs.ts')

— derselbe Pfad in einer anderen SCHREIBWEISE, den meine Ersetzung
('routes/thumbs.ts') nicht traf. Dieselbe Sache zweimal geschrieben, und nur
eine davon nachgezogen: die Fehlerart, gegen die dieser Baum sonst ueberall
angeht.

Ohne diese Pruefung faellt so etwas erst auf, wenn ein Test SEINETWEGEN rot
wird. Schlimmer ist der andere Ausgang: Liest ein Test eine Datei, die es
nicht mehr gibt, mit einem `catch` daneben oder ueber einen `indexOf`, der
-1 liefert, dann prueft er nichts mehr und schweigt.

── Was hier geprueft wird und was nicht ────────────────────────────────────
Erkannt werden zwei Formen:
  read('src/konto/auth.ts')            — eine Zeichenkette mit Ordner und Endung
  path.join(ROOT, 'utils', 'x.ts') — Segmente, alle als Literal
Pfade mit einem variablen Segment sind nicht aufloesbar; sie werden GEZAEHLT
und gemeldet, nicht uebergangen — eine Pruefung, die verschweigt, was sie
ausgelassen hat, ist die naechste Luecke.

Ausfuehren: npm test
```

<a id="existiertquelle"></a>
## `function existiertQuelle(rel) {`

```text
Gibt es diese Datei — oder die Quelle, aus der sie gebaut wird?

── Warum die zweite Frage noetig ist ───────────────────────────────────────
Die DB-Tests laden ihre Module ueber `_req('db/database.js')`. Das ist ein
Pfad in dist/, nicht in den Quellbaum: Die .js entsteht erst beim Bauen.
Der erste Entwurf dieser Pruefung hielt alle 319 solchen Pfade fuer kaputt.

Gegen dist/ zu pruefen waere der naheliegende Ausweg und der schlechtere:
dist/ ist ein Bauartefakt, das je nach Zeitpunkt Altbestand enthaelt — genau
daran ist in Nachtrag 148 ein Test monatelang gruen geblieben, der eine
laengst geloeschte Datei las. Geprueft wird deshalb die QUELLE: Gibt es
db/database.ts, dann ist db/database.js ein gueltiger Ladepfad.
```

<a id="istabwesenheitspruefung"></a>
## `const istAbwesenheitsPruefung = (src, bis) => /!\s*fs\.existsSync\($/.`

```text
Steht der Pfad in einer ABWESENHEITS-Zusicherung?

test/img-proxy.test.js prueft mit `assert.ok(!fs.existsSync(...))`, dass
ein ausgebauter Job restlos weg ist. Dort ist die fehlende Datei genau das
Ergebnis, das der Test verlangt — sie als Bruch zu melden hiesse, einen
gesunden Test fuer krank zu erklaeren. Der erste Entwurf dieser Pruefung
tat genau das.
```

<a id="stelle"></a>
## `assert.ok(abwesend.length <= 3,`

```text
Zweite Schreibweise desselben Pfades ist erlaubt; ein VARIABLES Segment
nimmt der Pruefung aber die Sicht. Ein paar Faelle sind legitim (ein Test,
der eine Liste von Dateien durchgeht) — die Zahl darf nur nicht wachsen,
ohne dass es jemand merkt.
Erwartete Abwesenheiten sind kein Fehler, aber auch nicht beliebig viele:
Jede ist eine Behauptung ueber Code, den es NICHT gibt, und die veraltet
genauso. GEMESSEN ist es derzeit eine.
```

<a id="stelle-2"></a>
## `assert.ok(offen.length <= 76,`

```text
GEMESSEN: 62, und die Zahl ist nicht das Problem, das sie auf den ersten
Blick scheint. Fast alle sind SCHLEIFENVARIABLEN (`f`, `datei`, `rel`,
`ordner`) — Tests, die eine Liste von Dateien durchgehen. Das ist ein
gutes Muster; es auszuschreiben wuerde die Tests schlechter machen.

Hier stand zuerst 12: eine Zahl, die ich GERATEN und nicht gemessen habe.
Sie haette die Pruefung von Anfang an rot gehalten und damit unbrauchbar
gemacht. Die Schranke sitzt jetzt knapp ueber dem gemessenen Stand — sie
fragt „ist es MEHR geworden", nicht „ist es viel".

70 -> 71 (Nachtrag 140): test/zahlentastatur.test.js geht alle Dateien in
public/js durch und liest sie ueber die Schleifenvariable. Genau der Fall,
den der Absatz darueber als gutes Muster beschreibt — ausgeschrieben waere
die Liste eine zweite Wahrheit, die beim naechsten neuen Baustein veraltet.
Die Schranke zieht deshalb um eins nach und nicht der Test.

71 -> 72 (Migration 0036): test/setmenge-aus-erfassungen-db.test.js geht
die Migrationsdateien der Reihe nach durch, um die Kette VOR 0036
aufzubauen, und liest sie ueber die Schleifenvariable. Die Liste
ausschreiben hiesse, bei jeder neuen Migration eine zweite Stelle zu
pflegen — dieselbe Begruendung wie darueber.

72 -> 73 (Migration 0037): test/bricklink-zuordnung-db.test.js baut die
Kette VOR 0037 auf und geht dafuer die Migrationsdateien durch —
dieselbe Begruendung wie eine Zeile darueber.

73 -> 74 (Migration 0038): test/teilemengen-abgeleitet-db.test.js baut die
Kette VOR 0038 auf — dieselbe Begruendung, dritter Fall. Dass diese Zahl
bei jeder solchen Migration um eins steigt, ist kein Schleifen der Regel:
Jeder Schritt steht hier mit Datei und Grund, und ein Zuwachs OHNE Grund
faellt genau deshalb auf.

74 -> 75 (21.10.): test/import-protokoll.test.js geht alle Dateien in
public/js durch, um zu pruefen, dass protokollZeile() dort genau EINMAL
steht — dieselbe Lage wie bei 70 -> 71. Die Liste auszuschreiben waere
eine zweite Wahrheit, die beim naechsten neuen Baustein veraltet, und
genau dann wuerde die Pruefung die neue Datei nicht mehr ansehen.

75 -> 76 (29.10.): test/schichten.test.js geht alle Routendateien durch
(„keine Route importiert eine andere Routendatei“) — dieselbe Lage.
```

<a id="wer-die-bild-warteschlange-abarbeitet-le"></a>
## `test('wer die Bild-Warteschlange abarbeitet, leert sie vorher', () => `

```text
Wer die Bild-Warteschlange abarbeitet, leert sie vorher.

── Woher diese Regel kommt ─────────────────────────────────────────────────

`imageQueue._arbeiteStapel()` holt sich die aeltesten Notizen der GANZEN
Tabelle. Die Tests grenzen ihre eigenen Zeilen dagegen nur ueber ein Praefix
ab (`DR<pid>_1` …), und das auch nur beim Zaehlen und beim Aufraeumen.
Laesst eine frueher gelaufene Datei Zeilen zurueck, nimmt der Stapel DEREN
Zeilen — und der Test misst etwas anderes, als er glaubt.

NACHGESTELLT: zehn fremde Zeilen von Hand eingefuegt, dann
image-throttle-db.test.js laufen lassen → „0 Versuche — nach der ersten
Drosselung muss der Stapel abbrechen", 4 von 5 Faellen rot. Wortgleich der
Fehlschlag, der in dieser Reihe gelegentlich auftrat und sich ALLEIN nie
nachstellen liess (acht Laeufe hintereinander gruen). Mit
leereWarteschlange() und denselben zehn Fremdzeilen: 5 von 5 gruen.

Eine Datei raeumt ihr eigenes Praefix am Ende weg — aber eine, die
mittendrin scheitert, kommt nicht mehr dazu, und
catalog-images-button-db.test.js raeumte ueberhaupt nicht auf. Vor dem
Benutzen zu leeren ist die einzige Form, die nicht davon abhaengt, ob der
Vorgaenger ordentlich war.
```
