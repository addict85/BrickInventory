# Begründungen zu `clients/brickset.ts`

Die ausführlichen Kommentare aus `clients/brickset.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="httpsgetonce"></a>
## Abschnitt

```text
Eine Umleitung OHNE Location-Kopfzeile ist nicht befolgbar, und
hier waere sie teuer: `attempt(undefined)` liefe in
https.get(undefined, …), das wirft — AUS EINEM ANTWORT-RUECKRUF
heraus, also nicht mehr im Promise-Rumpf. Damit waere es eine
uncaughtException, und der Handler in server.ts beendet den Worker
(Code 1, der Cluster forkt Ersatz). Also hier abweisen, wo es
entsteht. Zweiter Fundort desselben Musters — der erste war
clients/rebrickable.ts, dort fing ein `new URL()` in einem try
den Fall noch ab.
```

<a id="getinstructions-errmsg"></a>
## `errMsg`

```text
5xx ist ein Fehler der Gegenseite, kein Kontingentproblem.

VORHER wurde JEDER Nicht-200-Status wie eine Kontingentüberschreitung
behandelt: ab in die Warteschlange, nächster Versuch MORGEN. Ein
"502 Bad Gateway" von Cloudflare — Brickset war für ein paar Sekunden
nicht erreichbar — blockierte damit einen Tag lang, und im Monitoring
stand eine Fehlermeldung, die nach einem dauerhaften Problem aussah.

5xx: heute erneut versuchen. 4xx (ausser den oben schon behandelten
429): kein Wiederholversuch, direkt auf die Ersatzquelle — ein
"400 Bad Request" wird morgen nicht besser.
```

<a id="findsetbyquery"></a>
## `findSetByQuery`

```text
Set über eine freie Suchanfrage finden — EAN, Barcode oder Bestellnummer.

Es gab diese Funktion zweimal (getSetByEan und getSetByBarcode), Zeichen für
Zeichen gleich bis auf die Beschriftung in der Logzeile: Brickset kennt für
beides keinen eigenen Parameter, beide schickten dieselbe Volltextsuche.
Jetzt eine Umsetzung mit einer Herkunftsangabe fürs Log; die beiden alten
Namen bleiben als dünne Hüllen erhalten, damit Aufrufer lesbar bleiben.
```
