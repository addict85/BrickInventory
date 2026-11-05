# Begründungen zu `test/teilepreise-nur-erfassungen-db.test.js`

Die ausführlichen Kommentare aus `test/teilepreise-nur-erfassungen-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Seit db/basis.sql gibt es den Stand VOR dieser Migration nicht mehr: Die
Fälle zu Riegel, Nachtrag und Zwischenstand sind entfallen. Geprüft werden
der Endstand und die Lesewege.

Preis und Zustand von Teilen und Figuren stehen an GENAU EINEM Ort.

── Marcos Vorgabe ──────────────────────────────────────────────────────────

  „Ich muss dir bei unit_price, purchase_price und condition widersprechen.
   Diese Informationen gehören in die set_acuisitions tabelle, da sie pro
   Kauf hinterlegt werden."

Fuer Sets hat Migration 0032 das gemacht (test/sets-ohne-kaufpreisspalte-db).
Migration 0035 ist dasselbe fuer Teile und Minifiguren.

── Was dieser Test prueft ──────────────────────────────────────────────────

  1. Nach der GANZEN Migrationskette tragen parts und minifigs keinen Preis
     und keinen Zustand mehr — und die Erfassungstabellen tragen sie.
  2. Der Riegel greift, wenn eine manuelle Position ihre Erfassung oder
     ihren Kaufpreis verlieren wuerde. Mit GEGENPROBE: ohne Riegel laeuft
     dieselbe Lage durch und der Preis ist weg.
  3. Set-Teile bekommen KEINE Erfassung — fuer sie gab es keinen eigenen
     Kauf, gekauft wurde das Set.
  4. Die Leseabfragen liefern Preis und Zustand weiterhin, aus der
     neuesten Erfassung.

Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip, ausser
REQUIRE_DB=1.
```

<a id="for-stelle"></a>
## `for (const sp of ['id', 'user_id', 'set_number', 'part_number', 'color`

```text
Und der Bestand ist noch da: Marcos Liste, plus was den Kauf NICHT betrifft.
bl_part_number stand hier und ist weg: Migration 0037 hat sie geloescht,
die BrickLink-Nummer steht in bl_zuordnung (einmal je Teil statt je
Konto). Siehe test/bricklink-zuordnung-db.test.js.
quantity stand hier und ist weg: Migration 0038 hat sie geloescht — fuer
ein Set-Teil ist die Stückzahl die Katalogzahl, fuer ein manuelles die
Summe der Erfassungen. Siehe test/teilemengen-abgeleitet-db.test.js.
```
