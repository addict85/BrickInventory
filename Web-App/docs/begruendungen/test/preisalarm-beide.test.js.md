# Begründungen zu `test/preisalarm-beide.test.js`

Die ausführlichen Kommentare aus `test/preisalarm-beide.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kt-einst"></a>
## `const KT_EINST  = lies(path.join(__dirname, '..', '..', 'Android-App',`

```text
Die Einstellungen der App liegen in mehreren Dateien: Der Bildschirm
selbst traegt nur die Liste, jede Rubrik hat ihre eigene Seite
(EinstellungenUnterseiten.kt) mit der Karte in Einstellungen*.kt. Gelesen
werden deshalb alle, die es betrifft — die
Zusicherung lautet „die App tut das in ihren Einstellungen" und nicht
„in dieser Datei".
```

<a id="stelle"></a>
## `assert.match(web('public/js/02-detailfelder.js'), /const loeschen = !\`

```text
Die natürliche Geste, einen Alarm loszuwerden, ist das Feld zu leeren.
Ein eigener Knopf daneben wäre ein zweiter Weg für dieselbe Absicht, und
eine „Schwelle 0" wäre ein Alarm, der nie oder immer meldet.

Beide entscheiden es an derselben Stelle: „ist das eine Zahl > 0?". Die
Webapp misst es zusätzlich am Verhalten (test/alarm-entprellt.test.js),
die App an der Umrechnung (AlarmeingabeTest).
```

<a id="stelle-2"></a>
## `assert.match(require('./helpers/sources').ohneKommentare(KT_SECT),`

```text
Geprüft wird die BEHAUPTUNG — beim Tippen wird gespeichert —, nicht der
Wortlaut der Zeile. Vorher stand hier die ganze Zeile als Muster; am
28.09. bekam das Feld einen NumericInput-Filter, der Aufruf rückte in
einen mehrzeiligen Lambda, und der Test wurde rot, obwohl er weiter beim
Tippen speichert. Das ist der dritte Test in diesem Projekt, der die
Schreibweise statt der Aussage festgehalten hat.

Was weiterhin festgehalten wird, und zwar das Wesentliche: Der Aufruf
steht IN `onValueChange` und nicht irgendwo sonst, und er bekommt den
gerade getippten Wert — nicht die Zustandsvariable `schwelle`, die zu
diesem Zeitpunkt noch den vorigen Stand trägt.
```

<a id="beide-holen-dieselbe-liste-beim-selben-e"></a>
## `test('beide holen dieselbe Liste beim selben Endpunkt ab', () => {`

```text
═══ Das Melden: die App fragt stündlich nach, die Webapp beim Öffnen ═══════

Marcos Auftrag: „Ja gerne. Das Intervall aber bitte auf Stunde setzen."

Echtes Push hiesse Firebase — ein Google-Projekt, eine Konfigurationsdatei
im Baum, und jede Meldung liefe über fremde Server. Für eine selbst
gehostete Sammlung ist das eine schwere Abhängigkeit für eine leichte
Nachricht, und sie kauft fast nichts: Der Preislauf läuft selbst stündlich.
```

<a id="stelle-3"></a>
## `assert.match(require('./helpers/sources').ohneKommentare(web('public/j`

```text
Und die Webapp fragt auch TATSÄCHLICH — ein Aufruf, den niemand aufruft,
ist genau die Sorte Halbfertiges, die hier schon zweimal stehen blieb.

ohneKommentare(): Die Gegenprobe zu dieser Zeile blieb GRÜN. Über dem
Aufruf in showApp() steht seine Begründung, und darin kommt der Name
vor — die Prüfung fand also ihre eigene Erklärung und hätte auch einen
gelöschten Aufruf durchgehen lassen. Dieselbe Falle wie in
household.test.js und ratschen.test.js.
```

<a id="ohne"></a>
## `const ohne = require('./helpers/sources').ohneKommentare;`

```text
── Marcos Befund vom 25.09. ─────────────────────────────────────────────

  „In der Android-App kommt trotz aktivem Preisalarm keine
   notification."

Abgeholt hat in der App AUSSCHLIESSLICH der stündliche Auftrag. Wer sie
öffnete, erfuhr nichts — im schlechtesten Fall eine Stunde lang.

Die Webapp machte es die ganze Zeit richtig (zeigeOffeneAlarme() beim
Anmelden), und die Prüfung darüber hält genau das fest. Sie hat den
Rückstand der App nur nicht gemeldet, weil sie nach der Webapp-Hälfte
gefragt hat und nach der App-Hälfte nicht. Eine Regel über „beide" muss
beide Richtungen kennen.

Doppelte Meldungen kann das nicht geben: Dafür sorgt die Marke, nicht der
Aufrufer — jeder Durchgang fragt „was hat seit `marke` ausgelöst?" und
schreibt den Zeitpunkt des Servers zurück.
```

<a id="stelle-4"></a>
## `assert.match(KT_START, /PreisalarmWorker\s*\n?\s*\.einplanen\(this@Bri`

```text
Und beim Start wieder einplanen: WorkManager überlebt Neustarts, aber
nicht ein Zurücksetzen der App-Daten oder ein „Force Stop", nach dem
manche Hersteller die Aufträge verwerfen.
Der Aufruf steht seit dem 25.09. über zwei Zeilen, weil er sein Ergebnis
auswertet (einplanen() gibt den Fehler zurück, statt ihn zu werfen). Das
Muster erlaubt den Umbruch deshalb ausdrücklich — geprüft wird, DASS beim
Start wieder eingeplant wird, nicht wie der Aufruf umbricht.
```

<a id="js-stelle"></a>
## `const js = require('./helpers/sources').ohneKommentare(web('public/js/`

```text
── Was hier vorher stand ─────────────────────────────────────────────────

`const ALARM_ZUSTAND = 'N'` in beiden Oberflächen, mit der Begründung:
„Die Oberfläche bietet vorerst den für NEU an … ein zweites Auswahlfeld
hier ist dagegen eine Zeile."

Server und Tabelle konnten es die ganze Zeit: `price_alerts` führt den
Zustand im Schlüssel, und test/preisalarm-db.test.js prüft seit jeher
„der Zustand trennt die Alarme". Nur wählen liess er sich nicht. Neu und
gebraucht liegen oft um ein Vielfaches auseinander.
```
