# Begründungen zu `jobs/startNachlaeufe.ts`

Die ausführlichen Kommentare aus `jobs/startNachlaeufe.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Die drei Nachläufe, die beim Start einmalig aufräumen.

── Warum sie hier stehen und nicht mehr in startup/backgroundJobs.ts ───────

Die Startstaffel gibt es, damit die Hintergrundläufe BEIEINANDER stehen —
so steht es in ihrem eigenen Kopfkommentar. Drei von ihnen standen aber
nicht als Aufruf da, sondern als anonymer Block im `setTimeout`:

    setTimeout(async () => { … 16 Zeilen … }, 15000);

Zwei Folgen hatte das. Erstens liest sich die Staffel dadurch als Mischung
aus Fahrplan und Arbeit, und die Blöcke wachsen dort, wo man den Überblick
sucht. Zweitens — und das ist der Anlass — lassen sie sich NICHT ABFANGEN:
test/background-jobs-start.test.js hängt sich an die Modulauflösung, um zu
prüfen, dass jeder Lauf wirklich angestossen wird, ohne ihn auszuführen. Was
kein Modul ist, läuft dort echt mit — gegen die Testdatenbank, und nach dem
Testende gegen einen bereits geschlossenen Verbindungspool:

    Thumb gen error: Cannot use a pool after calling end on the pool

Als Modulfunktionen sind sie abfangbar wie die anderen auch. Die Rümpfe sind
WORTGLEICH übernommen; es wurde nichts umgestellt und nichts weggelassen.
```
