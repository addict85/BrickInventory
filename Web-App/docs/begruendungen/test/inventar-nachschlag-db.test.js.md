# Begründungen zu `test/inventar-nachschlag-db.test.js`

Die ausführlichen Kommentare aus `test/inventar-nachschlag-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Ein Rebrickable-Inventar wird ueberall nach denselben Kandidaten gesucht.

── Der Fehler, den das verhindert ──────────────────────────────────────────
`SELECT id FROM rb_inventories WHERE set_num=$1 OR set_num=$2 ORDER BY
version DESC LIMIT 1` stand an ACHT Stellen. Das SQL war ueberall gleich —
die beiden Kandidaten nicht. Fuer die Eingabe „9999" (Set-Nummer ohne
Versionsanhang) ergab sich:

  src/katalog/katalogAbgleich, src/katalog/teileAnreicherung,
  clients/rebrickable, routes/api_v1/sets (2x)   '9999-1' ODER '9999'
  src/teile/abfragen.ts                        '9999-1' ODER '9999-1'
  routes/api_v1/catalog.ts                       nur '9999-1'

Die beiden Abweichler finden eine Zeile, die unter der blanken Nummer
abgelegt ist, also nicht — die anderen sechs schon. In parts.ts war der
zweite Kandidat sogar wortgleich mit dem ersten: Die Abfrage fragte zweimal
dasselbe. Und in catalog.ts stand ueber der einkandidatigen Fassung
„analog catalogSync", waehrend catalogSync zwei prueft.

In parts.ts schlug dieselbe Fehlbildung noch ein zweites Mal durch: Die
Rebrickable-Ersatzquelle laeuft darunter ueber `for (const sn of [n, alt])`
und holte damit denselben Satz zweimal ueber die Leitung — ein Abruf des
dortigen Tageskontingents fuer nichts.

Seit Migration 0074 legt die Datenbank jede Set-Nummer mit Versionsanhang
ab; es gibt nur noch einen Kandidaten. Die Aussage bleibt: Eine blank
geschriebene Nummer wird gefunden, gleich wie der Aufrufer sie schreibt.
```
