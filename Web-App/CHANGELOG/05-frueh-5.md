# Vor der Nummerierung, Teil 5

Teil der Fix-Historie — Übersicht in [CHANGELOG-fixes.md](../CHANGELOG-fixes.md).

---

## Der Befund: kein Android-Problem, sondern der Server erreicht Rebrickable nicht

Das Server-Log war der entscheidende Durchbruch — und zeigt etwas völlig
anderes als alles, was ich in den letzten Runden untersucht habe:

```
[img-proxy] Zeitüberschreitung nach 25 s: https://cdn.rebrickable.com/media/sets/115514-1.jpg
[img-proxy] Zeitüberschreitung nach 25 s: https://cdn.rebrickable.com/media/sets/122509-1.jpg
[img-proxy] Zeitüberschreitung nach 25 s: https://cdn.rebrickable.com/media/sets/200632602-1.jpg
```

**Mehrere völlig unterschiedliche Sets, alle exakt bis zur eingestellten
Zeitgrenze — ohne je eine Antwort, keine Fehlermeldung, kein TCP-Reset,
einfach nichts.** Das ist nicht Android. Der Server selbst kommt bei
**seinen eigenen** Anfragen an Rebrickables CDN nicht durch.

### Die wahrscheinlichste Ursache: IPv6

Dieses Muster — mehrere unabhängige Ziele, alle bis zur vollen Zeitgrenze
hängend, ohne Fehler — ist das klassische Bild einer kaputten oder nicht
gerouteten IPv6-Verbindung des Hosters:

1. Node löst `cdn.rebrickable.com` auf und bekommt sowohl eine IPv4- als
   auch eine IPv6-Adresse von Cloudflares Edge.
2. Ohne explizite Vorgabe versucht Node zuerst IPv6.
3. Ist die IPv6-Route des Hosters kaputt oder gar nicht vorhanden, hängt der
   Verbindungsaufbau **lautlos** — kein Fehler, keine Ablehnung, einfach
   keine Antwort.
4. Ohne funktionierendes Happy-Eyeballs-Verhalten (RFC 8305, paralleler
   IPv4/IPv6-Versuch mit dem saubereren Ergebnis) wartet Node bis der
   **eigene** Timeout zuschlägt — hier 25 Sekunden.

**Behoben:** `family: 4` an beiden Stellen, die Bilder von Rebrickable holen
— dem interaktiven Bild-Proxy (`server.ts`, `_cdnAgent`) und dem
Hintergrund-Download beim Import (`routes/sets.ts`,
`downloadSetImage()`). Rebrickable/Cloudflare unterstützen IPv4
zuverlässig; das Erzwingen kostet nichts, falls IPv6 ohnehin funktioniert,
und behebt das Hängen, falls nicht.

**Test.** Verlangt `family: 4` an beiden Fundstellen.

### Ehrlich zur Unsicherheit

Ich kann von hier aus nicht prüfen, ob der Server tatsächlich eine kaputte
IPv6-Route hat — das ist eine begründete, aber nicht bestätigte Diagnose.
Falls du selbst Zugriff auf den Server-Rechner hast, bestätigt dieser Befehl
es unabhängig von jeder Code-Änderung:

```
curl -v --max-time 10 -o /dev/null https://cdn.rebrickable.com/media/sets/115514-1.jpg
```

Hängt das schon hier, ist es zu 100 % eine Netzwerk-/Hosting-Frage, keine
Anwendungslogik. Läuft es hier sofort durch, war meine Diagnose falsch, und
ich brauche als Nächstes die Ausgabe genau dieses Befehls.

**Nicht angefasst:** Weitere Stellen im Code, die ebenfalls roh gegen
Rebrickable/BrickLink sprechen (CSV-Sync, Preisabfragen, Teile-Anreicherung
— rund ein Dutzend Fundstellen). Wenn sich der IPv6-Verdacht bestätigt,
wären die vom selben Fehler betroffen; ich habe mich bewusst auf die zwei
Stellen beschränkt, die das Log direkt belegt.

Stand: `tsc --noEmit` sauber, 50 Tests grün, Paritätssuite 32/32.

---
## Bestätigt und ausgeweitet: IPv4 an allen 18 Fundstellen erzwungen

Dein `curl` hat es zweifelsfrei bewiesen:

```
* IPv6: 2400:52e0:1e09::889:1
* Immediate connect fail for 2400:52e0:1e09::889:1: Network is unreachable
*   Trying 89.187.165.194:443...
< HTTP/2 200
```

Der Server hat **keine IPv6-Route** — nicht unzuverlässig, gar keine. `curl`
scheitert an IPv6 sofort und wechselt automatisch zu IPv4; ohne `family: 4`
tut Node das nicht zuverlässig selbst.

Damit war klar: Das betrifft **jede** ausgehende HTTPS-Verbindung dieses
Servers, nicht nur Bilder. Ich habe alle Fundstellen durchsucht und `family:
4` überall ergänzt, wo roh gegen einen externen Host gesprochen wird:

| Datei | Ziel | Stellen |
|---|---|---|
| `server.ts` | Rebrickable-CDN (Bild-Proxy) | 1 |
| `routes/sets.ts` | Rebrickable-CDN (Set-Bild-Download) | 1 |
| `jobs/partsCatalogEnrich.ts` | Rebrickable API + CDN | 3 |
| `jobs/backfillBlPartNumbers.ts` | Rebrickable API | 1 |
| `jobs/rebrickableCsvSync.ts` | Rebrickable CSV + API | 4 |
| `routes/brickset.ts` | Brickset API | 1 |
| `routes/parts.ts` | Rebrickable API | 2 |
| `routes/bricklink.ts` | BrickLink API | 1 |
| `routes/api_v1/admin.ts` | Diagnose-Sonde (img-probe) | 2 |
| `routes/api_v1/sets.ts` | Rebrickable + UPCitemdb (Barcode) | 2 |

18 Fundstellen insgesamt. Auch die Diagnose-Sonde selbst ist jetzt korrigiert
— sie hätte sonst weiterhin ein irreführendes Bild geliefert, da sie nicht
denselben Netzwerkpfad genommen hätte wie der echte Proxy.

**Test.** Zählt `family: 4` je Datei und verlangt die exakte erwartete Anzahl
— eine fehlende Stelle fiele damit sofort auf. Beim Schreiben ist mir dabei
noch einmal derselbe wiederkehrende Fehler passiert: Mein eigener
Erklärkommentar in `rebrickableCsvSync.ts` nennt „family: 4" als Text und
zählte in meiner ersten Fassung des Tests mit — korrigiert, die erwartete
Zahl schliesst diese eine Kommentarstelle jetzt bewusst ein.

Stand: `tsc --noEmit` sauber, 54 Tests grün, Paritätssuite 32/32.

Damit sollte nicht nur der Bild-Proxy zuverlässig laufen, sondern auch der
Rebrickable-CSV-Sync, die Teile-Anreicherung, die BrickLink-Preisabfragen und
die Barcode-Erkennung — alle nutzten bisher denselben kaputten Netzwerkpfad,
nur seltener bemerkt, weil sie nicht bei jedem Seitenaufruf sichtbar
scheitern.

---
## Einheitliches Bild-Verhalten: Vorschau über den Server, volle Auflösung direkt vom CDN — überall

Auf deinen Vorschlag hin vereinheitlicht — für Sets, Teile, Minifiguren und
Katalog, in Webapp **und** Android:

**Kacheln/Listen:** immer über den Server-Proxy mit Vorschaubild
(`imgUrl(thumbUrl(...), true)` in der Webapp, `resolveThumbUrl()` in
Android). Kleinere Antworten, profitiert vom serverseitigen
Existenz-Check auf `image_local`.

**Detail/Zoom:** volle Auflösung **direkt vom CDN**, ohne den Server-Proxy.
Das war für Sets in der Webapp schon immer so (`fullUrl()` ohne
`imgUrl()`-Umwicklung) — dein direkt geöffneter Link (< 1 Sekunde) zeigt
genau, warum: ein einmaliger Abruf ist über das eigene Netzwerk schneller
und belastet den Server gar nicht erst.

### Was fehlte

**Der Katalog der Webapp** lud bisher gar nicht über den Server — weder
Kachel noch Detail, beides roh im Browser. Jetzt: Kachel über den Proxy
(Vorschau), Detail direkt vom CDN — deckungsgleich mit Sets.

**Android liess auch die volle Auflösung über den Proxy laufen** — für Sets
UND Katalog. `resolveFullUrl()` gibt bei einer CDN-Adresse jetzt die rohe
URL unverändert zurück, das Gerät lädt direkt; die Browser-Kennung aus einer
früheren Runde (User-Agent, Referer) macht das zuverlässig.

Nachgestellt, beide Umgebungen, beide Fälle:

```
Webapp — Kachel, nur CDN : /api/img-proxy?url=…&thumb=1
Webapp — Detail, nur CDN : https://cdn.rebrickable.com/…        (direkt)
Android — Vorschau, CDN  : …/api/img-proxy?url=…&thumb=1
Android — Volle Aufl., CDN: https://cdn.rebrickable.com/…        (direkt)
```

**Ein Nebeneffekt, der zur eigentlichen Ursache passt:** Weniger
Proxy-Anfragen an unseren Server bedeuten weniger gebündelte CDN-Anfragen von
derselben Server-Adresse — genau die Stelle, an der die vermutete Drosselung
durch BunnyCDN ansetzen würde. Das behebt sie nicht direkt, senkt aber die
Häufigkeit, mit der sie überhaupt ausgelöst werden könnte.

**Test.** Vier Prüfungen: Webapp-Katalogkachel nutzt den Proxy mit
Vorschaubild, Webapp-Katalogdetail lädt direkt (kein `imgUrl()` um
`fullUrl()`), Androids `resolveFullUrl()` gibt CDN-Adressen unverändert
zurück, Androids Vorschau bleibt beim Proxy mit `&thumb=1`.

Stand: `tsc --noEmit` sauber, 26 Tests grün (Webapp). Android ungeprüft wie
immer, Klammerbilanz und Logik ausserhalb von Gradle nachgestellt.

---
## Katalog-Detail: Bild wird jetzt dauerhaft gespeichert, nicht nur zwischengecacht

Auf Wunsch umgesetzt: Beim ersten Öffnen eines Katalog-Sets wird das Bild
jetzt **heruntergeladen und dauerhaft unter `public/images/sets/` abgelegt**,
mit Vorschau — genau wie beim Hinzufügen eines Sets zum eigenen Bestand,
nicht mehr nur über den Bild-Proxy-Cache zwischengespeichert.

**Der Unterschied zu vorher:** Der Endpunkt prüfte nur, *ob* die Datei
zufällig schon existiert (weil irgendein anderer Nutzer das Set besitzt).
Existierte sie nicht, blieb es dabei — ein rein durchstöbertes Set griff bei
jedem erneuten Anschauen wieder aufs CDN zu (über den Proxy-Cache, der pro
angefragter URL lebt, nicht pro Set). Jetzt wird beim ersten Öffnen aktiv
heruntergeladen:

```js
if (!image_local && set.image_url) {
  const { downloadSetImage } = require('../sets');
  image_local = await downloadSetImage(set.image_url, set.set_number).catch(() => null);
  if (image_local) {
    const { generateThumb } = require('../thumbs');
    setImmediate(() => generateThumb(image_local).catch(() => {}));
  }
}
```

**Zwei Dinge dabei bewusst beachtet:**

`downloadSetImage()` ist dieselbe Funktion, die `addSet()` beim Hinzufügen
zum Bestand benutzt — sie prüft selbst zuerst, ob die Datei schon existiert
(idempotent), sodass ein späteres tatsächliches Hinzufügen desselben Sets
**keinen** zweiten CDN-Abruf mehr braucht.

Die Vorschau-Erzeugung liegt **nicht** innerhalb von `downloadSetImage()`
selbst — das habe ich beim Nachlesen von `addSet()` gesehen und beim ersten
Versuch übersehen. Ohne den separaten `generateThumb()`-Aufruf läge das Bild
zwar dauerhaft ab, bekäme aber nie eine `_thumb.jpg`-Variante, und jede
Kachel würde weiterhin die grosse Originaldatei laden.

**Nachgestellt** (da mein Testrechner kein `cdn.rebrickable.com` erreicht,
gegen einen lokalen Ersatzserver mit einem echten, gültigen JPEG):

```
Datei nach Download vorhanden : true (3145 Bytes)
generateThumb() Rückgabe      : /images/sets/…_thumb.jpg
Thumb-Datei vorhanden         : true (1709 Bytes, kleiner als das Original)
```

Da die Webapp (`thumbUrl()`/`fullUrl()`) und Android (`resolveThumbUrl()`/
`resolveFullUrl()`) `image_local` bereits bevorzugen, sobald es gesetzt ist,
war **keine** Client-Änderung nötig — beide greifen automatisch auf die neu
gespeicherte lokale Datei zu, sobald sie existiert.

**Bewusst nur im Detail-Dialog, nicht in der Liste:** Die Kachelliste zeigt
beim Scrollen potenziell hunderte Sets — ein Download pro Kachel würde den
Server stark belasten und genau die vermutete CDN-Drosselung provozieren, die
wir gerade zu vermeiden versuchen. Der Detail-Dialog ist ein bewusstes
Anschauen eines einzelnen Sets — hier ist genau ein zusätzlicher CDN-Abruf
gerechtfertigt, danach nie wieder.

**Test.** Fünf Prüfungen: Download wird angestossen, Vorschau wird separat
erzeugt, beides nur wenn noch keine lokale Datei existiert.

Stand: `tsc --noEmit` sauber, 27 Tests grün, Paritätssuite 32/32.

---
## Katalog-Liste baut jetzt auch beim Scrollen einen dauerhaften Cache auf

Auf Wunsch ergänzt: Nicht mehr nur der Detail-Dialog, sondern auch die
**Liste selbst** reiht fehlende Bilder zum Herunterladen ein — begrenzt und
im Hintergrund, damit genau das nicht wieder passiert, was zu den
ursprünglichen Zeitüberschreitungen geführt hat.

### Die Begrenzung ist der wichtige Teil

Eine Kachelwand kann bis zu 200 Sets ohne lokales Bild pro Seite enthalten.
Ohne Begrenzung würde ein schnelles Scrollen durch mehrere Seiten genau die
Anfragenflut an Rebrickables CDN erzeugen, die vermutlich die Drosselung
auslöst — also dasselbe Problem nochmal, nur diesmal selbst verursacht.

Deshalb dieselbe Bauart wie die bestehende Vorschau-Warteschlange
(`server.ts`, `queueThumb`/`drainThumbQueue`): eine strikt auf **zwei**
gleichzeitige Downloads begrenzte, deduplizierte Warteschlange.

```js
const CATALOG_DL_MAX_PARALLEL = 2;
const _catalogDlSeen = new Set<string>();   // kein Set zweimal einreihen

function queueCatalogImageDownload(setNumber, imageUrl) {
  if (!imageUrl || _catalogDlSeen.has(setNumber)) return;
  _catalogDlSeen.add(setNumber);
  _catalogDlQueue.push({ setNumber, imageUrl });
  drainCatalogDlQueue();
}
```

In der Liste eingehängt, ohne die Antwort zu verzögern:

```js
if (!exists) queueCatalogImageDownload(s.set_number, s.image_url);
```

**Nachgestellt:** 20 Sets gleichzeitig eingereiht, gegen einen künstlich
verzögerten lokalen Ersatzserver — höchstens **2** liefen tatsächlich
gleichzeitig, unabhängig davon, wie viele in der Warteschlange standen.

**Eine bewusste Vereinfachung:** `_catalogDlSeen` markiert ein Set dauerhaft
als „schon versucht" — auch nach einem Fehlschlag wird es nicht erneut
eingereiht, bis der Server neu startet. Das verhindert, dass ein Set ohne
Bild bei Rebrickable (ein echter, dauerhafter 404) bei jedem Scrollen erneut
angefragt wird — auf Kosten davon, dass ein einmaliger, echt transienter
Fehlschlag ebenfalls erst nach einem Neustart erneut versucht würde. Für eine
rein opportunistische Hintergrund-Anreicherung ist das der richtige
Kompromiss.

**Test.** Sechs Prüfungen: Begrenzung vorhanden, Deduplizierung vorhanden,
beide Funktionen existieren, die Liste reiht tatsächlich ein, und tut das
nicht blockierend.

Stand: `tsc --noEmit` sauber, 28 Tests grün, Paritätssuite 32/32.

Damit sollte sich der lokale Bild-Bestand mit jeder Katalog-Nutzung
langsam füllen — nicht schlagartig, aber stetig, und ohne die
Nebenläufigkeit zu erzeugen, die vermutlich die eigentliche Ursache der
Zeitüberschreitungen war.

---
## Detailbilder von Teilen und Minifiguren jetzt über das Backend

Auf Wunsch anders entschieden als bei Sets/Katalog: Dort läuft die volle
Auflösung bewusst direkt vom Gerät zum CDN (schneller, entlastet den
Server). Für **Teile und Minifiguren** soll auch das Detailbild durch das
Backend laufen — in Webapp **und** Android.

### Webapp

`data-orig` (speist den Zoom, `11-actions.js`) zeigte bei Teilen bisher auf
die rohe, unveränderte Adresse — bei einer CDN-Quelle lud der Zoom damit
direkt im Browser, am Server vorbei. Jetzt:

```js
data-orig="${escUrl(rawSrc ? imgUrl(fullUrl(rawSrc), false) : '')}"
```

`imgUrl(..., false)` wickelt eine CDN-Adresse in `/api/img-proxy?url=…` ohne
`&thumb=1` — volle Auflösung, aber über den Server.

**Minifiguren-Zoom war beim Nachprüfen bereits korrekt** — `imgSrc` dort ist
schon `imgUrl(thumbUrl(...), true)`, und `fullUrl()` darauf entfernt nur das
`&thumb=1`, das Ergebnis bleibt proxy-gewickelt. Keine Änderung nötig.

**Dabei eine echte, bisher unentdeckte Stelle gefunden:** Die manuell
erfassten **Teile**-Kacheln (`renderManualParts()` in `06-minifigs.js`)
zeigten das Bild komplett unverarbeitet — `p.image_local || p.image_url`
direkt als `<img src>`, ohne Vorschau, ohne Proxy, die einzige Stelle im
ganzen Projekt mit diesem Muster. Behoben, jetzt wie jede andere Kachel:

```js
const imgSrc = imgUrl(thumbUrl(p.image_local || p.image_url) || …, true);
```

### Android

Es gibt für Teile/Minifiguren keinen eigenen Zoom-Dialog wie bei Sets — der
Rückfall-Mechanismus der Kachel (`rememberTileImageWithFallback`) übernimmt
diese Rolle. Neuer Parameter `fullViaProxy`:

```kotlin
fun rememberTileImageWithFallback(
    serverUrl: String, imageLocal: String?, imageUrl: String?,
    fullViaProxy: Boolean = false   // Sets/Katalog: false (direkt), Teile/Minifiguren: true (Proxy)
): Pair<String?, () -> Unit>
```

Neue Funktion `resolveFullUrlViaProxy()` — wie `resolveFullUrl()`, aber
wickelt eine CDN-Adresse weiterhin in den Server-Proxy statt sie roh
zurückzugeben. `PartsScreen.kt` und `MinifigsScreen.kt` (je zwei Kacheln)
übergeben jetzt `fullViaProxy = true`; `GalleryScreen.kt`/`CatalogScreen.kt`
bleiben unverändert bei der Vorgabe `false`.

Nachgestellt:

```
Sets/Katalog-Rückfall (bypass) : https://cdn.rebrickable.com/…        (direkt)
Teile/Minifig-Rückfall (Proxy) : https://…/api/img-proxy?url=…        (über Server)
```

**Test.** Webapp: zwei Prüfungen (Teile-Zoom proxy-gewickelt, manuelle
Teile-Kachel korrigiert). Android: zwei Prüfungen (der neue Helfer wickelt
korrekt, und die Verwendungsstellen sind exakt auf die vier betroffenen
Kacheln beschränkt — Sets/Katalog bleiben unangetastet).

Stand: `tsc --noEmit` sauber, 46 Tests grün (Webapp). Android ungeprüft wie
immer, Klammerbilanz und Logik ausserhalb von Gradle nachgestellt.

---
## Nachtrag: ein zweiter, eigenständiger Detail-Dialog hatte dieselbe Lücke

Dein Hinweis „kommt weiterhin vom CDN" war berechtigt — mein vorheriger Fix
deckte nur den **Kachel-Zoom** ab (`03-parts.js`, `06-minifigs.js`). Es gibt
aber einen **zweiten, unabhängigen** Ort: den Kaufpreis-Detail-Dialog für
manuell erfasste Teile/Minifiguren (`man-detail-img` in `07-admin.js`,
geöffnet über „Kaufpreise bearbeiten"). Der hatte seine **eigene**
Bild-Anzeige, komplett getrennt vom Kachel-Code, die ich beim ersten
Durchgang übersehen habe:

```js
// vorher
const imgSrc = fullUrl(item.image_url || item.image_local || '');

// jetzt
const rawImgSrc = item.image_local || item.image_url || '';
const imgSrc = rawImgSrc ? imgUrl(fullUrl(rawImgSrc), false) : '';
```

`fullUrl()` allein wickelt eine CDN-Adresse nicht in den Proxy — nur
`imgUrl(..., false)` tut das (volle Auflösung, kein `&thumb=1`). Genau dieselbe
Korrektur wie beim Kachel-Zoom, nur an einer zweiten, unabhängigen Stelle
nachgezogen.

**Android brauchte hier keine Änderung.** Das dortige Gegenstück
(`ManualItemComposables.kt`, der Kaufpreis-Dialog) zeigt gar kein eigenes
Bild — es verlässt sich vollständig auf die Kachel im Hintergrund, die bereits
über `fullViaProxy = true` korrigiert ist. Die Webapp hatte hier schlicht
doppelten, unabhängigen Code für dieselbe Sache; Android nicht.

**Test.** Prüft, dass der Dialog jetzt `imgUrl(fullUrl(...), false)` benutzt
statt der alten, unproxierten Zuweisung.

Stand: `tsc --noEmit` sauber, 47 Tests grün (Webapp).

---
## Fix: Katalog-Timeouts beim Jahres-Filter, fehlende Vorschau im Katalog, und Android-Set-Detail zeigte Vorschau statt Original

Drei Punkte in dieser Runde — zwei aus deiner letzten Meldung fertiggestellt,
einer neu.

### 1. Datenbank-Timeouts beim Filtern nach Jahr

**Bestätigt und behoben.** Die Katalog-Liste prüfte für bis zu 200 Sets pro
Seite gleichzeitig per `fs.promises.access()`, ob ein lokales Bild existiert.
Das läuft über den libuv-Thread-Pool — standardmässig nur **4 Threads** — und
flutete ihn. Andere Pool-Arbeit, darunter TLS-Handshakes neuer
Datenbank-Verbindungen, wurde dadurch verzögert: genau die „timeout exceeded
when trying to connect"-Fehler aus deinem Log, ausgelöst durch eine grosse
Trefferzahl auf einmal (Jahres-Filter mit vielen Treffern).

### 2. Katalog zeigte immer die volle Auflösung, nie die Vorschau

**Bestätigt und behoben — dieselbe Code-Stelle wie oben.** Meine eigene
Existenzprüfung fragte nur nach der Originaldatei, nie nach `_thumb.jpg` —
anders als die längst bestehende, korrekte `resolveImageLocal()`.

**Eine gemeinsame Lösung für beides:** neue Funktion `resolveIfExists()` in
`utils/images.ts` — synchron statt asynchron, mit Cache (positive Treffer
bleiben dauerhaft gültig, negative werden nach 10 Minuten erneut geprüft),
bevorzugt korrekt die Vorschau.

```js
function resolveIfExists(publicRelPath) {
  const hit = _existsCache.get(publicRelPath);
  if (hit && (hit.exists || Date.now() - hit.checkedAt < 10*60*1000))
    return hit.exists ? resolveImageLocal(publicRelPath) : null;
  const exists = fs.existsSync(fsPath);
  _existsCache.set(publicRelPath, { exists, checkedAt: Date.now() });
  return exists ? resolveImageLocal(publicRelPath) : null;
}
```

Katalog-Liste UND -Detail benutzen sie jetzt beide. Nachgestellt:

```
nichts existiert : null
nur Original     : .../TEST-B-ONLY-ORIGINAL.jpg
Original+Vorschau: .../TEST-C-WITH-THUMB_thumb.jpg   ← Vorschau bevorzugt
Cache nach Löschen (hält weiterhin Treffer)
```

**Test.** Acht Prüfungen — drei ältere Tests aus der vorigen Runde mussten
dabei aktualisiert werden, da sie noch die jetzt ersetzte, fehlerhafte
Implementierung erwarteten (unter anderem ein Test, der ausdrücklich
„muss parallel laufen" verlangte — genau das Gegenteil des jetzigen, richtigen
Verhaltens).

### 3. Android: Set-Detail-Dialog zeigte die Vorschau statt der vollen Auflösung

Auf deine Nachfrage hin geprüft: Die Webapp zeigt im Set-Detail-Dialog
(`07-admin.js`, `m-img`) immer `fullUrl()` — die volle Auflösung, keine
Vorschau. Android benutzte für dasselbe Hauptbild `resolveThumbUrl()`. Mein
eigener Kommentar an der Stelle behauptete fälschlich, das entspräche der
Webapp — das habe ich beim Nachschlagen widerlegt und korrigiert.

```kotlin
// vorher
val imageUrl = resolveThumbUrl(serverUrl, set.imageLocal, set.imageUrl)

// jetzt — wie die Webapp
val imageUrl = resolveFullUrl(serverUrl, set.imageLocal, set.imageUrl)
```

`CatalogDetailScreen.kt` war beim Nachprüfen bereits korrekt (nutzt nur
`resolveFullUrl()`) — nur `SetDetailScreen.kt` hatte die Abweichung.

**Test.** Drei Prüfungen, gegen den tatsächlichen Code nachgerechnet.

Stand: `tsc --noEmit` sauber, 39 Tests grün (Webapp, Katalog/Diverses),
Paritätssuite 32/32. Android ungeprüft wie immer, Klammerbilanz geprüft.

**Noch offen, nicht in diesem Paket:** Der Hintergrund-Job für manuell
erfasste Teile (und vermutlich auch Minifiguren) in `server.ts` lädt Bilder
herunter, ruft danach aber nie `generateThumb()` auf — anders als beim
Herunterladen eines Sets. Das war in der letzten Antwort bereits gefunden,
aber noch nicht behoben; folgt in der nächsten Runde.

---
## Papierkorb-Symbol: von Anfang an weiss hinterlegt (Brick-Design)

Per Screenshot gemeldet: Beim Überfahren der Kachel erschien der Papierkorb
oben rechts nur schwach (`rgba(255,255,255,.22)` — 22 % Deckkraft), erst beim
direkten Überfahren des Knopfes selbst wurde er voll weiss.

```css
/* vorher */
[data-theme="brick"] .sc .delbtn{
  background:rgba(255,255,255,.22);border-color:rgba(255,255,255,.75);color:#fff;
}

/* jetzt — von Anfang an */
[data-theme="brick"] .sc .delbtn{
  background:#fff;border-color:#fff;color:var(--b600);
}
[data-theme="brick"] .sc .delbtn:hover{
  background:#fff;border-color:#fff;color:var(--r500);
}
```

Beide Zustände jetzt voll weiss hinterlegt; als zusätzliche Rückmeldung
färbt sich das Symbol beim direkten Überfahren rot (statt vorher: Grund
wechselt von durchscheinend auf weiss).

**Test.** Verlangt, dass der schwache Ruhezustand nicht mehr vorkommt und der
Knopf von Anfang an voll weiss hinterlegt ist.

Stand: `tsc --noEmit` sauber, 34 Tests grün.

---
## Fertiggestellt: fehlende Vorschau für Teile und Minifiguren im Hintergrund-Job

Der letzte offene Punkt aus der vorigen Runde. Der stündliche
Hintergrund-Job (`server.ts`, `img-dl-bg`) lud Bilder für manuell erfasste
Teile und für Minifiguren herunter und aktualisierte `image_local` — rief
danach aber **nie** `generateThumb()` auf. Bei Sets (derselbe Job,
`downloadSetImages()`) geschah das schon immer korrekt.

```js
// Teile-Schleife, jetzt ergänzt
for (const p of manualParts) {
  const local = await enrich.downloadImage(p.image_url, p.part_number, p.color_id || 0).catch(() => null);
  if (local) {
    await db.run(/* image_local setzen */).catch(() => {});
    const { generateThumb } = require('./routes/thumbs');
    generateThumb(local).catch(() => {});   // ← fehlte
  }
  await tick();
}
```

Dieselbe Ergänzung für die Minifiguren-Schleife direkt darunter.

**Warum das bisher nicht auffiel:** Es gibt einen separaten, einmaligen
Startup-Job ("Generate missing thumbnails"), der fehlende Vorschauen für
Sets und Teile nachträglich erzeugt — aber nur **beim nächsten
Server-Neustart**, nicht wenn ein Bild gerade frisch heruntergeladen wurde.
Bei einem lange laufenden Server ohne Neustart blieb die Lücke deshalb
dauerhaft sichtbar. Ausserdem deckt dieser Startup-Job **keine
Minifiguren** ab (nur `sets` und `parts`) — für Minifiguren gab es also gar
keinen Auffangmechanismus.

Nachgestellt, beide Namensmuster:

```
Teil-Vorschau (Muster: nummer_farbe.jpg)   : true
Minifigur-Vorschau (Muster: nummer_0.jpg)  : true
```

**Test.** Zwei Prüfungen — je Schleife, dass `generateThumb()` importiert
und nach einem erfolgreichen Download aufgerufen wird.

Stand: `tsc --noEmit` sauber, 58 Tests grün, Paritätssuite 32/32.

Damit sind beide aus der letzten Antwort offenen Punkte erledigt — dieses
Paket enthält den Katalog-Timeout-Fix, die Katalog-Vorschau-Korrektur, den
Android-Set-Detail-Fix, das Papierkorb-Styling und jetzt diese
Vorschau-Lücke, alle in einem Download.

---
## Finanztabelle: eine Zeile je Kaufpreis — und die Bewertung je Zustand

**Gemeldet.** Ein Set mit einem Kaufpreis für „Neu" und einem für „Gebraucht"
stand mit **einer** Zeile in der Tabelle, und die Bewertung nahm den
Gebrauchtpreis für **beide** Exemplare: `effectiveCondition()` gab `'U'`
zurück, sobald eine einzige Erfassung gebraucht war.

Wirkung: Wer ein neu gekauftes Exemplar besass und später ein zweites
gebraucht dazukaufte, sah die Sammlung schlagartig weniger wert — ohne dass
sich am Markt etwas geändert hätte.

**Wo die Regel jetzt steht.** Nicht in einer neuen Datei: `utils/setValue.ts`
enthielt die zustandsabhängige Bewertung bereits (`valueSet`, `priceFor` mit
dem Ausweichen auf den anderen Zustand). Dort sind lediglich
`valueAcquisitionRows()`, `weightedPurchase()` und `pnlPct()` dazugekommen.

Ich hatte zwischenzeitlich eine eigene `utils/acquisitionValue.ts` angelegt und
wieder verworfen — genau die Doppelung, an der in diesem Projekt schon die
Zustandsauflösung (fünf Fundorte) und die Preisverlauf-Route auseinandergelaufen
sind.

**`computeSetsValuation()`.** Holt Preise jetzt für die tatsächlich
vorkommenden Zustände statt für einen ausgerechneten Set-Zustand. Ein reines
Neu- oder Gebraucht-Set holt weiterhin genau einen Preis — die Zahl der
BrickLink-Abrufe steigt nur für gemischte Sets. Neu in der Antwort:

```
acquisitions: [ { id, condition, quantity, purchase_price,
                  avg_price, total_avg, pnl_pct, created_at } ],
conditions: ['N','U'], mixed: true
```

Die Set-Zeile bleibt vollständig (`avg_price`, `total_avg`, `purchase_price`),
damit bestehende Aufrufer unverändert funktionieren. Der Stückpreis ist der
mengengewichtete Schnitt — `avg_price × quantity` ergibt weiterhin **exakt**
die Summe der Einzelzeilen. Ein Test hält das fest; laufen die beiden Zahlen
auseinander, stehen in einer Tabelle zwei Wahrheiten.

**`computePnl()` mitgezogen.** Diese Antwort speist die Galerie-Kachel und den
Detail-Dialog. Sie rechnete ebenfalls mit einem Zustand fürs ganze Set — wäre
sie stehen geblieben, hätte die Kachel einen anderen Marktpreis gezeigt als der
Finanzen-Reiter. Kaufpreis und Menge kommen dort jetzt ebenfalls aus den
Erfassungen; `sets.purchase_price` ist nur noch Rückfall für Altbestände.

**Webapp.** `public/js/04-finance.js` erzeugt eine Zeile je Erfassung. Bild,
Nummer, Name und Jahr stehen in der ersten Zeile des Sets, die weiteren sind
eingerückt und tragen die Zustands-Plakette (`.cond-new`/`.cond-used`).
**Ohne** zusätzliche Summenzeile je Set: Die Einzelzeilen sind die Wahrheit,
die Gesamtsumme steht wie bisher im Tabellenfuss. Sets mit genau einer oder
ohne Erfassung sehen unverändert aus.

**Tests.** `test/set-value.test.js` um acht Prüfungen erweitert (Preis je
Zustand, Prozentangabe gegen den Kaufpreis der Zeile, Menge, Kaufpreis 0 vs.
nicht erfasst, Ausweichen auf den anderen Zustand, gewichteter Kaufpreis,
Zeilensumme = Set-Summe).

Drei bestehende Prüfungen bildeten die alte Codeform ab und wurden auf die neue
umgeschrieben — die geschützte Absicht ist dieselbe geblieben (der Marktpreis
darf nicht aus dem falschen Zustand stammen).

Stand: `tsc --noEmit` sauber, 302 Tests, 0 Fehler (4 übersprungen mangels
Postgres).

---
## Kacheln: eine Plakette je Zustand, Preis mengengewichtet

**Was falsch war.** `condition` ist ein Aggregat und liefert genau einen Wert
(„gebraucht, sobald eine Erfassung gebraucht ist"). Auf der Kachel war das zu
wenig: Wer ein Exemplar neu und eines gebraucht gekauft hatte, sah nur
„Gebraucht" — die Neu-Erfassung war unsichtbar, obwohl sie seit hardened-90 mit
ihrem eigenen Preis in die Bewertung eingeht.

**Die Regel** steht in `utils/handlers.ts` neben der bestehenden:
`conditionsFromAcquisitions()` liefert die Liste, `conditionFromAcquisitions()`
weiterhin den Einzelwert. Bewusst nebeneinander — sie müssen zusammenpassen,
und getrennt gepflegt sind sie in diesem Projekt schon einmal
auseinandergelaufen. Reihenfolge fest Neu vor Gebraucht: nach Häufigkeit
sortiert würden die Plaketten beim nächsten Kauf die Plätze tauschen.

`conditions` hängt jetzt an Sets (`getSets`, `getSetConditionAggregate` — sonst
verlöre die Kachel nach dem Speichern die zweite Plakette bis zum nächsten
Laden), an manuellen Teilen und Minifiguren (`applyManualCondition`) sowie an
den Bewertungsantworten.

**Preis und Veränderung.** Beides ist jetzt der mengengewichtete Durchschnitt:

* Sets-Kachel: `avg_purchase_price` statt `MAX(purchase_price)` — bei 2×100 und
  1×160 stand dort bisher 160 statt der tatsächlichen 120. Der Marktpreis und
  die Prozentangabe laufen seit hardened-90 über `computePnl()` und sind
  bereits gewichtet.
* Manuelle Teile und Minifiguren: `computePartsValuation()` und
  `computeMinifigsValuation()` holen einen Preis **je vorkommendem Zustand**
  und fassen ihn über `valueSet()` gewichtet zusammen — dieselbe Regel wie bei
  Sets. Vorher entschied ein einzelner Zustand über den Wert aller Exemplare.
  Kaufpreis und G&V ebenso, über `weightedPurchase()`.
  Ein Eintrag mit nur einem Zustand holt weiterhin genau einen Preis.

**Webapp.** `condBadges()` in `public/js/02-gallery.js` — eine Fassung für
Galerie-, Minifiguren- und Teile-Kacheln sowie die Finanzzeilen. Vorher stand
dieselbe Plakette viermal im Code, dreimal mit fest eingetragenen Farben statt
der Klassen `.cond-new`/`.cond-used`. Ein Test hält fest, dass keine Zeile eine
Zustands-Beschriftung zusammen mit einer eigenen Farbe trägt.

**Nebenbei.** `PNL_EPS` stand in `financeCalc.ts` und `setValue.ts` doppelt —
zwei Konstanten mit derselben Bedeutung driften irgendwann auseinander. Jetzt
importiert.

Stand: `tsc --noEmit` sauber, 308 Tests, 0 Fehler (4 übersprungen mangels
Postgres).

---
## Finanztabelle: zwei vollständige Zeilen statt eingerückter Unterposition

Die erste Fassung sparte in den Folgezeilen eines Sets Bild, Nummer, Name und
Jahr und rückte stattdessen mit „↳" ein. Das las sich wie die Aufschlüsselung
einer Summe darüber — die Zeilen sind aber gleichrangig: Jede steht für einen
eigenen Kauf mit eigenem Zustand, eigenem Marktpreis und eigener Entwicklung,
und eine Summe gibt es je Set gar nicht.

Jede Zeile ist jetzt vollständig. Zusammengehalten werden sie durch die
Zustands-Plakette am Namen, die ohnehin jede Zeile trägt; die Cache-Anzeige
(⚡/🔴) steht ebenfalls auf beiden, weil je Zustand ein eigener Preis geholt
wird.

Sets mit genau einer (oder ohne) Erfassung sehen unverändert aus.

Stand: 308 Tests, 0 Fehler (4 übersprungen mangels Postgres).

---
## Pro Tag und Zustand eine Erfassung — und Teile/Minifiguren je Kaufpreis

**Gemeldet.** Ein manuell erfasstes Teil, heute zweimal erfasst, stand im
Detail-Dialog zweimal untereinander: „×1 · Neu · CHF 0.60 · 9.8.2026". Richtig
ist eine Zeile mit Menge 2.

**Die Regel** liegt jetzt in `utils/acquisitions.ts`
(`recordAcquisitionForDay`) und gilt für Sets, manuelle Teile und Minifiguren
gleichermassen: Existiert für diesen Tag bereits eine Erfassung **im selben
Zustand**, wächst ihre Menge, statt dass eine zweite Zeile entsteht.

Der Zustand gehört in den Schlüssel: Ein neu und ein gebraucht gekauftes
Exemplar am selben Tag bleiben zwei Zeilen. Sie haben verschiedene Marktpreise
und verschiedene Entwicklungen und stehen seit hardened-90 in Tabelle und
Kachel bewusst getrennt — sie zu verschmelzen würde genau die Unterscheidung
zerstören, für die es die getrennte Bewertung gibt.

Beim Zusammenfassen trägt die Zeile **einen** Preis: Haben beide Käufe einen,
wird mengengewichtet gemittelt — dieselbe Rechnung, mit der die Zeilen später
ohnehin verdichtet werden.

**Was daran vorher schon halb da war.** Die Mengenänderung im Set-Dialog fasste
am selben Tag zusammen, die Datumsänderung wies einen zweiten Eintrag am selben
Tag ab — und die Anlege-Pfade schrieben munter eine zweite Zeile. Der
Anlege-Pfad konnte damit einen Zustand herstellen, den der Bearbeiten-Pfad
ablehnt. Alle zehn Schreibstellen (Anlegen, Zweiterfassung, Mengenerhöhung,
CSV-Import — je für Teile und Minifiguren, dazu `recordAcquisition` für Sets)
laufen jetzt über den einen Helfer; die handgeschriebenen `isToday_`-Prüfungen
sind weg.

Mitgezogen: Die Kollisionsprüfung beim Ändern des Kaufdatums berücksichtigt
jetzt ebenfalls den Zustand.

**Finanzen-Reiter.** `computePartsValuation()` und `computeMinifigsValuation()`
liefern `acquisitions[]` wie die Sets, und die beiden Tabellen zeigen eine
vollständige Zeile je Kaufpreis mit Zustands-Plakette, Erfassungsdatum,
Marktpreis dieses Zustands und eigener Entwicklung. Die vierte Spalte war
bisher ein reiner Platzhalter für die Spaltenbreite und trägt jetzt dasselbe
wie in der Sets-Tabelle: das Erfassungsdatum.

**Tests.** Drei neue in `test/manual-acq-refresh.test.js` (Tagesregel samt
Zustand im Schlüssel, kein direktes `INSERT INTO *_acquisitions` mehr in den
Routen, Zeilen je Kaufpreis in allen drei Bewertungen). Vier bestehende
Prüfungen bildeten die alte Schreibform ab und sind auf den Helfer
umgeschrieben — die geschützte Absicht ist dieselbe geblieben.

**Nicht angefasst:** `adjustAcquisitionsToQuantity()` in `routes/sets.ts` fasst
weiterhin nach Tag *ohne* Zustand zusammen. Für Sets mit gemischten Erfassungen
kann eine Mengenerhöhung damit auf der falschen Zeile landen. Das ist älter als
diese Änderung und gehört in einen eigenen Durchgang — sag Bescheid, wenn ich
es gleich mitnehmen soll.

Stand: `tsc --noEmit` sauber, 311 Tests, 0 Fehler (4 übersprungen mangels
Postgres).

---
## Korrektur: pro Tag EINE Erfassung — ohne Zustand im Schlüssel

Die Fassung aus hardened-93 hatte den Zustand im Tagesschlüssel: Ein neu und
ein gebraucht gekaufter Eintrag am selben Tag blieben zwei Zeilen. Das war
falsch gedacht — die Datums-Endpunkte für Sets, Teile und Minifiguren weisen
einen zweiten Eintrag am selben Tag ohnehin alle drei ab, ohne den Zustand
anzusehen. Anlegen und Bearbeiten hätten damit weiterhin verschiedene Regeln
gehabt, nur an einer anderen Stelle als vorher.

Der Schlüssel ist jetzt Eintrag + Tag. Trifft am selben Tag ein Kauf im anderen
Zustand ein, wächst dieselbe Zeile, und ihr Zustand wird nach der Regel des
Projekts aufgelöst: **„gebraucht" gewinnt**, sobald einer der beiden Käufe
gebraucht war (dieselbe Regel wie `conditionFromAcquisitions` in
`utils/handlers.ts`). Der Preis bleibt der mengengewichtete Schnitt.

Die Kollisionsprüfung in `routes/sets.ts` ist damit wieder die alte (Tag ohne
Zustand) und stimmt mit `routes/parts.ts` und `routes/minifigs.ts` überein. Ein
Test hält jetzt fest, dass alle drei dieselbe Prüfung haben.

**Altbestand.** Die Regel greift erst beim nächsten Schreiben — bestehende
Doppelzeilen verschwinden nicht von selbst. `db/migrations/0004-erfassung-pro-tag.sql`
fasst sie einmalig zusammen, für alle drei Tabellen: Menge summiert, Preis
mengengewichtet über die Zeilen mit Preis, Zustand „gebraucht" sobald eine
gebraucht war, Zeitstempel der früheste des Tages; behalten wird die Zeile mit
der kleinsten id.

Der Lauf ist verlustbehaftet — zwei Zustände am selben Tag werden zu einem. Das
ist die Vorgabe; ohne diesen Schritt bliebe der Bestand in einem Zustand, den
der Code nicht mehr erzeugen kann. Käufe an verschiedenen Tagen werden nicht
angefasst.

**Keine Datenbank-Sperre.** Ein UNIQUE-Index auf `(user_id, …, created_at::date)`
ginge nicht: `timestamptz::date` hängt von der Zeitzone der Sitzung ab und ist
damit nicht IMMUTABLE, also nicht indizierbar. Die Regel hängt deshalb daran,
dass `recordAcquisitionForDay()` der einzige Schreibweg bleibt — ein Test hält
fest, dass keine Route mehr direkt in eine `*_acquisitions`-Tabelle schreibt.

Stand: `tsc --noEmit` sauber, 312 Tests, 0 Fehler (4 übersprungen mangels
Postgres). Die Migration selbst konnte ich hier nicht laufen lassen.

---
## Minifiguren ohne BrickLink-Nummer: Teile-Schätzung je Zustand

`estimateFigPriceFromParts()` lief fest mit `DEFAULT_PRICE_CONDITION` und
lieferte damit **einen** Wert, egal ob die Figur neu oder gebraucht geführt
wird.

Das Ärgerliche daran: Für Figuren MIT BrickLink-Nummer war der Zustand längst
berücksichtigt (`fetchMinifigPrice` fragt je Zustand ab). Durchgefallen ist
genau der Fall, in dem die Schätzung überhaupt greift — die Figur ohne Nummer,
bei der sie der einzige Preis ist, den es gibt. Eine gebraucht erfasste Figur
bekam den Neupreis ihrer Teile, und seit der Bewertung je Erfassung zeigten
zwei Zeilen mit verschiedenen Zuständen denselben Marktpreis.

Die Teilepreise kennen den Zustand ohnehin: `fetchPartPrice()` fragt BrickLink
je Zustand ab und fällt bei leerem Price Guide auf den anderen zurück. Er
musste nur durchgereicht werden — die Funktion nimmt jetzt einen dritten
Parameter.

Beide Aufrufer geben ihn mit:

* `getCurrentFigMarketPrice()` reicht den bereits ermittelten `effCond` weiter
  (eine Gebraucht-Erfassung genügt → `'U'`, sonst `'N'`, ohne Erfassungen der
  User-Default). Damit stimmen auch alle indirekten Aufrufer — Anlegen,
  CSV-Import, Mengenerhöhung, Kaufpreis-Nachtrag — ohne eigene Änderung.
* `computeMinifigsValuation()` ruft je vorkommendem Zustand einmal auf.

**Kosten.** Eine Figur mit Erfassungen in beiden Zuständen und ohne
BrickLink-Nummer bepreist ihre Teile zweimal. Der Teile-Preiscache greift je
Zustand, der zweite Durchlauf holt also nur, was noch nicht dasteht. Figuren mit
nur einem Zustand — der Normalfall — kosten unverändert einen Durchlauf.

**Test.** Erweitert um: der ermittelte Zustand geht in die Schätzung, die
Teilepreise werden damit geholt, kein fester Standardzustand mehr in der
Funktion, und die Bewertung ruft je Zustand auf.

Stand: `tsc --noEmit` sauber, 312 Tests, 0 Fehler (4 übersprungen mangels
Postgres).

---
## Preisverlauf für Teile und Minifiguren auch in der Android-API

Beide Verlaufs-Routen gab es nur für die Webapp — in `api-inventory.test.js`
ausdrücklich als `nur-web` geführt. Der Detail-Dialog der App zeigte deshalb
weder Marktpreis je Zustand noch ein Diagramm; es fehlte nicht die Aufteilung,
sondern die Zeile überhaupt.

**Erst zusammengeführt, dann ausgeliefert.** Die Logik stand vollständig in
`routes/finance.ts`. Sie einfach ein zweites Mal nach `routes/api_v1/` zu
kopieren wäre genau das Muster, an dem der Set-Verlauf schon einmal
auseinandergelaufen ist (zwei Fassungen, unterschiedliche Zustandsauflösung,
„−32 %" bei unverändertem Preis). Sie liegt jetzt in `utils/priceHistory.ts`
neben der Set-Fassung:

* `getPartPriceHistory(uid, partNumber, colorId, currency)`
* `getMinifigPriceHistory(uid, figNumber, currency)`
* `conditionRows()` von dort mitgezogen

Beide Arten teilen sich intern `manualPriceHistory()` — die vier Routen
(zweimal Webapp, zweimal `/api/v1`) sind dünne Adapter.

**Neu:** `GET /api/v1/parts/:partNumber/:colorId/price-history` und
`GET /api/v1/minifigs/:figNumber/price-history`. Die Teile-Route steht ganz
unten in der Datei: Express probiert der Reihe nach, und ein Muster mit zwei
Platzhaltern würde sonst auch auf feste Pfade passen.

**Parität.** Beide Paare in `api-inventory.test.js` auf `paritaet` umgestellt
und in `api-parity.test.js` geprüft — Feld für Feld, nicht nur „ähnlich".

Dabei aufgefallen: Die bestehende Set-Paritätsprüfung las noch `v1.history`,
das Feld gibt es seit hardened-89 nicht mehr. Sie lief seither ins Leere und
fiel nur nicht auf, weil sie ohne Postgres übersprungen wird. Sie vergleicht
jetzt `history_new`, `history_used`, `by_condition` und `chart`.

Stand: `tsc --noEmit` sauber, 312 Tests, 0 Fehler (4 übersprungen mangels
Postgres) — die beiden neuen Paritätsprüfungen sind darin ebenfalls
übersprungen.

---
## Finanztabelle: Detail-Dialog auch für Teile und Minifiguren

Die Set-Zeilen öffnen den Detail-Dialog (`openModal`); die Zeilen manueller
Teile und Minifiguren waren die einzigen in dieser Tabelle, die auf einen Klick
nicht reagierten. Sie tragen jetzt dieselben `data-click`-Angaben wie die
Kacheln im jeweiligen Reiter (`openManDetail`).

**Dabei einen stillen Fehler gefunden.** `openManDetail()` las den Eintrag aus
`manualPartsCache` / `manualFigsCache` — und die füllen die Reiter Teile und
Minifiguren. Aus der Finanztabelle heraus ist der passende Reiter oft nie
geöffnet worden; dann war der Eintrag nicht im Cache, und die Funktion stieg
mit `if (!item) return;` aus. Der Dialog wäre also gar nicht aufgegangen, ohne
Meldung, ohne Spur in der Konsole. Fehlt der Eintrag, wird die jeweilige Liste
jetzt einmal nachgeladen und erneut gesucht.

**Test angepasst, nicht umgangen:** Die Prüfung „Detail-Dialog lädt Bilder über
den Proxy" schnitt 1300 Zeichen ab `G('man-detail-img')` heraus. Der
Nachladepfad hat die geprüfte Zuweisung aus diesem Fenster geschoben — das
Fenster ist jetzt grosszügiger. Ein knapp bemessener Ausschnitt macht die
Prüfung von jeder Zeile abhängig, die jemand dazwischen einfügt, und meldet
dann einen Fehler, den es nicht gibt.

Stand: 312 Tests, 0 Fehler (4 übersprungen mangels Postgres).

---
## Minifiguren ohne BrickLink-Nummer: geschätzter Preis wurde nirgends abgelegt

**Gemeldet** (Screenshot, `fig-015788` „Anthony", BrickLink-Nr. leer): Im
Detail-Dialog standen bei „Marktpreis (Neu)" und „Marktpreis (Gebraucht)" nur
Striche, der Preisverlauf meldete „Noch keine Verlaufsdaten" — obwohl in beiden
Zuständen ein Kaufpreis erfasst war.

**Ursache.** Für Figuren ohne BrickLink-Nummer kommt der Marktpreis aus
`estimateFigPriceFromParts()`. Die Funktion rechnete bei jedem Aufruf frisch
und legte das Ergebnis **nirgends** ab. Marktpreis-Zeile und Diagramm lesen
aber `minifig_price_cache` bzw. `minifig_price_history` (über
`utils/priceHistory.ts`) — und für genau diese Figuren blieb dort für immer
alles leer.

Ein echter BrickLink-Abruf schreibt beide Tabellen seit jeher
(`fetchMinifigPrice`). Der Schätzpfad war der einzige, der es nicht tat: Die
Zahl existierte nur so lange, wie die Bewertung lief.

Er schreibt jetzt dieselben zwei Tabellen — je Zustand einen Eintrag, nur bei
mindestens einem bepreisten Teil (ein Nullpunkt sähe im Diagramm aus wie ein
Kurssturz). Beide Tabellen sind benutzerunabhängig, was passt: Die Schätzung
stammt aus BrickLink-Teilepreisen, nicht aus dem Bestand. Nur die Währung kommt
aus den Nutzereinstellungen und steht deshalb im Schlüssel.

**Sichtbar wird es nach dem nächsten Bewertungslauf** — beim Öffnen der Reiter
Minifiguren oder Finanzen. Der Dialog selbst holt keine Preise, er zeigt nur,
was abgelegt ist.

**Falls die Striche bleiben:** Dann liefert die Schätzung selbst nichts, weil
Rebrickable für die Figur keine Teile-Zusammensetzung kennt oder kein Teil
einen Preis hat. Die Logzeile sagt, welcher Fall vorliegt:
`[minifig-price-estimate] fig-015788 (N): 0/7 Teile bepreist, geschätzt=—`.

Stand: `tsc --noEmit` sauber, 313 Tests, 0 Fehler (4 übersprungen mangels
Postgres).

---
## Anmelden mit E-Mail-Adresse ging nicht — obwohl es überall so steht

**Gemeldet.** Wer im Login-Feld seine E-Mail-Adresse eintippte, bekam
„Benutzername darf nur Buchstaben, Zahlen und _.- enthalten (3–32 Zeichen)."

Über dem Feld steht „Benutzername oder E-Mail", und die Abfrage sucht auch in
beiden Spalten (`LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)`).
Dazwischen sass ein Wächter, der **nur** das Benutzernamen-Muster zuliess: Das
`@` fällt durch, und ein 3-Zeichen-Minimum passt zu Adressen ohnehin nicht. Die
Anmeldung per E-Mail war damit seit jeher unmöglich — die Abfrage dahinter kam
nie zum Zug.

**Der Wächter bleibt**, er kennt jetzt beide Formen: `isValidLoginIdentifier()`
in `utils/auth.ts` akzeptiert das Benutzernamen-Muster **oder** eine
E-Mail-Adresse. Ganz weglassen wäre falsch — er hält Unsinn von der Abfrage und
vom Brute-Force-Zähler fern, der je Kombination aus IP und Anmeldename zählt.

Die Meldung heisst jetzt „Bitte Benutzername oder E-Mail-Adresse eingeben." Die
alte sprach von erlaubten Zeichen im Benutzernamen und schickte damit in die
falsche Richtung.

**Beide Login-Wege**, Webapp und `/api/v1` (Android), benutzen denselben
Prüfer. Ein Test hält fest, dass keiner von beiden eine eigene Kopie des
Musters zurückbekommt — sonst funktionierte die Anmeldung per E-Mail nur auf
einem der beiden Wegen.

**Registrieren und Profil-Update bleiben beim Benutzernamen-Muster.** Sonst
könnte jemand die E-Mail-Adresse eines anderen als Benutzernamen eintragen und
dessen Anmeldung an sich ziehen — der Login sucht ja in beiden Spalten. Auch
das hält ein Test fest.

**Nebenbei:** Die E-Mail-Regex stand dreimal wortgleich im Projekt; die
Registrierung benutzt jetzt `EMAIL_RE` und `USERNAME_RE` aus `utils/auth.ts`.

Stand: `tsc --noEmit` sauber, 317 Tests, 0 Fehler (4 übersprungen mangels
Postgres).

---
## Haushalt, Durchgang 1: Konten verknüpfen

Fundament für die Familiensicht. Diese Runde bringt Verknüpfung, Regeln und
Einstellungsseite — die zusammengefassten Ansichten kommen in Durchgang 2.

**Ablauf.** Das Hauptkonto erzeugt in den Einstellungen einen Einladungscode,
das andere Konto gibt ihn in **seinen** Einstellungen ein. Damit haben beide
Seiten zugestimmt: der eine durch Erzeugen, der andere durch Einlösen. Eine
Verknüpfung ohne Zutun der Gegenseite gibt es nicht.

**`utils/household.ts` ist die eine Stelle**, an der „wessen Daten?"
beantwortet wird — `resolveHousehold()` liefert das Blickfeld, alles Weitere
baut darauf auf. Die Routen fragen den Helfer und nie selbst `account_links`
ab; ein Test hält das fest. Bei der Zustandsauflösung ist genau diese Streuung
schon einmal passiert (fünf Fundorte, leicht verschieden).

**Die Grenzen** stecken im Helfer, nicht in den Routen:

* **Eine Stufe, beide Richtungen.** Wer Unterkonten hat, kann nicht Unterkonto
  werden; wer Unterkonto ist, kann weder einladen noch aufnehmen. Fehlte eine
  der drei Prüfungen, entstünde eine Kette, für die jede Abfrage eine rekursive
  Auflösung samt Zyklusschutz bräuchte.
* **Gleiche Währung**, geprüft beim Einlösen. Sonst summierte die Haushaltssicht
  CHF und EUR — kommentarlos falsch, und der Zahl sieht man es nicht an.
* **Ein Konto gehört zu höchstens einem Haushalt** (UNIQUE auf `sub_user_id`).
* **Lesen weit, Schreiben eng.** Der Haushalt erweitert das Blickfeld. Ob jemand
  etwas ändern darf, beantwortet `canWriteFor()` ausdrücklich — nicht als
  Nebenwirkung des Blickfelds. Ein Unterkonto hat das Hauptkonto **nicht** im
  Blickfeld; der Hauptaccount ist eine Sicht, kein gemeinsamer Topf.

**Der Code** steht nur als SHA-256 in der Datenbank (wie API-Tokens und
QR-Anmeldecodes), gilt 24 Stunden und ist einmalig einlösbar. Er wird atomar
entwertet — zwei gleichzeitige Versuche können nicht beide durchkommen — und
bei jeder abgelehnten Regel **wieder freigegeben**: Sonst wäre er nach einem
Währungsfehler verbraucht, obwohl niemand verknüpft wurde.

**Entkoppeln dürfen beide Seiten.** Ein Unterkonto, das nicht mehr mitmachen
will, wäre sonst auf das Wohlwollen des Hauptkontos angewiesen. Daten bleiben,
wo sie sind.

**Oberfläche.** Neue Karte „👪 Haushalt" in den Einstellungen, die je nach
Rolle nur den passenden Kasten zeigt — ein Knopf, der immer eine Fehlermeldung
erzeugt, ist schlimmer als keiner. Vollständig DE/EN.

**Endpunkte** (Webapp und `/api/v1` gleichermassen, in der Inventur als
`paritaet` geführt): `GET household`, `POST household/invite`,
`POST household/redeem`, `POST household/unlink`.

**Tests.** `test/household.test.js` mit 10 Prüfungen — jede Regel einzeln, dazu
die Freigabe des Codes bei Ablehnung und die Rollenlogik der Oberfläche.

Zwei Funde beim Bauen: Mein `onclick="this.select()"` am Code-Feld hätte die
geschlossene CSP unterlaufen (jetzt `data-click`), und ein `t()` in einem Toast
hätte „Marco &amp; Co" angezeigt statt „Marco & Co" (jetzt `tRaw()`). Beides
fanden die bestehenden Tests.

Stand: `tsc --noEmit` sauber, 327 Tests, 0 Fehler (4 übersprungen mangels
Postgres). Die Migration selbst konnte ich hier nicht laufen lassen.

---
## Haushalt, Durchgänge 2–5: zusammengefasste Sicht, Finanzen, Verschieben, Schreibrechte

Serverseite und Webapp. Die Android-App zieht später nach.

### Kein Umschalter

`scopeIds(uid)` liefert das Blickfeld, und dieses ist zugleich der
Schreibbereich: Ein Hauptkonto sieht und ändert seinen Haushalt, alle anderen
nur sich selbst. Ein Schalter „Haushaltssicht ein/aus" wäre eine zweite
Wahrheit darüber, was gerade auf dem Schirm steht — jede Summe, jeder Zähler
und jedes Diagramm müsste ihn kennen.

`canWriteFor()` bleibt trotzdem: Wenn ein Zielkonto **ausdrücklich** benannt
wird (Erfassen mit Kontoauswahl, Verschieben), genügt „steht im Blickfeld"
nicht — dort muss die Richtung stimmen. Ein Unterkonto darf nicht ins
Nachbarkonto schreiben, auch wenn beide im selben Haushalt sind.

### Listen (Durchgang 2)

36 Vergleiche in `utils/handlers.ts` auf `user_id = ANY($1)` umgestellt, 15
Handler normalisieren die ID zu einer Liste.

**Ein Set, eine Zeile.** Besitzen zwei Kinder dasselbe Set, erscheint es
einmal — mit der Summe der Mengen und den Kaufpreisen aller Besitzer. Das
Verdichten steckt in einer Unterabfrage, die dieselben Spaltennamen liefert wie
die Tabelle; Filter, Sortierung, Seitenaufteilung und der Erfassungs-JOIN
bleiben dadurch unverändert, nur die Quelle ist eine andere. Ohne Haushalt wird
gar nicht erst gruppiert — dann ist es wörtlich die alte Abfrage.

`owners` (IDs plus Namen, eine Abfrage für die ganze Seite) hängt nur im
Haushalt an der Antwort. Im Einzelkonto stünde an jeder Kachel „gehört mir",
und das ist Rauschen.

### Finanzen und Portfolio (Durchgang 3)

Alle vier Rechner und `resolveSetCondition` nehmen das Blickfeld.

Die **Portfoliokurve** umgeht für Haushalte bewusst die Schnappschüsse: Die
liegen je Konto unter `__portfolio__<id>` und werden geschrieben, wann der
jeweilige Lauf lief. Sie zu addieren hiesse, Punkte verschiedener Tage zu
summieren — wo einem Konto ein Tag fehlt, fiele die Kurve ein, ohne dass etwas
passiert wäre. Stattdessen wird aus dem Preisverlauf **je Set** rekonstruiert;
der ist nicht kontogebunden, die Haushaltskurve stimmt damit **rückwirkend**
auch für die Zeit vor der Verknüpfung.

### Verschieben (Durchgang 4)

`POST /api/sets/:sn/move`. Verschieben heisst oft Verschmelzen: `sets` ist je
Konto und Setnummer eindeutig. Mengen werden addiert, die Erfassungen wandern
**einzeln** über `recordAcquisitionForDay()` — treffen dabei zwei Erfassungen
desselben Tages aufeinander, fasst der Helfer sie mengengewichtet zusammen.
Ein direktes `UPDATE user_id` hinterliesse zwei Zeilen desselben Tages, also
genau den Zustand, den der Bearbeiten-Pfad ablehnt.

Serialisiert per Advisory-Lock auf dem Quellkonto. Anleitungen bleiben, wo sie
sind — sie hängen an Datei und Konto, nicht am Exemplar.

### Schreibrechte (Durchgang 5)

`owner_user_id` bei `POST /api/sets` und `/add-stream`, geprüft über
`resolveOwner()` → `canWriteFor()`. Ohne Angabe bleibt es beim eigenen Konto;
ohne Recht kommt 403 statt stillschweigend das eigene Konto.

### Oberfläche

Besitzer-Plakette auf der Galerie-Kachel, Kontoauswahl im Erfassen-Formular
(verborgen, solange es nichts zu wählen gibt), Verschieben-Auswahl im
Set-Dialog. Die Quellliste enthält nur Konten, die das Set **tatsächlich**
besitzen — sonst böte die Oberfläche eine Auswahl an, die der Server mit 404
beantwortet. „Verschmolzen" bekommt eine eigene Meldung: Wer danach zwei Zeilen
erwartet, würde sonst einen Fehler vermuten.

### Bewusst zurückgestellt

`parts_summary` ist ein Cache **je Konto**. Ein Haushalt müsste ihn über alle
Konten verdichten und für jedes einzeln frisch halten — beides ist nicht
gebaut, deshalb nimmt der Haushalt den Live-Pfad: langsamer, aber richtig.
`ensureFresh()` meldet für eine Liste mit mehr als einem Konto grundsätzlich
`false`; „eines von drei ist frisch" als „frisch" zu melden wäre die Art
Halbwahrheit, die später als falsche Zahl erscheint.

### Tests

`test/household.test.js` auf 17 Prüfungen erweitert (Blickfeld ohne
Umschalter, Verdichtung, rückwirkende Kurve, Verschieben über die Tagesregel,
Schreibrichtung, Live-Pfad, Oberflächenregeln). Vier bestehende Prüfungen
bildeten Namen oder Zeilenabstände ab, die der Umbau verschoben hat, und sind
angepasst — die geschützte Absicht blieb jeweils dieselbe.

Neue Endpunkte in der Inventur: `POST /api/sets/:sn/move` und
`GET /api/sets/household-members`, beide als `nur-web` — die Android-App
bekommt sie, wenn die Haushaltssicht dort ankommt.

Stand: `tsc --noEmit` sauber, 334 Tests, 0 Fehler (4 übersprungen mangels
Postgres).

---
## Die Kaufpreis-Regel im Wortlaut — und an genau einer Stelle

> **Pro Tag, Element und Benutzer gibt es genau EINEN Kaufpreis.**
>
> Ein Element ist ein Set, ein manuell erfasstes Teil oder eine manuell
> erfasste Minifigur — dieselbe Regel, nur ein anderer Schlüssel.

Der Satz steht jetzt so am Anfang von `utils/acquisitions.ts`, und die
Schlüssel je Art (`set_number` / `part_number` + `color_id` / `fig_number`)
stehen dort in `SHAPES` an einer Stelle. Sonst hiesse „Element" je nach
Aufrufer etwas anderes — ein Teil ist erst mit der Farbe eindeutig.

**Vier Kopien der Regel zusammengeführt.** Die drei Datums-Endpunkte hatten je
eine wortgleiche Kollisionsabfrage; sie laufen jetzt über
`findSameDayAcquisition(kind, …)`. Ein Test lässt keine eigene Kopie mehr durch.

**Die vierte Kopie steckte in `adjustAcquisitionsToQuantity()`** — und war
nicht nur eine Doppelung, sondern falsch: Ist die neueste Erfassung von heute,
erhöhte der Zweig **nur die Menge** und liess den Kaufpreis stehen. Ein heute
dazugekauftes Exemplar zum aktuellen Marktpreis verschwand damit im alten
Stückpreis — die Zeile zeigte zwei Stück zum Preis des ersten. Jetzt läuft auch
die Erhöhung über `recordAcquisitionForDay()`, das mengengewichtet mittelt wie
überall sonst; der Marktpreis wird dafür immer ermittelt, nicht nur beim
Neuanlegen. Die Hilfsfunktion `isToday()` ist entfallen.

**Beim Verschieben** galt die Regel schon: Die Erfassungen wandern einzeln
durch denselben Helfer, und weil er je Benutzer greift, entsteht im Zielkonto
auch dann nur eine Tageszeile, wenn beide Konten am selben Tag gekauft haben.

**Tests.** Zwei neue in `test/manual-acq-refresh.test.js` (Regel im Wortlaut
und Schlüssel je Art; Erhöhung mittelt statt stehen zu lassen), eine bestehende
auf den gemeinsamen Prüfer umgeschrieben.

Stand: `tsc --noEmit` sauber, 336 Tests, 0 Fehler (4 übersprungen mangels
Postgres).

---
## Haushalt: Kontoauswahl und Besitzer auch bei Teilen und Minifiguren

Zwei Lücken aus dem letzten Durchgang.

**1. Erfassen für ein anderes Konto ging nur bei Sets.** `owner_user_id` gab es
an `POST /api/sets` und `/add-stream` — die Anlege-Pfade für manuelle Teile und
Minifiguren nicht. Ein Elternteil konnte ein Set für ein Kind erfassen, ein
einzelnes Teil aber nicht; die Regel „Hauptkonto wählt beim Erfassen das Konto"
war damit nur zur Hälfte wahr.

Die Auflösung ist dabei von `routes/sets.ts` nach `utils/household.ts` gewandert
(`resolveWriteTarget`). Drei Kopien einer Rechteprüfung sind die Sorte
Doppelung, bei der irgendwann eine grosszügiger ist als die anderen. Alle drei
Routen antworten jetzt mit 403 statt stillschweigend auf das eigene Konto
zurückzufallen; ohne Angabe bleibt alles wie vor der Haushaltssicht.

In der Oberfläche haben alle drei Erfassen-Formulare dieselbe Auswahl, gefüllt
aus einer Liste (`loadHouseholdMembers`), und verborgen, solange es nichts zu
wählen gibt.

**2. Besitzer-Plakette gab es nur auf der Galerie-Kachel.** Jetzt auch auf den
Kacheln manuell erfasster Teile und Minifiguren sowie in allen Finanzzeilen.

Dabei eine bewusste Abweichung von den Sets: **Manuelle Teile und Minifiguren
werden NICHT verdichtet.** Zwei Konten mit demselben Teil sind zwei Bestände
mit eigener Menge und eigenem Kaufpreis, und jeder Bearbeiten-Weg (Menge,
Preis, Löschen) führt auf genau eine Zeile. Sie zusammenzufalten hiesse, für
jede Änderung wieder auseinanderzunehmen, wem was gehört. Die Plakette macht
sichtbar, warum dasselbe Teil zweimal erscheint. Bei Sets ist das anders, weil
dort das Verschieben ohnehin je Besitzer aufgelöst wird.

`withOwners()` (Listen) und `withOwnerNames()` (Bewertung) hängen die Namen mit
**einer** Abfrage je Liste an, nicht einer je Zeile — und nur im Haushalt.

**Dabei einen eigenen Fehler gefunden:** Beim Verschieben der Auflösung aus
`routes/sets.ts` hatte mein Löschschnitt die Route `POST /api/sets/:sn/move`
mitgenommen. Aufgefallen ist es nicht beim Lesen, sondern durch
`api-inventory.test.js` — „klassifizierte Endpunkte existieren nicht mehr". Die
Route ist wiederhergestellt.

**Tests.** `test/household.test.js` auf 18 Prüfungen: Schreibrichtung jetzt über
alle drei Anlege-Pfade, Besitzer in Listen und Bewertung, Kontoauswahl in allen
drei Formularen.

Stand: `tsc --noEmit` sauber, 337 Tests, 0 Fehler (4 übersprungen mangels
Postgres).

---
## Teile-Zusammenfassung im Haushalt — und Kontofilter je Ansicht

### Die Zusammenfassung trägt jetzt über mehrere Konten

Bisher nahm ein Haushalt für die Teileliste den Live-Pfad: korrekt, aber
langsam. Die Tabelle `parts_summary` ist je Konto aufgebaut (Schlüssel
`user_id, part_key, color_id`) — für den Haushalt wird jetzt über alle
beteiligten Konten gelesen und **über `part_key` verdichtet**. Dasselbe Teil in
zwei Konten ergibt eine Zeile mit der Summe, genau wie dasselbe Teil aus zwei
Sets innerhalb eines Kontos.

Zwei Fallen dabei, beide per Test festgehalten: Ohne `GROUP BY` erschiene das
Teil je Konto einmal, und die Gesamtzahl zählte Konten statt Teile — deshalb
zählt auch `COUNT(*)` über eine gruppierte Unterabfrage, und die Farbstatistik
über `COUNT(DISTINCT part_key)`.

`ensureFresh()` prüft jedes Konto einzeln und meldet nur frisch, wenn **alle**
es sind. „Zwei von drei sind aktuell" ergäbe eine Summe aus frischen und alten
Beständen, und der Zahl sieht man das nicht an. Fehlende Konten werden im
Hintergrund aufgebaut; bis dahin greift wie bisher der Live-Pfad.

### Kontofilter je Ansicht

Ein Hauptkonto schaltet in Galerie, Teilen, Minifiguren und Finanzen zwischen
**Alle Konten / Eigene / Unterkonten** um — je Ansicht getrennt. Wer in der
Galerie den ganzen Haushalt sieht, will in den Finanzen womöglich nur die
eigenen Zahlen.

Das korrigiert meine frühere Festlegung („kein Umschalter"). Der Einwand von
damals bleibt aber gültig und bestimmt die Umsetzung: Der Wert reist als
`accounts=` mit der Anfrage und wird an **einer** Stelle in Konto-IDs
übersetzt (`scopeIds(uid, mode)`). Dadurch kennt ihn jede Zahl derselben
Antwort automatisch — Liste, Gesamtzahl, Kennzahlen und Summen entstehen aus
derselben ID-Liste. Clientseitig zu filtern hätte zwar die Kachelwand
ausgesiebt, aber weder die Gesamtzahl darunter noch die Bewertung im
Finanzreiter.

Ein Test lässt keinen `scopeIds`-Aufruf ohne Filter mehr durch: Ein Lesepfad,
der ihn vergisst, zeigte stumm den ganzen Haushalt, während die Ansicht daneben
gefiltert ist.

Weitere Festlegungen:

* Für ein Konto **ohne** Unterkonten ist der Filter wirkungslos, und die
  Auswahl bleibt verborgen — ein Filter mit einer möglichen Antwort ist keine
  Wahl.
* `'subs'` bei einem Konto ohne Unterkonten ergäbe eine leere Ansicht ohne
  erkennbaren Grund; `scopeIds()` fängt das ab.
* Unbekannte Werte fallen auf `'all'` zurück statt die Ansicht zu leeren.
* Die Wahl liegt im `localStorage`, nicht auf dem Server: Sie ist eine
  Ansichtseinstellung wie „Kachel oder Tabelle" — am Telefon will man sie
  womöglich anders als am Rechner.
* Umgeschaltet wird **nur die betroffene Ansicht** neu geladen. Alle vier
  gleichzeitig anzufassen würde drei Ansichten neu laden, die niemand ansieht,
  und dabei Preisabrufe auslösen.

Im Finanzreiter tragen alle fünf Abfragen den Filter — die vier Bewertungen und
die Portfoliokurve. Sonst stünde eine Summe aus einem Blickfeld neben einer
Aufstellung aus einem anderen.

**Tests.** `test/household.test.js` auf 22 Prüfungen; zwei bestehende auf das
neue Verhalten umgeschrieben (die Zusammenfassung nimmt nicht mehr den
Live-Pfad, und aus „kein Umschalter" ist „der Filter wird am Server in IDs
übersetzt" geworden).

Stand: `tsc --noEmit` sauber, 339 Tests, 0 Fehler (4 übersprungen mangels
Postgres).

---
## Gegen eine echte Datenbank getestet — drei stille Fehler gefunden

Bis hierher liefen alle Haushalts-Änderungen nur als Quelltext-Prüfungen. In
diesem Durchgang lief die Suite erstmals gegen ein echtes Postgres: **391
Tests, 0 Fehler, 0 übersprungen** (vorher 339 mit 4 übersprungenen Dateien).

**Fund 1 — alle vier Finanz-Endpunkte antworteten mit 500.**
`invalid input syntax for type integer: "{"2"}"`. Bei der Umstellung auf
`user_id = ANY($1)` bekam `getSetting(uid, …)` die ID-**Liste** statt einer ID.

Das war mehr als ein Tippfehler: In `uid` steckten zwei verschiedene Dinge. Die
Rechner nehmen jetzt beide getrennt entgegen — `viewerId` (wessen
Einstellungen gelten: Währung, Cache-Dauer, Preisart) und `ids` (wessen Daten
gerechnet werden). Sie fallen auseinander, sobald der Kontofilter auf
„Unterkonten" steht: Dann enthält `ids` das fragende Konto gar nicht, und
`ids[0]` wäre die Währung eines Kindes gewesen. Dasselbe in
`getPortfolioHistory()`.

**Fund 2 — der API-Paritätstest war seit hardened-59 tot.** Er lud
`routes/api_v1/index.js` aus dem Quellordner; das Kompilat liegt seither unter
`dist/`. Ergebnis `MODULE_NOT_FOUND` — unbemerkt, weil die ganze Suite ohne
Postgres übersprungen wird.

**Fund 3 — derselbe Test seedete einen unbrauchbaren Token.** Der Kommentar
versprach, `validateToken()` migriere Klartext beim ersten Treffer auf den
Hash. Diesen Rückfallpfad gibt es längst nicht mehr (er hätte einen erratenen
Token dauerhaft gültig gemacht); der Kommentar blieb stehen, der Test seedete
weiter Klartext. Jetzt als Hash.

Dazu zwei Hygienefunde: `parts-summary` und `schema-init` schlossen ihren
Verbindungspool nie — mit Datenbank hing der Prozess danach, und der Läufer
meldete beide Dateien rot, obwohl jede Prüfung grün war.

### Neu: `test/household-db.test.js`

Neun Prüfungen gegen echtes Schema und echte Abfragen, mit drei Konten:
Verknüpfen samt Währungsprüfung und Einmal-Einlösung, Blickfeld und
Kontofilter, eine Stufe in beide Richtungen, Verdichtung zweier Bestände zu
einer Zeile (Menge addiert, Kaufpreis gewichtet: 1×100 + 2×160 → 140),
Kennzahlen unter dem Filter, Verschieben über die **echte Route**, Rechte, und
Entkoppeln.

Der Seed führt `runMigrations()` aus: `initSchema()` legt nur die
Grundtabellen an, `account_links` kommt aus `db/migrations/0005`. Ohne den
Schritt liefe der Test gegen ein Schema, das es im Betrieb nicht gibt.
## Verschieben nimmt Teile, Minifiguren und Anleitungen mit

Sie gehören zum Exemplar, nicht zum Konto: Wandert das Set, wandert sein
Inhalt. Bliebe er zurück, hätte das Quellkonto Teile aus einem Set, das es
nicht mehr besitzt — sichtbar in der Teileliste, aber ohne Herkunft — und im
Zielkonto fehlten sie.

Hier genügt ein `UPDATE` der `user_id`: Anders als bei den Erfassungen gibt es
keine Regel „eine Zeile pro Tag und Element", und die Tabellen haben keinen
eindeutigen Schlüssel über `(user_id, set_number, …)`. Besitzt das Zielkonto
dasselbe Set schon, stehen seine Teile danach doppelt — richtig so, es sind
zwei Exemplare.

`COALESCE(source,'set') <> 'manual'` schützt manuell erfasste Teile und
Minifiguren: Sie hängen an keinem Set und dürfen nie mitwandern. Ein Test prüft
das an **beiden** Anweisungen einzeln, nicht per Zählung — der Kommentar
darüber nennt dieselbe Bedingung.

**Anleitungen ebenfalls**, obwohl nicht ausdrücklich verlangt: Sie hängen an
(Konto, Setnummer), und die Galerie zeigt sie nur zu Sets, die das Konto
besitzt. Bliebe die Zeile stehen, wäre sie für die Quelle unsichtbar und im
Ziel nicht vorhanden, obwohl die Datei auf der Platte liegt. Sag Bescheid,
falls sie stattdessen beim alten Konto bleiben sollen.

Die Erfolgsmeldung nennt jetzt die Zahlen — dass Teile mitwandern, sieht man in
der Galerie nicht, und wer es nicht erwartet, sucht sie später im falschen
Konto.

---
## Nachtrag: die 500er im Finanzen-Reiter sind hardened-106

Gemeldet aus der Browser-Konsole: fünfmal 500 auf `/api/finance/valuation`,
`parts-valuation`, `minifigs-valuation` und `pnl` — der Finanzen-Reiter blieb
leer.

Das ist derselbe Fehler, den der erste Datenbanklauf gefunden hat: `getSetting()`
bekam nach der Umstellung auf `user_id = ANY($1)` die ID-**Liste** statt einer
ID. Er traf **jedes** Konto, nicht nur Haushalte — `scopeIds()` liefert immer
eine Liste. Behoben in hardened-106 (viewerId und ids getrennt); Stände 102–105
sind davon betroffen.

Alle `getSetting()`-Aufrufe im Projekt noch einmal durchgesehen: Die übrigen
bekommen durchweg eine einzelne ID (`req.session.userId`, `req.apiUser.user_id`
oder ein daraus abgeleitetes `uid`).

**Neue Prüfung**, damit diese Klasse nicht wiederkommt: Der Datenbanktest ruft
jetzt alle fünf Finanz-Endpunkte in **jedem** Kontofilter auf (`all`, `own`,
`subs`) und erwartet 200. Der Paritätstest deckte nur den Fall ohne Filter ab —
und `accounts=subs` ist der heikelste, weil dort das fragende Konto gar nicht in
der ID-Liste steht. Zusätzlich wird geprüft, dass die Währung in genau diesem
Fall vom fragenden Konto stammt und nicht aus einem Unterkonto.

Stand: 392 Tests, 0 Fehler, 0 übersprungen.

---
## Build: `python3`, `make` und `g++` entfernt

Die Zeile stand als Vorsorge für `node-gyp` im Build-Stage: Ein Paket mit
nativer Erweiterung baut beim Installieren aus C++-Quellen, und auf Alpine ist
nichts davon vorinstalliert — `npm ci` bricht dann mit einer schwer lesbaren
Meldung ab.

Gebraucht wird sie nicht: keine einzige `binding.gyp` im Abhängigkeitsbaum, und
die einzigen Pakete mit Install-Skript sind `esbuild` (lädt eine fertige
Binärdatei für die Plattform) und `fsevents` (macOS-only, auf Linux gar nicht
installiert). Die üblichen Verdächtigen liegen alle in der reinen
JavaScript-Variante vor: `bcryptjs` statt `bcrypt`, `pg` ohne `pg-native`,
`jimp`, `pdfkit`.

**Nachgewiesen, nicht angenommen:** `npm ci`, `build-ts`, `build-frontend` und
`tsc --noEmit` laufen mit `python3`, `make`, `g++`, `gcc` und `cc` durch
Platzhalter ersetzt, die mit Exit-Code 127 abbrechen — nichts davon greift
danach.

Das Laufzeit-Image wird dadurch nicht kleiner (es ist ein eigenes Stage und
installierte nur `su-exec`); gespart werden rund 200 MB Bauzeit-Ballast bei
jedem Build ohne Layer-Cache.

**Damit es auffällt, wenn sich das ändert:** `test/dockerfile.test.js` prüft
beides zusammen — die Werkzeuge dürfen nur fehlen, solange auch wirklich nichts
kompiliert. Kommt eine Abhängigkeit mit `binding.gyp` oder einem unbekannten
Install-Skript dazu, wird der Test rot und nennt die Zeile, die dann zurück ins
Build-Stage gehört. Ein `npm ci`, das mit „gyp ERR! find Python" abbricht, ist
deutlich schwerer zu deuten.

Die Zeile selbst steht als Kommentar im Dockerfile — zum Zurückholen genügt
Einfügen.

Stand: 394 Tests, 0 Fehler, 0 übersprungen (gegen echtes Postgres).

---
## Verschieben auf Kaufpreis-Ebene, in beide Richtungen

**Der Kaufpreis ist die Ebene, auf der ein Exemplar wirklich existiert.** Ein
Set mit drei Erfassungen sind drei Käufe, die verschiedenen Kindern gehören
können. Deshalb steht der Eigentümer jetzt **je Zeile im Kaufpreis-Dialog** —
als Auswahlfeld, wie vorgeschlagen. Das ganze Set auf einmal geht weiterhin
über den Dialog-Fuss.

Beides läuft durch **eine** Umsetzung (`utils/setMove.ts`): Der Teilfall ist
kein Sonderweg, sondern der allgemeine Fall mit einer Auswahl
(`acquisition_ids`). Ein Test hält fest, dass beide Routen denselben Helfer
rufen.

Richtung Hauptkonto funktioniert damit ebenfalls: `resolveWriteTarget()` prüft
Quelle **und** Ziel, und für das eigene Konto ist die Antwort immer ja. Ein
Unterkonto kann weiterhin nichts umhängen — auch nicht ins Geschwisterkonto.

### Teile kopieren statt umhängen

Beim Teilverschieben behält der Absender Exemplare — und damit auch deren
Teile. `parts.quantity` ist die Menge für **ein** Set; die Gesamtmenge entsteht
erst durch Multiplikation mit `sets.quantity`. Das Zielkonto bekommt deshalb
eine **Kopie** der Zeilen, keine Verschiebung. Erst wenn beim Absender das
letzte Exemplar geht, verschwinden Set und Inhalt dort.

Das korrigiert die Fassung aus hardened-106, die schlicht `user_id`
umgeschrieben hat — beim Teilfall wäre die Quelle mit Exemplaren ohne Teile
zurückgeblieben.

**Ein Fehler, den erst der Datenbanktest fand:** Die erste Kopierregel prüfte,
ob das Ziel *das Set* schon hat, und übersprang dann das Kopieren. Ein Set kann
aber sehr wohl ohne Teile im Bestand stehen (Erfassung ohne Teile-Import,
abgebrochener Import). Dann wurde nichts kopiert — und anschliessend beim
Absender gelöscht. Die Teile wären weg gewesen. Jetzt wird **je Tabelle**
geprüft, ob das Ziel für dieses Set schon Zeilen hat.

### Migration 0006 für früher verschobene Sets

Bis hardened-105 wanderte beim Verschieben nur das Set. Zurück blieben Zeilen,
die auf ein Set zeigen, das ihr Konto nicht mehr besitzt — beim Absender
sichtbar, aber ohne Herkunft, und im Zielkonto fehlten sie.

`db/migrations/0006` hängt sie um, aber nur wenn **alle drei** Bedingungen
gelten: die Zeile ist verwaist (eigenes Konto hat das Set nicht),
**genau ein** anderes Konto **desselben Haushalts** besitzt es, und dieses
Konto hat noch keine eigenen Zeilen dieser Art. Der Haushaltsbezug ist keine
Kosmetik — ohne ihn wäre „irgendwer besitzt dieses Set" ein Datenleck; ein Test
prüft, dass ein fremdes Konto mit demselben Set nichts abbekommt. Bei zwei
möglichen Zielen im Haushalt bleibt die Zeile liegen: Dann ist nicht
entscheidbar, wem sie gehört, und ein geratenes Ziel wäre schlimmer als ein
Rest zum Nachsehen.

### Nebenwirkung an der Erfassungsliste

`GET /api/sets/:sn/acquisitions` liefert jetzt das Blickfeld statt nur des
eigenen Kontos und je Zeile `owner_user_id` — sonst wüsste die Auswahl nicht,
worauf sie steht. Die `/api/v1`-Route zieht mit; der Paritätstest hätte die
Abweichung ohnehin nicht durchgelassen.

Stand: `tsc --noEmit` sauber, **397 Tests, 0 Fehler, 0 übersprungen** — gegen
echtes Postgres, inklusive drei neuer Prüfungen zum Eigentümerwechsel, zur
verweigerten Geschwister-Verschiebung und zur Migration.

---
