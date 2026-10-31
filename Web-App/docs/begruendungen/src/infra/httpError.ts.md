# Begründungen zu `src/infra/httpError.ts`

Die ausführlichen Kommentare aus `src/infra/httpError.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="handlerouteerror"></a>
## `handleRouteError`

```text
Zentrale Fehlerbehandlung für Routen.

Vorher: ~95 Catch-Blöcke schickten e.message direkt an den Client — bei
unerwarteten Fehlern leakt das Interna (SQL-Fehlertexte, Pfade, Stacktraces
in der Message). Jetzt: Der volle Fehler wird geloggt (landet via
Log-Interceptor in app_logs), aber der Client bekommt bei 5xx in Produktion
nur eine generische Meldung. Bewusst geworfene Client-Fehler (4xx via
e.status) behalten ihre Message — die ist für den Nutzer gedacht.
```

<a id="handlerouteerror-wo"></a>
## `wo`

```text
── Vollständig loggen — inkl. Methode, Pfad und Stack ────────────────────

Marcos Befund: Im Protokoll stand

    [route-error] 404: Error: Nicht gefunden
        at fehlerWerfen (…/fehlerTexte.js:243:13)
        at …/routes/api_v1/acquisitions.js:93:55

Der Stack sagte, WELCHE Zeile geworfen hat — aber nicht, welche Anfrage
dort ankam. Bei acquisitions.js ist das entscheidend: Dieselbe Zeile
bedient Teile UND Minifiguren (eine gemeinsame Fabrik), und die
gesuchte Kennung steht im Pfad. Ohne sie liess sich „die Zeile war schon
weg" nicht von „die Oberflaeche schickt die falsche Nummer" trennen.

`req` liegt an dieser Stelle laengst vor — GEMESSEN reichen es alle 102
Aufrufer durch. Es fehlte nur in der Ausgabe.

── Warum ohne Fragezeichen-Teil ─────────────────────────────────────────

Der Pfad wird am `?` abgeschnitten. Was gesucht wird, steht bei diesen
Routen im Pfad selbst; die Abfrage traegt dagegen Filter und, je nach
Aufrufer, auch schon einmal etwas, das nicht ins Protokoll gehoert. Ein
Protokoll ist der falsche Ort, um das im Einzelfall zu entscheiden.
```

<a id="handlerouteerror-2"></a>
## Abschnitt

```text
── Trägt der Fehler einen Code, gilt der (Nachtrag 130) ──────────────────

Helfer wie utils/household.ts und utils/setMove.ts werfen mit
fehlerWerfen() und geben damit den GRUND mit, nicht den Satz. Erst hier —
wo der Request bekannt ist — wird daraus ein Satz in der Sprache des
Anfragenden.

Ohne Code bleibt alles wie bisher: Ein technischer Fehler ist keine
Nutzermeldung, und bei 5xx in der Produktion steht ohnehin ein
allgemeiner Satz da.
```

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

<a id="abschnitt"></a>
## Abschnitt

```text
Ein Routen-Parameter, den der Pfad garantiert.

── Warum es diesen Helfer gibt ─────────────────────────────────────────────
Express fuellt `req.params.setNumber`, sonst waere die Route gar nicht
angesprungen: `/:setNumber` matcht nur, wenn dort etwas steht. Der Typ sagt
das aber nicht — `ParamsDictionary` ist eine Index-Signatur, und unter
noUncheckedIndexedAccess liest der Pruefer daraus `string | undefined`.

Eine Augmentierung loest das NICHT: Auch `Record<string, string>` traegt eine
Index-Signatur, der Schalter greift genauso. Die saubere Alternative waere
`Request<{ setNumber: string }>` je Route — elf Signaturen, die beim naechsten
Pfad wieder nachgezogen werden muessen.

Deshalb ein benannter Zugriff: Er sagt aus, dass der Router die Garantie
gibt, und der leere String ist der ehrliche Rueckfall fuer den Fall, den es
nach dem Routing nicht geben kann. `''` faellt bei jeder Pruefung darunter
sauber durch — anders als ein `!`, das im Fehlerfall einen Absturz erzeugt.
```

<a id="pfadparam"></a>
## `pfadParam`

```text
Der Typ nimmt seit Express 5 auch `string[]` an (05.10.).

Express 5 erfasst benannte Platzhalter (`/images/*pfad`) als ARRAY von
Segmenten, deshalb ist `ParamsDictionary` jetzt
`Record<string, string | string[]>`. Ohne die Erweiterung hier meldete der
Pruefer das an elf Aufrufstellen.

Zusammengefuegt wird mit `/` und nicht mit `String(…)`: Ein Array wuerde
sonst ueber `toString()` mit KOMMA verbunden ("a,b" statt "a/b"). Dass heute
keine dieser elf Stellen auf einer Wildcard-Route sitzt, macht es nicht
ueberfluessig — es macht es nur heute folgenlos, und genau solche Zeilen
stehen spaeter an einer Route, bei der es nicht mehr folgenlos ist.
```

<a id="abschnitt-2"></a>
## Abschnitt

```text
Eine Datei an die Antwort streamen — mit Fehlerbehandlung.

── Warum es diesen Helfer gibt (Nachtrag 30) ───────────────────────────────
`fs.createReadStream(p).pipe(res)` sieht harmlos aus, ist aber die gleiche
Falle wie beim pgNotify-Absturz (Nachtrag 27): `.pipe()` hängt KEINEN
'error'-Zuhörer an die Quelle, und ein 'error'-Ereignis ohne Zuhörer ist in
Node kein Logeintrag, sondern eine geworfene Ausnahme. Nachgestellt: Ein
Lesestrom auf eine fehlende Datei beendet den Prozess mit ENOENT.

Erreichbar ist das überall dort, wo zwischen „Datei ist da" und „Datei
öffnen" Zeit vergeht — und das ist an allen drei Fundstellen so:
  • PDF-Download: existsSync, dann räumt cleanOldPdfJobs (10-Minuten-TTL)
    genau dazwischen auf
  • Bild-Proxy (Vorschau und Cache): access()/stat(), dann kann die
    Cache-Pflege die Datei entfernen
Ein voller Datenträger oder entzogene Rechte lösen dasselbe aus.

Statt Absturz: Fehler protokollieren und, solange noch keine Kopfzeilen
raus sind, mit 404 antworten. Sind sie schon draussen (Fehler mitten im
Strom), lässt sich nichts mehr melden — dann wird die Verbindung sauber
beendet, statt den Worker mitzunehmen.

onEnd läuft nur bei vollständiger Auslieferung (z.B. Aufräumen nach dem
PDF-Download) — bei einem Fehler ausdrücklich nicht.
```
