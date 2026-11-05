# Begründungen zu `test/geldformat.test.js`

Die ausführlichen Kommentare aus `test/geldformat.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Wer Geld formatiert, sagt auch WELCHES.

── Der Befund ──────────────────────────────────────────────────────────────

`fmtN(v, cur)` (01-format.js) formatiert einen Geldbetrag. Das zweite Argument
war optional und fiel auf 'EUR' zurück. NACHGEMESSEN: 30 Aufrufstellen, 28
übergeben eine Währung — und die zwei übrigen wollten überhaupt keinen
Betrag formatieren, sondern eine ANZAHL:

    fmtN(item?.total_quantity || 0)   im Teile-Detail
    fmtN(s.quantity)                  in der Liste „Verwendet in"

Angezeigt wurde damit „EUR 6.00×" statt „6×" — Marcos Befund. Zwei Fehler in
einem: die falsche Formatierungsart UND, für alle, die nicht in Euro rechnen,
die falsche Währung.

── Warum die Regel am AUFRUF hängt und nicht am Rückfall ───────────────────

Der Rückfall ist mit korrigiert (jetzt `CURRENCY` statt 'EUR'), aber das ist
die zweite Verteidigungslinie. Die erste ist: Ein Aufruf ohne Währung ist
fast immer ein Aufruf, der gar kein Geld meint. Genau das soll auffallen.

Anzahlen schreibt dieser Baum als `(n||0).toLocaleString(locale())` — so
steht es auf der Teilekachel (03-parts.js) und an sieben weiteren Stellen.
```
