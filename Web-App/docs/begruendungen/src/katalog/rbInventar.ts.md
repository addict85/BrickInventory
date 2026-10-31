# Begründungen zu `src/katalog/rbInventar.ts`

Die ausführlichen Kommentare aus `src/katalog/rbInventar.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Das neueste Rebrickable-Inventar zu einer Nummer nachschlagen.

Dieselbe Abfrage stand an acht Stellen — in vier verschiedenen Fassungen.
Sie unterscheiden sich nicht im SQL, sondern darin, WONACH gesucht wird:

  Eingabe „9999" (Set-Nummer ohne Versionsanhang)
    jobs/catalogSync, jobs/partsCatalogEnrich,
    clients/rebrickable, routes/api_v1/sets    → '9999-1' ODER '9999'
    src/teile/abfragen.ts                    → '9999-1' ODER '9999-1'
    routes/api_v1/catalog.ts                   → nur '9999-1'

Die beiden Abweichler finden eine Zeile, die unter der blanken Nummer
abgelegt ist, also nicht — die anderen sechs schon. In parts.ts ist der
zweite Kandidat sogar wortgleich mit dem ersten; die Abfrage fragt zweimal
dasselbe. Und in catalog.ts steht darüber „analog catalogSync", während
catalogSync zwei Kandidaten prüft.

Deshalb steht die Kandidatenbildung hier, einmal, neben der Abfrage, die
sie benutzt.
```
