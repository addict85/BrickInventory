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

<a id="ohnekommentare"></a>
## `const ohneKommentare = (s) => {`

```text
Kommentare raus — zeilenweise, NICHT ueber einen Regex auf /* … *\/.

Der erste Anlauf tat genau das und loeschte 15 000 Zeichen mitten aus
server.ts: Die Datei enthaelt Routen wie `'/data/instructions/*'`, und das
`/*` darin gilt dem Regex als Kommentaranfang. Alles bis zum naechsten
`*\/` war weg — samt des Kopfzeilen-Blocks, um den es hier geht.

Aufgefallen ist es nur, weil der letzte Test unten prueft, dass die
UEBRIGEN Kopfzeilen noch da sind. Ohne diesen Selbstbeweis waeren alle
Zusicherungen an einer leeren Stelle gelaufen und haetten geschwiegen.

Zeilenweise geht, weil dieser Baum Blockkommentare immer am Zeilenanfang
beginnt. Ein Zaehler haelt fest, dass ueberhaupt etwas uebrig bleibt.
```

<a id="stelle"></a>
## `assert.ok(server.length > serverRoh.length * 0.25,`

```text
Selbstbeweis, aus dem Fehler oben geboren: Bleibt nach dem Streichen zu
wenig uebrig, laufen alle Zusicherungen ins Leere und schweigen.
Die Schwelle ist GEMESSEN, nicht geraten: server.ts besteht zu rund 55%
aus Erklaerung — Hausstil, kein Zufall. Der erste Entwurf stand auf 50%
und war damit selbst rot, obwohl der Filter richtig arbeitete. 25% faengt
„der Filter frisst Code" und laesst einen kommentierten Baum in Ruhe.
```

<a id="stelle-2"></a>
## `assert.ok(server.includes("setHeader('X-Frame-Options'"),`

```text
Und die Gegenprobe dazu: Eine Groessenangabe allein sagt nichts darueber,
WAS uebrig ist.

Als Marke steht hier NUR X-Frame-Options — bewusst etwas, das dieser Test
nicht prueft. Der erste Entwurf nannte auch Strict-Transport-Security, und
dann meldete das Entfernen der Kopfzeile „hat das Streichen der Kommentare
nicht ueberlebt": die falsche Ursache, die den naechsten Leser in die
falsche Datei schickt. Ein Selbstbeweis prueft das WERKZEUG, nicht den
Gegenstand der Pruefung — sonst nimmt er ihm die Stimme.
```
