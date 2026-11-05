# Begründungen zu `src/figuren/repository/figurenListe.ts`

Die ausführlichen Kommentare aus `src/figuren/repository/figurenListe.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="figurensuche"></a>
## `figurenSuche`

```text
Volltextsuche über Figurennummer und Name.

EINE Formulierung für beide Listen des Reiters: die Figuren aus Sets
(getMinifigs) und die manuell erfassten (getManualMinifigs). Gegenstück zu
teileSuche() in src/teile/abfragen.ts — dort steht die ausführliche
Begründung.

Die BrickLink-Nummer ist hier NICHT dabei, anders als bei den Teilen: Beide
Figuren-Listen zeigen `fig_number` auf der Kachel, nicht die
BrickLink-Nummer. Gesucht wird, was dasteht.
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
