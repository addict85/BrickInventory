# Begründungen zu `test/hsts.test.js`

Die ausführlichen Kommentare aus `test/hsts.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="wurzel"></a>
## `const WURZEL = path.join(__dirname, '..');`

```text
HSTS — aber nur ueber eine verschluesselte Verbindung.

── Warum die Kopfzeile fehlte, und warum sie hingehoert ────────────────────
Die uebrigen Sicherheitskopfzeilen standen alle da (X-Frame-Options,
X-Content-Type-Options, Referrer-Policy, Permissions-Policy, CSP), nur
Strict-Transport-Security nicht. Ohne sie geht die allererste Anfrage nach
einem getippten Hostnamen im Klartext hinaus — samt Cookie, wenn
COOKIE_SECURE nicht gesetzt ist. Die Umleitung auf https ist die ANTWORT
darauf; da war die Anfrage schon unterwegs.

── Warum dieser Test vor allem die BEDINGUNG prueft ────────────────────────
Derselbe Server laeuft bei vielen im LAN unter http://192.168.x.x:3000.
Ein Browser ignoriert HSTS ueber Klartext zwar — aber sobald derselbe Host
je einmal ueber https erreichbar war, merkt er sich die Regel und verweigert
danach JEDEN http-Zugriff, ein Jahr lang.

Ein Test, der nur „die Kopfzeile ist da" prueft, wuerde die Fassung ohne
Bedingung durchwinken — also genau die, die den LAN-Zugang aussperrt. Er
saehe aus wie eine Absicherung und waere das Gegenteil.
```
