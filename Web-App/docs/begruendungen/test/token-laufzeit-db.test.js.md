# Begründungen zu `test/token-laufzeit-db.test.js`

Die ausführlichen Kommentare aus `test/token-laufzeit-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die waehlbare Laufzeit eines QR-Zugangs — und wer sie waehlen darf.

── Marcos Wunsch ───────────────────────────────────────────────────────────
„Wie waere es, wenn man fuer die Tokens einstellen kann wie lange sie
gueltig sein sollen z.B. 1 Monat, 2 Monate, 6 Monate, 12 Monate. Pro QR-Code
soll das der User definieren koennen. Waere das ein Risiko aus Security
Sicht?"

── Die zwei Fristen ────────────────────────────────────────────────────────
api_tokens traegt jetzt zwei:

  expires_at       gleitend — „so lange UNGENUTZT" (TOKEN_IDLE_DAYS, 90 Tage).
                   _touchLastUsed() schiebt sie bei jeder Benutzung vor.
  hard_expires_at  fest — „so lange UEBERHAUPT", die Wahl des Nutzers.

Gueltig ist der Token bis zum FRUEHEREN der beiden Termine. Die feste Frist
kann also nur kuerzer machen, nie laenger — deshalb ist die Neuerung
sicherheitstechnisch ein Gewinn und kein Risiko.

── Der Punkt, an dem es ein Risiko WAERE ───────────────────────────────────
POST /qr-login ist unangemeldet erreichbar — es ist ja der Weg, auf dem ein
Geraet sich erstmals ausweist. Duerfte das einloesende Geraet seine Laufzeit
selbst in die Anfrage schreiben, koennte jeder, der einen QR-Code
abfotografiert oder ueber die Schulter scannt, sich die laengste aussuchen.
Die Wahl trifft deshalb die ANGEMELDETE Sitzung beim Erzeugen des Codes und
reist in qr_login_tokens.token_days mit.

Genau das prueft Teil 3 — mit einer Anfrage, die es versucht.

Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
Ohne DB: skip. Ausfuehren: REQUIRE_DB=1 npm test
```

<a id="ewig"></a>
## `const ewig = await ruf('/qr-token', { method: 'POST', headers: { cooki`

```text
── 3b. „Unbegrenzt" heisst wirklich unbegrenzt ───────────────────────

Und zwar dauerhaft: Die eigentliche Falle ist nicht das Anlegen, sondern
der stuendliche Aufraeumjob. Der zieht Zeilen OHNE Ablaufdatum
absichtlich auf die Gleitfrist nach und loescht sie nach 90 ungenutzten
Tagen — er wuerde die Wahl also still rueckgaengig machen, ohne dass
irgendetwas scheitert. Deshalb wird hier nicht nur die frische Zeile
geprueft, sondern purgeExpiredTokens() TATSAECHLICH ausgefuehrt, mit
einem Zugang, der seit einem Jahr unbenutzt daliegt.
```

<a id="serverliste"></a>
## `const serverListe = ohneKommentare(fs.readFileSync(path.join(ROOT, 'sr`

```text
── Und die Auswahl deckt sich mit der Liste des Servers ─────────────────

Die Werte stehen an zwei Stellen — in TOKEN_LAUFZEITEN und im Markup —,
und das laesst sich nicht sinnvoll vermeiden: Das Auswahlfeld wird
gebraucht, BEVOR die Seite den Server nach etwas fragt. Also wird die
Deckung hier gemessen statt behauptet. Eine Wahl, die der Server nicht
kennt, waere im Markup sichtbar und in der Wirkung nichts.
```
