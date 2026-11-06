# Begründungen zu `test/kennzahlen-haushalt-db.test.js`

Die ausführlichen Kommentare aus `test/kennzahlen-haushalt-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Zahl über der Galerie muss zu dem passen, was darunter steht.

── Der Befund ──────────────────────────────────────────────────────────────
Die Galerie gruppiert nach set_number: Besitzen im Haushalt zwei Konten
dasselbe Set, steht dort EINE Kachel mit beiden Besitzer-Plaketten.
getStats() zählte dagegen die Tabellenzeilen — `COUNT(*) FROM sets`.

NACHGEMESSEN mit zwei verknüpften Konten (dasselbe Set bei beiden, ein
weiteres nur beim Kind):

    Kopfzeile /v1/stats : 3 Sets
    Galerie darunter    : 2 Kacheln, total=2

Beide Zahlen stehen übereinander auf demselben Bildschirm — in der Webapp
als hs-sets über dem Raster, in der App als Kachel „Sets" direkt darüber.

Im Einzelkonto gibt es je Setnummer nur eine Zeile, dort sind beide Zahlen
gleich. Genau deshalb hat es niemand gesehen.

── Warum die Prüfung die beiden VERGLEICHT ─────────────────────────────────
Eine feste Erwartung („2 Sets") würde beim nächsten Umbau der Gruppierung
genauso falsch wie die alte Zahl. Verglichen wird deshalb die Kopfzeile mit
der Liste — dieselbe Frage, zwei Wege, ein Ergebnis.

Voraussetzung: Test-DB über TEST_DATABASE_URL (Inhalt wird geleert!).
```

<a id="stelle"></a>
## `{`

```text
── Und die MIGRATIONEN, nicht nur das Schema ───────────────────────────

Diese Datei loescht das Schema und baut es neu auf. initSchemaOnce()
laeuft dabei voll durch (die Marke in schema_meta ist mit weg), bleibt
aber auf dem Stand von db/schema.sql — also VOR allen Migrationen. Das
ist nicht nur fuer diese Datei falsch, sondern fuer jede danach: Sie erbt
eine halbe Datenbank.

GEMESSEN beim Umzug der Teilemengen (Migration 0038): db/schema.sql legt
`parts.quantity DEFAULT 1` an, die Katalogzeilen tragen die echte Zahl.
Die naechste Datei, die die Migrationen laufen liess, brach ab — „Bei 8
Set-Teilen weicht parts.quantity vom Katalog ab". Der Riegel hatte recht.
```
