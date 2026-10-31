# Begründungen zu `routes/api_v1/sets.ts`

Die ausführlichen Kommentare aus `routes/api_v1/sets.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="get-sets-exists-setnumber"></a>
## `get-/sets/exists/:setNumber`

```text
GET /api/v1/sets/exists/:setNumber

Beantwortet genau eine Frage: Steht das Set bereits im Blickfeld des
fragenden Kontos (eigenes Konto oder Haushalt)?

── Warum es diesen Endpunkt gibt ───────────────────────────────────────────
Beim Scanner und bei der Texterkennung muss die Oberfläche die Antwort VOR
dem Erfassen kennen: Ist das Set schon da, öffnet sich die Detailansicht;
ist es neu, kommt erst der Zwischendialog zum Prüfen der erkannten Nummer
(Marcos Festlegung). Die App fragte dafür bisher `GET /sets/:nummer` ab und
las aus dem Fehler, ob es das Set gibt — das vermischt „nicht vorhanden" mit
„Server nicht erreichbar" und zwang zu einer eigenen Fehlerauswertung im
Client.

Hier ist die Antwort ausdrücklich: `exists: true|false`, und die Regel
(Normalisierung der Nummer, Blickfeld des Haushalts) steht in
src/sets/setAdd.ts — dieselbe Funktion, die auch die Erfassungs-Routen
benutzen. Sonst könnte die Vorabfrage etwas anderes sagen als das Erfassen
danach tut.

MUSS vor /sets/:setNumber stehen, sonst liest Express „exists" als Setnummer.
```

<a id="abschnitt"></a>
## Abschnitt

```text
getSetByBarcode statt getSetByItemNumber: Diesen Namen hat routes/brickset
nie exportiert — der Aufruf weiter unten endete deshalb immer in einem
TypeError, und die Bestellnummern-Suche der App antwortete mit 500 statt
in die Rebrickable-Rückfallebene zu gehen.

`const uid` stand hier und wird nicht mehr gebraucht: Die einzige Stelle,
die ihn benutzte, las Stammdaten aus der eigenen sets-Zeile. Die stehen
seit Migration 0033 im kontouebergreifenden Katalog — die Frage „wie heisst
dieses Set?" hat kein Konto mehr.
```

<a id="get-sets-barcode-barcode-rbkey"></a>
## `rbKey`

```text
Helper: Rebrickable HTTPS GET (declared first so enrichResult can use it)

── Warum hier gezählt wird ────────────────────────────────────────────────
Diese Route hatte ihren eigenen Abrufweg, der am Tageskontingent
vorbeilief: Ein einziger Scan konnte bis zu acht Aufrufe auslösen (die
EAN-Suche, je Treffer ein Detailabruf, dazu zwei in enrichResult) — alle
ungezählt. Das Kontingent wurde erst clusterweit gemacht (siehe
utils/rateLimiter.ts); dies war die letzte Tür daneben. Ist es erschöpft,
liefert rbGet null, und die Route nimmt denselben Weg wie bei einem
fehlgeschlagenen Abruf.
```

<a id="get-sets-barcode-barcode-titel"></a>
## `titel`

```text
2c. UPCitemdb (free, 100/day)

Der Titel ist Fliesstext eines Händlers. Hier stand `match(/(\d{4,6})/)`
— also die ERSTE vier- bis sechsstellige Zahl, egal welche. Bei
„LEGO City 2023 Feuerwehrstation 60320" gewann das JAHR, und die
Antwort ging als gültige Setnummer an die App.

Jetzt liefert utils/produkttitel.ts geordnete Kandidaten (Teilezahlen
und Jahre aussortiert), und der KATALOG entscheidet, welcher davon
wirklich ein Set ist. Nur eine lokale Abfrage je Kandidat — sie kostet
nichts am Tageskontingent.
```

<a id="get-sets-setnumber-alert"></a>
## `get-/sets/:setNumber/alert`

```text
Preisalarm — GET/PUT/DELETE zu EINEM Set.

── Warum hier kein Blickfeld steht ─────────────────────────────────────────

Ein Alarm gehoert genau EINEM Konto: Wer eine Schwelle setzt, will selbst
benachrichtigt werden. Das Elternkonto hat nichts davon, die Wuensche seiner
Kinder per Mail zu bekommen — und duerfte sie schon gar nicht loeschen.
Deshalb `req.apiUser.user_id` und nicht scopeIds()/writableIds(); im ganzen
uebrigen Baum waere das ein Versehen, hier ist es die Regel.
```

<a id="get-alerts-pending"></a>
## `get-/alerts/pending`

```text
GET /api/v1/alerts/pending?since=<ISO> — was seit dann ausgeloest hat.

Der Weg, auf dem beide Oberflaechen von einer Meldung erfahren, ohne dass
der Server schieben muss. Die Begruendung — warum kein Firebase, warum `now`
mitkommt, warum ein erster Aufruf ohne `since` nichts liefert — steht an
ausgeloesteSeit() in src/finanzen/preisalarm.ts.

Ohne Kontofilter, wie die uebrigen Alarm-Routen: Ein Alarm gehoert genau
EINEM Konto.
```

<a id="get-alerts"></a>
## `get-/alerts`

```text
/api/v1/alerts — ALLE Alarme des Kontos, fuer die Uebersicht.

Marcos Frage vom 25.09.: „Wie finde ich alle Preisalarme?" — bis hierher:
gar nicht. Es gab nur die Route zu EINEM Set, und damit sah man einen Alarm
nur, wenn man das Set schon gefunden hatte.

Bewusst getrennt von /alerts/pending: Das sind zwei verschiedene Fragen.
`pending` heisst „was hat seit meiner letzten Abholung GEMELDET?" und ist
fluechtig — die erste Abfrage liefert absichtlich nichts. Diese hier heisst
„was habe ich gesetzt?" und ist vollstaendig. Sie zusammenzulegen hiesse,
einer von beiden ihre Bedeutung zu nehmen.

Geaendert und geloescht wird weiterhin ueber /sets/:setNumber/alert — die
Uebersicht braucht keine eigenen Schreibwege, und zwei Wege zum selben
Schreiben waeren zwei Stellen, an denen die Regeln auseinanderlaufen.
```

<a id="post-alerts-import-csv"></a>
## `post-/alerts/import/csv`

```text
Das Gegenstueck zu buildPreisalarmeCsv().

── Kein owner-Parameter, und das ist hier die Regel ────────────────────────

Ueberall sonst im Baum nimmt ein Schreibweg `owner`/`owner_user_id` und
prueft ihn mit resolveWriteTarget(). Ein Alarm NICHT: Er gehoert
ausdruecklich dem eigenen Konto, weil er eine Mail an dessen Adresse
ausloest. Die Begruendung steht oben an GET /sets/:setNumber/alert — „Das
Elternkonto hat nichts davon, die Wuensche seiner Kinder per Mail zu
bekommen — und duerfte sie schon gar nicht loeschen. Deshalb
req.apiUser.user_id und nicht scopeIds()/writableIds(); im ganzen uebrigen
Baum waere das ein Versehen, hier ist es die Regel."

Derselbe Satz gilt fuer den Import. Ein owner-Parameter hier liesse ein
Konto per hochgeladener Datei Alarme auf die Mailadresse eines anderen
setzen.

── Die Waehrung kommt aus den Einstellungen, NICHT aus der Datei ───────────

Das ist die Regel von PUT /sets/:setNumber/alert, woertlich: „Eine vom
Klienten geschickte Waehrung waere eine zweite Quelle fuer dieselbe Angabe,
und die beiden liefen beim naechsten Wechsel auseinander." Eine Importdatei
IST der Klient.

Nur: Die Datei TRAEGT eine Waehrung (currency_code), und sie kann eine
andere sein als die heutige. Dann bedeutet dieselbe Zahl etwas anderes —
„unter 200" in CHF ist eine andere Frage als „unter 200" in EUR. Umgerechnet
wird NICHT (dafuer braeuchte es einen Kurs, und ein falscher Kurs ist
schlimmer als eine genannte Abweichung), aber verschwiegen auch nicht: Jede
solche Zeile kommt mit `waehrung_angepasst` zurueck, und die Antwort traegt
einen Hinweis. Stillschweigend die Zahl uebernehmen UND die Waehrung
wechseln waere die eine Sache, die hier niemand merken wuerde.

── Pruefung: setzeAlarm() und nicht ein eigenes INSERT ────────────────────

setzeAlarm() bringt pruefeEingabe() mit (Richtung aus zwei Werten, Schwelle
endlich und > 0, Zustand N oder U) und setzt `ausgeloest` zurueck. Ein
eigenes INSERT hier waere die zweite Wahrheit ueber alle vier Regeln.
```

<a id="lagerkonten"></a>
## `lagerKonten`

```text
/api/v1/storage/locations — der VORRAT an Lagerorten, je Konto.

── Wessen Liste man sieht ──────────────────────────────────────────────────

Marcos Festlegung: „Der Grossvater soll die Werte der Enkel fuer die
entsprechenden Sets sehen und waehlen koennen."

Ein Lagerort ist ein Regal in einer Wohnung. Beim Set des Enkels gehoeren
die Regale des ENKELS zur Wahl, nicht die eigenen — ein Set des Enkels in
„Grossvaters Keller" waere eine Aussage ueber die falsche Wohnung.

Deshalb sagt der Aufrufer mit `owner`, wessen Liste er will. Beide
Oberflaechen wissen das: Eine Set-Kachel traegt ihre `owners` schon.

── Lesen weit, Schreiben eng ───────────────────────────────────────────────

Lesen gegen scopeIds() (alles, was im Blickfeld liegt), Schreiben gegen
writableIds() (alles, wofuer man verantwortlich ist). Dieselbe Trennung wie
ueberall im Baum — und sie ist hier nicht theoretisch: Ein Enkel sieht
seinen Grossvater nicht, der Grossvater aber den Enkel.
```

<a id="get-storage"></a>
## `get-/storage`

```text
GET /api/v1/storage — welche Lagerorte es gibt und was darin liegt.

Liegt in dieser Datei und nicht in einer eigenen: Die Antwort spannt Sets
UND Teile, gehoert also zu keiner der beiden Familien allein. Sie hier
anzuhaengen ist die kleinere Unsauberkeit, als eine Routendatei fuer einen
einzigen Endpunkt aufzumachen — und src/bestand/lagerort.ts traegt die Regeln
ohnehin.
```

<a id="get-sets-setnumber-parts-list-blmap"></a>
## `blMap`

```text
── Step 5: Zusammenfassen nach der REBRICKABLE-Nummer + Farbe ────────

── Marcos Befund ─────────────────────────────────────────────────────

„Ich besitze das Set 2x wie kann es dann sein, dass Teile fehlen?" und,
eine Runde später, die richtige Vermutung: „Ist evtl. die BL und
Rebrickable-ID das Problem?"

Hier stand `part_number: blId` — der Endpunkt WARF die
Rebrickable-Nummer weg und schrieb in beide Felder die BrickLink-Nummer.
Der Bestandsabgleich fragt danach `parts` ab, und dort steht die
Rebrickable-Nummer. Ein Tile 1x1 heisst bei Rebrickable `3070b`, bei
BrickLink `3070`: gefragt wurde nach `3070`, gefunden wurde nichts.

NACHGEMESSEN an Marcos Bestand (60052-1, Cargo Train): Das Inventar
fuehrt 287 Bedarfszeilen, die Webapp zeigte 45 davon als fehlend, und
keine einzige der gemeldeten Nummern (3070, 3068, x1687, 55423c01 …)
stand in `rb_inventory_parts` — sie waren allesamt erst hier entstanden.

── Warum das Zusammenfassen mitwandert ───────────────────────────────

Der Schluessel MUSS derselbe sein wie das, was in `part_number` landet.
Bliebe er auf der BrickLink-Nummer, fielen mehrere Rebrickable-Teile zu
einer Zeile zusammen (Formvarianten teilen sich regelmaessig eine
BrickLink-Nummer) — mit addiertem Bedarf, aber nur EINER der Nummern im
Feld. Genau dieselbe Falle, eine Ebene tiefer.

Die BrickLink-Nummer bleibt vollstaendig erhalten: Sie steht weiter in
`bl_part_number`, beide Oberflaechen ZEIGEN sie (die Rebrickable-Nummer
steht im Titel daneben), und der BrickLink-Export fasst selbst noch
einmal nach ihr zusammen — `blMap` in plExportBricklink schluesselt nach
`type|partNum|colorId`. Aus der feineren Aufteilung hier entsteht dort
also wieder eine Zeile je BrickLink-Nummer.
```

<a id="get-sets-r"></a>
## `r`

```text
Beide Clients blättern seitenweise und lassen den Server suchen,
filtern und sortieren (Marcos Vorgabe). Ohne page_size bleibt die Liste
unbegrenzt — dieser Weg ist weiterhin offen für Aufrufer, die alles
wollen (Skripte, ältere App-Stände), und deshalb absichtlich nicht
abgeschaltet.
── req.query als GANZES, keine zweite Liste ─────────────────────────

Hier stand eine Auswahl:

    const { search, theme, sort, page, page_size } = req.query;
    getSets(…, { search, theme, sort, page, page_size })

Marcos Befund: „Der Filter mit dem Lagerort funktioniert nicht. Es
werden immer alle Sets angezeigt." Die Ursache war genau diese Liste:
`storage` stand nicht darin. Das Frontend schickt es
(addLagerParam in public/js/14-scope.js), getSets() filtert damit
richtig — nur kam es nie an, und zwar stillschweigend.

Es war damit NIE in Ordnung: Die Liste gab es schon, als der Filter
dazukam, und jener Commit hat sie nicht mitgezogen. Eine Auswahl, die
neben der Liste der gelesenen Parameter gepflegt werden muss, laeuft
irgendwann auseinander — und die Teile-Route daneben macht es seit
jeher richtig, sie reicht req.query weiter.

Ungefiltert durchgereicht ist hier unbedenklich: getSets() bindet
theme und storage als Parameter, laesst `sort` nur ueber ausTabelle()
aus einer festen Zuordnung zu und ignoriert, was es nicht kennt.
```

<a id="get-sets-setnumber-price-currency"></a>
## `currency`

```text
Die Währung kommt aus der NUTZEREINSTELLUNG — der frühere
`req.query.currency ||`-Vorrang ist weg (Nachtrag 31). Die Android-App
schickte hier ihren lokal gespeicherten Wert mit, und der startet auf
"EUR" und wird erst beim ersten Laden der Finanzübersicht vom Server
übernommen. Bis dahin fragte die Detailansicht EUR an, während Cache und
Preis-Job in der eingestellten Währung (z.B. CHF) arbeiten: Cache-Miss,
Live-Versuch (bis zu zwei BrickLink-Abrufe je Ansicht!), oft no_price —
leere Marktpreis-Kachel, während Finanzübersicht und Galerie (beide ohne
Parameter) denselben Preis zeigten. Am laufenden Server nachgestellt:
identischer Nutzer, identisches Set, nur der Parameter unterschied
no_price=true von avg_price=629.90.

Das Ignorieren heilt auch ALTE App-Fassungen ohne Update — und folgt
der Schwester-Route /price-history, die den Parameter aus demselben
Grund nie ausgewertet hat (siehe Kommentar dort). Wozu die Antwort die
Währung weiterhin nennt: damit der Client den Betrag korrekt beschriftet,
statt sein lokales Kürzel zu raten.
```

<a id="get-sets-setnumber-price-history-uid"></a>
## `uid`

```text
Dieselbe Umsetzung wie /api/finance/price-history — siehe
src/finanzen/priceHistory.ts.

VORHER standen hier rund fünfzig Zeilen, die die Webapp-Route Wort für
Wort wiederholten: dieselbe Abfrage auf price_history, dasselbe
Voranstellen des Kaufpreises, dieselbe Prozentrechnung. Genau diese
Doppelung hat schon einmal zur Anzeige „−32 %" bei unverändertem Preis
geführt, weil beide Fassungen den Zustand unterschiedlich auflösten.

Die Antwort liefert jetzt ebenfalls history_new/history_used statt einer
zusammengefalteten Reihe. Das ist eine BRUCHÄNDERUNG für die Android-App:
Server und App müssen gemeinsam ausgerollt werden.
```

<a id="delete-sets-setnumber"></a>
## `delete-/sets/:setNumber`

```text
Set löschen — standardmässig im ganzen SCHREIB-Blickfeld.

Im Haushalt fasst die Galerie dieselbe Setnummer zu EINER Kachel zusammen
(src/sets/abfragen.ts gruppiert nach set_number). Wer diese Kachel löscht,
meint alle Exemplare dahinter — deshalb writableIds().

── Warum es jetzt eingrenzbar ist ──────────────────────────────────────────
Genau diese Vorgabe war in „Alle meine Sets löschen" falsch. NACHGEMESSEN
in einem Haushalt aus zwei Konten: Der Knopf listete /v1/sets ohne Blickfeld
(also auch die Sets des Unterkontos) und löschte jede Nummer mit dem vollen
Schreib-Blickfeld. Das Unterkonto verlor Sets, Teile und Minifiguren
vollständig — darunter ein Set, das das Hauptkonto nie besass. Versprochen
hatte der Knopf „Alle MEINE Sets löschen".

`accounts` darf das Blickfeld nur EINSCHRÄNKEN, nie erweitern: Die gewählte
Menge wird gegen writableIds() geschnitten. Damit ist der Parameter eine
Sicherung und kein Zugriffsweg — dieselbe Regel wie bei scopeIds() selbst.
```
