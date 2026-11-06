# Begründungen zu `src/konto/http/anmeldung.ts`

Die ausführlichen Kommentare aus `src/konto/http/anmeldung.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="ipof"></a>
## `_ipOf`

```text
VORHER: der ERSTE Eintrag aus dem rohen X-Forwarded-For-Header, ungeprüft.
Der Header kommt vom CLIENT, nicht vom Proxy — jeder darf ihn mitschicken.
Ein Angreifer, der bei jedem Versuch einen anderen (frei erfundenen) Wert
sendet, bekommt bei jedem Versuch einen frischen Rate-Limit-Bucket; die
"5 Fehlversuche, dann 15 Min Sperre"-Regel griff dadurch nie.

server.ts setzt bereits `app.set('trust proxy', 1)` in Produktion — Express
wertet X-Forwarded-For damit selbst aus (genau ein Hop, der eigene
Reverse-Proxy) und legt das Ergebnis in req.ip ab. req.ip ist deshalb die
vertrauenswürdige Quelle; der Header-Zugriff bleibt nur als Fallback für
Kontexte ohne Express-Request (aktuell keine), falls req.ip einmal fehlt.
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
