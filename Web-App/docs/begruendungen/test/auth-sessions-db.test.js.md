# Begründungen zu `test/auth-sessions-db.test.js`

Die ausführlichen Kommentare aus `test/auth-sessions-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Passwortwechsel gegen echte Datenbank und echten Session-Store.

── Warum es diese Datei gibt ───────────────────────────────────────────────
Die Regel „ein Passwortwechsel beendet alle offenen Zugänge" war bisher NUR
über Quelltext-Prüfungen abgesichert (auth-parity.test.js). Genau diese Sorte
Test hatte die Lücke davor FESTGESCHRIEBEN statt gefunden: Er verlangte
ausdrücklich einen Test auf `to_regclass('public.session')` — eine Tabelle,
die es nie gab, weil der Store auf `user_sessions` läuft. Der Ausdruck stand
im Code, der Test war grün, und das DELETE lief nie. Ein Administrator konnte
das Passwort eines übernommenen Kontos zurücksetzen, während die Sitzung des
Angreifers weiterlief.

Eine Quelltext-Prüfung kann das nicht merken — sie sieht Zeichen, kein
Verhalten. Deshalb hier: echter connect-pg-simple-Store, echte Routen, echte
Cookies. Die statischen Prüfungen bleiben daneben bestehen; sie erklären die
Regel und fangen ein versehentliches Löschen des Aufrufs. Aber ob sie WIRKT,
beantwortet nur diese Datei.

Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
Ohne DB: skip.
```
