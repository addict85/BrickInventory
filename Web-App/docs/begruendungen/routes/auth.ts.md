# Begründungen zu `routes/auth.ts`

Die ausführlichen Kommentare aus `routes/auth.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="requirelogin"></a>
## `requireLogin`

```text
── „Angemeldet" gibt es nur noch in EINER Fassung ──────────────────────────

Hier standen zwei eigene Waechter, die AUSSCHLIESSLICH die Sitzung kannten.
Die Android-App hat keine Sitzung — sie weist sich mit einem Bearer-Token
aus. Sie war damit von einundzwanzig Routen ausgesperrt, und zwar von genau
denen, deren Fehlen an der App aufgefallen war:

    CSV-Import fuer Teile und Minifiguren   routes/parts.ts, routes/minifigs.ts
    Anleitungen hochladen und loeschen      routes/sets.ts
    Sicherung exportieren/einspielen        routes/settings.ts
    Profil, Passwort aendern                hier
    Nutzerverwaltung                        hier

Sechs vermeintlich fehlende Funktionen, EINE Ursache: dieselbe Regel in zwei
Schreibweisen, und die App konnte nur die eine erfuellen. server.ts sagt an
der Stelle, wo diese Router eingehaengt werden, seit jeher voraus, was zu tun
ist: „Wer diese Routen auch fuer die App oeffnen will, stellt requireLogin
auf requireToken um — ein eigener Schritt." Das ist dieser Schritt.

Die Namen bleiben, damit die Aufrufer unveraendert bleiben; was sich aendert,
ist die BEDEUTUNG — und die ist jetzt dieselbe wie ueberall sonst im Baum.

Kein CSRF-Zuwachs: Der Schutz haengt am Cookie (SameSite=lax, server.ts).
Einen Authorization-Header schickt ein Browser NIE von selbst mit; ein
zusaetzlich akzeptierter Bearer-Token vergroessert die Angriffsflaeche
deshalb nicht.
```

<a id="post-login"></a>
## `post-/login`

```text
POST /api/v1/auth/login — die EINE Anmeldung, fuer Webapp und App.

── Warum es davon nur noch eine gibt ───────────────────────────────────────
Es gab zwei: diese hier (Sitzung, Cookie) und /api/v1/auth/login (Token).
Sie beantworten dieselbe Frage und unterschieden sich nur darin, WAS sie
zurueckgeben — und genau das hat sie zweimal auseinanderlaufen lassen (siehe
pruefeAnmeldedaten in utils/auth.ts).

Zusammenlegen geht, weil der Sitzungs-Login SCHON IMMER auch einen Token
ausgestellt hat: Die Webapp braucht ihn fuer EventSource, das keine
Kopfzeilen setzen kann. Beide Clients bekommen jetzt beides; der Browser
benutzt die Sitzung und legt den Token daneben, die App ignoriert das
Cookie und benutzt den Token.

Der einzige echte Unterschied ist die LAUFZEIT des Tokens, und die steht
jetzt ausdruecklich in der Anfrage (`never_expires`) statt implizit in der
Adresse. Begruendung siehe createToken().
```

<a id="post-logout"></a>
## `post-/logout`

```text
POST /api/v1/auth/logout — Sitzung beenden UND den Token entwerten.

Auch hiervon gab es zwei Fassungen: Die eine zerstoerte die Sitzung, die
andere loeschte den Token. Wer beides hat — und seit dem Zusammenlegen des
Logins hat das JEDER angemeldete Client —, musste beide aufrufen, um
wirklich abgemeldet zu sein.

Ohne Anmeldung erreichbar (kein requireToken davor): Abmelden ist nichts,
woran man scheitern koennen soll. Wer weder Sitzung noch Token schickt,
bekommt success — es gibt schlicht nichts zu tun.

Der Token muss im Authorization-Header stehen; sonst kann der Server nicht
wissen, welcher es war. Fehlt er, wird nur die Sitzung zerstoert. Er liegt
im sessionStorage des Browsers und ist damit per XSS auslesbar — ein Token,
der eine bewusste Abmeldung ueberlebt, ist genau das, was man dabei nicht
will.
```

<a id="get-me"></a>
## `get-/me`

```text
GET /api/v1/auth/me — wer bin ich? Sitzung ODER Token.

── Die eine Stelle, an der die beiden Fassungen wirklich verschieden waren ─
Die Sitzungs-Fassung antwortete `{loggedIn:false}` mit 200, die
Token-Fassung mit 401. Beides ist fuer sich richtig, und zwar aus
verschiedenen Gruenden:

 * Der Browser fragt das VOR jeder Anmeldung, ganz ohne Ausweis. Ein 401
   waere dort die normale Antwort auf eine normale Frage — die Webapp
   muesste ihn eigens ausnehmen (und tat das auch).
 * Die App fragt es MIT einem Token, den sie fuer gueltig haelt. Ein 200
   waere dort eine verpasste Gelegenheit: Ihr OkHttp-Interceptor macht aus
   jedem 401 „Sitzung abgelaufen" und fuehrt zurueck zur Anmeldung
   (RepoBasis.kt: `response.code() == 401 -> Fehlerart.SITZUNG_ABGELAUFEN`).

Die Regel, die beide Faelle richtig bedient, unterscheidet nicht nach
CLIENT, sondern nach dem, was tatsaechlich mitgeschickt wurde:

    kein Ausweis dabei        -> 200 { loggedIn: false }
    Ausweis dabei, ungueltig  -> 401

„Du hast mir nichts gegeben" ist eben etwas anderes als „was du mir gegeben
hast, gilt nicht".

`token_expires`/`token_last_used` stehen nur bei einer Token-Anmeldung drin.
```

<a id="put-profile-emailsent"></a>
## `emailSent`

```text
Send verification mail to new email

── Die Sprache des KONTOS, nicht die Vorgabe ───────────────────────

Marcos Frage vom 25.09.: „Werden alle E-Mails in der eingestellten
Sprache des Benutzers versendet?" Hier war die Antwort nein — der
Aufruf liess `lang` weg und fiel damit auf 'de' zurueck, waehrend
derselbe Versand bei der REGISTRIERUNG die Sprache laengst mitgibt.
Ein englischsprachiges Konto, das seine Adresse aendert, bekam eine
deutsche Mail.
```

<a id="put-users-id-admin-vorher"></a>
## `vorher`

```text
Den ALTEN Wert holen — daran haengt unten, ob Sitzungen enden muessen.

Die Existenzpruefung wandert damit vom UPDATE hierher. Das ist eine
Aufraeumung, keine Behebung: Hier stand zuerst als Begruendung, ein
wertgleiches UPDATE melde „je nach Treiber 0 Aenderungen". Nachgemessen
stimmt das fuer PostgreSQL NICHT — rowCount zaehlt BETROFFENE Zeilen,
nicht geaenderte, und die Gegenprobe zur alten Reihenfolge blieb prompt
gruen. Der einzige echte Grund fuer das vorgezogene SELECT ist, dass der
alte Wert gebraucht wird; dass die 404-Antwort dabei frueher faellt, ist
die Folge und nicht der Anlass.
```

<a id="put-users-id-admin"></a>
## Abschnitt

```text
── Warum die Sitzungen enden muessen ──────────────────────────────────

istVerwalter() (utils/auth.ts) fragt ZUERST `req.session.isAdmin`. Das
steht seit dem Anmelden fest und wird nie nachgefuehrt. Ein Entzug wirkte
damit auf den BROWSER gar nicht: Wer sein Fenster offen liess, blieb
Verwalter — das Sitzungs-Cookie hat kein maxAge, gilt also bis zum
Schliessen des Browsers.

Fuer die APP griff der Entzug, weil validateToken() `u.is_admin` per JOIN
frisch liest; nur der Cache hielt bis zu 60 Sekunden am alten Wert fest.
Also dieselbe Regel, die an zwei Ausweisen verschieden wirkte — und die
Haelfte, an der sie nicht wirkte, war die gefaehrlichere.

In BEIDE Richtungen und nicht nur beim Entzug: Eine fremde Sitzung laesst
sich nicht umschreiben, nur beenden. Wer Rechte BEKOMMT, saehe sie sonst
bis zur naechsten Anmeldung nicht — eine Vergabe, die aussieht, als haette
sie nicht gewirkt. Eine Regel ohne Fallunterscheidung.

Nur bei echter AENDERUNG: Sonst wuerde ein Verwalter, der sich selbst
erneut zum Verwalter macht, seine eigene Sitzung beenden.
```

<a id="put-users-id-password"></a>
## `put-/users/:id/password`

```text
PUT /api/v1/auth/users/:id/password — Passwort eines anderen Nutzers setzen.

Der Dialog in den Einstellungen rief diesen Endpunkt schon immer auf, es gab
ihn nur nicht: „API-Endpunkt nicht gefunden" beim Speichern.

Anders als /change-password wird KEIN aktuelles Passwort verlangt — ein
Administrator kennt es nicht. Genau deshalb ist die Route auf requireAdmin
beschränkt und schliesst das eigene Konto aus: Für sich selbst führt der Weg
über /change-password, wo das alte Passwort geprüft wird. Sonst genügte eine
übernommene Sitzung, um das eigene Passwort ohne Kenntnis des alten zu
ändern und den rechtmässigen Besitzer auszusperren.
```

<a id="put-users-id-password-2"></a>
## Abschnitt

```text
Offene Zugänge des Kontos beenden — ein zurückgesetztes Passwort soll
auch bestehende Sitzungen und Token schliessen.

Hier stand ein Test auf eine Tabelle `session`, die es nie gibt: Der
Store läuft auf `user_sessions` (server.ts, tableName). to_regclass
lieferte damit immer NULL und das DELETE lief NIE — ein Administrator
konnte das Passwort eines übernommenen Kontos zurücksetzen, und die
offene Sitzung des Angreifers blieb bestehen. Beide Schritte laufen
jetzt über die zentralen Helfer in utils/auth.ts, ohne Rückfall.
```

<a id="delete-users-id"></a>
## Abschnitt

```text
── Die Zeile ist weg, der Zugang war es nicht ─────────────────────────

Die Bearer-Tokens gehen per ON DELETE CASCADE mit (siehe db/schema.sql).
user_sessions dagegen ist der Tabellenraum des Session-Stores und hat
KEINEN Fremdschluessel auf users — die offene Sitzung des geloeschten
Kontos lief weiter, und war es ein Verwalter, blieb es einer.

Derselbe Aufruf steht schon beim Admin-Passwortreset, bei
/change-password und bei /reset-password. Er fehlte ausgerechnet dort,
wo das Konto ganz verschwindet.
```

<a id="post-change-password"></a>
## Abschnitt

```text
── Und die übrigen Browser-Sitzungen ─────────────────────────────────

Wer sein Passwort ändert, will in aller Regel einen fremden Zugang
loswerden. Die Tokens waren abgedeckt, die Sitzungen nicht: Ein
übernommenes Fenster blieb angemeldet, obwohl das Passwort neu ist.

revokeAllSessions trifft auch die eigene Zeile — deshalb danach eine
frische Sitzung mit neuer ID herstellen, sonst wäre man aus dem eigenen
Tab geflogen. Der Nebeneffekt ist erwünscht: neue ID nach einem
Passwortwechsel ist ohnehin die richtige Antwort auf Session Fixation.

NUR wenn es ueberhaupt eine Sitzung gibt: Kommt die Anfrage aus der App,
ist keine da, und `establishSession` legte eine an, die niemand je
benutzt — ein Eintrag im Sitzungsspeicher fuer einen Client, der gar
keine Cookies fuehrt.
```

<a id="getbaseurl"></a>
## `getBaseUrl`

```text
── Helper: get base URL from request ────────────────────────────────────────

VORHER: proto/host kamen ungeprüft aus X-Forwarded-Host bzw. Host. Diese
Funktion baut Links für Verifizierungs- und Passwort-Reset-Mails — ein
Angreifer, der bei POST /forgot-password einen fremden Host-Header mitgibt
(z.B. per curl direkt gegen den Node-Prozess, oder wenn der Reverse-Proxy
ihn durchreicht), bekommt eine ECHTE, vom Server verschickte Mail mit einem
Link, dessen Domain er kontrolliert. Klickt das Opfer, geht der Reset-Token
an den Angreifer. Ein Header darf für sicherheitsrelevante Ausgaben nie als
vertrauenswürdig gelten, egal was der Proxy normalerweise setzt.

Fix: APP_BASE_URL aus der Umgebung, wenn gesetzt — dann zählt NUR das.
Ohne die Variable fällt die Funktion auf den alten (unsicheren) Header-Pfad
zurück, damit bestehende Installationen ohne Konfiguration weiterlaufen;
ein einmaliger Log-Hinweis in Produktion macht auf die Lücke aufmerksam.
```

<a id="qr-ttl-ms"></a>
## `QR_TTL_MS`

```text
── QR-Login ──────────────────────────────────────────────────────────────────
VORHER: Der QR-Code enthielt den bcrypt-Hash des Nutzers (`h: password_hash`)
in einem base64-Payload, HMAC-signiert mit dem SESSION_SECRET. Der Kommentar
dort sagte „safe to include (can't reverse to plaintext)" — das stimmt fürs
Reversieren, nicht fürs Knacken: Wer den Code fotografiert, über die Schulter
scannt oder den Screenshot findet, hat den Hash offline und unbegrenzt zum
Durchprobieren, und derselbe Hash ist der Webapp-Login. Zusätzlich war der
Code 30 Minuten lang beliebig oft einlösbar.

JETZT: Der QR-Code enthält nur noch eine zufällige, einmalig einlösbare
Nonce. Sie steht (als SHA-256) in qr_login_tokens, läuft nach 5 Minuten ab
und wird beim Einlösen atomar entwertet. Kein Geheimnis im Code, keine
HMAC-Signatur nötig, keine Zweitverwendung des SESSION_SECRET.
```

<a id="post-qr-token"></a>
## `post-/qr-token`

```text
POST /api/v1/auth/qr-token — Nonce erzeugen (nur für die eigene Session)
── POST statt GET (Nachtrag 154) ────────────────────────────────────────────
Diese Route LEGT ETWAS AN: eine QR-Login-Nonce, die fünf Minuten lang ein
Konto öffnet. Als GET war sie die einzige zustandsändernde Route im Baum,
die an der Session hängt — und genau die Lücke, die SameSite=lax offen
lässt: Bei einer Navigation von einer fremden Seite (window.open, ein Link,
location=) schickt der Browser das Sitzungs-Cookie mit, und der Server legt
eine Nonce an.

Lesen konnte ein Angreifer die Antwort nicht — eine Navigation quer über
Ursprünge hinweg gibt ihm keinen Zugriff auf den Rumpf. Erzwingen konnte er
sie aber, und dasselbe tun Link-Vorschauen, Virenscanner und die
Vorab-Ladelogik der Browser: alles, was ein GET für gefahrlos hält, weil GET
gefahrlos sein SOLL.

Mit POST ist es unabhängig von jeder CSRF-Entscheidung erledigt: SameSite=lax
schickt bei einem fremden POST kein Cookie mit. Einziger Aufrufer war
public/js/05-settings.js — dort mitgeändert.
```

<a id="post-qr-token-basis"></a>
## `basis`

```text
── Ohne Adresse kein Code ──────────────────────────────────────

Marcos Frage vom 25.09.: „Kannst du das location.origin nicht komplett
entfernen?" — Ja, und dann muss der Server die Adresse liefern oder den
Code verweigern. Ein drittes gibt es nicht.

Verweigern und nicht raten: Der QR-Code ist der einzige Ort im Baum, an
dem eine falsche Adresse SPAETER auffaellt und nicht sofort. Er laesst
sich scannen, die App verbindet sich im WLAN — und findet den Server
unterwegs nie wieder. Ein Fehler, der im Wohnzimmer entsteht und sich im
Zug zeigt. Eine klare Absage mit Begruendung ist dagegen in dem Moment
sichtbar, in dem sie entsteht.

Und sie steht VOR jedem Datenbankzugriff: Weiter unten entstuende sonst
eine Nonce, die fuenf Minuten lang ein Konto oeffnet und die niemand je
einloest — ein Zugangscode auf Vorrat, fuer nichts.
```

<a id="post-qr-token-tage"></a>
## `tage`

```text
── Wie lange soll der ZUGANG gelten, den dieser Code eroeffnet? ──────

Marcos Wunsch, pro QR-Code waehlbar. Die Wahl wird HIER getroffen — von
der angemeldeten Sitzung — und wandert mit der Nonce in die Tabelle.
Nicht in POST /qr-login: Der ist unangemeldet erreichbar, und wer einen
Code abfotografiert, duerfte sich sonst selbst die laengste Laufzeit
aussuchen. Die ganze Ueberlegung steht in
db/migrations/0016-token-laufzeit.sql.

Ein unbekannter Wert wird nicht abgewiesen, sondern zu „keine feste
Frist" — dann gilt wie bisher allein die Gleitfrist. Ein aelterer
Client, der das Feld gar nicht kennt, verhaelt sich damit unveraendert.
```

<a id="post-qr-token-2"></a>
## Abschnitt

```text
`token_days`: was tatsaechlich gespeichert wurde, nicht was gewuenscht
war. Ein unbekannter Wert wird zu null, und die Oberflaeche soll die
Frist nennen koennen, die wirklich gilt.

Die LISTE der Auswahlmoeglichkeiten steht hier bewusst NICHT mit in der
Antwort: Sie wird gebraucht, BEVOR dieser Aufruf geschieht — das
Auswahlfeld steht ja neben dem Knopf. Ein zweiter Abruf beim Laden der
Seite nur dafuer waere Aufwand fuer nichts. Dass die vier Werte im
Markup zu TOKEN_LAUFZEITEN passen, haelt test/token-laufzeit-db.test.js
fest.
```

<a id="post-forgot-password"></a>
## `post-/forgot-password`

```text
── GET /api/v1/auth/verify ist ENTFERNT ────────────────────────────────────────

Sie hatte keinen Aufrufer, und das stand seit Nachtrag 154 als Kommentar
genau hier: „Gefahrlos umzustellen, weil die Route KEINEN Aufrufer hat: Der
Link in der Verifikationsmail zeigt auf /verify (utils/mailer.ts), das
Frontend ruft sie nicht auf und die Android-App auch nicht."

Damals wurde ihre Antwortform berichtigt und sie stehengelassen. Das ist
genau der Fall, den DeadCodeTest in der App beschreibt: Entweder fehlt die
Anzeige dazu — oder sie ist nie gebraucht worden und blieb liegen. Hier das
zweite: Die Bestaetigung laeuft ueber die Frontend-Seite /verify, die
utils/auth.verifiziereEmailToken() aufruft. Diese Funktion bleibt.
```

<a id="post-forgot-password-2"></a>
## Abschnitt

```text
NICHT awaiten: Die Antwort ist in beiden Fällen wortgleich, aber das
await machte sie messbar ungleich SCHNELL — bei unbekannter E-Mail kam
sie sofort, bei bekannter erst nach dem SMTP-Versand (bis zu ~10 s laut
den Timeouts in getTransporter). Damit liess sich trotz der neutralen
Meldung über die Antwortzeit prüfen, welche Adressen ein Konto haben.
Die Antwort hängt inhaltlich nicht vom Versandergebnis ab (sendMail
fängt Fehler selbst und loggt sie) — es gibt keinen Grund zu warten.

Die Sprache wird INNERHALB derselben nicht-erwarteten Kette geholt und
nicht davor. Ein `await getSetting(...)` an dieser Stelle waere genau
der Zeitunterschied, den der Absatz darueber vermeidet: Er entstuende
nur im Zweig „Konto existiert".
```
