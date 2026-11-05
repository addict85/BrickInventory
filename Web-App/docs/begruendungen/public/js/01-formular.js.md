# Begründungen zu `public/js/01-formular.js`

Die ausführlichen Kommentare aus `public/js/01-formular.js` (bis zur Teilung in `public/js/01-core.js`), wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="passwort-min-zeichen"></a>
## `PASSWORT_MIN_ZEICHEN`

```text
Wie kurz ein Passwort hoechstens sein darf — dieselbe Zahl wie im Server
(PASSWORT_MIN_ZEICHEN in src/konto/auth.ts) und in der App.

Sie steht hier ZUSAETZLICH und nicht statt dessen: Der Server ist die
Instanz, die es durchsetzt, der Browser der, der es dem Nutzer sagt, bevor
er auf Speichern drueckt. Dass sie damit an drei Orten steht, ist
unvermeidbar (drei Laufzeiten) — test/passwortlaenge.test.js haelt sie
zusammen, damit aus „unvermeidbar" nicht „auseinandergelaufen" wird.
```

<a id="passwortzukurz"></a>
## `passwortZuKurz`

```text
Ist dieses Passwort zu kurz?

── Warum es das hier ueberhaupt gibt ───────────────────────────────────────
Nachgemessen: Die Webapp prueft die Laenge an KEINER ihrer fuenf Stellen,
die ein Passwort setzen (Registrieren, Zuruecksetzen, Aendern, Konto
anlegen, Konto-Passwort zuruecksetzen). Die Android-App prueft sie in ihrer
Oberflaeche sehr wohl (SettingsScreen, LoginScreen) — die beiden
Oberflaechen verhielten sich also unterschiedlich, und die Webapp lief in
einen Serverfehler, wo die App den Knopf gar nicht erst freigibt.
```
