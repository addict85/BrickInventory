# Begründungen zu `test/passwortfelder-im-formular.test.js`

Die ausführlichen Kommentare aus `test/passwortfelder-im-formular.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Passwortfelder gehören in ein <form> — und das Absenden darf nichts laden.

── Marcos Browserfenster ───────────────────────────────────────────────────

    [DOM] Password field is not contained in a form: (More info: <URL>)   ×13

Kein Fehler, ein Hinweis — aber einer mit Folgen: Ohne umgebendes Formular
entscheidet der Browser nach Heuristik, ob der Passwortmanager Speichern
und Ausfüllen anbietet. Mal ja, mal nein, und niemand kann sagen warum.
Betroffen waren Anmeldung, Registrierung, Passwort-Zurücksetzen,
Passwort ändern, Benutzer anlegen und der Zurücksetzen-Dialog.

── Warum nicht alle dreizehn ───────────────────────────────────────────────

Fünf bleiben bewusst draussen: `bl-cs`, `bl-ts` (BrickLink-Zugangsdaten),
`rb-key`, `bs-key` (Rebrickable, Brickset; seit dem 29.10. verdeckt) und
`smtp-pass`. Das sind SCHNITTSTELLEN-Geheimnisse, keine Passwörter
eines Menschen — sie tragen `autocomplete="off"`, und ein Formular drumherum
lüde den Passwortmanager dazu ein, sie als Anmeldedaten zu speichern. Der
Hinweis in der Konsole ist dort das kleinere Übel. Diese Prüfung hält beide
Seiten fest, damit die Entscheidung nicht versehentlich gekippt wird.

── Was beim Absenden passieren muss ────────────────────────────────────────

Nichts. Die Oberfläche spricht über fetch() mit dem Server; ein echtes
Absenden lüde die Seite neu und verlöre den Zustand. Der delegierte
Lauscher in js/11-actions.js bricht deshalb ab und drückt stattdessen den
Knopf, den `data-submit` nennt — womit die EINGABETASTE im Passwortfeld
endlich anmeldet, statt nichts zu tun.

Die Knöpfe tragen `type="button"`. Ohne das wären sie Absendeknöpfe, ihr
Klick löste wieder ein submit aus, und der Lauscher drehte sich im Kreis.
Genau das prüft der dritte Fall.
```
