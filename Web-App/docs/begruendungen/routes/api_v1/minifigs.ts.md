# Begründungen zu `routes/api_v1/minifigs.ts`

Die ausführlichen Kommentare aus `routes/api_v1/minifigs.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="put-minifigs-fignumber-storage"></a>
## `put-/minifigs/:figNumber/storage`

```text
PUT /api/v1/minifigs/:figNumber/storage — Lagerort setzen.

Wortgleich zum Gegenstueck bei den Teilen (routes/api_v1/parts.ts) und aus
demselben Grund: Trifft ALLE Zeilen dieser Figur im Schreibbereich.
Dieselbe Figur steckt in mehreren Sets und damit in mehreren Zeilen; wer in
der Ansicht „Kiste 3" eintraegt, meint die Figur, nicht eine ihrer Zeilen.

Neu seit Marcos Befund vom 24.09. — bis dahin konnte eine Minifigur
ueberhaupt keinen Lagerort tragen (Migration 0024).
```

<a id="get-minifigs-stats"></a>
## `get-/minifigs/stats`

```text
Kennzahlen des Minifiguren-Reiters. Die Zählung steht in utils/handlers.ts
und benutzt dieselbe Gruppierung wie die Liste — vorher hatte die Webapp
eine eigene Abfrage (ohne Blickfeld, mit anderer Gruppierung) und die App
rechnete aus ihrer geladenen Liste.

Die Route steht VOR /minifigs/:figNumber/… — sonst nähme Express `stats`
für eine Figurennummer.
```

<a id="get-minifigs-fignumber-sets"></a>
## `get-/minifigs/:figNumber/sets`

```text
In welchen Sets steckt diese Figur?

Gegenstück zu /api/v1/parts/:partNumber/:colorId/sets. Beide rufen dieselbe
Funktion in utils/handlers/shared.ts auf — die Frage ist zweimal dieselbe,
nur Tabelle und Schlüssel wechseln. Zwei getrennte Abfragen waeren genau die
Sorte Doppelung, die in diesem Projekt schon mehrfach auseinandergelaufen
ist (zuletzt routes/minifigs.ts gegen routes/parts.ts).

Blickfeld, nicht eigenes Konto: Im Haushalt soll auch das Set des
Geschwisterkontos auftauchen, in dem dieselbe Figur steckt.
```
