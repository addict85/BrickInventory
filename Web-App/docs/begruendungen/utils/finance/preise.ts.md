# Begründungen zu `utils/finance/preise.ts`

Die ausführlichen Kommentare aus `utils/finance/preise.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Die PREISSCHICHT des Finanzteils: BrickLink abfragen, Antworten
zwischenspeichern, das taegliche Anfragekontingent verwalten und
BrickLink-Nummern aufloesen.

── Warum sie eine eigene Datei ist (Nachtrag 171) ──────────────────────────

utils/financeCalc.ts trug 1529 Zeilen und drei Aufgaben. Der Compiler hat
beim Trennen gezeigt, wie sie wirklich aufeinander stehen — meine erste
Annahme war falsch:

    zustand.ts        die eine Zustandsregel, haengt an nichts
       ^
    preise.ts         diese Datei
       ^
    bewertung.ts      was ist der Bestand heute wert
       ^
    gewinnVerlust.ts  was hat er gekostet, was gebracht

Ich hatte die Gewinnrechnung fuer unabhaengig gehalten; sie ruft die
Bewertungen auf und sitzt damit UEBER ihnen. Aufgefallen ist das erst, als
`tsc` nach dem ersten Schnitt `Cannot find name computePartsValuation`
meldete. Eine geratene Schichtung waere im Kreis gelaufen.

Die Aufteilung ist rein raeumlich — kein Verhalten hat sich geaendert, und
utils/financeCalc.ts reicht weiterhin alles durch.
```

<a id="apiname"></a>
## `ApiName`

```text
Die drei Fremd-Schnittstellen, deren Tagesbudget hier gezaehlt wird.

Eine Union und KEIN string: Alle acht Aufrufstellen im Baum uebergeben eines
dieser drei Literale, nie einen Wert von aussen. Damit prueft der Uebersetzer
`defaults[apiName]` selbst — der Indexzugriff braucht hier weder ausTabelle()
noch einen Rueckfall gegen geerbte Mitglieder, weil gar kein fremder
Schluessel hineinkommen kann. (Anders als in src/infra/mailer.ts, wo der
Schluessel aus der Datenbank stammt.)
```

<a id="stunden"></a>
## `Stunden`

```text
Cache-Dauer in Stunden — `string | number`, und das ist NACHGEMESSEN:

  getGlobalSetting('price_cache_ttl', '24')  ->  Zeichenkette (DB-Textspalte,
                                                 Rueckfall '24')
  routes/minifigs.ts:201                     ->  die Zahl 24

Deshalb bleibt `parseInt(String(ttlHours))` in den vier Rechnern stehen: Es
ist tragend, nicht Zierde. Ein blosses `number` waere dieselbe falsche
Annahme wie bei getPartAcquisitions im vorigen Commit.
```

<a id="resolvesetcondition"></a>
## `resolveSetCondition`

```text
DIE Zustandsauflösung für ein einzelnes Set — per Datenbankabfrage, für
Aufrufer ohne bereits geladene acq_count/used_count-Felder.

Fünfter Fundort desselben Fehlers in dieser Sitzung: computeSetsValuation(),
getCurrentMarketPrice(), computePnl() und die Preisverlauf-Route der Webapp
hatten alle ihre EIGENE, leicht abweichende Zustandsermittlung — mehrere
davon lasen dabei `DEFAULT_PRICE_CONDITION` (fest 'U') statt des
tatsächlichen Zustands. Diese Funktion ist jetzt die EINE Quelle; jeder neue
Aufrufer sollte sie benutzen statt die Abfrage zu wiederholen.
```

<a id="checkandincrementratelimit"></a>
## `checkAndIncrementRateLimit`

```text
Nenner-Untergrenze für die %-Wertsteigerung: Bei einem erfassten Kaufpreis
von 0 (z. B. Geschenk/Gratisteil) wäre die prozentuale Steigerung sonst
unendlich bzw. nicht berechenbar. Statt den Marktpreis zu unterstellen,
rechnen wir die % gegen diese sehr kleine Zahl — der Kaufpreis bleibt 0.
Ein leeres (nicht erfasstes) Kaufpreisfeld ergibt weiterhin keine % (null).

Aus utils/setValue.ts, wo calcPnlPct() damit rechnet. Hier stand vorher eine
eigene Kopie derselben Zahl — zwei Konstanten mit derselben Bedeutung
driften irgendwann auseinander.
```

<a id="zero-price-ttl-hours"></a>
## `ZERO_PRICE_TTL_HOURS`

```text
Wie lange ein Eintrag OHNE Preis (avg_price = 0) als endgültig gilt.

Vorher wurde ein gecachter 0-Preis für das volle TTL-Fenster als „für dieses
Set gibt es keinen Preis" behandelt — ohne je erneut zu fragen. Damit lief
der neue Rückfall von 'sold' auf 'stock' nie an, denn er greift erst beim
Abruf. Und weil die Logik dann auf den ANDEREN Zustand auswich, zeigte ein
neues Set den Gebraucht-Preis.

Kürzeres Fenster statt gar keinem: Artikel, die wirklich nirgends gehandelt
werden, werden ein paar Mal am Tag erneut versucht — nicht bei jedem
Seitenaufruf.
```

<a id="speicherepreis"></a>
## `speicherePreis`

```text
Eine BrickLink-Antwort wegschreiben: erst in den Cache, dann — nur wenn ein
Preis drinsteht — als Punkt in den Verlauf.

Dieselbe Regel stand vorher dreimal da: einmal im Anfrageweg (fetchPrice →
tryFetch) und zweimal im Nachtjob (jobs/priceJob.ts, Hauptweg und
Zustands-Rueckfall). Die dritte Fassung war eine gekuerzte: Der Rueckfall
schrieb NUR den Cache und nur den Rueckfall-Zustand.

Nachgemessen an einem Set, dessen angefragter Zustand keinen Preis hat, der
andere schon — zwei Laeufe, gleiche Ausgangslage:

                       Job          Anfrageweg
  BrickLink-Abrufe       4               2
  price_cache        nur 'U'      'N'(0) und 'U'
  price_history       leer             'U'

Die vier Abrufe sind der teure Teil: Ohne die Null-Zeile fuer den
angefragten Zustand findet der naechste Lauf nichts Frisches und fragt
BrickLink wieder — jeden Lauf aufs Neue, auf Kosten des Tageskontingents.

@returns die gelesenen Zahlen, damit der Aufrufer nicht erneut umwandeln muss
```

<a id="nachschlag-ttl-ms"></a>
## `NACHSCHLAG_TTL_MS`

```text
═══════════════════════════════════════════════════════════════════════════
Nachschlagewerk — zwei Übersetzungstabellen, die sich während einer
Bewertung nicht ändern
═══════════════════════════════════════════════════════════════════════════

── Was gemessen wurde ──────────────────────────────────────────────────────

Datenbank-Abfragen JE STÜCK, bei warmem Preis-Cache, 50 Stück je Art:

    Sets           10 Abfragen   0,2 je Stück    6 ms
    Minifiguren    55 Abfragen   1,1 je Stück   20 ms
    Teile         205 Abfragen   4,1 je Stück   81 ms

Die Set-Bewertung lädt alles mit `= ANY($1)` vor und rechnet dann aus Maps
(computeSetsValuation). Die Teile-Bewertung fragt statt dessen JE TEIL vier
Mal nach — und zwei dieser vier Fragen haben für alle Teile dieselbe
Antwort:

    50x SELECT bl_color_id FROM rb_colors WHERE id=$1     ← 50x Farbe 4
    50x SELECT bl_part_num FROM rb_bl_mapping WHERE …
    50x SELECT bl_part_number FROM parts WHERE …          ← siehe Index
    50x SELECT … FROM part_price_cache WHERE …            ← die eigentliche
                                                            Arbeit, je Teil

── Warum ein Gedächtnis und keine Vorablade-Abfrage ────────────────────────

Vorladen wie bei den Sets ginge nur in computePartsValuation. Die beiden
Übersetzungen stecken aber in fetchPartPrice, und das rufen ausserdem
routes/parts.ts, utils/marketPrice.ts und die Schätzung über die Einzelteile
einer Minifigur auf — jeweils für EIN Stück. Ein Vorrat, den nur ein
Aufrufer füllt, hilft den anderen dreien nicht; ein Gedächtnis hilft allen.

── Warum das gefahrlos ist ─────────────────────────────────────────────────

rb_colors und rb_bl_mapping sind Nachschlagewerke: geschrieben werden sie
vom Rebrickable-CSV-Abgleich und vom Nachtrag-Job, nicht im Anfragepfad.
Eine LEGO-Farbnummer ändert ihre BrickLink-Entsprechung nicht.

FEHLSCHLÄGE werden bewusst NICHT gemerkt. Sonst hielte ein Start vor dem
ersten CSV-Abgleich für zehn Minuten fest, dass es keine Übersetzung gibt —
und der Nachtrag-Job, der genau diese Lücken füllt, bliebe so lange
wirkungslos. Ein Fehlschlag kostet nach dem Teilindex auf parts (siehe
db/database.ts) ohnehin nur noch Mikrosekunden.
```

<a id="farbkarte"></a>
## `_farbkarte`

```text
Die Farbtabelle als GANZES merken, nicht Zeile für Zeile.

rb_colors hat rund 200 Zeilen. Ein Gedächtnis je Schlüssel hätte hier eine
unangenehme Lücke: Ein FEHLSCHLAG wird bewusst nicht gemerkt (siehe oben) —
und eine Farbnummer, die BrickLink nicht kennt, wäre damit weiterhin je Teil
eine eigene Abfrage. Die ganze Tabelle zu halten macht den Fehlschlag
genauso billig wie den Treffer: Wer nicht in der Karte steht, steht nicht in
der Tabelle.

Kosten: eine Abfrage je zehn Minuten, für alle Farben zusammen.
```

<a id="blteil"></a>
## `_blTeil`

```text
Rebrickable-Teilenummer → BrickLink-Teilenummer (bl_zuordnung, gepflegt
durch fetchMissingBlIds nach dem CSV-Sync). Ohne diese Übersetzung antwortet
BrickLink für RB-Nummern mit 404 RESOURCE_NOT_FOUND — analog zu
resolveBlColorId für die Farben. Unbekannte Nummern (oder bereits
BL-Nummern) laufen unverändert durch.

── EINE Quelle, nicht zwei ────────────────────────────────────────────────

Hier stand ein Rückfall auf `parts.bl_part_number`, und seine Begründung
war, dass die beiden Orte auseinanderlaufen KONNTEN: „Scheitert dort aber
ausgerechnet das INSERT in rb_bl_mapping (es wird protokolliert und
übergangen), bleibt die Lücke FÜR IMMER."

Genau diese Lücke gibt es mit Migration 0037 nicht mehr: Die Nummer steht
an einer Stelle, also kann sie dort fehlen oder dastehen — aber nicht an
einer von zwei Stellen fehlen. Der Rückfall ist damit nicht nur unnötig,
sondern unmöglich geworden, und mit ihm die zweite Abfrage je Teil.
blAbrufNummer und nicht blNummerVon: Eine Zeile mit leerer bl_id heisst
„heisst bei BrickLink genauso" und ist eine vollstaendige Antwort. Als
null kaeme sie hier als FEHLSCHLAG an, und das Nachschlagwerk merkt
Fehlschlaege bewusst nicht — jedes Teil fragte dann wieder einzeln.
GEMESSEN an test/bewertung-abfragen-db.test.js: 20 Einzelabfragen statt 0.
```

<a id="ladeblnummernvor"></a>
## `ladeBlNummernVor`

```text
Die BrickLink-Nummern EINER Bewertung in zwei Abfragen vorladen.

── Warum ──────────────────────────────────────────────────────────────────
resolveBlPartNumber() fragt je Teil einzeln — und anders als bei den Farben
hilft das Gedächtnis innerhalb einer Bewertung nicht, weil jedes Teil eine
ANDERE Nummer hat. NACHGEMESSEN an 50 Teilen: 50 Abfragen auf rb_bl_mapping
plus 50 auf parts. Dieselben Antworten passen in EINE Abfrage — seit
Migration 0037 in eine statt zwei, weil es nur noch eine Quelle gibt.

Das ist genau das Muster, das computeSetsValuation seit jeher benutzt:
alles mit `= ANY($1)` vorladen, dann aus Maps rechnen (0,2 Abfragen je Set
gegenüber 4,1 je Teil, gemessen bei warmem Preis-Cache).

Gefüllt wird das GEMEINSAME Gedächtnis, nicht ein eigener Vorrat: So findet
fetchPartPrice die Antwort auf seinem gewohnten Weg.

FEHLSCHLÄGE bleiben ungemerkt (siehe nachschlagwerk): Ein Teil ohne
Übersetzung fragt weiterhin nach. Die Frage ist ein Zugriff auf den
Primärschlüssel von bl_zuordnung; sie zu merken hiesse, den Nachtrag-Job
zehn Minuten lang zu übersehen.
```

<a id="fetchpartprice"></a>
## `fetchPartPrice`

```text
── Ein Schlüsselraum für den Teile-Cache ───────────────────────────────────

Die Nummer wird HIER übersetzt, ganz oben, und danach für alles benutzt: den
Cache-Zugriff, die Anfrage und das Schreiben. Vorher übersetzte diese
Funktion nur die FARBE; die Teilenummer nahm sie so, wie der Aufrufer sie
mitbrachte — und die drei Aufrufer bringen Verschiedenes mit:

  utils/financeCalc.ts:878   part.bl_part_number || part.part_number → BL
  routes/parts.ts:224        partNumber                              → RB
  routes/minifigs.ts:203     blPartNum                               → BL

Für ein Teil, dessen Nummern sich unterscheiden, standen dadurch ZWEI Zeilen
für denselben Gegenstand in part_price_cache, mit eigener Frist. Die
Bewertung sah die Zeile nicht, die der Marktpreis der Teileansicht
geschrieben hatte, und umgekehrt — jede holte den Preis erneut. Und
getPartPriceHistory fragte unter der BrickLink-Nummer, fand also nur die
Hälfte: für ein Teil, das nur über routes/parts.ts lief, gar nichts.

Der Kommentar in utils/priceHistory.ts behauptete diesen einen Schlüsselraum
bereits („werden unter der BRICKLINK-Teilenummer geschrieben"). Für die
Farbe stimmte er, für die Nummer nicht. Jetzt stimmt er für beides.
```

<a id="fetchpartprice-2"></a>
## Abschnitt

```text
Verlaufspunkt mitschreiben — nur bei echtem Preis.

Der Cache oben speichert über sein UNIQUE nur den ZULETZT abgerufenen
Wert; ohne diesen Eintrag gäbe es keine Vergangenheit, aus der sich ein
Diagramm zeichnen liesse. Gleiches Muster wie bei Sets
(jobs/priceJob.ts schreibt dort in price_history).

ON CONFLICT DO NOTHING wie dort: Die Tabelle hat bewusst keinen
eindeutigen Schlüssel, die Klausel schützt nur gegen künftige.
Nullwerte werden ausgelassen — ein Nullpunkt sähe im Diagramm aus wie
ein Kurssturz.
```

<a id="fetchminifigprice"></a>
## Abschnitt

```text
Verlaufspunkt mitschreiben — nur bei echtem Preis.

Der Cache oben speichert über sein UNIQUE nur den ZULETZT abgerufenen
Wert; ohne diesen Eintrag gäbe es keine Vergangenheit, aus der sich ein
Diagramm zeichnen liesse. Gleiches Muster wie bei Sets
(jobs/priceJob.ts schreibt dort in price_history).

ON CONFLICT DO NOTHING wie dort: Die Tabelle hat bewusst keinen
eindeutigen Schlüssel, die Klausel schützt nur gegen künftige.
Nullwerte werden ausgelassen — ein Nullpunkt sähe im Diagramm aus wie
ein Kurssturz.
```
