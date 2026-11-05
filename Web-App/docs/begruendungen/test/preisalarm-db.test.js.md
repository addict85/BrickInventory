# Begründungen zu `test/preisalarm-db.test.js`

Die ausführlichen Kommentare aus `test/preisalarm-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Preisalarm gegen eine echte Datenbank.

── Warum mit DB ────────────────────────────────────────────────────────────

Der Kern ist die HYSTERESE: gemeldet wird der Übergang, nicht der Zustand.
Das ist eine Aussage über eine Folge von Läufen — sie lässt sich nur prüfen,
indem man den Preis mehrfach ändert und jedes Mal nachsieht, ob gemeldet
wurde. Am Quelltext wäre nur zu sehen, DASS ein Merker existiert.

Der Mailversand ist dabei ersetzt: Geprüft wird, WANN gemeldet wird, nicht
wie die Mail aussieht.

Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
```

<a id="stelle"></a>
## `assert.deepEqual(zweite.alerts, [],`

```text
Die Zeitstempel stehen in der Meldung, und das hat einen Grund: Genau
diese Zusicherung ist mir EINMAL in einem vollen Lauf rot geworden und
in vier Wiederholungen nicht mehr. Ohne die drei Werte bliebe im
Fehlerbericht nur „kam ein zweites Mal" — und damit wieder nichts zu
untersuchen. Sie beantworten die einzige offene Frage: Lag `now` vor
oder nach `zuletzt_am`?
```

<a id="stelle-2"></a>
## `await db.run('DELETE FROM price_alerts', []);`

```text
── Der Befund, und warum er zweimal die CI rot gemacht hat ───────────

Postgres speichert MIKROsekunden, JavaScript kennt nur MILLIsekunden.
Gemessen:

    Postgres  : 2026-09-19 20:33:04.996699+00
    JavaScript: 2026-09-19T20:33:04.996Z

Die Marke verliert auf dem Weg zum Klienten die letzten drei Stellen
und ist damit KLEINER als der Wert in der Datenbank. Fällt eine Meldung
in dieselbe Millisekunde, gilt `zuletzt_am > marke` weiterhin — und sie
kommt ein zweites Mal.

── Warum die Kollision hier ERZWUNGEN wird ───────────────────────────

Der Nachbartest darüber hat sie in der CI zweimal getroffen und lokal
in keinem von fünf Läufen. Ein Test, der auf diesen Zufall wartet, ist
kein Test: Er meldet den Fehler irgendwann und bei irgendwem, und
dazwischen sieht er aus wie ein Flake. Hier steht der Zeitstempel von
Hand, mit Mikrosekunden, und die Marke ist genau seine
Millisekunden-Fassung — also exakt der Fall, der schiefging.
```

<a id="stelle-3"></a>
## `await db.run('DELETE FROM price_alerts', []);`

```text
── Marcos Vorgabe vom 25.09. ─────────────────────────────────────────

  „Bitte sicherstellen, dass die Push-Notification und die E-Mail pro
   Preisalarm und Set nur 1x gesendet wird.
     Preis fällt unter Preisalarm  -> E-Mail versenden und Push auslösen
     Preis ist beim nächsten Preis-Job noch immer darunter -> keine
     Preis steigt über Preisalarm  -> keine
     Preis fällt wieder darunter   -> E-Mail versenden und Push auslösen"

Die MAIL-Seite steht schon oben („gemeldet wird der ÜBERGANG"). Was dort
fehlte, ist die zweite Hälfte seiner Frage: die Meldung auf dem Telefon.

── Warum das eine eigene Prüfung braucht ─────────────────────────────

Es sind ZWEI Mechanismen. Die Mail entsteht im Preislauf und wird
verschickt; die App holt ab und vergleicht `zuletzt_am` mit ihrer
eigenen Marke. Dass der eine je Übergang genau einmal auslöst, sagt über
den anderen nichts: Würde `zuletzt_am` bei jedem Lauf neu gesetzt — auch
ohne Übergang —, bliebe die Mail aus, die App bekäme die Meldung aber
stündlich erneut. Genau diese Unabhängigkeit wird hier durchgespielt.

Die Marke wandert mit, wie in der App (PreisalarmWorker speichert sie
nach JEDEM Durchgang, auch wenn nichts kam).
```
