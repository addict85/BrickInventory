# Begründungen zu `utils/handlers/sets.ts`

Die ausführlichen Kommentare aus `utils/handlers/sets.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="set-sorts"></a>
## `SET_SORTS`

```text
Leseabfragen für Sets, samt der Ableitung des Zustands aus den Erfassungen.

── Warum aufgeteilt (Nachtrag 133) ────────────────────────────────────────
utils/handlers.ts fasste Sets, Teile und Minifiguren in 1313 Zeilen zusammen
— benannt nach seiner Rolle („handlers"), nicht nach seinem Inhalt, wie
zuvor schon js/07-admin.js. Die drei Domänen berühren sich kaum: Nur
getSets() liest Teile, und die Minifiguren-Kennzahlen lesen Sets. Beides
geht in EINE Richtung, es entsteht also kein Kreis.
```

<a id="set-sorts-2"></a>
## Abschnitt

```text
Anzahl der besessenen Exemplare.

`s.quantity` ist hier KEINE Tabellenspalte mehr — die ist mit Migration
0036 weg. `s` ist in beiden Zweigen von `setsFrom` eine Unterabfrage, und
deren Mengenspalte heisst `quantity` (aus utils/bestandsmenge.ts). Diese
Sortierung bleibt dadurch wörtlich stehen, und das ist Absicht: Der Name
nach aussen soll sich nicht ändern, nur seine Herkunft.

Zweiter Sortierschlüssel: Ohne ihn stehen alle Sets mit derselben Anzahl —
und das sind fast alle, nämlich die mit genau einem Exemplar — in einer
von Postgres nicht festgelegten Reihenfolge. Beim Blättern könnte
dasselbe Set dadurch zweimal oder gar nicht erscheinen.
```

<a id="getsets-set-cols"></a>
## `SET_COLS`

```text
Explizite Spaltenliste statt SELECT *: id/user_id/updated_at
werden weder von der Webapp noch von der Android-App gelesen — sie haben
den JSON-Payload der /sets-Antwort nur unnötig aufgebläht.
Mit "s." qualifiziert: die angehängte Aggregat-Subquery führt set_number
ebenfalls, unqualifiziert wäre die Spalte ab jetzt mehrdeutig.
Ohne purchase_price und condition (Migration 0032): Beides kommt aus den
Erfassungen — `avg_purchase_price` und `max_purchase_price` aus dem JOIN
weiter unten, der Zustand aus conditionFromAcquisitions(). Die Antwort
behaelt das Feld `condition`, es wird nur nicht mehr aus der Spalte
gelesen.
── Hier stand ein COALESCE auf den Katalog, und warum es weg ist ───────

`image_url` kam mit einem Rückfall: `COALESCE(s.image_url, sc.image_url)`,
dazu ein LEFT JOIN auf `set_catalog` weiter unten. Das war die Abhilfe zu
Marcos Bericht (Nachtrag 36): „wenn das Bild lokal noch nicht vorhanden
ist, soll es direkt via Proxy vom CDN geholt werden". Stand in der eigenen
sets-Zeile nichts — weil der Bild-Download in seine 15-Sekunden-Frist lief,
weil das Set über CSV oder Barcode kam, oder weil eine ältere Zeile das
Feld nie gefüllt hat —, lieferte die API image_url: null UND
image_local: null, und beide Clients zeigten den Platzhalter.

Mit Migration 0033 gibt es nichts mehr, wovon zurückzufallen wäre: Die
Adresse steht nur im Katalog, und jede Abfrage holt sie über ihren eigenen,
ausgeschriebenen JOIN darauf.
Der Rückfall war die richtige Abhilfe für zwei Spalten; eine Spalte braucht
ihn nicht. Genau das war auch das Problem daran — er stand in EINER
Abfrage, und jede andere kannte ihn nicht.
```

<a id="getsets-setsfrom"></a>
## `setsFrom`

```text
── Ein Set, EINE Zeile ─────────────────────────────────────────────────

Im Haushalt besitzen womöglich zwei Kinder dasselbe Set. Es soll trotzdem
nur einmal erscheinen — mit der Summe der Mengen und den Kaufpreisen aller
Besitzer. Zwei Zeilen mit demselben Bild und Namen lesen sich wie ein
Fehler in der Liste.

Das Verdichten steckt in einer Unterabfrage, die dieselben Spaltennamen
liefert wie die Tabelle. Alles darunter — Filter, Sortierung,
Seitenaufteilung, der Erfassungs-JOIN — bleibt dadurch unverändert; nur
die Quelle ist eine andere. Ohne Haushalt (ein Konto) wird gar nicht erst
gruppiert, dann ist es wörtlich die alte Abfrage.

MIN() auf den Stammdaten ist kein Zufallsgriff: Name, Jahr, Thema und Bild
beschreiben DAS SET, nicht das Exemplar — sie sind über die Konten hinweg
gleich. MIN(added_at) ist bewusst das früheste Aufnahmedatum im Haushalt.

Seit Migration 0033 sind sie es nicht nur „hinweg gleich", sondern
buchstäblich derselbe Wert: Sie kommen aus `set_catalog`, über den JOIN
unten. MIN() bleibt trotzdem stehen — die Gruppierung über `set_number`
verlangt für jede nicht gruppierte Spalte eine Zusammenfassung, und
„irgendeinen von identischen Werten" sagt MIN() am kürzesten.
```

<a id="getsets"></a>
## Abschnitt

```text
Auch ohne Haushalt eine Unterabfrage, und zwar NUR wegen des Lagerorts:
Alles darunter (Filter `s.storage = $n`, Sortierung, Ausgabe) erwartet
den NAMEN in einer Spalte namens `storage` — die Tabelle traegt seit
Migration 0031 aber die ID. `s.*` plus die aufgeloeste Spalte liefert
genau die alte Form, und der Filter bleibt unberuehrt.

── Beide Seiten ausgeschrieben, kein `s.*` ───────────────────────────

Die Stammdaten stehen seit Migration 0033 in `set_catalog`, der Bestand
in `sets`. Beide Listen hier einzeln zu nennen ist der Preis dafür, dass
die Abfrage ohne Nachschlagen lesbar bleibt — und sie ist nötig:

`s.*` brachte auf einer Datenbank, der Migration 0033 noch FEHLT, ein
zweites `name` mit (schema.sql legt die Spalte an, damit Migration 0014
sie anfassen kann). Jeder Zugriff darauf wurde damit zweideutig.
GEMESSEN an test/api-parity.test.js, das nur initSchema() ruft und keine
Migrationen: „column reference \"name\" is ambiguous", und die ganze
Set-Liste antwortete mit 500.
```

<a id="getsets-limitsql"></a>
## `limitSql`

```text
Ohne page_size bleibt die Set-Liste UNBEGRENZT.

Hier stand kurzzeitig eine Obergrenze. Das war falsch, und der Grund hat
sich seither GEÄNDERT — die frühere Begründung stand noch hier:

  „Die Android-App blättert die Galerie NICHT (BrickApiService.getSets
   kennt keinen page-Parameter)."

Das stimmt nicht mehr. SetsRepository.getSets nimmt page und pageSize,
und loadMoreSets fordert `galleryPage + 1` an: BEIDE Clients blättern.
Der Satz stand an drei Stellen, berichtigt wurde nur eine (die Notiz in
routes/api_v1/sets.ts) — dieselbe Falle wie bei jeder anderen Regel, die
mehrfach niedergeschrieben ist.

Unbegrenzt bleibt die Liste trotzdem, aus dem Grund, der DORT steht: Der
Weg ist absichtlich offen für Aufrufer, die alles wollen — Skripte und
ältere App-Stände, denen eine stille Grenze ab dem Grenzwert Sets
unterschlüge. Wer blättert, schickt page_size mit und bekommt die Grenze.
```

<a id="getsets-2"></a>
## Abschnitt

```text
Die Anleitungen werden ERST für die geladene Seite geholt (siehe unten) —
dafür braucht es die Setnummern der Seite, also läuft die Set-Abfrage
zuerst und die übrigen danach parallel.

VORHER hingen alle fünf Abfragen in EINEM Promise.all, und die beiden
Anleitungs-Abfragen filterten nur auf user_id. Bei 1000 Sets und einer
Seitengrösse von 60 wurde damit für JEDE Seite der komplette
Anleitungsbestand geladen und zu 94 % weggeworfen — inklusive des JOIN
über shared_instructions.
```

<a id="getsetconditionaggregate"></a>
## `getSetConditionAggregate`

```text
Zustands-Aggregat eines Sets aus seinen Erfassungen.

Die Regel („eine U-Erfassung macht das Set gebraucht; gibt es Erfassungen,
zählt die Spalte sets.condition nicht mehr") stand vorher dreimal im Code:
in getSets(), in getSet() und — leicht falsch — im Frontend, wo nach einer
Zustandsänderung die Bedingung der ZULETZT erfassten Position genommen wurde
statt „irgendeine gebraucht". Bei der Reihenfolge [U, N] zeigte die Kachel
damit „neu", während der Server „gebraucht" meinte.

Jetzt gibt es die Regel einmal, und die Schreib-Endpunkte liefern das
Ergebnis in ihrer Antwort mit — die Clients rechnen nichts mehr nach.
```

<a id="withsetaggregate"></a>
## `withSetAggregate`

```text
Hängt das neu berechnete Zustands-Aggregat an eine Antwort.

Liegt hier und nicht in einer der beiden Routendateien, weil es GENAU dieses
Auseinanderlaufen war, das den Fehler verursacht hat: Der Wrapper existierte
zuerst nur in routes/api_v1/acquisitions.ts, die Webapp benutzt aber ihren
eigenen Handler in routes/sets.ts — und bekam deshalb kein `set` in der
Antwort, sodass die Galerie-Kachel weiterhin veraltet blieb.
```

<a id="getset"></a>
## Abschnitt

```text
── Eine Zeile, aber die Menge des GANZEN Blickfelds ───────────────────

Marcos Vorgabe: „Die Anzahl soll immer von allen angezeigt werden."

Vorher nahm db.get() irgendeine der Haushaltszeilen — welche, entschied
die Reihenfolge in der Tabelle. Marco sah dadurch „Anzahl 0" für ein Set,
von dem das Unterkonto ein Exemplar hält. Die LISTE summierte längst
(getSets gruppiert für Haushalte), nur das DETAIL nicht: dieselbe Frage,
zwei Antworten.

Die eigene Zeile gewinnt für die übrigen Felder — sie beschreibt das
eigene Exemplar (Zustand, Kaufpreis). Die MENGE dagegen kommt aus der
Summe über alle Konten im Blickfeld.
── Der Lagerort muss AUSDRÜCKLICH dastehen ───────────────────────────

Marcos Befund: „Wenn ich einen Lagerort setze und das Set später
aufrufe, ist er weg."

NACHGEMESSEN, Set mit gesetztem Ort:

    sets.storage_id in der Datenbank : 1
    Antwort der LISTE   → storage    : "Estrich"
    Antwort des DETAILS → storage    : undefined

Bis Migration 0031 trug die sets-Zeile den NAMEN in einer Spalte
`storage`, und `s.*` lieferte ihn mit. Seit der Umstellung trägt sie
`storage_id`; `s.*` liefert eine Zahl, die kein Client liest. Die LISTE
löst sie auf (getSets, LEFT JOIN auf storage_locations) — das DETAIL
nicht. Wieder „dieselbe Regel fehlt am zweiten Weg", und wieder zwischen
Liste und Detail, wie schon bei der Menge zwei Kommentare weiter oben.

Zusammengefasst über das BLICKFELD und nicht aus der gewählten Zeile:
Besitzen zwei Kinder dasselbe Set, liegt es in zwei Kisten. Die Liste
schreibt dort „Kiste 3, Regal A"; nähme das Detail nur den Ort der einen
Zeile, verschwiege es den anderen — und zwar so, dass es wie eine
vollständige Antwort aussieht. Die Menge daneben folgt derselben Regel.
```

<a id="getset-2"></a>
## Abschnitt

```text
── Zwei Kaufadressen, vom Server aufgeloest ────────────────────────────

Marcos Wunsch: „auf dem Detail-Dialog sowohl den BrickLink-Link analog
dem Katalog als auch die URL des Preisvergleichs als Buttons".

„Analog dem Katalog" ist woertlich zu nehmen: Der Katalog laesst die
BrickLink-Adresse seit jeher vom Server aufloesen (resolveOne), weil sie
sich NICHT aus der Setnummer herleiten laesst — Gear und Buecher liegen
unter einem anderen Parameter, Sammelminifiguren unter einer ganz anderen
Nummer. Eine im Klienten gebaute Adresse waere fuer diese Faelle falsch,
und zwar stillschweigend.

Der Preisvergleich kommt aus demselben Grund von hier: Bisher stand seine
Adresse an genau einer Stelle (dem Vergleichsbildschirm der App); vier
Stellen daraus zu machen waere der Anfang von vier Wahrheiten.

Der Fang meldet und macht weiter: Eine nicht aufloesbare BrickLink-Adresse
darf das Set-Detail nicht kosten (es zeigt dann nur den einen Knopf), aber
sie soll auch nicht stillschweigend verschwinden — sonst sucht der
Naechste den fehlenden Knopf im Klienten.
```

<a id="deletesetrows"></a>
## `deleteSetRows`

```text
Die Zeilen, die zu EINEM Set-Exemplar eines Kontos gehören.

Steht als eigene Funktion da, weil es zwei Anlässe gibt, sie loszuwerden:
das ausdrückliche Löschen (deleteSet) und das Wegfallen der letzten
Erfassung (routes/api_v1/acquisitions.ts). Zwei Listen von DELETEs wären
genau die Art Doppelung, an der in diesem Projekt schon mehrfach eine Regel
nur an einer der beiden Stellen nachgezogen wurde — hier hiesse das:
verwaiste Teile und Minifiguren ohne zugehöriges Set.

Erwartet eine offene Transaktion; die Aufrufer bringen ihre eigene mit.
```
