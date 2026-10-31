# Begründungen zu `routes/imgProxy.ts`

Die ausführlichen Kommentare aus `routes/imgProxy.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Bild-Proxy für fremde CDNs.

── Warum ein eigenes Modul ─────────────────────────────────────────────────
Das hier stand als rund 440-Zeilen-Block mitten in server.ts, zwischen
Session-Aufbau und Cluster-Orchestrierung. server.ts war damit auf über
1200 Zeilen angewachsen und vermischte drei unabhängige Zuständigkeiten.
Der Proxy ist in sich geschlossen — eine Route, ein Plattencache, eine
Vorschau-Warteschlange — und gehört deshalb hierher.

── Was er tut ──────────────────────────────────────────────────────────────
Rebrickable liefert seine Bilder über Cloudflare mit Hotlink-Schutz; direkt
aus dem Browser geladen kommen sie teils als 404 zurück. Der Server holt sie
deshalb selbst (mit passenden Kopfzeilen), legt sie unter
data/img_proxy_cache ab und liefert sie von dort aus — jedes Bild also
genau einmal vom CDN.

Zugriffsschutz: Ohne Anmeldung wäre die Route ein offener Proxy (fremde
Bandbreite, IP-Verschleierung). Die Ziel-Hosts sind zusätzlich auf eine
Allowlist beschränkt.
```

<a id="abschnitt-2"></a>
## Abschnitt

```text
── Warum diese vier jetzt oben stehen (Nachtrag 155) ────────────────────────

Sie standen als require() in den Funktionsruempfen. Node haelt Module im
Cache, die Laufzeitkosten waren also gering — der Preis war ein anderer:
Die Abhaengigkeiten einer Datei standen nicht mehr an ihrem Kopf, und ein
require() ohne Typdeklaration liefert `any`. Damit war jeder Aufruf darauf
ungeprueft, in einer Datei, die Bilder von fremden Hosts holt.

Geprueft, dass kein Ladezyklus entsteht: ../jobs/imageQueue importiert nicht
(auch nicht ueber Umwege) auf routes/imgProxy zurueck.
```

<a id="abschnitt-3"></a>
## Abschnitt

```text
Wurzelverzeichnis der Anwendung.

ACHTUNG beim Verschieben von Code: Im ursprünglichen server.ts zeigte
__dirname auf die Wurzel, hier zeigt es auf routes/. Ohne diese Konstante
landete der Plattencache in routes/data/img_proxy_cache — ausserhalb des
gemounteten data-Volumes, also bei jedem Container-Neustart leer und mit
jedem Bild erneut vom CDN geholt. Ein Fehler, der nichts kaputtmacht und
genau deshalb monatelang unbemerkt bliebe.
```

<a id="abschnitt-4"></a>
## Abschnitt

```text
Registriert die Proxy-Route und den Aufräum-Timer an der übergebenen App.

Bewusst eine Registrierfunktion statt eines Express-Routers: Die Route hängt
absolut unter /api/img-proxy, und der Aufräum-Timer soll genau einmal pro
Worker gestartet werden — beides ist an dieser einen Stelle sichtbar.

@param {any} app Express-Anwendung
```

<a id="abschnitt-5"></a>
## Abschnitt

```text
═══════════════════════════════════════════════════════════════════════════
Gemeinsamer Zustand und Helfer des Bild-Proxys
═══════════════════════════════════════════════════════════════════════════

── Warum das nicht mehr in registerImgProxy steht (Nachtrag 148) ───────────
registerImgProxy() war 458 Zeilen: Zustand, Helfer und der komplette
Anfrage-Ablauf lagen als Verschluss (Closure) IN der Anmeldefunktion. Das
hatte zwei praktische Folgen. Erstens war die Funktion nur als Ganzes zu
lesen — wer wissen wollte, was bei einer Anfrage passiert, scrollte an
hundert Zeilen Aufbau vorbei. Zweitens war nichts davon von aussen
erreichbar: Ein Test konnte den Ablauf nicht aufrufen, nur den Quelltext
danach absuchen.

Am Verhalten ändert die Verschiebung nichts. Der Zustand ist derselbe wie
vorher pro Prozess einmal vorhanden — registerImgProxy() wird je Worker
genau einmal aufgerufen.
Proxy CDN images to avoid hotlink protection
```

<a id="proxy-cache-max-bytes"></a>
## `PROXY_CACHE_MAX_BYTES`

```text
Obergrenze für den Bild-Zwischenspeicher des Proxys.

── Warum 20 statt 5 MB (Nachtrag 43, Marcos Fund) ─────────────────────────
Marcos Kachel für Set 60445-1 blieb leer, und der direkte Aufruf der
Proxy-Adresse lud „endlos", ohne das Bild je vollständig zu zeigen. Sein
Netzwerk-Protokoll nannte die Zahl, die den Fall löst: 5'243 kB übertragen —
knapp ÜBER der damaligen 5-MB-Grenze.

Die Grenze bricht nur den CACHE-Strom ab, nicht die Auslieferung. Die Folge
war deshalb nicht „kein Bild", sondern etwas Zäheres:
  • `aborted` verhindert das rename → die Datei landet NIE im Cache
  • queueThumb() steht hinter diesem rename → es entsteht NIE eine Vorschau
  • jede Kachel holt daraufhin bei JEDEM Aufruf erneut die vollen 5 MB vom
    CDN, mehrfach parallel, während die Kachelwand lädt
Für ein einzelnes Bild wiederholt sich das bis in alle Ewigkeit, und genau
das sah aus wie „lädt endlos".

Rebrickable liefert für neuere Sets Bilder in hoher Auflösung; 5 MB waren zu
knapp bemessen. 20 MB decken diese Fälle ab und bleiben weit unter dem, was
dem Plattenplatz wehtut — der Aufräumlauf begrenzt den Cache ohnehin. Und
gerade bei grossen Bildern ist die Vorschau am wertvollsten: Sie ersetzt in
der Kachel mehrere Megabyte durch wenige Kilobyte.
```

<a id="cdnagent"></a>
## `_cdnAgent`

```text
Verbindungs-Pool für CDN-Abrufe.

Die Obergrenze schützt den Server davor, bei einer Kachelwand beliebig viele
gleichzeitige TLS-Verbindungen zu öffnen.

── Zur Wahl von 32 ────────────────────────────────────────────────────────
Mit 8 war die Grenze zu eng: Ein einzeln geöffnetes Bild reihte sich hinter
die laufenden Kachel-Anfragen und wartete messbar mit — nachgestellt 1199 ms
gegenüber 152 ms ohne Begrenzung. Eine Kachelwand fordert rund 60 Bilder an;
mit 32 laufen sie in zwei Wellen statt in acht, und eine einzelne Anfrage
wartet höchstens eine Antwortzeit.

Wichtig dazu: `res.on('close')` weiter unten gibt die Verbindung frei, sobald
der Browser abbricht. Ohne das belegten abgebrochene Anfragen ihren Platz und
die Warteschlange verhungerte — das war der eigentliche Schaden der ersten
Fassung, nicht die Grenze selbst.
```

<a id="cdnagent-2"></a>
## Abschnitt

```text
IPv4 erzwingen. Mehrere VÖLLIG unterschiedliche Set-Nummern liefen alle
exakt bis zur eingestellten 25-Sekunden-Grenze, ohne je eine Antwort zu
bekommen — kein TCP-Reset, kein Fehler, einfach nichts. Das ist das
typische Bild einer kaputten oder nicht gerouteten IPv6-Verbindung des
Hosters: Node versucht zuerst eine IPv6-Adresse von Cloudflares Edge,
der Verbindungsaufbau dorthin hängt lautlos, und ohne funktionierendes
Happy-Eyeballs-Verhalten (RFC 8305) wird nie auf IPv4 zurückgewichen,
bevor der EIGENE Timeout zuschlägt. Rebrickable/Cloudflare unterstützen
IPv4 zuverlässig; das Erzwingen kostet nichts, wenn IPv6 ohnehin nicht
funktioniert, und ändert nichts, wenn es funktioniert.
```

<a id="platzhalter"></a>
## `_platzhalter`

```text
„Dieses Bild gibt es nicht" — der Browser bekommt den PLATZHALTER und darf
sich das merken.

── Warum 200 mit Platzhalter statt 404 (Nachtrag 165) ─────────────────────

Marcos Beobachtung: Beim Blaettern durch alte Jahrgaenge steht die Konsole
voller roter 404. Fachlich waren sie richtig — Rebrickable hat zu vielen
alten Sets kein Bild —, aber sie sind nichts, woran jemand etwas aendern
koennte, und sie verdecken echte Fehler.

Der Platzhalter ist ohnehin das, was der Nutzer danach sieht: Beide
Oberflaechen zeigen ihn, wenn kein Bild kommt. Ihn gleich auszuliefern
spart den Umweg ueber die Fehlerbehandlung und macht die Konsole wieder
lesbar.

Was NICHT verlorengeht: Der Server merkt sich die Fehlanzeige weiterhin
(src/katalog/bilder/imageMisses, sieben Tage), zaehlt sie in imgProxyFailures und zeigt
sie in der Bild-Diagnose. Die Information wandert also nur aus der
Browser-Konsole dorthin, wo man etwas mit ihr anfangen kann.

── Marcos Konsole ────────────────────────────────────────────────────────
Dieselbe Adresse mehrfach hintereinander mit 404, etwa
`9780241838570-1.jpg` gleich zweimal.

Ein 404 OHNE Cache-Control ist für den Browser nicht zwischenspeicherbar:
Er fragt bei jedem Rendern der Kachel erneut. Beim Blättern durch alte
Jahrgänge, wo fast jedes Bild fehlt, ist das ein voller Satz Anfragen je
Bildschirm — bis zum Server, dort in den Merker und wieder zurück.

Eine Stunde ist bewusst kurz gewählt: Wird ein Bild nachgereicht, soll es
nicht einen Tag lang unsichtbar bleiben. Der SERVER merkt sich die
Fehlanzeige länger (src/katalog/bilder/imageMisses, sieben Tage) — dort kostet ein
erneuter Versuch ja auch mehr.
```

<a id="bilddurchreichen-wantthumb"></a>
## `wantThumb`

```text
?thumb=1 — verkleinerte Fassung ausliefern.

Teilebilder kommen ausschliesslich vom Rebrickable-CDN und laufen deshalb
über diesen Proxy. thumbUrl() im Client konnte für sie bisher nichts tun
("_thumb"-Varianten gibt es auf dem CDN nicht), also bekam eine Kachelwand
von 100 Teilen 100 Bilder in voller Auflösung — bei 40–100 px Anzeigegrösse.
Das ist der Grund, warum die Teile sichtbar nachtröpfeln.

Der Proxy hält das Original ohnehin auf Platte; die Verkleinerung entsteht
einmalig daraus und liegt daneben. Beim ersten Aufruf eines noch nie
geholten Bildes kostet es weiterhin den CDN-Roundtrip — danach nicht mehr.
```

<a id="bilddurchreichen-darferzeugen"></a>
## `darfErzeugen`

```text
gen=0: Die ANFRAGE rechnet nichts. Statt die Verkleinerung sofort
anzustossen, hinterlässt sie eine Notiz — abgearbeitet wird sie vom
Hintergrund-Job (jobs/imageQueue.ts), gedrosselt und nur auf dem
Primärprozess.

Marcos Vorgabe: „Bitte die Bilder im Hintergrund mit dem
Bilder-Download-Job herunterladen und das Thumb erstellen, sobald sie
einmal via Proxy geladen wurden."

Ausgeliefert wird trotzdem sofort: die Vorschau, wenn es sie schon gibt,
sonst das Original.
```

<a id="bilddurchreichen"></a>
## Abschnitt

```text
Negativ-Cache: Fehlt ein Bild beim CDN (404), holt der Browser es bei jedem
Seitenaufruf erneut — und jedes Mal geht ein Roundtrip zum CDN raus. Der
Merker beantwortet den zweiten und jeden weiteren Versuch sofort.
Eine Stunde, damit ein nachgereichtes Bild nicht dauerhaft ausgesperrt wird.
15 Minuten statt einer Stunde: lang genug, um wiederholte Roundtrips beim
Durchblättern zu sparen, kurz genug, dass ein nachgereichtes Bild bald
wieder erscheint.
Der Merker liegt seit Nachtrag 98 in der DATENBANK: Der Server läuft im
Cluster, und ein Gedächtnis je Prozess liess dasselbe fehlende Bild
einmal PRO PROZESS holen — nach einem Neustart erneut, und nach fünfzehn
Minuten wieder. In den alten Jahrgängen, wo fast jedes Bild fehlt, war
das der Grossteil der Last.
Synchron und ohne Datenbank (Nachtrag 103): Bildanfragen sind der
häufigste Vorgang der Anwendung; eine Abfrage je Bild leerte den
Verbindungspool und liess ANDERE Routen in den Zeitfehler laufen.
```

<a id="bilddurchreichen-header-sets"></a>
## `HEADER_SETS`

```text
Zwei Kopfzeilen-Sätze. Der erste imitiert einen Browser auf rebrickable.com;
der zweite lässt Referer und Accept-Language weg.

Grund: Bilder, die im Browser direkt laden, kamen über den Proxy als 404
zurück. Vor dem CDN steht Cloudflare, und Hotlink-Schutz antwortet auf
einen Referer, der nicht zur anfragenden IP passt, gern mit 404 statt 403 —
die Regel soll sich nicht verraten. Ein zweiter Versuch ohne Referer
klärt das: Klappt er, war es der Hotlink-Schutz; bleibt es bei 404, fehlt
das Bild wirklich.
`as const` macht daraus ein Tupel fester Laenge: `HEADER_SETS[0]` ist
dann ein echtes Element, keine Index-Signatur, die leer sein koennte.
Dieselbe Ursache wie bei PFADE in scripts/loadtest.js — an EINER
Stelle behoben statt an zwei Zugriffen abgesichert.
```

<a id="bilddurchreichen-meldung"></a>
## `meldung`

```text
── 404 ist kein Fehler, sondern eine Auskunft ─────────────────────

Marcos Befund aus dem Betriebsprotokoll: elf rote Zeilen
hintereinander, alle „CDN antwortete 404" zu alten Katalogsets
(9180-1, 9190-1, 9883-1 …). Zu diesen Sets hat Rebrickable schlicht
kein Bild. Das ist der NORMALFALL fuer alte Jahrgaenge, kein Vorfall:
Der Aufruf ging durch, die Antwort war eindeutig, und merkeFehlend()
oben sorgt dafuer, dass dasselbe Bild nicht wieder geholt wird.

Als `error` gemeldet, verstopft es das Protokoll genau dort, wo man
nach echten Stoerungen sucht — und gewoehnt einen daran, rote Zeilen
zu ueberblaettern. Alles ANDERE (403, 5xx, Zeitueberschreitung) bleibt
ein Fehler: Dort ist der Abruf wirklich schiefgegangen.
```

<a id="bilddurchreichen-mime"></a>
## `mime`

```text
── Nur Bilder ──────────────────────────────────────────────────────

Der Content-Type kam ungeprüft vom CDN und wurde so gesetzt UND im
Cache abgelegt. Die Host-Liste ist eng, aber auf den erlaubten CDNs
liegen teils von Nutzern hochgeladene Dateien: Käme dort ein SVG oder
HTML zurück, läge es anschliessend unter der EIGENEN Herkunft — und
ein SVG ist ein Dokument, das Skript enthalten kann. nosniff und die
CSP fangen den Ernstfall ab; eine Route namens img-proxy sollte
trotzdem nichts anderes als ein Bild ausliefern.

SVG ist bewusst NICHT erlaubt: Es ist das einzige Bildformat, das als
Dokument geöffnet aktiv wird, und keines der angebundenen CDNs liefert
Teile- oder Setbilder als SVG.
```

<a id="bilddurchreichen-enc"></a>
## `enc`

```text
Komprimierte Antworten werden ENTPACKT, nicht weitergereicht.

Wir fordern zwar `Accept-Encoding: identity` an, aber nicht jedes CDN
hält sich daran. Ein durchgereichter komprimierter Körper mit
Content-Type: image/jpeg ergibt beim Browser eine weisse Fläche — bei
Status 200 und passender Länge, also ohne Hinweis im Log.

Weitergabe der Kopfzeile wäre die andere Möglichkeit, ist aber
zerbrechlicher: Ein Reverse-Proxy dazwischen kann sie entfernen oder den
Körper anfassen, und im Plattencache läge dann komprimierter Inhalt, der
beim nächsten Ausliefern erneut Kopfzeilen bräuchte. Entpacken macht die
gespeicherte Datei zu einem echten Bild — unabhängig von allem davor.
```

<a id="bilddurchreichen-2"></a>
## Abschnitt

```text
Parallel auf Disk schreiben: erst in .tmp, bei Erfolg atomar umbenennen,
damit nie halbe Dateien im Cache landen. Max. 5 MB pro Bild.
Durchgehend async: mkdirSync/writeFileSync/renameSync haben hier den
Event-Loop blockiert, und zwar genau im heissen Pfad — ein frisch
geöffneter Katalog-Screen lädt bis zu 60 Bilder hintereinander, alle
davon Cache-Miss.
WICHTIG: Der Cache-Stream muss VOR r.pipe(res) hängen. Vorher stand
r.pipe(ws) hinter einem `await mkdir` — die Antwort lief da bereits zum
Client, und die Datei auf Platte konnte die ersten Bytes verlieren.
mkdir daher synchron (einmalig, danach ist das Verzeichnis da).
```

<a id="bilddurchreichen-tmpfile"></a>
## `tmpFile`

```text
Eindeutiger Name JE ANFRAGE, nicht nur je Prozess.

Vorher hiess die Datei nur `.tmp-<pid>`. Fordert eine Kachelwand
dasselbe Bild mehrfach gleichzeitig an — was bei Minifiguren
regelmässig passiert —, schrieben alle Anfragen desselben Workers in
DIESELBE Datei. Das Ergebnis war das Bild mehrfach hintereinander:
gemessen 418'603 statt 81'920 Bytes, also gut fünf Kopien. Solche
Dateien beginnen korrekt mit FFD8 und enden auf FFD9 — sie fallen
weder beim Streamen noch bei einer reinen Endmarken-Prüfung auf, der
Browser kann sie aber nicht dekodieren.
```

<a id="bilddurchreichen-3"></a>
## Abschnitt

```text
Bricht der Browser ab — beim Scrollen über verzögert geladene Bilder der
Normalfall —, muss die Verbindung zum CDN sofort freigegeben werden.

Ohne das blieb der Socket belegt: Der Antwort-Stream lief in ein totes
res, die Gegendruck-Steuerung hielt ihn an, und mit maxSockets: 8 waren
nach wenigen Abbrüchen alle Plätze blockiert. Nachfolgende Anfragen
standen dann bis zur 25-Sekunden-Grenze in der Warteschlange — genau die
`timeout`-Zähler aus der Diagnose.
Abbruch durch den Client: Verbindung freigeben — aber NUR bei einem
echten Abbruch.

Vorher stand hier `if (!res.writableFinished)`. Das ist zu scharf: Je
nachdem, was zwischen Server und Browser sitzt, kann `close` feuern,
bevor Node `writableFinished` gesetzt hat. Dann wurde eine völlig
gesunde Übertragung mittendrin abgeschossen — der Client bekam die
Kopfzeilen mit Status 200 und danach nichts mehr, der Cache-Stream lief
nie zu Ende, und protokolliert wurde nichts. Genau dieses Bild:
200, weisse Seite, leerer Cache, stilles Log.

`res.destroyed` ist der belastbare Hinweis auf einen Abbruch: Bei einer
regulär beendeten Antwort ist es false.
```

<a id="registerimgproxy"></a>
## `registerImgProxy`

```text
Die Route anmelden — unter BEIDEN Adressen. Der Ablauf steht in
bildDurchreichen().

Die kanonische ist /api/v1/img-proxy; alles, was der Server heute baut, und
beide Oberflächen benutzen sie. Die alte bleibt bedient, weil ihre Adresse
in Datenbankzeilen steht und installierte App-Fassungen sie selbst
zusammenbauen — die Begründung samt Auslauf-Charakter steht bei den
Konstanten in src/katalog/bilder/images.ts.
```

<a id="startimgcachecleanup"></a>
## `startImgCacheCleanup`

```text
Img-Proxy-Cache aufräumen: Dateien, die 30 Tage nicht angefasst wurden,
löschen — sonst wächst data/img_proxy_cache unbegrenzt.

── Warum das nicht mehr in registerImgProxy steht ──────────────────────────
Dort lief es in JEDEM Cluster-Worker: registerImgProxy(app) wird von jedem
Prozess aufgerufen, und jeder legte sein eigenes tägliches Intervall an. Bei
acht Workern hiess das acht vollständige Durchläufe über das
Cache-Verzeichnis (readdir plus stat je Datei) und acht Prozesse, die sich
beim unlink gegenseitig ins Gehege kamen — unbemerkt, weil die Fehler
ohnehin verworfen werden.

Alle übrigen wiederkehrenden Arbeiten (Preis-Job, Token-Aufräumen,
Log-Bereinigung) hängen längst hinter isPrimaryWorker. Diese gehört dazu.

Bewusst KEIN Aufräumen beim Start: Ein Neustart soll schnell antworten
können, und einen Tag länger im Cache schadet nichts.
```

<a id="proxycachepathfor"></a>
## `proxyCachePathFor`

```text
Wo läge das Bild dieser CDN-Adresse im Proxy-Cache?

Die Regel (SHA1 der Adresse, Ablage unter data/img_proxy_cache) stand bisher
NUR mitten in der Route. Für die Bild-Diagnose (Nachtrag 50) wird sie von
aussen gebraucht — und eine zweite, abgeschriebene Fassung anderswo wäre
genau die Sorte Duplikat, die irgendwann auseinanderläuft und dann falsche
Auskunft gibt.
```
