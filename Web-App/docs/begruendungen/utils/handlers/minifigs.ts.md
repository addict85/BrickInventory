# Begründungen zu `utils/handlers/minifigs.ts`

Die ausführlichen Kommentare aus `utils/handlers/minifigs.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Leseabfragen für Minifiguren.

── Warum aufgeteilt (Nachtrag 133) ────────────────────────────────────────
utils/handlers.ts fasste Sets, Teile und Minifiguren in 1313 Zeilen zusammen
— benannt nach seiner Rolle („handlers"), nicht nach seinem Inhalt, wie
zuvor schon js/07-admin.js. Die drei Domänen berühren sich kaum: Nur
getSets() liest Teile, und die Minifiguren-Kennzahlen lesen Sets. Beides
geht in EINE Richtung, es entsteht also kein Kreis.
```

<a id="figurensuche"></a>
## `figurenSuche`

```text
Volltextsuche über Figurennummer und Name.

EINE Formulierung für beide Listen des Reiters: die Figuren aus Sets
(getMinifigs) und die manuell erfassten (getManualMinifigs). Gegenstück zu
teileSuche() in utils/handlers/parts.ts — dort steht die ausführliche
Begründung.

Die BrickLink-Nummer ist hier NICHT dabei, anders als bei den Teilen: Beide
Figuren-Listen zeigen `fig_number` auf der Kachel, nicht die
BrickLink-Nummer. Gesucht wird, was dasteht.
```

<a id="getminifigstats"></a>
## `getMinifigStats`

```text
Kennzahlen des Minifiguren-Reiters: Arten, Gesamtstückzahl, manuell erfasste.

── Warum das hierher gehört ────────────────────────────────────────────────
Die drei Zahlen entstanden vorher auf ZWEI verschiedene Weisen. Die Webapp
holte sie von `/api/minifigs/stats`, die App rechnete sie aus ihrer geladenen
Liste (`figs.size`, `sumOf { totalQuantity ?: quantity }`,
`count { source == "manual" }`). Das ergab zwei Fehler auf einmal:

  • Die Server-Fassung zählte `COUNT(DISTINCT LOWER(TRIM(fig_number)))`,
    die Liste daneben gruppiert aber nach Nummer UND Quelle. Eine Figur, die
    einmal aus einem Set und einmal manuell erfasst ist, steht in der Liste
    zweimal und zählte oben einmal — die Kachel widersprach der Liste
    darunter.
  • Die Server-Fassung las `WHERE m.user_id = $1`, also ohne Blickfeld und
    ohne Kontofilter. Im Haushalt zeigte die Kachel die eigenen Zahlen,
    während die Liste darunter alle Konten zeigte, und das Umschalten des
    Filters änderte oben nichts.

Jetzt zählt diese Funktion über GENAU DIESELBE Gruppierung wie getMinifigs()
und über dasselbe Blickfeld. Kachel und Liste können nicht mehr
auseinanderlaufen, weil es dieselbe Regel ist.

@param userId Blickfeld (scopeIds) oder eine einzelne ID
```

<a id="getmanualminifigs"></a>
## Abschnitt

```text
── Spalten ausgeschrieben, kein m.* ──────────────────────────────────

Hier stand `m.*` plus der aufgeloeste Lagerortname. Das SELECT * ist
zweimal zur Fehlerquelle geworden: Migration 0031 nahm ihm den
Lagerortnamen weg (Marcos Befund vom 24.09.), und ein Stern liefert
stillschweigend auch SPALTEN DAZU, sobald die Tabelle eine bekommt.
Beides faellt erst in der Oberflaeche auf.

Name und Bild kommen seit Migration 0034 aus minifigs_catalog —
sie haengen an der Figur, nicht am Konto, das sie besitzt.
```

<a id="getmanualminifigs-preise"></a>
## `preise`

```text
── Der Marktpreis gehoert dazu ──────────────────────────────────────────

Marcos Befund: „Bei den manuell erfassten Minifiguren wird kein Marktpreis
angezeigt." Der Detailbildschirm der App liest ihn aus `avg_price`
(ManualItemDetailScreen.kt); diese Liste ist ein `SELECT * FROM minifigs`
und fuehrt ihn nicht — die Bestandszeile kennt unit_price und
purchase_price, der Marktpreis liegt in minifig_price_cache.

NUR aus dem Cache, in EINER Abfrage fuer die ganze Liste: Ein Live-Abruf
je Eintrag waere genau der Zustand, von dem der Umzug weg von der
Bewertung wegfuehren sollte. Siehe utils/marketPrice.ts.

`viewerId` und nicht uids[0]: Die Waehrung ist die Einstellung des
FRAGENDEN. Im Haushalt mit Kontofilter „Unterkonten" enthaelt uids das
fragende Konto gar nicht — dieselbe Unterscheidung, die auch die
Bewertung trifft (computeMinifigsValuation).
```
