# Begründungen zu `test/alarm-uebersicht-db.test.js`

Die ausführlichen Kommentare aus `test/alarm-uebersicht-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Alle Preisalarme an EINEM Ort — und dort änderbar und löschbar.

── Marcos Frage vom 25.09. ─────────────────────────────────────────────────

  „Wie finde ich alle Preisalarme?"

Gar nicht, war die Antwort: Es gab nur die Route zu EINEM Set. Man sah einen
Alarm also nur, wenn man das Set schon gefunden hatte. Wer fünfzig setzt, hat
keinen Ort, an dem sie zusammen stehen, und keinen, an dem er sieht, welche
noch scharf sind. Ein Alarm, den man nicht wiederfindet, lässt sich weder
prüfen noch abstellen.

Marcos Auftrag: „Baue die Übersicht in beiden Apps in den Einstellungen als
Rubrik. Ich möchte dort den Alarm direkt löschen können oder den Wert
anpassen können."

── Warum dieser Test die Datenbank anfasst ─────────────────────────────────

Die Aussage, auf die es ankommt, ist nicht „es gibt eine Route", sondern
„sie liefert MEINE Alarme, alle, mit Namen — und keine fremden". Das ist
eine Frage an die Abfrage, nicht an den Quelltext: Ein vergessenes
`user_id = $1` sieht im Text harmlos aus und ist der ganze Fehler.

Voraussetzung: Test-DB. Ohne DB: skip (mit REQUIRE_DB=1: Fehler).
```

<a id="stelle"></a>
## `await db.run('INSERT INTO sets (user_id, set_number)`

```text
Dasselbe Set liegt ZUSÄTZLICH in meiner Sammlung — nur dann gibt es einen
Detaildialog, und nur dann gibt es das heruntergeladene Bild.

Das BILD steht seit Migration 0033 im Katalog, nicht an der
Bestandszeile. Der Unterschied, auf den dieser Test zielt, bleibt
derselbe: `besitzt` kommt aus `sets` (habe ich das Set?), das Bild aus
dem Katalog (gibt es eine heruntergeladene Datei?). Vorher standen beide
in derselben Zeile und waren damit nicht zu trennen.
```

<a id="a-stelle"></a>
## `const a = await alleAlarme(ich.id);`

```text
── Warum das nicht der Kotlin-Übersetzer erledigt (Nachtrag 137) ──────

Er fängt den lauten Fall: Ein Feld, das die Oberfläche liest und das es
im Modell nicht gibt, übersetzt nicht. Genau das ist beim Einbau dieser
Zeile passiert — die vier neuen Felder landeten versehentlich in der
Nachbarklasse, und der Lauf war nach 88 Sekunden rot.

Der STILLE Fall bleibt: Heisst das Feld hier `set_img_url` und im Modell
`@SerialName("set_image")`, übersetzt alles sauber, und die App bekommt
für immer `null`. Kein Fehler, kein Absturz — nur ein Bild, das nie
erscheint, und niemand weiss, warum.

Deshalb werden die Namen VERGLICHEN, und zwar die tatsächlich
gelieferten aus der Antwort, nicht eine abgeschriebene Liste.
```

<a id="js-stelle"></a>
## `const js = ohneKommentare(require('./helpers/sources').ansichtQuelle('`

```text
── Marcos Befund vom 26.09. ──────────────────────────────────────────

  „Ok entschuldige ich habe eine rot grün schwäche. Deshalb sind labels
   mit scharf / unscharf für mich einfacher."

Bis dahin trug die Farbe die ganze Aussage: grün heisst scharf, grau
heisst nicht mehr scharf. Rot-Grün-Schwäche trifft rund acht Prozent der
Männer — für sie stand die Information nirgends. Die Entschuldigung ist
an der falschen Stelle: Nicht das Auge ist der Fehler, sondern eine
Oberfläche, die eine Aussage NUR in die Farbe legt.

Geprüft werden drei Unterschiede, von denen jeder EINZELN reicht.
```

<a id="a-stelle-2"></a>
## `const a = await alleAlarme(ich.id);`

```text
„Das Bild in der Android-App ist sichtbar aber die Einträge in den
Preisalarme sind nicht klickbar."

Zwei Ursachen, beide meine. Diese hier ist die im Server: Die erste
Fassung verband auf `s.user_id = a.user_id` — streng das eigene Konto.
`GET /v1/sets/:nummer` fragt aber über `scopeIds()`, also über das ganze
Blickfeld. Ein Set, das einem Unterkonto gehört, HAT eine Detailansicht;
die Zeile war trotzdem tot.

Die zweite Ursache lag in der App und steht dort (Vorgabewert von
`besitzt`); sie ist von hier aus nicht messbar.
```
