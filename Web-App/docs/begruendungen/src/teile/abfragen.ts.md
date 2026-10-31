# Begründungen zu `src/teile/abfragen.ts`

Die ausführlichen Kommentare aus `src/teile/abfragen.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Leseabfragen für Teile — inklusive der Ausweichebenen (CSV-Zwischenspeicher,
Rebrickable), wenn der eigene Bestand ein Set nicht kennt.

── Warum aufgeteilt (Nachtrag 133) ────────────────────────────────────────
utils/handlers.ts fasste Sets, Teile und Minifiguren in 1313 Zeilen zusammen
— benannt nach seiner Rolle („handlers"), nicht nach seinem Inhalt, wie
zuvor schon js/07-admin.js. Die drei Domänen berühren sich kaum: Nur
getSets() liest Teile, und die Minifiguren-Kennzahlen lesen Sets. Beides
geht in EINE Richtung, es entsteht also kein Kreis.
```

<a id="getpartscolors"></a>
## Abschnitt

```text
Aus der Zusammenfassung: dieselbe Gruppierung, aber über 66'000 statt
171'000 Zeilen und ohne den Join auf sets — die Mengen sind dort bereits
mit der Set-Anzahl multipliziert.
strict: Kennzahlen müssen zwischen Webapp und App übereinstimmen — ein
veralteter Stand darf hier nicht benutzt werden (siehe partsSummary.ts).
::int an JEDEM Zählwert BEIDER Zweige: Ohne die Casts hing der JSON-TYP
am Cache-Zustand — SUM(BIGINT) im Zusammenfassungs-Zweig ergibt NUMERIC
(der Parser in db/database.ts macht daraus eine ZAHL), SUM(INTEGER) im
Live-Zweig ergibt BIGINT (bleibt TEXT). Dieselbe Route lieferte also mal
total_quantity: 20, mal "20", je nachdem, ob die Zusammenfassung gerade
frisch war. Aufgeflogen im Paritätstest, der die beiden Aufrufe zufällig
über eine Frische-Grenze hinweg machte — einzeln war er grün.
```

<a id="teilesuche"></a>
## `teileSuche`

```text
Volltextsuche über Teilenummer, Name und BrickLink-Nummer.

EINE Formulierung für die drei Listen, die danach suchen: die Set-Teile aus
der Live-Abfrage (teileFilter), dieselben aus der vorberechneten
Zusammenfassung (tryPartsSummary) und die manuell erfassten (getManualParts).

── Warum zusammengelegt (NACHGEMESSEN) ─────────────────────────────────────

Die beiden Wege für die Set-Teile suchten VERSCHIEDEN: Die Zusammenfassung
sah in `bl_part_number` mit, die Live-Abfrage nicht. Welcher Weg antwortet,
entscheidet aber nicht der Mensch, sondern ob die Zusammenfassung frisch ist
(ensureFresh) — dieselbe Suche fand also je nach Tageszeit etwas anderes.
Beide Listen zeigen die BrickLink-Nummer an (blNummerSql), und wer sie auf
der Kachel liest, tippt sie auch ein.

ILIKE statt LOWER(...) LIKE: Dasselbe Ergebnis, aber ohne dass jeder
Aufrufer daran denken muss, auch den Suchtext kleinzuschreiben — genau
dieses Paar stand vorher in beiden Fassungen einmal so und einmal anders.

@param nummer    Spalte mit der Rebrickable-Teilenummer
@param name      Spalte mit dem Teilenamen (darf NULL sein)
@param blNummer  Ausdruck für die BrickLink-Nummer (blNummerSql oder Spalte)
@param pi        Nummer des Platzhalters; der Aufrufer schiebt `%text%` hinein
```

<a id="teilefilter"></a>
## `teileFilter`

```text
WHERE-Klausel und Parameter der Teileliste aus den Abfrageparametern.

── Warum eigenständig (Nachtrag 148) ───────────────────────────────────────
getParts() war 256 Zeilen und tat drei Dinge: Filter bauen, Abfragen
ausführen, und bei einem leeren Ergebnis auf Katalog bzw. Rebrickable
ausweichen. Der Filterteil ist der einzige davon, der ohne Datenbank
nachvollziehbar ist — er nimmt Werte entgegen und gibt eine Zeichenkette
zurück.

Die laufende Nummer `pi` kommt mit zurück, weil der Aufrufer LIMIT/OFFSET
danach anhängt.
```

<a id="teileersatzquelle"></a>
## `teileErsatzquelle`

```text
Teileliste EINES Sets, wenn der Nutzer selbst keine Zeilen dazu hat.

Zwei Ersatzquellen in dieser Reihenfolge: der eingespielte Rebrickable-CSV-
Katalog (lokal, kostet nichts) und erst danach die Rebrickable-API (zählt
auf das Tageskontingent). Geblättert wird hier nicht — die Menge ist durch
das Set begrenzt, page_size ist deshalb die Zeilenzahl.

Gibt null zurück, wenn auch dort nichts zu finden war; dann bleibt es beim
leeren Ergebnis aus der Datenbank.
```

<a id="teileersatzquelle-rbkey"></a>
## `rbKey`

```text
Rebrickable-Rückfallebene.

VORHER stand hier `require('../../routes/parts').fetchRebrickableParts` —
einen Namen, den routes/parts.ts NIE exportiert hat (die Exportliste am
Dateiende führt ihn nicht). Der Ausdruck war also `undefined(…)`, und
weil der TypeError SYNCHRON fliegt, fing ihn auch das `.catch(() => [])`
daneben nicht ab: Die Anfrage endete mit einem 500er statt mit einer
leeren Liste. Aufgefallen ist das nie, weil der Zweig nur greift, wenn
ein Set weder eigene Teile noch einen CSV-Eintrag hat.

Statt den Namen zu exportieren, geht der Weg jetzt über getAllSetParts()
in clients/rebrickable.ts. Die Funktion kann längst alles, was die
90-zeilige Zweitfassung nachbaute — und zwar besser: CSV zuerst,
Tageskontingent über consumeRebrickableDaily(), Drossel über den
Limiter, Antwort im subsets_cache. Die Zweitfassung holte ohne all das
und ist entfallen.
```

<a id="trypartssummary-countrow"></a>
## `countRow`

```text
── Scheitert die Abfrage, ist das ein RUECKFALL, kein Fehler ───────────

Marcos Befund vom 25.09.: Der Teile-Reiter antwortete mit 500,
„column storage does not exist". Die Spalte fehlte auf seiner laufenden
Datenbank (siehe db/migrations/0025-parts-summary-lagerort.sql) — und
damit war der ganze Reiter tot, obwohl es die Live-Abfrage zwanzig Zeilen
weiter unten noch gibt und sie dieselbe Antwort gegeben haette.

Das ist der Kern des Fehlers, nicht die fehlende Spalte: Diese Funktion
heisst `try…` und gibt sonst ueberall `null` zurueck, wenn die
Zusammenfassung nicht benutzbar ist — bei fehlender Frische, bei einem
Kategorie-Filter. Nur der Fall „die Tabelle sieht anders aus als erwartet"
fiel durch und riss die Anfrage mit.

Eine Zusammenfassung ist eine BESCHLEUNIGUNG. Wenn sie nicht geht, soll es
langsamer gehen, nicht gar nicht. Gemeldet wird es trotzdem: Ein stiller
Rueckfall verstecke, dass jede Anfrage jetzt den teuren Weg nimmt.
```

<a id="trypartssummary"></a>
## Abschnitt

```text
── is_spare als echter Wahrheitswert — wie im Live-Zweig ────────────────

Marcos Befund, mit der genauen Meldung aus der App:

    Expected valid boolean literal prefix, but had '0'
    at path: $.parts[0].is_spare     →   "is_spare":0

Die Teileliste der Android-App blieb LEER. Ein einziger solcher Wert
laesst die ganze Seite scheitern; das Kotlin-Modell fuehrt is_spare als
Boolean, und `coerceInputValues` faengt nur null, keinen Typwechsel.

Der Live-Zweig macht es seit jeher richtig (`istErsatzteil(p.is_spare)`,
getParts weiter unten) — parts_summary fuehrt die Spalte aber als INTEGER,
und hier ging sie ROH hinaus. Welcher Zweig antwortet, haengt allein davon
ab, ob die Zusammenfassung frisch ist: Ein neues Konto bekam den
Live-Zweig und korrektes JSON, ein gewachsenes den Zusammenfassungs-Zweig
und eine Zahl. Genau deshalb war der Fehler auf keiner Testinstallation zu
sehen und trat beim ersten Neuaufbau der Zusammenfassung ploetzlich auf.

Die Regel steht schon zwei Funktionen weiter unten, angewandt auf ein
anderes Feld: „Der JSON-Typ von total_quantity darf nicht vom Zweig
abhaengen." Genau das gilt fuer JEDES Feld — hier war es fuer eines
vergessen worden.
```

<a id="getparts-qtyexpr"></a>
## `qtyExpr`

```text
::int aus demselben Grund wie in getPartsColors (siehe Kommentar dort):
Der JSON-Typ von total_quantity darf nicht vom Zweig abhängen —
SUM(BIGINT) käme als Zahl, SUM(INTEGER) und die rohe BIGINT-Spalte als
Text. Haushalt, Einzelkonto und Live-Abfrage liefern jetzt dieselbe Form.
Die Set-Menge als Faktor, aus den Erfassungen (Migration 0036). Mit
set_number-Filter entfaellt der Faktor: Dort geht es um die Teile EINES
Sets, nicht um den Bestand.
Die Stückzahl der Bestandszeile stand als p.quantity hier; Migration
0038 hat die Spalte geloescht (teilmengeAus unterscheidet jetzt
Katalogzahl und Erfassungssumme).
```

<a id="getparts-katalogjoin"></a>
## `katalogJoin`

```text
── Die Beschreibung kommt aus den Katalogen (Migration 0034) ───────────

pc  je Teilenummer:          Name, Kategorie
pcc je Teilenummer + Farbe:  Farbbezeichnung, Farbcode, Bild
spc je Set + Teil + Farbe:   Ersatzteilkennzeichen

Alle drei ueber ihren Primaerschluessel verbunden, also hoechstens eine
Zeile je Treffer — die Gruppierung und damit die Gesamtzahl bleiben
unberuehrt. LEFT JOIN durchweg: Ein manuell erfasstes Teil hat keine
Set-Nummer und damit keine spc-Zeile, und ein Teil ohne Katalogzeile
soll in der Liste stehen, statt aus ihr zu fallen.
```

<a id="getparts-joinclause"></a>
## `joinClause`

```text
Ohne set_number-Filter haengt die Set-Menge mit dran (der Faktor in
qtyExpr). Mit Filter nicht: Dort geht es um die Teile EINES Sets.

Hier stand ein LEFT JOIN auf `sets` — er diente allein der Spalte
s.quantity, und die ist mit Migration 0036 weg.
blJoin() ist in BEIDEN Zweigen dabei, auch bei set_number: Der
Gruppierungsschluessel unten ist die BrickLink-Nummer, und die kommt
seit Migration 0037 aus bl_zuordnung. Ohne den Join gaebe es den Alias
blz nicht — ein harter Fehler, keine stille 500.
```

<a id="getparts-excludesmanual"></a>
## `excludesManual`

```text
Count for pagination.
Vorher COUNT(DISTINCT <concat>) — das baut pro Zeile einen String und
sortiert ihn anschliessend. COUNT(*) über dieselbe Gruppierung nutzt den
HashAggregate und ist bei 171'000 Zeilen gemessen rund 2,7× schneller
(176 ms → 65 ms).
── Schneller Weg: vorberechnete Zusammenfassung ───────────────────────
Sie deckt genau den Fall der Teileansicht ab (Set-Teile, gruppiert nach
Teil und Farbe). Der Filter set_number ist bewusst ausgenommen: Dort geht
es um die Teile EINES Sets, nicht um die Sammlung — dafür ist die
Live-Abfrage sowohl passend als auch schnell genug.
```

<a id="getparts-countsql"></a>
## `countSql`

```text
── Dieselben Joins wie die Hauptabfrage, nicht nur `FROM parts p` ──────

Hier stand `FROM parts p` allein. Die Filterbedingung kann aber auf lo
zeigen (?storage=) und seit Migration 0034 auch auf pc/pcc/spc — ohne die
Joins ist das ein harter Fehler, und der Aufruf antwortete mit 500.

GEMESSEN am Lagerortfilter, der schon vor dieser Aenderung so lief:
„missing FROM-clause entry for table lo". Siehe die Gegenprobe in
test/teile-katalogspalten-db.test.js.

Die zusaetzlichen Joins aendern die Zahl nicht: Jeder haengt am
Primaerschluessel seiner Tabelle, liefert also hoechstens eine Zeile.
```

<a id="getparts-usedsql"></a>
## `usedSql`

```text
── Angezeigter Zustand: nur noch aus den Erfassungen ───────────────────

Sobald eine Erfassung „Gebraucht" ist, gilt das Teil als gebraucht.

Hier stand daneben `MAX(p.condition) AS stored_condition` als Rueckfall
fuer Teile OHNE Erfassung. Die Spalte ist mit Migration 0035 weg, und der
Rueckfall war fuer Set-Teile ohnehin wirkungslos: parts.condition stand
bei ihnen seit jeher auf dem Vorgabewert 'N' und wurde nie geschrieben
(gemessen an allen Schreibwegen — beide fassen nur source='manual' an).
Fuer manuelle Teile garantiert Migration 0035 eine Erfassung.

Entfällt komplett, wenn manuelle Teile ohnehin ausgefiltert sind — dann
kann keine Zeile des Ergebnisses davon betroffen sein. Genau so ruft die
Teile-Seite den Endpunkt auf (exclude_manual=1).
```

<a id="getpartsstats-row"></a>
## `row`

```text
── Derselbe Filter wie in der Zusammenfassung, und warum er gefehlt hat ──

Der Kommentar oben sagt es schon: „Die Kennzahlen beziehen sich wie die
Liste auf Set-Teile; manuell erfasste haben ihren eigenen Bereich." Die
Zusammenfassung setzt das um (`COALESCE(p.source, 'set') <> 'manual'` in
src/teile/partsSummary.ts) — dieser Rückfall tat es nicht und zählte die
manuellen mit.

Damit gab es ZWEI Antworten auf dieselbe Frage, und welche man bekam,
hing davon ab, ob die Zusammenfassung gerade frisch war. Genau so ist es
aufgefallen: api-parity vergleicht denselben Endpunkt mit Sitzung und mit
Token; der erste Aufruf baute die Zusammenfassung, der zweite benutzte
sie — zwei verschiedene Zahlen, sporadisch, ohne erkennbaren Grund.
```

<a id="getmanualparts-filter"></a>
## `filter`

```text
── Der Suchtext wirkt auch hier (Marcos Befund vom 20.10.) ──────────────

„Wenn ich im Filter z.b. nach 3001 suche passiert nichts."

NACHGEMESSEN am laufenden Server: Nach der Eingabe standen dieselben zwei
Kacheln da wie vorher. Der Suchtext ging ueber partsParams() ausschliesslich
an die Set-Teile-Wand (mit exclude_manual=1); diese Liste kannte ihn nicht.

Dass er BEIDE Listen trifft, ist keine Auslegung: public/index.html stellt
die Filterleiste ueber den manuellen Bereich und begruendet es dort
ausdruecklich damit („Der Filter wirkt auf beide Listen"), und
test/tab-layout.test.js prueft diese Anordnung. Die Anordnung versprach
also etwas, das die Abfrage nicht hielt.

Gefiltert wird am SERVER, wie beim Konto- und Lagerortfilter daneben
(public/js/14-scope.js nennt den Grund) — nicht clientseitig im Cache.

Der Platzhalter kommt VOR LIMIT/OFFSET in die Liste: Die beiden haengen
sich hinten an und beziehen ihre Nummern aus params.length.
```

<a id="bestand-max-teile"></a>
## `BESTAND_MAX_TEILE`

```text
Wie viele der angefragten Teile im Blickfeld tatsächlich vorhanden sind.

── Wofür (Nachtrag 174, „Kann ich das bauen?") ─────────────────────────────

Die Teileliste eines Sets zeigt seit jeher eine Spalte „Habe" — bisher ein
leeres Zahlenfeld, in das man von Hand eintrug, was man schon besitzt. Die
BrickLink-Wunschliste zieht diese Zahl vom Bedarf ab. Das funktionierte,
nur musste man dafür seine eigene Sammlung im Kopf haben.

Diese Funktion füllt die Spalte. Sie speichert nichts und ändert nichts —
sie ist eine Frage an den bestehenden Bestand.

── Warum zwei Zahlen ───────────────────────────────────────────────────────

`gesamt` zählt alles, `lose` nur, was nicht in einem Set steckt
(source='manual'). Der Unterschied ist für die Antwort entscheidend: Ein
Teil, das in einem aufgebauten Set sitzt, besitzt man zwar, aber man müsste
dafür ein anderes Set zerlegen. Welche der beiden Zahlen gilt, entscheidet
der Mensch vor dem Bildschirm — deshalb liefert der Server beide, statt sich
für eine zu entscheiden.

── Warum POST und keine Liste im Pfad ──────────────────────────────────────

Gefragt wird nach den Teilen EINER Teileliste; ein grosses Set hat weit über
tausend Teil-Farb-Paare. Als Abfrageparameter gäbe das eine Adresse, die
jeder Proxy abschneidet.
```

<a id="getownedquantities-rows"></a>
## `rows`

```text
Ersatzteile zählen MIT: Ein Ersatzteil, das dem Set beilag, liegt in der
Schachtel und lässt sich verbauen. Die Bedarfsseite schliesst sie aus
(parts-list), die Bestandsseite nicht — das ist kein Widerspruch, sondern
genau der Unterschied zwischen „braucht man" und „hat man".

── Die STÜCKZAHL des Sets zählt mit (Marcos Befund) ──────────────────────

„Ich besitze das Set 2x wie kann es dann sein, dass Teile fehlen?"

Weil hier `SUM(p.quantity)` stand — die Menge aus EINEM Bausatz. Der
Teile-Import legt je (user_id, set_number) genau einen Satz Zeilen ab
(utils/partsImport.ts: DELETE, dann INSERT mit `part.quantity`); wie oft
jemand das Set besitzt, steht ausschliesslich in `sets.quantity`. Diese
Zahl kam im Abgleich nirgends vor. Wer ein Set zweimal hatte, sah den
Inhalt von einem.

Der LEFT JOIN multipliziert sie hinein. Er ist LEFT und nicht INNER, weil
`parts` Zeilen ohne passendes Set enthalten kann: manuell erfasste Teile
haben gar keine set_number, und eine Zeile, deren Set später gelöscht
wurde, hätte sonst den ganzen Posten aus der Antwort geworfen.
Die Set-Menge kommt seit Migration 0036 aus den Erfassungen; mengeAus()
mit `fehlt = 1` heisst dann „einmal" — dieselbe Rechnung wie vorher mit
COALESCE(s.quantity, 1).

`lose` bleibt unberührt: Manuell erfasste Teile hängen an keinem Set, und
eine Stückzahl gibt es dort nicht zu multiplizieren.
```

<a id="getownedquantities-figrows"></a>
## `figRows`

```text
── Minifiguren zaehlen mit (Marcos „die Teile sollten in meinem Bestand
   liegen") ──────────────────────────────────────────────────────────────

Eine Teileliste enthaelt nicht nur Teile: Der Zusammenbau (08-init.js,
plGenerate) haengt jede Minifigur des Sets als eigene Zeile an, mit der
FIGURENNUMMER als `part_number` und Farbe 0. Gefragt wurde damit hier —
und `parts` kennt keine Figuren. Jede Minifigur einer Liste galt deshalb
IMMER als fehlend, auch wenn sie im Bestand stand. Stillschweigend, denn
„nicht gefunden" sieht aus wie „habe ich nicht".

Verwechseln kann sich dabei nichts: Figurennummern (trn241, sw0123) und
Teilenummern (3001) kommen aus verschiedenen Nummernkreisen, und die
Anfrage schickt fuer eine Figur ohnehin Farbe 0. Sollte eine Nummer doch
einmal in beiden Tabellen stehen, gewinnt das TEIL — deshalb steht diese
Schleife hinter der oberen und ueberschreibt nichts.

`lose` ist bei Figuren dasselbe wie bei Teilen: was nicht in einem Set
steckt, also source='manual'.
```
