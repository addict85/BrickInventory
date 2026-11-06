# Begründungen zu `test/import-protokoll.test.js`

Die ausführlichen Kommentare aus `test/import-protokoll.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Das Protokoll des Import-Balkens: EINE Fassung, und keine Zeile ohne Namen.

── Marcos zwei Befunde vom 21.10. ──────────────────────────────────────────

  „Wenn ich in einem anderen Browsersession oben rechts auf den Fortschritt
   klicke wenn ein XML-Wanted-Listen Import läuft, steht unten x/y Sets
   anstelle 'Elementen'"

  „Nach dem Import erscheint dann ganz viele Zeilen mit
   Undefined - aktualisiert"

Beide haben dieselbe Wurzel: Der Balken war für den CSV-Import von SETS
gebaut, und seit dem 20.10. läuft der Wanted-Listen-Import darüber mit — der
legt Teile und Minifiguren an. Was für Sets stimmte, stimmte danach nicht
mehr.

  Der TEXT sagte „Sets". Jetzt „Elemente" / „items", und der Schlüssel
  heisst `csv.items_progress` statt `csv.sets_progress`: Ein Name, der
  weiter „sets" sagt, ist die nächste falsche Fährte.

  Die ZEILEN kamen aus `results`, und dort standen beim Wanted-Import nur
  Zähl-Platzhalter (`{ success: true }`), aus denen buildJobStatus
  ok/warn/err rechnet. Ich hatte sie dafür gebaut und übersehen, dass
  dieselbe Liste auch das Protokoll füllt. Daraus wurden bei Marco 322
  Zeilen „undefined – aktualisiert".

── Was hier geprüft wird, und was woanders ─────────────────────────────────

Hier: der QUELLTEXT der beiden Oberflächen-Dateien — dass es den gemeinsamen
Zeilenbauer gibt, dass er auf einen Namen prüft, und dass niemand daneben
eine zweite Fassung aufmacht. Die Prüfung am Quelltext ist in diesem Baum
das übliche Mittel für public/js (siehe test/preisalarm-beide.test.js).

Dass der SERVER echte Zeilen liefert, prüft Fall 9 in
test/wanted-liste-route-db.test.js — am laufenden Server, nicht am Text.
Beides zusammen deckt den Weg ab; jede Hälfte allein war schon einmal grün,
während die Anzeige unbrauchbar war.
```
