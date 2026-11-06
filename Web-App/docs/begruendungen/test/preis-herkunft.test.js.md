# Begründungen zu `test/preis-herkunft.test.js`

Die ausführlichen Kommentare aus `test/preis-herkunft.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="wurzel"></a>
## `const WURZEL = path.join(__dirname, '..');`

```text
Der Kaufpreis wird uebernommen — und seine Herkunft benannt.

── Zwei Befunde, eine Tatsache (Nachtrag 167) ──────────────────────────────
BrickLink fuehrt zu vielen Teilen und Figuren nur EINEN Zustand. Daraus
folgten Marcos zwei Meldungen, die sich zu widersprechen schienen:

  „Der Zustand hat keinen Einfluss auf den Preis"  — der Rueckfall war unsichtbar
  „Teilweise wird der Kaufpreis nicht geladen"     — ohne Rueckfall blieb es leer

Seine Entscheidung: uebernehmen UND kennzeichnen. Dieser Test haelt beide
Haelften fest — denn genau eine davon wegzulassen ist der Rueckfall in je
einen der beiden Fehler.
```

<a id="src-stelle"></a>
## `const src = lies('src/finanzen/marketPrice.ts');`

```text
── Ein Fundort statt zwei ───────────────────────────────────────────────
Die beiden Preisabrufe standen in routes/parts.ts und routes/minifigs.ts —
dieselbe Frage, zweimal beantwortet, und dieser Test las folgerichtig
zweimal. Seit dem Schichtumbau stehen BEIDE in src/finanzen/marketPrice.ts, beim
Marktpreis der Sets. Zwei Vorkommen in EINER Datei sind jetzt der richtige
Nachweis; ihre Zahl steht ausdruecklich da, damit das Verschwinden eines
der beiden auffaellt.
```

<a id="fc-stelle"></a>
## `const fc = require('./helpers/sources').finanzQuelle();`

```text
── Uebernommen aus test/zustand-kein-rueckfall.test.js ───────────────────

Jene Datei sicherte die Regel aus Nachtrag 166 („einen Rueckfall gar nicht
erst annehmen"). Die hat Marco mit seiner Entscheidung ersetzt, und ein
Test, der das Gegenteil des Gewollten festhaelt, ist schlimmer als keiner.

DIESE Zusicherung ueberlebt den Wechsel — sie wird sogar wichtiger: Ohne
`is_fallback` wuesste niemand, dass der Preis aus dem anderen Zustand
stammt, und die Kennzeichnung fiele lautlos weg. Aus einer Bedingung des
Verwerfens ist die Grundlage des Benennens geworden.
```
