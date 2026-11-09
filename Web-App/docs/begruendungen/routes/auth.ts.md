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
pruefeAnmeldedaten in src/konto/auth.ts).

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
