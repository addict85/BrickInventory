# Begründungen zu `routes/api_v1/wanted.ts`

Die ausführlichen Kommentare aus `routes/api_v1/wanted.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="get-wanted"></a>
## `get-/wanted`

```text
Die Liste des Blickfelds.

Marcos Festlegung: Der Kontenbaum gilt wie überall — der Grossvater sieht
die Merkposten der Enkel. Hier ist das nicht nur konsequent, sondern der
Zweck: Wer ein Geschenk sucht, schaut genau dort nach.

── Der Filter (Marcos Vorgabe vom 24.09.) ─────────────────────────────────

  „In der Merkliste noch einen Filter analog den Sets einbauen inkl.
   Inhaber."

Dieselben vier Parameter wie bei /v1/sets und in derselben Schreibweise:
`search`, `sort`, `accounts` — dazu `condition`, das dort die Zustandsspalte
meint und hier den Zustand des Merkpostens.

Der INHABER ist `accounts`: Er war hier schon immer vorgesehen, nur hatte
ihn keine der beiden Oberflächen je geschickt. Die Übersetzung von „own",
„subs" oder einer Konto-ID auf die Liste der IDs macht scopeIds() — eine
Stelle für den ganzen Baum.

Gefiltert wird am SERVER und nicht in den Oberflächen. Das ist hier nicht
wegen der Menge nötig (eine Merkliste hat ein paar Dutzend Einträge),
sondern damit beide Oberflächen dasselbe Ergebnis zeigen: Die Sortierung
nach Marktpreis etwa braucht price_cache, und den kennt kein Client.
```

<a id="post-wanted"></a>
## `post-/wanted`

```text
Einen Merkposten eintragen — aus dem Katalog-Detail, per Setnummer oder per
Barcode. Alle drei Wege landen hier; die Clients unterscheiden sich nur
darin, woher die Nummer kommt.

owner_user_id wie beim Erfassen eines Sets: Der Grossvater trägt einen
Merkposten für den Enkel ein. resolveWriteTarget prüft die RICHTUNG, nicht bloss
die Mitgliedschaft im Blickfeld — sonst könnte der Enkel für den Grossvater
schreiben.
```

<a id="put-wanted-setnumber-condition-inhaber"></a>
## `put-/wanted/:setNumber/:condition/inhaber`

```text
Den Inhaber eines Merkpostens aendern.

Marcos Befund: „Auf dem Detail-Dialog der Merkliste kann der Inhaber
nicht geaendert werden." Stimmt — waehlbar war er nur beim Erfassen.

── Warum ZWEI Kontenpruefungen ────────────────────────────────────────────

Verschieben heisst hier: aus einem Konto heraus UND in ein anderes hinein.
Beide Richtungen muessen erlaubt sein, sonst schoebe ein Enkel den Merkposten
des Grossvaters zu sich — oder seinen eigenen dorthin, wo er nichts zu
schreiben hat. resolveWriteTarget() prueft genau diese Richtung.

Die Regel selbst steht in utils/merkliste.ts (verschiebeMerkposten): Das
Aufnahmedatum bleibt, der Preisalarm zieht mit, und ein Merkposten, den das
Zielkonto schon hat, wird zusammengefuehrt statt verdoppelt.
```

<a id="get-wanted-setnumber-preise"></a>
## `get-/wanted/:setNumber/preise`

```text
Die Marktpreise eines Merkpostens — BEIDE Zustände, frisch geholt.

── Warum es diese Route gibt ──────────────────────────────────────────────

Marcos Frage: „Wieso werden die Preise nicht sofort angezeigt?"

Weil bisher niemand sie holte. /sets/:sn/price-history LIEST nur den Cache,
und in den schrieb bis zu dieser Änderung allein der Preislauf — der kannte
`sets` und `price_alerts`, aber nicht die Merkliste. Ein Merkposten ohne
Preisalarm hatte deshalb NIE einen Preis.

/sets/:sn/price wäre der fertige Weg gewesen, antwortet aber mit 404, wenn
einem das Set nicht gehört — für einen Merkposten also ausgeschlossen.

── Warum beide Zustände ───────────────────────────────────────────────────

Weil das Set-Detail sie ebenfalls beide zeigt: Wer auf ein gebrauchtes
wartet, will trotzdem wissen, was ein neues kostet. Die Antwort trägt
deshalb dieselbe Form wie `current` in /price-history — die Oberflächen
zeichnen sie mit derselben Funktion.

── Was sie NICHT tut ──────────────────────────────────────────────────────

Sie fragt nicht bei jedem Öffnen bei BrickLink an: fetchPrice() bedient
sich am Cache, solange dessen Alter unter price_cache_ttl liegt. Der erste
Aufruf für ein Set kostet zwei Abrufe, die folgenden keinen.
```

<a id="post-wanted-import-csv"></a>
## `post-/wanted/import/csv`

```text
Merkliste aus CSV — das Gegenstück zu buildMerklisteCsv().

── Warum hier und nicht in routes/ wie die anderen drei ────────────────────

Sets, Teile und Minifiguren importieren in routes/sets|parts|minifigs.ts —
den alten Routern, die nur die Webapp bedient. Die Merkliste hat solche
Router nie gehabt: Sie lebt vollständig in dieser Datei und wird von BEIDEN
Oberflächen über denselben Weg bedient. Der Import hier zu bauen heisst
deshalb, dass die App ihn ohne weiteres Zutun auch hat — und nicht, dass es
ihn demnächst zweimal gibt.

── Spaltennamen ────────────────────────────────────────────────────────────

Erkannt werden die eigenen (set_number, condition, created_at) UND die
deutschen Überschriften, die ein Tabellenprogramm hinterlässt. Dieselbe
Nachsicht wie beim Teile- und Minifiguren-Import, aus demselben Grund: Die
Datei kommt aus Excel zurück, nicht aus dem Export.

Fehlt der Zustand, entscheidet NICHT diese Route, sondern zustandOder() in
utils/merkliste.ts — also die Einstellung des Kontos. Eine Vorgabe 'N' hier
wäre eine zweite Wahrheit über denselben Standardwert.

── Das Datum durch parseCsvDate ────────────────────────────────────────────

Nicht roh weitergegeben: Postgres liest bei DateStyle MDY „01.02.2026" als
2. Januar, ohne Fehler zu melden. Der Fehler ist in diesem Baum schon
dreimal aufgetreten (siehe csvGemeinsameFelder); hier steht er nicht noch
einmal.

── Wessen Liste ────────────────────────────────────────────────────────────

`owner` wie bei POST /wanted: Der Grossvater stellt die Liste des Enkels
wieder her. resolveWriteTarget prüft die RICHTUNG — ohne das schriebe ein
Unterkonto mit einer hochgeladenen Datei in jedes Konto des Haushalts.
```

<a id="post-wanted-list-import-xml"></a>
## `post-/wanted-list/import/xml`

```text
Marcos vierter Punkt.

── Die Vorschau ist die VORGABE ───────────────────────────────────────────

Ohne `schreiben=1` wird NICHTS angelegt. Das ist nicht Vorsicht um ihrer
selbst willen: Die Abbildung BrickLink → Rebrickable hat drei
Sicherheitsstufen (siehe utils/wantedListe.ts), und die dritte ist eine
Vermutung. Wer 224 Posten hochlädt, soll vorher lesen, wie viele davon auf
einer Vermutung beruhen und wie viele offen bleiben — und dann entscheiden.

Ein Import, der sofort schreibt, nimmt diese Entscheidung weg, und
rückgängig machen hiesse 224 Teile von Hand löschen.

── Rebrickable nur auf Verlangen ──────────────────────────────────────────

`rebrickable=1` fragt die OFFENEN Posten bei Rebrickable nach. Jeder Abruf
kostet aus dem Tageskontingent, deshalb nicht von selbst. Marcos Vorgabe:
„Zuerst die restlichen … mit der OPTION diese über Bricklink oder noch
besser über Rebrickable versuchen aufzulösen."

── Das eigene Konto ───────────────────────────────────────────────────────

Kein owner-Parameter: Der Import legt Bestand an, und `addManualPart` &
Co. schreiben in das Konto, das sie bekommen. Ein owner hier bräuchte
resolveWriteTarget und wäre eine Erweiterung, die niemand verlangt hat —
bis dahin ist das eigene Konto die einzige Antwort, die nicht überrascht.
```

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

<a id="post-wanted-list-import-xml-2"></a>
## Abschnitt

```text
── Die Anleger gibt DIESE Schicht herein ─────────────────────────────

utils/wantedListe.ts darf nicht aus routes/ einfuehren
(test/schichten.test.js, Ausnahmeliste leer). Hier ist der Ort, der
beide Seiten kennen darf: eine Route, die andere Routen kennt.

Dieselben drei Funktionen, die auch die Formulare benutzen — kein
eigenes INSERT, denn daran haengen Lagerort, Preisregel,
Katalognachtrag und die Erfassungszeile.
```

<a id="post-wanted-list-import-xml-korrekturen"></a>
## `korrekturen`

```text
── Korrekturen aus der Vorschau ──────────────────────────────────────

Als FELD der Multipart-Anfrage und nicht als Abfrageparameter: Bei 224
Posten wäre die Adresse länger als jeder Proxy durchlässt — dieselbe
Begründung wie bei POST /parts/owned.

JSON.parse in try/catch, und ein Fehlschlag ist eine ABSAGE statt
eines stillen „keine Korrekturen": Wer korrigiert hat und dann den
Bestand ohne seine Korrekturen bekommt, merkt es erst an den Karten.
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
hängt am Konto, nicht an dieser Anfrage (utils/importAuftrag.ts).

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
steht in utils/wantedListe.ts bei den Anlegern.

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
