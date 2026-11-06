# Begründungen zu `test/portfolio-history-db.test.js`

Die ausführlichen Kommentare aus `test/portfolio-history-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Portfolio-Kurve: Rechnet die SQL-Fassung dasselbe wie eine unabhängige
JavaScript-Fassung derselben Regel?

── Warum dieser Test die Vergleichsfassung selbst mitbringt ────────────────
Die Rekonstruktion liegt in der Datenbank (Fortschreibung über Differenzen
statt über ein carry-Objekt). Ein Test, der nur „liefert Punkte" prüft,
würde eine verschobene Kurve nicht bemerken. Deshalb steht die Regel hier
ein zweites Mal, geradeheraus in JavaScript, und beide müssen auf denselben
Daten dasselbe ergeben.

Die Vergleichsfassung ist bewusst eine Kopie und kein Import: Sie soll sich
NICHT mitändern, wenn jemand die Umsetzung anfasst.

── Die Regel hat sich geändert (Nachtrag 82, Marcos Fund) ──────────────────
„Neu hinzugefügte Sets sollen nicht dazu führen, dass sich der %-Wert
ändert. Die +850.2% sind offensichtlich nicht korrekt."

Vorher zeigte die Kurve „Wert dessen, was zu diesem Zeitpunkt erfasst WAR" —
ein Set trat an dem Tag in die Summe ein, an dem sein Preisverlauf begann.
Wer an einem Tag zwei Dutzend Sets erfasste, sah dort einen Sprung, und die
Prozentzahl daneben meldete den Zuwachs der SAMMLUNG als Wertentwicklung.

Jetzt zeigt sie „was der HEUTIGE Bestand über die Zeit wert gewesen wäre":
Jedes Set steht mit seinem ERSTEN bekannten Preis von Anfang an im Korb.
Die Vergleichsfassung unten bildet genau das ab — der Unterschied zur
früheren ist die Vorbelegung von `carry`.

Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
Ohne DB: skip.
```

<a id="c0-stelle"></a>
## `const c0 = await db.pool.connect();`

```text
── Und die Migrationen, nicht nur das Schema ────────────────────────────

Diese Datei baut die Datenbank von null auf und liess sie danach auf dem
Stand von db/schema.sql stehen — also VOR allen Migrationen. Das ist
nicht nur fuer sie selbst falsch, sondern fuer jede Datei danach: Sie
erbt eine halbe Datenbank.

GEMESSEN: Nach dem Umzug der Setmenge (Migration 0036) hatte
db/schema.sql noch `sets.quantity DEFAULT 1`, die Erfassungen hier
tragen `1 + (g%3)`. Die naechste Datei, die die Migrationen laufen liess
(test/portfolio-scope-db.test.js), brach ab: „Bei 20 Set-Zeilen weicht
sets.quantity von der Summe der Erfassungen ab". Der Riegel hatte recht
— die beiden Zahlen WAREN verschieden.
```

<a id="stelle"></a>
## `await db.run(`

```text
30 Sets, hälftig auf zwei Haushaltskonten, verschiedene Mengen.
Nur die Bestandszeilen; die Mengen stehen in den Erfassungen weiter unten
(Migration 0036). `1 + (g%3)` taucht dort genauso auf — dieselbe Formel,
und das ist der Punkt: Sie MUSS uebereinstimmen, sonst gewichtet
portfolioHistory.ts anders als die Kurve, die dieser Test vergleicht.
Hier stand sie zusaetzlich in der Spalte, also dreimal.
```
