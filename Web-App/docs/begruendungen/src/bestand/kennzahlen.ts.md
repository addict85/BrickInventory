# Begründungen zu `src/bestand/kennzahlen.ts`

Die ausführlichen Kommentare aus `src/bestand/kennzahlen.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="getstats"></a>
## `getStats`

```text
Die Kennzahlen der Übersichtsseite — spannen über alle drei Domänen und
gehören deshalb in keine davon.

── Warum aufgeteilt (Nachtrag 133) ────────────────────────────────────────
utils/handlers.ts fasste Sets, Teile und Minifiguren in 1313 Zeilen zusammen
— benannt nach seiner Rolle („handlers"), nicht nach seinem Inhalt, wie
zuvor schon js/07-admin.js. Die drei Domänen berühren sich kaum: Nur
getSets() liest Teile, und die Minifiguren-Kennzahlen lesen Sets. Beides
geht in EINE Richtung, es entsteht also kein Kreis.
```

<a id="getstats-2"></a>
## Abschnitt

```text
COUNT(DISTINCT set_number), nicht COUNT(*).

── Der Befund ──────────────────────────────────────────────────────────
Die Galerie gruppiert nach set_number: Besitzen im Haushalt zwei Konten
dasselbe Set, steht dort EINE Kachel mit beiden Besitzer-Plaketten
(src/sets/abfragen.ts). Diese Zeile zaehlte die TABELLENZEILEN.

NACHGEMESSEN mit zwei Konten — dasselbe Set bei beiden, eines nur beim
Kind:
    Kopfzeile /v1/stats : 3 Sets
    Galerie darunter    : 2 Kacheln, total=2

Beide Zahlen stehen uebereinander auf demselben Bildschirm. Im
Einzelkonto faellt es nie auf, weil es dort je Setnummer nur eine Zeile
gibt — deshalb hat es niemand gesehen.

Die andere Lesart ist nicht verloren: total_quantity zaehlt die
Exemplare, und die App zeigt sie direkt daneben als eigene Kachel
(„Einheiten", GalleryScreen.kt). Zwei Kacheln, zwei Fragen — mit
COUNT(*) haetten beide dieselbe beantwortet.
── Die Menge aus den ERFASSUNGEN ────────────────────────────────────

Migration 0036 hat sets.quantity geloescht. Die Setzahl kommt weiter aus
`sets` (eine Zeile je Konto und Set), die Stueckzahl aus den
Erfassungen — der JOIN haelt die Einschraenkung „nur Konten, die das
Set wirklich halten".
```
