# Begründungen zu `core-sicherheit/sicherheit/Passwort.kt`

Die ausführlichen Kommentare aus `core-sicherheit/src/main/java/ch/brickinventoryapp/sicherheit/Passwort.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="passwort-min-zeichen"></a>
## `PASSWORT_MIN_ZEICHEN`

```text
Die Mindestlaenge eines Passworts — an einer Stelle.

── Woher diese Datei kommt ─────────────────────────────────────────────────
Die Zahl stand in dieser App ZWEIMAL, jedes Mal von Hand getippt:
SettingsScreen (Passwort aendern, dreimal in derselben Ansicht) und
LoginScreen (Registrieren). Im Server stand sie viermal, und an zwei der
sechs Stellen, die ein Passwort setzen, fehlte sie ganz — genau deshalb, weil
es keine Konstante gab: Wo eine Regel an jeder Stelle neu getippt wird, gibt
es keine Stelle, die man vergessen KOENNTE.

── Dass sie trotzdem dreimal existiert ─────────────────────────────────────
Server (utils/auth.ts), Webapp (public/js/01-core.js) und App teilen keinen
Code — drei Laufzeiten, drei Fassungen. Das ist unvermeidbar; das
Auseinanderlaufen ist es nicht. Web-App/test/passwortlaenge.test.js liest
alle drei Zahlen aus den Quellen und vergleicht sie.

── Und wofuer die Oberflaeche sie braucht ──────────────────────────────────
Der Server ist die Instanz, die die Regel DURCHSETZT. Die Oberflaeche sagt
sie dem Nutzer, bevor er auf Speichern drueckt — sonst kostet ein Tippfehler
eine Runde ueber das Netz.
```
