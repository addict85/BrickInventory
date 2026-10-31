# Begründungen zu `routes/sets.ts`

Die ausführlichen Kommentare aus `routes/sets.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
── Erfassungs-Routen leben jetzt NUR NOCH in routes/api_v1/acquisitions.ts ──

Marcos Vorgabe (Nachtrag 70): „Können die beiden Apps nicht die gleichen APIs
nutzen (mit unterschiedlichen Authentifizierungsarten), damit die Logik nur
einmal implementiert werden muss und das Verhalten immer gleich ist?"

Genau das ist hier umgesetzt. Die drei Routen (GET/PUT/DELETE) standen
doppelt: einmal hier für die Sitzung der Webapp, einmal in der v1-Fabrik für
den Token der App. Aus dieser Doppelung stammen nachweislich sechs der
letzten Fehlermeldungen — Kaufpreis, Menge, Löschen, Erfassungen im Haushalt,
Preisauffüllung, und zuletzt zwei verschiedene Marktpreise für denselben
Vorgang (18.90 gegen 12.55).

Möglich wurde der Schnitt, weil requireToken in routes/api_v1/middleware.ts
BEIDE Ausweise akzeptiert: Sitzungs-Cookie ODER Bearer-Token. Es brauchte
also keine neue Schicht, nur das Entfernen der Zweitfassung. Die Webapp ruft
jetzt /api/v1/... — dieselbe Adresse wie die App.
```

<a id="router"></a>
## `router`

```text
── Zusammengelegt mit der v1-Fabrik (Nachtrag 74, letzte Etappe) ───────────

Sieben Routen standen hier doppelt — Liste, Detail, Anlegen, Ändern,
Löschen, Eigentümerwechsel und Haushaltsmitglieder. Sie sind entfernt; beide
Clients rufen /api/v1/sets/…, weil requireToken BEIDE Ausweise akzeptiert.

Vor dem Entfernen alle Paare gemessen (Antwort UND vollständiger
Datenbankzustand, lesend wie schreibend): identisch. Einziger Unterschied:
Die Liste nennt zusätzlich `count` — ein Feld MEHR, keines fehlt.

HIER GEBLIEBEN, und zwar mit Absicht:
  • add-stream, import/csv samt Status/Abbruch/Strom — diese Wege schicken
    laufend Fortschritt (SSE) statt einer einzelnen Antwort und hängen an der
    Oberfläche der Webapp
  • instructions (Anlegen, Hochladen, Löschen) und /:setNumber/parts —
    Datei-Uploads, die es nur hier gibt
  • info/:setNumber, export/csv, export/rebrickable — je nur an einem Ort
Alles davon existiert NUR einmal und kann daher nicht auseinanderlaufen.
```

<a id="abschnitt-2"></a>
## Abschnitt

```text
── Fortschritt eines Imports: Zustand und Signal ───────────────────────────

Der Import-Worker läuft im selben Prozess und meldet bei jedem Fortschritt
einen Stand je Konto. Der SSE-Endpunkt (/import/csv/stream) weiter unten
hört darauf und schiebt ihn an die verbundenen Clients (Webapp + Android),
ganz ohne Polling; der /status-Endpunkt bleibt als Rückfall.

Der Datensatz, seine Form nach aussen und der Bus stehen seit dem 20.10. in
src/auftraege/importAuftrag.ts — DIESELBE Stelle benutzt jetzt auch der
Wanted-Listen-Import, damit er in denselben Balken läuft (Marcos Wunsch:
„analog den Set-Importen"). Hier bleibt die HTTP-Oberfläche.
```

<a id="ssecounts"></a>
## `_sseCounts`

```text
Offene SSE-Verbindungen je Nutzer, für die Obergrenze weiter unten.

Der Stream bleibt dauerhaft offen — auch wenn gar kein Import läuft. Ohne
Obergrenze belegt ein Client mit fehlerhafter Reconnect-Schleife (oder ein
Nutzer mit zwanzig Tabs) beliebig viele Sockets und Timer im Worker, und
jede Verbindung hängt zusätzlich am NOTIFY-Kanal. Sechs ist grosszügig für
den realistischen Fall: ein paar Browser-Tabs plus die Android-App.
```

<a id="abschnitt-3"></a>
## Abschnitt

```text
── GET /api/sets/import/csv/status — poll import progress (session OR bearer) ─
── Zugang zum Fortschrittskanal des CSV-Imports ────────────────────────────

Hier stand eine EIGENE Fassung von requireLoginOrToken, die ?token=
bedingungslos akzeptierte. Der Bedarf ist echt — EventSource kann keine
Kopfzeilen setzen —, die zweite Fassung war es nicht: src/konto/auth.ts pflegt
eine Liste der Pfade, auf denen ein Token in der URL reiten darf, und
schreibt dazu „alles andere verlangt einen Authorization-Header". Genau das
stimmte wegen dieser Datei nicht, ohne dass man es dort sieht.

Jetzt stehen /import/csv/stream und /status in TOKEN_QUERY_ALLOWED, und die
Prüfung kommt von der zentralen Stelle. Das 3s-Zeitlimit bleibt: Während
eines Imports kann die Datenbank ausgelastet sein, und ein Client, der 503
bekommt, versucht es gleich wieder — besser als eine hängende Verbindung.
```

<a id="onprogress"></a>
## `onProgress`

```text
REIHENFOLGE: Erst alles anmelden, DANN den ersten Stand schicken.

Vorher stand `send(initial)` hier oben — vor onProgress, onNotify und den
beiden Zeitgebern. Meldet der Client beim allerersten Schreiben Gegendruck
(Handy im Funkloch, halb tote Verbindung), ruft send() sofort cleanup()
auf. Das greift auf `onProgress` zu, das als const erst weiter unten
entsteht — und die Anfrage endete mit
„ReferenceError: Cannot access 'onProgress' before initialization",
also mit einem 500er statt mit einem sauber geschlossenen Strom. Im
Protokoll standen beide Zeilen direkt hintereinander: erst der
Gegendruck-Hinweis, dann der Fehler.
```

<a id="get-import-csv-stream-fallbacktimer"></a>
## `fallbackTimer`

```text
3) DB-Fallback alle 10s — fängt verpasste Events ab und dient gleichzeitig
   als Erkennung wenn ein Import über einen anderen Prozess/Node gestartet
   wurde (kein EventEmitter-Event verfügbar).
Der Takt ist von 10 s auf 120 s gestreckt.

Er war der EINZIGE Weg, wie ein Client Fortschritt aus einem anderen
Worker erfuhr — deshalb so eng. Diese Aufgabe hat jetzt LISTEN/NOTIFY
(2b). Übrig bleibt die Rolle als Netz für den einen Fall, den NOTIFY nicht
abdeckt: ein Signal, das während einer Verbindungstrennung zur Datenbank
gesendet wurde, ist verloren. Zwei Minuten reichen dafür völlig.

Rechnung: Bei drei offenen Verbindungen (zwei Tabs + Android) waren das
vorher rund 26'000 Abfragen pro Tag, dauerhaft, auch wenn nie ein Import
läuft. Jetzt sind es gut 2'000.
```

<a id="get-info-setnumber"></a>
## Abschnitt

```text
── Hier stand ein Rueckfall auf die eigene sets-Zeile ─────────────────

„Not in catalog yet — try the user's own sets table as fallback": Die
Stammdaten standen an beiden Orten, und der zweite konnte etwas wissen,
was dem ersten fehlte.

Mit Migration 0033 gibt es nur noch den Katalog, und sie traegt fuer
JEDE Setnummer aus `sets` eine Zeile nach (Schritt 1) und prueft das
danach (Schritt 2). Ein Set, das jemand haelt, ist hier also immer
gefunden. Bleibt die Abfrage leer, kennt diese Installation die Nummer
wirklich nicht — dann ist die Nummer selbst die beste Antwort.
Unknown set — return the number itself as name
```

<a id="abschnitt-4"></a>
## Abschnitt

```text
Verschiebt ein Set samt seinen Kaufpreis-Erfassungen.

── Verschieben heisst oft VERSCHMELZEN ─────────────────────────────────────
Besitzt das Zielkonto dasselbe Set schon, gibt es dort keine zweite Zeile —
`sets` ist je Konto und Setnummer eindeutig. Mengen werden addiert, und die
Erfassungen wandern EINZELN über recordAcquisitionForDay(): Treffen dabei
zwei Erfassungen desselben Tages aufeinander, fasst der Helfer sie
mengengewichtet zusammen — nach genau derselben Regel, die auch beim
Erfassen gilt („pro Tag, Element und Benutzer genau ein Kaufpreis"). Ein
direktes UPDATE der user_id würde stattdessen zwei Zeilen desselben Tages
hinterlassen, also einen Zustand herstellen, den der Bearbeiten-Pfad ablehnt.

── Rechte ──────────────────────────────────────────────────────────────────
Beide Seiten müssen im Schreibbereich des Anfragenden liegen: Man kann nur
verschieben, was einem (oder einem eigenen Unterkonto) gehört, und nur
dorthin, wo man schreiben darf. Das schliesst den Weg vom Unterkonto ins
Nachbarkonto aus.

Anleitungen bleiben, wo sie sind: Sie hängen an Datei und Konto, nicht am
Exemplar. Bilder ohnehin — die liegen nutzerunabhängig nach Setnummer.
```

<a id="post-add-stream"></a>
## Abschnitt

```text
`success: true` gehoert dazu und ist nicht Zierde.

addSet() gibt {action, set_number, name} zurueck — ohne `success`. Die
Token-Route (routes/api_v1/sets.ts) wickelt dasselbe Ergebnis in
`{ success:true, ...result }`, und der Zweig fuenf Zeilen weiter oben
(„schon im Blickfeld") tut es hier ebenfalls. Nur dieser eine Ausgang tat
es nicht: DIESELBE Route antwortete also in zwei Formen, je nachdem ob
das Set neu war.

Der Webapp fiel das nie auf, weil handleSseEvent() nur `action` und
`set_number` liest. Der Android-App schon: Sie liest die Antwort in eine
Klasse mit einem PFLICHTfeld `success` und brach beim Anlegen jedes
neuen Sets mit „Field 'success' is required" ab — das Set war da, die
Meldung sagte das Gegenteil.
```

<a id="post-import-csv"></a>
## `post-/import/csv`

```text
── CSV Import — polling approach (avoids SSE connection issues) ──────────────
Der Job-Zustand steht in PostgreSQL, damit alle Arbeitsprozesse ihn lesen.

Die Tabelle csv_import_jobs wird NICHT hier angelegt, sondern beim Start in
db/database.ts (Etappe „frueherZurLaufzeitAngelegt"). Hier stand bis zuletzt
ein zweites CREATE TABLE IF NOT EXISTS mit demselben Wortlaut, aufgerufen vor
jedem Import und jedem Abbruch.

Der zentrale Kommentar dort sagt seit der Umstellung: „DDL im Request-Pfad ist
aus zwei Gründen unschön: Sie kostet bei jeder Anfrage einen Katalog-Zugriff,
und sie verteilt das Schema über die Codebasis, sodass niemand mehr an einer
Stelle sehen kann, wie die Datenbank aussieht. Beide gehören hierher." Die
Kopie hier blieb trotzdem stehen — die Aussage stimmte also nicht.

Dass es gutging, lag daran, dass beide Fassungen zeichengleich waren. Das ist
kein Zustand, auf den man sich verlässt: Wer die zentrale Fassung um eine
Spalte erweitert, bekommt bei einer NEUINSTALLATION je nach Reihenfolge die
alte Tabelle — und CREATE TABLE IF NOT EXISTS meldet das nicht, es tut
einfach nichts.

Entfernen ist sicher, weil server.ts app.listen() erst im then() von
initSchemaOnce() aufruft: Wenn die erste Anfrage ankommt, steht das Schema.
```

<a id="instr-ext-by-mime"></a>
## `INSTR_EXT_BY_MIME`

```text
Erlaubte Endungen strikt aus dem MIME-Typ ableiten, NIE aus file.originalname.

VORHER kam die Endung per path.extname(file.originalname) — also frei vom
Client wählbar. fileFilter prüfte zwar den mimetype, liess das Ergebnis
aber links liegen: Content-Type "image/png" + Dateiname "x.html" wurde
klaglos als "..._<ts>.html" gespeichert. GET /data/uploads/... liefert die
Datei über res.sendFile(), das den Content-Type-Header aus GENAU dieser
Endung ableitet — die Datei kam also als text/html vom eigenen Origin
zurück und hätte darin enthaltenes <script> ausgeführt (die serverweite
CSP schützt hier nicht, weil sie den eigenen Origin als script-src erlaubt).

Die Zuordnung unten ist bewusst eine feste Allowlist: Es gibt nur drei
erlaubte Ausgänge, jede andere Kombination wird abgelehnt statt geraten.
```

<a id="delete-setnumber-instructions-instrid"></a>
## Abschnitt

```text
Die DATEI erst löschen, wenn keine andere Zeile mehr darauf zeigt.

Beim Verschieben eines Sets wird die Anleitungs-Zeile KOPIERT, der Pfad
wörtlich übernommen (src/sets/setMove.ts) — zwei Konten teilen sich dann
eine Datei. Vorher lag das Löschen VOR dem DELETE und fragte niemanden:
Entfernte das eine Konto seine Anleitung, zeigte die Zeile des anderen
ins Leere, und im Set-Detail stand ein Eintrag, der beim Klick 404 gibt.

Reihenfolge deshalb umgedreht: erst die Zeile weg, dann zählen. Bleibt
eine übrig, bleibt die Datei liegen — sie gehört ja noch jemandem.
```
