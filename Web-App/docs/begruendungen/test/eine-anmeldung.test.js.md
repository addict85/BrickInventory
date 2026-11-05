# Begründungen zu `test/eine-anmeldung.test.js`

Die ausführlichen Kommentare aus `test/eine-anmeldung.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
„Angemeldet" bedeutet an EINER Stelle etwas, nicht an fünf.

── Der Befund (Nachtrag 127) ───────────────────────────────────────────────

Die Android-App war von einundzwanzig Routen ausgesperrt — und zwar von genau
denen, deren Fehlen als „die App kann weniger als die Webapp" aufgefallen war:

    CSV-Import für Teile und Minifiguren     routes/parts.ts, routes/minifigs.ts
    Anleitungen hochladen und löschen        routes/sets.ts
    Sicherung exportieren und einspielen     routes/settings.ts
    Profil, Passwort ändern                  routes/auth.ts
    Nutzerverwaltung                         routes/auth.ts

Sechs vermeintlich fehlende Funktionen, EINE Ursache: `routes/auth.ts` hatte
ein eigenes `requireLogin`, das ausschliesslich die Sitzung kannte. Die App
hat keine Sitzung, sie weist sich mit einem Bearer-Token aus. Der Server
konnte alles davon längst — die App kam nur nicht daran.

Dazu stand die Frage „wer fragt hier?" in VIER Schreibweisen:

    req.session?.userId || req.tokenUserId                 settings.ts
    req.tokenUserId || Number(req.session.userId)          sets.ts
    req.session?.userId || tokenUser?.user_id              auth.ts
    req.apiUser.user_id                                    api_v1/*

Der Unterschied ist nicht bloss Geschmack: Zwei davon wandeln in eine Zahl,
zwei nicht, und bei einer Anfrage mit Sitzung UND Token liefern sie
verschiedene Nutzer.

── Was hier geprüft wird ───────────────────────────────────────────────────

GESUCHT, nicht aufgezählt: Jede `.ts` unter routes/ wird gelesen. Wer die
Sitzung direkt nach der Nutzerkennung fragt, steht in ERLAUBT — mit dem
Grund. Eine neue Route erbt die Regel damit von selbst.

Selbstbeweis über eine Mindestzahl: Fände der Durchlauf keine Dateien, wäre
die Liste leer und die Prüfung grün, ohne etwas gesehen zu haben.
```
