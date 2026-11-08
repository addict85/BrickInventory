# Begründungen zu `test/review-131.test.js`

Die ausführlichen Kommentare aus `test/review-131.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Prüfungen aus dem Review-Durchgang hardened-131.

Zwei Sorten, bewusst getrennt gehalten:
  - Verhalten gegen echte Datenbank: die Teile-Rückfallebene für Sets, zu
    denen der Nutzer selbst nichts erfasst hat.
  - Regeln am Quelltext dort, wo sich Verhalten nur mit Netzzugriff oder
    einem Prozessabbruch prüfen liesse (Weiterleitungsgrenze, Fail-fast,
    Drossel). Kommentare werden vorher ausgeblendet — sonst hält der
    Erklärtext über einer Regel die Prüfung selbst grün.
```

<a id="src-stelle"></a>
## `const src = ohneKommentare(require('./helpers/sources').anmeldeQuelle(`

```text
routes/auth.ts ist der einzige Router ohne durchgehendes requireLogin —
hier stehen die Endpunkte, die naturgemäss vor der Anmeldung erreichbar
sind. Jeder schreibende darf entweder eine Anmeldung verlangen (per
Middleware oder im Rumpf), oder er zählt Versuche je IP. qr-login hatte
als einziger keins von beidem.

pruefeAnmeldedaten steht in der Liste, seit die Anmeldung dorthin
zusammengezogen ist: Die Drossel (checkLoginAllowed) sitzt jetzt IN dieser
Funktion, POST /login ruft sie über anmelden() auf. Ohne den Eintrag würde
ausgerechnet das Zusammenlegen als ungeschützter Endpunkt gemeldet.
```
