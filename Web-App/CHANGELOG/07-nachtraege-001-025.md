# Nachträge 1–25

Teil der Fix-Historie — Übersicht in [CHANGELOG-fixes.md](../CHANGELOG-fixes.md).

---

## Nachtrag 2 — Anmeldeweg und Android-Aufräumen

Verifiziert mit `npm run typecheck` (sauber) und `npm test` gegen echtes
Postgres 16 (412 Tests, 0 Fehler); Login/Logout zusätzlich end-to-end
nachgestellt, inklusive des Falls, in dem das Token-INSERT scheitert.

### 9. Stille Fehler im Anmeldeweg — Sicherheitsrelevant

`routes/auth.ts`, `utils/auth.ts`

Drei Stellen trugen `.catch(() => {})` an Schritten, die scheitern dürfen — nur
eben nicht unbemerkt:

**Der Web-Token beim Login.** Scheiterte das INSERT in `api_tokens`, galt die
Anmeldung trotzdem als erfolgreich, und der Client legte einen Token in den
`sessionStorage`, den die Datenbank nie gesehen hatte. Für den SSE-Kanal des
CSV-Imports (`?token=…`, weil `EventSource` keine Header setzen kann) hiess das
ein 401 — obwohl die Cookie-Session funktioniert hätte. Jetzt wird der Token bei
einem Fehler **weggelassen** und der Grund geloggt; ohne Feld fällt der Client
auf die Session zurück, den ohnehin vorgesehenen Weg für Alt-Clients.
Nachgestellt: Mit umbenannter Tabelle meldet der Login weiterhin Erfolg, liefert
aber kein `webToken` und schreibt eine Warnung.

**Sessions und Tokens nach einem Passwortwechsel.** Beide DELETEs waren
verschluckt — das Passwort war neu, die alten Zugänge liefen weiter, und der
Vorgang meldete Erfolg. Der Rückfall für eine fehlende `session`-Tabelle war
zusätzlich überflüssig: Ihre Existenz wird zwei Zeilen darüber bereits geprüft.
Dasselbe in `revokeAllTokens()`, der zentralen Stelle.

**Der Token beim Logout** wird jetzt über `logAndContinue()` geloggt statt
übergangen — sonst bleibt genau der Fall unbemerkt, den der Kommentar dort
verhindern will: ein Token, der die bewusste Abmeldung überlebt.

Ausserdem auf `logAndContinue()` umgestellt (echte Kann-Schritte): `last_used`
am Token, das Aufräumen abgelaufener QR-Nonces, der Scheduler-Anstoss nach
einem Einstellungsimport und die Fortschritts-/Abbruchvermerke des CSV-Imports.

### 10. Android: `from_user_id` beim Eigentümerwechsel entfernt

`Models.kt`, `BrickRepository.kt`, `HouseholdFeature.kt`,
`AcquisitionManagementScreen.kt`

Die App schickte den Absender korrekt mit — der Server ermittelt ihn seit
Punkt 1 aber aus der Zeile selbst und ignoriert das Feld. Ein Feld, das nichts
mehr bewirkt, gehört nicht in den Vertrag: `UpdateAcquisitionRequest` hat es
nicht mehr, ebenso wenig `repo.updateAcquisition()` und
`changeAcquisitionOwner()`. `acq.ownerUserId` bleibt in der Oberfläche — dort
nur noch für den Vergleich „hat sich überhaupt etwas geändert".

`MoveSetRequest` behält `from_user_id`: Dort geht es um mehrere Zeilen auf
einmal, und der Absender ist Teil der Auswahl, nicht eine Frage, die die
Datenbank beantworten könnte.

### Weiterhin offen

Rund 165 `.catch(() => {})` stehen noch im Baum — auf Bild-Caches,
Katalog-Anreicherung, Fremd-API-Abrufen und Dateisystem-Aufräumarbeiten. Dort
ist Weiterlaufen richtig, und ein pauschaler Umbau brächte mehr Risiko als
Nutzen. Wer sie angehen will, nimmt sinnvollerweise als nächstes die
Dateisystem-Gruppe (~8 Stellen in `imgProxy.ts`): Ein fehlgeschlagenes `unlink`
lässt temporäre Dateien liegen, und das fällt erst auf, wenn die Platte voll ist.

---
## Nachtrag 3 — Sitzungen überlebten den Passwortwechsel

Verifiziert mit `npm run typecheck` (sauber), `npm test` gegen echtes
Postgres 16 (413 Tests, 0 Fehler) und einem End-to-End-Versuch mit echtem
Session-Store.

### 11. Ein zurückgesetztes Passwort beendete die Sitzung nicht — Sicherheitslücke

`routes/auth.ts`, `utils/auth.ts`

Der Admin-Reset suchte die offenen Sitzungen so:

    SELECT to_regclass('public.session')      →  immer NULL
    if (hasSession?.t) DELETE FROM session …  →  lief nie

Die Tabelle heisst `user_sessions` (`server.ts`, `tableName`), und
`db/database.ts` legt sie im Schema an — die Begründung im Kommentar („der
Store legt sie zur Laufzeit an, deshalb erst prüfen") stimmte nicht. Der
Existenztest war damit immer negativ und das DELETE ein toter Zweig.

Folge: Ein Administrator setzt das Passwort eines übernommenen Kontos zurück,
die Bearer-Tokens verfallen — und das offene Browser-Fenster des Angreifers
bleibt angemeldet. Genau der Fall, für den man die Funktion benutzt.

Nachgestellt mit echtem Store (`connect-pg-simple` auf `user_sessions`):

    vorher   Sitzungen nach dem Reset: 1   alte Sitzung noch gültig: ja
    nachher  Sitzungen nach dem Reset: 0   alte Sitzung noch gültig: nein

Bitter daran: Ein bestehender Test hat die Lücke **festgeschrieben** statt sie
zu finden — er verlangte ausdrücklich den `to_regclass`-Test. Ein Test, der
eine Implementierung nachzeichnet statt ein Verhalten zu prüfen, bestätigt auch
den Fehler. Er prüft jetzt, dass Sitzungen und Tokens enden, nicht wie.

Behoben über einen zentralen Helfer `revokeAllSessions(userId)` neben
`revokeAllTokens()`. Alle drei Wege, die ein Passwort ändern, rufen jetzt beide:

  * `PUT /auth/users/:id/password` (Admin-Reset) — traf die falsche Tabelle
  * `POST /auth/reset-password` (Link per E-Mail) — traf die richtige Tabelle,
    aber mit einem eigenen Ausdruck und verschlucktem Fehler
  * `POST /auth/change-password` (selbst geändert) — schloss bisher nur die
    Tokens, die Sitzungen liefen weiter

Beim selbst ausgelösten Wechsel werden alle Sitzungen verworfen und danach die
eigene über `establishSession()` neu aufgebaut — sonst flöge man aus dem
eigenen Tab. Die neue Session-ID ist dabei erwünscht: Rotation nach einem
Passwortwechsel ist ohnehin die richtige Antwort auf Session Fixation.

`sess::jsonb->>'userId'` statt `(sess -> 'userId')::text`: Beide treffen eine
Zahl, aber `->>` liefert den blanken Wert, während `::text` bei einem String
die Anführungszeichen mitbrächte (`'"42"'` statt `'42'`) und dann nicht mehr
passt.

---
## Nachtrag 4 — Token-Liste, Zähler je Konto, Linkhärtung

Verifiziert mit `npm run typecheck` (sauber), `npm test` gegen echtes
Postgres 16 (415 Tests, 0 Fehler) und zwei Laufproben gegen die Datenbank.

### 12. Eine Stelle entscheidet, wo ein Token in der URL reiten darf

`utils/auth.ts`, `routes/sets.ts`

`utils/auth.ts` führt eine Liste der Pfade, auf denen `?token=` als
Anmeldung zählt, und schreibt dazu: „alles andere verlangt einen
Authorization-Header". Das stimmte nicht — `routes/sets.ts` hatte eine
**zweite** Fassung von `requireLoginOrToken`, die `?token=` bedingungslos
akzeptierte. Der Bedarf dahinter ist echt (EventSource kann keine Kopfzeilen
setzen), die zweite Fassung war es nicht: Wer in `utils/auth.ts` nachliest, wo
ein Token in der URL erlaubt ist, bekam eine unvollständige Antwort — und der
Datei sieht man das nicht an.

`/api/sets/import/csv/stream` und `/status` stehen jetzt in der Liste (der
Polling-Rückfall greift, sobald EventSource fehlt — derselbe Client, dieselbe
Einschränkung), die Prüfung kommt von der zentralen Stelle. Das 3s-Zeitlimit
bleibt erhalten, jetzt als Option `loginOrTokenGuard({ timeoutMs })`: Während
eines Imports kann die Datenbank ausgelastet sein, und ein Client mit einer
klaren 503-Absage versucht es gleich wieder, statt minutenlang zu hängen.

Laufprobe gegen die Datenbank:

    CSV-Status ?token=<gültig>     200
    CSV-Status Bearer              200
    CSV-Status ohne alles          401
    CSV-Status ?token=falsch       401
    /api/parts?token=<gültig>      401   ← Liste greift

`/api/v1` bekam bewusst keinen Eintrag: Dort gibt es keinen CSV-Kanal, und der
PDF-SSE läuft über `requireToken` mit Kopfzeile.

### 13. Der Versionszähler der Teile-Zusammenfassung hängt jetzt am Konto

`utils/partsSummary.ts`

Ein einziger globaler Zähler entwertete die Zusammenfassung **aller** Konten,
sobald irgendjemand etwas schrieb. Im Haushalt heisst das: Trägt ein Kind ein
Teil nach, gilt die Zusammenfassung der Eltern als veraltet, und die Kennzahlen
(`ensureFresh` mit `strict`) weichen bis zum Ende des Neuaufbaus auf die
Live-Abfrage aus. Gemessen an 800 Sets / 60'000 Teilen: rund 300 ms Neuaufbau,
ausgelöst von einer Änderung, die mit diesen Daten nichts zu tun hat. Der
Kommentar nannte das einen bewussten Tausch — nötig ist er nicht.

Jetzt zählt `parts_version_user` je Konto. Die Zeilen kommen aus den
Übergangstabellen des Triggers (`REFERENCING … TABLE`), womit auch klar ist,
warum es drei Trigger sind statt einem: Die Tabellen gibt es nur passend zur
Operation — beim INSERT nur NEW, beim DELETE nur OLD. `FOR EACH STATEMENT`
bleibt, ein CSV-Import kostet weiterhin einen Zähler-Update je Anweisung.

Beim UPDATE zählen **beide** Seiten: Wandert eine Zeile im Haushalt zwischen
Konten, sind die Zusammenfassungen von Absender und Ziel veraltet.

Laufprobe:

    eigene Zusammenfassung frisch (strict)          true
    nach Schreibvorgang eines FREMDEN Kontos        true    ← vorher false
    nach EIGENEM Schreibvorgang                     false

Migration läuft von selbst: Beim ersten Lesen nach dem Update passt der
gespeicherte Stand nicht zum neuen Zähler, jede Zusammenfassung wird genau
einmal neu gebaut, danach ist der Zustand konsistent. Die alte Tabelle
`parts_version` bleibt unangetastet stehen; nur die alte Trigger-Funktion wird
entfernt, damit sie nicht weiter mitzählt.

### 14. Externe Links ohne Zugriff aufs Öffnerfenster

`public/index.html`

Die beiden Links zu rebrickable und brickset in den Einstellungen hatten
`target="_blank"` ohne `rel="noopener"` — überall sonst im Code ist es gesetzt.
Moderne Browser ergänzen es bei `_blank` inzwischen von selbst, ältere und
eingebettete WebViews nicht. Ein Test hält den Zustand für alle künftigen Links.

---
## Nachtrag 5 — Seitengrösse, Bild-Typen, Fehlermeldungen

Verifiziert mit `npm run typecheck` (sauber), `npm test` gegen echtes
Postgres 16 (419 Tests, 0 Fehler) und drei Laufproben.

### 15. Dieselbe Anfrage lieferte unterschiedlich viele Zeilen

`utils/handlers.ts`

`getParts` hat zwei Wege, und nur einer begrenzte `page_size`: Die
Live-Abfrage deckelte bei 500, `tryPartsSummary` reichte den Wert ungeprüft
ins `LIMIT` durch. An 5000 Teilen mit `page_size=100000`:

    ohne Zusammenfassung: db      → 500 Zeilen
    mit  Zusammenfassung: summary → 5000 Zeilen     ← jetzt 500

Das Ergebnis hing also davon ab, ob die Zusammenfassung gerade frisch war —
ein Unterschied, den beim Suchen eines Fehlers niemand vermutet. Nebenbei war
es ein Weg, sich beliebig grosse Antworten bauen zu lassen.

Die 500 stand ausserdem fünfmal als Literal im Code. Jetzt `MAX_PAGE_SIZE` und
`clampPageSize()` an einer Stelle; ein Test lässt das Literal nicht zurück.

### 16. Der Bild-Proxy liefert nur noch Bilder aus

`routes/imgProxy.ts`

Der Content-Type kam ungeprüft aus der CDN-Antwort und wurde so gesetzt **und**
als Sidecar im Cache abgelegt. Die Host-Liste ist eng und `https2.get` folgt
keinen Weiterleitungen (kein SSRF) — aber auf den erlaubten CDNs liegen teils
von Nutzern hochgeladene Dateien. Käme dort ein SVG oder HTML zurück, läge es
anschliessend unter der eigenen Herkunft, und ein SVG ist ein Dokument, das
Skript enthalten kann. `nosniff` und die CSP fangen den Ernstfall ab; eine
Route namens `img-proxy` sollte trotzdem nichts anderes ausliefern.

Alles ausser `image/*` bekommt jetzt 415, SVG ausdrücklich eingeschlossen — das
einzige Bildformat, das als Dokument geöffnet aktiv wird, und keines der
angebundenen CDNs liefert Teile- oder Setbilder als SVG. Die Prüfung greift
auch beim Ausliefern aus dem Cache, weil dort ungeprüfte Einträge von vorher
liegen können.

Unverändert nachgewiesen: ohne Anmeldung 401, fremder Host 403, echte
Subdomain erlaubt, ohne https 400.

### 17. Fehlgeschlagene Anfragen sind nicht mehr stumm

`public/js/01-core.js`, `public/js/08-init.js`, `public/locales/*.js`

`api()` war `return (await fetch(...)).json()` — ohne Blick auf `res.ok`. Jede
nicht-JSON-Antwort (502/504 vom Reverse Proxy, 413, HTML-Fehlerseite) liess
`.json()` werfen:

    Unexpected token '<', "<html>502 "... is not valid JSON

Bei rund 88 Aufrufstellen ist längst nicht jede in `try/catch`. Für den
Benutzer hiess das: klicken, nichts passiert, keine Meldung. Die
Fehlerbehandlung war da — sie prüft `d.success` und zeigt `d.error` —, sie
bekam nur nie ein Objekt zu sehen.

`api()` liefert jetzt in jedem Fall die Form, die auch der Server liefern
würde. Damit greifen alle bestehenden Pfade unverändert, ohne 88 Stellen
anzufassen:

    /ok         {"success":true,"wert":42,"status":200}
    /html502    {"success":false,"status":502,"error":"…"}
    /json500    {"success":false,"error":"kaputt","status":500}   ← Servertext bleibt
    /bare500    {"message":"oops","success":false,"status":500,"error":"…"}
    /netzfehler {"success":false,"error":"…","networkError":true,"status":0}

Dazu ein Auffangnetz in `startApp()` für das, was `api()` nicht abdeckt: ein
Fehler in einem Rückruf, eine Zusage, die niemand einsammelt. Kurze Meldung,
Einzelheiten in der Konsole, höchstens eine alle fünf Sekunden — ein Fehler in
einer Schleife soll den Bildschirm nicht zupflastern. Drei neue Textschlüssel
in beiden Sprachen, über `tRaw()` (Textziel, siehe `frontend-escaping.test.js`).

### Nicht umgesetzt: Ablauf für App-Tokens

`createToken` und der QR-Login setzen bewusst `expires_at NULL`, damit die
Android-App nicht ständig neu anmelden muss. Ein Token auf einem verlorenen
Telefon gilt damit unbegrenzt; `last_used` wird bereits gepflegt, ein
Aufräumjob könnte 90 Tage ungenutzte Tokens mitnehmen. Das ist eine
Produktentscheidung und wartet auf Marcos Wort.

---
## Nachtrag 6 — App-Tokens verfallen bei Nichtnutzung

Verifiziert mit `npm run typecheck` (sauber), `npm test` gegen echtes
Postgres 16 (420 Tests, 0 Fehler) und einer Laufprobe mit sechs Tokens.

### 18. Ungenutzte Tokens werden aufgeräumt

`utils/auth.ts`, `db/database.ts`, `README.md`

Tokens der Android-App und des QR-Logins werden bewusst ohne Ablaufdatum
angelegt — wer die App öffnet, soll nicht ständig sein Passwort eintippen. Der
Preis war: Ein Token auf einem verlorenen oder verkauften Telefon gilt
unbegrenzt, und ausser einem Passwortwechsel (der seit Nachtrag 3 alle Tokens
verwirft) gibt es keinen Weg, ihn loszuwerden.

Das Mass ist **ungenutzt**, nicht **alt**: Ein Telefon, das täglich
synchronisiert, wird nie ausgesperrt, egal wie lange es das Konto schon hat.
Verfallen kann nur, was ohnehin niemand mehr benutzt — dort ist eine erneute
Anmeldung zumutbar. `last_used` wird bei jeder Anfrage gepflegt (gedrosselt auf
alle fünf Minuten) und taugt genau dafür.

`TOKEN_IDLE_DAYS` steuert die Frist: Vorgabe 90 Tage, `0` schaltet sie ab, ein
unbrauchbarer Wert fällt mit einer Warnung auf die Vorgabe zurück. In der
README dokumentiert.

`COALESCE(last_used, created_at)`, weil Zeilen aus der Zeit vor der
`last_used`-Spalte dort NULL hätten — und `NULL < NOW()` ist unbekannt, sie
wären also für immer ausgenommen, ausgerechnet die ältesten.

Laufprobe mit sechs Tokens:

    [tokens] 2 Token seit über 90 Tagen ungenutzt — entfernt
    entfernt: 3
    übrig:    app 89 Tage, app aktiv, webapp gültig
    aktiver App-Token gilt noch:   ja
    ungenutzter gilt nicht mehr:   ja

Mit `TOKEN_IDLE_DAYS=30` fallen zusätzlich die 89-Tage-Zeile und die Altzeile,
mit `0` nur der abgelaufene Webapp-Token — die Regel lässt sich also wirklich
abschalten.

Ein passender Teilindex (`idx_api_tokens_idle` auf `last_used` WHERE
`expires_at IS NULL`) ergänzt den bestehenden für die erste Regel.

### 19. Nebenfund: gelöschte Zeilen wurden falsch gezählt

`utils/auth.ts`, `routes/parts.ts`

`purgeExpiredTokens()` las `r?.rowCount`. `db.run()` liefert aber
`{ changes, lastID }` — die Zahl war deshalb **immer 0**, und die Meldung
„n abgelaufene Token entfernt" ist nie erschienen. Aufgeräumt wurde trotzdem;
man sah es nur nicht. Beim Nachsehen fand sich dieselbe Verwechslung in
`syncBlPartNumbers()`: Dort war die Summe zusätzlich nirgends verwendet, die
Zeile also vollständig wirkungslos. Jetzt beide auf `changes`, und die zweite
Stelle schreibt eine Logzeile, die etwas aussagt.

---
## Nachtrag 7 — Herunterfahren, abgelaufene Sitzungen, Bedienelemente ohne Namen

Verifiziert mit `npm run typecheck` (sauber), `npm test` gegen echtes
Postgres 16 (422 Tests, 0 Fehler) und drei Laufproben.

### 20. Jeder Neustart wartete acht Sekunden und meldete einen Fehlschlag

`utils/sseRegistry.ts` (neu), `server.ts`, `routes/sets.ts`,
`routes/api_v1/pdf.ts`

`shutdown()` wartete auf `httpServer.close()`. Dessen Rückruf kommt erst, wenn
die **letzte** Verbindung weg ist — und ein SSE-Strom geht von sich aus nie weg:

    SSE-Strom offen
    nach 2500 ms: close() zurück? false

Jeder Neustart lief deshalb in die Frist von acht Sekunden und endete über die
Reissleine mit `process.exit(1)`. Für Docker sah damit jedes `compose down` und
jedes Deploy aus wie ein Absturz.

Der Kommentar dort nannte das einen Ausnahmefall („bleibt eine Verbindung
hängen, typischerweise ein SSE-Strom"). Es war der Regelfall: Der
Fortschrittskanal der Webapp bleibt ausdrücklich dauerhaft offen, auch wenn gar
kein Import läuft.

Neu meldet jede der drei SSE-Routen ihre Antwort bei `utils/sseRegistry.ts` an;
das Herunterfahren beendet sie, **bevor** es auf `close()` wartet — mit einem
letzten `event: shutdown`, damit der Client weiss, dass hier nicht die
Verbindung abgerissen ist, sondern der Server geht. Gemessen:

    closeAllSse() beendet 1 Strom
    close() zurück nach 2 ms

Die Reissleine quittiert jetzt mit `exit(0)`: Sie ist eine Notbremse für
hängende Verbindungen, kein Fehler. Ein echter Fehler beim Beenden wird
weiterhin mit 1 quittiert.

Reine Keep-Alive-Verbindungen brauchten das übrigens nicht — die beendet Node
beim Schliessen des Servers von selbst; nachgemessen, bevor die Registry
gebaut wurde.

### 21. Eine abgelaufene Sitzung führt zurück zur Anmeldung

`public/js/01-core.js`, `public/locales/*.js`

Ein 401 wurde zu einem Hinweis pro Klick („Nicht angemeldet"), während die
Oberfläche weiter alte Daten zeigte und sich nicht mehr bedienen liess. Die
Android-App macht es längst richtig: Ihr Interceptor meldet jeden 401, die App
zeigt „Sitzung abgelaufen" und führt zur Anmeldung.

Wahrscheinlicher geworden ist der Fall durch Nachtrag 3: Seitdem verwerfen alle
drei Passwort-Wege sämtliche Sitzungen des Kontos — offene Tabs auf anderen
Geräten landen also genau hier.

`api()` behandelt den 401 jetzt zentral. Zwei Ausnahmen: `/auth/me` beantwortet
mit 401 die Frage „bin ich angemeldet?" (das behandelt `checkAuth()`), und
`/auth/login` meldet damit ein falsches Passwort. Wer gar nicht angemeldet ist,
löst nichts aus — sonst gäbe es eine Schleife auf der Anmeldemaske.

Gegen einen kleinen Server nachgestellt:

    abgemeldet + 401 → login-screen unverändert
    angemeldet + 401 → login-screen: flex, app: none

### 22. Zehn Bedienelemente ohne Namen (Android)

`ui/screens/*.kt`, `res/values*/strings.xml`, `IconButtonLabelTest.kt` (neu)

Vier `IconButton` trugen `contentDescription = null`: Suche leeren (Katalog und
Teileliste), Passwort ein-/ausblenden, Dreipunkt-Menü der Galerie-Kachel.
TalkBack liest dort nur „Schaltfläche" — ein Knopf ohne Funktion.

Der dazu geschriebene Test förderte sechs weitere zutage, an die vorher niemand
dachte: `FilledTonalIconButton` heisst auch „IconButton". Die Mengen-Knöpfe in
beiden Detail-Ansichten trugen `"+"` und `"−"` als Beschreibung — TalkBack liest
das als „Plus", nicht als „Menge erhöhen" —, und zwei Bearbeiten-Knöpfe im
Monitoring waren ganz ohne.

Acht neue Texte in beiden Sprachen. Symbole NEBEN einem Text behalten
ausdrücklich `null`: Sonst liest TalkBack dieselbe Sache zweimal.

Aufgefallen ist die Lücke im Vergleich zur Webapp, die in hardened-62 einen
eigenen Barrierefreiheits-Durchgang bekam. Der Test hält den Stand jetzt auch
für die App; die Gegenprobe (eine Beschriftung entfernt) meldet die Stelle.

Beim Schreiben des Tests fiel er selbst einmal auf die Nase: Ein Fenster von
300 Zeichen ab `Icon(` schnitt die Beschriftung des Passwort-Knopfes ab, weil
zwei Kommentarzeilen dazwischen standen. Ein Test, der korrekten Code
anmeckert, wird abgeschaltet statt befolgt — deshalb jetzt ein Fenster über
zehn Zeilen.

---
## Nachtrag 8 — Bedingte Bildabrufe und ein Aufräumlauf zu viel

Verifiziert mit `npm run typecheck` (sauber), `npm test` gegen echtes
Postgres 16 (424 Tests, 0 Fehler) und einer Laufprobe gegen den echten Proxy.

### 23. Der ETag des Bild-Proxys wurde nie ausgewertet

`routes/imgProxy.ts`

Beide Auslieferpfade (Original und Vorschaubild) setzten einen ETag und
`Cache-Control: max-age=86400, must-revalidate` — prüften aber kein
`If-None-Match`. Nach Ablauf der 24 Stunden fragt der Browser nach und bekam
jedes Mal das **vollständige** Bild zurück. Bei einer Kachelwand mit hundert
Teilen ist das täglich einmal die ganze Wand statt hundert leerer Antworten.
Der berechnete ETag sah aus, als täte er etwas, war aber wirkungslos.

Die Route `/images/*` hatte das Problem nie, weil `res.sendFile` die Prüfung
selbst übernimmt — die beiden Bildwege verhielten sich also unterschiedlich.

Jetzt `if (req.fresh) return res.status(304).end();` an beiden Stellen, nach
dem Setzen der Kopfzeilen (davor gäbe es nichts zu vergleichen). Gegen den
echten Proxy nachgestellt:

    1. Abruf                        200   ETag "c-2048-…"   2048 Bytes
    2. mit If-None-Match            304                        0 Bytes
    3. mit ALTEM ETag               200                     2048 Bytes
    4. mit no-cache (Shift-Neuladen) 200                    2048 Bytes

Beim Prüfen fiel eine Falle auf, die im Test festgehalten ist: Node's `fetch`
hängt bei manuell gesetztem `If-None-Match` automatisch
`Cache-Control: no-cache` an — worauf `req.fresh` korrekt `false` liefert. Die
erste Messung zeigte deshalb 200 und sah aus wie ein Fehlschlag, obwohl der
Code stimmte. Die Laufprobe benutzt jetzt rohe HTTP-Anfragen.

### 24. Der Cache-Aufräumlauf lief in jedem Cluster-Worker

`routes/imgProxy.ts`, `server.ts`

Das tägliche Aufräumen von `data/img_proxy_cache` stand in
`registerImgProxy()` — und die wird von **jedem** Worker aufgerufen. Bei acht
Workern hiess das acht vollständige Durchläufe über das Verzeichnis (`readdir`
plus `stat` je Datei) und acht Prozesse, die sich beim `unlink` gegenseitig ins
Gehege kamen; unbemerkt, weil die Fehler ohnehin verworfen werden.

Alle übrigen wiederkehrenden Arbeiten — Preis-Job, Token-Aufräumen,
Log-Bereinigung — hängen längst hinter `isPrimaryWorker`. Der Lauf ist jetzt
als `startImgCacheCleanup()` herausgezogen und wird dort mitgestartet.

Der Kommentar zur Bedingung ist dabei präzisiert worden: Geprüft werden atime
UND mtime, weil ein mit `noatime` eingehängtes Dateisystem (in Containern
verbreitet) die atime auf dem Erstellungszeitpunkt stehen lässt.

### Nebenbei geprüft und in Ordnung: die Android-App

Release-Build mit `minifyEnabled` und ProGuard, praktisch kein Debug-Logging,
`allowBackup="false"` **plus** `data_extraction_rules`, die den DataStore auch
vom Geräte-zu-Geräte-Transfer ausschliessen, nur die Launcher-Activity
exportiert, Klartext-Sperre für öffentliche Hosts im Interceptor, eigener
SSE-Client mit `readTimeout(0)`, Coil mit Speicher- und Plattencache, stabile
Keys in den Lazy-Listen.

Eine Kleinigkeit: Der Kommentar in `data_extraction_rules.xml` sagt „der Token
hat serverseitig kein Ablaufdatum" — seit `TOKEN_IDLE_DAYS` (Nachtrag 6) stimmt
das nicht mehr ganz. Die Regel selbst bleibt richtig, der Satz ist beim
nächsten Android-Paket einen Halbsatz wert.

---
## Nachtrag 9 — Hochgeladene Anleitungen im Haushalt

Verifiziert mit `npm run typecheck` (sauber), `npm test` gegen echtes
Postgres 16 (426 Tests, 0 Fehler) und zwei Laufproben gegen echte Daten.

### 25. Der Dateipfad war die Zugriffsregel — und passte nicht mehr

`server.ts`

`serveDataFile()` verglich das erste Pfadsegment stur mit der eigenen
Benutzer-ID. Richtig, solange ein Konto für sich stand; nach dem Haushalt an
zwei Stellen falsch:

  * `getSet` listet Anleitungen mit `user_id = ANY(uids)`, also haushaltsweit.
    Das Hauptkonto **sah** die Anleitung eines Unterkontos im Set-Detail und
    bekam beim Klick 403.
  * `moveSetBetweenAccounts` kopiert `local_path` wörtlich. Nach dem
    Verschieben eines Sets gehörte die Anleitungs-Zeile dem neuen Konto, der
    Pfad zeigte aber weiter in den Ordner des alten — 403 auf die **eigene**
    Zeile.

Jetzt entscheidet `scopeIds()`, dieselbe Stelle, die überall sonst beantwortet,
wessen Daten jemand sehen darf. Die Benutzer-ID im Pfad ist damit das, was sie
ohnehin schon war: eine Ablagestruktur, keine Zugriffsregel.

Die Asymmetrie bleibt: Ein Unterkonto hat nur sich selbst im Blickfeld
(`resolveHousehold`: `memberIds = [self, …eigene Subs]`), kommt also **nicht**
an die Uploads des Hauptkontos. Geprüft wird gegen eine Liste erlaubter IDs,
nicht gegen „irgendwer im System".

Gegen echte Daten, vorher → nachher:

    Hauptkonto liest Anleitung des Unterkontos   403 → 200
    Hauptkonto liest seine verschobene Zeile     403 → 200
    Unterkonto liest Datei des Hauptkontos       403 → 403   (unverändert)

Der zweite Weg — Datei beim Verschieben mitkopieren und `local_path` anpassen —
wurde verworfen: Er bringt Dateisystemarbeit in eine Transaktion und löst den
ersten Fall (Haushalt liest fremde Anleitung) gar nicht.

### 26. Eine geteilte Anleitungsdatei überlebt, bis die letzte Zeile weg ist

`routes/sets.ts`

Weil beim Verschieben die Zeile kopiert und der Pfad übernommen wird, teilen
sich zwei Konten eine Datei. Das Löschen stand **vor** dem `DELETE` und fragte
niemanden: Entfernte das eine Konto seine Anleitung, zeigte die Zeile des
anderen ins Leere — ein Eintrag im Set-Detail, der beim Klick 404 gibt.

Reihenfolge umgedreht: erst die eigene Zeile entfernen, dann zählen, ob noch
jemand auf den Pfad zeigt. Bleibt eine Zeile übrig, bleibt die Datei liegen.
Im Zweifel (Abfrage scheitert) bleibt sie ebenfalls liegen — eine verwaiste
Datei ist ärgerlich, eine fehlende ist weg.

    Kind löscht seine Zeile     → Datei bleibt
    Eltern löschen ihre Zeile   → Datei weg

### Nicht angefasst

Zwei Kleinigkeiten aus derselben Ecke, bewusst liegen gelassen:

  * Der Upload filtert nach dem vom Client geschickten `Content-Type` statt
    nach dem tatsächlichen Inhalt. Wegen `nosniff` und der aus der Endung
    abgeleiteten Auslieferung ist das ungefährlich — eine als PDF deklarierte
    Datei darf aber beliebigen Inhalt haben.
  * Das `ON CONFLICT DO NOTHING` beim Anleitungs-Insert läuft ins Leere: Auf
    der Tabelle gibt es keinen passenden Unique-Index, doppelte Uploads
    derselben Datei legen also zwei Zeilen an.

---
## Nachtrag 10 — Der Preis-Cache gehört dem Administrator

Verifiziert mit `npm run typecheck` (sauber), `npm test` gegen echtes
Postgres 16 (428 Tests, 0 Fehler) und einer Laufprobe mit beiden Rollen.

### 27. Jedes Konto konnte den globalen Preis-Cache leeren

`routes/settings.ts`

`POST /api/settings/import` führte am Ende ein unbedingtes
`DELETE FROM price_cache` aus — der Router trägt aber nur `requireLogin`. Jedes
Konto, auch ein Unterkonto im Haushalt, konnte damit eine Ein-Zeilen-Datei
hochladen …

    {"user_settings":{"currency":"CHF"}}

… und den Preis-Cache der **ganzen Installation** leeren. Beliebig oft. Der
nächste Bewertungslauf holt dann alle Preise neu bei BrickLink, und deren
Tageskontingent ist endlich.

Dieselbe Lücke war in `routes/finance.ts` schon einmal geschlossen worden —
`POST /refresh` trägt seitdem `requireAdmin`, mit einer Notiz im Code über das
„von aussen verbrannte" Kontingent. Der Import-Weg wurde dabei übersehen; er
sieht ja auch nicht nach „Cache leeren" aus.

**Ersatzlos gestrichen statt hinter `isAdmin` geschoben.** `price_cache` ist
über `set_number`, `condition` **und** `currency_code` verschlüsselt: Einträge
in der alten Währung passen nach einem Wechsel schlicht nicht mehr auf die
Abfrage, und für die neue wird ohnehin frisch geholt. Das Leeren hatte also nie
eine Wirkung auf die Richtigkeit — nur eine auf das Kontingent. Wer den Cache
wirklich leeren will, hat dafür `POST /api/finance/refresh` (Admin).

Nachgeprüft: Alle sechs lesenden Abfragen auf `price_cache` filtern nach
`currency_code`.

Laufprobe mit beiden Rollen:

    Cache vorher                                        50
    Unterkonto importiert  → „Nur Benutzer-Einstellungen importiert",
                             Währung gesetzt, Cache      50
    Admin importiert       → globaler Wert gesetzt, Cache 50

Zwei Tests halten das fest, und zwar als **Regel** statt an einer Route:

  * Wer `DELETE FROM price_cache` ausführt, braucht `requireAdmin` — geprüft
    über alle sechs Router, die den Cache anfassen könnten. Ein neuer Weg mit
    demselben Muster fällt damit sofort auf.
  * Jede lesende Abfrage auf `price_cache` filtert nach `currency_code`. Bricht
    jemand diese Eigenschaft, wäre die gestrichene Zeile wieder nötig — dann
    wird hier etwas rot, statt dass still Währungen durcheinandergeraten.


---
## Nachtrag 11 — Aufräumen und ein Blick auf die Tests selbst

Verifiziert mit `npm run typecheck` (sauber) und `npm test` gegen echtes
Postgres 16 (432 Tests, 0 Fehler).

### Changelog zusammengeführt

`CHANGELOG-hardened-115.md` war bei zehn Nachträgen angekommen — ein Changelog,
der nur noch angehängt wird, liest irgendwann niemand mehr. Die elf Durchgänge
stehen jetzt hier (Abschnitt „Review-Reihe hardened-115 bis 125"), die
Einzeldatei ist entfallen.

### Android: überholter Kommentar

`res/xml/data_extraction_rules.xml` begründete den Ausschluss des DataStore
damit, dass der Token „serverseitig kein Ablaufdatum" habe. Seit
`TOKEN_IDLE_DAYS` stimmt das nicht mehr. Die Regel selbst bleibt richtig, und
der Kommentar sagt jetzt auch warum: Ein mitgewanderter Token ist auf dem neuen
Gerät sofort gültig, und „läuft irgendwann ab" ist kein Ersatz für „kommt gar
nicht erst dorthin".

### Die Tests selbst angesehen

Ausgangspunkt war der teuerste Fund dieser Reihe: In Durchgang 118 hatte ein
Test eine Sicherheitslücke **festgeschrieben**, statt sie zu finden — er
verlangte einen Ausdruck (`to_regclass('public.session')`), der auf eine
Tabelle zeigte, die es nie gab. Also die Frage: Wie viele Tests zeichnen
Implementierung nach statt Verhalten zu prüfen?

Von 352 Top-Level-Tests lesen die meisten Quelltext; sechs Suiten führen Code
gegen echtes Postgres aus. Zwei Messungen dazu:

**Erste Richtung — schlägt ein Test an, obwohl nichts kaputt ist?** Eine reine
Umbenennung in `utils/household.ts` (`subState` → `zustandUnterkonto`,
`curMain` → `waehrungHaupt`) machte zwei Tests rot, während die Datenbank-Suite
grün blieb. Beide sind jetzt auf die Struktur gezielt statt auf die
Schreibweise; nach derselben Umbenennung bleiben sie grün.

**Zweite Richtung — bleibt ein Test grün, obwohl etwas kaputt ist?** Das ist
die gefährliche. Hängt man an die Währungsprüfung ein `&& false`, bleiben alle
Quelltext-Prüfungen grün und nur der Datenbanktest wird rot. Und beim
Passwortwechsel: Klammert man `revokeAllSessions` und `revokeAllTokens` in ein
`if (false)`, bleiben **alle 13** statischen Prüfungen in `auth-parity` grün —
die Zeichenketten stehen ja noch da —, während die Sicherheitsregel tot ist.

Genau diese Lücke schliesst die neue Suite **test/auth-sessions-db.test.js**:
echter `connect-pg-simple`-Store, echte Routen, echte Cookies. Drei Fälle —
Admin-Reset wirft das übernommene Fenster hinaus; der eigene Passwortwechsel
wirft die *anderen* Fenster hinaus, nicht das eigene; Bearer-Token verfallen
mit. Mit dem `if (false)` oben wird sie rot.

Die README hat dazu einen Abschnitt bekommen („Zwei Arten von Tests"), der die
Grenze benennt und zwei Regeln festhält: Sicherheitsregeln brauchen einen
Verhaltenstest, und Namen von Zwischenvariablen gehören nicht in ein
Testmuster. Dazu die Gegenprobe als Gewohnheit — Regel im Code brechen und
schauen, ob der Test rot wird; wird er es nicht, prüft er etwas anderes als
gedacht.

---
## Nachtrag 12 — Das Rebrickable-Tageskontingent zählt jetzt einmal

Verifiziert mit `npm run typecheck` (sauber), `npm test` gegen echtes
Postgres 16 (433 Tests, 0 Fehler) und einer Laufprobe mit simuliertem zweitem
Worker.

### Drei APIs, zwei Zählweisen — jetzt eine

`utils/rateLimiter.ts`, `utils/financeCalc.ts`, `routes/rebrickable.ts`,
`routes/parts.ts`, `routes/api_v1/admin.ts`, `jobs/*`, `server.ts`

BrickLink und Brickset zählten ihre Tagesaufrufe über
`checkAndIncrementRateLimit()` — eine Transaktion mit `SELECT … FOR UPDATE`,
also einmal für die ganze Installation. Rebrickable hatte einen eigenen Weg:
`DailyLimiter` mit `this.count` im Prozessspeicher.

Der Server läuft im Cluster. Jeder Worker legte seine eigene Instanz an und
zählte für sich bis zum Limit — bei `WORKERS = max(2, CPU-Kerne)` waren auf
einem Vierkerner 100'000 Aufrufe möglich, wo 25'000 eingestellt sind. Die
DB-Schreibvorgänge in `tryConsume()` täuschten Gemeinsamkeit vor, waren aber
`SET value = <lokaler Stand>`: Der letzte Worker überschrieb den Wert des
vorigen, statt zu addieren. Die Anzeige im Monitoring zeigte den Stand eines
beliebigen Workers, und nach einem Neustart stand sie wieder auf 0, während der
Tag weiterlief.

**Das ist die dritte Instanz desselben Musters.** Beim Login-Zähler war es
schon behoben (`utils/loginLimiter.ts`, mit der Notiz „bei N Cluster-Workern
werden aus 5 Fehlversuchen sonst N×5"), beim Bild-Cache-Aufräumlauf ebenfalls
(Nachtrag 8). Hier traf es ausgerechnet das Kontingent, das die anderen
Massnahmen schützen sollten.

Alle sechs Aufrufstellen laufen jetzt über `consumeRebrickableDaily()`, das an
`checkAndIncrementRateLimit('rebrickable')` weiterreicht. Damit entfallen auch
`loadDailyLimitsFromDb()` beim Start und `setMax()` im Admin-Handler: Die
Grenze wird bei jedem Aufruf aus `global_settings` gelesen, statt in jeden
Prozess kopiert und beim Ändern nachgezogen zu werden — vorher galt ein neu
gesetztes Limit nur in dem Worker, der die Anfrage bearbeitet hatte.

Beim Umbau gefunden: `getLimitForApi()` führte einen eigenen Rückfallwert von
**4000** für Rebrickable, während `REBRICKABLE_DEFAULT_DAILY` (und der Seed in
`db/database.ts`) 25'000 sagt. Solange Rebrickable seinen eigenen Zähler hatte,
sah es diese Tabelle nie — nach der Umstellung wäre es eine stille Kürzung auf
ein Sechstel gewesen. Der Wert kommt jetzt aus derselben Quelle.

Der Kurzstrecken-Limiter (ein Aufruf je 1,5 s) bleibt bewusst prozesslokal:
Drosselung pro Prozess ist etwas anderes als ein Tagesbudget.

Laufprobe (Limit auf 3 gesetzt):

    Standard ohne Eintrag: 25000
    Aufrufe 1–3: erlaubt      Aufruf 4: abgelehnt
    zweiter Modulzustand (= zweiter Worker): abgelehnt, Stand 3/3

Vorher hätte der zweite Worker wieder bei null angefangen.

### Bei DB-Ausfall wird durchgelassen

`consumeRebrickableDaily()` gibt bei einem Fehler `true` zurück. Umgekehrte
Abwägung als beim Login-Zähler, wo der Rückfall sperrt: Ein überschrittenes
Tageskontingent kostet Aufrufe, ein blockierter Bildabruf kostet die
Benutzbarkeit.

---
## Nachtrag 13 — Der Preis-Job konnte mehrfach parallel laufen

Verifiziert mit `npm run typecheck` (sauber), `npm test` gegen echtes
Postgres 16 (434 Tests, 0 Fehler) und einer Laufprobe mit einem echten zweiten
Prozess.

### Vierte Instanz desselben Musters

`jobs/priceJob.ts`, `routes/finance.ts`, `routes/api_v1/admin.ts`

Der Schutz gegen Doppelläufe war `state.running` — eine Variable im Speicher
EINES Prozesses. Geplant läuft der Job nur im Primary-Worker
(`priceJob.start()` steht im `isPrimaryWorker`-Block), aber die beiden
manuellen Auslöser (`POST /api/finance/job-trigger` und
`POST /api/v1/admin/trigger-price-job`) laufen in dem Worker, der die Anfrage
gerade bearbeitet. Dort war `state.running` false — also startete ein
vollständiger Lauf über alle Sets, unabhängig davon, ob im Primary gerade einer
lief.

Zwei Folgen: Zwei Klicks auf verschiedenen Workern ergaben zwei komplette
Durchgänge mit eigenen BrickLink-Aufrufen (der Tageszähler aus Nachtrag 12
begrenzt den Schaden, aber das Kontingent ist doppelt weg), und beide Läufe
schrieben in dasselbe `jobMonitor`-Feld — die Fortschrittsanzeige sprang
zwischen den Ständen hin und her.

Das ist nach Login-Zähler, Bild-Cache-Aufräumlauf (Nachtrag 8) und
Rebrickable-Tageskontingent (Nachtrag 12) die **vierte** Instanz. Auffällig:
Die Werkzeuge lagen längst bereit — `partsCatalogEnrich` nimmt
`pg_try_advisory_lock(42, …)`, `partsSummary` die 77, `txLock` die Benutzer-ID.
Nur der Preis-Job hatte keine.

`runPriceRefresh()` holt jetzt eine prozessübergreifende Sperre im eigenen
Namensraum (55), auf einer **eigenen Verbindung** aus dem Pool statt
transaktionsgebunden: Der Lauf dauert Minuten, `pg_try_advisory_xact_lock`
hiesse eine minutenlang offene Transaktion. Freigabe im `finally` — sonst
blockierte ein abgestürzter Lauf alle folgenden bis zum Neustart. Bekommt der
Lauf die Sperre nicht, meldet er das im Log und plant den nächsten Termin.

`state.running` bleibt als billige Vorprüfung im selben Prozess; die Sperre ist
die belastbare Antwort.

### triggerNow() meldet nicht mehr Erfolg, wenn keiner startet

Der manuelle Anstoss holt die Sperre selbst, statt sie dem Lauf zu überlassen.
Vorher gab die Route `started: true` zurück, sobald der eigene Prozess nicht
beschäftigt war — lief anderswo schon ein Durchgang, stimmte die Meldung nicht.
`triggerNow()` ist dadurch asynchron geworden; beide Routen warten das Ergebnis
ab.

### Nachgestellt mit einem echten zweiten Prozess

Zwei Modulinstanzen im selben Prozess reichen als Nachweis nicht: Sie teilen
sich `state`, und dann hätte schon `state.running` das `false` erklärt. Deshalb
ein echter zweiter Node-Prozess mit eigenem Speicher:

    [Worker A] triggerNow: true          Sperren gehalten: 1
    [Worker B] state.running lokal: false   ← eigener Prozess, leerer Zustand
    [Worker B] triggerNow: false            ← das kann nur die Sperre gewesen sein

Ohne die Sperre in `triggerNow()` meldet Worker B `true` und startet einen
zweiten kompletten Lauf — gegengeprüft.

Der Test dazu prüft die **Regel**, nicht diese eine Stelle: eigene Verbindung
statt Transaktionssperre, Freigabe im `finally`, `await` an beiden Routen, und
ein Namensraum, der noch nicht vergeben ist.
## Nachtrag 14 — Die Anleitungs-Warteschlange lief in jedem Worker

Fünfte Instanz desselben Musters: prozesslokaler Zustand, der eine Regel für
den ganzen Cluster durchsetzen sollte. Nach dem Login-Zähler, dem
Bild-Cache-Aufräumlauf, dem Rebrickable-Tageskontingent und dem Preis-Job jetzt
`jobs/instructionQueue.ts` — und, beim Nachsehen „wo gibt es das noch?", der
Nachlauf für fehlende Bilder.

### Was falsch lief

`_running`, `_timer` und der Cloudflare-Backoff liegen im Speicher EINES
Prozesses. Der geplante Antrieb läuft nur im Primary — aber die Warteschlange
wurde aus drei Request-Handlern heraus direkt angestossen:

* `addSet()` in `routes/sets.ts` (Set erfassen),
* das Ende des CSV-Imports,
* `POST /api/v1/admin/reimport-instructions`.

Diese laufen in dem Worker, der die Anfrage gerade bearbeitet. Dort war
`_running` false, also startete eine zweite Abarbeitung derselben
Warteschlange. Zwei der drei Stellen trugen sogar den Kommentar „direkter
processNext() falls DIESER Prozess der Primary ist" — geprüft hat das nie
jemand, `processNext()` kannte den Primary gar nicht.

Folgen, alle am Code nachvollzogen:

* Zwei Prozesse zogen mit `WHERE status='pending' … LIMIT 1` **dieselbe** Zeile
  und holten die Anleitung zweimal: doppelt verbrauchtes
  Brickset-Tageskontingent, zwei Downloads auf denselben Dateinamen. (Doppelte
  Zeilen in `shared_instructions` entstanden dabei NICHT — dort greift
  `UNIQUE(set_number, url)`.)
* Der Cloudflare-Backoff galt nur im Prozess, der die 1015 gesehen hat. Der
  andere lief weiter und holte sich die nächste Sperre.
* Die 15-Sekunden-Drossel halbierte sich, weil zwei Zeitgeber-Ketten
  unabhängig voneinander takteten.

### Was jetzt gilt

1. **`requestRun()`** setzt nur das Flag `instr_queue_trigger`, das der Primary
   ohnehin alle 3 s abfragt. Alle drei Request-Handler gehen darüber; kein
   Direktaufruf mehr aus einem Request.
2. **`processNext()` hält eine prozessübergreifende Sperre** für die Dauer
   EINES Eintrags: `pg_try_advisory_lock(56, 0)` auf einer eigenen Verbindung
   (Advisory-Locks hängen an der Session — über den Pool landen Sperren und
   Freigeben sonst auf verschiedenen Verbindungen; ausführlich begründet in
   `routes/brickset.ts`). Damit hängt die Regel am Job, nicht an den
   Aufrufstellen: Ein künftiger Direktaufruf kann nichts mehr verdoppeln.
3. **Die Cloudflare-Pause steht in der Datenbank** (`global_settings`, Schlüssel
   `instr_queue_block`, JSON `{until, retries}`) statt im Prozessspeicher. Sie
   überlebt damit auch einen Neustart — vorher nahm ein Neustart die laufende
   Sperre nicht zur Kenntnis und lief 3 Sekunden später wieder los.
4. **Die Nachfolge-Zeitgeber laufen nur dort, wo `start()` lief** (`_driver`).
   Sonst würde ein Direktaufruf in einem Request-Worker dort eine zweite Kette
   eröffnen: durch die Sperre zwar keine gleichzeitige Arbeit, aber zwei
   unabhängig taktende Drosseln.

### Dieselbe Sache beim Bilder-Nachlauf

`redownloadMissingImages()` in `jobs/partsCatalogEnrich.ts` wird
**ausschliesslich** aus einem Request-Handler ausgelöst
(`POST /api/v1/admin/redownload-missing-images`) und war nur durch
`_redlRunning` geschützt. Zwei Klicks auf den Knopf im Monitoring landeten in
verschiedenen Workern: zwei vollständige Läufe, dieselben Dateien nebenläufig
vom CDN auf denselben Pfad geschrieben, und beide überschrieben im
Sekundentakt `imgredl_status` — die Fortschrittsanzeige sprang zwischen zwei
Ständen hin und her.

`downloadSetImages()` hat für genau dieses Problem längst einen Lock (42 je
Set); dieser Weg lädt über `downloadFile()` direkt und lief ungeschützt. Jetzt
`pg_try_advisory_lock(57, 0)`, Rückgabe `{ alreadyRunning: true }` ohne Sperre;
die Route antwortet unverändert.

### Nachweis ohne zweiten Node-Prozess

Für den Preis-Job (Nachtrag 13) brauchte der Nachweis noch einen echten zweiten
Prozess. Das geht einfacher: Ein Advisory-Lock hängt an der **Session**, nicht
am Prozess — eine zweite Pool-Verbindung im selben Test wirkt für den Job wie
ein zweiter Worker.

`test/job-locks-db.test.js` prüft deshalb Verhalten statt Quelltext (ein
`if (false)` um den Lock-Aufruf hätte eine statische Prüfung grün gelassen —
siehe Nachtrag 11). Fünf Prüfungen gegen echtes Postgres, jede mit Gegenprobe:

* Gegenprobe: ohne fremde Sperre wird der Eintrag abgehakt (sonst prüfte der
  Rest der Suite nichts).
* Fremde Sperre gehalten → der Eintrag bleibt `pending`.
* Persistierte Cloudflare-Pause → der Eintrag bleibt `pending`.
* `requestRun()` setzt das Flag und arbeitet selbst nichts ab.
* Bilder-Nachlauf: mit fremder Sperre `alreadyRunning`, ohne Sperre läuft er.

Der Eintrag wird so vorbereitet, dass die Bearbeitung ohne Netzaufruf auskommt
(Anleitung liegt schon in `shared_instructions`, `processNext()` hakt nur ab) —
geprüft wird die Sperre, nicht Brickset.

Alle drei Regeln einzeln gebrochen: jede machte genau ihren Test rot und nur
ihren. 440 Tests grün gegen echtes Postgres 16, 0 übersprungen.

### Geprüft und in Ordnung

`processRetryQueue` (Sperre 11223344), `downloadSetImages` (42 je Set),
`partsSummary` (77 je Nutzer), Login-Zähler und Rebrickable-Kontingent
(DB-atomar), CSV-Sync und Scheduler (nur der Primary registriert). Der
Token-Cache in `utils/auth.ts` hält einen widerrufenen Token in einem anderen
Worker noch bis zu 60 s für gültig — bewusste TTL-Abwägung, unverändert.
## Nachtrag 15 — Zwei Zeichen, die niemand erklärt hat

Die letzte Spalte der Finanztabelle zeigte drei Zustände: ⚡ für „Preis aus dem
Cache", 🔴 für „gerade frisch von BrickLink geholt" und ein rotes „Err". Nirgends
stand, was das bedeutet — kein `title`, kein `aria-label`, keine Legende, kein
Spaltenkopf. Marco hat gefragt, was die Zeichen sollen; das ist die Antwort auf
die Frage, nicht bloss eine Beschriftung hinterher.

### Warum jetzt nur noch zwei Zustände

Cache oder frisch geholt ist eine **Innensicht des Servers**. Für die Frage, um
die es in der Zeile geht — stimmt diese Zahl? — macht sie keinen Unterschied,
beide Wege liefern denselben Preis. Dazu kam die Farbwahl: Der Normalfall
(Cache) bekam einen Blitz, der seltene Fall einen roten Punkt, der wie eine
Warnung aussieht. Wer die Tabelle überflog, las Alarm, wo alles in Ordnung war.

Jetzt:

* **✓** (grün) — Marktpreis vorhanden, egal woher.
* **⚠** (rot) — Marktpreis konnte nicht geladen werden.

Beide tragen `title` UND `aria-label`; Vorleseprogramme sagten vorher nur
„Blitz" bzw. „roter Kreis". Beim Fehlerfall hängt die Servermeldung mit im
Tooltip — sichtbar steht sie ohnehin in der Summenspalte. `cursor:help` zeigt,
dass überhaupt ein Tooltip dranhängt.

Der Spaltenkopf war leer und bleibt es optisch; er trägt jetzt den Text
„Preisstatus" in einer nur für Vorleseprogramme sichtbaren Auszeichnung
(`.vh` — `position:absolute` + `clip`, NICHT `display:none`, das nähme der
Sprachausgabe den Text ebenfalls).

Neue Schlüssel in beiden Sprachdateien: `finance.price_status`,
`finance.price_loaded`, `finance.price_failed`. Die alten Pillen-Klassen `.lv`
und `.lc` bleiben unverändert — sie sind allgemeine Plaketten und werden in der
Anleitungsliste weiterverwendet.

### Test

`test/a11y.test.js` prüft als Regel, nicht als Schreibweise: In der
Preisstatus-Spalte stehen GENAU zwei Zustände, jeder mit `title` und
`aria-label`, und die Texte kommen aus den Sprachdateien statt als Literal im
Code. Kommentare werden vor der Prüfung ausgeblendet — sonst hätte der
Erklärtext über der Prüfung sie selbst grün gehalten (derselbe Eigenfehler wie
in Nachtrag 11). Gegenprobe: `title` entfernt → genau dieser Test rot.

441 Tests grün gegen echtes Postgres 16, 0 übersprungen.
## Nachtrag 16 — Zwei require(), die ins Leere griffen

Zwei Aufrufe holten aus einem Modul einen Namen, den dieses Modul nie
exportiert hat. Das Ergebnis war jeweils `undefined`, der Aufruf ein
TypeError — beide in Zweigen, die selten dran sind, deshalb jahrelang
unbemerkt.

### 1. Die Teile-Rückfallebene für fremde Sets

`utils/handlers.ts` holte `fetchRebrickableParts` aus `routes/parts.ts`; die
Exportliste dort führt den Namen nicht. Betroffen ist `getParts()` mit
Set-Filter, wenn der Nutzer selbst keine Teile hat und das Set nicht im
CSV-Bestand liegt. Nachgestellt gegen echtes Postgres:

    FEHLER: TypeError fetchRebrickableParts is not a function

Das `.catch(() => [])` daneben fing nichts: Der TypeError fliegt SYNCHRON,
bevor es ein Promise gibt. Die Anfrage endete mit 500 statt mit einer leeren
Liste.

Statt den Namen nachzutragen, geht der Weg jetzt über `getAllSetParts()` in
`routes/rebrickable.ts`. Die Funktion kann alles, was die 90-zeilige
Zweitfassung nachbaute — und mehr: CSV zuerst, Tageskontingent über
`consumeRebrickableDaily()`, Drossel über den Limiter, Antwort im
`subsets_cache`. Die Zweitfassung ist entfallen; sie holte ohne all das.

### 2. Die Bestellnummern-Suche der App

`routes/api_v1/sets.ts` holte `getSetByItemNumber` aus `routes/brickset.ts` —
die Funktion dort heisst `getSetByBarcode` und wurde nirgends verwendet. Eine
gescannte 5–8-stellige Nummer, die nicht im `catalog_cache` liegt, endete
deshalb im 500er statt in der Rebrickable-Rückfallebene zwei Zeilen darunter.

`getSetByEan` und `getSetByBarcode` waren ausserdem Zeichen für Zeichen
gleich bis auf die Log-Beschriftung (Brickset kennt für beides keinen eigenen
Parameter). Jetzt eine Umsetzung `findSetByQuery(query, herkunft)`, die beiden
Namen bleiben als dünne Hüllen.

### Warum der Compiler das nicht gefunden hat

Das Projekt löst Require-Zyklen mit späten `require()`-Aufrufen mitten im Code
— rund 340 Stück. Für `import` prüft TypeScript den Namen, für `require()`
nicht: Das Ergebnis ist `any`. **`test/require-exports.test.js`** schliesst die
Lücke und lädt jedes Zielmodul aus `dist/`, um nachzusehen, was `require()`
wirklich liefert. Über 300 Namen geprüft; ausser diesen beiden war nichts
offen.

### Das Tageskontingent hatte eine zweite Tür

Die Barcode-Route hatte ein eigenes `rbGet()` ohne `consumeRebrickableDaily()`
und ohne Drossel. Ein einziger Scan konnte bis zu acht ungezählte Aufrufe
auslösen (EAN-Suche, je Treffer ein Detailabruf, zwei in `enrichResult`) —
dasselbe Muster wie beim Rebrickable-Zähler, nur an einer Datei, die damals
nicht dran war. Ist das Kontingent erschöpft, liefert `rbGet` jetzt null, und
die Route nimmt den Weg wie bei einem fehlgeschlagenen Abruf.

### downloadSetImage(): drei offene Enden

* Weiterleitungen wurden per Rekursion OHNE Tiefenbegrenzung verfolgt — eine
  Kette im Kreis lief endlos. Jetzt höchstens fünf Sprünge.
* Keine Grössenbegrenzung; jetzt 5 MB wie im Bild-Proxy.
* `fs.existsSync` + `fs.writeFileSync` blockierten den Event-Loop. Genau das
  ist in `routes/parts.ts` längst behoben, mitsamt Erklärkommentar — diese
  Stelle war übersehen worden.

### Drei Kleinigkeiten aus früheren Durchgängen

* **Doppelte Middleware:** Zwei aufeinanderfolgende Middlewares zogen beide
  mehrfache Schrägstriche zusammen; die erste war von der zweiten vollständig
  abgedeckt und ist entfallen.
* **SESSION_SECRET:** Der Fail-fast prüfte nur, OB die Variable gesetzt ist.
  Wer `docker compose up` ungelesen ausführte, lief mit dem öffentlich
  bekannten Beispielwert in Produktion — ein damit signiertes Cookie kann
  jeder selbst erzeugen. In Produktion werden jetzt die bekannten Platzhalter
  UND Werte unter 32 Zeichen abgewiesen; `compose.yaml` nennt
  `openssl rand -base64 48` als Weg zum eigenen Wert.
* **qr-login** trägt `ipThrottle` wie register/forgot/reset (30/Stunde).

### Zwei Tests, die an der Umsetzung klebten

Beim Aufräumen wurden zwei bestehende Prüfungen rot, obwohl sich am Verhalten
nichts geändert hat: Eine hing am Wortlaut der entfallenen Middleware, die
andere zählte `family: 4`-Stellen in `routes/parts.ts` (eine davon lag in der
gelöschten Zweitfassung). Beide sind auf das umgestellt, was sie eigentlich
meinen. Das ist dieselbe Sorte Test, die schon einmal eine Sicherheitslücke
festgeschrieben hat.

### Und eine Falle im Kommentar-Filter selbst

Der Filter, der vor Quelltextprüfungen die Kommentare ausblendet, war naiv:
`app.get('/images/*', …)` in `server.ts` eröffnet mit dem `/*` für die
Ersetzung einen Blockkommentar, den erst das nächste echte Kommentarende
schliesst — 28 von 53 KB verschwanden, und drei neue Prüfungen wurden grundlos
rot. `ohneKommentare()` in `test/helpers/sources.js` entfernt jetzt nur noch
Kommentare, die eine ZEILE beginnen, und ist die gemeinsame Fassung für alle
Tests.

450 Tests grün gegen echtes Postgres 16, 0 übersprungen. Alle sechs neuen
Regeln einzeln gebrochen — jede machte genau ihren Test rot.
## Nachtrag 17 — Der Katalog war täglich für Minuten leer

Sechs Punkte aus dem Durchgang über den täglichen CSV-Abgleich — der war bis
jetzt nie dran gewesen.

### 1. Import ohne leeres Fenster

Jeder Import begann mit `TRUNCATE`/`DELETE` OHNE Transaktion, danach liefen
minutenlang die Chunk-Inserts (`rb_inventory_parts`: rund 1,5 Mio. Zeilen). Mit
zwei Verbindungen gegen echtes Postgres nachgestellt — der Leser sah sofort
`0` Zeilen, und zwar für die volle Importdauer. Für die Anwendung: Sets ohne
Teile, fehlende Farb- und Teilenamen, täglich. Brach der Import ab, blieb die
Tabelle bis zum nächsten Tageslauf unvollständig.

Der naheliegende Griff — eine Transaktion drumherum — macht es schlimmer:
`TRUNCATE` nimmt eine ACCESS-EXCLUSIVE-Sperre, Leser blockieren dann für die
volle Importdauer (ebenfalls nachgestellt: die Leseabfrage hing).

Jetzt `importiereMitTausch()`: Daten zuerst vollständig in eine UNLOGGED
Schattentabelle (`LIKE … INCLUDING ALL`, damit die ON-CONFLICT-Klauseln ihre
Schlüssel behalten), dann EINE Transaktion mit `DELETE` + `INSERT … SELECT`.
Das `DELETE` nimmt nur Zeilensperren — dank MVCC sehen Leser bis zum COMMIT den
alten vollständigen Bestand und danach den neuen. Nie einen leeren. Alle acht
Importe laufen darüber; aus je zwölf Zeilen Task-Code wurde eine Beschreibung.

Dazu eine Plausibilitätsbremse: 0 gelesene Zeilen bricht ab, statt den Katalog
durch nichts zu ersetzen (abgebrochener Download, kaputte Datei).

### 2. Insert-Fehler brechen ab

`mkInsert()` endete auf `.catch(() => {})`. Ein abgewiesener Block verlor bis
zu 100 Zeilen, der Import meldete Erfolg und setzte den Tagesmarker — der
Katalog war still unvollständig. Jetzt bricht der Task ab.

### 3. Zeitlimit für den Download

`downloadToTmp()` rief `https.get` ohne Frist. Eine hängende Verbindung liess
den Abgleich für immer stehen — und weil er beim Erststart läuft, blieb die
Startanzeige ewig auf „Lade…". Jetzt 60 s Untätigkeitsfrist (`setTimeout` misst
die Pause zwischen Datenpaketen, grosse Dateien dürfen also beliebig lange
laden).

### 4. Zwischendateien werden aufgeräumt

Nach dem Import löschte niemand die entpackten `.tmp`-Dateien;
`inventory_parts.csv.tmp` liegt bei rund einem Gigabyte. Jetzt `unlink` im
`finally` von `runWorker`, auch bei Abbruch.

### 5. Sechs Funktionen ohne Aufrufer

`downloadCsv`, `streamCsvToDB` und `fetchBlIds` (`rebrickableCsvSync.ts`),
`extractSetFromEan`, `partIsToday`, `probeBrickInstructions` — rund 250 Zeilen,
darunter eine dritte Kopie der CSV-Zerlegung und eine dritte der
BrickInstructions-Prüfung. Mit ihnen entfielen die nur noch dort benutzten
Importe (`https`, `http`, `zlib`, `readline`, Ratenbegrenzer).

Toter Code war in drei Durchgängen hintereinander der Ausgangspunkt eines
echten Fehlers — solche Fassungen bekommen keine Korrekturen, keine Sperren,
keine Kontingentprüfung, und irgendwann ruft sie doch jemand auf. Deshalb
`test/dead-code.test.js` als Dauerprüfung.

### 6. Verdoppelte Anführungszeichen

`parseCsvLine` schaltete bei jedem `"` nur den Zustand um und verwarf das
Zeichen: Aus `3 "Zoll"` wurde `3 Zoll`. Kommas in Anführungszeichen waren nie
betroffen, deshalb fiel es lange nicht auf. Jetzt wird `""` zu einem `"`.

### Nachweise

`test/csv-import-db.test.js` prüft gegen echtes Postgres: Eine zweite
Verbindung zählt während des laufenden Imports mit und schlägt Alarm, wenn sie
je 0 Zeilen sieht; dazu leere Datei, fehlerhafter Block, Anführungszeichen und
„keine Schattentabelle bleibt liegen". Gegenprobe mit dem alten `DELETE`
vorweg: sofort rot.

Punkt 3 ist als einzige eine Quelltextregel — ein echter Nachweis bräuchte
einen TLS-Server, der annimmt und dann schweigt. Die Regel ist wenigstens gegen
`if (false)` abgesichert (der Aufruf muss eine eigene Anweisung sein).

### Und wieder ein Test, der an der Umsetzung klebte

Die IPv4-Prüfung zählte je Datei eine feste Anzahl `family: 4`-Fundstellen und
wurde durch das Aufräumen rot (5 statt 1), obwohl sich am Verhalten nichts
änderte — dasselbe wie in Nachtrag 16. Sie prüft jetzt die Regel: Jeder
ausgehende `get`/`request`-Aufruf trägt `family: 4` oder den geprüften
`_cdnAgent`, unabhängig von der Anzahl.

459 Tests grün gegen echtes Postgres 16, 0 übersprungen.
## Nachtrag 18 — PDF-Aufträge ohne Besitzer

Vier Punkte aus dem Durchgang über den PDF-Export und den CSV-Export.

### 1. Wem gehört ein Auftrag?

`pdfJobWrite()` legte `{status, error, missingImages, etaSeconds}` ab — keine
Benutzer-ID. Alle drei Abrufrouten (`status`, `stream`, `download`) verlangten
einen gültigen Token, prüften aber nie, WESSEN Auftrag das ist. Wer eine fremde
`jobId` kannte, lud deren PDF herunter; weil der Download die Datei danach
löscht, bekam der eigentliche Besteller anschliessend ein „PDF nicht mehr
verfügbar". Dieselbe Regel wie bei `serveDataFile` in Nachtrag 10: Die
Zugehörigkeit gehört auf den Server, nicht in die Unkenntnis der ID.

Jetzt trägt jeder Auftrag `user_id`, und die drei Routen kommen nur noch über
`pdfJobReadFor(id, userId)` an ihn. Ein fremder Auftrag antwortet mit demselben
404 wie ein unbekannter — wer nicht berechtigt ist, soll nicht erfahren, ob es
die ID gibt.

Dazu die Kennung selbst: Sie kam aus `Math.random().toString(36)`. Jeder andere
Schlüssel im Projekt kommt aus `crypto.randomBytes` (sechs Stellen in
`routes/auth.ts`); hier war die Ausnahme ohne Grund. Jetzt sechs Zufallsbytes
als Hex. Das Prüfmuster lässt die alte Form weiter zu, damit Aufträge über ein
Update hinweg abrufbar bleiben.

### 2. Deckel auf gleichzeitige Läufe

Jeder POST startete über `setImmediate` einen Lauf im bearbeitenden Web-Worker,
der hunderte Bilder nachlädt und das PDF im Arbeitsspeicher aufbaut. Zehnmal
auf den Knopf getippt hiess zehn parallele Läufe in einem Prozess. Jetzt zwei
gleichzeitige Aufträge je Benutzer, darüber 429 mit Klartext-Hinweis.

Gezählt wird über die Auftragsdateien im gemeinsamen Verzeichnis, nicht über
einen Zähler im Prozessspeicher — der lag in dieser Sammlung schon sechsmal
daneben. Abgelaufene Aufträge zählen nicht mit: Stürzt ein Worker mitten im
Lauf ab, bleibt die Datei auf `running` stehen, und ohne diese Frist wäre der
Benutzer dauerhaft ausgesperrt.

### 3. Aufräumen hängt nicht mehr am nächsten Export

`cleanOldPdfJobs()` lief ausschliesslich im POST. Wer einen Export abbrach und
nie wieder einen startete, liess PDF und Auftragsdatei dauerhaft liegen. Jetzt
stündlich im Primary (`startPdfJobCleanup()`), direkt neben dem Bild-Cache, der
aus demselben Grund dorthin gewandert ist.

### 4. Formeln im CSV-Export

`csvField()` zitierte korrekt, entschärfte aber führende `=`, `+`, `-`, `@`,
Tabulator und Wagenrücklauf nicht — eine Notiz oder ein Setname wie
`=HYPERLINK(…)` wird beim Öffnen in Excel, LibreOffice oder Google Sheets
AUSGEFÜHRT. Der Inhalt kommt aus Feldern, die auch ein Unterkonto im Haushalt
schreiben kann.

Der Zielkonflikt war real: Die Exporte sind ausdrücklich so gebaut, dass der
eigene Importer sie wieder einliest. Deshalb zwei Hälften — `entschaerfe()`
setzt beim Export ein Hochkomma, `entschaerfungRueckgaengig()` entfernt es beim
Import wieder, und zwar NUR wenn danach ein Formelzeichen steht. Ein Feld, das
echt mit einem Hochkomma beginnt, bleibt unangetastet. Reine Zahlen sind
ausgenommen, sonst käme jeder negative Kaufpreis mit Hochkomma zurück. Alle
drei Importwege (Sets, Teile, Minifiguren) machen die Entschärfung rückgängig.

### Nachweise

`test/pdf-jobs-db.test.js` fährt echte Routen mit echten Tokens: eigener
Auftrag lesbar, fremder mit 404 und ohne PDF-Inhalt, der Fehlversuch
beschädigt den fremden Auftrag nicht, Deckel greift beim dritten Lauf und
bremst den zweiten Benutzer nicht, hängengebliebene Läufe sperren niemanden
aus, Kennung ist 6-Byte-Hex und wiederholt sich in 200 Ziehungen nicht.

Der Lauf selbst wird nicht gestartet (er ginge ins Netz) — die
Auftragsdateien legt der Test direkt. Geprüft wird der Abrufweg, und genau
dort fehlte es.

Gegenproben: Besitzprüfung deaktiviert, Deckel deaktiviert, Kennung zurück auf
`Math.random`, Formelschutz entfernt — jede machte genau ihren Test rot.

467 Tests grün gegen echtes Postgres 16, 0 übersprungen.
## Nachtrag 19 — Die Portfolio-Kurve rechnete im falschen Prozess

### 1. Rekonstruktion in der Datenbank statt im Node-Heap

`getPortfolioHistory()` lud JEDE `price_history`-Zeile aller Sets in den
Node-Prozess und gruppierte sie in JavaScript. Für den Haushalt ist das der
Normalfall, nicht die Ausnahme — der schnelle Schnappschuss-Weg gilt nur für
ein einzelnes Konto.

Gemessen mit 800 Sets und einem Jahr Tageswerten (292 000 Zeilen, 40 MB):

| Fall | Zeitraum | vorher | nachher |
|---|---|---|---|
| ein Konto | Monat | 264 ms / +4,9 MB | 144 ms / +1,1 MB |
| ein Konto | Max | 1199 ms / +41,8 MB | 487 ms / ±0 MB |
| Haushalt | Monat | 280 ms / +7,2 MB | 244 ms / ±0 MB |
| Haushalt | Max | 1741 ms / +34,0 MB | 931 ms / ±0 MB |

Zwei Änderungen stecken darin:

**Fortschreibung als Differenzrechnung.** Ein Set ohne neuen Wert behält seinen
letzten Preis — in der alten Schleife über ein `carry`-Objekt. In SQL wird je
Set nur die ÄNDERUNG zum Vorwert gezählt; die laufende Summe über die Tage
ergibt denselben Gesamtwert. Ein einfaches `GROUP BY Tag` wäre schneller
gewesen, hätte aber ANDERE Zahlen geliefert: Tage ohne Messwert fielen aus der
Summe.

**Monatsauflösung für Jahr und Max.** Die Verdichtung auf Monate passierte
ohnehin — nur eben erst NACH dem Laden aller Tageswerte. Jetzt gruppiert
Postgres gleich richtig, der Fensterlauf fällt von 292 000 auf 9 600 Zeilen
(203 ms statt 1478 ms für die reine Abfrage).

Zwei Feinheiten, die dabei erhalten bleiben mussten: Der erste Punkt zeigt den
Wert am ersten Tag MIT Daten, nicht am Monatsende (eigene kleine Abfrage,
129 ms) — sonst begänne die Jahreskurve höher als die Monatskurve. Und der
Zeitraumfilter gilt auch für diesen Startpunkt, sonst zählten Daten VOR dem
Fenster mit.

### 2. Ein Preiseintrag je Set, Zustand, Währung und Tag

Zwei Schreibwege (`priceJob.ts` beim Abruf, `financeCalc.ts`) tragen
`ON CONFLICT DO NOTHING` — die Tabelle hatte aber nur den Primärschlüssel auf
`id`. Ohne passenden Unique-Index kann die Klausel nie greifen: Sie liest sich
wie ein Schutz gegen Dubletten und ist keiner.

Jetzt gibt es den Index (`recorded_at` ausdrücklich in UTC, weil
`recorded_at::date` zeitzonenabhängig und damit nicht indizierbar wäre), und
die Migration räumt vorhandene Dubletten vorher weg — es gewinnt der jüngste
Eintrag des Tages, genau der, den die Auswertung ohnehin genommen hätte.

Dazu ein Aufräumlauf: `purgeAltePreise()` entfernt täglich im Primary Zeilen
älter als `PRICE_HISTORY_KEEP_DAYS` (Vorgabe 1095, 0 = aus). Die
Portfolio-Schnappschüsse (`__portfolio__<id>`) sind ausgenommen — daran hängt
der schnelle Weg für ein einzelnes Konto.

### 3. Der Mailer prüft wieder Zertifikate

`routes/mailer.ts` setzte fest verdrahtet `rejectUnauthorized: false` — die
einzige Stelle im Projekt, die eine TLS-Prüfung abschaltete. Damit gingen die
SMTP-Anmeldung und jeder Link zum Zurücksetzen eines Passworts über eine
Verbindung, deren Gegenstelle nicht überprüft wurde.

Vorgabe ist jetzt PRÜFEN. Für selbst signierte Zertifikate im Heimnetz bleibt
die Ausnahme möglich, aber als bewusste Entscheidung: `smtp_insecure_tls`
(Einstellungen → E-Mail, mit Warnung im Log bei jedem Verbindungsaufbau).

### Nachweise

`test/portfolio-history-db.test.js` bringt die ALTE JavaScript-Fassung als
Vergleich mit — wörtlich übernommen und bewusst als Kopie, damit sie sich nicht
mitändert. Beide rechnen auf denselben Daten, für alle vier Zeiträume, und die
Werte müssen bis auf einen Rappen übereinstimmen (die alte Fassung rechnete in
Gleitkomma, die neue in NUMERIC). Der Testbestand hat ausdrücklich LÜCKEN — ein
Set schreibt nur jeden dritten Tag — denn genau dort trennt sich Fortschreibung
von einfacher Tagessumme.

Gegenproben: Fortschreibung ausgehängt (alle vier Zeiträume rot), Unique-Index
nicht angelegt (beide Dubletten-Prüfungen rot), `rejectUnauthorized: false`
zurückgesetzt (Mailer-Prüfung rot).

479 Tests grün gegen echtes Postgres 16, 0 übersprungen.
## Nachtrag 20 — Drei gemeldete Fehler beim Eigentümerwechsel

Marco hat einen Bildschirmausschnitt der App, zwei Browser-Konsolenfehler und
drei Zeilen aus dem Serverprotokoll geschickt. Dahinter steckten vier
verschiedene Ursachen — alle am selben Vorgang: einen Kaufpreis in ein anderes
Konto des Haushalts verschieben.

### 1. „closeModal is not defined" (Browser-Konsole)

`07-admin.js` ruft nach dem Wechsel `closeModal()` auf. Die Funktion lag als
modul-LOKALE Funktion in `02-gallery.js` und war nur über `registerActions()`
für `data-click`-Knöpfe im HTML erreichbar — als Import gab es sie nie. Der
Wechsel war zu dem Zeitpunkt bereits gespeichert; sichtbar blieben ein offener
Dialog und eine Galerie mit altem Stand. Der Fehler kam aus dem `<select>` für
das Zielkonto, deshalb `at HTMLSelectElement` in der Konsole.

Jetzt exportiert und importiert. **`test/frontend-imports.test.js`** prüft das
künftig für alle Frontend-Module: Ruft eine Datei einen Namen auf, den ein
anderes Modul auf oberster Ebene deklariert, muss sie ihn importieren. Das ist
die Frontend-Fassung von `test/require-exports.test.js` — dort prüft TypeScript
die späten `require()` nicht, hier prüft niemand die Modulgrenzen.

### 2. 500er: „Cannot access 'onProgress' before initialization"

Im CSV-Fortschrittsstrom (SSE) stand der erste `send()` VOR den Anmeldungen.
Meldet der Client beim allerersten Schreiben Gegendruck — Handy im Funkloch,
halb tote Verbindung —, ruft `send()` sofort `cleanup()` auf, und das greift
auf `onProgress` zu, das als `const` erst weiter unten entsteht. Im Protokoll
standen beide Zeilen direkt hintereinander: erst der Gegendruck-Hinweis, dann
der Fehler.

Jetzt werden erst alle Rückrufe und Zeitgeber angelegt, dann der erste Stand
geschickt. Der Test prüft die Reihenfolge: Alles, was `cleanup()` anfasst, muss
vor dem ersten `send()` auf oberster Ebene stehen.

### 3. pg-Warnung: parallele Abfragen auf einer Verbindung

`copyContents()` in `utils/setMove.ts` prüfte per `Promise.all` drei Tabellen
gleichzeitig — auf DERSELBEN Transaktionsverbindung. pg warnt davor („will be
removed in pg@9.0"); in einer Transaktion ist die Reihenfolge von BEGIN,
Abfrage und COMMIT dann nicht mehr die, die im Code steht. Jetzt nacheinander;
zeitlich kostet es nichts (drei Indexzugriffe auf LIMIT 1).

**Zum Test:** Der erste Anlauf war eine Quelltextregel („kein Promise.all mit
mehreren `tx.`-Aufrufen"). Die hätte den echten Fehler NICHT gefunden — die
Abfragen standen hinter einem Helfer namens `has()`. Ersetzt durch
`test/set-move-db.test.js`, das den Lauf ausführt und die Warnungen von Node
mitschreibt. Gegenprobe mit `Promise.all`: sofort rot.

### 4. „0 Teile und 0 Minifiguren mitgenommen" (Android)

Kein Datenfehler — die Meldung log. In `AcquisitionManagementScreen.kt` stand

    val moveOkText = stringResource(R.string.household_move_ok, 0, 0)

mit fest verdrahteten Nullen. Der Server liefert `parts` und `minifigs` seit
jeher mit, `GenericResponse` hatte dafür aber keine Felder, und
`changeAcquisitionOwner` reichte nur `onDone(null)` durch. Jetzt trägt die
Antwort die Zahlen, der Rückruf gibt sie weiter, und die Meldung entsteht erst
dort.

Dass 0 auch die richtige Antwort sein kann, bleibt wahr: bei einem Set ohne
importierte Teile, und wenn das Zielkonto für dieses Set schon Zeilen hat
(dann kopiert der Server bewusst nichts). Beide Fälle sind jetzt als Verhalten
festgehalten.

### Noch ein Test, der an der Umsetzung klebte

`test/household.test.js` verlangte wörtlich `const [hasParts, hasFigs,
hasInstr]` — durch die Korrektur aus Punkt 3 wurde er rot, obwohl sich an der
geprüften Regel nichts geändert hat. Jetzt prüft er die Aussage: eine eigene
Prüfung je Tabelle.

486 Tests grün gegen echtes Postgres 16, 0 übersprungen.
## Nachtrag 21 — Geld war Gleitkomma, und das Erst-Passwort stand im Log

Beide Punkte kamen nicht aus dem Lesen, sondern daraus, den Server einmal zu
starten und die Endpunkte abzuklopfen.

### 1. Geldbeträge als NUMERIC statt REAL

27 Preisspalten lagen als REAL (32-Bit-Gleitkomma) in der Datenbank. Am
laufenden Server sichtbar:

    /api/sets       → "avg_purchase_price": 49.9000015258789
    /api/finance/…  → "value": 49.900001525878906

für einen eingegebenen Kaufpreis von 49.90. Schlimmer als die Anzeige ist das
Rechnen — in Postgres nachgestellt:

    SUM über 1000 Beträge à 0.07  →  69.99974   (exakt wären 70.00)
    12.34::real * 3               →  37.02000045776367

Der Fehler wächst mit der Zahl der Summanden, also mit der Sammlung. Genau
diese Summen zeigt der Finanzreiter.

`db/migrations/0007-geld-als-numeric.sql` stellt alle 27 Spalten auf
NUMERIC(12,4) um; `initSchema()` legt sie bei Neuinstallationen gleich so an.
Vier Nachkommastellen, weil Stückpreise einzelner Teile unter einem Rappen
liegen können. Der USING-Ausdruck rundet den Altbestand auf vier Stellen —
das REPARIERT: Aus gespeicherten 49.9000015258789 wird wieder 49.9000, denn
mehr Stellen hatte die Eingabe nie.

**Der Treiber liefert NUMERIC als Zeichenkette.** Ohne Gegenmassnahme würde aus
`preis * menge` an hunderten Stellen eine Zeichenketten-Rechnung, und ein Preis
von 0 wäre als `"0.0000"` in jeder if-Abfrage wahr — genau die Sorte stiller
Fehler, die diese Umstellung nicht eintauschen soll. `db/database.ts` setzt
deshalb einen Typ-Parser, der NUMERIC beim Lesen wieder zu einer
JavaScript-Zahl macht. Der Gewinn bleibt vollständig: Er liegt beim SPEICHERN
und beim RECHNEN IN DER DATENBANK, und dort ist jetzt alles exakt dezimal.

Nachher, gegen einen frisch gestarteten Server mit demselben Kaufpreis:

    {'purchase_price': 49.9, 'max_purchase_price': 49.9, 'avg_purchase_price': 49.9}
    Diagrammwert: 49.9

### 2. Das Erst-Passwort ging durch den Log-Abfänger

`initSchema()` gibt das erzeugte Admin-Passwort beim ersten Start auf der
Konsole aus — „NUR JETZT sichtbar". Das stimmte seit dem Log-Abfänger nicht
mehr: Der schreibt JEDE Konsolenzeile nach `app_logs`, und
`GET /api/v1/admin/logs` gab sie 48 Stunden lang im Klartext wieder aus —
mitsamt jedem Datenbank-Backup aus diesem Zeitraum. Über die echte Route
abgerufen und bestätigt.

Der Banner geht jetzt direkt über `process.stdout.write` und damit am Abfänger
vorbei: Er steht im Container-Log des ersten Starts, wo er hingehört. Ein
Filter im Abfänger wäre die Alternative gewesen — der hinge an einer
Zeichenkette, die jemand später umformuliert.

Gegengeprüft am laufenden Server: `NUR JETZT` steht einmal im Container-Log,
der Log-Viewer liefert null Treffer.

### Nachweise

`test/money-numeric-db.test.js`: keine Geldspalte mehr in Gleitkomma (weder bei
Neuinstallation noch nach der Migration einer alten Datenbank — die wird
ausdrücklich nachgestellt, indem eine Spalte auf REAL zurückgesetzt und die
Migration erneut angestossen wird), 1000 Beträge à 0.07 summieren sich exakt
auf 70, ein gespeicherter Kaufpreis kommt als 49.9 zurück, und die Werte
kommen als Zahl an, nicht als Zeichenkette.

Drei Gegenproben: Typ-Parser entfernt (Zahl-Prüfung rot), Spalten zurück auf
REAL samt entfernter Migration (vier Prüfungen rot), Banner zurück auf
`console.log` (Passwort-Prüfung rot).

Beim zweiten Gegenprobe-Anlauf fiel auf, dass der Bau die `.sql`-Dateien nach
`dist/` kopiert: Die gelöschte Migration lag dort noch und lief weiter — der
Test blieb grün, obwohl die Quelle weg war. Erst mit gelöschter Kopie wurde er
rot. Wer künftig eine Migration zurückzieht, muss `dist/` mit aufräumen.

493 Tests grün gegen echtes Postgres 16, 0 übersprungen.
## Nachtrag 22 — Gleichzeitiges Erfassen verlor Exemplare

### 1. Der Erfassen-Pfad lief ohne Sperre

Alle anderen Schreibwege (Mengenänderung, Verschieben, Eigentümerwechsel)
hielten die Bestandssperre aus `utils/txLock.ts` längst — ausgerechnet das
Erfassen nicht. `recordAcquisitionForDay()` liest erst und schreibt dann; zwei
gleichzeitige Anfragen lesen beide „keine Zeile für heute". Am laufenden Server
mit zehn parallelen Erfassungen desselben Sets:

    sets.quantity     = 10        (richtig)
    set_acquisitions  = 3 Zeilen, Summe 7

Drei Tageszeilen statt einer und drei verlorene Exemplare. Die Finanzzahlen
kommen aus den Erfassungen — der Bestand sagte 10, die Kaufpreise sagten 7.
Realistisch wird das beim Doppeltippen in der App, beim CSV-Import parallel zur
App oder bei zwei Geräten.

Beide Schreibzweige in `addSet()` laufen jetzt unter `withInventoryLock`. Der
Marktpreis wird davor geholt: Eine Sperre über einen Netzaufruf zu halten würde
jeden anderen Schreibvorgang auf diesem Set für die Dauer der Antwort
blockieren.

### 2. Die Tagesregel steht jetzt in der Datenbank

Im Code stand die Notiz, ein UNIQUE-Index sei unmöglich, weil
`timestamptz::date` nicht IMMUTABLE ist. Das stimmt — aber
`(created_at AT TIME ZONE 'UTC')::date` ist es, und genau dieser Kniff steht
seit Nachtrag 19 schon in `price_history`.

`db/migrations/0008` fasst doppelte Tageszeilen zusammen (Mengen addiert, Preis
mengengewichtet, gebraucht gewinnt — dieselbe Rechnung wie beim Aufstocken) und
legt für alle drei Erfassungstabellen den Unique-Index an. Der Tagesvergleich
in `utils/acquisitions.ts` läuft dafür auf UTC statt auf die Sitzungszeitzone;
der Server läuft ohnehin in UTC (`Etc/UTC` im Container), für die Installation
ändert sich nichts.

Die Sperre verhindert das Rennen, der Index ist das Netz darunter — er gilt
auch für Wege, die jemand später hinzufügt und dabei die Sperre vergisst.

### 3. Menge und Preis werden serverseitig geprüft

Über die API kam durch: `quantity: -5`, `quantity: 999999999` (stand danach als
999 999 995 in `sets`) und `purchase_price: -20` — letzteres an allen drei
Erfassen-Wegen. Ein Tippfehler mit Minuszeichen senkte damit stillschweigend
den Gesamtwert der Sammlung.

Neu in `utils/validate.ts`: `acquisitionQuantity()` (1 bis 10 000) und
`optionalPrice()` (nicht negativ, Komma als Dezimaltrenner, 0 bleibt ein
gültiger Preis). Angewandt in allen vier Erfassen-Wegen — Webapp und
Android-API, Sets wie manuelle Einträge. Die Weboberfläche verhinderte das mit
`min="0"`; die Regel gehört auf den Server, App und API gehen daran vorbei.

### Nachweise

`test/erfassen-parallel-db.test.js` fährt zehn echte parallele Aufrufe und
prüft: eine Tageszeile, Menge 10. Dazu der Index (zweite Tageszeile wird
abgewiesen, ein anderer Tag bleibt erlaubt) und die Prüffunktionen selbst.

Gegenproben: eine Sperre entfernt (Regel-Test rot), Migration entfernt (drei
Index-Prüfungen rot).

Zwei bestehende Tests verlangten wörtlich `created_at::date` und wurden durch
den UTC-Ausdruck rot, obwohl sich an der geprüften Regel nichts geändert hat —
auf die Aussage umformuliert.

500 Tests grün gegen echtes Postgres 16, 0 übersprungen.
## Nachtrag 23 — Ein krummer CSV-Eintrag kippte die ganze Datei

Gefunden beim Abklopfen des laufenden Servers: Eine Datei mit einer einzigen
fehlerhaften Zeile importierte **nichts**, und die Antwort war die rohe Ausgabe
des Parsers:

    CSV Parse Fehler: Invalid Record Length: columns length is 3, got 1 on line 3

Für eine 500-Zeilen-Liste aus einer Fremdquelle ist das die schlechteste
denkbare Antwort — nichts importiert, und wer die Meldung liest, weiss nicht,
was zu tun ist.

Neu ist `csvEinlesen()` in `utils/csvExport.ts`: `relax_column_count` und
`relax_quotes` lassen krumme Zeilen durch, wirklich leere Zeilen werden
übersprungen und ihre Zeilennummern kommen mit zurück — 1-basiert und inklusive
Kopfzeile, also so, wie sie im Editor stehen. Vollständig unlesbare Dateien
werfen weiterhin; dann stimmt etwas Grundsätzliches nicht.

Alle drei Importwege (Sets, manuelle Teile, manuelle Minifiguren) lesen jetzt
darüber, liefern `skipped` und `skipped_hint` in der Antwort, und beide
Oberflächen zeigen den Hinweis an — sonst sähe ein Import mit stillen Lücken
aus wie ein vollständiger. Findet sich gar keine brauchbare Zeile, sagt die
Fehlermeldung das jetzt in Klartext statt in Parser-Sprache.

Gegenprobe: `relax_column_count` entfernt → der Test wird rot.

502 Tests grün gegen echtes Postgres 16, 0 übersprungen.
## Nachtrag 24 — Die Teileliste eines Sets war in der App unvollständig

Punkt B aus dem letzten Durchgang lautete: „`/api/parts` liefert ohne
page_size alles auf einmal, und die Android-App ruft so auf". Der zweite Teil
stimmte nicht — die App schickt seit jeher `page_size=500` und blättert über
`onLoadMore` nach. Die Behauptung stammte aus einem veralteten Kommentar in
`utils/handlers.ts`, den ich ungeprüft übernommen hatte.

Beim Nachmessen kam dafür ein echter Fehler heraus, der schwerer wiegt.

### Die Set-Detailansicht bekam nur 500 Teile

Sie fragt `page_size=2000` und holt NUR Seite 1. `clampPageSize` deckelte auf
`MAX_PAGE_SIZE = 500`. Am laufenden Server mit einem Set aus 915 Teilezeilen:

    geliefert 500 von total 915 | page_size (gemeldet) 2000

Zwei Fehler in einem. Die App zeigte gut die Hälfte der Teile — und die
Antwort meldete die ANGEFRAGTE Seitengrösse zurück, nicht die gelieferte.
Damit konnte kein Client merken, dass etwas fehlt. Die PDF-Teileliste baut auf
derselben Antwort auf.

Jetzt:

* **`SET_PARTS_MAX_PAGE_SIZE = 5000`** gilt, wenn nach `set_number` gefiltert
  wird. Ein Set ist eine begrenzte Menge; die grössten liegen bei rund 12 000
  Teilen, nach Farbe gruppiert deutlich darunter. Für die allgemeine
  Teileliste bleibt es bei 500 — dort blättern beide Clients.
* **Die Antwort meldet die tatsächliche Seitengrösse.** Zusammen mit `total`
  lässt sich jetzt ablesen, ob eine weitere Seite nötig ist.
* **`UNPAGED_LIMIT = 2000`** greift, wenn ein Aufrufer gar kein `page_size`
  schickt — auf BEIDEN Abfragewegen. Dass Zusammenfassungs- und Live-Pfad sich
  unterschiedlich deckeln, war schon einmal ein Fehler (dieselbe Anfrage
  lieferte je nach Cache-Zustand 500 oder 5000 Zeilen).

### Was ausdrücklich NICHT gedeckelt wurde

Die SET-Liste. Ein erster Anlauf gab ihr dieselbe Grenze — falsch: Die App
blättert die Galerie nicht (`BrickApiService.getSets` kennt keinen
page-Parameter, so auch in `routes/api_v1/sets.ts` vermerkt). Eine Grenze hätte
ihr ab dem Grenzwert stillschweigend Sets unterschlagen, also genau den Fehler
erzeugt, der oben behoben wurde. Aufgefallen ist es an einem bestehenden Test,
der die unbegrenzte Set-Liste festhält.

### Nachweis

Am laufenden Server, alle vier Fälle:

    set_number, page_size=2000  →  915 von 915  | page_size 2000
    page_size=2000              →  500 von 3900 | page_size 500
    ohne page_size              → 2000 von 3900 | page_size 2000
    /api/v1/sets                →  801 von 801

Gegenprobe: Set-Grenze zurück auf MAX_PAGE_SIZE → Test rot.

Ein bestehender Test verlangte wörtlich `clampPageSize(o.page_size, 100)` im
Zusammenfassungs-Pfad und wurde rot, obwohl die Regel („beide Wege deckeln
gleich") unverändert gilt — auf die Aussage umformuliert.

503 Tests grün gegen echtes Postgres 16, 0 übersprungen.
## Nachtrag 25 — Der Sammelposten „Unterkonten" entfällt

Auf Marcos Wunsch: Der Eintrag „Unterkonten" fällt aus dem Kontofilter — in
allen vier Ansichten der Webapp und in der Android-App.

Begründung: Er beantwortete nur „nicht mir" und stand zwischen zwei Einträgen,
die dieselbe Frage genauer beantworten. Bei zwei Kindern war die Auswahl damit
fünf Zeilen lang, von denen eine nichts hinzufügte. Übrig bleiben: Alle Konten,
Eigene, dann jedes Unterkonto namentlich.

Entfallen sind auch die zugehörigen Texte (`household.scope_subs` in de/en,
`household_scope_subs` in beiden strings.xml) und der `labelSubs`-Parameter von
`ScopeFilter.options()`.

**Der Server versteht `accounts=subs` weiterhin.** Das ist Absicht und kein
vergessener Rest: Eine ältere Fassung der App auf einem Gerät schickt den Wert
sonst ins Leere. `parseScopeMode()` und `scopeIds()` bleiben deshalb
unverändert, und die bestehenden Prüfungen dazu ebenfalls.

Der Kotlin-Test „der Sammelposten erscheint erst ab zwei Kindern" ist zu „kein
Sammelposten Unterkonten mehr" geworden — er hält jetzt fest, dass der Eintrag
auch bei mehreren Kindern nicht wieder auftaucht.

503 Tests grün gegen echtes Postgres 16, 0 übersprungen.
