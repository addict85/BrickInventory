# Begründungen zu `utils/sitzungsFrist.ts`

Die ausführlichen Kommentare aus `utils/sitzungsFrist.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="leerlauf-vorgabe-min"></a>
## `LEERLAUF_VORGABE_MIN`

```text
Wie lange eine Webapp-Sitzung ohne Betrieb gilt.

── Marcos Vorgabe ──────────────────────────────────────────────────────────

„webapp-session sollten sich nach ein paar Stunden inaktivität bereits
ausloggen."

── Was vorher galt, nachgesehen und nicht geraten ──────────────────────────

GAR KEINE Leerlauf-Frist. Zwei Dinge hielten eine Sitzung am Leben, und
keines davon war eine Frist im Sinne der Vorgabe:

  das Cookie       trägt bewusst kein `maxAge` (server.ts: „No maxAge =
                   session cookie: expires when browser closes") — es stirbt
                   also erst, wenn der Browser zugeht. Viele Browser stellen
                   die Sitzung beim Neustart wieder her; damit war das in
                   der Praxis unbegrenzt.
  die Serverzeile  lebte EINEN TAG, und dieser Tag rückte bei jeder Anfrage
                   nach. Der Tag war keine Entscheidung, sondern die
                   Voreinstellung von connect-pg-simple, die greift, weil
                   das Cookie kein `maxAge` hat.

Die Frist steht jetzt hier und wird dem Sitzungsspeicher als `ttl`
übergeben. Durchgesetzt wird sie dort, wo sie nicht zu umgehen ist: Die
Zeile in `user_sessions` trägt ein `expire`, und connect-pg-simple liefert
eine abgelaufene Zeile beim Lesen nicht mehr aus. Keine Anfrage kommt daran
vorbei, kein Worker kann sie überstimmen.

── Vier Stunden ist MEINE Zahl ─────────────────────────────────────────────

Marco sagte „ein paar Stunden", nicht vier. Vier ist mein Vorschlag: lang
genug, dass ein Abend am Bestand nicht von einer Anmeldemaske unterbrochen
wird, kurz genug, dass ein offen stehengelassener Browser am nächsten
Morgen niemanden mehr hereinlässt. Wer es anders will, setzt
`SESSION_IDLE_MINUTES`.

── Warum `0` hier NICHT „abgeschaltet" bedeutet ────────────────────────────

Bei `TOKEN_IDLE_DAYS` tut es das. Hier wäre es die Rückkehr zu genau dem
Zustand, den die Vorgabe beseitigt — eine Sitzung ohne Leerlauf-Frist —,
und zwar über einen Wert, den man leicht aus Versehen setzt. Jede Zahl, die
keine positive Minutenzahl ist, fällt deshalb auf die Vorgabe zurück, mit
einer Zeile im Log. Wer die Frist wirklich abschaffen will, muss dafür
Code anfassen, nicht eine Umgebungsvariable.
```
