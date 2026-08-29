# Nachträge 76–100

Teil der Fix-Historie — Übersicht in [CHANGELOG-fixes.md](../CHANGELOG-fixes.md).

---

## Nachtrag 78 (hardened-174) — Portfoliokurve ignorierte den Kontofilter

**Marcos Fund:** „Wenn ich meinen Account wähle oder ein anderes Unterkonto,
wird immer -0,5 % angezeigt."

**Ursache.** Der Schlüssel des Portfolio-Schnappschusses hing an der ID des
BETRACHTERS (`'__portfolio__' + viewerId`). Wählte das Hauptkonto im Filter ein
Unterkonto, wurde trotzdem der eigene Schnappschuss gelesen — gleiche Kurve,
gleicher Prozentwert, egal was im Filter stand. Der Filter sah aus, als täte er
nichts, und genau so hat Marco es beschrieben.

Bei genau EINEM Konto gilt jetzt dessen Schnappschuss. Bei mehreren wird die
Kurve ohnehin aus dem Preisverlauf je Set rekonstruiert.

Nachgemessen mit zwei deutlich verschiedenen Schnappschüssen (1000 gegen 5000):
vorher zeigten beide Konten 1003→1000, nachher das Unterkonto korrekt
5003→5000. Test `test/portfolio-scope-db.test.js`, Gegenprobe bestanden.

**NOCH OFFEN — Marcos zweiter Punkt (+712 %).** Bei „Alle Konten" wird die
Kurve aus dem Preisverlauf je Set rekonstruiert, und sie beginnt am ersten Tag
bei nahezu null: Sets, für die an diesem Tag noch kein Preis aufgezeichnet war,
zählen mit 0 und kommen später dazu. Der Sprung von 0 auf ~24 000 ergibt die
712 %. Der Schnappschuss-Weg hat das Problem nicht, weil er den Gesamtwert
speichert.

Das ist eine ANDERE Ursache als der Filter-Fehler oben und braucht eine eigene
Entscheidung: führende Tage mit unvollständiger Preisabdeckung verwerfen, oder
den ersten Wert je Set rückwärts fortschreiben. Beides ändert die Kurve
sichtbar, deshalb hier bewusst NICHT im Vorbeigehen entschieden.

554 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 79 (hardened-175) — Geheimnisse, Blickfeld, und die Etappen 5 und 6

Ausgangspunkt war Marcos Frage, ob es zwischen Webapp und App noch Logik gibt,
die unterschiedlich funktioniert oder doppelt existiert. Aus der Durchsicht
sind vier Punkte umgesetzt, zwei davon Fehler.

### 1. SICHERHEITSLÜCKE: `GET /api/settings/raw` gab Geheimnisse im Klartext

`GET /api/settings/` maskiert die API-Zugangsdaten seit Langem, und der
Kommentar über `sanitizeGlobal()` erklärt genau warum: Der Router trägt nur
`requireLogin`, LESEN darf also jedes angemeldete Konto — im Haushalt auch
jedes Unterkonto.

`/raw` war eine zweite Fassung derselben Abfrage, nur anders verpackt, und
hatte die Maskierung nie bekommen. Sie spreizte `global_settings` roh, samt
`bricklink_consumer_secret`, `bricklink_token_secret`, `brickset_api_key`,
`rebrickable_api_key` und `smtp_pass`. Und ausgerechnet `/raw` ist die Route,
über die die Einstellungsseite lädt (`loadSettings()` in `05-settings.js`) —
die Maskierung war damit für ihren eigentlichen Konsumenten wirkungslos, und
die Werte landeten im Browser-Speicher, wo jede XSS-Lücke sie mitnimmt.

Fix: Beide Leserouten gehen durch `readSettings(userId, isAdmin)`. Eine neue
Verpackung kann die Maskierung nicht mehr umgehen.

Test `test/settings-secrets-db.test.js` — bewusst als REGEL über die Liste der
Leserouten, nicht als Prüfung der einen reparierten Stelle: Sonst hätte er
denselben Wert wie der bisherige Zustand. Dazu die Gegenrichtung, dass die
Maske überhaupt ankommt (sonst wäre er auch bei leerer Antwort grün).
Gegenprobe bestanden.

### 2. Kontofilter fehlte beim Minifiguren-Preisverlauf — auf BEIDEN Wegen

`conditionRows()` filtert die Erfassungen mit `user_id = ANY(...)`. Der
Set-Verlauf bekam sein Blickfeld in Nachtrag 33, das manuelle Teil in 96/97 —
die Minifigur fiel durch: Beide Routen reichten die nackte Betrachter-ID
durch. Für eine Minifigur des Unterkontos fand die Abfrage keine Erfassung,
und ohne Erfassung entsteht gar keine Zeile: Marktpreis, Kaufpreis und
Prozentangabe blieben leer, `accounts=` wirkte dort überhaupt nicht.

Weil BEIDE Routen denselben Stand hatten, war die Paritätsprüfung grün — sie
vergleicht die Clients miteinander, nicht gegen die Regel.

Nebenbefund: Der Parametertyp stand auf `number`, obwohl die Teile-Routen
längst eine Liste übergaben. Aufgefallen ist das nie, weil alle Aufrufer über
ein spätes `require()` kommen und TypeScript dort nichts prüft.

Test `test/manual-price-history-scope-db.test.js` über ALLE DREI Arten statt
nur die reparierte — genau diese Familie ist in dieser Reihe schon dreimal
einzeln aufgefallen. Gegenprobe bestanden.

### 3. Etappe 5: die Finanz-Routen zusammengelegt

Neun doppelte Routen entfernt: Bewertung (Sets/Teile/Minifiguren), GuV,
Portfolio-Verlauf und die drei Preisverlaufs-Routen. Die Rechnung lag längst
gemeinsam in `utils/financeCalc.ts`, `utils/priceHistory.ts` und
`utils/portfolioHistory.ts` — doppelt waren nur die Routen davor, und genau
dort sind die Zahlen auseinandergelaufen: zuletzt fehlte das Blickfeld beim
Minifiguren-Verlauf auf beiden Wegen (Punkt 2), und die Bewertung lieferte auf
dem einen Weg ein Feld weniger als auf dem anderen.

`/combined-valuation` ist ersatzlos entfallen: eine DRITTE Bewertungsfassung,
die weder Frontend noch App aufrief und die ausserdem mit der eigenen
Benutzer-ID statt mit `scopeIds()` arbeitete — im Haushalt hätte sie falsch
gerechnet, sobald jemand sie wieder angeschlossen hätte.

### 4. Etappe 6: Einstellungen, Haushalt, Statistik

Acht weitere Doppelungen weg: die vier Haushalts-Routen, `/stats` und die drei
Zustands-Routen. Die Auflösung „eigener Wert → globaler Standard → 'N'" stand
dreimal im Baum und steht jetzt einmal in `utils/settings.ts`
(`effectiveCondition()` / `globalDefaultCondition()`). Der v1-Schreibweg für
`user_default_condition` benutzt `setUserSetting()` statt eines eigenen
`ON CONFLICT` — die Regel „genau EINE Schreibstelle" aus Nachtrag 43 gilt nur,
wenn sie ausnahmslos gilt.

**Bewusst NICHT zusammengelegt: `GET/POST /api/settings`.** Die Route trägt die
globalen Schlüssel samt Geheimnissen und die Admin-Felder. Das ist eine ANDERE
Antwort als die kuratierte Sicht der App, keine zweite Fassung derselben — und
die App soll die Geheimnisse gar nicht erst angeboten bekommen. Der
Paritätstest sagt das jetzt ausdrücklich und prüft nur die gemeinsamen Werte.

### Tests

Sechs Gruppen umformuliert statt abgeschaltet (`household`, `household-db`,
`set-condition-aggregate`, `api-parity`, `api-inventory`). `PAIRS` in
`api-parity` ist LEER — es gibt kein Lese-Paar mehr; die Liste bleibt stehen,
damit ein künftiges Paar dort wieder auftaucht statt still ungeprüft zu
bleiben. Die alten Adressen stehen in der Gegenprobe „dürfen nicht
zurückkehren".

Seit Nachtrag 70 sind damit 47 doppelte Routen verschwunden.

561 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 80 (hardened-176) — Rechnen gehört auf den Server, die GUI zeichnet

Marcos Frage: „Kannst du sicherstellen, dass Berechnungen zentral in einer
Komponente für Webapp und Android-App durchgeführt werden, damit die GUIs nur
das Rendering übernehmen müssen?"

Beide Clients durchgesehen. Zwei Rechnungen standen noch in den Oberflächen —
und beide waren bereits auseinandergelaufen.

### 1. Die Summenzeile der Erfassungen stand VIERMAL

Zweimal in `public/js/07-admin.js` (Set-Dialog und Dialog für manuelle
Einträge), zweimal in der App (`AcquisitionManagementScreen`,
`ManualItemComposables`). Und die vier waren sich nicht einig, aus welchem Feld
der Preis kommt: Die Webapp las je nach Dialog fest `purchase_price` ODER fest
`unit_price`, die App hatte dafür eine Rückfallregel
(`purchasePrice ?: unitPrice`), die es in der Webapp gar nicht gibt. Dass die
Zahlen heute übereinstimmen, liegt allein daran, dass die Abfragen je Art nur
EINES der beiden Felder füllen — kommt einmal beides mit, zeigen die zwei
Clients Verschiedenes.

Neu: `acquisitionTotals()` in `utils/acquisitions.ts`, mitgeliefert als
`totals` an allen drei Erfassungs-Routen.

Die Regel: Die MENGE zählt über alle Zeilen — auch über die ohne Preis, denn
die Stücke sind da. Der BETRAG nur über die bepreisten. Gibt es keine einzige,
ist der Betrag `null` und nicht 0: „nichts erfasst" ist etwas anderes als „für
null Franken gekauft", und nur mit `null` kann die Oberfläche den
Gedankenstrich zeigen, ohne selbst zu raten. Ein Preis von 0 ist dagegen ein
Preis — sonst verschwände ein geschenktes Set aus der Zählung.

Auch die beiden Mengen-Schleifen für den Stückzahl-Stepper lesen jetzt dieselbe
Serversumme; sonst stünde über der Summenzeile eine zweite Zählung.

### 2. Die Kennzahlen des Minifiguren-Reiters, mit zwei Fehlern

`GET /api/minifigs/stats` zählte `COUNT(DISTINCT LOWER(TRIM(fig_number)))`, die
Liste daneben gruppiert aber nach Nummer UND Quelle: Eine Figur, die einmal aus
einem Set und einmal manuell erfasst ist, steht in der Liste zweimal und zählte
oben einmal — die Kachel widersprach der Liste darunter. Und die Abfrage las
`WHERE m.user_id = $1`, also ohne Blickfeld und ohne Kontofilter: Im Haushalt
zeigte die Kachel die eigenen Zahlen, während die Liste alle Konten zeigte, und
das Umschalten des Filters änderte oben nichts (dieselbe Klasse wie
Nachtrag 111).

Neu: `getMinifigStats()` in `utils/handlers.ts` zählt über GENAU DIESELBE
Gruppierung wie `getMinifigs()` und über dasselbe Blickfeld, erreichbar als
`GET /api/v1/minifigs/stats`. Die Webapp-Route ist entfallen.

Nachgemessen mit einem Haushalt (Set mit Menge 2 samt Figur, dazu zwei manuelle
Figuren auf beiden Konten): Kachel und Liste liefern in JEDEM Kontofilter
dieselben drei Zahlen — vorher wich die Kachel in allen drei Fällen ab.

**Achtung bei der Routenreihenfolge:** `/minifigs/stats` steht VOR
`/minifigs/:figNumber/…`, sonst nähme Express `stats` für eine Figurennummer.

### Tests

`test/acquisition-totals.test.js` prüft beides getrennt: die RECHNUNG mit ihren
Randfällen (NUMERIC kommt als Text aus Postgres, Preis 0 gegen fehlender Preis,
gemischte Zeilen, Rundung) UND die REGEL, dass keine Oberfläche sie noch einmal
anstellt. Ohne den zweiten Teil wäre der erste in dem Moment wertlos, in dem
jemand die Summe „schnell im Frontend" wieder einbaut. Beide Gegenproben
bestanden.

### Vorher-Nachher-Messung zu den Etappen 5 und 6

Der Stand hardened-174 und der neue liefen gleichzeitig gegen dieselbe
Datenbank, mit Haupt- und Unterkonto, Sets, manuellen Teilen und Minifiguren,
Kaufpreisen, Marktpreisen und Verlauf. 20 von 22 Antworten sind byte-gleich,
in jedem Kontofilter. Die zwei Abweichungen sind gewollt: Der Set-Preisverlauf
trägt zusätzlich `set_number` (das Feld hatte die v1-Route schon immer), und
der Minifiguren-Verlauf liefert jetzt `by_condition` statt eines leeren
Objekts — das ist der Fund aus Nachtrag 79.

570 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 81 (hardened-177) — Marcos zwei Entscheide

### A. „Set schon vorhanden" — die Regel steht jetzt auf dem Server

Marcos Festlegung: „Besitzt der Account oder einer der Unteraccounts das Set
bereits, soll sich nur der Detail-Dialog des Sets öffnen. Egal ob die Erfassung
via Barcodescanner, OCR oder per Nummer-Erfassung erfolgt. Einziger Unterschied:
beim Barcodescanner oder OCR erscheint auch dann ein Zwischendialog, wenn das
Set nicht vorhanden ist — um prüfen zu können, dass das richtige Set erkannt
wurde."

Vorher hing das am CLIENT: Die App prüfte seit Nachtrag 57 selbst vor dem
Anlegen, die Webapp gar nicht — dort erhöhte der Server still die Menge und
meldete „aktualisiert". Dieselbe Eingabe, zwei Ausgänge.

Neu `utils/setAdd.ts`:

* `findSetInScope(viewerId, nummer)` sucht im BLICKFELD — eigenes Konto und
  Haushalt. Bewusst scopeIds() und nicht writableIds(): Die Frage lautet „habe
  ich das schon?", und sichtbar ist sichtbar.
* Die Nummer wird VOR der Suche normalisiert. Ohne das gälte „75192" als neu,
  obwohl „75192-1" längst da ist — daran hängt die ganze Regel. Ein Test hält
  `normalizeSetNumber` und `sanitizeSetNumber` zusammen; weichen sie ab, prüft
  die Regel eine andere Nummer als die, die danach geschrieben wird.
* Bei zwei Besitzern gewinnt die EIGENE Zeile: Die Detailansicht soll die
  eigene zeigen, nicht die eines Geschwisterkontos.

Beide Erfassungs-Routen fragen sie und antworten mit `action: 'exists'`, ohne
zu schreiben. Der add-stream-Weg antwortet dabei mit gewöhnlichem JSON statt
einem Ereignisstrom — es gibt nichts zu verfolgen. `readSSE()` im Frontend
erkennt das am Content-Type und reicht die eine Antwort wie ein einzelnes
Ereignis durch; ohne diesen Zweig liefe der Leser über JSON-Text, fände keine
`data:`-Zeile und die Anzeige bliebe hängen.

Neu `GET /api/v1/sets/exists/:setNumber` für Scanner und Texterkennung: Dort
muss die Antwort VOR dem Erfassen bekannt sein, weil sie über den
Zwischendialog entscheidet. Die App las das bisher aus dem FEHLER von
`GET /sets/:nummer` — das vermischt „nicht vorhanden" mit „nicht erreichbar".

**Ausdrücklich ausgenommen: der CSV-Import.** Er ruft addSet() direkt und fasst
weiterhin zusammen; wer 500 Zeilen einliest, will keine 500 Rückfragen. Die
Regel hängt deshalb an den INTERAKTIVEN Routen, nicht in addSet(). Der Test
prüft das mit — sonst schöbe ein späterer Umbau sie hinein und legte den Import
still lahm.

Am laufenden Server nachgemessen, mit einem Set des UNTERKONTOS und der Eingabe
ohne Suffix: Beide Wege antworten 200 mit `action=exists`, nennen das
Unterkonto als Besitzer, und die Menge bleibt bei 1. Die Vorabfrage sagt
dasselbe. Test `test/set-add-exists-db.test.js`, Gegenprobe bestanden (ohne den
Zweig: `action=updated`, Menge 1 → 2).

### B. Galerie-Filter serverseitig — auch in der App

Marcos Vorgabe: „Beide Apps sollen den Filter auf dem Server anwenden. Passt
zur vorherigen Frage, dass Logiken immer zentral sein sollen."

Der Server konnte das längst; die App holte trotzdem alles und filterte im
Gerät. Diese zweite Fassung konnte weniger: kein Jahr im Suchtext (die Webapp
findet mit „2019" die Sets des Jahres), keine Sortierung, und die Themenliste
entstand aus der geladenen Liste statt aus dem Bestand.

Serverseitig war nur eine Notiz zu korrigieren: Der Kommentar „die Android-App
sendet kein page_size" stimmte nicht mehr. Ein Test pinnte seinen Wortlaut und
wurde rot — er prüft jetzt die AUSSAGE (die Route reicht alle vier Parameter
durch) statt einen Satz. Dieselbe Sorte Test, die in Durchgang 118 eine
Sicherheitslücke festgeschrieben hat.

572 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 82 (hardened-178) — Die Portfolio-Kurve mass Zukäufe statt Preise

### Marcos Befund

„Die Berechnung scheint nicht korrekt zu sein. Neu hinzugefügte Sets sollen
nicht dazu führen, dass sich der %-Wert ändert. Die +850.2% sind offensichtlich
nicht korrekt."

Auf seinem Bild: 26 Sets, davon 24 am selben Tag erfasst, Kopfzeile +850,2 % —
und direkt darunter die Kachel „Gesamt G&V" mit −2,8 %. Zwei Zahlen über
dieselbe Sammlung, die einander widersprechen.

### Ursache

Die Kurve zeigte „Wert dessen, was zu diesem Zeitpunkt erfasst WAR". Ein Set
trat an dem Tag in die Summe ein, an dem sein Preisverlauf begann. Wer an einem
Tag zwei Dutzend Sets erfasst, sieht dort einen Sprung — und die Prozentzahl,
die den ersten Punkt mit dem letzten vergleicht, meldet den Zuwachs der
SAMMLUNG als Wertentwicklung.

Nachgestellt (2 Sets seit einer Woche, 24 gestern dazu, Preise leicht FALLEND):
**+264,24 %**. Nach dem Fix: **−0,18 %** — die tatsächliche Preisbewegung.

### Die neue Bedeutung

Die Kurve zeigt jetzt „was der HEUTIGE Bestand über die Zeit wert gewesen
wäre". Ein Set, dessen Preisverlauf später beginnt, wird mit seinem ERSTEN
bekannten Preis zurückgeschrieben: Es steht von Anfang an im Korb und trägt zur
Veränderung nichts bei, bis sich sein Preis wirklich bewegt. Das ist die
einzige Lesart, in der die Prozentzahl etwas über Wertentwicklung aussagt statt
über Kaufverhalten.

In SQL: Der Ersteintrag eines Sets wird auf den Anfang der Reihe umgehängt
(`CASE WHEN vortag IS NULL THEN erstes_bucket`). Die Beschriftungen kommen
seither aus einer eigenen CTE — ein `max(tag)` über umgehängte Zeilen hätte dem
ersten Punkt ein späteres Datum gegeben. Der price_cache-Rückfall und die
Startpunkt-Korrektur der Monatsauflösung machen dasselbe.

### Der Schnappschuss-Weg ist entfallen

Der Preis-Job legte je Konto und Tag einen Gesamtwert unter dem Pseudo-Set
'__portfolio__<id>' ab; für ein einzelnes Konto las die Kurve daraus. Ein
Schnappschuss hält fest, was AN JENEM TAG erfasst war — die Frage „was wäre der
heutige Bestand damals wert gewesen" lässt sich daraus grundsätzlich nicht
beantworten. Marcos Bild zeigte ein Unterkonto, also genau diesen Weg.

Es war ausserdem eine ZWEITE Fassung derselben Kurve: Ein einzelnes Konto bekam
eine anders gerechnete Linie als ein Haushalt, und beim Wechsel des
Kontofilters sprang die Form. Schreiber und Aufbewahrungs-Ausnahme sind mit
entfernt; gespart wird nebenbei eine price_cache-Abfrage je Set und Konto bei
JEDEM Preislauf.

### Zweiter Fund: die Zeiträume waren sich uneinig

Bei kurzer Historie fällt der ganze Verlauf in EINEN Monatsabschnitt. Die
Monatsauflösung von „Jahr" und „Max" ergab damit genau einen Punkt und meldete
0 %, während „Woche" auf denselben Daten +102,86 % auswies. Gleiche Sammlung,
vier Knöpfe, zwei Antworten. Liefert die Monatsabfrage weniger als zwei Punkte,
wird jetzt auf Tagesauflösung zurückgeschaltet.

### Was der Fix NICHT behauptet

Dass die Zahl bei einem Zukauf exakt stehen bleibt. Gemessen: zwei Sets mit
+10 % ergeben +10 %; kommen 24 unbewegte dazu, sind es +1,43 %. Das ist
Verwässerung, kein Fehler — die 24 gehören ab jetzt zum Bestand und haben sich
nicht bewegt. Die Prozentzahl ist der gewichtete Mittelwert der
Preisbewegungen; sie kann durch Zukäufe nicht steigen und das Vorzeichen nicht
drehen. Wer die HISTORISCHE Rendite unverändert lassen will, braucht eine
verkettete Tagesrendite über die jeweils an beiden Tagen gehaltenen Sets — eine
andere Kennzahl und eine eigene Entscheidung.

### Tests

Neu `test/portfolio-additions-db.test.js`: Zukäufe erhöhen die Prozentzahl
nicht, drehen kein Vorzeichen, und keine Summe zeigt mehr, als sich ein
einzelnes Set bewegt hat; Preisbewegungen zeigen sich weiterhin; die vier
Zeiträume sind sich einig. Gegenprobe bestanden (ohne Rückschreibung: 10 →
610 %).

Drei bestehende Gruppen umformuliert statt abgeschaltet: die Vergleichsfassung
in `portfolio-history-db` bildet jetzt die NEUE Regel ab (Unterschied ist die
Vorbelegung von `carry`), `portfolio-scope-db` prüft die Kontotreue an den
Beständen statt an Schnappschüssen, und die Aufräum-Prüfung verlangt, dass alte
Schnappschuss-Zeilen jetzt mit wegkommen.

573 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 83 (hardened-179) — Diagramm und Besitzer-Label folgen dem Bestand

Zwei Befunde von Marco am Set 60481-1, beide serverseitig behoben und damit in
Webapp und App zugleich wirksam.

### 1. Das Diagramm zeigte einen Zustand, den es im Bestand nicht gibt

„Das Diagramm sollte nur den Wert der eingetragenen Status anzeigen. In diesem
Fall ist nur ein gebrauchtes. Somit sollte der Verlauf von Neu nicht angezeigt
werden."

Die Regel gab es bereits — ein paar Zeilen weiter unten, für `by_condition`:
Eine Zeile erscheint nur, wenn für diesen Zustand auch eine Erfassung
existiert. Der Diagramm-Aufbau stand DAVOR und kannte sie nicht; er nahm immer
beide Reihen. Dieselbe Regel, zwei Stellen, eine davon vergessen — dasselbe
Muster wie schon mehrfach in dieser Reihe. Der Aufbau steht jetzt hinter der
Stelle, die weiss, was im Bestand liegt.

Es hing mehr daran als die Legende: In der App speisen sich „Tief", „Aktuell"
und „Hoch" aus den Diagrammwerten. Bei einem nur gebraucht vorhandenen Set
standen dort die Neupreise (3.94 / 7.99 / 7.99), während die Zeile darüber
korrekt CHF 3.94 auswies — zwei Antworten auf dieselbe Frage, untereinander.

Ohne JEDE Erfassung bleibt der Zustand des Bestandes übrig: Ein Set ohne
erfassten Kaufpreis hat trotzdem einen Marktwert, und ein leeres Diagramm wäre
schlimmer als eine Reihe zu viel. Der Test prüft beide Richtungen.

### 2. Ein Konto ohne Exemplar stand weiter als Besitzer auf der Kachel

„Ich habe den Kaufpreis für den Marco gelöscht. Somit sollte auch das Label auf
der Kachel von Marco nicht mehr angezeigt werden."

Beim Löschen der letzten Erfassung setzt `parentQuantitySql` die Menge auf 0
und lässt die sets-Zeile stehen — bewusst, denn 0 ist ein gültiger Zustand
(Mengenregler). `array_agg(DISTINCT s.user_id)` nahm sie trotzdem mit.

Jetzt mit `FILTER (WHERE s.quantity > 0)`. Hält das Konto wieder ein Exemplar,
kommt das Label zurück; der Test prüft auch das, sonst wäre er bei einem ganz
verschwundenen Label ebenfalls grün.

### Tests

Neu `test/holdings-display-db.test.js` mit fünf Teilschritten in Marcos
Konstellation (Hauptkonto Menge 0 ohne Erfassung, Unterkonto ein gebrauchtes
Exemplar, Preisverlauf für BEIDE Zustände — der Preis-Job schreibt sie
unabhängig vom Bestand). Beide Gegenproben bestanden.

Zwei bestehende Prüfungen umformuliert: Die Haushalts-Regel nagelt jetzt das
`FILTER` mit fest, und `set-value` verlangte wörtlich `buildChart([` — der
Set-Verlauf übergibt seit diesem Nachtrag eine ZUSAMMENGESTELLTE Liste statt
eines festen Arrays. Diese Prüfung hätte die Verbesserung verhindert, ohne
etwas Zusätzliches zu sichern; sie zählt jetzt die Aufrufe statt die Klammer.

579 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 84 (hardened-180) — Der Geistereintrag nach dem Löschen eines Kaufpreises

Marcos Frage: „Gibt es noch ein Problem, wenn ein Kaufpreis entfernt wird, dass
der Eintrag noch sichtbar war?"

Ja — das Besitzer-Label aus Nachtrag 83 war nur die Spitze. `parentQuantitySql`
setzte die Menge auf 0 und liess die Elternzeile stehen. Nachgemessen mit einem
einzelnen Konto und zwei Sets, bei einem davon der Kaufpreis gelöscht:

| | vorher | nachher |
|---|---|---|
| Galerie | beide Sets, das leere mit „Menge 0" | nur das echte |
| Statistik | Sets=2, Einheiten=1 | Sets=1, Einheiten=1 |
| Bewertung | das leere Set **mit ×1**, Summe 40.00 | nur das echte, Summe 20.00 |

Der letzte Punkt ist der eigentliche Schaden: `set.quantity || 1` in
utils/financeCalc.ts macht aus einer Menge von 0 eine 1. Als Schutz gegen NULL
gedacht, trifft es den echten Wert 0 — das Portfolio wuchs um ein Set, das
niemand mehr besitzt. Dieselbe Verwechslung steckt an achtzehn Stellen in
dieser Datei.

### Warum die Ursache und nicht die achtzehn Stellen

Achtzehn `|| 1` einzeln zu reparieren hiesse, achtzehnmal dieselbe Regel zu
pflegen — und die neunzehnte wird vergessen. Stattdessen entsteht eine Menge
von 0 gar nicht mehr.

Sie war ohnehin kein Zustand, den jemand absichtlich herstellen kann: Beide
Mengenregler halten bei 1 (`min="1"` in der Webapp, `if (qty > 1)` in der App).
Sie entstand ausschliesslich beim Löschen der letzten Erfassung.

Neu `cleanupWhenEmpty` in der Erfassungs-Fabrik: Bleibt nach dem Löschen keine
Erfassung übrig, verschwindet die Elternzeile — in DERSELBEN Transaktion, sonst
bliebe bei einem Abbruch genau der Geistereintrag zurück, den das verhindern
soll. Für Sets gehen Teile und Minifiguren des Sets mit; sonst stünden sie ohne
Set in Teileliste und Finanzsummen.

Die Löschliste steht dafür jetzt EINMAL in utils/handlers.ts
(`deleteSetRows`) und wird von beiden Anlässen benutzt — ausdrückliches Löschen
und Wegfall der letzten Erfassung. Zwei Listen wären genau die Doppelung, an
der in dieser Reihe schon mehrfach eine Regel nur an einer Stelle nachgezogen
wurde.

### Nebenbefund: eine tote Zeile in updateSetQuantity

`asIds()` normalisierte die Kennung, das Ergebnis wurde aber nicht benutzt —
`ANY($2)` bekam den rohen Parameter. Mit einer nackten Zahl statt eines Feldes
bricht die Abfrage ab, und die Mengenänderung fiel still aus. Jetzt `uids`.

### Tests

Neu `test/empty-holding-cleanup-db.test.js` mit sechs Teilschritten, bewusst
über die API statt über die Funktion — genau dazwischen sass der Fehler: Die
Erfassung war gelöscht, die Elternzeile blieb. Geprüft werden Galerie,
Statistik, Bewertung und die Datenbankzeilen, dazu zwei Gegenrichtungen: Ein
zweites Set bleibt unberührt, und das Löschen EINER von mehreren Erfassungen
ändert nichts am Bestand. Gegenprobe bestanden (ohne cleanupWhenEmpty werden
vier Teilschritte rot).

`acquisition-delete-refresh-db` nagelte „Ohne Erfassungen ist die Menge 0"
fest — genau den Zustand, der jetzt nicht mehr entstehen soll. Umformuliert:
Es darf keine Zeile zurückbleiben.

586 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 85 (hardened-181) — Anzahl: Anzeige = Haushalt, Änderung = eigenes Konto

Marcos Vorgabe: „Die Anzahl soll immer von allen angezeigt werden. Wenn ich
diese erhöhe, soll es für meinen Account einen neuen Kaufpreis-Eintrag
erstellen. Analog der bestehenden Logik. Jeweils die Logik im Server
implementieren."

### Zwei Stellen, die sich widersprachen

**Das Detail** las `SELECT * FROM sets WHERE user_id = ANY(blickfeld)` und nahm
IRGENDEINE Zeile — welche, entschied die Reihenfolge in der Tabelle. Daher
Marcos „Anzahl 0" für ein Set, von dem das Unterkonto ein Exemplar hält. Die
LISTE summierte längst (getSets gruppiert für Haushalte); nur das Detail nicht.
Dieselbe Frage, zwei Antworten.

**Die Änderung** schrieb auf den Besitzer eben dieser Zeile. Nachgemessen mit
einem Set, das nur das Unterkonto hält: `PUT quantity=2` machte daraus
`Alessio=2` — der eigene Bestand blieb bei 0, und die neue Erfassung entstand
in einem fremden Konto.

### Die Regel

Angezeigt wird die Summe über das Blickfeld. Gesendet wird eine Gesamtmenge;
geschrieben wird die DIFFERENZ, und zwar auf das eigene Konto. Fehlt dort noch
eine Zeile, wird sie angelegt (Stammdaten aus der vorhandenen).

Nach unten bei den eigenen Exemplaren gedeckelt: Die eines anderen Kontos sind
nicht meine. Die Antwort trägt deshalb die TATSÄCHLICHE Gesamtmenge zurück —
sonst liesse die Oberfläche eine Zahl stehen, die es nicht gibt.

Bleibt das eigene Konto bei 0, verschwindet die eigene Zeile ganz — dieselbe
Regel wie beim Löschen des letzten Kaufpreises (Nachtrag 84), sonst entstünde
hier wieder ein Eintrag mit Menge 0.

„Analog der bestehenden Logik" heisst wörtlich dieselbe Funktion:
`adjustAcquisitionsToQuantity()` legt die Erfassung an, holt den Marktpreis
über `priceForNewAcquisition()` und beachtet die Tagesregel — unverändert, nur
mit dem eigenen Konto als Ziel.

Gemessen, Ausgangslage „nur das Unterkonto hält 1":

    +1        Marco=1 Alessio=1, Erfassung Marco ×1 U 3.94   Gesamt 2
    +2        Marco=3 Alessio=1                              Gesamt 4
    auf 1     Marco weg, Alessio=1                           Gesamt 1
    auf 0     unverändert (gedeckelt)                        Gesamt 1

### Nebenbefund: der Preisplan wurde ignoriert

`adjustAcquisitionsToQuantity()` nahm für die ERSTE Erfassung eines Kontos den
Preis aus der sets-Zeile und liess den übergebenen Plan liegen. Solange die
Zeile einen Kaufpreis hatte, fiel das nicht auf. Seit die Mengenänderung eine
FRISCHE Zeile im eigenen Konto anlegen kann, fiel es sofort auf: Die Erfassung
entstand ohne Preis. Jetzt gilt der Preis der Zeile als Vorgabe und der
Marktpreis springt ein, wenn dort keiner steht.

Der Test hält ausdrücklich fest, dass es der MARKTPREIS ist (77) und nicht der
Kaufpreis des anderen Kontos (108) — dessen Kauf ist nicht meiner.

### Tests

Neu `test/set-quantity-household-db.test.js` mit fünf Teilschritten über die
API: Anzeige, Erhöhen mit Preis und Zustand, Tagesregel beim zweiten Erhöhen,
Verringern zuerst am eigenen Bestand, Deckelung nach unten. Gegenprobe
bestanden.

`set-quantity-scope-db` verlangte bisher das GEGENTEIL — „es darf KEINE
Erfassung im Konto des Betrachters entstehen" (Nachtrag 52). Umformuliert auf
die neue Regel; was bleibt, ist die Aussage von damals: kein 404, und die
Änderung wirkt. Zwei quelltextlesende Prüfungen in `manual-acq-refresh` nannten
`ownerId` wörtlich und wurden auf `uid` gezogen; dazu neu die Forderung, dass
die Ausgangsmenge über das Blickfeld SUMMIERT wird.

592 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 86 — Aufräum-Skripte für die Altbestände mit Menge 0

Der Fix aus hardened-180 verhindert NEUE Geistereinträge. Für die, die schon in
der Datenbank liegen, gibt es jetzt zwei Skripte unter `scripts/`:

* `befund-menge-null.sql` — reines Lesen. Zeigt je Konto, welche Zeilen
  betroffen sind, was daran hängt und wie viele es insgesamt sind.
* `korrektur-menge-null.sql` — die Bereinigung, in EINER Transaktion.

Die Trennung ist Absicht: Ein Skript, das löscht, sollte man vorher gelesen
haben, und die Ausgabe des Befunds sagt genau, was passieren wird.

### Zwei Fälle, zwei Behandlungen

**Reparieren**, wenn zu einer Zeile mit Menge 0 noch Erfassungen gehören: Die
Menge bekommt deren Summe. Hier geht nichts verloren, die Zahl stand nur falsch.

**Löschen**, wenn Menge 0 UND keine Erfassung. Bei Sets gehen die daran
hängenden Teile, Minifiguren und Erfassungen mit — dieselben vier Tabellen wie
beim regulären Löschen (`deleteSetRows`).

### Die gefährliche Zeile, die es NICHT anfasst

Ein Set aus einem alten Import kann eine Menge OHNE Erfassungen haben. Würde
das Skript pauschal `quantity = SUM(acquisitions)` setzen, käme dort 0 heraus
und ein echter Bestand wäre vernichtet. Deshalb steht `quantity <= 0` in JEDER
Bedingung — positive Mengen werden nie berührt.

Die Geisterliste wird ausserdem einmal in einer Temp-Tabelle festgehalten und
von allen vier DELETEs benutzt. Werteten sie ihre Bedingung je selbst aus,
hätte das erste (auf `sets`) den folgenden bereits die Grundlage entzogen und
die Teile blieben liegen.

### Gemessen

An einer Bühne mit sechs Fällen: Geist mit abgeleiteten Teilen, Zeile mit
Mengendrift, gesundes Set, Altimport mit Menge 3 ohne Erfassung, manuelles Teil
und manuelle Minifigur mit Menge 0.

    Probelauf (ROLLBACK)  meldet die Änderungen, ändert nichts (2 Zeilen bleiben)
    echter Lauf           Geist weg samt Teil und Minifigur; Drift 0 -> 2;
                          manuelles Teil 0 -> 5; gesundes Set und Altimport
                          unberührt
    zweiter Lauf          keine einzige Zeile mit Wirkung (idempotent)
## Nachtrag 87 (hardened-183) — Beide Oberflächen lesen die Menge aus der Antwort

Nachgezogen, was in Nachtrag 85 offenblieb: Der Server liefert seit dort die
tatsächliche Gesamtmenge in der PUT-Antwort — gelesen hat sie niemand.

Das fällt beim VERRINGERN auf. Angezeigt wird die Menge aller Konten,
geschrieben wird die Differenz auf das eigene; unter den eigenen Bestand
deckelt der Server, weil fremde Exemplare nicht wegzunehmen sind. Beide Regler
zählen ihre Zahl vorher hoch und schicken sie. Ohne die Übernahme stand danach
die eigene Annahme auf dem Bildschirm, bis jemand die Ansicht neu öffnete: Der
Server hat recht, die Oberfläche zeigt etwas anderes, und niemand merkt es.

* **Webapp** (`autosaveSet`): übernimmt `d.quantity`, korrigiert das
  Eingabefeld und merkt sich die BESTÄTIGTE Zahl statt der gesendeten. Die
  Erfassungsliste wird jetzt anhand der bestätigten Menge nachgeladen — bei
  einer gedeckelten Änderung hätte der alte Vergleich sie sonst umsonst geholt.
* **App**: `GenericResponse.quantity` (nullable), Übernahme in den Zustand VOR
  dem Nachladen — der Abruf läuft ohnehin gleich, aber er braucht eine
  Rundreise, und genau in der Zeit sieht man die falsche Zahl. Der Mengenregler
  hängt sein `remember` jetzt an `set.setNumber` UND `set.quantity`; hinge es
  nur an der Nummer, behielte er seinen alten Wert, obwohl der Zustand längst
  korrigiert ist.

Der Rückfall ist absichtlich lautlos: Fehlt das Feld, gilt die gesendete Zahl
wie bisher. Ein älterer Server soll keine Fehlermeldung erzeugen.

### Tests

Neu `test/quantity-response-echo.test.js`: Die Webapp liest das Feld und merkt
sich nicht die gesendete Zahl; und die Route liefert es überhaupt — inklusive
der Forderung, dass die zurückgegebene Menge über das Blickfeld SUMMIERT ist.
Gerade weil der Rückfall lautlos ist, braucht es diese zweite Prüfung: Ohne sie
könnte das Feld serverseitig verschwinden und beide Clients fielen still auf
ihre Annahme zurück.

In der App dazu ein Teilschritt in `ServerComputedValuesTest`: Modellfeld
vorhanden, Übernahme vor dem Nachladen, Regler an die Menge gekoppelt.

Diese Lücke ist in dieser Reihe die dritte ihrer Art — die Verschiebe-Zahlen
und das Zustands-Aggregat lieferte der Server ebenfalls seit jeher mit, und die
App las sie nie.

594 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 88 (hardened-184) — Eine Rückfrage beim Löschen; Mengen nachgemessen

Marcos Befund: „Wenn ich in der Webapp ein Set lösche, erscheinen 2 Rückfragen.
In beiden Fällen soll nur eine Rückfrage erscheinen und das Set direkt gelöscht
werden inkl. Teile und Minifiguren."

### Die zweite Rückfrage

Der Löschknopf im Detail-Dialog fragte selbst nach und rief danach `delSet()`,
das ein zweites Mal fragte. Von der Kachel und aus der Listenzeile kam nur eine
— dieselbe Handlung, drei Einstiege, zwei verschiedene Erlebnisse.

Die Rückfrage steht jetzt NUR in `delSet()`, an der einen Stelle, die auch
löscht. Sie nennt weiterhin den Namen, wenn er bekannt ist (das war der einzige
Vorzug der Extra-Rückfrage im Dialog), und `delSet()` gibt zurück, ob wirklich
gelöscht wurde — der Dialog schliesst nur dann, sonst stünde er nach einem
„Abbrechen" leer da.

Nebenbei: Nach dem Löschen fehlte `loadStats()`. Die Kennzahlen im Kopf blieben
auf dem alten Stand, obwohl die Teile und Minifiguren des Sets mit weg sind.

Serverseitig war nichts zu tun — `deleteSetRows()` räumt Set, Teile,
Minifiguren und Kaufpreise in einer Transaktion ab. Der Test prüft es jetzt
ausdrücklich.

### Die Mengen — hier war NICHTS zu reparieren

Nachgemessen mit einem Set aus 10 Teilen und 1 Minifigur:

    Menge 1 → Teile 10, Minifiguren 1
    Menge 3 → Teile 30, Minifiguren 3
    zurück  → Teile 10, Minifiguren 1

Und zwar in allen vier Abfragen: Kennzahlen, Teileliste, Minifigurenliste und
Minifiguren-Kennzahlen. Die Teile liegen mit ihrer Menge JE EXEMPLAR in der
Tabelle; multipliziert wird beim LESEN. Der Test hält auch das fest — stünde in
der Zeile die multiplizierte Menge, rechnete die nächste Änderung auf einem
schon multiplizierten Wert weiter.

Der stille Kandidat war die Zusammenfassungstabelle (utils/partsSummary.ts),
die vorberechnete Mengen hält. Ihre Versionszähler hängen an `parts` UND
`sets` — fiele `sets` weg, bliebe die Teilezahl nach einer Mengenänderung
stehen, ohne dass irgendetwas falsch aussähe. Der Test nagelt das fest;
Gegenprobe durchgeführt.

600 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 89 (hardened-185) — Teile-Symbol überall; Grundlage für den Jahres-Sprung

### 1. Das Puzzleteil-Emoji ist weg

Marco: „Kannst du das rot markierte Icon ersetzen durch das Teileicon? Bitte
vollständig und überall."

Es war 🧩 — ein Puzzleteil, das mit LEGO nichts zu tun hat und dessen
Darstellung ausserdem an der Schriftart des Geräts hängt. Ersetzt durch das
Teile-Symbol, das die Anwendung ohnehin schon führt (PARTS_ICON_SVG in der
Webapp, ic_parts_bricks in der App — dasselbe Bild wie im Reiter „Teile").

Fünf Stellen in der Webapp: Katalog-Kachel, Platzhalter der Teile-Kachel,
Platzhalter in der Teileliste, Knopf „Teile neu importieren" in der Listenzeile
und der Fortschritts-Schritt in index.html. Zwei in der App: Katalog-Kachel und
Platzhalter der Teileliste. Das Figuren-Emoji daneben bleibt — dafür gibt es
kein eigenes Symbol.

### 2. GET /api/v1/catalog/year-offset

Marcos zweite Vorgabe: „Im Katalog die Zeitleiste rechts anpassen. Diese soll
nicht ein Filter sein, sondern zum Schnellscrollen verwendet werden können."

Der Unterschied ist wesentlich: Ein Filter WIRFT die anderen Jahre weg. Ein
Schnell-Scroll springt nur hin — davor und danach bleibt alles erreichbar.

Dafür muss jemand wissen, an welcher STELLE der Liste ein Jahr beginnt. Der
Katalog hat rund 25 000 Sets und wird seitenweise geliefert; die Clients kennen
immer nur die geladenen Seiten. Die Antwort kann nur die Datenbank geben — und
beide Oberflächen sollen dieselbe Stelle treffen.

Die neue Route zählt mit DENSELBEN Filtern und DERSELBEN Sortierung wie die
Liste und liefert `offset`, `page` und `total`. Ein Jahr, das es (durch Filter
oder Lücke) nicht gibt, bekommt den nächsten erreichbaren Platz — springen soll
immer etwas.

Nachgemessen an 135 Sets über 27 Jahre: In allen fünf geprüften Kombinationen
landet der Sprung auf der ERSTEN Zeile des Jahres, und die Zeile davor gehört
noch zum Nachbarjahr. Der Test prüft genau das, statt eine Zahl festzunageln —
„offset ist 30" hätte jede Verschiebung um eins mitgemacht.

609 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 90 (hardened-186) — Katalog der Webapp: Jahres-Leiste statt Schieber

Der Rest von Marcos Vorgabe, nachdem die App in Nachtrag 86 umgestellt war:
„Dies bitte sowohl in der Android-App als auch in der Webapp umsetzen. Der
Slider in der Webapp kann dann entsprechend entfernt werden."

### Fensterladen statt Endlos-Scroll

Derselbe Umbau wie in der App, und aus demselben Grund: Mit einer angehängten
Liste kann eine Leiste nirgendwohin springen — wer auf 2005 zielt, landet mitten
im Bestand, und dort ist nichts geladen. Deshalb KONNTE der Schieber bisher nur
filtern.

Die Liste führt jetzt einen Block je Seite über das GANZE Ergebnis. Geladen wird
der Block, der ins Bild kommt — vorwärts wie rückwärts, über einen
IntersectionObserver auf ALLEN Blöcken statt eines Sentinels am Ende. Nicht
geladene Blöcke halten ihre Höhe mit Platzhaltern frei; ohne das verschöbe sich
beim Nachladen alles darunter und ein Sprung landete daneben.

Entfallen: `loadCatalogMore()`, der Sentinel und der Nachlade-Spinner.

### Die Leiste

Schmale Spur am rechten Rand, beim Ziehen ein kleines Etikett mit dem Jahr —
dieselbe Gestalt wie in der App. Sie erscheint nur bei Jahres-Sortierung: Bei
„Name A–Z" liegen die Jahre verstreut, ein Sprung wäre dort sinnlos.

Wohin gesprungen wird, rechnet der Server (`/api/v1/catalog/year-offset`, aus
Nachtrag 89) — mit denselben Filtern und derselben Sortierung wie die Liste.
Beide Oberflächen benutzen dieselbe Route und treffen damit dieselbe Stelle.

Der Von-Bis-Schieber ist weg, samt seinen fünf Hilfsfunktionen und dem
CSS-Block. Der ausdrückliche Jahresfilter über die beiden Auswahlfelder BLEIBT —
Marco wollte die Leiste anders, nicht das Filtern abschaffen. Genau dieselbe
Aufteilung wie in der App (dort Chip und Auswahlblatt).

### Test

`catalog-frontend` war ganz um den Schieber gebaut und ist auf die neuen Regeln
umgeschrieben: Seitenblöcke mit Platzhaltern, Nachladen über den Block statt
über einen Sentinel, keine Doppelabrufe, der Jahresfilter wirkt weiterhin — und
für den Sprung die entscheidende Prüfung: Danach ist die Liste NICHT gefiltert
und alle Jahre bleiben erreichbar. Das Mini-Backend im Test beantwortet
`year-offset` mit derselben Regel wie der Server.

Zwei Gegenproben: ohne die Doppelabruf-Sperre und ohne Platzhalter wird der Test
rot.

609 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 91 (hardened-187) — Etappe 7 (Admin) und ein echter Scrollbalken

### 1. Die Admin-Familie war noch doppelt

Marcos Frage „Nutzen die beiden Apps nach wie vor die gleichen APIs?" hat eine
Lücke aufgedeckt, die ich nach Etappe 6 zu vollmundig als erledigt gemeldet
hatte: Cache-Statistik, Cache-Dauer, Preis-Job und der globale Standard-Zustand
standen weiter je zweimal da — einmal unter /api/settings bzw. /api/finance,
einmal unter /api/v1/admin.

Sie fielen nicht auf, weil das Inventar sie als `nur-web` und `nur-v1` führte:
Der Paritätstest prüft nur, was als PAAR deklariert ist. Derselbe blinde Fleck
wie beim Minifiguren-Preisverlauf.

Und sie waren bereits auseinandergelaufen: `/api/finance/cache-stats` lieferte
`db_pool`, `/api/v1/admin/cache-stats` nicht.

Zusammengelegt, alles unter /api/v1/admin:

* `cache-stats` — mit `db_pool`, sonst verlöre die Überwachungsseite die
  Pool-Anzeige
* `job-status` (neu) als Gegenstück zu `trigger-price-job`
* `cache-clear` (neu, `{all:true}` für Teile- und Katalog-Caches) — ersetzt
  `/api/finance/refresh` und `/refresh-all`
* `cache-ttl`, `default-condition`

Acht Webapp-Routen entfernt. Damit sind seit Nachtrag 70 **55 doppelte Routen**
verschwunden.

**Nebenbefund: zwei tote Aufrufe.** Die Webapp rief
`POST /api/admin/brickset-queue/:nr/retry` und `DELETE /api/admin/…` — diese
Adressen gibt es serverseitig gar nicht (die Routen liegen unter /api/v1/admin).
Beide Knöpfe der Überwachungsseite liefen also ins Leere. Ein Aufruf daneben, in
derselben Datei, zeigte korrekt auf `/v1/…` — dieselbe Handlung, zwei
Schreibweisen. Korrigiert.

Ein quelltextlesender Test verlangte `await triggerNow()` in `routes/finance.ts`
UND `routes/api_v1/admin.ts` — die Doppelung, bei der eine Seite das `await`
verlieren kann, ohne dass es auffällt. Jetzt nur noch die eine Stelle.

### 2. Der Katalog-Scrollbalken

Marco: „Ich hätte diesen gerne als Scrollbalken im Fenster (der normale
Scrollbalken vom Browser soll nicht ersichtlich sein)."

Meine erste Fassung war eine Jahres-Leiste zum Springen — nicht, was gemeint
war. Jetzt rollt die Liste in IHREM Bereich (`#cat-scroller`), und der Balken
rechts ist dessen echter Scrollbalken, nur selbst gezeichnet: Griffgrösse und
-lage folgen dem Rollzustand, beim Ziehen steht das Jahr als Etikett daneben.
Der Balken des Browsers ist ausgeblendet (Firefox, WebKit und altes Edge),
sonst stünden zwei nebeneinander.

Das Jahr im Etikett wird aus der obersten SICHTBAREN Kachel gelesen — dafür
tragen die Kacheln jetzt `data-year`. Nur für noch ungeladene Bereiche wird
linear geschätzt; dort weiss der Browser es nicht. Eine rein lineare Rechnung
wäre falsch, sobald ein Jahr mehr Sets hat als ein anderes.

Wichtig dabei: Der Beobachter, der die Seiten nachlädt, misst jetzt gegen
`#cat-scroller` statt gegen das Browserfenster. Ohne `root` käme beim Rollen
INNERHALB des Bereichs nie eine Seite nach.

`springeZuJahr()` ist entfallen — Ziehen IST Scrollen. Die Route
`/api/v1/catalog/year-offset` bleibt: Die Android-App springt weiterhin, dort
gibt es keinen Balken zum Ziehen.

609 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 92 (hardened-188) — Scrollbalken für die ganze Anwendung; Nachladen repariert

Marcos Meldung: „Wenn ich nach unten scrolle, erscheinen keine Einträge. Bitte
den Scrollbalken nach rechts verschieben — der rechte ist der vom Browser, der
durch den eigenen ersetzt werden soll. Gerne gleich in der ganzen App."

Beides hing an derselben Fehlentscheidung aus Nachtrag 91.

### Der Fehler

Ich hatte für den Katalog einen EIGENEN Scrollkasten gebaut (`#cat-scroller`).
Zwei Folgen:

1. Der Balken sass mitten im Fenster statt am Rand — daneben stand weiter der
   des Browsers. Genau das, was Marco rot eingekreist hat.
2. Der Beobachter, der die Seiten nachlädt, mass gegen DIESEN Kasten
   (`root: #cat-scroller`). Wo das nicht griff, kam beim Scrollen nach unten
   nichts nach: leere Fläche statt Kacheln.

### Jetzt

Die Liste rollt wieder mit der SEITE. Den Balken zeichnet die Anwendung selbst,
für die ganze Seite: `#app-scrollbar`, fest am rechten Fensterrand, Griffgrösse
und -lage aus dem Rollzustand. Der Balken des Browsers ist per CSS ausgeblendet
(Firefox, WebKit, altes Edge) — sonst stünden zwei nebeneinander.

Er beobachtet die Seitenhöhe mit einem `ResizeObserver`: Beim Nachladen von
Kacheln wächst die Seite, ohne dass gerollt wird — ohne das bliebe der Griff auf
seiner alten Grösse.

Das Etikett neben dem Griff füllt, wer es braucht. Der Katalog trägt über
`setScrollLabel()` eine Funktion ein, die das Jahr an der aktuellen Stelle
liefert; ausserhalb bleibt es leer und der Balken ist ein gewöhnlicher
Scrollbalken. Bei „Name A–Z" meldet der Katalog gar nichts an — dort liegen die
Jahre verstreut.

### Zweiter Weg zum Nachladen

Neben dem Beobachter rechnet `_ladeSichtbareSeiten()` aus den Blockpositionen,
was gerade (oder fast) im Bild ist — beim Aufbau, nach jedem Füllen und
unabhängig davon, ob der Beobachter greift. Genau diese Absicherung fehlte, und
genau deshalb blieb die Liste leer.

### Test

`catalog-frontend` auf die neue Aufteilung umgeschrieben: Browser-Balken
ausgeblendet, eigener Balken am Fensterrand, er rollt die Seite und folgt der
wachsenden Höhe; im Katalog kein eigener Scrollkasten mehr, Beobachter ohne
eigene Wurzel, der zweite Ladeweg vorhanden und nach dem Füllen erneut
angestossen, Etikett angemeldet.

Dabei eine Eigenheit der Prüfumgebung dokumentiert: jsdom rechnet kein Layout,
`getBoundingClientRect()` liefert überall Nullen — der zweite Ladeweg hält
deshalb JEDEN Block für sichtbar und lädt sofort alles. Im Browser passiert das
nicht. Der Test prüft dort das Ergebnis; dass Platzhalter eine feste Höhe
bekommen, sichert eine Quelltextregel.

Gegenprobe: den zweiten Ladeweg entfernt → der Test wird rot.

609 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 93 (hardened-189) — Nachladen hängt nicht mehr am Beobachter

Marcos Meldung kam ein zweites Mal: „Wenn ich nach unten scrolle, erscheinen
keine Einträge."

Ich weiss nicht, ob sie den Stand aus Nachtrag 92 schon meinte oder noch den
davor — das Bild kam beide Male nicht mit an. Statt zu raten, habe ich die
verbleibenden Ursachen beseitigt, die im aktuellen Stand noch möglich waren.

### 1. Das Nachladen hing allein am IntersectionObserver

Der meldet nur ÄNDERUNGEN der Sichtbarkeit. Bleibt ein grosser Block
durchgehend sichtbar, oder greift die Wurzel nicht wie gedacht, kommt nie wieder
ein Aufruf — und die Liste bleibt leer, obwohl alles richtig aussieht.

Jetzt hängt das Laden am Scroll-Ereignis selbst: `_ladeSichtbareSeiten()`
rechnet aus den Blockpositionen, was im Bild ist, gedrosselt über
`requestAnimationFrame` (ein Scroll-Ereignis feuert dutzende Male je Sekunde,
und die Rechnung liest Layout). Der Beobachter bleibt als zweiter Weg.

### 2. Über 25 000 Platzhalter-Elemente auf einmal

Ungeladene Seiten bekamen je 60 Kachel-Platzhalter — bei 25 000 Sets über 25 000
Elemente in einem einzigen `innerHTML`. Der Browser baut das, aber langsam, und
jeder Scroll-Schritt kostet danach.

Eine ungeladene Seite ist jetzt EIN leerer Block. Seine Höhe wird an der ersten,
echten Seite GEMESSEN statt gerechnet: Wie viele Kacheln nebeneinander passen,
entscheidet die Fensterbreite. Eine falsche Höhe ist hier teuer — die Liste
springt beim Nachladen, und man verliert die Stelle.

### Test

Vier neue Regeln in `catalog-frontend`: leere Seite als einzelner Block, Höhe
gemessen statt geraten, Scrollen löst das Nachladen aus, und zwar gedrosselt.
Gegenprobe: den Scroll-Weg entfernt → der Test wird rot.

609 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 94 (hardened-190) — Der Scrollbalken erschien nie

Marcos Meldung: „Der Scrollbalken des Browsers ist nun ausgeblendet, aber die
App hat keinen eigenen. Im Reiter Katalog fehlt zudem der Scrollbalken mit den
Jahren."

### Die Ursache

`app.bundle.js` ist ein KLASSISCHES Skript — kein Modul, kein `defer`. Es läuft,
sobald der Parser es erreicht, und das ist VOR allem, was danach im Markup
steht. Ich hatte das `<div id="app-scrollbar">` ans Ende des Body gesetzt,
hinter das Skript. Beim Start gab es das Element also noch nicht,
`initScrollbalken()` kehrte still um (`if (!bar) return`) — und weil der Balken
des Browsers per CSS verborgen ist, hatte die Anwendung GAR KEINEN mehr.

Ein stiller Rückzug an einer Stelle, die nur einmal beim Start durchlaufen wird:
keine Fehlermeldung, kein Konsoleneintrag, nichts zu sehen ausser dem fehlenden
Balken. Das Jahres-Etikett im Katalog fehlte aus demselben Grund — es hängt am
Balken.

Die Anwendung erzeugt das Element jetzt SELBST. Damit hängt der Balken an keiner
Reihenfolge im HTML mehr.

### Gemessen statt vermutet

An einer kleinen jsdom-Bühne mit vorgetäuschtem Layout (jsdom rechnet keines):
Balken erzeugt, sichtbar, Griffhöhe 32px; bei einer Seite, die ins Fenster
passt, wieder verborgen.

### Nebenbei: das Neuzeichnen war ungedrosselt

`zeichneScrollbalken()` LIEST Layout (`scrollHeight`). Am Scroll-Ereignis hängend
erzwang das dutzende Neuberechnungen je Sekunde. Das passt zu Marcos Beobachtung
davor („dauert viel länger, als könnte der Server weniger gleichzeitig") — eine
blockierte Seite sieht aus wie ein langsamer Server. Jetzt über
`requestAnimationFrame` gedrosselt.

### Tests

Neu `test/app-scrollbar.test.js`: Der Balken wird erzeugt und erscheint bei
rollbarer Seite, verschwindet ohne Rollbereich, das Neuzeichnen ist gedrosselt,
und das Etikett bleibt leer, solange es niemand anmeldet. Gegenprobe bestanden.

Der bestehende Prüfer `dom-ids` meldete `app-scrollbar` als fehlend: Er kannte
nur ausgezeichnete Elemente (`<div id="…">`), nicht solche, die der Code selbst
erzeugt (`el.id = '…'`). Erweitert — sonst hätte man sich angewöhnt, ihn zu
übergehen.

613 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 95 (hardened-191) — Der Katalog liess den Server Bilder ohne Ende vorbereiten

Marcos Meldung: „Die App scheint den Server seit der vorletzten Version sehr
stark auszulasten. Die CPU ist praktisch non-Stop auf 100 % Auslastung."

Es ist eine Folge meines Katalog-Umbaus, und sie hätte mir auffallen müssen.

### Was passiert ist

Die Katalogliste bereitet Bilder vor: Zu jedem Set ohne lokale Datei wird ein
Download eingereiht, und zu jedem Download gehört das Erzeugen eines
Vorschaubildes — das ist die teure Arbeit.

Bis zum Umbau holte die Webapp die Seiten EINE nach der anderen; wer zehn Seiten
weit scrollte, stiess zehn Seiten Bilder an. Seit dem Fensterladen
(Nachtrag 90) kann ein einziger Scroll-Vorgang viele Seiten anfordern, ein
Sprung ans Jahresende erst recht. Bei rund 25 000 Katalog-Sets lief der Server
damit lange nach dem Scrollen weiter auf Anschlag — genau das Bild, das Marco
beschreibt.

Begrenzt war die PARALLELITÄT (zwei gleichzeitig), nicht die WARTESCHLANGE. Der
Kommentar an dieser Stelle sprach ausdrücklich von „schnellem Scrollen durch
mehrere Seiten" — geschrieben für eine Liste, die höchstens ein paar Seiten weit
kam. Der Umbau hat die Voraussetzung dieser Begrenzung aufgehoben, und ich habe
die Stelle nicht mitgeprüft. Das ist dieselbe Lehre wie schon mehrfach in dieser
Reihe: Wer eine Annahme ändert, muss suchen, wer auf ihr aufbaut.

### Der Deckel

Höchstens 60 wartende Bilder. Was darüber hinausgeht, wird VERWORFEN — nicht
aufgeschoben: Wer schnell durchscrollt, will diese Bilder nicht, er kommt nur
vorbei. Fehlende Vorschaubilder holt der Bild-Proxy ohnehin bei Bedarf; der
Vorablauf ist eine Beschleunigung, keine Voraussetzung.

Verworfene Sets bleiben NICHT in der „schon gesehen"-Liste — sonst gälten sie
als erledigt und bekämen nie ein lokales Bild, auch wenn man später wirklich bei
ihnen stehen bleibt.

### Gemessen

Zehn Seiten in schneller Folge (600 Sets), Downloader abgefangen:

    ohne Deckel   600 Aufträge
    mit Deckel    104 Aufträge

Der Test misst dasselbe an der ECHTEN Route, nicht an der Hilfsfunktion — genau
dazwischen sass der Fehler: Die Route reiht je Seite bis zu 60 Sets ein, und
niemand begrenzte die Summe. Gegenprobe bestanden.

614 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 96 (hardened-192) — Der Zug über die Leiste blockierte alles

Marcos Meldung mit Bild: „Wenn ich im Katalog zu einem Jahr scrolle, hängt die
Applikation wieder (CPU auf 100 %)." Das Bild zeigt eine leere Liste und das
Etikett 1962 — also ein Zug vom oberen bis zum unteren Ende der Leiste.

Der Deckel auf der Bild-Warteschlange (Nachtrag 95) war richtig, aber er
behandelte die Folge. Die Ursache lag im Ziehen selbst, und sie hat zwei
Hälften.

### 1. Jedes Bild fragte über vierhundert Blöcke nach ihrer Lage

`_ladeSichtbareSeiten()` lief über ALLE Seitenblöcke und rief für jeden
`getBoundingClientRect()`. Bei rund 25 000 Sets sind das über vierhundert
Abfragen — und jede zwingt den Browser zu einer Layout-Neuberechnung. Beim
Ziehen passiert das sechzigmal je Sekunde. Der Balken tat damit genau das,
wogegen er helfen sollte.

Die Lagen werden jetzt EINMAL gemessen und gemerkt. Neu gemessen wird nur, wenn
eine Seite eintrifft oder sich das Fenster ändert.

### 2. Geladen wurde an JEDER Stelle, an der man vorbeikam

Wer von oben nach unten zieht, kommt an jeder Stelle der Liste vorbei — und
löste dort eine Seitenabfrage aus. Ein paar hundert Abfragen über 25 000 Zeilen,
jede mit bis zu sechzig Bildern im Schlepptau, von denen nur die letzte je
angesehen wird.

Jetzt wird erst geladen, wenn das Rollen 150 ms zur Ruhe gekommen ist. Beim
gewöhnlichen Scrollen merkt man das nicht; ein Zug über die ganze Leiste löst
genau EINEN Abruf aus — am Ziel. Was beim Aufbau schon im Bild steht, kommt
weiterhin sofort.

### Der IntersectionObserver ist entfallen

Er war ein zweiter Weg zum selben Ziel, meldete nur ÄNDERUNGEN der Sichtbarkeit
(weshalb bei grossen Blöcken nichts nachkam — Marcos Meldung von vorhin) und
feuerte zusätzlich zur Lagenrechnung. Ein Weg, der immer greift, ist besser als
zwei, die sich ergänzen sollen.

### Tests

Vier neue Regeln in `catalog-frontend`: Blocklagen aus dem Gedächtnis, beim
Rollen wird NICHT neu gemessen, Laden wartet auf Ruhe, kein zweiter Ladeweg.
Beide Gegenproben bestanden.

614 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 97 (hardened-193) — Das Jahres-Etikett log

Marcos Befund: „Wenn dann die Bilder geladen werden, erscheinen sie von einem
anderen Jahr, als rechts im Scrollbalken angezeigt wird. Es wurden die Sets von
1999 geladen, obwohl rechts 1965 steht."

### Eine Annahme, die niemand ausgesprochen hatte

Das Etikett rechnete die Position LINEAR auf den Jahresbereich um — als läge
zwischen 1949 und 2027 in jedem Jahr gleich viel. Tatsächlich stammt der weitaus
grösste Teil des Katalogs aus den letzten Jahrzehnten. Wer neun Zehntel
hinunterzieht, ist deshalb noch lange nicht bei den Sechzigern.

Ich hatte die Rechnung selbst als „Schätzung für noch leere Bereiche"
kommentiert und dabei übersehen, dass genau dort — beim Ziehen über viele
ungeladene Seiten — das Etikett fast ausschliesslich gebraucht wird.

### Jetzt

Neu `GET /api/v1/catalog/year-verteilung`: Anzahl je Jahr, MIT den aktuellen
Filtern und in der Reihenfolge der Sortierung. Aus der Position wird eine
laufende Nummer und daraus das Jahr, in dem diese Nummer wirklich liegt.

Vom SERVER, weil nur er die Filter kennt: Eine Verteilung über den ganzen
Katalog läge bei gesetztem Thema oder Suchtext genauso daneben wie die lineare
Schätzung. Geholt wird sie einmal je Listenaufbau, nicht beim Rollen.

Die erste Wahl bleibt die oberste sichtbare Kachel — sobald die Seite geladen
ist, ist das die Wahrheit und keine Rechnung.

### Gemessen

Schiefe Verteilung wie im echten Katalog (1960–1969 je 2 Sets, 1990–1999 je 20,
2010–2019 je 100):

    Position   dort steht   Etikett neu   Etikett alt (linear)
         25%         2016          2016                   2004
         50%         2013          2013                   1990
         75%         2010          2010                   1975
         90%         1995          1995                   1966

### Test

Neu `test/catalog-year-label-db.test.js`: Zu jeder Position wird das Set an
dieser laufenden Nummer aus der ECHTEN Liste geholt und sein Jahr mit dem
Etikett verglichen — in beiden Sortierungen und mit Themenfilter. Ein Test auf
„die Route liefert Jahre" hätte die lineare Schätzung nie auffliegen lassen.

Der vierte Teilschritt ist eine Gegenprobe im Test selbst: Er stellt sicher,
dass die Bühne SCHIEF ist. Bei gleicher Anzahl je Jahr wäre auch die lineare
Fassung richtig gewesen, und der Test wertlos.

Eigene Falle dabei: Der Test lief allein grün und im vollen Durchlauf rot —
`rb_sets` ist eine globale Tabelle, andere Tests legen dort eigene Zeilen an.
Jetzt schränken alle Abfragen über die Suche auf die eigenen Sets ein.

619 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 98 (hardened-194) — Fehlende Bilder wurden immer wieder gesucht

Marcos Befund: „Beim ersten Scrollen im Katalog funktioniert es einwandfrei,
wenn ich dann weiter scrolle zu 1958, ist es wieder das gleiche Problem."
Dazu der Log — seitenweise `[set-img] HTTP 404 vom Bildserver` für Sets aus den
Fünfzigern und Sechzigern — und `docker stats` mit **142 % CPU im Container**.

Damit war endlich klar, auf welcher Seite die Last sitzt. Meine bisherigen
Anläufe hatten das Laden gedrosselt; die eigentliche Arbeit lag woanders.

### Was der Server tat

Für alte Sets hat Rebrickable meist gar kein Bild. Jede Kachel dort löste einen
Roundtrip zum CDN aus, der ins Leere ging.

Es GAB zwei Merker dagegen: Der Bild-Proxy hielt 404er fünfzehn Minuten fest,
der Katalog merkte sich versuchte Sets. Beide lagen im Arbeitsspeicher EINES
Prozesses — und der Server läuft im Cluster mit mehreren Arbeitsprozessen (im
Log: 16, 22, 23, 24). Dasselbe fehlende Bild wurde deshalb einmal je Prozess
geholt, nach jedem Neustart erneut, und nach fünfzehn Minuten wieder.

Das ist die Klasse Fehler, die in dieser Reihe schon mehrfach vorkam: Ein Schutz
existiert, aber sein Geltungsbereich ist enger als das Problem. Der Kommentar am
Negativ-Merker begründete die kurze Frist ausführlich — für einen einzelnen
Prozess war sie auch richtig.

### Jetzt

Neu `utils/imageMisses.ts`: eine Tabelle `image_misses`, gelesen und geschrieben
von BEIDEN Wegen — der Katalog-Warteschlange und dem Bild-Proxy. Sie überlebt
den Neustart, und alle Arbeitsprozesse teilen sie. Davor ein Merker im
Arbeitsspeicher, damit häufige Treffer nicht je Bildanfrage in die Datenbank
müssen.

Nach sieben Tagen wird erneut geprüft: Ein Bild, das seit Jahrzehnten fehlt,
taucht nicht über Nacht auf, und ein nachgereichtes bleibt nicht für immer
ausgesperrt.

### Gemessen

Ein Jahrgang mit 60 bildlosen Sets:

    1. Besuch          60 Versuche
    2. Besuch           0 weitere
    frischer Prozess    weiss Bescheid

### Tests

Neu `test/image-misses-db.test.js` — über die ECHTE Route, mit abgefangenem
Downloader. Der entscheidende Teilschritt leert den Arbeitsspeicher-Merker und
prüft, dass die Auskunft trotzdem stimmt: Genau dort lag der Fehler. Dazu die
Gegenrichtung, dass ein vorhandenes Bild nicht als fehlend gilt — sonst wäre
der Test auch grün, wenn pauschal alles ausgesperrt würde.

`set-value` nagelte die alte Fassung fest („Fenster 15 Minuten"). Umformuliert:
Die Aussage „nur 404, kein 403" gilt unverändert, geprüft wird jetzt am
gemeinsamen Merker.

622 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 99 (hardened-195) — Die Vorschaubilder waren die Last

Marcos Messung: **329 % CPU** im Container bei **15 MB** Netzverkehr. Das ist
die Zahl, die alles entschieden hat: keine Warterei auf fremde Server, sondern
Rechnen — und die teuerste Rechnung im Server ist das Verkleinern von Bildern.

Meine bisherigen Anläufe haben das LADEN gedrosselt (Nachtrag 95, 96) und
vergebliche CDN-Roundtrips abgestellt (98). Alles richtig, aber daneben: Die
Arbeit steckte im Bild-Proxy.

### Warum es so teuer ist

`Jimp` ist reines JavaScript. Ein JPEG zu entpacken und zu verkleinern kostet
auf schwacher Hardware — Marcos Installation läuft auf einem Raspberry Pi —
spürbar Zeit.

Die Grenze `THUMB_MAX_PARALLEL = 2` stand da, aber sie gilt JE ARBEITSPROZESS,
und der Server läuft im Cluster mit vier davon: acht gleichzeitige Läufe. 329 %
sind gut drei Kerne. Die Warteschlange davor hatte gar keine Grenze.

Wieder derselbe Befund wie beim Merker für fehlende Bilder: Ein Schutz
existiert, aber sein Geltungsbereich ist enger als das Problem.

Bis zum Umbau der Katalogliste fiel das nicht auf — sie zeigte nur, wozu man
sich hingescrollt hatte. Seit dem Fensterladen kommen bei jedem Sprung hunderte
neuer Bilder ins Blickfeld, und für jedes wurde eine Vorschau gerechnet. Der
Rückstau lief lange nach dem Scrollen weiter.

### Jetzt

* `THUMB_MAX_PARALLEL = 1` — einer je Prozess. Die Vorschau ist eine
  Beschleunigung für später, nichts, worauf jemand wartet: Bis sie fertig ist,
  liefert der Proxy das Originalbild aus.
* `THUMB_MAX_QUEUE = 40` — dieselbe Überlegung wie bei den Katalog-Bildern: Wer
  schnell durchscrollt, WILL diese Vorschauen nicht, er kommt nur vorbei.
  Verworfen statt aufgeschoben; wer stehen bleibt, bekommt sie beim nächsten
  Aufruf.

### Test

`set-value` prüft beide Grenzen mit dem Grund im Text: dass sich die
Parallelität im Cluster je Arbeitsprozess vervielfacht, und dass eine
Warteschlange ohne Ende den halben Katalog aufstaut.

623 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 100 (hardened-196) — Die Grenze galt je Prozess, nicht für den Server

Marcos Beobachtung, und damit war es klar: „Es rechnen alle gleichzeitig und
beginnen erst, wenn ich das erste Mal richtig scrolle."

Genau das war der fehlende Zusatz zu den 329 % aus der Messung davor.

### Warum die Grenze aus Nachtrag 99 nicht reichte

`THUMB_MAX_PARALLEL = 1` gilt je ARBEITSPROZESS. Der Server läuft im Cluster mit
vier davon — vier Prozesse mal ein Lauf sind immer noch vier gleichzeitige
Jimp-Verkleinerungen, auf einem Raspberry Pi praktisch alle Kerne. Eine Grenze
im Arbeitsspeicher KANN das nicht lösen, weil kein Prozess von den anderen
weiss.

Dasselbe Muster nun zum dritten Mal in Folge: der Merker für fehlende Bilder
(98), die Vorschau-Parallelität (99), und jetzt sie noch einmal. Jedes Mal
existierte ein Schutz, und jedes Mal war sein Geltungsbereich enger als das
Problem. Die Lehre gehört an den Anfang jeder Begrenzung in diesem Projekt:
**Im Cluster zählt nur, was alle Prozesse sehen.**

### Jetzt

`pg_try_advisory_lock` gibt den Zuschlag genau einem Prozess. Wer ihn nicht
bekommt, lässt es — kein Warten, kein Aufstauen: Die Vorschau ist eine
Beschleunigung für später, und beim nächsten Aufruf des Bildes wird es erneut
versucht. Ein WARTENDER Lock hielte stattdessen eine Datenbankverbindung fest
und staute die Arbeit nur an anderer Stelle auf.

Damit läuft serverweit höchstens EINE Verkleinerung zur Zeit.

### Gemessen

Zwei Verbindungen als zwei „Prozesse": Der erste bekommt die Sperre, der zweite
nicht; nach der Freigabe bekommt sie der zweite.

### Test

`set-value` prüft alle drei Teile: die Sperre existiert, sie WARTET nicht
(`pg_try_...`, nicht `pg_advisory_lock`), und sie wird wieder freigegeben — ohne
das blockierte der erste Lauf alle folgenden bis zum Neustart. Gegenprobe
bestanden.

623 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
