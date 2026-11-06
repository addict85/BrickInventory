# Begründungen zu `test/stille-schnitte.test.js`

Die ausführlichen Kommentare aus `test/stille-schnitte.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Kein Testausschnitt, auf dem NUR verneinende Zusicherungen stehen, darf
ungesichert geschnitten sein.

── Woher das kommt ─────────────────────────────────────────────────────────
Die Tests dieses Baums lesen Quelltext und schneiden Ausschnitte heraus:

    const fn = src.slice(src.indexOf('async function x'), …);

Fehlt der Ankertext, liefert indexOf -1, und `slice(-1)` gibt EIN Zeichen.
Was danach kommt, entscheidet, ob das auffaellt:

    assert.match(fn, …)         auf leerem Text ROT   -> faellt auf
    assert.ok(fn.includes(…))   auf leerem Text ROT   -> faellt auf
    assert.doesNotMatch(fn, …)  auf leerem Text GRUEN -> SCHWEIGT

Nachgemessen: 106 solche Schnitte, davon 101 mit mindestens einer positiven
Zusicherung — die melden sich selbst. Vier trugen ausschliesslich
`doesNotMatch`. Sie sind auf abschnitt() umgestellt, das bei fehlendem Anker
wirft.

── Warum das kein erfundenes Risiko ist ────────────────────────────────────
Genau dieser Fall ist in dieser Sitzung eingetreten: Beim Verschieben von
estimateFigPriceFromParts nach src/finanzen/marketPrice.ts zeigten mehrere Schnitte
ins Leere. Sie fielen auf, WEIL dort `assert.match` stand. Haette an einer
dieser Stellen `doesNotMatch` gestanden, waere sie gruen geblieben — und
niemand haette gemerkt, dass sie seither nichts mehr prueft.

Ausfuehren: npm test
```

<a id="abgeleitet"></a>
## `const abgeleitet = new RegExp('(\\w+)\\s*=\\s*${ziel}\\.indexOf\\(', '`

```text
── Doch abgesichert? ──────────────────────────────────────────────────
Manche Stellen pruefen nicht den Ausschnitt selbst, sondern einen
daraus abgeleiteten Index (`assert.ok(iCache > 0 …)`). Auf leerem Text
ist der -1, und die Zusicherung faellt — das genuegt.
Genau so ein Fall ist img-proxy.test.js; ihn zu melden waere ein
Fehlalarm gewesen.
```
