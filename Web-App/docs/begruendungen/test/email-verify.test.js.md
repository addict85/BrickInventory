# Begründungen zu `test/email-verify.test.js`

Die ausführlichen Kommentare aus `test/email-verify.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die E-Mail-Verifikation steht nur noch an EINER Stelle.

── Der Befund (Nachtrag 154) ───────────────────────────────────────────────
Dieselben acht Zeilen standen zweimal im Baum: in server.ts unter
`GET /verify` (der Link aus der Mail) und in routes/auth.ts unter
`GET /api/auth/verify`. Beide Kopien trugen die Hash-Regel, die
Ablaufprüfung und das Abräumen der Token-Felder. Wer eine änderte, übersah
die andere — und gemerkt hätte man es erst, wenn ein Nutzer sich nicht mehr
verifizieren kann.

Diese Regel hält fest, dass die Zusammenführung hält. Sie prüft die
ABSICHT, nicht den Wortlaut: dass die Abfrage genau einmal vorkommt und
dass beide Routen die gemeinsame Funktion rufen — nicht, wie deren
Signatur ausbuchstabiert ist.
```

<a id="stelle"></a>
## `});`

```text
── „der API-Weg antwortet NICHT mit einer Weiterleitung" ist entfallen ──

Der Untertest hielt fest, dass GET /api/auth/verify mit JSON antwortet
statt mit res.redirect — ein Programm-Aufrufer bekaeme sonst die ~189 KB
index.html. Die Route ist entfernt, weil sie keinen Aufrufer hatte; die
Regel darueber, die eine zweite Fassung der Logik verbietet, deckt den
Rueckfall ab.
```
