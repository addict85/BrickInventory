# Begründungen zu `test/token-gleitfrist-db.test.js`

Die ausführlichen Kommentare aus `test/token-gleitfrist-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Gleitfrist des App-Tokens — echte Datenbank.

── Woher das kommt ─────────────────────────────────────────────────────────
Der Token der Android-App wurde OHNE Ablaufdatum angelegt. Verfallen ist er
trotzdem: TOKEN_IDLE_DAYS (90) hat ihn nach 90 Tagen ohne Nutzung entfernt —
aber per DELETE aus einem stuendlichen Aufraeumjob. Die Pruefung im
Anfrageweg sah ihn nie an, denn ihre Bedingung lautet
`expires_at IS NULL OR expires_at > NOW()`, und der erste Zweig traf immer
zu.

Damit hing die Frist an einem Hintergrundjob: kein Primary-Worker, ein
Absturz, ein Neustart zur falschen Stunde — und der Token auf einem
verlorenen Telefon galt weiter. Zusaetzlich behaupteten beide Oberflaechen
in der Zugangsliste „laeuft nie ab", was schlicht nicht stimmte.

Jetzt traegt die Zeile ein echtes Datum, das bei jeder Benutzung nachrueckt.
Dieselbe BEDEUTUNG wie vorher („90 Tage ohne Nutzung"), aber durchgesetzt
von der WHERE-Klausel, an der jede Anfrage ohnehin vorbeikommt.

Was hier nachgemessen wird — und warum jedes Stueck einzeln:
  1. Der App-Token bekommt Datum und `sliding`.
  2. Der Browser-Token bekommt ein Datum und gleitet NICHT. Ohne diese
     Haelfte wuerde eine Umstellung „alles gleitet" gruen durchgehen — und
     der im sessionStorage liegende Token liefe so lange, wie ein Angreifer
     ihn benutzt.
  3. Die Benutzung schiebt das Datum wirklich nach vorn (die stille
     Erneuerung).
  4. Altzeilen ohne Datum werden nachgezogen, ohne ihre Laufzeit zu aendern.

Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
Ohne DB: skip. Ausfuehren: REQUIRE_DB=1 npm test
```

<a id="stelle"></a>
## `await db.run('UPDATE api_tokens SET expires_at = NOW() + INTERVAL \'3 `

```text
── 3. Die stille Erneuerung ────────────────────────────────────────────

Das Datum wird kuenstlich nach vorn geholt, so als waere das Telefon
lange nicht benutzt worden. Dann EINE Anfrage mit dem Token — mehr tut
die App auch nicht.

Der Cache in src/konto/auth.ts wird vorher geleert: Er merkt sich pro Token,
wann zuletzt geschrieben wurde (gedrosselt auf fuenf Minuten). Ohne das
Leeren haette die Anmeldung von eben den Eintrag schon gefuellt und die
Drossel wuerde den Schreibvorgang ueberspringen — der Test pruefte dann
die Drossel statt der Erneuerung.
```

<a id="alt-stelle"></a>
## `const alt = 'a'.repeat(64);`

```text
── 4. Altzeilen nachziehen ─────────────────────────────────────────────

Eine Zeile, wie sie vor der Umstellung entstand: kein Datum, zuletzt vor
zehn Tagen benutzt. purgeExpiredTokens() muss ihr die Frist geben, die
die alte Regel ihr gegeben haette — also Rest = frist - 10 Tage. Wuerde
stattdessen ab JETZT gerechnet, bekaeme ein vergessenes Telefon durch
die Umstellung zehn Tage geschenkt.
```

<a id="stelle-2"></a>
## `await new Promise(r => srv.close(r));`

```text
Beides ABGEWARTET, und der Pool wird geschlossen: Ohne das laeuft die
Datei nicht zu Ende, sondern in das 60-Sekunden-Zeitlimit von
`npm test` — die Pruefungen darin sind laengst gruen, die Datei gilt
trotzdem als gescheitert. Genau so ist es beim Schreiben dieses Tests
passiert. Die api_tokens-Zeilen haengen per ON DELETE CASCADE am Konto
und gehen mit ihm.
```
