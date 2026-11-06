# Begründungen zu `test/settings-secrets-db.test.js`

Die ausführlichen Kommentare aus `test/settings-secrets-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
KEINE Leseroute der Einstellungen gibt ein Geheimnis im Klartext heraus.

── Woher dieser Test kommt ─────────────────────────────────────────────────
`GET /api/settings/` maskiert die API-Zugangsdaten seit Langem, und der
Kommentar über sanitizeGlobal() beschreibt genau, warum: Der Router trägt
nur requireLogin, LESEN darf also jedes angemeldete Konto — auch ein
Unterkonto ohne Adminrechte.

`GET /api/settings/raw` war eine zweite Fassung derselben Abfrage, nur
anders verpackt, und hatte die Maskierung nie bekommen: Sie spreizte
global_settings roh, samt bricklink_*_secret, brickset_api_key,
rebrickable_api_key und smtp_pass. Und ausgerechnet `/raw` ist die Route,
über die die Einstellungsseite lädt (public/js/05-settings.js) — die
Maskierung war damit für ihren eigentlichen Konsumenten wirkungslos.

── Warum der Test über ALLE Leserouten geht ────────────────────────────────
Eine Prüfung nur auf `/raw` hätte denselben Wert wie der bisherige Zustand:
Sie sichert die eine Stelle, die man gerade repariert hat. Die Regel lautet
aber „keine Leseroute dieser Datei gibt Geheimnisse heraus" — deshalb läuft
der Test über die Liste der Leserouten und wird rot, sobald eine neue
hinzukommt, die sie durchreicht.
```

<a id="ausgenommen"></a>
## `const AUSGENOMMEN = new Map([`

```text
Leserouten, die global_settings ausliefern — GESUCHT, nicht aufgezählt.

── Warum das gedreht wurde ─────────────────────────────────────────────────
Hier stand `['/api/settings/', '/api/settings/raw']`. Beim Zusammenlegen der
API-Oberflächen ist die erste weggefallen (sie lieferte dasselbe wie /raw,
nur anders verpackt, und hatte keinen Aufrufer) — übrig geblieben wäre
GENAU DER ZUSTAND, vor dem der Absatz oben warnt: eine Prüfung, die die eine
Stelle sichert, die man gerade repariert hat.

Jetzt kommen die Kandidaten aus routes/api_v1/settings.ts selbst: jede GET-Route.
Eine neue Leseroute ist damit von selbst mitgeprüft.

AUSGENOMMEN sind die Wege, die absichtlich etwas anderes tun — mit Grund.
Wer hier einträgt, muss sagen warum; wer keinen Grund hat, hat eine Route
gefunden, die Geheimnisse herausgibt.
```
