# Begründungen zu `test/setnummer-korpus.test.js`

Die ausführlichen Kommentare aus `test/setnummer-korpus.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der GEMEINSAME Korpus: Web-App und Android-App müssen dieselbe Setnummer
lesen.

── Der Befund ──────────────────────────────────────────────────────────────

Dieselbe Frage — „welche Zahl in diesem Text ist die Setnummer?" — wird
zweimal beantwortet: hier in `src/katalog/produkttitel.ts` für Händlertitel, und
in Kotlin (`setNumberCandidates`) für die Texterkennung. Ein gemeinsamer
Aufruf geht nicht: Die App liest offline in der Kameraschleife.

NACHGEMESSEN, bevor es diesen Korpus gab:

  Regel                                    Server   App
  Mengenangabe („3696 Pcs") aussortieren     ja     NEIN
  Jahreszahl zurückstufen                    ja     NEIN
  nach Stellenzahl ordnen (5, 4, 6, 7)      NEIN     ja
  dreistellige Setnummern (375, 928)        NEIN    NEIN

Zwei Fassungen, zwei verschiedene Antworten — und beide verfehlten alte
dreistellige Sets vollständig („928 GALAXY EXPLORER" → gar kein Kandidat).

── Warum gesucht und nicht aufgezählt ──────────────────────────────────────

Die Fälle stehen in shared/setnummer-korpus.json, samt Begründung je Fall.
Ein neuer Fall wird EINMAL eingetragen und prüft ab sofort beide Apps; die
```
