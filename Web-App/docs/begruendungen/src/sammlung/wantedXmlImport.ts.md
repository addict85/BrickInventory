# Begründungen zu `src/sammlung/wantedXmlImport.ts`

Die ausführlichen Kommentare aus `src/sammlung/wantedXmlImport.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="post-wanted-list-import-xml-auftragangefragt"></a>
## `auftragAngefragt`

```text
ZWEI Merker, und das ist kein Luxus (GEMESSEN):

  angefragt — „der Start ist unterwegs". Verhindert, dass die zweite
              Fortschrittsmeldung einen zweiten Start auslöst.
  laeuft    — „der Auftrag gehört UNS". Erst wenn starteAuftrag das
              bestätigt hat.

Mit nur einem Merker war beides dasselbe, und der Abschluss unten lief
auf dem Merker „angefragt": Der Wanted-Import hat damit den Auftrag
eines FREMDEN, laufenden CSV-Imports auf „done" gesetzt — genau das,
was er nicht anfassen soll. Der Fall steht als Prüfung in
test/wanted-liste-route-db.test.js.
```

<a id="post-wanted-list-import-xml-dateiname"></a>
## `dateiName`

```text
── Der Fortschritt als STROM (Marcos Wunsch vom 20.10.) ────────────

„kannst du beim Import auch den Fortschritt mit einem
 Fortschrittsbalken anzeigen?"

Ohne `strom=1` verhält sich die Route wie bisher: eine Anfrage, eine
JSON-Antwort. Das ist der Weg der Android-App und aller Prüfungen, und
er bleibt unangetastet.

Mit `strom=1` kommen Zeile für Zeile JSON-Objekte (NDJSON): erst die
Fortschrittsmeldungen, zuletzt der Bericht. Warum so und nicht als
SSE-Auftrag wie beim Set-Import:

  • EventSource kann kein POST, und die Datei muss mit. Ein Auftrag
    mit eigener Kennung hiesse, die fremde Datei auf dem Server zu
    halten, bis jemand den Strom abholt — genau das lehnt der Kopf von
    public/js/18-wanted-xml.js ab.
  • Eine Antwort, zwei Phasen: Der zweistufige Ablauf (Vorschau,
    dann Schreiben) bleibt, wie er ist.

res.flush() nach jeder Zeile ist tragend: server.ts hängt compression
vor ALLE Antworten (nur text/event-stream ist ausgenommen). Ohne das
Durchdrücken sammelt gzip die Zeilen und schickt sie am Ende zusammen
— der Balken spränge von 0 auf 100, und zwar genau dann, wenn er nicht
mehr gebraucht wird.
Was im Balken als „gerade dran" steht. Der CSV-Import zeigt dort die
Setnummer; hier gibt es keine einzelne Nummer, die etwas sagt — also
der Dateiname, damit in der anderen Sitzung erkennbar ist, WAS läuft.
```

<a id="post-wanted-list-import-xml-schreiben"></a>
## `schreiben`

```text
── Derselbe Balken wie beim Set-Import (Marcos Wunsch vom 20.10.) ──

„bitte auch noch umsetzen, dass der Import der BL-XML Importe in der
 Android-App angezeigt werden (analog den Set-Importen)."

Der Strom oben versorgt den Tab, der die Datei geschickt hat. Der
Auftragsdatensatz hier versorgt ALLE ANDEREN: die Android-App zeigt
ihren Balken auf jedem Reiter, die Webapp ihren im Kopf, und auch eine
zweite Browser-Sitzung desselben Kontos sieht ihn — der Datensatz
hängt am Konto, nicht an dieser Anfrage (src/auftraege/importAuftrag.ts).

NUR beim echten Schreiben: Eine Vorschau ändert nichts, und ein
Balken „Import läuft" für eine Vorschau wäre eine Lüge in drei
Oberflächen gleichzeitig.
```

<a id="post-wanted-list-import-xml-3"></a>
## Abschnitt

```text
addSet nimmt die Setnummer zuerst und erwartet dazu einen
Fortschrittsmelder (hier null: niemand sieht zu) und einen
Kaufpreis. Der ist seit dem 21.10. MAXPRICE aus der Datei —
Marcos Entscheidung; die Begründung samt der alten, falschen
steht in src/merkliste/wantedListe.ts bei den Anlegern.

Je Stück, nicht für die ganze Menge: Dasselbe meint `purchasePrice`
in addSet (der Rückfall dort ist getCurrentMarketPrice, und der
liefert den Preis EINES Sets), und dasselbe meint MAXPRICE bei
BrickLink.
```

<a id="post-wanted-list-import-xml-4"></a>
## Abschnitt

```text
Den Auftrag schliessen, bevor geantwortet wird: Sonst steht der Balken
in den anderen Sitzungen noch auf „läuft", während dieser Tab längst
den Bericht zeigt.
ERST die Kette abwarten, DANN fragen, ob der Auftrag uns gehört: Der
Start läuft in der Kette, und vorher steht in `auftragLaeuft` noch
nichts Belastbares.

Ohne eigenes .catch(): Jedes Glied der Kette trägt bereits
logAndContinue, `kette` kann also gar nicht mehr ablehnen. Ein
zusätzliches leeres catch wäre ein stiller Fang, der nichts fängt —
und test/ratschen.test.js zählt genau die.
```

<a id="post-wanted-list-import-xml-5"></a>
## Abschnitt

```text
Je Posten eine echte Zeile fürs Protokoll des Balkens — Marcos
Befund vom 21.10. („ganz viele Zeilen mit Undefined - aktualisiert").
Die Begründung steht bei beendeAuftrag; hier nur, WAS drinsteht:

  set_number  die BrickLink-Nummer. Sie steht in Marcos Datei, und
              das Protokoll soll von den Zeilen sprechen, die er
              hochgeladen hat. Der Feldname kommt vom CSV-Import,
              über dessen Anzeige das hier mitläuft.
  action      'added' oder 'updated' — der Unterschied, den die
              Anzeige in Worte fasst. 'aufgestockt' ist 'updated'.
  error       der Grund, wenn es keiner wurde. `grund` ist ein
              deutscher Satz; die Oberfläche kann ihn hier nicht
              übersetzen (anders als in der Vorschau-Tabelle, die
              `grundCode` hat) — besser ein Satz in einer Sprache
              als eine leere Zeile.
```
