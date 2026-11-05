# Begründungen zu `test/katalog-vor-rebrickable-db.test.js`

Die ausführlichen Kommentare aus `test/katalog-vor-rebrickable-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der eigene Katalog wird VOR Rebrickable gefragt.

── Marcos Frage vom 20.10. ─────────────────────────────────────────────────

  „Wieso ist der Import so langsam? Wird jedes Teil bei Rebrickable
   abgefragt auch wenn es lokal bereits vorhanden ist, resp. das Mapping
   vorhanden ist?"

Fuers MAPPING lautete die Antwort nein: loeseLokalAuf() in
src/merkliste/wantedListe.ts loest zuerst lokal auf und fragt nur die offenen
Nummern nach (geprueft in test/wanted-liste-db.test.js).

Fuer Name und Bild lautete sie JA. GEMESSEN am laufenden Server, mit einem
Zaehler auf https.get, beim Anlegen von Teil 3001 in Farbe 4 — Name UND
Farbbild standen im Katalog:

    → get rebrickable.com/api/v3/lego/parts/?part_nums=3001&page_size=1
    Dauer: 1475 ms   (davon ~1,5 s Drosselwarten)

lookupPart() macht im Betrieb ZWEI Abrufe (das Teil, dann das Farbbild),
jeder durch die Hintergrunddrossel mit 1,5 Sekunden Abstand
(src/katalog/rateLimiter.ts). Bei einer Wanted-Liste mit 224 Posten sind das elf
Minuten Warten und 448 Abrufe aus dem Tageskontingent — fuer Daten, die
dalagen. Nach der Aenderung: 0 Abrufe, 49 ms.

── Warum die Pruefung HIER steht und nicht am Import ───────────────────────

Die Luecke war nicht im Import. Sie war in addManualPartIntern() und
addManualFigIntern(), deren Regel „kein Name mitgegeben ⇒ fremden Dienst
fragen" hiess. Der Import war nur der Auffaellige, weil er 224 Posten ohne
Namen hereinschiebt; dieselbe Luecke hat jeder andere Weg, der ohne Namen
hereinkommt — POST /api/v1/parts etwa.

── Was als „Bild vorhanden" gilt ───────────────────────────────────────────

Nur FARBRICHTIGE Quellen (part_color_catalog, set_parts_catalog). Das
allgemeine Teilebild aus rb_parts ist bei vielen Teilen die weisse Fassung;
es als Treffer zu zaehlen hiesse, den Farb-Abruf zu sparen und das falsche
Bild zu behalten. Der Fall „Name ja, Farbbild nein" steht deshalb unten und
MUSS abrufen.
```
