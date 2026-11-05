# Begründungen zu `test/teile-filter-blickfeld-db.test.js`

Die ausführlichen Kommentare aus `test/teile-filter-blickfeld-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Farbfilter und Kategoriefilter zaehlen dasselbe Blickfeld.

── Der Befund (Nachtrag 134) ───────────────────────────────────────────────

Der Teile-Reiter hat zwei Filterlisten uebereinander, beide mit Zaehlwerten,
beide ueber DERSELBEN Liste:

    /api/v1/parts/colors      → src/teile/abfragen.ts, getPartsColors
    /api/v1/parts/categories  → routes/parts.ts, inline

Die erste las das Blickfeld (`accounts` → scopeIds), die zweite die eigene
Konto-ID. Im Haushalt zaehlte die Farbliste also die Teile ALLER Konten, die
Kategorienliste nur die eigenen — und wer nach einer Kategorie filterte,
bekam eine Liste, die zu keiner der beiden Zahlen darueber passte.

Aufgefallen ist es beim Bauen der Filter fuer die Android-App: Sie ruft
beide Adressen mit demselben `accounts`, und dabei war nachzusehen, was der
Server damit macht.

── Warum verglichen und nicht festgeschrieben ──────────────────────────────

Eine feste Erwartung („3 Teile") waere beim naechsten Umbau der Gruppierung
genauso falsch wie die alte Zahl. Verglichen wird deshalb, was beide Listen
ueber DENSELBEN Bestand sagen: Die Summe der Teile ueber alle Farben muss
die Summe ueber alle Kategorien sein — es sind dieselben Teile, zweimal
gruppiert.

Voraussetzung: Test-DB via TEST_DATABASE_URL.
```

<a id="stelle"></a>
## `await db.run('INSERT INTO part_catalog (part_number, part_name, catego`

```text
Je Konto ein Teil, VERSCHIEDENE Farben: Waere die Farbe gleich, faenden
beide Zaehlungen zufaellig dieselbe Zahl und der Test pruefte nichts.
Name, Farbbezeichnung und Kategorie stehen seit Migration 0034 in den
Katalogen — und sie sind hier der Kern der Sache: Beide Listen dieses
Tests gruppieren danach. VERSCHIEDENE Kategorien je Teil, aus demselben
Grund wie bei den Farben.
ON CONFLICT DO NOTHING: Die Kataloge haengen an keinem Konto, und diese
Datei laeuft auf der gemeinsamen Test-Datenbank — eine andere Datei kann
dieselben Teilenummern schon eingetragen haben.
```
