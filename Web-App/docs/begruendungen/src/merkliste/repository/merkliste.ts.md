# Begründungen zu `src/merkliste/repository/merkliste.ts`

Die ausführlichen Kommentare aus `src/merkliste/repository/merkliste.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="merk-sorts"></a>
## `MERK_SORTS`

```text
Die Sortierungen der Merkliste.

── Warum nicht dieselbe Tabelle wie bei den Sets ──────────────────────────

Die Namen sind absichtlich dieselben wie in SET_SORTS (src/sets/abfragen.ts)
— beide Oberflaechen beschriften sie mit denselben Texten, und wer die
Galerie kennt, erwartet in der Merkliste dieselbe Auswahl. Die AUSDRUECKE
koennen es nicht sein: Dort steht `s.added_at`, hier `w.created_at`; dort
ist der Preis der KAUFPREIS aus den Erfassungen, hier der MARKTPREIS aus
dem Cache, denn gekauft hat man einen Merkposten gerade nicht.

qty_desc/qty_asc fehlen mit Absicht: Ein Merkposten hat keine Anzahl.

NULLS LAST ueberall dort, wo der Wert fehlen kann: Ein Set, das rb_sets
nicht kennt, hat weder Namen noch Jahr, und ein Merkposten ohne Preis im
Cache keinen Marktpreis.

GEMESSEN (test/merkliste-filter-db.test.js, Gegenprobe d): Wirkung hat die
Angabe nur bei DESC — dort ist NULLS FIRST die Vorgabe von Postgres, und
ohne sie stuenden die Zeilen OHNE Preis ganz oben. Bei ASC ist NULLS LAST
ohnehin die Vorgabe; dort steht sie nur, damit die Tabelle sich in jeder
Zeile gleich liest. Das ist eine Messung und keine Vermutung: Die erste
Gegenprobe strich sie bei name_asc und blieb gruen.

Zweiter Sortierschluessel ueberall: Dasselbe Set steht zweimal da (neu und
gebraucht) und im Kontenbaum bei mehreren Konten. Ohne ihn legt Postgres
die Reihenfolge dieser Zeilen nicht fest, und sie sprang bei jedem Laden.
```
