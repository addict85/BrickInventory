# Begründungen zu `test/forgot-password-db.test.js`

Die ausführlichen Kommentare aus `test/forgot-password-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Passwort-vergessen gegen echte Datenbank: E-Mail-Vergleich ohne Beachtung
der Gross-/Kleinschreibung.

── Warum es diese Datei gibt ───────────────────────────────────────────────
Login, Registrierung und Profil vergleichen E-Mails seit jeher mit
LOWER(...) auf beiden Seiten. forgot-password war der EINZIGE Weg mit einem
case-sensitiven Vergleich (`WHERE email = $1`). Wer sich als
"Marco@Example.CH" registriert hatte und im Formular "marco@example.ch"
tippte, bekam die (bewusst neutrale) Erfolgsmeldung — aber nie eine Mail:
kein Treffer, kein Token, kein Versand. Von aussen war das nicht von Erfolg
zu unterscheiden; der Nutzer ist ohne erkennbaren Grund ausgesperrt.

Das ist das wiederkehrende Muster "eine Regel fehlt an einem ZWEITEN Weg" —
und wie immer braucht sie einen VERHALTENStest: Eine Quelltext-Prüfung auf
LOWER( im richtigen Statement wäre dieselbe Sorte Test, die Lücken auch
festschreiben kann. Hier läuft die echte Route gegen die echte Tabelle, und
geprüft wird, ob der reset_token GESETZT wurde.
```
