# Begründungen zu `utils/merkliste.ts`

Die ausführlichen Kommentare aus `utils/merkliste.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Die Merkliste — was man haben MÖCHTE, getrennt von dem, was man hat.

── Warum dieser Helfer und nicht Code in der Route ─────────────────────────

Dieselbe Begründung wie bei utils/lagerort.ts: Die Merkliste wird von
beiden Oberflächen und über drei Erfassungswege bedient (Katalog-Detail,
Setnummer, Barcode). Stünden Normalisierung, Zustandsvorgabe und die
Übernahme in die Galerie in den Routen, gäbe es jede Regel mehrfach — und
in diesem Baum ist genau das schon mehrfach auseinandergelaufen.

── Die Übernahme ruft addSet() und baut nichts Eigenes ─────────────────────

„Direkt in die Galerie übernehmen" heisst: dasselbe tun wie das Erfassen
einer Setnummer. utils/setService.ts:addSet() ist dafür die eine Wahrheit —
es bestimmt den Zustand über zustandFuerPreis(), holt den Marktpreis, legt
die Erfassungszeile an, hält die Bestandssperre und stösst die
Anreicherung an. Ein eigenes INSERT INTO sets hier wäre die zweite
Wahrheit und hätte von alldem nichts.

── Der Zustand steht im Schlüssel ──────────────────────────────────────────

Neu und gebraucht sind verschiedene Merkposten mit verschiedenen Schwellen.
price_alerts führt den Zustand seit 0019 genauso; beide Tabellen treffen
sich über (user_id, set_number, condition), ohne dass eine die andere
kennen muss.
```

<a id="merkposten"></a>
## Abschnitt

```text
Der Marktpreis im Zustand DIESES Merkpostens — null, solange keiner
bekannt ist.

── Marcos Vorgabe vom 24.09. ────────────────────────────────────────────

„Bitte in der Tabelle der Merkliste der Button In die Galerie aufnehme
 entfernen und dafuer den Marktpreis anzeigen."

── Warum aus dem CACHE und nicht frisch geholt ──────────────────────────

Ein Abruf je Zeile waere bei zwei Dutzend Merkposten ein Dutzend
BrickLink-Anfragen beim Oeffnen des Reiters — und die Liste wartete
darauf. Sie ist aber ohnehin da: jobs/priceJob.ts frischt die Preise der
Merkposten taeglich auf (die Begruendung steht dort ausdruecklich —
„ausgerechnet fuer einen Merkposten ist die Preisentwicklung das
Wichtigste"). Ein LEFT JOIN kostet nichts und liefert genau den Stand,
den der Job hinterlegt hat.

Kein Preis heisst hier „noch keiner im Cache", nicht „wertlos" — die
Oberflaechen zeigen dafuer einen Strich.
```

<a id="merkposten-2"></a>
## Abschnitt

```text
Die lokal abgelegte Bilddatei — wenn es sie gibt.

── Warum das hier dazugehoert ──────────────────────────────────────────

Marcos Befund: „Die Bilder in der Merkliste werden nicht geladen …
anscheinend wird direkt das CDN aufgerufen." Genau so war es, und die
Sicherheitsrichtlinie der Seite (img-src 'self' data: blob:) hat es
geblockt — richtigerweise.

Jede andere Liste im Baum fuehrt image_local MIT und zieht es dem
CDN-Pfad vor: Die Datei liegt schon auf der Platte, und eine
Proxy-Anfrage waere ein Umweg ueber das Netz fuer etwas, das danebenliegt.
Der Katalog macht es mit derselben Zeile (routes/api_v1/catalog.ts).

null heisst „noch nicht heruntergeladen" — dann laedt die Oberflaeche
ueber den Bild-Proxy, der die Datei nebenbei anlegt.
```

<a id="merkposten-3"></a>
## Abschnitt

```text
Der Preisalarm zu GENAU diesem Merkposten — oder null.

Er steht in price_alerts und nicht hier (siehe 0021); beide Tabellen
teilen sich den Schluessel (user_id, set_number, condition). Er reist
trotzdem mit: Wer einen Alarm setzt und ihn danach nirgends mehr sieht,
hat ihn verloren. Ein eigener Aufruf je Zeile waere N+1 fuer eine Liste,
die auch hundert Eintraege haben kann.
```

<a id="merkposten-4"></a>
## Abschnitt

```text
Preisvergleich — die Adresse, die der Knopf im Detail oeffnet.

── Warum sie AM MERKPOSTEN haengt und nicht am Katalog ────────────────────

Beide Oberflaechen holten sie bisher aus /catalog/sets/:nr, zusammen mit
Thema und Teilezahl. Damit haengt ein Knopf, der nur die Setnummer
braucht, an einer zweiten Anfrage: Ist das Set in rb_sets nicht
vorhanden (Katalog noch nicht geladen, Set zu neu, Eigenbau), antwortet
die Route 404 — und der Knopf bleibt aus, obwohl die Adresse aus der
Nummer allein zu bilden gewesen waere.

Sie reist deshalb mit der Liste mit. Der Name kommt aus rb_sets, wenn es
ihn gibt; fehlt er, sucht die Adresse eben nur nach der Nummer
(utils/preisvergleich.ts). Immer gesetzt, nie leer — ausser die Nummer
waere leer, und dann gaebe es den Merkposten nicht.
```

<a id="legemerkpostenan"></a>
## `legeMerkpostenAn`

```text
Einen Merkposten anlegen.

ON CONFLICT statt vorher fragen: Zwei Geräte, die denselben Merkposten
gleichzeitig eintragen, sollen nicht einer davon einen Fehler sehen. Das
Ergebnis sagt, ob es neu war — die Oberfläche meldet sonst „ist schon
drauf" statt „hinzugefügt".

DO UPDATE SET condition = wanted.condition ist eine Zuweisung ohne
Wirkung, und sie steht mit Absicht da: Ohne UPDATE-Zweig liefert
RETURNING für eine bestehende Zeile gar nichts, und `war_neu` wäre dann
nicht false, sondern unbekannt. Hier stand vorher die Notiz; seit sie
ausgebaut ist (Migration 0022), gibt es nichts mehr zu ändern.

── Das Aufnahmedatum als Parameter (Nachtrag: Import) ──────────────────────

`aufgenommenAm` ist für den CSV-Import da und sonst für nichts: Eine
wiederhergestellte Merkliste soll die ALTEN Daten tragen, nicht das Datum
der Wiederherstellung. „Auf der Liste seit" ist die einzige Angabe, die ein
Merkposten über sich selbst macht (dieselbe Begründung steht unten bei
verschiebeMerkposten) — ein Import, der sie auf heute setzt, verliert sie
für die ganze Liste auf einmal.

COALESCE statt zweier Fassungen der Anweisung: NOW() lässt sich nicht als
Parameter übergeben, und zwei Textfassungen desselben INSERT sind genau die
Doppelung, die dieser Baum an einem Dutzend Stellen bekämpft. Dieselbe
Lösung wie in test/helpers/bestand.js (erfasse).

Bei einem Merkposten, den es SCHON gibt, bleibt das vorhandene Datum
stehen: Der DO-UPDATE-Zweig fasst created_at nicht an. Ein Import darf eine
bestehende Liste ergänzen, aber nicht deren Geschichte umschreiben.
```

<a id="verschiebemerkposten"></a>
## `verschiebeMerkposten`

```text
Den Merkposten einem anderen Konto geben.

── Marcos Befund ──────────────────────────────────────────────────────────

„Auf dem Detail-Dialog der Merkliste kann der Inhaber nicht geändert
werden. Auch in der Android-App nicht."

Er hat recht: Beim ERFASSEN liess sich das Konto wählen, danach nie wieder.
Wer sich vertippt hat, musste löschen und neu anlegen — und verlor dabei
den Preisalarm.

── Warum UPDATE und nicht löschen plus neu anlegen ────────────────────────

Weil das Aufnahmedatum bleiben soll. „Auf der Liste seit" ist die einzige
Angabe, die ein Merkposten über sich selbst trägt; ein Neuanlegen setzte sie auf
heute, und niemand sähe, dass es dieselbe Sache ist.

── Was mit dem Preisalarm geschieht ───────────────────────────────────────

Er zieht mit. Der Alarm gehört zum Merkposten (derselbe Schlüssel: Konto, Set,
Zustand) — bliebe er zurück, meldete er dem alten Konto einen Preis für
etwas, das es nicht mehr auf der Liste hat.

── Und wenn das Zielkonto den Merkposten schon hat ────────────────────────────

Dann ist das Ziel erreicht, und die Quelle verschwindet — samt ihrem Alarm.
Die Schwelle des ZIELS bleibt stehen: Sie ist die jüngere Aussage über das
Konto, dem der Merkposten jetzt gehört. Das Ergebnis sagt es (`zusammengefuehrt`),
damit die Oberfläche nicht „verschoben" meldet, wo etwas verschwunden ist.

@returns verschoben=false heisst: Es gab nichts zu verschieben (kein Merkposten
         unter dem alten Konto, oder altes und neues Konto sind dasselbe).
```

<a id="merk-sorts"></a>
## `MERK_SORTS`

```text
Die Sortierungen der Merkliste.

── Warum nicht dieselbe Tabelle wie bei den Sets ──────────────────────────

Die Namen sind absichtlich dieselben wie in SET_SORTS (utils/handlers/sets.ts)
— beide Oberflaechen beschriften sie mit denselben Texten, und wer die
Galerie kennt, erwartet in der Merkliste dieselbe Auswahl. Die AUSDRUECKE
koennen es nicht sein: Dort steht `s.added_at`, hier `w.created_at`; dort
ist der Preis der KAUFPREIS aus den Erfassungen, hier der MARKTPREIS aus
dem Cache, denn gekauft hat man einen Merkposten gerade nicht.

qty_desc/qty_asc fehlen mit Absicht: Ein Merkposten hat keine Anzahl.

NULLS LAST ueberall dort, wo der Wert fehlen kann: Ein Set, das rb_sets
nicht kennt, hat weder Namen noch Jahr, und ein Merkposten ohne Preis im
Cache keinen Marktpreis.

GEMESSEN (test/merkliste-filter-db.test.js, Gegenprobe d): Wirkung hat die
Angabe nur bei DESC — dort ist NULLS FIRST die Vorgabe von Postgres, und
ohne sie stuenden die Zeilen OHNE Preis ganz oben. Bei ASC ist NULLS LAST
ohnehin die Vorgabe; dort steht sie nur, damit die Tabelle sich in jeder
Zeile gleich liest. Das ist eine Messung und keine Vermutung: Die erste
Gegenprobe strich sie bei name_asc und blieb gruen.

Zweiter Sortierschluessel ueberall: Dasselbe Set steht zweimal da (neu und
gebraucht) und im Kontenbaum bei mehreren Konten. Ohne ihn legt Postgres
die Reihenfolge dieser Zeilen nicht fest, und sie sprang bei jedem Laden.
```

<a id="merkfilter"></a>
## `MerkFilter`

```text
Suche, Zustand und Sortierung — Marcos Vorgabe „in der Merkliste noch einen
Filter analog den Sets einbauen inkl. Inhaber".

Der INHABER steht nicht in diesem Typ: Er ist das Blickfeld und kommt als
`userIds` herein, genau wie in jeder anderen Liste dieses Baums. Die Route
uebersetzt `accounts=` mit scopeIds() dorthin — eine zweite Stelle, die
Konten auswaehlt, waere die Doppelung, vor der src/haushalt/haushalt.ts warnt.
```

<a id="merkpostenvon"></a>
## `merkpostenVon`

```text
Die Merkposten eines Blickfelds.

`userIds` und nicht `userId`: Marcos Festlegung ist, dass die Merkliste
dem Kontenbaum folgt wie alles andere — der Grossvater sieht die Merkposten
der Enkel. Das ist hier nicht nur konsequent, sondern der Zweck: Wer ein
Geschenk sucht, schaut genau dort nach.

Der LEFT JOIN auf rb_sets liefert die Anzeige (siehe Migration 0021: keine
zweite Kopie der Stammdaten). Ein Set, das der Katalog nicht kennt, kommt
mit NULL-Namen zurück und zeigt in der Oberfläche seine Nummer.

`owned` beantwortet die Frage, die in der Liste sofort aufkommt: „Habe ich
das inzwischen?" — es prüft dasselbe Blickfeld, nicht nur das eigene Konto.
```

<a id="merkpostenvon-suche"></a>
## `suche`

```text
── Die Suche trifft Nummer UND Namen ─────────────────────────────────────

Dieselbe Erwartung wie in der Galerie: Wer „Falcon" tippt, sucht nicht
nach einer Nummer, und wer „75192" tippt, nicht nach einem Namen. Der Name
steht nicht in `wanted`, sondern kommt aus dem LEFT JOIN auf rb_sets
(siehe Migration 0021: keine zweite Kopie der Stammdaten) — ein Set, das
der Katalog nicht kennt, ist deshalb nur ueber seine Nummer zu finden.

Die Platzhalter % stehen im WERT und nicht im SQL: So bleibt die Eingabe
ein Parameter. Ein zusammengesetztes ILIKE '%' || $n || '%' taete
dasselbe, waere aber eine zweite Schreibweise fuer denselben Gedanken.
```

<a id="merkpostenvon-2"></a>
## Abschnitt

```text
── Fehlt das Bild noch, wird es hier bestellt ───────────────────────────

Marcos zweiter Befund: „Leider wird es auch nach ein paar Minuten noch
ueber den Proxy geladen. Scheint so, als wuerde der Pfad nicht dazu
fuehren, dass das Bild im Hintergrund heruntergeladen wird."

Er hat recht, und der Grund steht im Proxy: Eine Notiz fuer den Bild-Job
entsteht dort NUR, wenn eine Vorschau angefragt wurde (routes/imgProxy.ts:
`if (wantThumb) { … } else notiere();`). Das Merkposten-Detail fragt die volle
Aufloesung — also keine Notiz, also kein Download, also auf Dauer der
Umweg ueber den Proxy.

Ein Merkposten ist ein Set, das man NICHT besitzt: Niemand hat sein Bild je
heruntergeladen, und ohne diese Zeile geschieht es auch nie. Bewusst
anders als im Katalog, der „keine Bildarbeit aus der Liste" anstoesst —
der zeigt 25 000 fremde Sets, eine Merkliste ein paar Dutzend.

merkeGebraucht() ist gepuffert und dedupliziert (ON CONFLICT DO NOTHING,
Wegschreiben alle zehn Sekunden); ein erneuter Aufruf fuer dasselbe Bild
kostet nichts. Spaetes require wie in routes/api_v1/catalog.ts:
utils/ -> jobs/ -> utils/ waere am Dateikopf ein Ladezyklus.
```

<a id="merkpostenvon-3"></a>
## Abschnitt

```text
Number() ist hier ein NETZ, keine Umrechnung: NACHGEMESSEN liefert der
Treiber NUMERIC bereits als Zahl, weil db/database.ts:63 dafuer einen
Typ-Leser setzt (parseFloat). Die Zeile bleibt trotzdem stehen — der
Zeilentyp laesst `string | number` zu, und ohne sie haengt die
Richtigkeit des Feldes an einer Einstellung sechs Dateien weiter.

Der erste Entwurf dieses Kommentars behauptete das Gegenteil („kommt
als Zeichenkette"). Die Gegenprobe hat es widerlegt: Number()
weggelassen — der Test blieb gruen.
```

<a id="uebernimm"></a>
## `uebernimm`

```text
Einen Merkposten in die Galerie uebernehmen.

── Warum addSet() und kein eigenes INSERT ─────────────────────────────────

„Direkt in die Galerie uebernehmen" ist dasselbe wie eine Setnummer
erfassen. addSet() ist dafuer die eine Wahrheit: Zustand ueber
zustandFuerPreis(), Marktpreis, Erfassungszeile, Bestandssperre,
Anreicherung. Ein eigenes INSERT INTO sets haette von alldem nichts.

── Warum das hier steht und nicht in der Route ────────────────────────────

Weil es eine Regel ist und keine Vermittlung. In der Route liesse sie sich
nur ueber HTTP pruefen, und die App braucht sie genauso wie die Webapp.

── Was danach verschwindet ────────────────────────────────────────────────

Eintrag UND Preisalarm, nach Marcos Festlegung: Wer das Set hat, will in
der Regel nicht weiter auf einen Preis warten — und die Set-Detailansicht
hat ein Alarmfeld, der Weg zurueck ist einen Griff weit.

Geloescht wird ERST NACH dem erfolgreichen addSet(). Andersherum waere der
Merkposten bei einem Fehler im Erfassen weg und das Set nicht da.
```

<a id="uebernimm-merkpostenzustand"></a>
## `merkpostenZustand`

```text
── ZWEI Zustaende, und sie sind nicht dasselbe ──────────────────────────

`condition` (Pfad) ist der Zustand des MERKPOSTENS — der Schluessel der
Zeile, die verschwindet. `eingabe.condition` ist der Zustand, in dem das
Set tatsaechlich ERFASST wird.

Sie fallen auseinander, sobald jemand etwas anderes kauft, als er sich
gewuenscht hat: Merkposten „gebraucht", gefunden wurde ein neues. Dann muss
der gebrauchte Merkposten weg (den hat man erfuellt) und das Set als neu in
die Galerie (das hat man gekauft).

Vorher gab es nur einen Wert fuer beides. Das war stillschweigend falsch:
In der Finanzansicht stuende die Erfassung in der falschen Gruppe —
dieselbe Verwechslung, die in addSet() schon einmal einen Gebrauchtpreis
als Neuzugang verbucht hat.
```

<a id="buildmerklistecsv"></a>
## `buildMerklisteCsv`

```text
Die Merkliste EINES Kontos als CSV — für den ZIP-Export.

── Warum nur drei Spalten ──────────────────────────────────────────────────

Ein Merkposten IST (Konto, Set, Zustand) plus das Aufnahmedatum; alles
andere, was die Ansicht zeigt — Name, Jahr, Teilezahl, Marktpreis,
Alarmschwelle —, gehört ihm nicht. Der Name steht in rb_sets, der Preis im
price_cache, der Alarm in price_alerts. Sie mit zu exportieren sähe
vollständiger aus und wäre es nicht: Beim Import müsste jede dieser Spalten
entweder verworfen werden (dann war sie Zierde) oder in eine fremde Tabelle
geschrieben (dann schreibt der Merklisten-Import den Katalog um).

Der Preisalarm kommt deshalb als EIGENE Datei (preisalarme.csv, Stück 2 von
Marcos Liste) und nicht als Spalte hier.

── Das Datumsformat ────────────────────────────────────────────────────────

TO_CHAR(... AT TIME ZONE 'UTC','YYYY-MM-DD') — zeichengleich wie im
Set-Export (SETS_CSV_SQL). Nicht die rohe Zeitmarke: Die trägt eine
Zeitzone, und ein Tabellenprogramm macht daraus irgendetwas.

── Ein Konto, nicht das Blickfeld ──────────────────────────────────────────

`user_id = $1` und nicht `= ANY($1)`: Der Export ist eine Sicherung der
EIGENEN Liste. Nähme er den Kontenbaum mit, bekäme der Grossvater die
Merkposten der Enkel in seine Datei und beim Import gehörten sie ihm. Die
drei bestehenden Exporte sind genauso geschnitten (ein uid, siehe
buildSetsCsv).
```
