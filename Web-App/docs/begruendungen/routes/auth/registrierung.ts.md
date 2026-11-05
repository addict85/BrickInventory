# Begründungen zu `routes/auth/registrierung.ts`

Die ausführlichen Kommentare aus `routes/auth/registrierung.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

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

<a id="post-forgot-password"></a>
## `post-/forgot-password`

```text
── GET /api/v1/auth/verify ist ENTFERNT ────────────────────────────────────────

Sie hatte keinen Aufrufer, und das stand seit Nachtrag 154 als Kommentar
genau hier: „Gefahrlos umzustellen, weil die Route KEINEN Aufrufer hat: Der
Link in der Verifikationsmail zeigt auf /verify (src/mail/mailer.ts), das
Frontend ruft sie nicht auf und die Android-App auch nicht."

Damals wurde ihre Antwortform berichtigt und sie stehengelassen. Das ist
genau der Fall, den DeadCodeTest in der App beschreibt: Entweder fehlt die
Anzeige dazu — oder sie ist nie gebraucht worden und blieb liegen. Hier das
zweite: Die Bestaetigung laeuft ueber die Frontend-Seite /verify, die
utils/auth.verifiziereEmailToken() aufruft. Diese Funktion bleibt.
```
