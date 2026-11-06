# Begründungen zu `test/passwortlaenge.test.js`

Die ausführlichen Kommentare aus `test/passwortlaenge.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Mindestlaenge eines Passworts — an allen Stellen dieselbe, und nirgends
vergessen.

── Woher das kommt ─────────────────────────────────────────────────────────
Sechs Routen in routes/auth.ts setzen ein Passwort. VIER prueften die
Laenge, und zwar in zwei Schreibweisen (`password.length < 8` und
`String(password).length < 8`), jede von Hand hingeschrieben. Zwei prueften
gar nicht:

    PUT  /profile           (Passwort-Zweig)
    POST /change-password

Das waren ausgerechnet die zwei Wege, die einem BEREITS ANGEMELDETEN Konto
offenstehen — und damit war die Regel wirkungslos: Man registriert sich mit
acht Zeichen und aendert danach auf eines. Ein per Sitzungsuebernahme
gekapertes Konto liess sich so dauerhaft schwach machen.

Der Grund fuer die Luecke war die fehlende Konstante: Wo eine Regel an jeder
Stelle neu getippt wird, gibt es keine Stelle, die man vergessen KOENNTE.

── Und die zweite Haelfte: die beiden Oberflaechen ─────────────────────────
Die Android-App prueft die Laenge in ihrer Oberflaeche (SettingsScreen,
LoginScreen). Die Webapp prueft an KEINER ihrer fuenf Stellen. Wer im
Browser ein zu kurzes Passwort eingab, lief in einen Serverfehler, wo die
App den Knopf gar nicht erst freigibt.

── Warum die Zahl trotzdem dreimal existiert ───────────────────────────────
Server, Webapp und App teilen keinen Code — drei Laufzeiten, drei Fassungen.
Das ist unvermeidbar; das AUSEINANDERLAUFEN ist es nicht. Genau dafuer gibt
es diesen Test.

Ausfuehren: npm test
```

<a id="appzahl"></a>
## `const appZahl = /const val PASSWORT_MIN_ZEICHEN = (\d+)\b/.exec(fs.rea`

```text
`const val`, nicht bloss der Name: Der erste Entwurf dieser Datei schrieb
`const PASSWORT_MIN_ZEICHEN = 8` — ohne `val`, und das ist kein gueltiges
Kotlin. Dieser Regex traf die Zeichenkette trotzdem, der Test blieb gruen,
und der Fehler fiel erst im Android-Lauf auf (Lauf 140, nach 83 Sekunden
Abbruch). Eine Pruefung, die eine Zeichenkette sucht statt die Sache,
findet auch eine kaputte Sache.

Der Android-Compiler laeuft in dieser Umgebung nicht (dl.google.com
antwortet mit 403); der Lauf in CI ist der einzige Uebersetzer. Umso mehr
muss das, was hier ohne ihn pruefbar ist, genau pruefen.
```

<a id="for-stelle"></a>
## `for (const [voll, anzahl, name] of [`

```text
── Gezaehlt, nicht bloss gesucht ────────────────────────────────────────

Hier stand `assert.match(quelle, /passwortZuKurz\(/)` — also „kommt in der
Datei vor". SettingsScreen benutzt die Regel an DREI Stellen derselben
Ansicht (Hinweistext, Fehlermarkierung, Knopf-Freigabe). Die Gegenprobe
schaltete eine davon ab, und der Test blieb gruen: Er traf die Datei statt
der Stelle — dieselbe Fehlerart wie beim Bruecken-Test, wo der Basisordner
statt der Kotlin-Datei geprueft wurde.

Die Zahlen sind GEMESSEN, nicht gesetzt. Wer eine Stelle hinzufuegt, muss
hier mitziehen — das ist der Preis dafuer, dass das Wegfallen einer Stelle
auffaellt.
Jedes path.join() mit AUSGESCHRIEBENEN Segmenten: test/baumbruecken.test.js
loest die Bruecken in den Android-Baum statisch auf und kann ein variables
Segment nicht sehen. Der erste Entwurf hatte den Dateinamen als
Schleifenvariable — und wurde von jener Pruefung prompt gemeldet, zum
zweiten Mal in dieser Sitzung.
```
