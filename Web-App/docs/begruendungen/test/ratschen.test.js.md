# Begründungen zu `test/ratschen.test.js`

Die ausführlichen Kommentare aus `test/ratschen.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="stelle"></a>
## `/** Alle TypeScript-Quellen ohne Tests und ohne Erzeugnisse. */`

```text
Ratschen: Ein gemessener Bestand darf sinken, nie steigen.

Für Dinge, die zu zahlreich sind, um sie auf einmal aufzuräumen (stille
Fänge, `any`, reine Quelltext-Tests, Kommentaranteil …). Eine harte Regel
wäre sofort rot und bräuchte eine Ausnahmeliste, die niemand mehr liest;
die Ratsche gibt neuem Code den höheren Anspruch, ohne den Bestand
anzufassen. Wer eine Stelle aufräumt, senkt die Schranke hier.
```

<a id="zaehle"></a>
## `function zaehle(muster) {`

```text
Treffer zaehlen — im CODE, nicht in den Erklaerungen darueber.

── Warum ohneKommentare() ──────────────────────────────────────────────────

Diese Ratsche schlug an, als jemand in einem Kommentar BEGRUENDETE, warum er
an einer Stelle KEIN `as any` schreibt. Der Zaehler stieg um zwei, obwohl im
Code eines weniger stand.

Das ist kein Randfall, sondern die Regel, die sich selbst im Weg steht: Eine
Ratsche, die Erklaerungen mitzaehlt, bestraft genau das Verhalten, das sie
erreichen will — sie macht das Aufschreiben der Begruendung teurer als das
stille Hinnehmen. Derselbe Fehler steckte in diesem Baum schon in
design-haftung, noppe-design und csv-prototyp; er faellt jedes Mal erst auf,
wenn jemand die Regel dokumentiert.
```
