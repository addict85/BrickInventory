# Begründungen zu `utils/sitzungsBeruehrung.ts`

Die ausführlichen Kommentare aus `utils/sitzungsBeruehrung.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Die Ablaufzeit einer Sitzung muss nicht bei JEDER Anfrage neu geschrieben
werden.

── Was gemessen wurde ──────────────────────────────────────────────────────

Zwanzig Anfragen mit Sitzungs-Cookie, Abfragen am Verbindungs-Pool gezählt:

    20x SELECT sess FROM user_sessions WHERE sid = $1 AND expire >= …
    20x UPDATE user_sessions SET expire = … WHERE sid = $1

Also zwei Umläufe je Anfrage — und das gilt für JEDE Anfrage der Webapp,
auch für jedes einzelne Bild einer Galerie. Bei sechzig Kacheln sind das
hundertzwanzig Abfragen allein für die Sitzung, davon sechzig SCHREIBEND,
auf eine Tabelle, die sich alle Cluster-Worker teilen.

Mit dieser Drosselung: 2,0 → 1,1 Abfragen je Anfrage. Die Schreibvorgänge
sind weg bis auf einen je Sitzung und Frist.

── Was NICHT gedrosselt wird ───────────────────────────────────────────────

Das LESEN bleibt. Es ist der Sinn eines gemeinsamen Sitzungsspeichers, und
ein Zwischenspeicher je Worker liesse eine abgemeldete Sitzung überleben:
revokeAllSessions() löscht die Zeile, ein Worker mit Gedächtnis bemerkte das
nicht. Genau der Fall, für den es die Funktion gibt.

── Warum das Schreiben warten darf ─────────────────────────────────────────

express-session ruft touch() bei jeder Anfrage auf, um den Ablauf nach
hinten zu schieben. Die Lebensdauer beträgt einen TAG (Voreinstellung von
connect-pg-simple, da kein cookie.maxAge gesetzt ist). Ob der Ablauf auf die
Sekunde genau nachgeführt wird oder alle fünf Minuten, ändert daran nichts:
Im schlimmsten Fall läuft eine Sitzung fünf Minuten früher ab als nötig —
bei einem Tag Laufzeit.

Dieselbe Entscheidung steht schon in utils/auth.ts für die Tokens:
LAST_USED_THROTTLE, „last_used max. alle 5 Min schreiben". Gleiches Problem,
gleiche Antwort, gleiche Frist.

── Wer das nicht zahlt ─────────────────────────────────────────────────────

Die Android-App: Sie kommt mit Bearer-Token und ohne Cookie, und dann fasst
express-session den Speicher gar nicht erst an — nachgemessen 0 Abfragen bei
20 Anfragen ohne Cookie.
```

<a id="beruehren-ms"></a>
## `BERUEHREN_MS`

```text
Frist zwischen zwei geschriebenen Ablaufzeiten derselben Sitzung.

── Warum das nicht einfach „fünf Minuten" sein darf ─────────────────────────

Seit die Sitzung eine LEERLAUF-Frist hat (utils/sitzungsFrist.ts, Marcos
Vorgabe „nach ein paar Stunden Inaktivität ausloggen"), hängen die beiden
Zahlen zusammen, und zwar scharf: Gedrosselt wird das NACHFÜHREN des
Ablaufs. Ist die Drosselung länger als die Frist selbst, wird der Ablauf
nie rechtzeitig nachgeführt — dann fällt jemand MITTEN IM BETRIEB aus der
Sitzung. Also genau das Gegenteil dessen, was die Frist bewirken soll:
nicht der untätige Browser würde abgemeldet, sondern der arbeitende.

Bei der Vorgabe von vier Stunden fällt das nicht auf — fünf Minuten sind
ein Achtzigstel davon. Es fällt auf, sobald jemand `SESSION_IDLE_MINUTES=2`
setzt, um die Sache auszuprobieren: Mit einer starren Frist von fünf
Minuten wäre die Sitzung dann nach zwei Minuten tot, Betrieb hin oder her,
und es sähe nach einem Fehler in der Anmeldung aus.

Deshalb ein Viertel der Frist als Obergrenze. Bei vier Stunden bleibt es
damit bei genau den fünf Minuten wie bisher (eine Stunde ist mehr, es
gewinnt das Minimum); bei zwei Minuten sind es dreissig Sekunden, und die
Sitzung hält, solange jemand arbeitet.

Die Rechnung steht HIER und nicht am Aufruf in server.ts: Dort stand sie
als zweites Argument, und test/sitzung-beruehrung-db.test.js verlangt
wörtlich `drossleBeruehren(sitzungsSpeicher)` — ein Aufruf mit Argument
hätte diese Prüfung rot gemacht. Das war der richtige Hinweis: Die Regel
gehört zur Berührung, nicht zu ihrem Aufrufer.
```

<a id="drossleberuehren"></a>
## `drossleBeruehren`

```text
Die touch()-Methode eines Sitzungsspeichers drosseln — an Ort und Stelle.

Gibt denselben Speicher zurück, damit der Aufruf in die Konfiguration passt.
Hat der Speicher gar kein touch() (nicht jeder hat eines), bleibt er
unverändert.

Im Cluster hat jeder Worker seine eigene Liste — im schlimmsten Fall
schreibt also jeder Worker einmal je Frist. Das ist gewollt: Eine geteilte
Liste wäre wieder ein Umlauf zur Datenbank, also genau das, was hier
eingespart werden soll.
```
