# Begründungen zu `test/wanted-liste-vorschau-db.test.js`

Die ausführlichen Kommentare aus `test/wanted-liste-vorschau-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Vorschau VOR dem Import — mit Bild, Farbe, Bezeichnung und Korrekturen.

── Marcos Vorgabe ──────────────────────────────────────────────────────────

  „noch besser wäre wenn es beim Import die zu importierende Liste
   vorgängig anzeigen wurde analog der Teileliste mit Bild, Farbe,
   Bezeichnung und ich dort noch Korrekturen vornehmen kann oder z.b.
   rebrickable ids ergänzen könnte"

── Was hier geprüft wird ───────────────────────────────────────────────────

Drei Dinge, und alle drei haben ihren eigenen Weg, lautlos falsch zu sein:

  1. Die BESCHREIBUNG. Eine Vorschau, die nur Nummern zeigt, ist keine —
     und sie darf nichts erfinden. Was der Katalog nicht kennt, bleibt leer.
  2. Die KORREKTUREN. Sie müssen den richtigen Posten treffen. Eine Liste
     darf denselben Posten zweimal enthalten; ein Schlüssel aus Nummer und
     Farbe träfe dann beide, und die Korrektur landete auf der falschen.
  3. Was gemerkt wird. Eine von Hand eingetragene Nummer soll beim nächsten
     Import dastehen — aber nur sie, nicht ein Katalogtreffer: Der ist eine
     VERMUTUNG, und ihn als Zuordnung einzutragen würde sie zur Abbildung
     befördern, ohne dass jemand nachgesehen hat.
```

<a id="item"></a>
## `function item(typ, id, farbe, menge = 1, zustand = 'X') {`

```text
`zustand` seit dem 20.10. — vorher stand hier fest `X`.

Es gibt einen Zwilling dieses Helfers in test/wanted-liste-db.test.js, der
zusaetzlich MAXPRICE kann. Die beiden sind NICHT zusammengelegt: Das waere
eine Aenderung an einem gruenen Test ohne Gewinn fuer die Sache hier. Wer
einen dritten braucht, legt sie besser zusammen, statt einen dritten zu
schreiben.

`null` laesst CONDITION ganz weg — das ist der Fall „die Datei sagt nichts",
und er ist ein anderer als `X` („egal"), auch wenn beide zum Standard des
Kontos fuehren.
```

<a id="b-stelle"></a>
## `const b = await importiereWantedListe(1, xml, { vorschau: true });`

```text
`vorschau: true` steht AUSDRÜCKLICH da. Die Vorgabe dieser Funktion ist
SCHREIBEN (`vorschau: !!opt.vorschau`), und das ist richtig so: Wer sie
ruft, hat einen Anleger dabei. Die Entscheidung „Vorschau oder Ernst"
trifft die Route aus `?schreiben=1` — nicht ein Vorgabewert hier.

Dieser Test hat die Vorgabe zuerst falsch geraten und wurde deshalb rot.
Das war nützlich: Fall 6 unten war vorher aus dem falschen Grund grün
(ohne Anleger scheitert das Schreiben, und der Rückruf wird nie
erreicht) — er hätte eine Vorschau, die sehr wohl schreibt, nicht
gemeldet.
```

<a id="stelle"></a>
## `assert.equal(nach.get('3002').ausgang, 'offen',`

```text
3002 steht NUR in rb_parts (dem CSV-Abgleich), nicht in part_catalog.
Die Auflösung lässt es deshalb OFFEN — Stufe 3 liest part_catalog, und
das soll sie: Sie ist eine Vermutung, und sie auf die 50 000 Zeilen von
rb_parts auszuweiten hiesse, viel mehr Posten auf eine Vermutung hin
anzulegen. Gemessen: `rbId: null, sicherheit: null`.

Die BESCHREIBUNG kommt trotzdem — unter der BrickLink-Nummer, und als
solche gekennzeichnet. Genau das braucht Marco zum Entscheiden: „9999 —
(nichts bekannt)" lässt ihn raten, „3002 — Brick 2 x 2, Name unter der
BL-Nummer gefunden" zeigt ihm, worum es geht.
```

<a id="ohne"></a>
## `const ohne = await importiereWantedListe(1, liste(item('P', '3001', 5,`

```text
── Marcos Bitte vom 20.10. ─────────────────────────────────────────────

  „ja, bitte die Zustandsspalte noch in die Vorschau"

Je Posten steht der Zustand AUS DER DATEI, und der ist bei CONDITION=X
und bei fehlender Angabe null. Angelegt wird dann der Standard des
Kontos — die Vorschau soll zeigen, was ANGELEGT wird.

Der Standard gehoert an den BERICHT, nicht an den Posten: Er ist je
Konto derselbe, und 224-mal dieselbe Zeichenkette waere eine Abschrift.
Und er kommt vom SERVER, nicht aus dem Browser — dort steht er nirgends
verlaesslich, und ein geratener Zustand in einer Vorschau waere genau
die Sorte Behauptung, die hier schon einmal falsch war.
```

<a id="gemerkt"></a>
## `const gemerkt = [];`

```text
── Marcos Frage vom 20.10. ─────────────────────────────────────────────

  „wenn das gleiche xml-File 2x importiere sollte der 2. Lauf massiv
   schneller sein korrekt?" … „Wieso wird das Mapping BL zu Rebr. nicht
   gespeichert?"

Die Regel merkte nur 'korrigiert', begruendet damit, die anderen Stufen
kaemen „schon von dort oder aus dem Katalog". Das trifft auf
'rebrickable' nicht zu: Sie steht nirgends, und sie ist nicht geraten
(blTeilZuRb prueft jeden Treffer gegen external_ids.BrickLink). Die
Stufe war beim Aufzaehlen unter „die anderen" gefallen.

Fall 5 allein haette das nie gemeldet — dort kommt die Stufe gar nicht
vor. Genau deshalb steht dieser Fall daneben und nicht darin.
```

<a id="echt"></a>
## `const echt = db.pool.query.bind(db.pool);`

```text
Marcos Datei hat 224 Zeilen. Eine Abfrage je Zeile wäre eine Vorschau,
auf die man wartet.

── Gemessen an pool.query, NICHT an db.all (und das ist tragend) ──────

Der erste Entwurf überschrieb `db.all` am Modulobjekt — und war
GEMESSEN wirkungslos: Mit 60 zusätzlichen Abfragen je Posten blieb er
grün (`pass 9 / fail 0`). Der Grund steckt im Bündler: esbuild macht
aus `import * as db from '../db/database'` ein
`__toESM(require(...))`, und das KOPIERT die Eigenschaften in ein neues
Objekt. Die Funktion in src/merkliste/wantedListe.ts ruft also ihre eigene
Kopie von `all`, nicht die hier ersetzte.

`pool` ist dagegen ein Objekt, und die Kopie trägt dieselbe Referenz —
ein Ersatz an `pool.query` ist auf beiden Seiten derselbe. Er zählt
ausserdem das Richtigere: wirklich abgeschickte SQL-Anweisungen.
```

<a id="anleger"></a>
## `const anleger = {`

```text
── Marcos Befund vom 21.10. ────────────────────────────────────────────

  „Nach dem XML-Import verschwinden die Bilder im Importdialog. vor und
   während dem Import sind diese sichtbar."

beschreibePosten() wurde nur für die Vorschau gerufen, begründet mit
„Beim echten Import sieht sie niemand". Der Dialog bleibt aber offen
und zeichnet dieselbe Tabelle mit der ANTWORT neu — auf Marcos
Bildschirmfoto sind Bild UND Name über alle 24 Zeilen leer.

GEMESSEN vor der Änderung:
    VORSCHAU   : {"name":"Brick 2 x 4","bild":"https://…/3001-rot.png"}
    NACH IMPORT: {}
```

<a id="stelle-2"></a>
## `await db.run('INSERT INTO part_catalog (part_number, part_name)`

```text
Der Gewinn daraus, dass beschreibePosten NACH der Schleife läuft: Ein
Teil, dessen Farbbild der Katalog noch nicht hatte, bekommt es beim
Anlegen (addManualPart → lookupPart → merkeTeilFarbe). Ein Aufruf VOR
der Schleife zeigte für genau diese Posten nichts.

7777 steht im part_catalog (also auflösbar, Stufe 3), hat aber keine
Zeile in part_color_catalog. Ohne Katalogeintrag wäre es NICHT der
Fall: Es bliebe 'offen' und würde nie angelegt — erst gemessen, dann
gemerkt.
```
