# Begründungen zu `test/preisalarme-export-import-db.test.js`

Die ausführlichen Kommentare aus `test/preisalarme-export-import-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Preisalarme gehen als CSV hinaus und kommen als Preisalarme zurueck.

── Marcos Vorgabe ──────────────────────────────────────────────────────────

  „Preisalarme sollen in den bestehenden Exporten und Importen ergänzt
   werden (in allen)."

── Was „in allen" heisst, und warum nicht wörtlich alle ────────────────────

GEMESSEN: Der Baum hat drei Exportwege.

  /api/v1/settings/export/data       ZIP mit den Bestandsdaten   ← hier
  /api/v1/settings/export            Konfiguration als JSON
  /api/v1/sets/export/rebrickable    Listenformat einer fremden Firma

Die Alarme liegen im ZIP. Der Konfigurations-Export trägt Einstellungswerte
und importiert über eine Whitelist von Schlüsselnamen — eine Tabelle passt
dort nicht hinein, und ein Alarm ist keine Einstellung. Der
Rebrickable-Export schreibt „Set Number,Quantity" für den Importer einer
fremden Firma; eine zusätzliche Spalte macht die Datei dort unbrauchbar.
Fall 7 unten hält genau das fest, damit die Entscheidung nicht später als
Versäumnis gelesen wird.

── Die Währung ist der Kern dieses Tests ───────────────────────────────────

Der Baum hat eine ausdrückliche Regel, an PUT /sets/:setNumber/alert:

    „Die Waehrung kommt aus den Einstellungen, NICHT aus der Anfrage: Eine
     vom Klienten geschickte Waehrung waere eine zweite Quelle fuer dieselbe
     Angabe, und die beiden liefen beim naechsten Wechsel auseinander."

Eine Importdatei IST der Klient. Also gilt die Kontowährung — auch wenn in
der Datei eine andere steht. Nur bedeutet dieselbe Zahl dann etwas anderes
(„unter 200" in CHF ist eine andere Frage als in EUR), und das darf nicht
im Erfolgston untergehen. Fall 5 prüft beides: die Währung des KONTOS
gewinnt, UND die Abweichung wird gemeldet.
```

<a id="fremder-alarm"></a>
## `const FREMDER_ALARM = { sn: '31203-1', c: 'N', r: 'unter', s: 77, w: '`

```text
Der Alarm eines FREMDEN Kontos. Er steht hier, weil ein Export ohne
`WHERE user_id` sonst nicht auffiele: Mit nur einem Konto im Aufbau sieht
eine Abfrage über ALLE Konten genauso aus wie die richtige. Das ist beim
Durchdenken der Gegenproben aufgefallen — Fall „user_id weggelassen" hätte
nichts rot gemacht.

Und es ist nicht bloss Weite, sondern ein Leck: Ein Alarm löst eine MAIL an
die Adresse seines Kontos aus (die Begründung steht an GET
/sets/:setNumber/alert). Fremde Alarme im eigenen Export landeten beim
Import im eigenen Konto — also Mails über die Wünsche anderer.
```

<a id="stelle"></a>
## `await db.run('DELETE FROM price_alerts WHERE user_id=$1', [HAUPT]);`

```text
── Was dieser Fall WIRKLICH unterscheidet (beim Gegenprobieren gelernt)

Erst stand hier: „setzeAlarm() bringt die Prüfung mit … geprüft wird,
dass die Route sie BENUTZT." Das war zu viel behauptet. Die Gegenprobe
„setzeAlarm durch ein rohes INSERT ersetzt" machte NICHTS rot, denn die
Tabelle hat eigene CHECK-Bedingungen (NACHGEMESSEN an der Test-DB):

    price_alerts_richtung  CHECK (richtung IN ('unter','ueber'))
    price_alerts_schwelle  CHECK (schwelle > 0)

Richtung und Schwelle fängt also auch die Datenbank. Zwei Dinge fängt
sie NICHT, und genau die stehen jetzt hier:

  · den ZUSTAND — es gibt keine CHECK darauf, ein „X" ginge glatt durch
    und stünde als dritter Zustand in einer Tabelle, die zwei kennt;
  · das Zurücksetzen von `ausgeloest` beim Ändern, das setzeAlarm()
    ausdrücklich zusagt („Eine neue Schwelle ist eine neue Frage").
```

<a id="stelle-2"></a>
## `await db.run('DELETE FROM price_alerts WHERE user_id=$1', [HAUPT]);`

```text
setzeAlarm() sagt zu: „Der Merker ausgeloest wird beim Ändern
ZURÜCKGESETZT: Eine neue Schwelle ist eine neue Frage, und die soll
beantwortet werden, auch wenn die alte schon einmal gemeldet hat."

Die Tabelle setzt das nicht durch — ein rohes INSERT … ON CONFLICT DO
UPDATE ohne `ausgeloest = FALSE` liesse den Merker stehen, und der
wiederhergestellte Alarm meldete nie mehr. Deshalb hier und nicht im
Vertrauen auf die Datenbank.
```
