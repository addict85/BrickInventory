# Vor der Nummerierung, Teil 3

Teil der Fix-Historie — Übersicht in [CHANGELOG-fixes.md](../CHANGELOG-fixes.md).

---

## Nebenbefund: Statistik wich zwischen Webapp und App ab

Die Paritätsprüfung schlug reproduzierbar fehl (`total_parts` unterschiedlich).
Ursache war meine Umstellung auf den Hintergrund-Neuaufbau: `getPartsStats`
benutzte die Zusammenfassung, sobald **irgendeine** existierte — auch eine
veraltete. Während eines Neuaufbaus las der eine Endpunkt daraus und der andere
live.

Für Listen ist ein veralteter Stand unkritisch; für Kennzahlen nicht, weil
Webapp und App dieselbe Zahl zeigen sollen. `ensureFresh(userId, { strict: true })`
akzeptiert nur einen aktuellen Stand — beide weichen dann gemeinsam auf die
Live-Abfrage aus, bis der Neuaufbau durch ist.

Paritätssuite dreimal gefahren: 32/32, 32/32, 32/32.

Stand: `tsc --noEmit` sauber, alle Tests grün.

---
## Vollständiger Testlauf zum Stand mit Content-Length

Beim letzten Mal war mein Budget aufgebraucht, bevor die Suiten durch waren.
Nachgeholt, in Blöcken:

| Block | Ergebnis |
|---|---|
| Statische Suiten (8 Dateien) | 60 / 60 |
| Frontend- und Logiksuiten (7 Dateien) | 60 / 60 |
| CSP, Preise, Async-Routen, Bilder (4 Dateien) | 58 / 58 |
| `parts-summary` (Postgres) | 6 / 6 |
| `catalog-api` (Postgres) | 8 / 8 |
| `api-parity` (Postgres) | 32 / 32 |
| **gesamt** | **224 / 224, 0 übersprungen** |

Dazu `tsc --noEmit` sauber. 26 Testdateien.

Damit ist der ausgelieferte Stand vollständig bestätigt — die offene Stelle aus
der letzten Runde ist geschlossen.

---
## Der Verbindungs-Pool ist raus — er war die Ursache

Deine Beobachtung war der Beweis: Ein **einzeln** geöffnetes Bild braucht 10 bis
15 Sekunden, danach ist es gecached und der Reload sofort da.

Ein einzelnes Bild kann nicht am CDN scheitern — die Diagnose zeigte 60 bis
200 ms Antwortzeit. Es stand in **meiner** Warteschlange: `maxSockets: 8` reihte
die Anfrage hinter die noch laufenden Kachel-Anfragen der geöffneten App-Seite.

Nachgestellt:

```
mit maxSockets: 8    einzelnes Bild nach 1199 ms (hinter 60 Kacheln)
ohne Begrenzung      einzelnes Bild nach  152 ms
```

Bei den realen CDN-Zeiten skaliert das genau auf die beobachteten 10–15
Sekunden.

**Die Begrenzung ist entfernt.** `keepAlive` bleibt — Verbindungen
wiederzuverwenden spart den TLS-Handshake und kostet nichts.

### Was ich daraus mitnehme

Ich habe den Pool eingebaut, weil ich vermutete, das CDN würde 60 gleichzeitige
Verbindungen drosseln. **Diese Vermutung haben die Messwerte nie gestützt** —
die Zähler standen durchgehend auf `timeout: 0, error: 0, notFound: 0`. Ich habe
danach zwei weitere Runden damit verbracht, Folgeprobleme des Pools zu beheben
(verhungernde Warteschlange bei abgebrochenen Anfragen), statt die Ursache zu
hinterfragen.

Was aus diesen Runden bleibt und für sich richtig ist:

- **`res.on('close')`** gibt die CDN-Verbindung bei Abbruch frei — sinnvoll,
  unabhängig vom Pool.
- **`Content-Length`** auf allen drei Auslieferungswegen — spart dem Proxy
  davor das Puffern.
- **Fehlerzähler und Logging** im Proxy — sie haben genau diese Fehldiagnose
  aufgedeckt.
- **Eindeutige Temp-Dateien** und die **Vollständigkeitsprüfung** — die
  behobenen echten Fehler.

Stand: `tsc --noEmit` sauber, 75 Tests grün, Paritätssuite 32/32.

---
## Weisse Seite: der Proxy verschluckte Content-Encoding

Dein Hinweis „auch bei sofortigem Reload erscheint das Bild" hat die
Warteschlangen-Erklärung endgültig widerlegt — es geht nicht um Zeit. Die
**erste** Antwort ist unbrauchbar, die zweite nicht.

Der Unterschied zwischen beiden: Die erste kommt vom CDN durch den Proxy, die
zweite aus dem Plattencache. Und im Miss-Pfad wurden vom CDN nur `content-type`
und `content-length` gelesen — **`content-encoding` nicht.**

Node entpackt nichts von selbst. Liefert das CDN den Inhalt komprimiert, reicht
der Proxy die rohen Bytes durch und behauptet `Content-Type: image/jpeg`. Der
Browser sieht gültige Kopfzeilen, eine passende Länge, Status 200 — und kann
nichts damit anfangen. Weisses Fenster, ohne Fehlermeldung. Aus dem
Plattencache liegt danach das entpackt gespeicherte Bild, deshalb der sofortige
Erfolg beim Neuladen.

Nachgestellt:

```
ohne Weitergabe   Content-Encoding: (fehlt)  → Browser sieht gzip-Bytes als JPEG → weiss
mit  Weitergabe   Content-Encoding: gzip     → entpacktes JPEG
```

**Behoben:** `Content-Encoding` wird weitergereicht, wenn das CDN sie setzt.

### Zusätzlich: Längenabgleich

Wie viele Bytes tatsächlich beim Client ankommen, wird jetzt mitgezählt und mit
der angekündigten Länge verglichen. Weicht es ab, landet das im Log und im
Fehlerzähler:

```
[img-proxy] an den Client gingen 41230 von 72872 Bytes: https://…
```

Eine zu kurz gelieferte Antwort lässt den Browser auf den Rest warten — auch das
ergibt eine weisse Seite und war bisher unsichtbar.

### Probe erweitert

`/api/v1/admin/img-probe` zeigt jetzt auch `content_encoding`,
`content_length` und `transfer_encoding` je Variante. Damit ist auf einen Blick
zu sehen, ob das CDN komprimiert ausliefert.

Stand: `tsc --noEmit` sauber, 62 Tests grün, Paritätssuite 32/32.

---
## Rückbau: Pool zurück, Reparaturjob und Cache-Bereinigung raus

### Verbindungs-Pool wieder da — mit 32 statt 8

Die Obergrenze schützt den Server davor, bei einer Kachelwand beliebig viele
gleichzeitige TLS-Verbindungen zu öffnen. Bei 8 war sie zu eng; gemessen an 60
Kachel-Anfragen:

```
maxSockets 8    einzelnes Bild nach 1195 ms
maxSockets 32   einzelnes Bild nach  282 ms
ohne Grenze     einzelnes Bild nach  153 ms
```

Mit 32 laufen die 60 Bilder in zwei Wellen statt in acht. Entscheidend bleibt
`res.on('close')`: Ohne die Freigabe bei Abbruch belegten tote Anfragen ihren
Platz — das war der eigentliche Schaden der ersten Fassung, nicht die Grenze.

### Reparaturjob entfernt

Er beruhte auf der Annahme, die gespeicherten Bildadressen seien kaputt. Die war
falsch: Das CDN liefert für alle geprüften URLs 200. Restlos ausgebaut —
`jobs/imageRepair.ts`, Zeitplan-Eintrag, Monitoring-Eintrag, Icon, beide
Beschriftungen, die Tabelle `dead_images` samt dem Eintrag im Proxy. Ein Test
hält fest, dass nichts zurückbleibt.

### Start-Bereinigung des Bild-Caches entfernt

Auf deinen Wunsch — du löschst die Bilder beim Testen von Hand. Mit der
Längenprüfung beim Schreiben und den eindeutigen Temp-Dateien können ohnehin
keine beschädigten Dateien mehr entstehen; der Scan war eine Reparatur für
Altbestand, den es nach einmaligem Löschen nicht mehr gibt.

Damit entfällt auch der Marker `img_cache_scanned` in `global_settings`. Ein
vorhandener Eintrag stört nicht, kann aber weg:

```sql
DELETE FROM global_settings WHERE key = 'img_cache_scanned';
```

### Tests

`test/image-repair.test.js` ist durch `test/img-proxy.test.js` ersetzt. Die
Prüfungen zum Job sind entfallen, alle übrigen erhalten: eindeutige
Temp-Dateien, Vollständigkeitsprüfung, Reihenfolge der Streams,
Content-Type/-Length/-Encoding, Freigabe bei Abbruch, Pool-Breite, Fehlerzähler,
Diagnose-Endpunkte — plus die Kontrolle, dass der Job restlos weg ist.

Stand: `tsc --noEmit` sauber, 68 Tests grün, Paritätssuite 32/32,
`parts-summary` 6/6.

---
## Weisse Bilder bei Status 200: Komprimierung wird jetzt entpackt

Deine Beobachtung — Server meldet 200, Seite bleibt weiss, und die
Längenabgleich-Meldung fehlt im Log — passt genau zu einem komprimiert
durchgereichten Körper: Status stimmt, Länge stimmt, nur der Inhalt ist für den
Browser kein Bild.

Statt die Kopfzeile weiterzureichen (so stand es im letzten Paket) geht der
Proxy das jetzt an der Wurzel an:

**1. Unkomprimiert anfordern.** Beide Kopfzeilen-Sätze senden
`Accept-Encoding: identity`.

**2. Trotzdem Komprimiertes wird entpackt.** Nicht jedes CDN hält sich an
`identity`. Kommt `gzip`, `deflate` oder `br` zurück, läuft der Körper durch
`zlib`, bevor er zum Client und in den Cache geht. Die angekündigte Länge wird
dann entfernt, weil sie für den komprimierten Körper galt.

Entpacken statt Weiterreichen ist die robustere Wahl: Ein Reverse-Proxy
dazwischen kann die Kopfzeile entfernen oder den Körper anfassen — und im
Plattencache läge sonst komprimierter Inhalt, der beim nächsten Ausliefern
wieder die passenden Kopfzeilen bräuchte. So ist die gespeicherte Datei immer
ein echtes Bild, unabhängig von allem davor.

Beide Fälle durchgespielt:

```
CDN identity → Client: echtes JPEG | Cache: echtes JPEG
CDN gzip     → Client: echtes JPEG | Cache: echtes JPEG
```

Wird entpackt, steht das im Log:

```
[img-proxy] entpacke gzip: https://…
```

Die Längenabgleiche (Cache-Schreiben und gelieferte Bytes) gelten nur noch für
unentpackte Antworten — nach dem Entpacken wäre der Vergleich sinnlos.

Stand: `tsc --noEmit` sauber, 65 Tests grün, Paritätssuite 32/32 (ein Lauf war
rot, zweimal wiederholt grün — nicht reproduzierbar).

---
## Diagnose: was liefert der Proxy tatsächlich aus?

Stand der Fakten nach dieser Runde:

- CDN antwortet mit **200** auf alle drei Kopfzeilen-Varianten
- Proxy meldet **200**
- **Kein einziger Log-Eintrag** — weder Fehler noch `entpacke gzip`
- Browser zeigt trotzdem nichts

Das heisst: keine Komprimierung, keine Zeitüberschreitung, kein Verbindungsfehler,
keine Längenabweichung. Der Proxy tut aus seiner Sicht alles richtig. Damit sind
alle meine bisherigen Erklärungen widerlegt — auch die Komprimierungs-These.

Der einzige Blickwinkel, der bisher fehlte, ist der **Inhalt**. Die Probe
liefert jetzt `body_check`:

```json
"body_check": {
  "status": 200,
  "content_encoding": null,
  "first_bytes_hex": "ff d8 ff e0 00 10 4a 46 49 46 00 01 01 01 00 60",
  "looks_like": "JPEG"
}
```

Erkannt werden:

| Erste Bytes | Bedeutung |
|---|---|
| `ff d8 ff` | gültiger JPEG-Anfang |
| `89 50 4e 47` | gültiger PNG-Anfang |
| `1f 8b` | gzip — die Komprimierungs-These wäre doch richtig |
| `3c …` (`<`) | HTML statt Bild — das CDN liefert eine Seite |

Erkennungslogik gegen alle vier Fälle geprüft.

**Damit ist die Frage in einem Aufruf entschieden:**

- `looks_like: "JPEG"` → Der Server holt ein einwandfreies Bild. Dann liegt es
  **nicht** am Proxy, sondern zwischen Server und Browser (Reverse-Proxy) oder
  im Client. Nächster Schritt wäre, `imgUrl()` zu überbrücken und direkt vom CDN
  zu laden — das trennt die beiden endgültig.
- `looks_like: "gzip …"` → Komprimierung nach allem doch, und die Entpackung im
  neuen Build behebt es.
- `looks_like: "HTML/XML statt Bild"` → Das CDN liefert für diese URL eine
  Seite, kein Bild.

Stand: `tsc --noEmit` sauber, 52 Tests grün, Kompilat für alle geänderten
Dateien neuer als die Quelle (geprüft — `npm start` fährt `server.js`).

---
## Die Ursache: mein Abbruch-Handler schoss gesunde Übertragungen ab

`body_check` hat es entschieden:

```
first_bytes_hex: "ff d8 ff e0 00 10 4a 46 49 46 …"   → JFIF, ein einwandfreies JPEG
content_encoding: null                                → keine Komprimierung
```

Der Server holt also ein gültiges Bild. Trotzdem bleibt der Cache leer
(`original: null`) und der Browser zeigt nichts — **ohne einen einzigen
Log-Eintrag**. Genau eine Stelle im Code kann das erzeugen, und es ist die, die
ich zwei Runden zuvor eingebaut habe:

```js
res.on('close', () => {
  if (!res.writableFinished) { r.destroy(); activeReq?.destroy(); }
});
```

`!writableFinished` ist zu scharf. Je nachdem, was zwischen Server und Browser
sitzt, kann `close` feuern, **bevor** Node `writableFinished` gesetzt hat. Dann
wird eine völlig gesunde Übertragung mittendrin abgeschossen:

- Der Client hat die Kopfzeilen schon — daher **Status 200**
- Danach kommt nichts mehr — daher **weisse Seite**
- Der Cache-Stream läuft nie zu Ende — daher **`original: null`**
- Der Pfad protokollierte nichts — daher **stilles Log**

Alle vier Beobachtungen aus einer Zeile.

**Behoben:** Abgebrochen wird nur noch, wenn `res.destroyed` gesetzt ist — das
ist bei einer regulär beendeten Antwort false. Und der Fall wird protokolliert:

```
[img-proxy] Client hat abgebrochen, Verbindung freigegeben: https://…
```

Das stille Abschiessen war überhaupt erst möglich, weil dieser Pfad keine Spur
hinterliess.

**Einschränkung:** Lokal feuert `close` immer nach `finish`, der Fehler tritt
hier also nicht auf — ich konnte ihn nicht nachstellen. Die Änderung ist
begründet, nicht bewiesen. Falls die Bilder danach laden, war es das; falls
nicht, taucht jetzt wenigstens eine Log-Zeile auf, wenn abgebrochen wird.

Stand: `tsc --noEmit` sauber, 66 Tests grün, Paritätssuite 32/32, Kompilat
aktuell.

---
## Absicherung: mehrfache Schrägstriche im Pfad

Beim Nachgehen der weissen Seite ist mir aufgefallen, dass eine Anfrage an
`//api/img-proxy?…` die Route **nicht** trifft. Sie landet stattdessen im
SPA-Catch-all:

```
/api/img-proxy?url=x    → 200 application/json  {"treffer":"img-proxy"}
//api/img-proxy?url=x   → 200 text/html         <html><body></body></html>
```

Für ein `<img>` heisst das: Status 200, weisse Fläche, kein Log-Eintrag, kein
Cache-Schreiben. **Genau die vier Symptome**, die wie ein Proxy-Fehler aussehen
und keiner sind.

Eine Middleware zieht führende Schrägstriche jetzt zusammen, vor allen
Route-Registrierungen. Geprüft mit einem, zwei und drei Schrägstrichen — alle
treffen die Route.

**Zur Einordnung:** Deine Probe-URL war korrekt, dieser Fall erklärt sie also
nicht. Die Absicherung bleibt trotzdem drin: Sie kostet nichts und schliesst
eine Fehlerquelle aus, deren Symptome von einem echten Proxy-Fehler nicht zu
unterscheiden sind.

Stand: `tsc --noEmit` sauber, 45 Tests grün, Paritätssuite 32/32 (ein Lauf rot,
Wiederholung grün — nicht reproduzierbar).

---
## Aufgelöst: der Browser lieferte aus seinem eigenen Cache

Der entscheidende Satz stand im Netzwerk-Tab:

```
Status Code: 200 OK (from disk cache)
2 requests, 697 B transferred
```

**Die Anfrage erreichte den Server gar nicht.** Der Browser lieferte aus seinem
eigenen Plattencache — und zwar die kaputte Antwort aus der Zeit der echten
Fehler (abgeschnittene Cache-Dateien, mehrfach geschriebene Dateien, der
abgeschossene Stream). Alles daraus erklärt sich:

| Beobachtung | Grund |
|---|---|
| kein Log-Eintrag | die Anfrage kam nie an |
| `cache: original: null` | der Server sah sie nie |
| weisse Fläche | die gemerkte kaputte Antwort |
| Reload funktioniert | ein Reload umgeht den Plattencache |
| nur wenige Bilder betroffen | nur die, deren Antwort damals kaputt war |

Ursache der Dauerhaftigkeit war mein eigener Header:
`Cache-Control: public, max-age=86400` — ohne Rückfrage, also einen ganzen Tag.

### Geändert

- **Gestreamte Antworten** (Inhalt noch ungeprüft): `max-age=3600,
  must-revalidate` statt 86400. Wäre etwas faul, heilt es innerhalb einer Stunde
  statt eines Tages.
- **Antworten aus dem Plattencache** (Inhalt geprüft): weiterhin 86400, aber mit
  `must-revalidate` und einem **ETag** aus Dateigrösse und Änderungszeit. Der
  Browser kann billig rückfragen, statt blind auszuliefern.

### Was du jetzt tun musst

Die bereits gemerkten kaputten Antworten sitzen in **deinem Browser**, nicht auf
dem Server. Kein Deploy holt sie da raus:

- **Strg+Umschalt+R** auf der Seite, oder
- DevTools offen → „Disable cache" ankreuzen → einmal neu laden, oder
- Browserdaten für die Seite löschen

Danach sollten die verbliebenen Kacheln laden.

Stand: `tsc --noEmit` sauber, 68 Tests grün, Paritätssuite 32/32.

---
## Fix: Zustand beim Anlegen eines Sets wurde verworfen

Ein als „Gebraucht" erfasstes Set landete als „Neu" in der Datenbank.

`addSet()` nimmt den Zustand als sechsten Parameter — **beide Webapp-Routen
haben ihn nicht weitergereicht:**

| Route | Fehler |
|---|---|
| `POST /api/sets` | las `condition` gar nicht erst aus dem Body |
| `POST /api/sets/add-stream` | las ihn als `setCondition`, benutzte ihn aber nie |

Ohne den Parameter greift in `addSet()` der Standardzustand des Nutzers, also in
aller Regel „Neu". Die Android-API (`routes/api_v1/sets.ts`) übergab ihn korrekt
— nur die Webapp nicht.

Beide Aufrufe reichen ihn jetzt durch.

**Test.** `test/set-condition-aggregate.test.js` prüft klammerbewusst, dass
**jeder** `addSet`-Aufruf sechs Argumente übergibt, und dass `POST /api/sets`
den Zustand aus dem Body liest. Ein Aufruf mit fünf Argumenten schlägt damit
sofort rot — die Signatur allein hätte den Fehler nicht verhindert, weil der
sechste Parameter einen Vorgabewert hat und ein Weglassen deshalb erlaubt ist.

Stand: `tsc --noEmit` sauber, 60 Tests grün, Paritätssuite 32/32.

---
## Endlich die Ursache: die Minifiguren-Liste baute sich bei jeder Seite neu auf

Deine Log-Zeilen waren der Beweis — Dutzende davon:

```
[img-proxy] Client hat abgebrochen, Verbindung freigegeben: …
```

Die Abbrüche sind **echt**. Ein Browser bricht Bildanfragen ab, wenn die
`<img>`-Elemente aus dem DOM verschwinden. Und genau das passierte:

```js
// in loadMinifigsMore(), bei JEDER nachgeladenen Seite:
renderFigs(allFigsCache);     // ← ersetzt die KOMPLETTE Liste per innerHTML
```

Bei 780 Minifiguren und 60 pro Seite sind das 13 vollständige Neuaufbauten.
Jeder wirft alle bereits laufenden Bildanfragen weg. Bilder, die es nie über
eine Nachladerunde hinaus schafften, blieben leer — und weil die abgebrochene
Antwort im Browser-Cache landete, blieben sie es auch nach dem Fix.

Die Galerie macht es seit ihrer Umstellung richtig (`appendGallery`); bei den
Minifiguren war es liegen geblieben. Mein Fehler beim Übertragen des Musters.

**Behoben:** `appendFigs(batch)` rendert die neue Seite in einen losgelösten
Knoten und hängt nur deren Zeilen beziehungsweise Kacheln an die bestehende
Liste an. `renderFigs(list, target)` nimmt dafür ein optionales Ziel. Passt die
Struktur nicht (etwa nach einem leeren Zustand), wird einmalig neu gebaut.

Nachgestellt: Nach dem Anhängen sind alle drei Zeilen da, und das bestehende
`<img>`-Element ist **dasselbe Objekt** wie vorher — es gibt also nichts
abzubrechen.

**Damit schliesst sich die Kette:**

1. Die Liste baute sich bei jedem Nachladen neu auf → Bildanfragen brachen ab
2. Die abgebrochenen Antworten landeten mit `max-age=86400` im Browser-Cache
3. Von da an lieferte der Browser sie ohne Rückfrage aus — „200 from disk cache",
   kein Server-Log, kein Server-Cache, weisse Fläche

Punkt 2 und 3 sind seit der letzten Runde entschärft, Punkt 1 jetzt behoben.

Stand: `tsc --noEmit` sauber, 88 Tests grün, Paritätssuite 32/32.

---
## Minifiguren-Bilder werden lokal abgelegt — im bestehenden Job

### Warum die Minifiguren langsamer waren

Beide Bildarten liegen benutzerunabhängig, aber sie werden völlig
unterschiedlich ausgeliefert:

| | Set-Bilder | Minifiguren-Bilder (vorher) |
|---|---|---|
| Ort | `public/images/sets/<nr>.jpg` | `data/img_proxy_cache/<sha1-der-url>` |
| Schlüssel | Set-Nummer | URL |
| Auslieferung | **`express.static`** | **`/api/img-proxy`** |

Ein Set-Bild geht durch Express' statische Auslieferung mit `ETag`,
`Last-Modified` und `sendFile`. Ein Minifiguren-Bild durchlief jedes Mal die
Proxy-Route: Session auflösen, Cache-Datei suchen, Stream aufsetzen. Bei 60
Kacheln summiert sich das — und beim ersten Anzeigen kam je Bild ein
CDN-Roundtrip dazu.

### Was geändert wurde

Der Hintergrundlauf `img-dl-bg` lud bisher Set-Bilder, manuelle Teile und
**nur manuell erfasste** Minifiguren. Die Beschränkung `source='manual'` ist
weg: Jetzt werden alle Minifiguren ohne lokales Bild geholt.

`DISTINCT ON (fig_number)`, weil die Datei nach der Figur benannt und von allen
Nutzern geteilt wird — sie muss nur einmal geladen werden. Das anschliessende
`UPDATE` setzt `image_local` für **alle** Zeilen dieser Nummer, über Nutzer und
Quellen hinweg.

Gegen die Datenbank geprüft: Dieselbe Figur bei zwei Nutzern ergibt **einen**
Kandidaten, und ein Download setzt **beide** Zeilen.

### Kein neuer Job im Monitoring

Wie gewünscht in `imgDl` („📥 Bild-Download (CDN)") integriert, nicht daneben.
Der Eintrag zeigt jetzt einen echten Fortschritt (`n / gesamt geladen`, alle
zehn Bilder aktualisiert) statt nur „läuft". Die offene Menge in der
Monitoring-Übersicht zählt die Minifiguren des Bestands mit.

Ein Test hält fest, dass **kein** separater Job dafür entsteht.

### Was du erwarten kannst

Der erste Lauf holt alle fehlenden Bilder — bei deinem Bestand dauert das, der
Fortschritt ist im Monitoring sichtbar. Danach kommen die Kacheln über
`express.static` statt über den Proxy, also so schnell wie die Set-Bilder in der
Galerie. Der Hintergrundlauf startet 30 Sekunden nach dem Serverstart und
wiederholt sich stündlich.

Stand: `tsc --noEmit` sauber, 69 Tests grün, Paritätssuite 32/32.

---
## Papierkorb statt ✕ auf den Löschknöpfen

`TRASH_ICON_SVG` in `01-core.js`, verwendet in:

- **Set-Kachel** (`02-gallery.js`) — der rote Knopf oben rechts
- **Minifiguren-Kachel** und **-Tabellenzeile** (`06-minifigs.js`), jeweils nur
  bei manuell erfassten

Das Symbol zeichnet mit `stroke="currentColor"` statt fester Farbe. Damit dient
derselbe Pfad weiss auf rotem Grund (`.delbtn`) und rot auf hellem Grund
(`.bd`) — keine zweite Fassung nötig.

**Beschriftung ergänzt:** Ohne Text braucht ein Knopf eine für Hilfstechnik
lesbare Bezeichnung. `title` und `aria-label` kommen aus `detail.delete`
(bestand schon) und `figs.delete` (neu, DE und EN). Das SVG selbst ist
`aria-hidden`, damit es nicht doppelt vorgelesen wird.

`.delbtn svg` bekommt in `styles.css` eine feste Grösse von 14 px — die alte
`font-size`-Angabe wirkt auf ein SVG nicht.

**Bei den manuell erfassten Teilen gibt es auf der Kachel keinen Löschknopf** —
dort führt der Weg über die Detailansicht. Da war also nichts zu ersetzen; sag
Bescheid, falls du dort auch einen möchtest.

Stand: `tsc --noEmit` sauber, 75 Tests grün.

---
## Android: Minifiguren-Bilder nutzen jetzt die lokale Kopie

**Ja, eine Anpassung war nötig** — und ohne sie hätte die App von der
serverseitigen Änderung nichts gehabt.

Die Minifiguren-Ansicht der App lud ausschliesslich über `image_url`, also
direkt vom Rebrickable-CDN. Das Feld `image_local` kannte sie gar nicht: Weder
`Minifig` noch `FigValuationItem` hatten es im Modell. Sets und Teile machen es
längst richtig (`part.imageLocal != null -> "$serverUrl${part.imageLocal}"`).

Der Server liefert das Feld bereits (`getMinifigs` selektiert
`MAX(m.image_local)` und reicht es durch `resolveImageLocal`) — es kam nur nie
an.

**Geändert:**

- `Minifig` und `FigValuationItem` haben `@SerialName("image_local")`
- `MinifigCard` und `ManualFigTile` lösen in derselben Reihenfolge auf wie die
  Teile-Ansicht: lokale Kopie, dann relativer Pfad am Server, dann CDN
- `ManualFigTile` bekommt dafür `serverUrl` durchgereicht

**Test.** `MinifigImageFieldTest` (3 Fälle): `image_local` wird gelesen und hat
Vorrang, ohne den Wert bleibt die CDN-Adresse, und die Finanz-Minifiguren kennen
das Feld ebenfalls.

**Nebenbefund:** Weil die App ihre Minifiguren-Bilder direkt vom CDN geholt hat,
war sie von den ganzen Proxy-Problemen der letzten Runden nie betroffen.

**Ungeprüft wie immer** — kein Android-SDK. Klammerbilanz in allen drei
geänderten Dateien ausgeglichen, aber `./gradlew assembleDebug` bleibt nötig.

---
## Korrektur: `image_local` landete in der falschen Klasse

`MinifigsScreen.kt:232 — Unresolved reference 'imageLocal'`

Beim Einfügen habe ich auf `@SerialName("fig_name")` gezielt — und den ersten
Treffer erwischt. Der liegt in `AddMinifigResponse`, nicht in
`FigValuationItem`. `Minifig` hatte das Feld korrekt bekommen, deshalb schlug
nur die eine der beiden Verwendungsstellen fehl.

Behoben: Feld aus `AddMinifigResponse` entfernt, in `FigValuationItem`
eingefügt.

**Gegenprobe über alle Dateien:** Jede `.imageLocal`-Verwendung in `ui/` wurde
gegen den Typ der Variablen aufgelöst und geprüft, ob die zugehörige Klasse das
Feld führt. Klassen mit `image_local`: `SetItem`, `Part`, `PartValuationItem`,
`FigValuationItem`, `ValuationSet`, `Minifig`, `BarcodeResponse` — keine
Verwendung ohne Feld.

Das ist derselbe Fehler wie beim `finance.qty_avg`-Umbenennen in der Webapp:
ein zu unspezifisches Suchmuster mit `count=1`. Beim nächsten Mal nehme ich
mehr Kontext in die Suche.

---
## Fix: Kaufpreis eines gebrauchten Sets war der Neupreis

**Gemeldet:** Set als „Gebraucht" erfasst, Marktpreis gebraucht 33 CHF, neu
55 CHF — eingetragen wurden 55 CHF bei Zustand „Gebraucht".

Wird beim Erfassen kein Kaufpreis angegeben, trägt der Server den aktuellen
Marktpreis ein. `getCurrentMarketPrice()` nimmt den Zustand als dritten
Parameter — **drei Aufrufstellen haben ihn nicht übergeben:**

| Stelle | Wirkung |
|---|---|
| `addSet()`, Hauptpfad | neues Set: Neupreis statt Gebrauchtpreis |
| `addSet()`, Wiederhinzufügen | dasselbe beim erneuten Erfassen |
| `PUT /sets/:sn`, leerer Kaufpreis | dasselbe beim nachträglichen Leeren |

Ohne den Parameter fällt die Funktion auf den Standardzustand des Nutzers
zurück, also in aller Regel „Neu".

**Behoben:**

- Im Hauptpfad wird `effectiveCondition` jetzt **vor** der Preisermittlung
  bestimmt und mitgegeben — vorher stand die Zeile darunter.
- Der Wiederhinzufügen-Pfad reicht den gewählten Zustand durch.
- Der Update-Pfad ermittelt den Zustand der **letzten Erfassung** — genau die
  wird anschliessend aktualisiert.

Gegen die Datenbank geprüft (33/55 CHF wie in deinem Fall): Zustand `U` liefert
33.00, Zustand `N` liefert 55.00, ohne Zustand kam 55.00 — der gemeldete Fehler.

**Test.** `test/set-condition-aggregate.test.js`: **jeder**
`getCurrentMarketPrice`-Aufruf in `routes/sets.ts` muss drei Argumente haben,
`effectiveCondition` muss vor der Preisermittlung stehen, und der Update-Pfad
muss den Zustand der letzten Erfassung lesen. Wie beim `addSet`-Fix zuvor
greift der Compiler hier nicht: Der dritte Parameter hat einen Vorgabewert.

**Bestehende Sets sind nicht rückwirkend korrigiert.** Wo der falsche Preis
schon drinsteht, hilft nur: Kaufpreis im Detail-Dialog leeren und speichern —
dann wird er mit dem Zustand der Erfassung neu geholt.

Stand: `tsc --noEmit` sauber, 59 Tests grün, Paritätssuite 32/32.

---
## Nachtrag: warum das Durchreichen des Zustands wirkungslos blieb

Mein Fix der letzten Runde war richtig, aber unvollständig — der Zustand kam
zwar bei `getCurrentMarketPrice()` an und wurde dort auch zu `effectiveCond`
verrechnet. Nur benutzt hat ihn die Funktion nicht:

```js
const effectiveCond = condition || await getUserDefaultCondition(userId);
…
const v = await getSetValue(userId, setNumber, currency);   // ← ohne condition
if (v.unit_price !== null) return v.unit_price;             // ← kehrt hier zurück
// … effectiveCond wird erst DARUNTER benutzt — unerreichbar
```

`getSetValue()` entscheidet anhand der **Erfassungen**. Beim Anlegen eines neuen
Sets gibt es aber noch keine, und `sets.condition` ist ebenfalls noch nicht
geschrieben — die Funktion fiel auf `'N'` zurück und lieferte den Neupreis.
Der berechnete `effectiveCond` wurde nur im nie erreichten Rückfall darunter
verwendet.

**Behoben:** Ein ausdrücklich angefragter Zustand schlägt die
Erfassungs-Bewertung. `getSetValue()` greift nur noch, wenn **kein** Zustand
angefragt wurde — das ist der Anzeigefall, wo die Erfassungen tatsächlich die
richtige Grundlage sind.

Gegen die Datenbank geprüft, mit deinen Zahlen:

```
neues Set, Zustand U →  33   (vorher 55)
neues Set, Zustand N →  55
ohne Zustand         →  55   (Anzeigefall, Erfassungs-Bewertung)
```

**Test.** `getSetValue` muss innerhalb von `if (!condition)` liegen — ein
Zurückverschieben fällt damit sofort auf.

Stand: `tsc --noEmit` sauber, 75 Tests grün, Paritätssuite 32/32 (ein Lauf rot,
Wiederholung grün — nicht reproduzierbar).

---
## Löschknopf auf den Kacheln: dezent statt rot

`styles.css`, `themes/brick.css`

Im Ruhezustand jetzt neutral, beim Überfahren rot. Der Knopf erscheint ohnehin
erst beim Überfahren der Kachel (`.ca` mit `opacity:0`) — ein dauerhaft rotes
Feld zog den Blick stärker auf sich als das Set selbst. Rot bleibt der
Bestätigung vorbehalten: Sobald der Zeiger auf dem Knopf steht, zeigt er, was er
tut.

**Beide Designs brauchen eigene Werte** — das war der nicht offensichtliche
Teil:

| | Ruhezustand | Grund |
|---|---|---|
| Hell | weisser Grund, Rahmen `--bdr`, Symbol `--s500` | sitzt auf hellem Kachelkopf |
| Stein | weiss 14 % auf dem Deckel, Symbol weiss 85 % | sitzt auf der **dunkelblauen Noppenleiste** (`--b600`, 18 px) |

Im Stein-Design liegt der Knopf innerhalb der Noppenleiste — dort wäre das helle
Grau ein Fleck. Stattdessen ein heller Strich auf dem Deckel selbst.

Kontrast geprüft (Richtwert 3:1 für Symbole):

```
Hell:  #64748b auf Weiss              → 4.76
Stein: weiss 85 % auf --b600 #3d5a80  → 5.22
beide: Weiss auf --r500 (Hover)       → 3.76
```

Dazu ein `:focus-visible`-Ring — ohne den ist der Knopf beim Bedienen per
Tastatur unsichtbar. Rot kommt aus dem vorhandenen Token `--r500`, nicht als
Literal.

**Test.** Ruhezustand nicht rot, Hover rot, Fokusring vorhanden, eigene Fassung
für das Stein-Design, kein hartkodiertes `#ef4444`.

Stand: `tsc --noEmit` sauber, 51 Tests grün.

---
## Fix: QR-Code-Hinweis nannte 30 Minuten — er gilt 5

Gute Frage, der Text war an **drei** Stellen veraltet. Bei der
Sicherheitshärtung ganz zu Beginn wurde der QR-Login auf eine einmal
verwendbare Nonce mit `QR_TTL_MS = 5 * 60 * 1000` umgestellt — die Anzeige ist
nie mitgezogen:

| Stelle | Vorher |
|---|---|
| `i18n.js`, DE und EN | „Der Code ist 30 Minuten gültig" |
| `index.html` | derselbe Text als Vorgabe im Markup |
| `05-settings.js` | Countdown zählte von `1800` Sekunden herunter |

Der Zähler lief also 25 Minuten weiter, obwohl der Code längst ungültig war —
das ist die unangenehmere Hälfte: Wer nach zehn Minuten scannt, sieht „noch
20:00" und bekommt trotzdem eine Fehlermeldung.

**Behoben:** Der Countdown nimmt die Dauer aus `expires_in`, das
`/auth/qr-token` schon immer mitgeliefert hat — der Client hat es nur ignoriert.
Damit stimmt die Anzeige automatisch, falls die Dauer je wieder geändert wird.

Die Texte nennen jetzt 5 Minuten und zusätzlich, dass der Code **nur einmal**
verwendbar ist. Das war bisher nirgends erwähnt, ist aber seit derselben
Härtung so und erklärt eine Fehlermeldung, die sonst rätselhaft wäre.

**Test.** Liest `QR_TTL_MS` aus `routes/auth.ts` und prüft, dass kein
Hinweistext mehr 30 Minuten nennt, dass der Client die Dauer nicht fest
verdrahtet und dass beide Sprachen die tatsächliche Zahl enthalten. Ändert sich
die Dauer, fällt ein vergessener Text sofort auf.

Stand: `tsc --noEmit` sauber, 53 Tests grün.

---
## Android: Autofokus des Scanners — jetzt mit Test gegen die Rückkehr

Du schreibst, es passiert bei jeder Korrektur wieder. Der Code sah richtig aus
(`CONTROL_AF_MODE_CONTINUOUS_PICTURE` gesetzt, kein Fokus-Pump, sogar ein
„Nicht wieder einbauen" im Kommentar) — der Modus stand aber **nur am
Preview-Use-Case**.

CameraX führt die Konfigurationen aller gebundenen Use Cases zu **einem**
Repeating-Request zusammen. Steht `CONTROL_AF_MODE` nur an einem, entscheidet je
nach Gerät und CameraX-Fassung die andere Konfiguration mit — und die Vorgabe
von `ImageAnalysis` ist nicht zwingend `CONTINUOUS_PICTURE`. Auf solchen Geräten
bleibt das Bild unscharf, obwohl der Code stimmig aussieht.

Betroffen waren **beide** Kamera-Ansichten: `BarcodeScannerScreen` und
`SetupScreen` (QR-Code beim Einrichten). Das erklärt „in den verschiedenen
Orten".

**Behoben:** Der AF-Modus steht jetzt an Preview **und** ImageAnalysis. Damit ist
das Ergebnis unabhängig davon, welcher Use Case die Führung übernimmt.

### Gegen die Wiederkehr

`CameraFocusConfigTest` prüft beide Dateien:

- `CONTROL_AF_MODE_CONTINUOUS_PICTURE` muss **zweimal** vorkommen — einmal je
  Use Case. Wird eine Stelle beim Umbau vergessen, schlägt der Test fehl.
- Kein periodisches `startFocusAndMetering`: In den 240 Zeichen davor darf kein
  `delay(`, `Timer`, `scheduleAtFixedRate` oder `while (` stehen. Tap-to-Focus
  im Touch-Listener bleibt erlaubt, ein Pump nicht.

Beide Prüfungen laufen gegen die aktuellen Dateien durch — nachgestellt, weil
ich die Kotlin-Tests hier nicht ausführen kann.

**Ungeprüft wie immer:** kein Android-SDK. Klammerbilanz in beiden Dateien
ausgeglichen, `CaptureRequest`-Import und `ExperimentalCamera2Interop`-Opt-in in
beiden vorhanden und für die neue Stelle wirksam.

---
## Absicherung gegen die Rückkehr des Autofokus-Fehlers

Du hast gefragt, ob ich sicherstellen kann, dass ich das nicht wieder ändere.
**Versprechen kann ich es nicht** — ich habe zwischen Sitzungen keine
Erinnerung an dieses Gespräch. Was mich aufhält, muss im Projekt selbst stehen.
Drei Schichten, von innen nach aussen:

**1. Warnblock am Kopf beider Kamera-Dateien.** Wer die Datei öffnet, sieht als
Erstes, welche zwei Fehler hier schon mehrfach passiert sind und warum der Code
trotzdem richtig aussieht. Ausdrücklich mit dem Hinweis: bei Testfehlschlag den
Code korrigieren, nicht den Test.

**2. `CameraFocusConfigTest`.** Prüft beide Dateien auf genau zwei Vorkommen des
AF-Modus (einmal je Use Case) und auf das Fehlen eines periodischen
`startFocusAndMetering`. Die Fehlermeldung erklärt die Ursache mit.

Wichtig dabei: Der Test blendet Kommentare aus, bevor er zählt — sonst hätte der
neue Warnblock die Zählung selbst verfälscht. Genau dieser Fehler ist mir in
dieser Sitzung schon dreimal unterlaufen (bei `eval`, `r.pipe(res)` und
`addSet()`), deshalb diesmal direkt mitgedacht und nachgestellt: 2 Treffer je
Datei, kein Pump.

**3. `INVARIANTEN.md` im Projektwurzelverzeichnis.** Eine kurze Liste der Dinge,
die schon mehrfach kaputtgegangen sind, mit Datei, Test und Begründung. Der
Anlaufpunkt, wenn jemand — auch ich in einer neuen Sitzung — sich einen
Überblick verschafft.

Die Liste hat bewusst nur einen Eintrag. Sie ist für Fehler gedacht, die
**wiederholt** auftreten, nicht als Sammelstelle für alles.

**Was das nicht leistet:** Der Test läuft nur, wenn `./gradlew test` läuft. Wenn
du ihn in deine Build-Pipeline aufnimmst, greift die Absicherung automatisch —
ohne das bleibt sie ein Angebot.

---
## Fix: Zustand manuell erfasster Teile und Minifiguren

**Gemeldet:** Auf der Kachel eines manuell erfassten Teils steht „Neu", obwohl
alle Kaufpreise mit „Gebraucht" erfasst sind.

`getManualParts()` und `getManualMinifigs()` lasen ausschliesslich die
Stammtabelle. `parts.condition` beziehungsweise `minifigs.condition` bleibt beim
Anlegen auf dem Vorgabewert stehen — die Erfassungen wurden nie befragt. **Die
Minifiguren hatten denselben Fehler**, wie von dir vermutet.

**Neu:** `applyManualCondition()` leitet den Zustand aus den Erfassungen ab,
nach derselben Regel wie bei Sets. Eine Abfrage für die ganze Seite, nicht eine
je Zeile.

### Die Regel steht jetzt an genau einer Stelle

Beim Umsetzen schlug ein bestehender Test an: *„Die Regel steht 2× im Code."*
Er hatte recht — ich hatte sie in `applyManualCondition()` neu ausformuliert.

Sie liegt jetzt in `conditionFromAcquisitions(acqCount, usedCount, stored)` und
wird von Sets **und** manuellen Einträgen benutzt:

```
usedCount > 0 → 'U'      eine gebrauchte Erfassung genügt
acqCount  > 0 → 'N'      Erfassungen, aber keine gebrauchte
sonst         → stored   ohne Erfassungen der gespeicherte Wert
```

Der Test wurde entsprechend nachgezogen: Er prüft weiterhin auf genau ein
Vorkommen, blendet aber Kommentare aus — der Erklärtext am Helfer zitiert die
Regel selbst. Diese Falle ist mir in dieser Sitzung nun zum vierten Mal
begegnet.

Gegen die Datenbank geprüft:

```
Teil mit U-Erfassung   → U
Teil ohne Erfassung    → N   (gespeicherter Wert)
Figur mit U-Erfassung  → U
Teil mit U + N gemischt → U  (wie bei Sets)
```

**Test.** Gemeinsamer Helfer vorhanden, beide Listen wenden ihn an, keine zweite
Ausformulierung, und `used_count` wird überhaupt ermittelt.

Stand: `tsc --noEmit` sauber, 64 Tests grün, Paritätssuite 32/32.

---
## Fix: manuell erfasstes Teil ohne Kaufpreis

Zwei Lücken auf einmal:

**1. Es entstand gar keine Erfassung.** Beim Anlegen wurde der Kaufpreis nur in
die Stammtabelle `parts` geschrieben — keine Zeile in `part_acquisitions`.
Detailansicht und Zustandsregel arbeiten aber mit den Erfassungen, deshalb war
kein Kaufpreis zu sehen. Bei Sets legt `recordAcquisition()` diese Zeile an; für
Teile fehlte das Gegenstück.

**2. Der Marktpreis wurde ohne Zustand geholt.**
`getCurrentPartMarketPrice(part_number, color_id, uid)` — der vierte Parameter
blieb leer, also fiel die Funktion auf `resolvePartCondition()` zurück. Die
kennt beim Anlegen noch keine Erfassung und liefert den Standardzustand, meist
„Neu". Ein als gebraucht erfasstes Teil hätte den Neupreis bekommen. Dieselbe
Ursache wie zuvor bei den Sets — ich habe damals nur `routes/sets.ts`
durchgesehen.

**Behoben:** Der Zustand geht in die Preisermittlung, und beim Anlegen entsteht
eine Erfassung mit Preis, Menge und Zustand. Liefert BrickLink keinen Preis,
steht dort `NULL` statt `0` — sonst sähe es aus wie ein Kaufpreis von null
Franken.

Gegen die Datenbank geprüft (Neupreis 1.20, Gebrauchtpreis 0.40, erfasst als
gebraucht):

```
Stammsatz  : Kaufpreis 0.40, Zustand U
Erfassung  : angelegt — Preis 0.40, Zustand U, Menge 2
Kachel     : Zustand U
```

**Offen und bewusst nicht angefasst:** Manuell erfasste **Minifiguren** legen
vermutlich ebenfalls keine Erfassung an — die Stelle sieht gleich aus. Ich habe
es nicht geändert, weil ich es nicht mehr messen konnte; wenn dir dort dasselbe
auffällt, ist es dieselbe Handvoll Zeilen.

Stand: `tsc --noEmit` sauber, 49 Tests grün, Paritätssuite 32/32.

---
## Fix: manuell erfasste Minifiguren bekamen keinen Preis

Anders als bei den Teilen fehlte hier **nicht** die Erfassung — die legt
`addManualFig()` seit jeher an, und die Preislogik samt Teile-Schätzung war
ebenfalls vollständig. Reproduziert habe ich trotzdem genau dein Bild: Trotz
4.50 CHF im Preis-Cache blieben Stammsatz **und** Erfassung auf `null`.

**Ursache** in `getCurrentFigMarketPrice()`:

```js
if (blFigNumber) {                       // ← nur MIT separater BL-Nummer
  const priceData = await fetchMinifigPrice(blFigNumber, …);
  …
}
return await estimateFigPriceFromParts(figNumber, userId);
```

Der BrickLink-Abruf lief nur, wenn eine **abweichende** `bl_fig_number`
hinterlegt war. Bei einer manuell erfassten Figur ist das die Ausnahme — meist
stimmt die eigene Nummer (`sw0001` &c.) mit der BrickLink-Nummer überein. Der
Abruf wurde übersprungen, die Teile-Schätzung übernahm, und die liefert ohne
Teile-Zusammensetzung von Rebrickable nichts:

```
[minifig-price-estimate] sw0001: keine Teile-Zusammensetzung erhalten
Stammsatz : purchase_price null
```

**Behoben:** Es werden beide Nummern versucht — die hinterlegte BL-Nummer und
die eigene. Sind sie identisch, wird nicht doppelt gefragt. Die Reihenfolge ist
die von dir gewünschte: **BrickLink zuerst, die Schätzung über die Einzelteile
nur, wenn dort nichts zu holen ist.**

Nachher, mit 9.90 (neu) und 4.50 (gebraucht) im Cache, erfasst als gebraucht:

```
Stammsatz : 4.50 / U
Erfassung : 4.50 / U
```

**Test.** Beide Nummern werden versucht, der Abruf hängt nicht mehr an einer
separaten BL-Nummer, die Teile-Schätzung steht dahinter, und die Erfassung trägt
den tatsächlich verwendeten Preis.

Stand: `tsc --noEmit` sauber, 50 Tests grün, Paritätssuite 32/32.

---
## Fix: Zweiterfassung eines manuellen Teils ohne Kaufpreis-Eintrag

Dein Verdacht stimmte — es hängt zusammen, aber die Ursache lag noch eine Ebene
tiefer als die Erfassung, die ich zuletzt ergänzt hatte.

`addManualPart()` hat einen **frühen Ausstieg** für bereits vorhandene Teile:

```js
if (existing) {
  await db.run('UPDATE parts SET quantity = quantity + $1 …');
  return { action: 'updated', part_number };   // ← endet hier
}
```

Meine Erfassung aus der letzten Runde steht weiter unten und wurde bei einer
Zweiterfassung nie erreicht. Ergebnis: Menge stieg, aber kein Kaufpreis-Eintrag
und kein Erfassungsdatum. Der CSV-Import macht an derselben Stelle seit jeher
beides — nur die Einzelerfassung nicht.

**Behoben:**

- Der `existing`-Pfad legt jetzt ebenfalls eine Erfassung an, mit eigenem
  Kaufpreis (eingegeben oder Marktpreis für den gewählten Zustand) und eigenem
  Datum.
- `acquired_at` wird aus dem Body übernommen: `COALESCE($7::timestamptz, NOW())`.

Gegen die Datenbank geprüft — zweimal dasselbe Teil, verschiedene Daten:

```
Erfassungen: 2
  2026-01-15 | Menge 2 | Preis 1.20
  2026-06-20 | Menge 3 | Preis 1.20
Teil-Menge : 5
```

**Zwei eigene Fehler auf dem Weg dorthin**, beide gemessen und korrigiert: Meine
erste Fassung prüfte die Existenz **nach** dem INSERT und zählte die frisch
angelegte Zeile doppelt (7 statt 5). Und der Test verlangte nur **einen**
Erfassungs-Insert — er wäre grün geblieben, obwohl der zweite Pfad fehlte. Er
verlangt jetzt beide.

Stand: `tsc --noEmit` sauber, 36 Tests grün, Paritätssuite 32/32.

**Nicht geprüft:** ob der Client (`03-parts.js`) beim manuellen Erfassen
überhaupt ein `acquired_at` mitschickt. Der Server nimmt es jetzt entgegen —
fehlt das Feld im Formular, greift `NOW()` wie bisher.

---
## Löschknopf: sichtbares Symbol, Hover ohne Rot

Der Screenshot zeigt das Stein-Design, und dort war meine Fassung von vorhin zu
zurückhaltend: Symbol und Rahmen lagen bei 85 % beziehungsweise 28 % Deckkraft
auf der dunkelblauen Noppenleiste — das wirkte ausgewaschen statt dezent.

**Jetzt:**

| | Ruhezustand | Beim Überfahren |
|---|---|---|
| Stein | Symbol und Rahmen **volles Weiss**, Grund weiss 22 % (Noppen bleiben sichtbar) | weisser Grund, Symbol in `--b600` |
| Hell | Symbol `--s500`, weisser Grund, Rahmen `--bdr` | Grund `--s500`, Symbol weiss |

Beim Überfahren dreht sich also das Verhältnis um, statt auf Rot zu wechseln —
in beiden Designs dieselbe Farbwelt wie das Symbol selbst, wie von dir
gewünscht. Rot war ohnehin fragwürdig für einen Knopf, der erst noch einen
Bestätigungsdialog öffnet.

Kontrast in allen vier Zuständen geprüft:

```
Stein Ruhe : Weiss auf --b600   → 7.06
Stein Hover: --b600 auf Weiss   → 7.06
Hell  Ruhe : --s500 auf Weiss   → 4.76
Hell  Hover: Weiss auf --s500   → 4.76
```

Vorher lag der Ruhezustand im Stein-Design bei 5.22 — und das rechnerisch, mit
dem 85-%-Weiss als Volltonwert. Die tatsächlich wahrgenommene Deckkraft war
niedriger, was deinen Eindruck erklärt.

Der Fokusring nimmt ebenfalls `--s500` statt Rot.

Stand: `tsc --noEmit` sauber, 48 Tests grün.

---
## Fix: Zweiterfassung manueller Minifiguren — derselbe frühe Ausstieg

Du hattest recht, und ich hätte es in derselben Runde mitmachen sollen:
`addManualFig()` hat exakt denselben Aufbau wie `addManualPart()`.

```js
if (existing) {
  await db.run('UPDATE minifigs SET quantity = quantity + $1 …');
  return { action: 'updated', fig_number: num };   // ← endet hier
}
```

Die Erfassung weiter unten wurde bei einer zweiten Erfassung nie erreicht:
Menge stieg, aber kein Kaufpreis-Eintrag und kein abweichendes Datum.

**Behoben, analog zu den Teilen:**

- Der `existing`-Pfad legt eine Erfassung an und ermittelt den Preis über
  dieselbe Funktion wie die Erstanlage (`resolveManualFigPurchase`) — also
  inklusive BrickLink-Abruf und Teile-Schätzung als Rückfall.
- `acquired_at` wird übernommen, auf **beiden** Pfaden:
  `COALESCE($6::timestamptz, NOW())`.

Gegen die Datenbank geprüft — zweimal dieselbe Figur, verschiedene Daten:

```
Erfassungen: 2
  2026-02-10 | Menge 1 | Preis 4.50
  2026-07-05 | Menge 2 | Preis 4.50
Figur-Menge: 3
```

**Zur Einordnung:** Ich habe die Minifiguren beim Teile-Fix ausdrücklich als
offenen Punkt benannt, statt sie mitzumachen — das war zu vorsichtig. Die Stelle
war identisch, die Prüfung hätte zwei Minuten gedauert. Beim nächsten
Doppel-Muster dieser Art gehe ich beide Seiten gleich an und melde das Ergebnis,
statt eine Seite als Hausaufgabe zurückzugeben.

Stand: `tsc --noEmit` sauber, 53 Tests grün, Paritätssuite 32/32.

---
## Farbnamen im Teile-Reiter auf Deutsch

Rebrickable liefert Farbnamen ausschliesslich englisch. Sie stehen so in der
Datenbank und werden für BrickLink-Abfragen gebraucht — übersetzt wird deshalb
**nur die Anzeige**, die Daten bleiben unverändert.

### Wortschatz statt Farbliste

Eine Liste aller rund 200 Farben wäre unvollständig, sobald Rebrickable eine
neue aufnimmt. LEGO-Farbnamen sind aber zusammengesetzt, deshalb ein Wortschatz
aus Modifikatoren und Grundfarben: Jedes Wort wird einzeln übersetzt, unbekannte
bleiben englisch stehen.

Im Deutschen werden die Teile zusammengeschrieben — `COLOR_PREFIX_DE` hält fest,
welche Wörter sich an das folgende anschliessen:

```
Dark Bluish Gray    → Dunkelbläulichgrau
Bright Light Orange → Leuchthellorange
Trans-Neon Green    → Trans-Neongrün
Reddish Brown       → Rötlichbraun
Pearl Gold          → Perlgold
Vibrant Coral       → Vibrant Koralle   (unbekanntes Wort bleibt)
```

Bindestriche bleiben erhalten, bei englischer Spracheinstellung passiert nichts.

**Ein Detail, das leicht kaputtgeht:** Der Filterwert (`data-arg`) und der
Vergleich `activeColor === c.color_name` laufen weiter über den **englischen**
Namen. Würde man dort mitübersetzen, fände der Filter nichts mehr. Übersetzt
sind nur Beschriftung und Anzeige. Ein Test hält beides fest.

**Nicht angefasst:** Farbnamen in Katalog, Galerie-Detailansicht und CSV-Export.
Wenn sie dir dort auch auffallen, ist `colorName()` bereits vorhanden — es wäre
je Stelle ein Aufruf.

Stand: `tsc --noEmit` sauber, 60 Tests grün.

---
## E-Mails im Design der Webapp

Die Bestätigungs- und Passwort-Mails hatten fest verdrahtete Farben. Jetzt
richten sie sich nach dem eingestellten Design.

**Wie das Design in die Mail kommt:** `app_theme` ist eine **globale**
Einstellung in `global_settings` — der Mailer liest sie beim Versand. Damit
gilt automatisch das aktuelle Design, auch wenn es sich zwischen zwei Mails
geändert hat.

**Warum eine gespiegelte Palette:** E-Mails kennen keine CSS-Variablen und kein
externes Stylesheet — jeder Wert muss direkt im Markup stehen. `MAIL_THEMES` in
`routes/mailer.ts` spiegelt deshalb die Werte aus `styles.css` und
`themes/brick.css`:

| | classic | brick |
|---|---|---|
| Primärfarbe | `#2563eb` | `#3d5a80` (`--b600`) |
| Hintergrund | `#f1f5f9` | `#c9d5e2` (`--bg`) |
| Rahmen | `#e5e7eb` | `#b7cbe0` (`--b200`) |
| Eckenradius | 10px | 14px (`--rad`) |

Geprüft, dass beide Designs tatsächlich unterschiedliches HTML erzeugen und die
jeweilige Primärfarbe darin vorkommt.

`emailTemplate()`, `emailBtn()` und `infoBox()` nehmen die Palette entgegen und
fallen ohne Angabe auf `classic` zurück. Schlägt das Laden fehl, greift
ebenfalls `classic` — **eine E-Mail darf nie am Design scheitern.**

Das Ziegel-Logo im Kopfbereich bleibt rot: Es ist eine Marke, kein
Design-Element.

**Wichtige Einschränkung:** Die Palette ist eine **Kopie**. Änderst du eine
Farbe in `themes/brick.css`, zieht die E-Mail nicht automatisch nach — das lässt
sich ohne CSS-Variablen in E-Mails nicht vermeiden. `test/mail-theme.test.js`
hält wenigstens fest, dass es zwei unterscheidbare Paletten gibt und sie
angewendet werden; die konkreten Werte musst du bei einer Designänderung von
Hand abgleichen. Ein Kommentar an der Palette weist darauf hin.

Stand: `tsc --noEmit` sauber, 24 Tests grün.

---
