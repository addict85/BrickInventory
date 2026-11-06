# Begründungen zu `test/sitzung-leerlauf-db.test.js`

Die ausführlichen Kommentare aus `test/sitzung-leerlauf-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Eine Webapp-Sitzung ohne Betrieb läuft ab — eine mit Betrieb nicht.

── Marcos Vorgabe ──────────────────────────────────────────────────────────

„webapp-session sollten sich nach ein paar Stunden inaktivität bereits
ausloggen."

── Was vorher galt (nachgesehen, nicht vermutet) ───────────────────────────

Keine Leerlauf-Frist. Das Cookie trägt bewusst kein `maxAge`, stirbt also
erst beim Schliessen des Browsers; serverseitig lebte die Zeile EINEN TAG,
und dieser Tag war nicht gewählt, sondern die Voreinstellung von
connect-pg-simple, die greift, weil das Cookie kein `maxAge` hat.

── Warum hier zwei Zusicherungen stehen und nicht eine ─────────────────────

Eine Frist, die zu scharf greift, sieht in der ersten Zusicherung besser aus
und ist kaputt: Würde die Sitzung IMMER nach der Frist sterben, egal wie
aktiv jemand ist, wäre „verfällt ohne Betrieb" grün — und die Webapp
unbenutzbar. Also beides, und das zweite ist das wichtigere.

Dieselbe Falle wie bei test/sitzung-beruehrung-db.test.js: Dort wäre „gar
nicht mehr schreiben" die beste Note für die Drosselung gewesen.

── Die Kopplung, die dieser Test festhält ──────────────────────────────────

Gedrosselt wird das NACHFÜHREN des Ablaufs (src/konto/sitzungsBeruehrung.ts).
Ist die Drosselung länger als die Leerlauf-Frist, wird der Ablauf nie
rechtzeitig nachgeführt — dann fliegt der ARBEITENDE Benutzer heraus, nicht
der untätige. Bei vier Stunden Frist und fünf Minuten Drosselung fällt das
nicht auf; bei `SESSION_IDLE_MINUTES=2` wäre es sofort da. Darum ist
BERUEHREN_MS seit dieser Änderung höchstens ein Viertel der Frist, und der
dritte Fall hier prüft genau dieses Verhältnis.

── Warum echte Zeit und keine zurückgedatete Zeile ─────────────────────────

Ein `UPDATE user_sessions SET expire = …` in die Vergangenheit hätte den
Ablauf vorgetäuscht und dabei die eigentliche Frage übersprungen: ob das
`ttl` überhaupt in der Zeile landet. Hier läuft die Frist wirklich ab —
mit zwei Sekunden statt vier Stunden, messbare Dauer.

── Warum die Reserve ZWEI Sekunden ist und nicht 0,4 ───────────────────────

Die erste Fassung nahm 1,2 s Frist und wartete 1,6 s. Sie war WACKELIG —
drei Läufe grün, der vierte rot, bei unverändertem Code. Der Grund steht
in connect-pg-simple/index.js und ist keine Vermutung:

    Zeile  37   const currentTimestamp = () => Math.ceil(Date.now() / 1000)
    Zeile 299   expire = Math.ceil(Date.now() / 1000 + ttl)
    Zeile 364   … WHERE sid = $1 AND expire >= to_timestamp($2)

BEIDE Seiten des Vergleichs sind auf ganze Sekunden AUFGERUNDET. Ob die
Sitzung nach dem Warten noch gilt, hängt damit daran, wo im Sekundentakt
das Anmelden lag:

    Anmelden bei t=1000,0 → expire = ceil(1001,2) = 1002
                            Lesen bei 1001,6 → ceil = 1002 → 1002 >= 1002
                            → Sitzung gilt NOCH, der Fall wird rot
    Anmelden bei t=1000,5 → expire = ceil(1001,7) = 1002
                            Lesen bei 1002,1 → ceil = 1003 → abgelaufen
                            → der Fall wird grün

Eine Reserve unter einer Sekunde kann die Rundung also auffressen. Mit
ganzzahliger Frist und zwei Sekunden Reserve geht die Rechnung in JEDEM
Fall auf: expire = ceil(t+5) liegt höchstens bei t+6, gelesen wird bei
t+7, und ceil(t+7) ist immer grösser als t+6.

Das ist der Grund, warum hier keine krummen Millisekunden stehen. Eine
Prüfung, die vier von fünf Mälen grün ist, misst nichts — sie würfelt.
```

<a id="after"></a>
## `after(async () => {`

```text
Aufräumen — und zwar in `after`, nicht am Ende eines Falls.

Der erste Versuch liess den Verbindungspool offen. `node --test` beendet
den Prozess erst, wenn kein Handle mehr offen ist: Die Prüfung lief
durch, meldete nichts und HÄNGTE dann — nach fünf Minuten abgebrochen,
ohne eine einzige Zeile Ausgabe. Das sah nach einer Endlosschleife im
Code aus und war ein offener Pool.

test/sitzung-beruehrung-db.test.js schliesst ihn im `finally` seines
einzigen Falls. Hier sind es vier; der Haken gehört also nach `after`,
sonst risse der erste Fall den Teppich unter den übrigen weg.
```
