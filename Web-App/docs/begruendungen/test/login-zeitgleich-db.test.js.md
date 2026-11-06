# Begründungen zu `test/login-zeitgleich-db.test.js`

Die ausführlichen Kommentare aus `test/login-zeitgleich-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Ein Anmeldeversuch darf nicht verraten, ob es das Konto gibt.

── Der gemessene Befund ────────────────────────────────────────────────────
Die Anmeldeprüfung stand zweimal im Baum: einmal für die Sitzung der Webapp
(routes/auth.ts) und einmal für den Token der Android-App
(routes/api_v1/auth.ts). Nur die erste verglich auch bei UNBEKANNTEM Namen
gegen einen festen Dummy-Hash; die zweite sprang bei `!user` sofort heraus.

Nachgemessen über HTTP, je fünf Versuche mit jeweils verschiedenen Namen
(mit demselben Namen greift nach fünf Fehlversuchen die Sperre, und dann
misst man 429er statt Anmeldungen):

    /api/v1/auth/login   bekannt 418.5 ms · unbekannt   4.0 ms · Δ  414.6 ms
    /api/auth/login      bekannt 419.3 ms · unbekannt 436.8 ms · Δ  -17.5 ms

415 ms sind von aussen sauber messbar. Wer eine Namensliste durchprobiert,
weiss danach, welche Konten existieren — ohne ein einziges Passwort zu
erraten. Seither läuft beides über pruefeAnmeldedaten() in src/konto/auth.ts.

── Warum hier gemessen und nicht gelesen wird ──────────────────────────────
Der Unterschied war im Quelltext unauffällig: An der v1-Route stand sogar
„Parität zum Webapp-Login" — und der fehlende Vergleich war genau KEINE.
Ein Textvergleich hätte das nie gefunden; die Uhr findet es sofort.

Die Schranke ist bewusst grob (halbe Zeit statt „gleich"): Gemessen wird auf
einer geteilten Maschine, und der Fehlerfall ist nicht ein bisschen
schneller, sondern hundertmal — 4 ms gegen 400 ms. Eine engere Schranke
würde nur flattern, ohne mehr zu finden.
```

<a id="namen"></a>
## `const namen = [0, 1, 2].map(i => 'zeit_bekannt_${i}');`

```text
Die Kosten müssen denen echter Passwörter entsprechen — mit weniger Runden
wäre der BEKANNTE Fall der schnellere und der Vergleich stünde auf dem
Kopf. Deshalb BCRYPT_ROUNDS, derselbe Wert, mit dem der Dummy-Hash entsteht.
Drei Paare, abwechselnd gemessen, je mit eigenem Namen und eigener IP:
Eine Einzelmessung schwankte unter Last (Volllauf parallel) um mehr als
das Doppelte; der Median dreier Paare nicht, der Fehlerfall (4 ms gegen
400 ms) bleibt trotzdem eindeutig.
```
