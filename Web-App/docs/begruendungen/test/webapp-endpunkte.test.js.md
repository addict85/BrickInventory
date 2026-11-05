# Begründungen zu `test/webapp-endpunkte.test.js`

Die ausführlichen Kommentare aus `test/webapp-endpunkte.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Jede Adresse, die die Webapp aufruft, muss es auf dem Server geben.

── Warum es diese Prüfung gibt ─────────────────────────────────────────────
Für die Android-App steht das seit test/app-endpunkte.test.js fest — dort
fiel damit eine Methode auf, die auf eine längst gelöschte Route zeigte.
Für die Webapp gab es die Gegenprobe nicht, obwohl das Risiko dort GRÖSSER
ist: Ein falscher Pfad im Browser scheitert erst zur Laufzeit, und etliche
Aufrufe enden auf `.catch(() => null)` — dann fehlt einfach ein Diagramm,
ohne dass irgendwo etwas rot wird.

── Was das Parsen schwierig macht (und schon dreimal danebenlag) ───────────
1. Der Pfad ist oft ein Template-Literal mit VERSCHACHTELTEN Ausdrücken:
   `/v1/parts/${nr}/${farbe}${owner ? `?owner=${owner}` : ''}`
   Wer zuerst am `?` abschneidet, zerschneidet den Ausdruck und behält ein
   `${owner ` übrig. Erst die `${…}` auflösen (innerste zuerst, bis nichts
   mehr passt), DANN am `?` kappen.
2. `fetch()` ist nicht immer GET — die Methode steht im zweiten Argument.
3. Drei Routen stehen direkt in server.ts, nicht in einem Router.
Alle drei Punkte haben beim Nachmessen falsche Treffer erzeugt; sie stehen
hier, damit die nächste Fassung nicht wieder daran scheitert.
```

<a id="pfadformv1"></a>
## `function pfadFormV1(roh) {`

```text
Template-Ausdrücke auflösen, dann den Abfrageteil abschneiden.

Die Auflösung selbst steht seit dem 19.10. in test/helpers/sources.js —
test/frontend-api-paths.test.js brauchte sie auch und hatte eine eigene,
naive Fassung, die bei verschachtelten Ausdrücken Müll lieferte und
trotzdem grün war. Die Begründung, die früher hier stand (drei Anläufe, die
danebenlagen), steht jetzt beim Helfer; hier bleibt nur das Formen der
Platzhalter.
```

<a id="papierkorb"></a>
## `const PAPIERKORB =`

```text
── Und die Gegenrichtung: Was kann nur die Webapp? ─────────────────────────

Die Prüfung oben und app-endpunkte.test.js fragen beide „gibt es die Route?".
Die Frage, die dieses Projekt seit Nachtrag 129 begleitet, ist eine andere:
WELCHE Adresse ruft nur die eine Oberfläche auf — und ist das Absicht?

Sie wurde bisher von Hand beantwortet, bei jeder Messung neu. Genau das ist
die Form, die sich als brüchig erwiesen hat: eine Liste im Kopf, die
niemand nachprüft (siehe die vier toten Ausnahmeeinträge in Nachtrag 158).
Deshalb steht sie jetzt hier, mit Begründung je Eintrag — und der Test
besteht darauf, dass jede Begründung noch einen Gegenstand hat.

NACHGEMESSEN sind es genau diese sieben. Jede ist geprüft worden, nicht
vermutet:
```

<a id="stelle"></a>
## `['/api/v1/sets/:X/instructions',`

```text
── Vier Adressen, die die App KANNTE und nicht mehr aufruft ──────────────

Marcos Ansage: „bitte entferne folgende Punkte aus der Android App:
bricklink.xml Funktionalität aus dem Reiter Teileliste, Teile neu einlesen
auf dem Detail Dialog der Sets, neu laden bei den Anleitungen auf dem
Detail Dialog der Sets."

Das ist ein anderer Grund als bei den zehn darüber: Dort ist die App nie
hingekommen und es gab jeweils ein Argument dafür. Hier war sie schon da,
und der Eigentümer hat sich dagegen entschieden. Der Unterschied gehört
festgehalten — sonst liest der Nächste diese vier als „hat noch niemand
nachgezogen" und baut sie wieder ein.
```
