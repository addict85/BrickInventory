# Begründungen zu `public/js/01-format.js`

Die ausführlichen Kommentare aus `public/js/01-format.js` (bis zur Teilung in `public/js/01-core.js`), wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="fmtn"></a>
## `fmtN`

```text
Ein GELDBETRAG in der Waehrung des Nutzers.

── Warum der Rueckfall nicht mehr 'EUR' ist ─────────────────

Hier stand `cur||'EUR'`. Wer das zweite Argument vergisst, bekam damit still
Euro — und zwar auch dann, wenn der Nutzer in Franken rechnet. Genau das ist
im Teile-Detail passiert: Zwei Aufrufe uebergaben gar keine Waehrung, weil
sie ueberhaupt keinen Betrag formatieren wollten, sondern eine ANZAHL.
Angezeigt wurde „EUR 6.00×" statt „6×".

Die Anzahlen sind umgestellt (13-acquisition-modals.js). Der Rueckfall hier
bleibt trotzdem falsch: Ein vergessenes Argument soll wenigstens die
eingestellte Waehrung nehmen, nicht eine fest verdrahtete. `CURRENCY` traegt
sie; 'EUR' steht nur noch als letzte Stufe da, falls die Einstellung noch
nicht geladen ist.

Dass ueberhaupt kein Aufruf das Argument weglaesst, haelt
test/geldformat.test.js fest — dort steht auch, warum das die eigentliche
Regel ist.
```
