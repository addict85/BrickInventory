# Begründungen zu `src/sets/erfassen.ts`

Die ausführlichen Kommentare zu `src/sets/erfassen.ts`, wörtlich aus der früheren Stelle
übernommen. Im Code steht je Stelle der erste Absatz und ein Verweis hierher. Neue
Geschichte gehört in die Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
„Ist dieses Set schon da?" — die Regel für alle Erfassungswege.

── Marcos Festlegung ───────────────────────────────────────────────────────
Besitzt das eigene Konto ODER eines der Konten im Blickfeld das Set bereits,
wird die Menge NICHT erhöht. Stattdessen öffnet sich die Detailansicht.
Das gilt für alle drei Wege gleich: Eingabe der Setnummer, Barcode-Scanner
und Texterkennung. Wer wirklich ein zweites Exemplar erfassen will, tut das
dort, wo man sieht, was man tut — über die Menge oder eine neue
Kaufpreis-Zeile.

── Warum das hier steht und nicht in den Clients ───────────────────────────
Die App prüfte das seit Nachtrag 57 selbst (ein `getSetDetail`-Aufruf vor
dem Anlegen), die Webapp gar nicht — sie schickte unbesehen ab, der Server
erhöhte die Menge und meldete „aktualisiert". Dieselbe Eingabe, zwei
Ausgänge, und die Regel hing daran, welchen Client man benutzt.

Jetzt entscheidet der Server. Die Oberflächen zeigen nur noch, was
zurückkommt: `action: 'exists'` heisst „Detailansicht öffnen".

── Was hier ABSICHTLICH nicht greift ───────────────────────────────────────
Der CSV-Import. Er ruft addSet() direkt und soll weiterhin zusammenfassen —
wer 500 Zeilen einliest, will keine 500 Rückfragen, und dieselbe Setnummer
zweimal in einer Datei ist eine Mengenangabe, keine Verwechslung. Die Regel
hängt deshalb an den INTERAKTIVEN Routen, nicht in addSet() selbst.
```

<a id="normalizesetnumber"></a>
## `normalizeSetNumber`

```text
Setnummer normalisieren — dieselbe Regel wie sanitizeSetNumber() in
routes/sets.ts, die addSet() vor dem Schreiben anwendet.

Sie steht hier noch einmal, weil ein Import aus routes/sets.ts einen Kreis
bauen würde (sets.ts → src/sets/setAdd.ts → sets.ts). Ein Test hält die beiden
Fassungen zusammen: Weicht eine ab, prüft die Regel eine andere Nummer, als
später geschrieben wird — und das Set wäre trotz Prüfung doppelt.
```

<a id="findsetinscope"></a>
## `findSetInScope`

```text
Sucht das Set im BLICKFELD des Fragenden (eigenes Konto + Haushalt).

Bewusst scopeIds() und nicht writableIds(): Die Frage lautet „habe ich das
schon?", und sichtbar ist sichtbar. Ein Set, das im Haushalt bereits steht,
soll man nicht versehentlich ein zweites Mal anlegen — auch dann nicht, wenn
man selbst nicht hineinschreiben dürfte.

@returns die gefundene Zeile oder null
```

<a id="addset"></a>
## `addSet`

```text
Ein Set erfassen — mit Lagerort, wenn einer mitkommt.

── Warum der Lagerort HIER und nicht im Rumpf steht ────────────────────────

Marcos Befund vom 24.09.: „Wenn ich ein Set in der Galerie hinzufuegen will,
kann ich den Lagerort nicht waehlen." Das stimmte, und es war kein fehlendes
Eingabefeld: Bis dahin liess sich der Lagerort ausschliesslich NACH dem
Erfassen im Detaildialog setzen, ueber PUT …/storage.

Der Rumpf hat zwei Zweige — Erst-Erfassung und Aufstocken —, und beide
muessten die Spalte schreiben. Stattdessen schreibt sie KEINER von beiden:
Der Lagerort wird danach ueber setzeLagerort() gesetzt, dieselbe Funktion,
die auch der Detaildialog ruft. Damit gilt die Laengengrenze einmal, das
Trimmen einmal, und — das ist der eigentliche Grund — ein neu getippter Ort
landet ueber stelleOrteSicher() im Vorrat. Ohne das stuende der Ort am Set,
fehlte aber in der Liste, aus der er gewaehlt werden soll.

GEPRUEFT wird vorher: Ein zu langer Name soll nicht erst das Set anlegen und
dann absagen.

`sendProgress` meldet Zwischenschritte an den SSE-Strom; null beim CSV-Import.
```

<a id="addsetintern-readdprice"></a>
## `reAddPrice`

```text
Kaufpreis dieser Erfassung festhalten (ging früher verloren!) —
ohne Angabe aktuellen Marktpreis übernehmen, wie bei Neu-Erfassung.
Auch hier den gewählten Zustand mitgeben, sonst kommt der Neupreis.

Der Marktpreis wird VOR der Sperre geholt: Das ist ein Netzaufruf, und
eine Sperre über einen Netzaufruf zu halten blockiert jeden anderen
Schreibvorgang auf diesem Set für die Dauer der Antwort.
purchasePrice ist number|null. NACHGEMESSEN: Es gibt genau drei
Importeure (routes/sets.ts, routes/api_v1/sets.ts, addSetWithDate), und
alle drei normalisieren vorher — V.optionalPrice() bzw. routes/sets.ts
Zeile 549 beim CSV-Import. Die frueheren Pruefungen auf '' und das
parseFloat verteidigten gegen eine Form, die hier nicht ankommt; der Typ
hat das sichtbar gemacht ("number und string haben keine Ueberschneidung").
```

<a id="addsetintern"></a>
## Abschnitt

```text
── Menge und Erfassung GESPERRT schreiben ────────────────────────────

Vorher standen die drei Schreibvorgänge ungesperrt nebeneinander, und
recordAcquisitionForDay() liest erst und schreibt dann. Zehn parallele
Erfassungen desselben Sets ergaben am laufenden Server: sets.quantity =
10, aber drei Erfassungszeilen mit Summe 7 — drei verlorene Exemplare
und drei Tageszeilen, wo genau eine erlaubt ist. Alle anderen
Schreibwege (Mengenänderung, Verschieben, Eigentümerwechsel) hielten
diese Sperre längst; ausgerechnet das Erfassen nicht.
```

<a id="addsetintern-3"></a>
## Abschnitt

```text
── Der Katalog ist seit Migration 0033 die EINZIGE Stelle ──────────────

Hier stand `.catch(()=>{})`. Das ging, solange die Stammdaten gleich
darunter noch einmal in die sets-Zeile geschrieben wurden: Scheiterte der
Katalog, hatte das Set immer noch seinen Namen.

Jetzt nicht mehr. Scheitert diese Anweisung, hat das Set nirgends einen
Namen, kein Jahr und kein Bild — und niemand erfaehrt davon. Deshalb kein
Fang: Das Erfassen bricht ab, und zwar mit der Meldung von Postgres. Ein
Set ohne Namen ist der schlechtere Ausgang.
```
