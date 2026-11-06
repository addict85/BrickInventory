# Begründungen zu `test/alarm-mail-knopf.test.js`

Die ausführlichen Kommentare aus `test/alarm-mail-knopf.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Knopf „Set ansehen" in der Preisalarm-Mail — und was passiert, wenn er
nicht gebaut werden kann.

── Marcos Befund vom 25.09. ────────────────────────────────────────────────

  „In der Email vom Preisalarm finde ich den direkten Link nicht."

Er hatte recht. Der Knopf erscheint nur, wenn APP_BASE_URL gesetzt ist — und
das ist richtig so: Der Preislauf hat keine Anfrage, aus der sich ein Host
ableiten liesse, und ein geratener Link in einer Mail ist schlechter als
kein Knopf. Die Verifizierungsmail darf den Host-Header nehmen, weil sie aus
einer Anfrage entsteht; hier gibt es keine.

Falsch war, dass es WORTLOS geschah. Aus Sicht des Empfängers fehlte das
Merkmal einfach, aus Sicht des Betreibers gab es nichts nachzusehen.

── Warum das hier eine ECHTE Prüfung ist und keine Quelltextsuche ──────────

baueAlarmMail() lässt sich aufrufen: getMailTheme() fängt seinen eigenen
Fehler und fällt auf das Standard-Design zurück, es braucht also keine
Datenbank. Damit lässt sich die Frage so stellen, wie Marco sie gestellt
hat — „ist der Link in der Mail?" —, statt sie auf „steht das Muster im
Quelltext?" zu verbiegen.
```

<a id="stelle"></a>
## `delete process.env.APP_BASE_URL;`

```text
Zwei Aussagen in EINEM Schritt, und das ist kein Zusammenlegen aus
Bequemlichkeit: Der Hinweis faellt genau EINMAL je Prozess, also muss
der erste Aufruf ohne Basis-URL beide Fragen beantworten. Ein zweiter
Schritt davor haette den Merker verbraucht — genau das ist beim ersten
Entwurf passiert, und die Pruefung meldete ein leeres Protokoll.

Ein falscher Host in einer Mail ist schlechter als kein Knopf: Er sieht
aus, als funktioniere er.
```

<a id="4-die-beiden-kacheln-lassen-in-der-mitte"></a>
## `await t.test('4. die beiden Kacheln lassen in der Mitte Platz', async `

```text
── Marcos Befund vom 25.09.: die Kacheln stiessen aneinander ──────────

  „Kannst du die Kacheln Marktpreis und Deine Schwelle etwas kleiner
   machen (weniger Breit) damit es in der Mitte eine Lücke hat?"

Der Abstand war da — aber als Rest: Zwei Zellen zu je 50 % plus 12 Pixel
ergeben mehr als die Tabelle breit ist, und der Mailklient staucht dann,
was er will. Diese Pruefung rechnet die Breiten zusammen. Sie ist damit
etwas anderes als „sieht gut aus": Sie haelt fest, dass die Aufteilung
AUFGEHT — und genau das war der Fehler.
```
