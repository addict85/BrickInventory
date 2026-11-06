# Begründungen zu `test/alarm-entprellt.test.js`

Die ausführlichen Kommentare aus `test/alarm-entprellt.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Preisalarm wird beim TIPPEN gespeichert — aber nur einmal.

── Marcos Befund ───────────────────────────────────────────────────────────

„Folgendes funktioniert nicht: der Preisalarm wird nicht gespeichert.
Sowohl in der Android-App als auch in der Webapp soll der Preis gespeichert
werden, wenn man was einträgt. Analog dem Kaufpreis."

── Was vorher gemessen wurde, bevor etwas geändert wurde ───────────────────

Erst der Verdacht Server: Ein PUT auf /api/v1/sets/10179-1/alert legt die
Zeile an, ein GET liest sie zurück, und in der Tabelle steht sie — gegen
eine echte Datenbank durchgespielt. Dann der Verdacht Verdrahtung: Im
gebauten Bündel unter jsdom löst ein `change` auf dem Feld den PUT aus.
Beides in Ordnung.

Kaputt war der AUSLÖSER. `change` feuert erst, wenn das Feld den Fokus
verliert. Wer tippt und dann das Fenster schliesst — am Telefon: Tastatur
zu und zurück —, verliert die Eingabe, ohne dass irgendwo ein Fehler
auftaucht.

── Was hier gemessen wird ──────────────────────────────────────────────────

Der echte public/js/02-detailfelder.js (über das gebaute Bündel) in jsdom. „249.90"
wird Zeichen für Zeichen getippt, danach gezählt, wie viele Anfragen das
ergibt.

── Die Gegenprobe läuft MIT ────────────────────────────────────────────────

Dasselbe Tippen ein zweites Mal, nur mit Pausen LÄNGER als die Ruhezeit.
Ohne diesen zweiten Lauf hiesse „eine Anfrage" bloss, dass der Prüfstand
gar nichts auslöst — der häufigste Weg, auf dem eine Messung sich selbst
bestätigt. Der Quelltext ist in beiden Läufen derselbe; nur der Takt der
Tastendrücke unterscheidet sie, und genau darauf antwortet die Ruhezeit.

Gemessen: schnell getippt 1 Anfrage, langsam getippt 6.
```

<a id="alarmmarkup"></a>
## `function alarmMarkup(sn) {`

```text
Die drei Bedienelemente des Alarms — AUS DEM ECHTEN QUELLTEXT geschnitten.

── Warum nicht hier abgeschrieben ──────────────────────────────────────────

Genau das stand hier zuerst, und die Gegenprobe dazu blieb GRÜN: Ich habe
die Verdrahtung im Quelltext von `data-input="alarmGetippt"` auf das alte
`data-change="speichereAlarm"` zurückgedreht — also genau der Fehler, den
diese Datei melden soll —, und der Prüflauf merkte nichts. Er hatte sein
eigenes Markup gebaut und prüfte damit eine Verdrahtung, die es im Baum
gar nicht mehr gab.

Dieselbe Falle wie bei den Pfaden in test/baumbruecken.test.js: Eine
abgeschriebene Fassung prüft die Abschrift.

Geschnitten wird aus alarmBlock() — der Funktion, die BEIDE Dialoge
benutzen (Set-Detail und Merkposten-Detail). Die Platzhalter der Vorlage werden
ersetzt, sonst stünde `${escJs(sn)}` wörtlich im Attribut.

── Warum der Anker gewandert ist ───────────────────────────────────────────

Das Markup stand früher inline im Set-Detail und trug feste IDs
(`m-alert-cond`). Seit das Merkposten-Detail denselben Alarm zeigt — es ist
derselbe Eintrag in price_alerts, am selben Schlüssel — liegt es in
alarmBlock(praefix), und die ID entsteht aus dem Präfix.

Geprüft wird weiterhin das ECHTE Markup, nur an seinem neuen Wohnort. Der
Prüfstand setzt den Präfix auf 'm' und prüft damit den Set-Dialog; die
Verdrahtung ist für beide dieselbe.
```
