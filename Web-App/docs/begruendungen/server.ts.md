# Begründungen zu `server.ts`

Die ausführlichen Kommentare aus `server.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="wildcardrequest"></a>
## `WildcardRequest`

```text
Anfrage einer Wildcard-Route (`app.get('/images/*pfad', …)`).

── Warum benannt (Nachtrag 155) ────────────────────────────────────────────
Auf dem allgemeinen Request-Typ ist `params` leer, der erfasste Pfad also
ein implizites `any` — und der Wert geht hier direkt in safeDataPath(), den
Path-Traversal-Schutz. Ein Pfadsegment ist der letzte Wert, den man
ungeprueft durchreichen will.

Der Typ schreibt hin, was die Route zusichert, statt es an vier Stellen
wegzucasten.

── Was Express 5 daran geaendert hat (05.10.) ──────────────────────────────
Express 4 legte die Erfassung eines `*` unter dem numerischen Schluessel `0`
ab, als EINE Zeichenkette ("42/bild.png"). Express 5 verlangt einen Namen
(`*pfad`) und liefert ein ARRAY der Segmente (["42","bild.png"]).

NACHGEMESSEN gegen express 5.2.1, nicht aus der Anleitung abgeschrieben:
  /images/42/abc.png  → ["42","abc.png"]
  /images/a//b.png    → ["a","","b.png"]   ← leere Segmente bleiben drin
  /images/a/          → ["a",""]
Deshalb bleibt das `.filter(Boolean)` unten stehen: Es tat vorher genau
dasselbe (`split('/')` liefert bei `a//b` ebenfalls ein leeres Stueck), und
safeDataPath() bekommt damit weiterhin dieselbe Liste wie bisher.
```

<a id="abschnitt"></a>
## Abschnitt

```text
Ablaufkontext der gerade bearbeiteten Anfrage.

── Wozu ────────────────────────────────────────────────────────────────────
Der Server läuft im Cluster mit mehreren Prozessen. In app_logs landeten
bisher nur Freitextzeilen — zwei zusammengehörige Meldungen derselben
Anfrage liessen sich nachträglich nicht mehr einander zuordnen, und bei
gleichzeitigen Anfragen stehen die Zeilen ohnehin verschachtelt.

AsyncLocalStorage trägt die Kennung durch die gesamte await-Kette, ohne dass
sie durch jede Funktionssignatur gereicht werden muss.
```

<a id="express"></a>
## `express`

```text
Bewusst require() statt import: dieser Block läuft nur im Worker-Zweig.
Ein top-level import würde Express/DB-Pool/Routen auch im Cluster-Primary
laden. `as typeof import(...)` liefert trotzdem volle Typisierung.

── Nachtrag 155: das `as typeof import(...)` ist Pflicht, nicht Zierde ──────
Es standen 15 require() OHNE diesen Zusatz in der Datei. Die liefern `any`,
und damit ist jeder Zugriff darauf ungeprueft — ein vertipptes
`scheduler.rescheduleAl()` waere erst zur Laufzeit als "is not a function"
aufgeschlagen, beim Hochfahren des Servers. Alle 15 sind jetzt nachgezogen.
Wer hier eine neue Zeile ergaenzt: Der Zusatz gehoert dazu.
```

<a id="router"></a>
## `_Router`

```text
── Async-Handler absichern ─────────────────────────────────────────────────
Express 4 kennt keine Promises: Wirft ein `async (req, res) => …`-Handler,
landet die Rejection nirgends — die Antwort bleibt aus, die Verbindung offen.
Ein Reverse-Proxy davor wartet auf sein Timeout und liefert dann 502. Genau
so verhielt sich /api/sets/import/csv/status, während alle anderen Routen
normal antworteten.

22 Handler hatten kein try/catch. Statt sie einzeln zu umschliessen (und die
nächste neue Route wieder zu vergessen), wird `express.Router` hier EINMAL
erweitert: Gibt ein Handler ein Promise zurück, hängt sich ein .catch(next)
daran. Damit greift das zentrale Fehler-Sicherheitsnetz weiter unten, und aus
einem stillen Hänger wird eine saubere 500.

Muss vor den require('./routes/…')-Aufrufen stehen, sonst sind die Router
bereits gebaut.
```

<a id="port"></a>
## Abschnitt

```text
SSE-Ströme NICHT komprimieren — sie müssen sofort rausgehen.

VORHER stand hier ein exakter Stringvergleich auf den Accept-Header.
Schickt ein Client `text/event-stream, */*` — was OkHttp auf Android je
nach Konfiguration tut —, griff die Ausnahme nicht: compression puffert
dann den Strom, und die Events erreichen den Client erst beim
Verbindungsende. Das sähe exakt wie das Problem aus, das der persistente
Stream lösen sollte, und wäre entsprechend schwer zu finden.

Zwei Prüfungen statt einer: der Accept-Header als Teilstring (deckt jede
Kommaliste ab) UND der bereits gesetzte Content-Type der Antwort (greift
auch, wenn der Client gar kein Accept schickt).
```

<a id="port-uebertls"></a>
## `ueberTls`

```text
── HSTS, aber NUR über eine verschlüsselte Verbindung ────────────────────

Ohne diesen Kopf geht die allererste Anfrage nach einem getippten
"lego.bigolin.online" im Klartext hinaus — samt Cookie, wenn
COOKIE_SECURE nicht gesetzt ist. Die Umleitung auf https kommt erst als
ANTWORT darauf; da war die Anfrage schon unterwegs.

── Warum die Bedingung nicht wegdarf ────────────────────────────────────

Derselbe Server läuft bei vielen im LAN unter http://192.168.x.x:3000 —
die Server-Adresse gibt der Nutzer selbst ein (siehe die Begründung in
Android-App/.../network_security_config.xml). Ein Browser IGNORIERT HSTS
zwar über Klartext, aber sobald derselbe Host je einmal über https
erreichbar war, merkt er sich die Regel und verweigert danach jeden
http-Zugriff — ein Jahr lang, ohne Weg zurück ausser über die
Browsereinstellungen. Deshalb nur, wenn die Verbindung TATSÄCHLICH
verschlüsselt ist.

Beide Wege werden geprüft: `req.secure` greift hinter dem Reverse-Proxy
nur mit `trust proxy` (weiter unten, und nur in Produktion gesetzt), der
Kopf `x-forwarded-proto` auch ohne. Einer allein wäre eine Regel mit
einer Lücke, die niemand sieht.

HSTS_MAX_AGE=0 schaltet den Kopf ab. Nicht als Bequemlichkeit, sondern
weil HSTS im Browser klebt: Wer eine Fehlkonfiguration bemerkt, muss sie
abstellen können, ohne auf den Ablauf zu warten.
```

<a id="port-2"></a>
## Abschnitt

```text
'unsafe-inline' ist entfallen: Sämtliche Inline-Handler sind durch den
delegierten Dispatcher in js/11-actions.js ersetzt (data-click,
data-change, …). Damit greift die CSP jetzt tatsächlich als zweite
Verteidigungslinie — bei einer übersehenen XSS-Lücke würde eingeschleustes
<script> nicht mehr ausgeführt.

style-src behält 'unsafe-inline': Die Templates setzen an vielen Stellen
style="…" für berechnete Werte (Fortschrittsbalken, Farbpunkte). Das ist
eine deutlich harmlosere Klasse als ausführbares Skript und wäre ein
eigener Umbau.
cdnjs ist entfallen: Die CSP erlaubte damit JEDES Skript auf cdnjs —
eine Bibliothek dort zu kompromittieren hätte gereicht, um beliebigen
Code in dieser App auszuführen. Die einzige Nutzung (qrcodejs, 20 KB)
liegt jetzt unter public/vendor/qrcode/ und wird vom eigenen Origin
geladen; damit ist script-src wieder ausschliesslich 'self'.
```

<a id="abschnitt-2"></a>
## Abschnitt

```text
`req.body` ist immer ein Objekt — die Zusicherung von Express 4, nachgebaut.

── Was Express 5 geaendert hat ─────────────────────────────────────────────
Vorher war `req.body` ein leeres Objekt, wenn kein Parser etwas zu lesen
fand. Jetzt ist es `undefined`. NACHGEMESSEN gegen express 5.2.1 mit genau
diesen beiden Parsern davor:

  POST mit JSON                → {x:1}
  POST leerer Rumpf, JSON-Typ  → {}
  POST ohne Rumpf, ohne Typ    → undefined
  POST formular-kodiert        → undefined   (urlencoded liest nur sich selbst)
  GET  ohne Rumpf              → undefined

── Warum das hier steht und nicht an vierzehn Stellen ──────────────────────
Vierzehn Handler schreiben `const { … } = req.body`. Auf `undefined` wirft
das — und zwar mit „Cannot destructure property …", also einem 500. Vorher
liefen dieselben Anfragen in die EIGENE Pruefung des Handlers und bekamen
einen sauberen 400 („set_number_erforderlich"). Ein Client, der den
Content-Type vergisst, verdient die zweite Antwort, nicht die erste.

Vierzehn Stellen einzeln abzusichern waere dieselbe Regel in vierzehn
Fassungen. Hier steht sie einmal, an der Stelle, an der die Parser hängen.

Was dadurch NICHT verlorengeht: Wer „kein Rumpf" von „leerer Rumpf"
unterscheiden will, kann das weiterhin — nur eben nicht mehr an `undefined`.
Heute will das niemand: Die einzige Stelle, die `req.body` ausserhalb eines
POST/PUT liest, fragt mit `req.body?.owner` (routes/api_v1/sets.ts), und die
bekommt so oder so `undefined`.
```

<a id="abschnitt-3"></a>
## Abschnitt

```text
── Doppelte Schrägstriche im Pfad zusammenfassen ───────────────────────────

Hier standen ZWEI Middlewares hintereinander, die beide dasselbe taten. Die
erste kürzte nur führende Schrägstriche und war damit vollständig von der
zweiten abgedeckt — sie ist entfallen.

`//api/img-proxy?url=…` trifft in Express NICHT auf `/api/img-proxy`. Die
Anfrage fällt stattdessen durch bis zum SPA-Catch-all und bekommt
index.html — mit **Status 200** und `text/html`. Im Browser ist das eine
weisse Seite, im Server-Log steht nichts, und der Bild-Cache bleibt leer.

Genau dieses Bild war bei einzelnen Bildern zu sehen und hat mehrere Runden
Fehlersuche gekostet: Der Proxy schien zu antworten, tat es aber nie.

Ein doppelter Schrägstrich entsteht schnell — beim Zusammensetzen einer
Basis-URL mit abschliessendem Schrägstrich und einem Pfad, der mit einem
beginnt. Statt jede Aufrufstelle zu prüfen, wird der Pfad hier einmal
normalisiert.
```

<a id="sitzungsspeicher"></a>
## Abschnitt

```text
── Die Leerlauf-Frist der Webapp-Sitzung ──────────────────────────────

Marcos Vorgabe: „webapp-session sollten sich nach ein paar Stunden
inaktivität bereits ausloggen."

Bis hierher stand hier KEIN `ttl`. Dann gilt die Voreinstellung von
connect-pg-simple — ein Tag —, und die war nie eine Entscheidung,
sondern das, was übrig bleibt, weil das Cookie unten kein `maxAge`
trägt. Die Zahl und ihre Begründung stehen jetzt in
src/konto/sitzungsFrist.ts.

Durchgesetzt wird die Frist an der Zeile in `user_sessions`: Ihr
`expire` rückt bei Betrieb nach (gedrosselt, siehe unten), und eine
abgelaufene Zeile liefert der Speicher beim Lesen nicht mehr aus. Daran
kommt keine Anfrage vorbei. Die Webapp sieht dann einen 401 und zeigt
die Anmeldemaske (js/01-core.js: `meldeSitzungBeendet`).

Das Cookie bleibt ABSICHTLICH ohne `maxAge`. Sonst würde es zu einem
dauerhaften Cookie, das einen Neustart des Browsers überlebt — die
Frist hätte dann eine Eigenschaft hinzugefügt und eine weggenommen.
So gilt beides: Schluss beim Schliessen des Browsers UND Schluss nach
der Leerlauf-Frist.

Die Android-App zahlt das nicht: Sie kommt mit Bearer-Token und ohne
Cookie, dann fasst express-session den Speicher gar nicht erst an
(nachgemessen in src/konto/sitzungsBeruehrung.ts: 0 Abfragen bei 20
Anfragen ohne Cookie). Ihre eigene Frist ist TOKEN_IDLE_DAYS.
```

<a id="servedatafile"></a>
## `serveDataFile`

```text
Ausliefern einer Datei unter data/<subDir>/<benutzer-id>/…

── Wer darf das lesen? ─────────────────────────────────────────────────────
Hier stand `parseInt(segments[0]) !== userId` — also „nur deine eigene ID".
Das war richtig, solange ein Konto für sich allein stand, und passte nach dem
Haushalt an zwei Stellen nicht mehr:

  • Das Hauptkonto SIEHT die Anleitung eines Unterkontos (getSet listet sie
    mit user_id = ANY(uids), also haushaltsweit) — und lief beim Klick in
    ein 403. Sichtbar, aber nicht zu öffnen.
  • Nach dem Verschieben eines Sets gehört die Anleitungs-Zeile dem neuen
    Konto, ihr local_path zeigt aber weiter in den Ordner des alten
    (moveSetBetweenAccounts kopiert den Pfad wörtlich). Das Hauptkonto
    bekam also für seine EIGENE Zeile 403.

Deshalb entscheidet jetzt scopeIds() — dieselbe Stelle, die überall sonst
beantwortet, wessen Daten jemand sehen darf. Die Benutzer-ID im Pfad ist
damit das, was sie ohnehin schon war: eine Ablagestruktur, keine
Zugriffsregel. Die Regel steht in src/haushalt/haushalt.ts.

Die Asymmetrie bleibt gewahrt: Ein Unterkonto hat nur sich selbst im
Blickfeld (resolveHousehold: memberIds = [self, …eigene Subs]), kommt also
NICHT an die Uploads des Hauptkontos. Geprüft wird weiterhin gegen eine
Liste erlaubter IDs, nicht gegen „irgendwer im System".
```

<a id="abschnitt-4"></a>
## Abschnitt

```text
── Alle Bilder: Sets, Teile, Minifiguren ───────────────────────────────────

EINE authentifizierte Route für den gesamten Baum unter data/images/.

VORHER war das zweigeteilt: Teile- und Figurenbilder liefen über eine eigene
Route mit Anmeldepflicht, Set-Bilder dagegen über express.static — also ohne.
Die Begründung dafür lautete, es seien öffentliche Katalogfotos. Das stimmt
für das einzelne Bild, nicht für die Sammlung: Wer die Adressen durchprobiert,
liest ab, WELCHE Sets jemand besitzt. Der Bestand ist das Schützenswerte,
nicht das Foto.

Zwei Dinge kann diese Route, die express.static nicht konnte:
  1. Anmeldung verlangen.
  2. Heilen. Fehlt die lokale Datei, wird die CDN-Adresse aus dem Katalog
     gesucht und über den Bild-Proxy ausgeliefert — sonst wären verwaiste
     image_local-Einträge tote Bilder.

Der Platzhalter (set-placeholder.svg) liegt bewusst NICHT hier, sondern unter
/assets/: Er ist ein Build-Asset wie CSS und JavaScript und hat mit dem
Bestand nichts zu tun.
```

<a id="lookupcdnformissingimage"></a>
## Abschnitt

```text
Privat, nicht public: Die Antwort hängt an einer Anmeldung und darf nicht
in einem geteilten Zwischenspeicher (Reverse-Proxy, CDN) landen.

── max-age=0 statt no-cache: ZWEI Anforderungen, die sich nicht widersprechen

Marcos Anforderung von damals (Nachtrag 37): „wenn ein falsches Bild
heruntergeladen wurde, soll geprüft werden, ob ein neues auf dem Server
vorhanden ist." Vorher galt max-age=604800 — eine Woche ohne jede
Rückfrage, und ein einmal geladenes falsches Bild blieb sieben Tage
stehen. Das war beobachtet worden.

Marcos Anforderung von jetzt: „Die Android-App soll auch ohne Internet
funktionieren."

`no-cache` erfüllte die erste und verhinderte die zweite. Es heisst nicht
„nicht zwischenspeichern", sondern „vor JEDER Verwendung rückfragen" — und
genau das geht ohne Netz nicht. Die App behielt ihre Kopie, durfte sie aber
nicht benutzen; ihr Offline-Rückfall (AppModule.kt, IOException →
FORCE_CACHE) konnte die Anfrage deshalb nicht erfüllen, und in den Tabellen
stand der Platzhalter statt des Bildes.

`max-age=0` erfüllt beide. Die Antwort ist sofort veraltet, also stellt der
Client bei JEDER Verwendung dieselbe bedingte Anfrage wie vorher — online
ändert sich nichts. Der Unterschied zeigt sich nur dort, wo es darauf
ankommt: Eine veraltete Kopie DARF ausgeliefert werden, wenn die Rückfrage
nicht möglich ist. Genau darauf baut der Offline-Rückfall.

Bewusst OHNE `must-revalidate`: Das verbietet die Auslieferung einer
veralteten Kopie ausdrücklich und nähme die Zeile wieder zurück.

Teuer wird das nicht: express beantwortet die bedingte Anfrage über den
ETag mit 304 und ohne Rumpf, solange sich die Datei nicht geändert hat.
Der ETag von sendFile leitet sich aus Grösse und Änderungszeit ab und
wechselt damit genau dann, wenn die Datei neu geschrieben wurde.
```

<a id="lookupcdnformissingimage-rohpfad"></a>
## `rohPfad`

```text
Fehlt eine VORSCHAU, gibt es fast immer das Original daneben — dann geht
das raus, sofort (Nachtrag 40, Marcos Anforderung: „Der Client soll das
Bild jeweils direkt erhalten und nicht warten, bis das Thumbs-Image
generiert wurde. Ist kein Thumb vorhanden, soll das grosse Bild
zurückgeliefert werden.").

Der Bild-Proxy hält es für CDN-Bilder längst so: Original sofort,
Verkleinerung in der Warteschlange. Die lokale Route tat es nicht — sie
sprang bei fehlender _thumb-Datei gleich zum CDN-Umweg oder endete in
404, obwohl das grosse Bild einen Ordner weiter lag. Das trifft genau
das Zeitfenster nach dem Erfassen: Die Vorschau entsteht im Hintergrund
(setImmediate → generateThumb), und wer in diesen Sekunden die Galerie
öffnet, bekam nichts.

Absichtlich KEIN Erzeugen der Vorschau hier: Das würde die Anfrage um
rund 150 ms Jimp verlängern — bei einer Kachelwand summiert sich das zu
Sekunden. Die Vorschau kommt vom Hintergrundlauf; bis dahin ist das
Original das bessere Bild als gar keines.
`segments` ist hier schon da und steht im selben Handler — der rohe Pfad
wird daraus wieder zusammengesetzt, weil die beiden regulaeren Ausdruecke
unten auf der ganzen Zeichenkette arbeiten. Unter Express 4 stand genau
das in `req.params[0]`; `join('/')` stellt es wieder her.
```

<a id="lookupcdnformissingimage-webpfadoriginal"></a>
## `webPfadOriginal`

```text
Fehlende Vorschau im HINTERGRUND nachziehen (Nachtrag 48).

Bis hierher war die Vorschau ein reines Erfassungs-Ereignis: erzeugt
wird sie nur in routes/sets.ts direkt nach dem Download. Ging dabei
etwas schief — bei Marcos Set scheiterte der Download bis Nachtrag 47
an der Grössengrenze —, entstand sie NIE mehr. Der Bilder-Nachlauf
half nicht: Er deckt set_parts_catalog, set_minifigs_catalog und
parts ab, aber NICHT `sets`, und er repariert ohnehin nur physisch
fehlende Dateien, keine fehlenden Vorschauen. Ergebnis: Die Galerie
lieferte für dieses Set dauerhaft das grosse Bild, während ältere
Sets ihre Vorschau nutzten — genau die gemeldete Beobachtung.

Diese Stelle ist der beste Ort dafür: Hier ist gerade bewiesen, dass
die Vorschau fehlt und das Original vorliegt. Bewusst NICHT im
Anfragepfad erzeugen (das kostete rund 150 ms Jimp je Kachel, siehe
Nachtrag 40) — angestossen wird nebenher, ausgeliefert wird sofort
das Original. Beim nächsten Laden steht die Vorschau bereit.
```

<a id="abschnitt-5"></a>
## Abschnitt

```text
Kein express.static für /images mehr.

VORHER lieferte `app.use('/images', express.static(IMAGES_DIR))` die
Set-Bilder OHNE Anmeldung aus — mit der Begründung, es seien ohnehin
öffentliche Katalogfotos. Das stimmt für das einzelne Bild, nicht für die
Sammlung: Wer die Adressen durchprobiert, liest ab, WELCHE Sets jemand
besitzt. Genau das ist der schützenswerte Teil.

Alle Bilder laufen jetzt über die authentifizierte Route weiter oben. Sie
kann zusätzlich das, was express.static nicht konnte: bei fehlender lokaler
Datei auf die CDN-Adresse aus dem Katalog umleiten.

Das einzige Bild, das ohne Anmeldung erreichbar bleiben muss, ist der
Platzhalter — er ist ein Build-Asset wie CSS und JavaScript und liegt
deshalb jetzt unter /assets/ statt unter /images/.
```

<a id="lookupcdnformissingimage-2"></a>
## Abschnitt

```text
── `index: false` — und das ist der Punkt, nicht eine Kleinigkeit ───────

Ohne diese Zeile liefert express.static die index.html fuer `/` SELBST
aus und kommt damit dem SPA-Catch-all zuvor. Die Startseite ging also am
Renderer (src/konto/indexHtml.ts) vorbei — an genau der Adresse, die jeder
Lesezeichen- und Erstbesuch benutzt.

GEMESSEN am 17.10. am laufenden Server:

  /           <html lang="de">                       ?v=2026.10.17.1217
  /irgendwas  <html data-theme="classic" lang="de">   ?v=mvccag5c-14dl

Zwei Dinge fielen damit auf der Startseite aus:

  • das serverseitig gesetzte `data-theme`. Dafuer gibt es den Renderer
    ueberhaupt: Ohne den Wert startet ein frischer Browser im
    Standarddesign und springt nach dem Abgleich sichtbar um. Der Kopf
    von src/konto/indexHtml.ts beschreibt genau diesen Sprung als das
    Problem, das geloest sei — auf `/` war er nie geloest.
  • der Dateistempel (src/infra/assetStempel.ts). Deshalb blieb meine
    Cache-Reparatur bei Marco wirkungslos: Sie kam an seiner Adresse gar
    nicht zum Einsatz.

`/index.html` liefert express.static weiterhin direkt aus — das ist ein
ausgeschriebener Dateipfad und niemandes Startseite.
```

<a id="abschnitt-6"></a>
## Abschnitt

```text
── Die zwei Adressen, die VOR allem anderen antworten muessen ──────────────

Sie stehen hier direkt und nicht in einem Router, und das bleibt so: Beide
werden gefragt, waehrend Schema und Migrationen noch laufen — zu dem
Zeitpunkt ist der /api/v1-Router noch gar nicht eingehaengt. Express nimmt
die erste passende Zuordnung, und diese beiden stehen davor.

Unter /api/v1 stehen sie trotzdem: Sie sind Teil derselben Oberflaeche wie
alles andere, und eine zweite Adressform „nur fuer diese zwei" waere genau
die Ausnahme, die die Zusammenfuehrung aufgeraeumt hat. Die frueheren
Adressen /api/startup-status und /api/health gibt es nicht mehr.
```

<a id="abschnitt-7"></a>
## Abschnitt

```text
── EINE Adressraum: alles unter /api/v1 ─────────────────────────────────────

Marcos Frage war „wurde die api zusammengefuehrt, so dass nur noch ein
Endpunkt besteht?" — die Antwort war nein. Es gab zwei Praefixe:
/api/<bereich> fuer die Webapp und /api/v1 fuer beide Clients.

NACHGEMESSEN vor dem Umbau: Von 47 alten Routen hatten nur DREI ein
Gegenstueck unter /api/v1 (auth/login, auth/logout, auth/me) — und selbst
die sind nicht dasselbe, sondern zwei Ausweise (Sitzung gegen Bearer-Token).
Die beiden Oberflaechen waren also kaum doppelt, sondern grossteils
disjunkt: Anmeldung, CSV-Einlesen, Anleitungen, Einstellungen, Streams gab
es nur alt.

„Zusammenfuehren" heisst hier deshalb UMZIEHEN, nicht Doppeltes entfernen.
Die Router sind DIESELBEN Objekte wie vorher — nur die Adresse aendert sich.

── Warum das ohne Umbau der Anmeldung geht ─────────────────────────────────
requireToken in routes/api_v1/middleware.ts nimmt beide Ausweise. Die hier
umgehaengten Router bringen ihre eigene Absicherung mit (requireLogin,
sitzungsgebunden); der Umzug aendert daran NICHTS. Was sich aendert, ist
ausschliesslich die Adresse. Wer diese Routen auch fuer die App oeffnen
will, stellt requireLogin auf requireToken um — ein eigener Schritt.

── Reihenfolge ist Absicht ─────────────────────────────────────────────────
/api/v1 (der Index) steht ZUERST, die Fach-Router danach. Andersherum finge
ein sitzungsgebundener Router unter /api/v1/sets die Token-Anfragen ab —
gemessen als 401 „Nicht angemeldet" auf /api/v1/sets/…/acquisitions mit
gueltigem Token.

/api/v1/auth steht ZULETZT und ist der einzige Eintrag, bei dem die
Reihenfolge KEINE Rolle mehr spielt: Seit dem Zusammenlegen gibt es die
Adressen /auth/login, /auth/logout und /auth/me nur noch einmal. Vorher
hatte sie jede Seite mit eigener Bedeutung — Sitzung gegen Bearer-Token —,
und welche gewann, entschied diese Liste.

`/api/finance` ist ersatzlos entfallen: Der Router dort trug NULL Routen
(58 Zeilen, nur `router.use(requireLogin)` und der Export).
```

<a id="abschnitt-8"></a>
## Abschnitt

```text
Die Schreibweise mit den geschweiften Klammern ist NICHT Geschmack.

Express 5 verlangt fuer einen Platzhalter einen Namen. Die naheliegende
Uebersetzung von `'*'` waere `'/*splat'` — und die haette die Startseite
gekostet. NACHGEMESSEN gegen express 5.2.1:

  '/*splat'    /  → 404      /start → 200     /tief/drin → 200
  '/{*splat}'  /  → 200      /start → 200     /tief/drin → 200

Die geschweiften Klammern machen den Teil OPTIONAL, und nur damit trifft
die Regel auch die nackte Wurzel. Ein Aufruf von https://…/ ohne Pfad ist
aber genau der Normalfall — die Lesezeichen, der Startbildschirm des
Telefons, jeder erste Besuch. Das waere beim Umstieg lautlos kaputtgegangen
und haette in keinem Test gefehlt, der mit einem Pfad anfaengt.
```

<a id="electprimaryworker-shutdown-timeout-ms"></a>
## `SHUTDOWN_TIMEOUT_MS`

```text
── Geordnetes Herunterfahren ─────────────────────────────────────────────

Ohne SIGTERM-Handler beendet `docker compose down` (oder jedes Deploy) den
Prozess hart: Laufende Anfragen brechen mitten in der Antwort ab, offene
SSE-Verbindungen bekommen kein Ende, und ein CSV-Import wird zwischen zwei
Statements gekappt. Zusammen mit den (jetzt vorhandenen) Transaktionen
heisst geordnetes Beenden auch: keine halb geschriebenen Bestände mehr.

Ablauf: keine neuen Verbindungen mehr annehmen → laufende zu Ende bringen →
Datenbankpool und LISTEN-Verbindung schliessen. Die Frist ist bewusst
kürzer als Dockers Standard-Gnadenfrist von 10 s, damit wir vor dem
SIGKILL fertig sind.
```

<a id="electprimaryworker"></a>
## Abschnitt

```text
Die Sperr-Verbindung des primaeren Workers ZUERST zurueckgeben.

Sie kommt aus `pool.connect()` und wird absichtlich nie freigegeben,
damit der Advisory-Lock bestehen bleibt (siehe electPrimaryWorker).
`pool.end()` wartet aber auf JEDEN ausgeliehenen Client — ohne diese
Zeile bleibt sie bis zur Frist oben offen, und der Lock wird erst
freigegeben, wenn Postgres die Verbindung als tot erkennt. Ein sofort
nachfolgender Start faende ihn dann noch belegt.

Gefunden von noUnusedLocals: `_primaryLockClient` wurde gesetzt und
nie wieder gelesen — also auch nie geschlossen.
```

<a id="electprimaryworker-2"></a>
## Abschnitt

```text
Das Blickfeld eines Kontos wird gemerkt (src/haushalt/haushalt.ts) — hier kommt
die Nachricht an, dass es sich geaendert hat.

Ohne dieses Signal saehe ein anderer Cluster-Worker die neue Verknuepfung
erst nach Ablauf der Frist: Der Nutzer loest eine Einladung ein und findet
sein Unterkonto je nach Worker mal vor und mal nicht.

Der Handler laeuft auch beim (Wieder-)Verbinden ohne Signal — dann mit
undefined als Payload (siehe db/pgNotify.ts). Genau richtig: Was
waehrend einer Trennung passiert ist, weiss dieser Worker nicht, also
faengt er ohne gemerkten Stand neu an.
```

<a id="electprimaryworker-manualparts"></a>
## `manualParts`

```text
Manuell erfasste Teile mit fehlendem lokalen Bild — im selben Job
dauerhaft in den lokalen Cache laden (statt nur über den Proxy).

Ohne user_id, und das ist der Punkt: Das Bild haengt am Teil-Farb-Paar
und liegt seit Migration 0034 EINMAL im Katalog. Vorher stand diese
Abfrage auf parts und lieferte dasselbe Paar je Konto erneut — der
Job lud dieselbe Datei mehrfach herunter.

Der JOIN auf parts bleibt: Geladen werden nur Bilder von Teilen, die
jemand tatsaechlich manuell erfasst hat. Set-Teile deckt
downloadSetImages() oben ueber set_parts_catalog ab.
```

<a id="electprimaryworker-figstofetch"></a>
## `figsToFetch`

```text
Minifiguren — ALLE, nicht nur manuell erfasste.

Bisher stand hier `source='manual'`. Minifiguren aus Sets liefen
dadurch dauerhaft über /api/img-proxy: Anmeldeprüfung, Cache-Suche
und Stream bei jeder einzelnen Kachel, beim ersten Anzeigen dazu ein
CDN-Roundtrip je Bild. Set-Bilder liegen längst lokal und gehen über
express.static — deshalb war die Minifiguren-Ansicht spürbar träger.

Das DISTINCT ON ueber die Nummer stand hier, weil die Abfrage auf
minifigs lief und dieselbe Figur je Konto eine Zeile hatte. Seit
Migration 0034 steht Name und Bild EINMAL im Katalog, und
fig_number ist dort der Primaerschluessel — die Verdichtung erledigt
die Tabelle.

Das EXISTS haelt die Menge bei dem, was die Abfrage vorher lieferte:
Figuren, die jemand besitzt. Der Katalog kennt auch Figuren aus
Set-Teilelisten, die niemand hat.
```
