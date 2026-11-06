# Begründungen zu `test/mail-sprache.test.js`

Die ausführlichen Kommentare aus `test/mail-sprache.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Jede Mail geht in der Sprache ihres EMPFÄNGERS hinaus — und sieht aus wie
die anderen.

── Marcos Fragen vom 25.09. ────────────────────────────────────────────────

  „Kannst du die Mail noch etwas schöner gestalten analog der E-Mail
   Bestätigen Mail?"
  „Werden alle E-Mails in der eingestellten Sprache des Benutzers
   versendet?"

Auf die zweite Frage war die Antwort NEIN, an drei Stellen:

  1. sendPasswordResetMail() kannte gar keine Sprache — sie ging immer
     deutsch hinaus.
  2. Der E-Mail-Wechsel rief sendVerificationMail() OHNE `lang` und fiel
     damit auf die Vorgabe zurück, während derselbe Versand bei der
     Registrierung sie längst mitgab.
  3. Die Alarmmail konnte beide Sprachen, war aber die einzige ohne Hülle.

── Warum eine Regel und nicht nur der Fix ──────────────────────────────────

Alle drei sind derselbe Fehler in drei Ausprägungen: Eine Mail entsteht,
und niemand fragt, wer sie liest. Das fällt nicht auf — in einem Baum, der
auf Deutsch geschrieben ist, sieht eine deutsche Mail immer richtig aus.
Gemeldet hat es der einzige, der Englisch eingestellt haben könnte.
```
