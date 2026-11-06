# Begründungen zu `test/rechtewechsel-db.test.js`

Die ausführlichen Kommentare aus `test/rechtewechsel-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Rechteentzug und Kontoloeschung muessen die offene Sitzung erreichen.

── Woher das kommt ─────────────────────────────────────────────────────────
istVerwalter() (src/konto/auth.ts) fragt ZUERST `req.session.isAdmin`. Der Wert
steht seit dem Anmelden fest und wurde nie nachgefuehrt:

  PUT /users/:id/admin  schrieb nur `UPDATE users SET is_admin`.
  DELETE /users/:id     loeschte nur die Zeile.

Damit wirkte dieselbe Regel an den beiden Ausweisen VERSCHIEDEN:

  App / Bearer-Token   wirkte — validateToken() liest u.is_admin per JOIN
                       frisch; nur der Cache hielt bis zu 60s am alten Wert.
  Browser / Sitzung    wirkte NICHT — wer sein Fenster offen liess, blieb
                       Verwalter. Das Sitzungs-Cookie hat kein maxAge.

Und beim Loeschen: Die Bearer-Tokens gehen per ON DELETE CASCADE mit,
user_sessions hat aber keinen Fremdschluessel auf users — das geloeschte
Konto blieb angemeldet.

── Warum das hier gegen eine echte Datenbank laeuft ────────────────────────
Der Kern der Sache ist eine ZEILE in user_sessions, die verschwinden muss.
Ein quelltextlesender Test koennte nur pruefen, dass irgendwo
`revokeAllSessions` steht — und genau diese Funktion hat schon einmal in die
falsche Tabelle geschrieben (siehe ihren Kommentar in src/konto/auth.ts: sie
suchte `session` statt `user_sessions`, das DELETE lief nie, und die Pruefung
darauf blieb gruen). Hier wird deshalb nachgesehen, ob die Zeile weg ist.
```
