# Begründungen zu `src/infra/fehler.ts`

Die ausführlichen Kommentare aus `src/infra/httpError.ts` (geteilt in `fehler.ts` und `httpAntwort.ts`), wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="logandcontinue"></a>
## `logAndContinue`

```text
Ersatz für `.catch(() => {})` bei Schritten, die absichtlich nicht die
Anfrage scheitern lassen sollen (Cache-Pflege, Aufräumen, Einzelzeilen eines
Massenimports).

── Warum es das gibt ───────────────────────────────────────────────────────
Ein leerer Catch-Block sagt zwei Dinge gleichzeitig: „darf scheitern" und
„niemand erfährt davon". Das erste ist oft richtig, das zweite fast nie —
eine Spiegelung, die seit Wochen jedes Mal scheitert, sieht von aussen
identisch aus wie eine, die funktioniert. Der Fehler landet über den
Log-Interceptor in app_logs und ist im Log-Viewer auffindbar; der Ablauf
läuft weiter wie vorher.

NICHT verwenden für Schritte innerhalb einer Transaktion: Postgres bricht
die Transaktion beim ersten Fehler ab, alle folgenden Statements laufen dann
ins Leere. Dort muss der Fehler durch (siehe db/txLock.ts).

@param kontext kurze Herkunftsangabe, z. B. 'parts:image_local'
```

<a id="meldeundweiter"></a>
## `meldeUndWeiter`

```text
Dasselbe fuer try/catch statt fuer .catch().

logAndContinue() gibt einen RUECKRUF zurueck und passt damit an ein
Versprechen; in einem catch-Block laese sich das als
`logAndContinue('x')(e)`. Diese Form nimmt den Fehler direkt und benutzt
darunter denselben Helfer — es gibt also weiterhin genau EIN Format fuer
diese Meldungen, und eine Suche nach `[weiter-trotz-fehler]` findet beide.

Gedacht fuer Stellen, an denen der Ablauf bewusst weitergeht, der Fehlschlag
aber jemanden interessiert: ein uebersprungener Datensatz in einem
Hintergrundjob, eine nicht verschickte Mail, ein nicht neu geplanter Zeitplan.
NICHT fuer Aufraeumarbeiten — ein `c.end()` auf einer schon toten Verbindung
darf schweigen.
```

<a id="fehlertext"></a>
## `fehlertext`

```text
Der lesbare Text eines gefangenen Fehlers — egal was geworfen wurde.

── Warum das mehr ist als eine Typ-Beruhigung ──────────────────────────────
`catch (e) { … e.message … }` stand an 91 Stellen. In JavaScript darf aber
ALLES geworfen werden, nicht nur ein Error: eine Zeichenkette, ein Objekt
ohne `message`, bei einem abgelehnten Versprechen auch `undefined`. In genau
diesen Faellen war `e.message` seinerseits `undefined` — und beim Nutzer
stand dann „Fehler: undefined", also die eine Meldung, mit der niemand
etwas anfangen kann.

Die Reihenfolge ist die der Nuetzlichkeit:
  1. `message` einer Error-artigen Ausnahme — der Normalfall.
  2. Der Wert selbst, wenn eine Zeichenkette geworfen wurde.
  3. `String(e)` als letzter Ausweg; fuer `null`/`undefined` ein fester
     Text, weil „null" als Fehlermeldung nichts erklaert.

Absichtlich KEINE Serialisierung des ganzen Objekts: Ein geworfener
Datenbankfehler traegt gern die vollstaendige Abfrage samt Parametern, und
die gehoert nicht in eine Meldung, die bis zur Oberflaeche laufen kann.
```
