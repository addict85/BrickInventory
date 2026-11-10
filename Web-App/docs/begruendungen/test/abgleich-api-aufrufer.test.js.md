# Begründungen zu `test/api-aufrufer.test.js`

Die ausführlichen Kommentare aus `test/api-aufrufer.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Zu jeder Route gehört jemand, der sie ruft — oder ein eingetragener Grund.

── Der Befund ──────────────────────────────────────────────────────────────
test/api-inventory.test.js ordnet jeden Endpunkt einer Kategorie zu und
prüft, dass die Zuordnung VOLLSTÄNDIG ist. Was es nie geprüft hat: ob sie
STIMMT. Die Kategorie `nur-v1` sagt wörtlich „wird von BEIDEN Clients
genutzt … oder ist Android-spezifisch". NACHGEMESSEN trifft das auf acht so
beschriftete Endpunkte nicht zu — sie werden von keinem der beiden Clients
gerufen. Eine Beschriftung, die niemand nachmisst, wird irgendwann falsch.

── Was das kostet ──────────────────────────────────────────────────────────
Eine Route ohne Aufrufer ist keine Kleinigkeit: Sie wird mitgewartet,
mitgetestet, mit umgebaut und bleibt angreifbar. Und sie täuscht — wer
`GET /api/sets/export/csv` las, hielt es für den Weg, auf dem die Webapp
exportiert. Der Weg ist `/api/settings/export/data` (ZIP); die drei
Einzelrouten standen seither ohne Aufrufer da und sind inzwischen entfernt.

── Was der Test NICHT tut ──────────────────────────────────────────────────
Er löscht nichts und verlangt auch nicht, dass gelöscht wird. Nicht jede
Route braucht einen Aufrufer im Quelltext: Ein Link aus einer E-Mail wird im
Browser geöffnet, ein Diagnosewerkzeug von Hand gerufen. Der Test verlangt
nur, dass jemand den Grund AUFGESCHRIEBEN hat — und meldet die sechzehnte
Route, die still dazukommt.

── Warum gesucht und nicht aufgezählt ──────────────────────────────────────
Routen aus den Router-Dateien, Aufrufe aus dem Browser-Code und den
Retrofit-Anmerkungen. Drei Schreibweisen desselben Pfades werden anerkannt:
`/api/sets` (fetch), `/sets` (der api()-Helfer setzt `/api` davor) und
`api/v1/sets` (Retrofit, ohne führenden Schrägstrich).
```

<a id="ohne-aufrufer"></a>
## `const OHNE_AUFRUFER = new Map([`

```text
── Fuenf Eintraege sind hier verschwunden, weil die Routen es sind ─────────

Und zwei davon trugen einen Grund, der GAR NICHT STIMMTE:

  GET /api/auth/verify    „Wird im Browser geöffnet … deshalb antwortet die
                           Route auch mit einer Seite und nicht mit JSON."
                           Sie antwortete mit JSON — seit Nachtrag 154
                           ausdrücklich, und der Link aus der Mail zeigt auf
                           die Frontend-Seite /verify, nicht hierher.
  GET /api/auth/check-token  „Gerufen von der Seite hinter dem Link."
                           Nachgemessen ueber alle 169 Dateien beider Apps:
                           von niemandem.

Eine Ausnahme mit erfundenem Grund ist schlimmer als keine Ausnahme — sie
sieht geprueft aus. Wer hier eine Zeile eintraegt, soll den Aufrufer
benennen koennen.
```

<a id="stelle"></a>
## `['GET /api/v1/admin/img-probe',`

```text
── Die beiden Token-Routen sind hier RAUS, und das ist der Punkt ────────
Sie standen als ausdrücklich unbequeme Ausnahme da: „Oberfläche FEHLT —
die Route bleibt, damit sie gebaut werden kann, statt sie zu löschen und
die Lücke damit unsichtbar zu machen." Genau so ist es gekommen; die
Oberfläche steht unter „Angemeldete Geräte" in den Einstellungen. Die
Prüfung hat den Eintrag selbst als veraltet gemeldet.
```
