# Begründungen zu `public/js/05-zugaenge.js`

Die ausführlichen Kommentare aus `public/js/05-zugaenge.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="gueltigkeit"></a>
## `gueltigkeit`

```text
POST, nicht GET: Der Aufruf LEGT eine Nonce AN. Als GET war
er über eine Navigation von einer fremden Seite auslösbar, weil
SameSite=lax das Cookie dort mitschickt.
Die gewaehlte Laufzeit des SPAETEREN Geraete-Tokens reist mit der
Erzeugung, nicht mit dem Einloesen: POST /v1/auth/qr-login ist
unangemeldet erreichbar, und wer einen Code abfotografiert, duerfte sich
sonst selbst die laengste Frist aussuchen (Begruendung ausfuehrlich in
db/migrations/0016-token-laufzeit.sql).
```

<a id="serverurl"></a>
## `serverUrl`

```text
── Welche Adresse in den Code kommt ───────────────────────

Genau eine: die, die der Server nennt (`url`, aus APP_BASE_URL). Der
Klient hat hier NICHTS zu entscheiden.

Hier stand erst `window.location.origin`, dann `d.url || origin`. Beides
war falsch, und das zweite war das gefaehrlichere: Es sah nach einem
vernuenftigen Rueckfall aus. Aber die Adresse in der Browserzeile ist
die des BETRACHTERS, nicht die des Servers — wer die Webapp ueber
http://192.168.x.x:3000 oeffnet, haette dem Telefon eine Adresse
gereicht, die ausser Haus nicht existiert. Gescannt wird der Code
trotzdem; die App findet den Server dann nie wieder.

Ohne APP_BASE_URL kommt hier gar kein Erfolg mehr an: Die Route
antwortet mit 503 und einem Satz, der sagt, was zu tun ist — der wird
im Zweig darueber angezeigt. Nichts zu zeigen ist besser als etwas
Falsches zu zeigen, das sich anstandslos scannen laesst.
```

<a id="klartext"></a>
## `klartext`

```text
Wie lange der ZUGANG danach gilt — die Antwort des Servers, nicht die
Auswahl daneben: Kennt er den Wert nicht, hat er nichts vermerkt, und
dann gilt die Gleitfrist. Eigene Zeile, weil die darueber im
Sekundentakt neu geschrieben wird (der Zaehler des Codes).

Drei Faelle, nicht zwei: `0` heisst „unbegrenzt" und ist nicht dasselbe
wie „nichts gewaehlt" (null). Ein `d.token_days ? … : …` wuerde beide
in denselben Zweig werfen und bei „unbegrenzt" die Gleitfrist ansagen —
also genau das Gegenteil.
Ohne TLS verbindet sich die Android-App nicht (sie nimmt nur HTTPS an).
```

<a id="die-endpunkte-v1-settings-tokens-gab-es"></a>
## Die Endpunkte /v1/settings/tokens gab es schon, einen Weg dorthin nicht:

```text
── ANGEMELDETE GERÄTE ────────────────────────────────────────────────────

Die Endpunkte /v1/settings/tokens gab es schon, einen Weg dorthin nicht:
Ein verlorenes Telefon war nur loszuwerden, indem man das Passwort ändert
(das verwirft ALLE Zugänge). Wer nur eines aussperren wollte, sperrte alle
aus.

Der Browser selbst ist kein Token, sondern die Sitzung; die Liste zeigt die
Geräte mit Token (App, ältere Browser-Anmeldungen).
```

<a id="revokeothertokens"></a>
## `revokeOtherTokens`

```text
Alle Zugänge ausser dem eigenen entwerten.

Nacheinander über den bestehenden Endpunkt, statt dafür einen neuen zu
bauen: Es sind eine Handvoll Zeilen, und eine zweite Adresse für „dasselbe,
nur mehrfach" wäre genau die Art Doppelung, die dieses Projekt sonst
abbaut. Gezählt wird, was WIRKLICH weg ist — nicht, wie oft geklickt wurde.

Dieser Browser hängt an der Sitzung, nicht an einem Token — „alle anderen"
sind darum alle Token und alle übrigen Sitzungen.
```
