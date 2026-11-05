# Begründungen zu `routes/auth/benutzer.ts`

Die ausführlichen Kommentare aus `routes/auth/benutzer.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="put-users-id-admin"></a>
## Abschnitt

```text
── Warum die Sitzungen enden muessen ──────────────────────────────────

istVerwalter() (src/konto/auth.ts) fragt ZUERST `req.session.isAdmin`. Das
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
jetzt über die zentralen Helfer in src/konto/auth.ts, ohne Rückfall.
```
