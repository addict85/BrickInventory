# Begründungen zu `src/sets/setAdd.ts`

Die ausführlichen Kommentare aus `src/sets/setAdd.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

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
