# Begründungen zu `test/apk-download.test.js`

Die ausführlichen Kommentare aus `test/apk-download.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Download-Knopf zeigt dorthin, wo der Workflow das APK wirklich ablegt.

── Marcos Auftrag vom 26.09. ───────────────────────────────────────────────

  „Kannst du in der Webapp unter Einstellungen wo man den QR-Code erstellen
   kann einen Download-Android-App-Button einfügen […] der die aktuellste
   Android App Version von GitHub herunterlädt?"

── Warum das eine Regel braucht ────────────────────────────────────────────

Dieselbe Adresse steht jetzt an DREI Stellen, in drei Sprachen:

  1. android.yml         — legt das APK dort ab (Etikett und Dateiname)
  2. AppUpdate.kt        — die App holt sich von dort ihre Aktualisierung
  3. index.html          — der Knopf, um den es hier geht

Eine Adresse in drei Sprachen lässt sich nicht zusammenlegen; ein Konstante
in Kotlin ist im Markup nicht lesbar. Was geht, ist sie zu VERGLEICHEN.

Und das ist kein Formalismus: Ein Download-Knopf ist die eine Art von
Fehler, die niemand bemerkt. Wer die Webapp benutzt, hat die App schon; wer
sie noch nicht hat, klickt einmal, bekommt die 404-Seite von GitHub und
fragt nicht nach. Änderte jemand das Etikett `apk-neuste` im Workflow, liefe
die App weiter (sie trägt die Adresse in sich) und nur der Knopf zeigte ins
Leere — genau die Kombination, die lange unentdeckt bleibt.
```
