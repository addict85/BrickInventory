# Begründungen zu `src/katalog/katalogPflege.ts`

Die ausführlichen Kommentare aus `src/katalog/katalogPflege.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="merketeil"></a>
## `merkeTeil`

```text
Teile- und Figurenkatalog — schreiben, und seit dem 20.10. auch LESEN.

Das Lesen ist hier dazugekommen, weil es dieselbe Frage von der anderen
Seite ist: Wer Bestand anlegt, muss die Beschreibung mitschreiben — und
sollte vorher nachsehen, ob sie nicht schon dasteht. Die Begruendung steht
bei katalogTeil() am Dateiende.

── Warum eine eigene Stelle (Migration 0034) ───────────────────────────────

Mit Migration 0034 tragen `parts` und `minifigs` nur noch den BESTAND: wer
welches Teil in welcher Farbe aus welchem Set hat. Die BESCHREIBUNG — Name,
Farbbezeichnung, Farbcode, Kategorie, Bild — gilt fuer alle Konten und steht
in `part_catalog`, `part_color_catalog` und `minifigs_catalog`.

Jeder Weg, der Bestand anlegt, muss die Beschreibung also mitschreiben. Das
sind SECHS Stellen (gezaehlt): Anlegen von Hand und CSV-Import fuer Teile,
dieselben beiden fuer Figuren, und zweimal das Verschieben eines Sets in
src/sets/setMove.ts. Dazu die beiden Importe aus Rebrickable.

Derselbe Upsert sechsmal hingeschrieben heisst: sechs Stellen, an denen er
beim naechsten Mal leicht anders aussieht. Genau so ist in diesem Baum schon
`is_spare` an sechs Stellen in vier Lesarten zerfallen (src/infra/validate.ts).

── Die Regel: der Katalog gewinnt NICHT gegen sich selbst ──────────────────

COALESCE steht ueberall auf der SPALTE, nicht auf EXCLUDED: Was im Katalog
steht, bleibt stehen; nur Leerstellen werden gefuellt. Ein manuell
erfasstes Teil ueberschreibt damit keinen Namen aus dem Set-Import, und ein
CSV-Import mit halben Angaben macht keinen vollstaendigen Eintrag kaputt.

NULLIF(..., '') statt nur COALESCE: Eine leere Zeichenkette ist kein Name.
Ohne das Ausleeren haette der erste Schreiber mit `''` den Platz besetzt und
jeder spaetere, echte Name waere daran vorbeigelaufen.
```

<a id="katalogteil"></a>
## `KatalogTeil`

```text
Was der EIGENE Katalog ueber ein Teil weiss — Name, Kategorie, Bild.

── Marcos Frage vom 20.10. ─────────────────────────────────────────────────

  „Wieso ist der Import so langsam? Wird jedes Teil bei Rebrickable
   abgefragt auch wenn es lokal bereits vorhanden ist, resp. das Mapping
   vorhanden ist?"

Fuers MAPPING lautete die Antwort nein: loeseLokalAuf() in
src/merkliste/wantedListe.ts loest zuerst lokal auf und fragt nur die offenen
Nummern nach. Fuer Name und Bild lautete sie JA, und zwar GEMESSEN am
laufenden Server: addManualPartIntern() fragte lookupPart(), sobald kein
Name mitkam — auch bei Teil 3001 in Farbe 4, das mit Namen UND Farbbild im
Katalog stand. Jeder Abruf geht durch die Hintergrunddrossel, eine Anfrage
je 1,5 Sekunden (src/katalog/rateLimiter.ts), und lookupPart macht zwei: das Teil
und das Farbbild. Bei 224 Posten sind das elf Minuten Warten und 448
Abrufe aus dem Tageskontingent — fuer Daten, die dalagen.

Die Regel dort hiess „kein Name mitgegeben ⇒ fremden Dienst fragen". Richtig
ist „⇒ erst den eigenen Katalog fragen". Genau diese Staffelung stand
nebenan schon einmal, fuer das Bild allein (bildNachtragen in
src/teile/teilFarbeAendern.ts: set_parts_catalog vor Rebrickable) — sie holt sie
jetzt von hier, damit es bei EINER Fassung bleibt.

── Was als „Bild vorhanden" gilt, und was nicht ────────────────────────────

Nur FARBRICHTIGE Quellen: `part_color_catalog` und `set_parts_catalog`
fuehren das Bild je Teil UND Farbe. `rb_parts.part_img_url` ist das
ALLGEMEINE Teilebild — bei vielen Teilen die weisse Fassung. Es als Treffer
zu zaehlen hiesse, den Farb-Abruf zu sparen und dafuer das falsche Bild zu
behalten. Gespart werden soll der UEBERFLUESSIGE Abruf, nicht der noetige.

Ohne angegebene Farbe (`colorId` null) gibt es keine farbrichtige
Erwartung — lookupPart holt dann selbst nur das allgemeine Bild. Deshalb
zaehlt es in diesem Fall. Die beiden Farb-Joins greifen dabei von sich aus
nicht: `color_id = NULL` ist nie wahr.
```

<a id="katalogteil-2"></a>
## Abschnitt

```text
Woher das Bild stammt, und die Datei dazu.

Beide stehen hier fuer bildNachtragen() in src/teile/teilFarbeAendern.ts: Es
unterscheidet, ob das Bild schon an der Farbe steht (dann ist nichts zu
tun) oder aus einem eingespielten Set kommt (dann traegt es es nach) —
und dabei SCHREIBT es `image_local` mit, denn eine bereits
heruntergeladene Datei ist der bessere Wert.

Sie sind der Preis dafuer, dass die Quellenreihenfolge nur EINMAL
dasteht. Sie zweimal zu fuehren waere der bequemere Weg und genau der,
an dem in diesem Baum schon mehrfach zwei Fassungen auseinandergelaufen
sind.
```
