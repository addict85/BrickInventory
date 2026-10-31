# Begründungen zu `src/konto/auth.ts`

Die ausführlichen Kommentare aus `src/konto/auth.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Zentrale Auth-Helfer: Session ODER Bearer-Token (Android-App).

Warum ein eigener Token-Cache: Die Android-App feuert beim Öffnen 5–8
API-Requests parallel. Vorher hat JEDER Request ein SELECT auf api_tokens
plus ein blockierendes UPDATE (last_used) ausgelöst — zwei DB-Roundtrips
pro Request nur für die Auth. Der Cache hält validierte Tokens 60s im
Speicher; last_used wird höchstens alle 5 Minuten und fire-and-forget
(ohne await im Request-Pfad) geschrieben.

Cache-Invalidierung: Beim Logout/Token-Löschen invalidateToken() aufrufen.
Worst Case ohne Aufruf: ein gelöschter Token funktioniert max. 60s weiter —
für diese App ein akzeptabler Trade-off. (Cluster: Cache ist pro Worker.)
```

<a id="tokenbenutzer"></a>
## `TokenBenutzer`

```text
── Warum diese Typen hier stehen (Nachtrag 155) ─────────────────────────────

Diese Datei hatte 20 implizite `any` — mehr als jede andere sicherheitsnahe
Stelle im Baum. Das ist die schlechteste Stelle dafuer: Wer hier einen
Feldnamen vertippt (`user.is_activ`), bekommt `undefined`, und `undefined`
ist falsy — die Sperre eines deaktivierten Kontos faellt still aus. Genau so
ein Fehler ist ohne Typpruefung nicht zu sehen.

Die JSDoc darunter beschrieb die Typen laengst korrekt; sie standen nur nicht
in den Signaturen. Hier wird also nichts erfunden, sondern aufgeschrieben,
was schon dokumentiert war.

Ein Kommentar an resolveUserId behauptete "any bis @types/express installiert
ist" — @types/express IST installiert, samt @types/express-session. Der
Vorbehalt war ueberholt.
```

<a id="verifiziereemailtoken"></a>
## `verifiziereEmailToken`

```text
E-Mail-Verifikation: einen Token einlösen.

── Warum diese Funktion existiert (Nachtrag 154) ───────────────────────────
Dieselben acht Zeilen standen ZWEIMAL im Baum: in server.ts unter
`GET /verify` (der Link aus der Mail) und in routes/auth.ts unter
`GET /api/auth/verify`. Beide Kopien enthielten die Hash-Regel, die
Ablaufprüfung UND das Abräumen der Token-Felder. Wer die Regel ändert,
ändert sie an einer Stelle und übersieht die andere — genau die Bauart von
Fehler, gegen die dieses Projekt sonst überall angeht (Logik einmal
implementieren, über mehrere Routen anbieten).

Geteilt wird nur die LOGIK. Die Antwortform bleibt Sache der Aufrufer: der
Browser-Link leitet weiter, die API antwortet mit JSON. Das ist kein
Zufall, sondern der Unterschied zwischen einem Klick in einer Mail und
einem Aufruf aus einem Programm.

── Warum „abgelaufen" und „unbekannt" NICHT unterschieden werden ───────────
Beides ergibt `ungueltig`. Die Abfrage prüft Hash, Ablauf und
`email_verified = 0` in EINEM Zug; ein bereits eingelöster Token findet
deshalb ebenfalls keine Zeile. Das ist Absicht: Wer von aussen erfährt, ob
ein Token existiert und nur abgelaufen ist, kann raten, ob eine Adresse ein
Konto hat. Dieselbe Überlegung wie bei der neutralen Antwort in
/forgot-password. Wer hier später doch unterscheiden will, handelt sich
genau diese Preisgabe ein.

@param {string|undefined|null} token Der ROHE Token aus der URL, ungehasht.
@returns {Promise<{ok: boolean, grund?: string, userId?: number}>}
  `{ok:true, userId}` bei Erfolg, sonst `{ok:false, grund:'fehlt'}` wenn gar
  kein Token kam, oder `{ok:false, grund:'ungueltig'}` in allen anderen
  Fällen (unbekannt, abgelaufen, bereits eingelöst).
```

<a id="validatetoken-row"></a>
## `row`

```text
Nur noch der Hash-Pfad.

VORHER stand hier ein Legacy-Fallback, der bei einem Fehlschlag ein
zweites Mal mit dem KLARTEXT-Token suchte und die Zeile dann in-place auf
den Hash umschrieb. Gedacht war das als einmalige Migrationshilfe für
Alt-Installationen — praktisch hielt es die Klartext-Speicherung dauerhaft
gültig: Wer eine Kopie der api_tokens-Tabelle in die Hände bekommt (Backup,
Log, versehentlicher Dump), kann jede noch nicht migrierte Zeile direkt als
Credential verwenden. Genau das soll das Hashen verhindern.

Die Bereinigung übernimmt einmalig initSchema() in db/database.ts:
Zeilen, deren Token nicht dem Hash-Format entspricht (64 Hex-Zeichen),
werden beim Start gelöscht. Danach existiert der Klartext-Pfad nicht mehr.
```

<a id="touchlastused-gleitet"></a>
## `gleitet`

```text
── Die stille Erneuerung ─────────────────────────────────────────────────

Hier wird nicht nur vermerkt, DASS der Token benutzt wurde, sondern die
Frist gleich mit nach vorn geschoben. Genau das macht sie zur gleitenden:
Ein Telefon, das taeglich synchronisiert, laeuft nie ab; eines, das in
einer Schublade liegt, nach TOKEN_IDLE_DAYS.

Die App merkt davon nichts und muss nichts dafuer tun — kein zweiter
Endpunkt, kein Erneuerungstanz, keine Fassung der App, die das koennen
muss. Der Aufruf laeuft ohnehin schon bei jeder Anfrage (gedrosselt auf
alle fuenf Minuten, ohne await im Anfrageweg).

`sliding AND expires_at IS NOT NULL` im CASE: Der Sieben-Tage-Token des
Browsers darf nicht mitgleiten (siehe createToken), und eine Zeile ohne
Ablauf soll auch keinen bekommen, nur weil sie benutzt wird.
```

<a id="flaggegesetzt"></a>
## `flaggeGesetzt`

```text
Ist diese Datenbank-Flagge gesetzt?

── Warum es das braucht ────────────────────────────────────────────────────
`is_admin` kam in routes/auth.ts in DREI Schreibweisen vor —
`== 1 || === true`, `=== 1 || === true` und `!!wert` —, sechsmal insgesamt.
Alle drei bedeuten dasselbe; die Vielfalt entstand, weil die Spalte je nach
Alter der Installation INTEGER (0/1) oder BOOLEAN ist und jeder Autor sich
eigens dagegen gewappnet hat.

Gebraucht wird sie jetzt an einer siebten Stelle: Beim Rechtewechsel muss
der ALTE Wert mit dem neuen verglichen werden. Eine siebte Schreibweise
dafuer waere die Fortsetzung genau des Musters, das in dieser Reihe schon
mehrfach zu auseinanderlaufendem Verhalten gefuehrt hat.

`== 1` statt `=== 1`: Ein Treiber, der die Spalte als Zeichenkette liefert
('1'), soll nicht als „nicht gesetzt" gelten — das war der Grund fuer die
lose Gleichheit in der aeltesten der drei Fassungen, und er gilt weiter.
```

<a id="establishsession"></a>
## `establishSession`

```text
Session-ID erneuern und danach die Anmeldedaten hineinschreiben.

Ohne das behält der Browser die Session-ID, die er VOR dem Login hatte
(Session Fixation): Wer einem Opfer eine bekannte ID unterschieben kann —
über eine XSS-Lücke, ein geteiltes Gerät, einen manipulierten Link auf einer
Installation ohne HTTPS — ist nach dessen Anmeldung mit angemeldet.
express-session erneuert die ID nicht von selbst.

regenerate() legt eine neue, leere Session an; die Felder werden deshalb
danach gesetzt.

@param {any} req
@param {{userId:number, username:string, isAdmin:boolean}} data
```

<a id="passwort-min-zeichen"></a>
## `PASSWORT_MIN_ZEICHEN`

```text
Wie kurz ein Passwort hoechstens sein darf.

── Warum das eine Konstante ist ────────────────────────────────────────────
Sechs Routen setzen ein Passwort. VIER pruefen die Laenge, und zwar in zwei
Schreibweisen (`password.length < 8` und `String(password).length < 8`),
jede von Hand hingeschrieben:

  POST /register                    prueft
  POST /reset-password              prueft
  POST /users                       prueft
  PUT  /users/:id/password          prueft
  PUT  /profile                     PRUEFTE NICHT
  POST /change-password             PRUEFTE NICHT

Ausgefallen war sie also genau an den zwei Wegen, die einem BEREITS
ANGEMELDETEN Konto offenstehen — und damit war die Regel wirkungslos: Man
meldet sich mit acht Zeichen an und aendert danach auf eines.

Der Grund fuer die Luecke ist die fehlende Konstante. Wo eine Regel an jeder
Stelle neu getippt wird, gibt es keine Stelle, die man vergessen KOENNTE —
es gibt nur Stellen, an denen sie nie stand.
```

<a id="passwortzukurz"></a>
## `passwortZuKurz`

```text
Ist dieses Passwort zu kurz?

`String(...)` statt eines Typs: Der Rumpf einer Anfrage kann alles
enthalten, auch eine Zahl oder `null`. Zwei der vier alten Pruefungen
schrieben deshalb `String(password).length`, die anderen zwei nicht —
`(123456789).length` ist `undefined`, und `undefined < 8` ist FALSCH. Ein
Passwort als JSON-Zahl kam damit an der kuerzeren Fassung vorbei.

@param passwort  der Rohwert aus dem Anfragerumpf
```

<a id="isvalidloginidentifier"></a>
## `isValidLoginIdentifier`

```text
Darf das als ANMELDENAME durchgehen?

── Der gemeldete Fehler ────────────────────────────────────────────────────
Über dem Login-Feld steht "Benutzername oder E-Mail", die Abfrage sucht auch
in beiden Spalten (`LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)`)
— davor stand aber ein Wächter, der NUR das Benutzernamen-Muster zuliess.
Wer seine E-Mail eintippte, bekam "Benutzername darf nur Buchstaben, Zahlen
und _.- enthalten" und kam gar nicht bis zur Abfrage. Das @-Zeichen fällt
durch das Muster, und ein 3-Zeichen-Minimum passt zu Adressen ohnehin nicht.

Der Wächter selbst ist nicht überflüssig: Er hält Unsinn von der Abfrage und
vom Brute-Force-Zähler fern, der je Kombination aus IP und Anmeldename
zählt. Er muss nur BEIDE Formen kennen.

Nicht zu verwechseln mit USERNAME_RE: Wer sich registriert oder sein Profil
ändert, bekommt weiterhin nur das Benutzernamen-Muster — sonst könnte jemand
die E-Mail-Adresse eines anderen als Benutzernamen eintragen und dessen
Anmeldung an sich ziehen.
```

<a id="pruefeanmeldedaten"></a>
## `pruefeAnmeldedaten`

```text
Anmeldedaten prüfen — die einzige Stelle im Baum, an der das passiert.

── Warum das hier steht und nicht in den Routen ────────────────────────────
Dieselbe Abfolge stand zweimal: einmal im Sitzungs-Login (routes/auth.ts,
Webapp) und einmal im Token-Login (routes/api_v1/auth.ts, Android-App). Sie
ist SCHON EINMAL auseinandergelaufen — der Kommentar an der v1-Route hält
fest, dass dort die Konto-Vorbedingungen komplett fehlten und sich ein
deaktiviertes Konto über die App anmelden konnte.

Beim Nachmessen war sie ein ZWEITES Mal auseinandergelaufen, diesmal
unbemerkt: Der Sitzungs-Login vergleicht auch bei unbekanntem Namen gegen
einen Dummy-Hash, der Token-Login sprang bei `!user` sofort heraus. Der
Unterschied ist von aussen sauber messbar (eigene Messung, je 5 Versuche mit
verschiedenen Namen, damit die Sperre nicht dazwischenfunkt):

    /api/v1/auth/login   bekannt 418.5 ms · unbekannt   4.0 ms · Δ  414.6 ms
    /api/auth/login      bekannt 419.3 ms · unbekannt 436.8 ms · Δ  -17.5 ms

415 ms Unterschied heisst: Wer eine Namensliste durchprobiert, weiss danach,
welche Konten es gibt — ohne ein einziges Passwort zu erraten. Ein Login
mehr bedeutet also nicht nur doppelte Arbeit, sondern eine Lücke, die nur an
einer der beiden Stellen sichtbar ist.

── Reihenfolge, und warum sie so ist ───────────────────────────────────────
1. Form des Anmeldenamens — hält Unsinn von der Abfrage und vom
   Brute-Force-Zähler fern, der je IP und Anmeldename zählt.
2. Sperre abfragen — VOR der teuren Passwortprüfung.
3. Konto suchen und Passwort prüfen, immer mit bcrypt (s. o.).
4. Fehlversuch/Erfolg beim Zähler melden.
5. Konto-Vorbedingungen (assertLoginAllowed) NACH dem Passwort — sonst
   verrät die Antwort „Konto deaktiviert" die Existenz des Kontos an jeden,
   der nur den Namen kennt.
6. Zweiter Faktor, falls eingerichtet. Ein falscher Code zählt als
   Fehlversuch, sonst liessen sich die 10^6 Codes durchprobieren.

Was NICHT hierher gehört: Sitzung anlegen bzw. Token ausstellen. Genau das
unterscheidet die beiden Aufrufer, und es ist der einzige Unterschied.

@param req      Für den Brute-Force-Zähler (IP) gebraucht.
@param username Benutzername ODER E-Mail-Adresse.
@param password Klartext-Passwort aus dem Request.
@param code     Einmal- oder Wiederherstellungscode (src/konto/zweiterFaktor.ts).
```

<a id="abschnitt-2"></a>
## Abschnitt

```text
Warum es hier KEINE Liste mehr gibt: ?token= zaehlt nirgends.

Ein Token in der Adresszeile landet im Referer fremder Seiten, im
Browserverlauf, in Reverse-Proxy-Protokollen und in jedem Fehlerbericht, der
die URL mitschickt. Er verschwindet dort auch nicht wieder. Bis hierher war
es der SITZUNGSTOKEN, der das ganze Konto oeffnet — bei der App einer ohne
Ablauf.

An dieser Stelle stand deshalb eine kurze Ausnahmeliste mit der Begruendung,
<img src>, <iframe src>, window.open() und EventSource koennten keine
Kopfzeilen setzen. Das stimmt — nur hatte KEINER der drei Eintraege noch
einen Nutzer. Nachgezaehlt im Baum, alle drei Erzeuger von `?token=`:

  • public/js/01-core.js und public/js/02-gallery.js haengten ihn an den
    SSE-Strom des CSV-Imports. Beide oeffnen den Kanal mit
    `withCredentials: true`, und `webToken` entsteht ueberhaupt erst NACH
    einer erfolgreichen Anmeldung — die das Sitzungs-Cookie setzt. Einen
    Browser, der den Token hat und das Cookie nicht, gibt es nicht. Der
    Kommentar an der Aufrufstelle sagte das selbst: „Cookie-Session
    funktioniert ohnehin".
  • Die App haengte ihn an die Anleitung (SetDetailSections.kt). Die Datei
    holt aber der In-App-Betrachter ueber den geteilten OkHttp-Client, und
    dessen Interceptor setzt den Authorization-Kopf fuer JEDE Adresse
    unseres Servers (di/AppModule.kt). Der Token in der Adresse war doppelt
    gemoppelt — und wurde nebenbei als Text unter der Anleitung ANGEZEIGT
    und als Navigationsargument im Backstack abgelegt.
  • Der Polling-Rueckfall (/import/csv/status) und die Token-Verwaltung
    benutzen `fetch` und setzen den Kopf richtig. Der Bild-Proxy hatte gar
    keinen Aufrufer; imgUrl() liefert nackte Pfade, Bilder weisen sich im
    Browser ueber das Cookie aus.

Es blieb also eine Erlaubnis ohne Nutzen — und eine Erlaubnis ohne Nutzen
ist reine Angriffsflaeche. Sie ist ersatzlos weg; das ist strenger als
kurzlebige Ersatztoken und braucht keine zweite Tabelle.

Rueckwaerts vertraeglich: Wer eine aeltere App oder altes, zwischengespeichertes
Javascript benutzt, haengt den Token weiter an. Der Server sieht ihn nicht mehr
an — aber Kopfzeile bzw. Cookie tragen die Anfrage ohnehin, wie oben gezeigt.

Kommt je eine Stelle dazu, die WIRKLICH keine Kopfzeile setzen kann, gehoert
dorthin ein eigener, kurzlebiger Token — nicht der Sitzungstoken und nicht
wieder eine Ausnahme fuer diesen hier.
```

<a id="resolveuserid"></a>
## `resolveUserId`

```text
Ermittelt die userId aus Session oder Bearer-Token.

?token= wird NICHT mehr ausgewertet — auf jeder Route zählt ausschliesslich
der Authorization-Header (oder die Sitzung). Warum die Ausnahmeliste weg
ist, steht im Block darüber.

@param req Express-Request
@returns {Promise<number|null>} null wenn nicht authentifiziert
```

<a id="resolveuserid-2"></a>
## Abschnitt

```text
Vorher stand hier parseInt(user.user_id). Das war schon immer wirkungslos:
Die Spalte ist INTEGER, der Treiber liefert eine Zahl, und parseInt haette
sie erst in einen String verwandelt. Aufgefallen ist es erst, als der Typ
dastand.

Der ganze Nutzer wird abgelegt, nicht nur seine Kennung: Sonst wuesste ein
Handler hinter requireLoginOrToken zwar WER fragt, aber nicht, ob es ein
Verwalter ist — `req.session.isAdmin` ist bei einer Token-Anfrage immer
undefined. Das faellt nicht als Fehler auf, sondern liefert stillschweigend
die Ansicht eines Nicht-Verwalters (siehe istVerwalter). requireApiAdmin
legt dasselbe Feld ab; damit gibt es EINEN Ort, an dem es steht.
`is_admin` kommt je nach Treiber als 0/1 oder als Wahrheitswert; das Feld
auf Express.Request ist als Zahl deklariert. Hier einmal vereinheitlichen
ist richtiger, als jeden Leser beide Formen kennen zu lassen.
```

<a id="loginortokenguard"></a>
## `loginOrTokenGuard`

```text
Express-Middleware: Session ODER Bearer-Token, setzt req.tokenUserId.

@param opts.timeoutMs Antwortet nach dieser Zeit mit 503, statt zu warten.
       Für den Fortschrittskanal des CSV-Imports gedacht: Während eines
       Imports kann die Datenbank ausgelastet sein, und ein Client, der eine
       klare Absage bekommt, versucht es gleich wieder — besser als eine
       Verbindung, die minutenlang offen hängt. Ohne Angabe wird gewartet
       (unverändertes Verhalten aller übrigen Routen).
```

<a id="nutzerid"></a>
## `nutzerId`

```text
Wer fragt hier? — Sitzung ODER Bearer-Token, EINE Antwort.

── Warum es diesen Helfer gibt (Nachtrag 127) ──────────────────────────────

Dieselbe Frage stand an vier Stellen und in ZWEI Reihenfolgen:

    routes/settings.ts   req.session?.userId || req.tokenUserId
    routes/sets.ts       req.tokenUserId || Number(req.session.userId)

Der Unterschied ist nicht bloss Geschmack: Die eine Fassung wandelt in eine
Zahl, die andere nicht — und wer sie falsch herum abschreibt, bekommt bei
einer Anfrage MIT Sitzung UND Token einen anderen Nutzer als der Nachbarcode.

Und es gibt eine DRITTE Schreibweise: requireApiAdmin in
routes/api_v1/middleware.ts legt `req.apiUser` ab, nicht `req.tokenUserId`.
Dieser Helfer liest alle drei, damit ein Handler nicht wissen muss, welcher
Waechter vor ihm stand.

Reihenfolge: Die SITZUNG zuerst. Wer im Browser angemeldet ist und dabei
versehentlich einen fremden Token mitschickt, bleibt der, als der er sich
angemeldet hat.

@returns Die Nutzerkennung als Zahl, oder null wenn niemand angemeldet ist.
```

<a id="abschnitt-3"></a>
## Abschnitt

```text
Ist dieser Anfragende ein Verwalter? — Sitzung ODER Bearer-Token.

Das Gegenstueck zu [nutzerId] und aus demselben Anlass: `req.session.isAdmin`
stand an sechs Stellen in routes/settings.ts und ist bei einer Anfrage MIT
Token immer `undefined`. Die Folge waere nicht ein Fehler, sondern etwas
Schlimmeres: Die App bekaeme stillschweigend die Ansicht eines Nicht-
Verwalters — beim Sichern der Einstellungen etwa ohne die globalen Werte,
ohne dass irgendwo etwas schiefginge.

`apiUser.is_admin` ist eine 0/1-Zahl aus der Datenbank, `session.isAdmin` ein
Wahrheitswert. Beides wird hier auf einen Wahrheitswert gebracht, damit der
Aufrufer den Unterschied nicht kennen muss.
```

<a id="angemeldetenutzerid"></a>
## `angemeldeteNutzerId`

```text
Wie [nutzerId], aber fuer Handler, die HINTER einem Waechter stehen.

Dort ist die Kennung zugesichert, und `number | null` zwingt jeden Aufrufer
zu einer Behandlung des Falls, den es nicht gibt. Die naheliegende Antwort
waere ueberall `nutzerId(req)!` — genau die Antwort, die types/augmentations
.d.ts fuer `req.session.userId` schon einmal verworfen hat: Das Ausrufezeichen
beseitigt die Meldung UND die Pruefung; rutscht die Route eines Tages VOR den
Waechter, sagt niemand mehr etwas.

Hier wirft es stattdessen. Das ist laut, faellt im Test sofort auf und kann
nie stillschweigend mit `undefined` weiterrechnen.
```

<a id="nutzername"></a>
## `nutzerName`

```text
Wie heisst der Anfragende? — Sitzung ODER Bearer-Token.

Die dritte Eigenschaft nach [nutzerId] und [istVerwalter], und sie stand
genauso einseitig da: `req.session.username` in der Sicherung
(routes/settings.ts) ist bei einer Token-Anfrage `undefined`. Das faellt
nicht als Fehler auf — die exportierte Datei traegt dann `exported_by: null`,
und wer sie spaeter ansieht, weiss nicht mehr, von welchem Konto sie stammt.

`null`, wenn niemand angemeldet ist. Ein Anzeigename ist nichts, worauf eine
Berechtigung fussen darf — dafuer gibt es [nutzerId].
```

<a id="abschnitt-4"></a>
## Abschnitt

```text
Einen Bearer-Token ausstellen.

── Warum das hier steht ────────────────────────────────────────────────────
Dasselbe INSERT stand dreimal, mit drei verschiedenen Laengen und zwei
verschiedenen Laufzeiten: im Token-Login (32 Byte, ohne Ablauf), im
Sitzungs-Login (24 Byte, sieben Tage) und in /qr-login (32 Byte, ohne
Ablauf). Die Laenge war schlicht Zufall; die Laufzeit ist es NICHT — und
genau deshalb ist sie jetzt ein benannter Parameter statt einer Eigenheit
der Kopie, in der man gerade liest.

── Warum Browser und App verschiedene Laufzeiten bekommen ──────────────────
Der Token des Browsers liegt im sessionStorage und ist damit per XSS
auslesbar; er existiert nur, damit EventSource sich ausweisen kann (dort
lassen sich keine Kopfzeilen setzen). Sieben Tage sind dafür reichlich.
Der Token der App ist dagegen der einzige Ausweis des Geräts — wer die App
öffnet, soll nicht jedes Mal sein Passwort eintippen. Er bekommt kein
Ablaufdatum und verfällt stattdessen nach TOKEN_IDLE_DAYS ohne Nutzung
(siehe purgeExpiredTokens).

Die Datenbank speichert nur den SHA-256-Hash; der Aufrufer bekommt den
Klartext.

@param dauerhaft true = kein Ablaufdatum (App, QR-Anmeldung).
```

<a id="unbegrenzt"></a>
## `UNBEGRENZT`

```text
Der Wert, mit dem „unbegrenzt" in der Tageszahl steht.

Drei Zustaende muessen sich in EINEM Feld unterscheiden lassen, weil sie so
mit der Nonce reisen (qr_login_tokens.token_days):

  null  — nichts gewaehlt, es bleibt bei der Gleitfrist (der Bestand)
  0     — ausdruecklich unbegrenzt: keine Frist, gar keine
  > 0   — eine feste Frist, in Tagen

`0` und nicht `-1`: Eine Spalte, in der eine Tageszahl steht, soll keine
negativen Werte tragen. Und `null` ist bereits vergeben — es bedeutet
„keine Angabe", nicht „keine Grenze". Die beiden auseinanderzuhalten ist
der ganze Punkt: Das eine ist der Bestand, das andere eine Entscheidung.
```

<a id="token-laufzeiten"></a>
## `TOKEN_LAUFZEITEN`

```text
Die WAEHLBAREN festen Laufzeiten eines QR-Zugangs, in Tagen.

── Warum eine feste Liste und keine freie Tageszahl ────────────────────────
Der Wert kommt aus einer Anfrage. Eine freie Zahl hiesse, dass irgendwann
jemand 999999 schickt — und eine Frist, die laenger ist als das Geraet,
ist keine Frist. Die Liste steht hier und nicht in der Route, weil sie zur
FRIST gehoert, so wie TOKEN_IDLE_DAYS ein paar Zeilen weiter unten.

„Unbegrenzt" steht mit drin, auf Marcos ausdrueckliche Ansage. Es ist die
einzige Wahl, die etwas WEGNIMMT — die einzige selbsttaetige Reissleine fuer
ein verlorenes, verkauftes oder gestohlenes Geraet. Sie ist deshalb nicht
die Vorgabe: Wer nichts waehlt, bekommt weiterhin die Gleitfrist
(TOKEN_IDLE_DAYS). Entwerten laesst sich so ein Zugang nur noch von Hand,
ueber „Angemeldete Geraete" oder einen Passwortwechsel.
```

<a id="laufzeittage"></a>
## `laufzeitTage`

```text
Eine Laufzeit-Angabe aus einer Anfrage in Tage uebersetzen.

@returns Tage, oder null fuer „keine feste Frist" (nichts gewaehlt, oder
  etwas, das nicht in der Liste steht).

ausTabelle statt eines direkten Zugriffs: `TOKEN_LAUFZEITEN['constructor']`
lieferte die geerbte Object-Funktion — wahrheitswertig, und damit waere
`make_interval(days => [Function])` an die Datenbank gegangen. Dieselbe
Falle wie beim Anleitungs-Upload (routes/sets.ts).
```

<a id="createtoken"></a>
## Abschnitt

```text
Gleitende Frist statt gar keiner. Bis hierher stand hier NULL, und die
90 Tage aus TOKEN_IDLE_DAYS setzte allein der stuendliche Aufraeumjob
durch — per DELETE. Lief der Job nicht (kein Primary-Worker, Absturz,
ein Neustart zur falschen Stunde), galt der Token weiter, denn die
WHERE-Klausel in validateToken() laesst `expires_at IS NULL` immer
durch. Die Frist stand im Job, nicht im Anfrageweg.

Jetzt steht sie in der Zeile. `sliding` merkt sich, dass dieses Datum
bei jeder Benutzung nachrueckt (_touchLastUsed) — dieselbe Bedeutung
wie vorher („90 Tage ohne Nutzung"), nur an der Stelle durchgesetzt, an
der jede Anfrage ohnehin vorbeikommt.

TOKEN_IDLE_DAYS === 0 schaltet die Regel ab; dann bleibt es bei NULL,
wie es die Beschreibung der Variablen zusagt.

── Und daneben die FESTE Frist, falls eine gewaehlt wurde ─────────────

Sie steht in einer eigenen Spalte, weil sie etwas anderes bedeutet als
expires_at: „so lange ueberhaupt" statt „so lange ungenutzt". Gueltig
ist der Token, bis der FRUEHERE der beiden Termine erreicht ist —
validateToken() prueft beide. Die ausfuehrliche Begruendung steht in
db/migrations/0016-token-laufzeit.sql.

`make_interval(days => $N)` und nicht eine zusammengesetzte Zeichenkette:
Der Wert kommt am Ende aus einer Anfrage (ueber laufzeitTage(), also aus
einer festen Liste), und er gehoert trotzdem als Parameter uebergeben.

── „Unbegrenzt" ist ein eigener Zweig, kein Sonderfall der Rechnung ───

Hier faellt BEIDES weg: die gleitende Frist und die feste. `sliding`
steht auf FALSE, damit _touchLastUsed() der Zeile nicht doch noch ein
Datum verpasst, und `never_expires` sagt dem Aufraeumjob, dass diese
Zeile ohne Datum so gemeint ist — sonst zoege er sie beim naechsten
Lauf still auf die Gleitfrist (siehe Migration 0017).
```

<a id="abschnitt-5"></a>
## Abschnitt

```text
Alle Tokens eines Nutzers verwerfen.

Wird beim Passwortwechsel und beim Reset aufgerufen: Wer sein Passwort
ändert, tut das im Zweifel genau deshalb, weil ein Zugang kompromittiert
ist. Ein Bearer-Token mit sieben Tagen Restlaufzeit, das die Änderung
überlebt, macht den Wechsel wirkungslos.

Der In-Memory-Cache lässt sich nicht gezielt nach user_id leeren (er ist
nach Token-Klartext indiziert), deshalb wird er ganz verworfen — er baut
sich innerhalb weniger Requests wieder auf.

@param {number} userId
@returns {Promise<void>}
```

<a id="revokeallsessions"></a>
## `revokeAllSessions`

```text
Alle offenen BROWSER-SITZUNGEN eines Kontos beenden.

── Woher das kommt ─────────────────────────────────────────────────────────
Der Admin-Reset suchte die Sitzungen in einer Tabelle namens `session` und
sprang über den Schritt, wenn es sie nicht gibt. Sie gibt es nie: Der
Session-Store läuft auf `user_sessions` (server.ts, tableName). Der
to_regclass-Test lieferte also immer NULL, das DELETE lief nie — ein
Administrator konnte das Passwort eines übernommenen Kontos zurücksetzen,
und die offene Sitzung des Angreifers lief weiter. Nachgestellt mit echtem
Store: 1 Zeile in user_sessions, to_regclass('public.session') = NULL.

Der Reset-per-E-Mail-Pfad traf die richtige Tabelle, nutzte aber einen
anderen Ausdruck für dieselbe Frage. Beides steht jetzt hier, an einer
Stelle — wie revokeAllTokens für die Bearer-Tokens.

`sess::jsonb->>'userId'` statt `(sess -> 'userId')::text`: Beide treffen
eine Zahl, aber ->> liefert den blanken Wert, während ::text bei einem
STRING die Anführungszeichen mitbringt ('"42"' statt '42') und dann nicht
mehr passt. Der Store speichert derzeit eine Zahl; der robustere Ausdruck
kostet nichts.
```

<a id="token-idle-days"></a>
## `TOKEN_IDLE_DAYS`

```text
Tage ohne Nutzung, nach denen ein Token OHNE Ablaufdatum verfällt.
0 schaltet die Regel ab (dann gilt wieder: unbegrenzt).

── Warum es diese Regel gibt ───────────────────────────────────────────────
Die Tokens der Android-App und des QR-Logins werden bewusst ohne
Ablaufdatum angelegt: Wer die App öffnet, soll nicht ständig sein Passwort
eintippen müssen. Der Preis war, dass ein Token auf einem verlorenen oder
verkauften Telefon unbegrenzt weitergilt — und es gibt keinen Weg, ihn
loszuwerden, ausser das Passwort zu ändern (was seit Nachtrag 3 alle Tokens
verwirft).

„Ungenutzt" ist dabei das richtige Mass, nicht „alt": Ein Telefon, das
täglich synchronisiert, wird nie ausgesperrt, egal wie lange es das Konto
schon hat. Ausgesperrt wird nur, was ohnehin niemand mehr benutzt — und dort
ist eine erneute Anmeldung zumutbar.

last_used wird bei jeder Anfrage gepflegt (gedrosselt auf alle fünf Minuten,
siehe _touchLastUsed), taugt also genau dafür.
```

<a id="purgeexpiredtokens"></a>
## `purgeExpiredTokens`

```text
Tokens aufräumen: abgelaufene, und solche, die zu lange ungenutzt sind.

Ohne das wächst api_tokens monoton: Jeder Login legt eine webapp-session-Zeile
mit sieben Tagen Laufzeit an, und niemand hat sie je entfernt — auch nicht
nach Ablauf, weil validateToken() abgelaufene Zeilen nur ignoriert.
Wird beim Start und danach stündlich vom Primary-Worker aufgerufen.

Ein gelöschter Token wirkt spätestens nach TOKEN_TTL_MS (eine Minute), so
lange kann ihn ein Worker noch aus seinem Cache bedienen. Für eine
Aufräumregel nach Monaten ist das ohne Belang.

COALESCE(last_used, created_at): Zeilen aus der Zeit vor der last_used-Spalte
hätten dort NULL, und NULL < NOW() ist unbekannt — sie wären damit für immer
ausgenommen, also ausgerechnet die ältesten.

── Zur Rückgabe ────────────────────────────────────────────────────────────
Hier stand `r?.rowCount`. db.run() liefert aber `{ changes, lastID }` (siehe
db/database.ts) — die Zahl war deshalb IMMER 0, und die Meldung
„n abgelaufene Token entfernt" im Aufräumjob ist nie erschienen. Aufgeräumt
wurde trotzdem; man sah es nur nicht.

@returns {Promise<number>} Anzahl gelöschter Zeilen
```

<a id="purgeexpiredtokens-2"></a>
## Abschnitt

```text
── Altzeilen nachziehen, BEVOR geloescht wird ────────────────────────────

Auf einer gewachsenen Datenbank stehen App- und QR-Token noch ohne
Ablaufdatum. Ihre Frist lief bisher ueber COALESCE(last_used, created_at)
— genau diese Rechnung wird hier einmal in die Spalte geschrieben. Damit
gilt fuer sie ab sofort dieselbe Pruefung wie fuer neue Zeilen, ohne dass
sich an ihrer LAUFZEIT irgendetwas aendert.

Vor dem Loeschen, nicht danach: Sonst traegt dieser Lauf Daten ein, die
teils schon in der Vergangenheit liegen, und erst der naechste raeumt sie
weg — eine Stunde spaeter. Gueltig sind sie in der Zwischenzeit ohnehin
nicht mehr (validateToken prueft das Datum), aber die Tabelle soll nicht
eine Runde lang Zeilen tragen, die dieser Lauf haette entfernen koennen.

Steht in dieser Datei und nicht in db/database.ts: Die Frist heisst
TOKEN_IDLE_DAYS und wird hier gelesen. Ein zweiter Ort mit derselben
Rechnung waere die naechste Stelle, an der eine Regel still auseinander
laeuft.
```

<a id="purgeexpiredtokens-3"></a>
## Abschnitt

```text
Diese zweite Regel trifft seit der Umstellung oben kaum noch etwas: Nach
`AND NOT never_expires` in beiden Abfragen: Eine Zeile ohne Datum ist
entweder eine ALTZEILE (die soll nachgezogen und irgendwann geraeumt
werden) oder eine ausdrueckliche Wahl „unbegrenzt" (die soll genau das
bleiben). Ohne die Bedingung machte dieser Job die Wahl beim naechsten
Lauf still rueckgaengig — nichts waere gescheitert, und trotzdem waere
nichts wie versprochen.

dem Nachziehen hat jede Zeile ein Ablaufdatum. Sie bleibt trotzdem stehen
— fuer den Server, der eine Weile mit TOKEN_IDLE_DAYS=0 lief (dort
entstehen weiter Zeilen ohne Datum) und die Regel dann einschaltet. Der
Lauf davor zieht sie zwar schon nach; diese Zeile ist der Rueckhalt, falls
das UPDATE scheitert. Zwei billige DELETEs auf einer kleinen Tabelle sind
der Preis dafuer, dass kein Token durchrutscht.
```
