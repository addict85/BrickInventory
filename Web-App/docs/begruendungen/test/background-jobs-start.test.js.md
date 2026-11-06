# Begründungen zu `test/background-jobs-start.test.js`

Die ausführlichen Kommentare aus `test/background-jobs-start.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Start des Job-Prozesses trägt jede Hintergrundarbeit als Auftrag ein.

Seit Nachtrag 139 gilt: Ein Start muss WIRKLICH ankommen, nicht nur im
Quelltext stehen (damals warfen alle Aufrufe still in einem catch). Mit den
Aufträgen ist das in der Datenbank abzulesen: Nach starteJobs() steht jede
geplante Art mit ihrem Termin da, der Katalogabgleich ist sofort fällig, und
jeder Nachlauf ist einmal eingestellt. Der Worker selbst wird abgefangen —
geprüft wird, was er vorfände.
```
