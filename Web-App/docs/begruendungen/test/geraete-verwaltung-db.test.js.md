# Begründungen zu `test/geraete-verwaltung-db.test.js`

Die ausführlichen Kommentare aus `test/geraete-verwaltung-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Angemeldete Geräte: auflisten und aussperren — beide Wege, echte Datenbank.

── Warum es diese Datei gibt ───────────────────────────────────────────────
Die Endpunkte /api/v1/settings/tokens gab es lange, einen Weg dorthin nicht.
test/api-aufrufer.test.js führte sie als ausdrücklich unbequeme Ausnahme:
„Oberfläche FEHLT — die Route bleibt, damit sie gebaut werden kann, statt
sie zu löschen und die Lücke damit unsichtbar zu machen." Wer sein Telefon
verlor, kam an den Zugang nur über einen Passwortwechsel — und der sperrt
ALLE Geräte aus, nicht nur das eine.

Zwei Dinge mussten sich dafür ändern, und beide sind hier nachgemessen:

 1. Die Endpunkte waren SITZUNGSGEBUNDEN und damit für die App unerreichbar.
    Jetzt nehmen sie Sitzung ODER Bearer-Token, wie der Rest von /api/v1.
 2. Sie sagten nicht, WELCHE Zeile zum Fragenden gehört. Ohne das kann man
    sich mit dem eigenen Knopf aussperren, ohne es zu merken.

Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
Ohne DB: skip. Ausführen: REQUIRE_DB=1 npm test
```

<a id="for-stelle"></a>
## `for (const label of ['Pixel 8', 'webapp-session']) {`

```text
Und die Laufzeiten stehen richtig drin — daran hängt die Anzeige.

Beide Zeilen tragen jetzt ein Datum: Auch der App-Token hat seit der
Gleitfrist ein echtes Ablaufdatum (src/konto/auth.ts), es rueckt bei jeder
Benutzung nur nach. Fuer die Anzeige heisst das: Webapp und App zeigen
in der Spalte „Laeuft ab" ein Datum statt „nie" — und das ist genau die
Auskunft, die vorher fehlte. „nie" war ein Versprechen, das der
Aufraeumjob nach 90 Tagen gebrochen hat.
```

<a id="aufwaermen"></a>
## `const aufwaermen = await ruf(AUTH + '/me',`

```text
── 3. Ein fremdes Gerät aussperren ─────────────────────────────────────

Vorbedingung: Der Token des Tablets muss IM CACHE liegen, sonst prüft
der Test darunter nichts. validateToken() legt einen Token erst beim
ERSTEN Gebrauch ab — ein frisch ausgestellter, nie benutzter steht nicht
drin, und dann wäre die Prüfung „gilt nicht mehr" auch ohne
Cache-Leerung grün. Genau das ist beim Gegenprobieren herausgekommen.
```
