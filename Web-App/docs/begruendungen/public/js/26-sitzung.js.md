# Begründungen zu `public/js/26-sitzung.js`

Die ausführlichen Kommentare aus `public/js/26-sitzung.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abonniere"></a>
## `abonniere`

```text
Antwortet der Server mit 401, ist die Sitzung nicht mehr gültig.

── Woher das kommt ─────────────────────────────────────────────────────────
Bisher wurde daraus ein Hinweis pro Klick („Nicht angemeldet"), während die
Oberfläche weiter alte Daten zeigte und sich nicht mehr bedienen liess. Die
Android-App macht es längst richtig: Ihr Interceptor meldet jeden 401, die
App zeigt „Sitzung abgelaufen" und führt zurück zur Anmeldung.

Wahrscheinlicher geworden ist der Fall durch die Sitzungs-Bereinigung beim
Passwortwechsel: Seitdem verwerfen alle drei Passwort-Wege sämtliche
Sitzungen des Kontos — offene Tabs auf anderen Geräten landen also genau
hier.

Zwei Ausnahmen:
  • /v1/auth/me beantwortet die Frage „bin ich angemeldet?" — ein 401 ist dort
    die normale Antwort für „nein" und wird von checkAuth() behandelt.
  • /v1/auth/login meldet mit 401 ein falsches Passwort; die Anmeldemaske steht
    dann ohnehin schon auf dem Schirm.
```

<a id="setauslink"></a>
## `setAusLink`

```text
── Direktlink aus der Preisalarm-Mail: ?set=<nummer> ────────────────────

Marcos Wunsch vom 25.09.: „Bei den Mails waere es schoen wenn es ebenfalls
einen direkt link auf die Webapp mit dem entsprechenden Set geben wuerde."

── Ein Fehler von mir, hier behoben ──────────────────────────────────────

Der Knopf in der Mail zeigt seit dem 25.09. auf genau diese Adresse
(src/infra/mailer.ts, baueAlarmMail) — nur hat sie niemand gelesen. Ich habe
den Link eingebaut, ohne zu pruefen, ob die Webapp ihn versteht; er
oeffnete bis hierher bloss die Startseite. Erst diese Zeilen machen ihn
wahr.

── Warum in showApp() und nicht im Prüfblock oben ────────────────────────

Der Block, der `verified` und `token` liest, läuft beim LADEN — da ist
niemand angemeldet, und openModal() holte /v1/sets/… ohne Sitzung. Hier
steht fest, dass die Anwendung offen ist.

Die Adresse wird gleich bereinigt: Ein F5 soll das Detail nicht erneut
aufreissen, und ein weitergegebener Link soll nicht dauerhaft auf ein
fremdes Set zeigen.
```
