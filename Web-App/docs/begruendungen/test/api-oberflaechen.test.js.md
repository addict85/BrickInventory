# Begründungen zu `test/api-oberflaechen.test.js`

Die ausführlichen Kommentare aus `test/api-oberflaechen.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
EINE Adresse, eine Umsetzung — und nur noch EINE Oberfläche.

── Der Befund, mit dem dieser Test entstand ────────────────────────────────
Es gab zwei API-Oberflächen: die Sitzungs-Routen der Webapp unter /api/… und
die Token-Routen der App unter /api/v1/…. Wo dieselbe Adresse auf BEIDEN
stand, existierte die Antwort zweimal — und zweimal heisst: Sie driften.
Genau das war passiert: GET /api/v1/settings baute seine Antwort selbst, las
nur user_settings und lieferte für globale Schlüssel eine fest verdrahtete
Vorgabe. Die Webapp zeigte 48, die App zeigte 24.

── Was sich geändert hat ───────────────────────────────────────────────────
Marcos Frage „wurde die api zusammengeführt, so dass nur noch ein Endpunkt
besteht?" war mit nein zu beantworten. NACHGEMESSEN vor dem Umbau: Von 47
alten Routen hatten nur DREI ein Gegenstück unter /api/v1 — die beiden
Oberflächen waren also kaum doppelt, sondern grossteils disjunkt.
„Zusammenführen" hiess deshalb UMZIEHEN.

Seither hängen sets, parts, settings und minifigs unter /api/v1/<bereich>;
es sind DIESELBEN Router-Objekte, nur an einer anderen Adresse.

── Was dieser Test jetzt festhält ──────────────────────────────────────────
 1. Jeder Router hängt unter /api/v1 — mit genau EINER eingetragenen
    Ausnahme: die Anmeldung. Sie ist der einzige Block mit einer echten
    Kollision (POST /auth/login, /auth/logout, GET /auth/me gibt es unter
    /api/v1 bereits, mit anderer Bedeutung: Bearer-Token statt Sitzung).
    Das zusammenzulegen heisst, zwei Anmeldeverfahren zu vereinen — daran
    hängt, ob man sich überhaupt noch anmelden kann. Eigener Schritt.
 2. Keine Adresse steht zweimal, ausser mit eingetragenem Grund.

── Warum gesucht und nicht aufgezählt ──────────────────────────────────────
Die Mountpunkte kommen aus server.ts, die Routen aus den Router-Dateien.
Ein neuer Router, eine neue Route, ein neuer Mountpunkt — alles ist von
selbst mitgeprüft. Eine Aufzählung wäre am Tag ihrer Entstehung korrekt und
danach nie wieder. Genau das ist zwei Nachbardateien passiert: Sie trugen
die Mountpunkte als Literal und wurden beim Umzug still falsch.
```

<a id="erlaubt"></a>
## `const ERLAUBT = new Map([]);`

```text
Adressen, die es ZWEIMAL geben darf — mit dem Grund.

Verglichen wird OHNE Präfix (`/auth/login` statt `/api/v1/auth/login`), weil
genau das die Frage ist: Beantworten zwei Umsetzungen dieselbe Adresse?

── Die Liste ist LEER, und das ist das Ergebnis ────────────────────────────
Hier standen zuletzt drei Zeilen: POST /auth/login, POST /auth/logout und
GET /auth/me. Der Grund daneben war jedes Mal derselbe — „verschiedene
Ausweise: Sitzung gegen Bearer-Token". Er war richtig und trotzdem kein
Grund für zwei Umsetzungen: Der Sitzungs-Login hat schon immer BEIDES
ausgestellt. Seit dem Zusammenlegen gibt es die drei Adressen je einmal.

Davor war `GET /settings` entfallen — eine Route ohne Aufrufer, die
dasselbe lieferte wie /settings/raw, nur in einer anderen Hülle.

Eine leere Liste heisst: JEDE Überschneidung wird gemeldet. Wer eine Zeile
hinzufügt, schreibt den Grund dazu; wer keinen hat, hat eine Doppelung
gefunden.
```

<a id="noch-nicht"></a>
## `const NOCH_NICHT = new Map([]);`

```text
── Marcos Frage ──────────────────────────────────────────────────────────
„Wurde die api zusammengefuehrt, so dass nur noch ein Endpunkt besteht?"

Diese Regel ist die Antwort in Form einer Pruefung. Sie zaehlt die
Ausnahmen NICHT auf — sie liest die Einhaengepunkte aus server.ts und
laesst genau eine zu, die hier begruendet steht.
Die Liste ist LEER. Hier stand /api/auth mit der Begruendung, die
Anmeldung ziehe zuletzt um — sie ist umgezogen: routes/auth.ts haengt
unter /api/v1/auth, und die drei Adressen, die es auf beiden Seiten gab,
sind zusammengelegt. Eine leere Liste heisst: JEDER Router muss unter
/api/v1 haengen, ohne Ausnahme.
```

<a id="auch-die-direkt-angemeldeten-routen-steh"></a>
## `test('auch die direkt angemeldeten Routen stehen unter /api/v1', () =>`

```text
Auch die Routen, die DIREKT in server.ts stehen.

── Warum das eine eigene Pruefung ist ──────────────────────────────────────
Die Regel darueber liest `app.use(...)` — also Router. Drei Adressen standen
aber als `app.get(...)` direkt in server.ts und wurden von ihr nie
angesehen. Auf die Frage „ist jetzt alles unter /api/v1?" haette sie
deshalb „ja" geantwortet, obwohl es drei Ausnahmen gab. Eine Regel, die
einen ganzen Bauplatz auslaesst, beantwortet die Frage nicht, die sie
beantworten soll.

── Die Ausnahmeliste ist LEER, und das ist das Ergebnis ────────────────────
Hier standen kurzzeitig drei begruendete Ausnahmen. Sie sind alle drei
erledigt:
  • GET /api/debug/test ist ERSATZLOS WEG. Ein Diagnosegriff, der echte
    BrickLink-Aufrufe feuert, in der Produktion mit 404 antwortet und den
    niemand ruft, ist kein Endpunkt, sondern eine Altlast.
  • GET /api/health und GET /api/startup-status heissen jetzt
    /api/v1/health und /api/v1/startup-status. Sie stehen weiterhin DIREKT
    in server.ts — sie muessen antworten, waehrend Schema und Migrationen
    laufen und der /api/v1-Router noch nicht eingehaengt ist. Das ist ein
    Grund fuer den ORT, nicht fuer eine zweite Adressform.

── Und die Pruefung sah nur server.ts (Nachtrag 161) ──────────────────────
Auf Marcos Frage „laeuft jetzt alles unter v1?" antwortete sie „ja" — und
uebersah dabei GET /api/img-proxy. Der Grund: Die Route wird nicht in
server.ts angemeldet, sondern in routes/imgProxy.ts, per
`registerImgProxy(app)`. Wieder eine Sache in zwei Schreibweisen und eine
Suche, die nur eine kennt — diesmal in der Pruefung selbst. Gesucht wird
jetzt im ganzen Serverbaum.
```

<a id="quellen"></a>
## `const quellen = dateien.map(d => ohneKommentare(fs.readFileSync(d, 'ut`

```text
── Auch Anmeldungen ueber eine KONSTANTE ────────────────────────────────

`app.get('/api/…')` war einmal die einzige Form. Seit der Bild-Proxy seine
Adresse aus src/katalog/bilder/images.ts bezieht (`app.get(IMG_PROXY_PFAD, …)`), findet
ein Muster, das nur Zeichenketten kennt, sie nicht mehr — und die Zahl
faellt von drei auf zwei, ohne dass eine Route verschwunden waere. Genau
dieselbe Blindheit, gegen die dieser Test geschrieben wurde, eine Ebene
tiefer. Bezeichner werden deshalb aufgeloest.
```

<a id="der-gesundheitscheck-aus-compose-yaml-ze"></a>
## `test('der Gesundheitscheck aus compose.yaml zeigt auf eine echte Adres`

```text
Der Gesundheitscheck aus compose.yaml zeigt auf eine Adresse, die es gibt.

── Warum das nachgemessen wird ─────────────────────────────────────────────
Der healthcheck steht in compose.yaml als Zeichenkette in einem
node -e-Aufruf. Beim Umzug nach /api/v1 haette man ihn uebersehen koennen,
und das faellt nicht auf: Docker meldet den Container dann als „unhealthy",
die Anwendung selbst laeuft weiter. Ein Neustart-Kreislauf oder ein
Rollout, der nie „bereit" meldet, ist der Preis.
```
