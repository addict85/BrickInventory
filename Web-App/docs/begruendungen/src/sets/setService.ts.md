# Begründungen zu `src/sets/setService.ts`

Die ausführlichen Kommentare aus `src/sets/setService.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Sets anlegen, ändern und ausgeben — der Kern hinter den Set-Routen.

── Warum das zuletzt kam (Nachtrag 131) ────────────────────────────────────

`addSet` und `updateSet` blieben durch die Nachträge 125 bis 127 als einzige
in routes/sets.ts liegen, und der Grund war kein Zufall: Sie rufen
`importPartsForSet()` und `importMinifigsForSet()`, und die standen in
routes/parts.ts bzw. routes/minifigs.ts. Ein Modul unter utils/ hätte also
ROUTER importieren müssen — die falsche Richtung; utils/ ist die Schicht, auf
der Routen aufsetzen, nicht umgekehrt.

Deshalb ging diesem Umzug ein zweiter voraus: die reine Katalogarbeit nach
utils/partsImport.ts und utils/minifigsImport.ts, und routes/bricklink.ts
(null Routen, nie montiert) nach clients/. Erst danach war dieser Schnitt
ohne Kreis möglich.

Was hier steht, ist Ablaufsteuerung: Was passiert, wenn ein Set dazukommt
(Bild holen, Teile und Minifiguren übernehmen, Anleitung einreihen, Preis
anstossen) und was, wenn es sich ändert. Was NICHT hier steht, sind die
HTTP-Routen — die bleiben in routes/sets.ts und rufen von hier.
```

<a id="pricefornewacquisition"></a>
## `priceForNewAcquisition`

```text
Zustand und Kaufpreis für eine NEU entstehende Erfassung ermitteln.

Reihenfolge: Preis-Cache im passenden Zustand → BrickLink → Historie.
Bleibt alles leer, trägt jobs/purchasePriceBackfill.ts es nach, sobald ein
Preis vorliegt.

── Warum das eine eigene Funktion ist ──────────────────────────────────────
Der mittlere Schritt (getCurrentMarketPrice) ist ein NETZAUFRUF. Er darf
nicht innerhalb einer Transaktion laufen — das hielte Sperre und
Datenbankverbindung sekundenlang, im Zweifel bis zum Zeitlimit von
BrickLink. Deshalb wird der Preis VOR dem Advisory-Lock ermittelt und der
Schreibphase als fertiger Wert übergeben; dasselbe Muster wie in
routes/api_v1/acquisitions.ts.

Dass der Preis dabei ein paar Millisekunden alt ist, spielt keine Rolle —
es ist ein Marktpreis, kein Bestandswert.
```

<a id="pricefornewacquisition-2"></a>
## Abschnitt

```text
── Welcher Zustand? DIESELBE Regel wie ueberall sonst ───────────────────

Hier stand `SELECT condition FROM sets` — also nur der GESPEICHERTE Wert.
Weicht er von den Erfassungen ab (genau der Fall, fuer den
effectiveCondition() gebaut wurde), bekam das neue Exemplar den falschen
Marktpreis. NACHGEMESSEN an einem Set mit sets.condition='N' und einer
Erfassung 'U', Marktpreis U=20 / N=100:

    vorhandene Erfassung        U, Kaufpreis 10
    neue Erfassung durch "+1"   N, Kaufpreis 100   <- Neupreis fuer ein
                                                      gebrauchtes Set

jobs/priceJob.ts (conditionsNeededFor) fragte an derselben Stelle schon
immer zuerst die Erfassungen. Jetzt beide ueber resolveSetCondition().

Lazy require: utils/financeCalc auf Modulebene ergaebe einen Zyklus —
dasselbe Muster wie in utils/rateLimiter.ts.
```

<a id="pricefornewacquisition-blickfeld"></a>
## `blickfeld`

```text
── Der Zustand ist eine HAUSHALTS-Frage, keine Konto-Frage ─────────────

Hier stand `resolveSetCondition(userId, …)` mit einer nackten ID. Das ging
gut, solange die sets-Zeile einen eigenen Zustand trug: Legte die
Mengenaenderung fuer das eigene Konto eine frische Zeile an, kopierte das
INSERT den Wert aus der Zeile des Haushalts mit (`SELECT … condition FROM
sets WHERE user_id = ANY(leseFeld)`). Mit Migration 0032 gibt es nichts
mehr zu kopieren, und die Frage „gebraucht oder neu?" muss dort gestellt
werden, wo die Erfassungen liegen — beim BESITZER.

GEMESSEN, als hier noch die nackte ID stand: Das Unterkonto haelt ein
gebrauchtes Exemplar, das Hauptkonto erhoeht die Menge → die neue
Erfassung bekam 'N' und damit den Neupreis
(set-quantity-household-db: „erhoehen legt im EIGENEN Konto an, mit
Marktpreis", 'N' !== 'U').

resolveSetCondition() sagt es in seinem eigenen Kommentar: „Auch hier das
Blickfeld — mit einer nackten ID faende der Hauptaccount das Set des
Unterkontos nicht."
```

<a id="recordacquisition"></a>
## Abschnitt

```text
Kein Rückfall ohne condition mehr.

Hier stand ein try/catch, das bei JEDEM Fehler ein zweites INSERT ohne die
condition-Spalte versuchte — gedacht für Installationen von vor der
Migration. initSchema() legt die Spalte inzwischen garantiert an
(db/database.ts, "Migration: set_acquisitions.condition"), der Zweig war
also toter Code.

Er war ausserdem schädlich: Das catch fing nicht nur "Spalte fehlt", sondern
jeden Fehler ab — und seit die Aufrufer in einer Transaktion laufen
(db/txLock.ts) hätte ein zweites Statement nach einem Fehler die bereits
abgebrochene Transaktion weiterbenutzt und den echten Grund verschluckt.
Pro Tag und Zustand EINE Erfassung (src/bestand/acquisitions.ts).

Vorher schrieb dieser Pfad bedingungslos eine neue Zeile — und stellte
damit genau den Zustand her, den der Datums-Endpunkt weiter unten ablehnt
(„An diesem Datum existiert bereits ein Eintrag."). Zweimal dasselbe Set
am selben Tag ergab zwei Zeilen, die sich in nichts unterschieden.
```

<a id="adjustacquisitionstoquantity-plan"></a>
## `plan`

```text
Aufstocken oder neue Tageszeile — beides entscheidet
recordAcquisitionForDay() (über recordAcquisition unten).

Hier stand zuletzt eine eigene Tagesprüfung: Ist die NEUESTE
Erfassung von heute, Menge erhöhen, sonst neu anlegen. Zwei Dinge
waren daran falsch. Erstens war es die vierte Kopie derselben Regel.
Zweitens erhöhte der Zweig nur die Menge und liess den Kaufpreis
stehen — ein heute dazugekauftes Exemplar zum aktuellen Marktpreis
verschwand damit im alten Stückpreis. Der Helfer mittelt
mengengewichtet, wie überall sonst.

Der Marktpreis wird deshalb IMMER ermittelt, nicht nur im
Neuanlage-Fall.
```

<a id="adjustacquisitionstoquantity-plan-2"></a>
## `plan`

```text
ERSTE Erfassung dieses Kontos für das Set.

Hier stand ein `SELECT purchase_price, condition FROM sets`: Der Wert
der sets-Zeile galt als Vorgabe, und nur wenn dort keiner stand, sprang
der Marktpreis ein. Beide Spalten sind mit Migration 0032 weg — die
Vorgabe kann also nur noch der Plan sein, und der stimmt hier auch
besser. Denn genau dieser Zweig trifft den Fall, dass bisher nur ein
ANDERES Konto das Set hält (Nachtrag 85): Für das eigene entstand eine
frische Zeile ohne Kaufpreis, der Zweig las sie und übergab null,
obwohl der Aufrufer den Marktpreis längst ermittelt hatte.

priceForNewAcquisition() liest den Zustand aus den Erfassungen des
Haushalts, nicht aus einer Spalte; eine leere eigene Zeile verdirbt ihn
damit nicht mehr.
```

<a id="addset"></a>
## `addSet`

```text
Ein Set erfassen — mit Lagerort, wenn einer mitkommt.

── Warum der Lagerort HIER und nicht im Rumpf steht ────────────────────────

Marcos Befund vom 24.09.: „Wenn ich ein Set in der Galerie hinzufuegen will,
kann ich den Lagerort nicht waehlen." Das stimmte, und es war kein fehlendes
Eingabefeld: Bis dahin liess sich der Lagerort ausschliesslich NACH dem
Erfassen im Detaildialog setzen, ueber PUT …/storage.

Der Rumpf hat zwei Zweige — Erst-Erfassung und Aufstocken —, und beide
muessten die Spalte schreiben. Stattdessen schreibt sie KEINER von beiden:
Der Lagerort wird danach ueber setzeLagerort() gesetzt, dieselbe Funktion,
die auch der Detaildialog ruft. Damit gilt die Laengengrenze einmal, das
Trimmen einmal, und — das ist der eigentliche Grund — ein neu getippter Ort
landet ueber stelleOrteSicher() im Vorrat. Ohne das stuende der Ort am Set,
fehlte aber in der Liste, aus der er gewaehlt werden soll.

GEPRUEFT wird vorher: Ein zu langer Name soll nicht erst das Set anlegen und
dann absagen.

`sendProgress` meldet Zwischenschritte an den SSE-Strom; null beim CSV-Import.
```

<a id="addsetintern-zustand"></a>
## `zustand`

```text
Zustand EINMAL bestimmen, fuer BEIDE Zweige.

Er stand vorher zweimal da, und die beiden Fassungen waren nicht gleich:
Der Neuanlage-Zweig rechnete `condition || userDefaultCondition(...)`, der
Aufstock-Zweig gab dem Preis `condition || null` (worauf getCurrentMarketPrice
intern denselben Standard einsetzte) und der ERFASSUNG hart `condition || 'N'`.

Steht der Standard des Nutzers auf „Gebraucht", bekam eine Erfassung ohne
Zustandsangabe damit den Gebraucht-Preis, wurde aber als NEU verbucht. In
der Finanzansicht zaehlt sie danach in der falschen Gruppe.

Es ist dieselbe Verwechslung wie in Nachtrag 68, nur andersherum: Damals
war der Preis falsch, hier der Vermerk. Die Staffelung steht seit dem
Zusammenlegen in src/konto/settings.ts.
```

<a id="addsetintern-readdprice"></a>
## `reAddPrice`

```text
Kaufpreis dieser Erfassung festhalten (ging früher verloren!) —
ohne Angabe aktuellen Marktpreis übernehmen, wie bei Neu-Erfassung.
Auch hier den gewählten Zustand mitgeben, sonst kommt der Neupreis.

Der Marktpreis wird VOR der Sperre geholt: Das ist ein Netzaufruf, und
eine Sperre über einen Netzaufruf zu halten blockiert jeden anderen
Schreibvorgang auf diesem Set für die Dauer der Antwort.
purchasePrice ist number|null. NACHGEMESSEN: Es gibt genau drei
Importeure (routes/sets.ts, routes/api_v1/sets.ts, addSetWithDate), und
alle drei normalisieren vorher — V.optionalPrice() bzw. routes/sets.ts
Zeile 549 beim CSV-Import. Die frueheren Pruefungen auf '' und das
parseFloat verteidigten gegen eine Form, die hier nicht ankommt; der Typ
hat das sichtbar gemacht ("number und string haben keine Ueberschneidung").
```

<a id="addsetintern"></a>
## Abschnitt

```text
── Menge und Erfassung GESPERRT schreiben ────────────────────────────

Vorher standen die drei Schreibvorgänge ungesperrt nebeneinander, und
recordAcquisitionForDay() liest erst und schreibt dann. Zehn parallele
Erfassungen desselben Sets ergaben am laufenden Server: sets.quantity =
10, aber drei Erfassungszeilen mit Summe 7 — drei verlorene Exemplare
und drei Tageszeilen, wo genau eine erlaubt ist. Alle anderen
Schreibwege (Mengenänderung, Verschieben, Eigentümerwechsel) hielten
diese Sperre längst; ausgerechnet das Erfassen nicht.
```

<a id="addsetintern-2"></a>
## Abschnitt

```text
── Erst die Erfassung, dann die Menge daraus ──────────────────────

Hier stand `UPDATE sets SET quantity = quantity + $1` VOR der
Erfassung. Das war die zweite Schreibrichtung: Zwei Stellen fuehrten
dieselbe Zahl fort, und genau sie sind auseinandergelaufen (der
Befund steht im Kommentar darueber).

Jetzt schreibt nur noch die Erfassung. Die Menge ist seit Migration
0036 keine Spalte mehr — sie wird beim LESEN aus den Erfassungen
gerechnet (src/sets/bestandsmenge.ts).

Hier folgte aussserdem ein UPDATE auf sets.purchase_price („Preis der
letzten Erfassung"). Die Spalte ist mit Migration 0032 weg;
recordAcquisition() schreibt den Preis an seinen einzigen Ort.
```

<a id="addsetintern-3"></a>
## Abschnitt

```text
── Der Katalog ist seit Migration 0033 die EINZIGE Stelle ──────────────

Hier stand `.catch(()=>{})`. Das ging, solange die Stammdaten gleich
darunter noch einmal in die sets-Zeile geschrieben wurden: Scheiterte der
Katalog, hatte das Set immer noch seinen Namen.

Jetzt nicht mehr. Scheitert diese Anweisung, hat das Set nirgends einen
Namen, kein Jahr und kein Bild — und niemand erfaehrt davon. Deshalb kein
Fang: Das Erfassen bricht ab, und zwar mit der Meldung von Postgres. Ein
Set ohne Namen ist der schlechtere Ausgang.
```

<a id="addsetintern-4"></a>
## Abschnitt

```text
Die Bestandszeile traegt nur noch, WER WIE VIELE haelt.

Kaufpreis und Zustand stehen in der Erfassung eine Zeile tiefer
(Migration 0032), Name, Jahr, Thema, Teilezahl, Minifigurenzahl und
Bilder im Katalog (Migration 0033, Upsert oben). Der ON-CONFLICT-Zweig
hatte dafuer eigens ein `name=COALESCE(EXCLUDED.name,sets.name)` — die
Abschrift nachtragen, falls sie fehlte. Auch das faellt weg.
Die Bestandszeile sagt nur noch: DIESES Konto haelt DIESES Set. Wie
viele, steht in den Erfassungen — die Spalte ist mit Migration 0036 weg.

Hier stand ein `DO UPDATE SET quantity=sets.quantity+EXCLUDED.quantity`:
die zweite Schreibrichtung, an der die Zahlen auseinandergelaufen sind
(der Befund steht in src/sets/bestandsmenge.ts). DO NOTHING statt DO
UPDATE — gibt es die Zeile schon, ist nichts zu tun.
```

<a id="schreibeinletzteerfassung"></a>
## `schreibeInLetzteErfassung`

```text
Einen Wert in die LETZTE Erfassung schreiben — die, die der Detail-Dialog
definitionsgemaess bearbeitet.

── Was hier vorher auch noch passierte ─────────────────────────────────────
Die Funktion hiess spiegleAufSetUndLetzteErfassung() und schrieb denselben
Wert zusaetzlich in die sets-Zeile. Beides zusammen war der Grund fuer drei
gemeldete Fehler, weil die zwei Orte auseinanderliefen. Mit Migration 0032
gibt es nur noch EINEN Ort, und die halbe Funktion faellt weg.

Erhalten bleibt die Lehre aus dem damaligen Fehler, denn sie gilt weiter:
`ownerId`, nicht der Aufrufer. Der frueher doppelte Code hatte im
Zustands-Zweig `WHERE user_id = <Aufrufer>` — bei einem Set des Unterkontos
traf das keine Zeile, und updateSet meldete trotzdem Erfolg. NACHGEMESSEN
damals: Preis 99 kam an, Zustand U verschwand still. Die Regel steht in
updateSet ausdruecklich ueber der Aufrufstelle („ab hier zaehlt der BESITZER
der Zeile"); der Mengen-Zweig weicht bewusst davon ab (Marcos Vorgabe:
angezeigt wird der Haushalt, geaendert wird das eigene Konto) und geht
deshalb nicht hier durch.

@param feld  fester Spaltenname, KEINE Eingabe von aussen
```

<a id="updateset-wids"></a>
## `_wids`

```text
SCHREIB-Blickfeld statt eigener ID (Nachtrag 52, Marcos Bericht: „Wenn die
Anzahl eines Sets erhöht wird, das einem Unterkonto gehört, funktioniert
die ganze Logik mit dem Kaufpreis nicht und die Anzahl wird nicht
gespeichert").

Die Suche lief gegen `user_id = eigene ID` und lieferte für jedes Set des
Unterkontos 404 — auf BEIDEN Wegen, auch in der Webapp. Dieselbe Klasse
wie die Erfassungsroute aus Nachtrag 45; dort war es der Kaufpreis, hier
die Menge. Und weil die Mengenänderung über adjustAcquisitionsToQuantity()
auch Erfassungen anlegt und Preise setzt, blieb gleich die ganze Kette
wirkungslos.

writableIds() ist bewusst enger als scopeIds(): Ein Unterkonto darf nicht
rückwärts in das Hauptkonto schreiben.
```

<a id="updateset-gewuenschtgesamt"></a>
## `gewuenschtGesamt`

```text
── Menge und Erfassungen gehören zusammen ─────────────────────────────

Vorher standen hier zwei lose Statements: UPDATE sets … und danach
adjustAcquisitionsToQuantity(…).catch(() => {}). Beides ohne
Transaktion, ohne Sperre und mit verschlucktem Fehler. Scheiterte der
zweite Schritt, blieb sets.quantity erhöht, während die Erfassungen auf
dem alten Stand standen — der Drift, den db/txLock.ts beschreibt,
nur eben stillschweigend und ohne Logzeile.

Der Marktpreis wird VOR der Sperre geholt (Netzaufruf, siehe
priceForNewAcquisition); innerhalb läuft nur noch Datenbankarbeit.
── Angezeigt wird der HAUSHALT, geändert wird das EIGENE Konto ────────

Marcos Vorgabe: „Die Anzahl soll immer von allen angezeigt werden. Wenn
ich diese erhöhe, soll es für meinen Account einen neuen Kaufpreis-
Eintrag erstellen. Analog der bestehenden Logik."

Die Zahl im Formular ist also die Gesamtmenge des Haushalts. Was davon
geschrieben wird, ist die DIFFERENZ, und die geht auf das eigene Konto —
nicht auf das, dessen Zeile die Abfrage zufällig zuerst fand. Vorher
erhöhte ein „+" auf einem Set des Unterkontos dessen Bestand, und die
neue Erfassung entstand in einem fremden Konto.

„Analog der bestehenden Logik" heisst wörtlich: dieselbe Funktion.
adjustAcquisitionsToQuantity() legt die Erfassung an, holt den
Marktpreis über priceForNewAcquisition() und beachtet die Tagesregel —
alles unverändert, nur mit dem eigenen Konto als Ziel.
```

<a id="updateset"></a>
## Abschnitt

```text
Nur noch Menge und Besitzer — und damit keine Abschrift mehr.

Hier stand ein `INSERT … SELECT name, year, theme, … FROM sets`: Die
Stammdaten der Haushaltszeile wurden in die neue Zeile kopiert, und
`condition` mit ihnen. Beides ist weg (Migration 0032 und 0033), und
beides war ungenauer als das, was jetzt gilt: Die Stammdaten stehen
im Katalog, der Zustand entsteht in der Erfassung, die
adjustAcquisitionsToQuantity() gleich darunter anlegt.

Das vorangestellte SELECT bleibt — es beantwortet „gibt es diese
Setnummer im Haushalt ueberhaupt?". Ohne diese Bedingung legte ein
Mengenregler eine Zeile fuer eine Nummer an, die niemand haelt.
```

<a id="sets-csv-sql"></a>
## `SETS_CSV_SQL`

```text
Shared logic to build the Sets CSV export content. Used by both the
standalone CSV download and the combined ZIP export in settings.js.
Eine Zeile pro Erfassung, damit Kaufpreis, Zustand und Datum je Kauf erhalten
bleiben und beim Re-Import 1:1 wiederhergestellt werden. Sets ohne Erfassungen
fallen auf die Set-Zeile zurück — die trägt seit Migration 0032 nur noch die
Menge, Kaufpreis und Zustand bleiben dann leer bzw. 'N'.

── Warum ein LEFT JOIN und keine Schleife ──────────────────────────────────
Vorher lief hier eine Abfrage JE SET. Bei 700 Sets waren das 701 Hin- und
Rückwege zur Datenbank; jeder einzelne war schnell, die Summe nicht. Der
Export ist die Stelle, an der ein Nutzer am ehesten den GANZEN Bestand
anfasst — also genau die, an der sich das am stärksten auswirkt.

Der LEFT JOIN erzeugt dieselben Zeilen: zu jedem Set entweder eine je
Erfassung oder, wenn es keine gibt, genau eine mit NULL-Erfassungsspalten.

── Die Falle dabei ─────────────────────────────────────────────────────────
Die Unterscheidung „Erfassung vorhanden, aber ohne Preis" gegen „keine
Erfassung" bleibt wichtig, auch wenn der frühere Rückfall auf
s.purchase_price/s.condition mit Migration 0032 weggefallen ist: Zu einer
vorhandenen Erfassung ohne Preis gehört ein leeres Feld. Das ergibt sich
jetzt von selbst, weil a.purchase_price dann NULL ist.
csv-export-acquisitions-db.test.js prüft genau diesen Fall.
```

<a id="buildsetscsv-rows"></a>
## `rows`

```text
Der Rückfallweg bewahrt, was das frühere `.catch(() => [])` je Set leistete:
Fehlt set_acquisitions (Migration noch nicht gelaufen), kam dort weiterhin
die Set-Zeile heraus. Ein JOIN würde stattdessen die GANZE Abfrage
abbrechen — der Export lieferte gar nichts mehr.
── Der Rueckfall ist weg, und er war bereits kaputt ───────────────────

Hier stand ein zweiter Lauf fuer den Fall „Fehlt set_acquisitions
(Migration noch nicht gelaufen)". Er las `purchase_price` und `condition`
aus der sets-Zeile — Spalten, die es seit Migration 0032 nicht mehr gibt.
Er haette also genau dann gescheitert, wenn er gebraucht worden waere,
und kein Test hat das gemeldet, weil ihn nichts aufruft: Die Haupt-Abfrage
scheitert nur, wenn set_acquisitions fehlt, und ohne diese Tabelle laeuft
dieser Stand ohnehin nicht.
```
