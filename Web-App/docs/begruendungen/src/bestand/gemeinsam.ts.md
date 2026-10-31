# Begründungen zu `src/bestand/gemeinsam.ts`

Die ausführlichen Kommentare aus `src/bestand/gemeinsam.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Was alle drei Domänen brauchen: Seitengrössen, Zustandsableitung aus
Erfassungen, Besitzer-Anreicherung.

── Warum aufgeteilt (Nachtrag 133) ────────────────────────────────────────
utils/handlers.ts fasste Sets, Teile und Minifiguren in 1313 Zeilen zusammen
— benannt nach seiner Rolle („handlers"), nicht nach seinem Inhalt, wie
zuvor schon js/07-admin.js. Die drei Domänen berühren sich kaum: Nur
getSets() liest Teile, und die Minifiguren-Kennzahlen lesen Sets. Beides
geht in EINE Richtung, es entsteht also kein Kreis.
```

<a id="max-page-size"></a>
## `MAX_PAGE_SIZE`

```text
Obergrenze für page_size — je Anfrage, unabhängig vom Abfrageweg.

── Woher die Zahl steht ────────────────────────────────────────────────────
Der Wert stand fünfmal als Literal im Code, und eine sechste Stelle hatte ihn
gar nicht: tryPartsSummary() reichte page_size ungeprüft ins LIMIT durch,
während die Live-Abfrage direkt daneben bei 500 deckelte. DIESELBE Anfrage
lieferte damit unterschiedlich viele Zeilen, je nachdem ob die
Zusammenfassung gerade frisch war — nachgestellt an 5000 Teilen mit
page_size=100000: 500 Zeilen über die Live-Abfrage, 5000 über die
Zusammenfassung. Ein Unterschied, der vom Cache-Zustand abhängt, ist beim
Suchen eines Fehlers das Letzte, was man vermutet.

Als Konstante, damit die nächste Seitenabfrage sie nicht wieder vergisst.
```

<a id="unpaged-limit"></a>
## `UNPAGED_LIMIT`

```text
Obergrenze, wenn ein Aufrufer GAR KEIN page_size schickt.

Ohne Grenze liefert die Teile- und die Set-Liste den kompletten Bestand in
einer Antwort — bei 800 Sets sind das rund 270 KB, bei einer grossen
Teilesammlung ein Vielfaches, und alles davon liegt gleichzeitig im Speicher
des Workers und im Speicher des Clients.

Beide echten Clients blättern längst (Webapp: PARTS_PAGE_SIZE in
public/js/03-parts.js, Android: page_size=500 mit onLoadMore) — die Grenze
hier trifft sie nicht. Sie fängt den Fall ab, dass ein Aufrufer das
Blättern vergisst: Statt der ganzen Tabelle bekommt er die erste Seite, und
`total` in derselben Antwort sagt ihm, dass es mehr gibt.
```

<a id="set-parts-max-page-size"></a>
## `SET_PARTS_MAX_PAGE_SIZE`

```text
Obergrenze für die Teileliste EINES Sets (Filter set_number).

── Warum die normale Grenze hier zu klein ist ──────────────────────────────
Die Android-Set-Detailansicht fragt `page_size=2000` und holt NUR Seite 1.
clampPageSize deckelte das auf MAX_PAGE_SIZE = 500 — am laufenden Server
nachgestellt mit einem Set aus 915 Teilezeilen:

  geliefert 500 von total 915, page_size (gemeldet) 2000

Die App zeigte also gut die Hälfte der Teile, und die gemeldete
Seitengrösse behauptete, es seien alle angefragt worden. Auch die
PDF-Teileliste baut auf dieser Antwort auf.

Ein Set ist eine begrenzte Menge — die grössten liegen bei rund 12 000
Teilen, nach Farbe gruppiert deutlich darunter. 5000 Zeilen sind hier also
eine Grenze gegen Unfug, keine Portionierung. Für die allgemeine Teileliste
(ohne set_number) bleibt es bei MAX_PAGE_SIZE; dort blättern beide Clients.
```

<a id="zaehlwert"></a>
## `Zaehlwert`

```text
Eine Anzahl, wie sie aus der Datenbank kommt.

NACHGEMESSEN, nicht angenommen: `COUNT(*)` ist in Postgres `bigint`, und der
pg-Treiber gibt bigint als ZEICHENKETTE zurueck ("0"), damit keine
Genauigkeit verlorengeht. Auch `COALESCE(count, 0)` bleibt bigint. Andere
Aufrufer reichen bereits mit parseInt normalisierte Zahlen herein, und
fehlende Zeilen ergeben null — deshalb alle drei Formen.
```

<a id="conditionfromacquisitions"></a>
## `conditionFromAcquisitions`

```text
DIE Zustandsregel — für Sets, manuelle Teile und manuelle Minifiguren.

Sobald EINE Erfassung gebraucht ist, gilt der Eintrag als gebraucht. Gibt es
Erfassungen, aber keine gebrauchte, ist er neu. Ohne Erfassungen zählt der
gespeicherte Wert.

Steht bewusst an genau einer Stelle: Sie war früher in getSets() und getSet()
doppelt ausformuliert und lief dadurch auseinander. Ein Test hält fest, dass
`usedCount > 0 ? 'U'` im Code nur einmal vorkommt.
```

<a id="conditionfromacquisitions-acq"></a>
## `acq`

```text
parseInt wie in der Schwesterfunktion unten. Vorher stand hier
`usedCount > 0` — das ging nur ueber die JS-Umwandlung gut, weil COUNT(*)
als "2" ankommt. Nachgemessen und gleichwertig fuer alles, was hier
ankommt: "2"/2 -> wahr, "0"/0/null/undefined -> falsch. Der Typ hat die
Stelle sichtbar gemacht; verlassen wollen wir uns auf die Umwandlung nicht.

── Der Parameter `stored` ist weg, und zwar genau jetzt ────────────────

Hier stand ein dritter Parameter fuer den gespeicherten Zustand der
Stammzeile, mit der Begruendung: „`parts` und `minifigs` haben ihre
Spalte noch … er faellt mit ihnen, nicht vorher."

Mit Migration 0035 fallen sie. Fuer manuelle Positionen traegt die
Migration eine Erfassung nach und prueft danach, dass keine ohne
geblieben ist — der Rueckfall hat also kein Ziel mehr. Fuer Set-Teile war
er ohnehin wirkungslos: parts.condition stand bei ihnen seit jeher auf
dem Vorgabewert 'N' und wurde nie geschrieben.
```

<a id="conditionsfromacquisitions"></a>
## `conditionsFromAcquisitions`

```text
WELCHE Zustände hat der Eintrag — für die Plaketten auf der Kachel.

conditionFromAcquisitions() oben beantwortet „gilt das Ganze als gebraucht?"
und muss dafür einen einzelnen Wert liefern. Auf der Kachel ist das zu wenig:
Wer ein Exemplar neu und eines gebraucht gekauft hat, sah bisher nur
„Gebraucht" — die Neu-Erfassung war unsichtbar, obwohl sie mit ihrem eigenen
Preis in die Bewertung eingeht.

Beide Funktionen stehen bewusst nebeneinander an dieser einen Stelle: Sie
müssen zusammenpassen, und getrennt gepflegt liefen sie in diesem Projekt
schon einmal auseinander.

Reihenfolge immer Neu vor Gebraucht — nicht nach Häufigkeit, sonst tauschen
die Plaketten beim nächsten Kauf die Plätze.
```

<a id="abschnitt-2"></a>
## Abschnitt

```text
Angezeigter Zustand manuell erfasster Teile und Minifiguren.

Dieselbe Regel wie bei Sets (getSetConditionAggregate): Sobald EINE Erfassung
gebraucht ist, gilt der Eintrag als gebraucht. Gibt es Erfassungen, aber
keine gebrauchte, ist er neu. Ohne Erfassungen gilt „Neu" — einen
gespeicherten Wert gibt es seit Migration 0035 nicht mehr.

Vorher lasen beide Funktionen nur die Stammtabelle. Wurden Kaufpreise
ausschliesslich mit „Gebraucht" erfasst, stand auf der Kachel trotzdem „Neu",
weil parts.condition beim Anlegen auf dem Vorgabewert stehen blieb.

Eine Abfrage für die ganze Seite statt eine je Zeile.

@param {'part'|'fig'} kind
```

<a id="abschnitt-3"></a>
## Abschnitt

```text
Besitzer-Namen an Zeilen hängen, die eine `user_id` tragen.

Nur im Haushalt: Im Einzelkonto stünde an jedem Eintrag „gehört mir", und
das ist Rauschen. Eine Abfrage für die ganze Liste, nicht eine je Zeile.

Anders als bei Sets wird bei manuell erfassten Teilen und Minifiguren NICHT
verdichtet: Zwei Konten mit demselben Teil sind zwei Bestände mit eigener
Menge und eigenem Kaufpreis, und der Bearbeiten-Weg (Menge, Preis, Löschen)
führt immer auf genau eine Zeile. Sie zusammenzufalten hiesse, für jede
Änderung wieder auseinanderzunehmen, wem was gehört. Die Plakette macht
sichtbar, warum dasselbe Teil zweimal erscheint.
```

<a id="withowners"></a>
## `withOwners`

```text
Besitzer-Plaketten anhaengen — fuer EINZELNE Zeilen (`user_id`) und fuer
GRUPPIERTE (`owner_ids`).

── Warum beide Formen hier ─────────────────────────────────────────────────
Die Namensauflösung stand zweimal: hier fuer die ungruppierten Listen und in
getSets() noch einmal, weil die Galerie im Haushalt nach set_number
gruppiert und die Zeile deshalb MEHRERE Besitzer hat. Eine dritte Kopie
waere faellig geworden, als die Set-Figuren dieselbe Plakette bekamen —
`array_agg(DISTINCT user_id)`, dieselbe Auflösung, dieselbe Form.

Deshalb kennt der Helfer jetzt beide Eingaben. Zeilen, die weder das eine
noch das andere Feld tragen (die gruppierte Teileliste), bleiben unberuehrt
— sonst stuende dort ploetzlich ein leeres `owners`.
```

<a id="verwendendesset"></a>
## `VerwendendesSet`

```text
In welchen Sets steckt dieses Teil / diese Figur?

── Marcos Wunsch ───────────────────────────────────────────────────────────
„Es soll angezeigt werden, welche Sets dieses Teil und Minifigur verwenden.
Inkl. mit Link, um den Detail-Dialog des Sets öffnen zu können."

── Warum EINE Funktion für beide ───────────────────────────────────────────
Die Frage ist zweimal dieselbe, nur die Tabelle und der Schlüssel wechseln:
`parts` wird über Teilenummer UND Farbe angesprochen, `minifigs` über die
Figurennummer. Alles andere — Blickfeld, Zusammenzählen je Set, Verbinden
mit der Set-Zeile für Name und Bild — ist Wort für Wort gleich.

In diesem Projekt ist genau das schon mehrfach schiefgegangen: dieselbe
Regel an zwei Stellen, eine davon gepflegt. Deshalb hier einmal.

── Warum die automatisch erfassten Zeilen ──────────────────────────────────
`parts.set_number` steht in jeder Zeile, die aus dem Inventar eines Sets
stammt (`source = 'set'`). Manuell erfasste Positionen haben dort NULL —
`set_number IS NOT NULL` trennt die beiden, ohne sich auf `source` zu
verlassen. Das ist wichtig, weil eine Zeile mit Set-Nummer auch dann
dorthin gehört, wenn `source` einmal anders gesetzt wurde.
```

<a id="bestandteilkopf"></a>
## Abschnitt

```text
Lagerort — verdichtet über alle Zeilen dieses Teils.

`string_agg` statt eines stellvertretenden Werts: Dasselbe Teil steckt in
mehreren Sets und kann in mehreren Kisten liegen. Ein einzelner Wert
zeigte eine davon und verschwiege die andere, so dass es wie eine
vollständige Antwort aussieht. Figuren führen hier NULL — sie stecken in
ihrem Set, und dessen Ort steht im Set-Detail.
```

<a id="bestandteilkopf-2"></a>
## Abschnitt

```text
Wem dieses Teil gehört — die Konten, in deren Sets es steckt.

── Wozu ────────────────────────────────────────────────────────────────

Für die Lagerort-Auswahl im Dialog. Marcos Regel: „Der Grossvater soll
die Werte der Enkel für die entsprechenden Sets sehen und wählen
können." Ohne diese Liste zeigte der Teil-Dialog als einziger Ort im
Baum die EIGENE Auswahl statt der des Besitzers — nicht aus Absicht,
sondern weil der Kopf die Besitzer nicht kannte.

Sie kostet nichts: Die Zeilen darunter tragen `owner_user_id` längst,
hier werden sie nur verdichtet. Eine zweite Abfrage wäre eine zweite
Wahrheit.

MEHRERE, nicht einer: Dasselbe Teil steckt in mehreren Sets, und die
können verschiedenen Konten gehören. Einen davon auszuwählen hiesse
raten.
```

<a id="katalogjoin"></a>
## `KATALOGJOIN`

```text
Die Katalog-JOINs je Tabelle.

Seit Migration 0034 steht die Beschreibung nicht mehr an der Bestandszeile:
Name und Kategorie in part_catalog, Farbbezeichnung/Farbcode/Bild in
part_color_catalog, das Ersatzteilkennzeichen in set_parts_catalog, und bei
den Figuren alles in minifigs_catalog.

Alle ueber ihren Primaerschluessel verbunden, also hoechstens eine Zeile je
Treffer — die Gruppierung bleibt unberuehrt.

Dass das hier gebraucht wird, ist nicht aufgefallen, weil die Abfrage unten
ein `.catch(() => [])` traegt: Aus „column x.part_name does not exist" wurde
eine LEERE LISTE. GEMESSEN an test/verwendende-sets-db.test.js — „Erwartet
drei Sets in Nummernfolge, bekam []".
```

<a id="loeschemanuellesteil"></a>
## `loescheManuellesTeil`

```text
Die manuell erfasste Stammzeile eines Teils bzw. einer Figur entfernen.

Stand je zweimal da — einmal in der Loeschroute, einmal im Aufraeumen der
Erfassungen (routes/api_v1/acquisitions.ts). NACHGEMESSEN ueber HTTP,
dasselbe Teil mit zwei Erfassungen ueber beide Wege: Beide hinterlassen
parts=0, erfassungen=0 — kein Unterschied. Zusammengelegt wird trotzdem,
damit die Bedingung `source='manual'` (Teile AUS SETS haengen am Set und
werden mit ihm geloescht) an einer Stelle steht.

@param dbh Transaktionsgriff, wo einer gebraucht wird
```
