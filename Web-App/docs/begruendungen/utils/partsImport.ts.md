# Begründungen zu `utils/partsImport.ts`

Die ausführlichen Kommentare aus `utils/partsImport.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="downloadpartimagesbackground"></a>
## `downloadPartImagesBackground`

```text
Teile eines Sets aus dem Katalog übernehmen.

── Warum das nicht mehr in routes/parts.ts steht (Nachtrag 131) ────────────

`addSet()` ruft `importPartsForSet()` — und das war der Grund, warum addSet
selbst nicht aus routes/sets.ts herauskam: Ein Modul unter utils/ hätte einen
ROUTER importieren müssen. Das ist die falsche Richtung; utils/ ist die
Schicht, auf der Routen aufsetzen, nicht umgekehrt.

Die vier Funktionen hier sind reine Katalogarbeit ohne jede Route: Teile
holen, Bilder im Hintergrund nachladen, BrickLink-Nummern nachtragen. Sie
lagen in routes/parts.ts, weil die HTTP-Route dort steht, die sie auslöst.
```

<a id="downloadpartimagesbackground-2"></a>
## Abschnitt

```text
Hier stand ein UPDATE auf parts — also je Konto einmal derselbe
Pfad. Seit Migration 0034 steht das Bild einmal im Katalog, und
zwar je (Teil, Farbe): Dasselbe Teil in Rot und in Blau hat
verschiedene Bilder, dieselbe Farbe aber immer dasselbe.

Als Upsert, nicht als UPDATE: Der Bildabgleich kann ein Teil
treffen, dessen Katalogzeile es noch nicht gibt (das Bild wird
heruntergeladen, bevor der Teile-Import die Zeile schreibt).
Ein nacktes UPDATE waere dort wirkungslos — lautlos.
Ohne COALESCE: Eine eben heruntergeladene Datei ist der richtige
Pfad, auch wenn schon einer dasteht (utils/katalogPflege.ts).
```

<a id="abschnitt"></a>
## Abschnitt

```text
── syncBlPartNumbers() ist WEG ───────────────────────────────────────────

Ihre ganze Aufgabe war das KOPIEREN: Sie trug rb_bl_mapping in
`parts.bl_part_number` und `set_parts_catalog.bl_part_number` nach, nach
jedem CSV-Abgleich. Der Kommentar darueber sagte es selbst — „Sync
bl_part_number from rb_bl_mapping table (called after CSV sync)".

Mit Migration 0037 gibt es die beiden Abschriften nicht mehr: Die
BrickLink-Nummer steht in `bl_zuordnung`, einmal je Teil, und die
Leseabfragen holen sie von dort (utils/blZuordnung.ts, blJoin/blNummerSql).
Es gibt also nichts zu kopieren, und damit auch keinen Zeitpunkt, zu dem
eine Kopie veralten koennte.

Marcos Vorgabe dahinter: „ich würde mir für die bl_*_number Spalten eine
Mapping-Tabelle vorstellen mit der Spalte RB_id und BL_id".
```

<a id="importpartsforset"></a>
## Abschnitt

```text
[0]=userId [1]=setNum [2]=partNo [3]=blNum [4]=name [5]=colorId [6]=colorName [7]=colorHex [8]=catName [9]=qty [10]=imageUrl [11]=imageLocal [12]=isSpare

Nur noch der BESTAND: wer welches Teil in welcher Farbe aus
welchem Set hat. Die Beschreibung schreiben die beiden
Schleifen darunter EINMAL in den Katalog, statt je Konto neu
(Migration 0034).
Ohne Menge: Die Stückzahl eines Set-Teils ist seit Migration
0038 die Katalogzahl — und die schreibt der Upsert auf
set_parts_catalog weiter unten, aus demselben row[9].
Vorher stand derselbe Wert an BEIDEN Stellen, in derselben
Schleife; genau das war die Abschrift.
```

<a id="importpartsforset-2"></a>
## Abschnitt

```text
── Teilekatalog ────────────────────────────────────────────

DO UPDATE mit COALESCE auf der SPALTE, nicht auf EXCLUDED: Ein
vorhandener Name bleibt stehen, ein fehlender wird gefuellt.
Die Set-Teile-Antwort von Rebrickable liefert kein part_cat_id,
die Kategorie steht dort oft auf 'Unknown' — NULLIF haelt das
aus dem Katalog heraus, damit ein spaeterer, echter Wert nicht
dagegen antreten muss.
In eigenen Schleifen, Tabelle fuer Tabelle — dieselbe
Begruendung wie beim Set-Teilekatalog darunter: eine feste
Sperrreihenfolge statt einer Verschraenkung ueber Tabellen
hinweg. Die Zeilen sind nach Teilenummer und Farbe sortiert.
```
