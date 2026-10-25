# Begründungen zu `routes/api_v1/catalog.ts`

Die ausführlichen Kommentare aus `routes/api_v1/catalog.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
/api/v1/catalog — Rebrickable-Katalog (Browsen/Suchen/Filtern aller Sets).

Datenquelle sind die täglich per CSV-Sync gefüllten Tabellen rb_sets,
rb_themes, rb_inventories und rb_inventory_minifigs — es werden KEINE
Rebrickable-API-Calls gemacht, alles kommt aus der lokalen DB.

requireToken akzeptiert Session-Cookie (Webapp) UND Bearer-Token (Android),
daher reicht ein einziger Router für beide Clients (Muster wie /v1/stats).

Endpunkte:
  GET /catalog/meta              — Themes (mit Set-Zahl inkl. Unterthemen) + Jahresbereich
  GET /catalog/sets              — paginierte Liste; q, theme_id, year_from, year_to, sort, page, limit
  GET /catalog/sets/:setNumber   — Detail inkl. Theme-Pfad, Minifiguren-Zahl, Besitz-Status
```

<a id="themenode"></a>
## `ThemeNode`

```text
── Die eigene Bild-Warteschlange der Katalogliste ist entfallen ────────────

Marcos Zuordnung: „Die CPU ist seit der Umstellung des Katalogs mit dem
Scrolling so stark ausgelastet." Damit war die Suche endlich am richtigen
Ort — hier.

Diese Datei hatte eine EIGENE Warteschlange, die zu jedem gelisteten Set das
Bild holte und `generateThumb()` DIREKT aufrief. Damit lief sie an allem
vorbei, was ich in den Nachträgen 99 bis 104 gedrosselt hatte:

  • nicht an THUMB_MAX_PARALLEL — das gilt im Bild-Proxy,
  • nicht an der Sitzungssperre aus Nachtrag 100 — dito,
  • und mit eigener Parallelität 2: bei vier Arbeitsprozessen acht
    gleichzeitige Jimp-Läufe. Das sind die über 300 %.

Ich habe fünf Nachträge lang die Drosselung des einen Erzeugers verfeinert,
während der zweite ungebremst danebenlief. Gefunden hat ihn Marcos Hinweis,
WANN es angefangen hat — nicht meine Vermutungen darüber, WAS rechnet.

Vor dem Umbau der Liste fiel er nicht auf: Sie zeigte nur, wozu man sich
hingescrollt hatte, also ein paar Seiten. Seit dem Fensterladen kommen bei
jedem Sprung hunderte Sets vorbei.

Gebraucht wird sie nicht mehr: Seit Nachtrag 102 hinterlässt jede Bildanfrage
über den Proxy eine Notiz, und `jobs/imageQueue.ts` legt Bild UND Vorschau im
Hintergrund an — gebündelt und nur auf dem Primärprozess.
```

<a id="get-catalog-year-verteilung"></a>
## `get-/catalog/year-verteilung`

```text
GET /api/v1/catalog/year-verteilung?q=&theme_id=&sort=

Wie viele Sets je Jahr — MIT den aktuellen Filtern und in der Reihenfolge der
Sortierung.

── Marcos Befund ───────────────────────────────────────────────────────────
„Wenn dann die Bilder geladen werden, erscheinen sie von einem anderen Jahr
als rechts im Scrollbalken angezeigt wird. Es wurden die Sets von 1999
geladen, obwohl rechts 1965 steht."

Die Ursache war eine Annahme, die niemand ausgesprochen hatte: Das Etikett
rechnete die Position LINEAR auf den Jahresbereich um — als läge zwischen
1949 und 2027 in jedem Jahr gleich viel. Tatsächlich stammt der weitaus
grösste Teil des Katalogs aus den letzten Jahrzehnten; wer neun Zehntel
hinunterzieht, ist deshalb noch lange nicht bei den Sechzigern.

Mit dieser Verteilung wird aus der Position eine laufende Nummer und daraus
das Jahr, in dem diese Nummer wirklich liegt. Die Zahlen kommen vom SERVER,
weil nur er die Filter kennt — eine Verteilung ohne Filter läge genauso
daneben wie die lineare Schätzung.
```

<a id="get-catalog-sets-setswithlocal"></a>
## `setsWithLocal`

```text
image_local mitgeben, wenn die Datei bereits existiert — unabhängig
davon, WELCHER Nutzer sie einmal heruntergeladen hat.

downloadSetImage() (utils/setImages.ts) legt Set-Bilder unter
public/images/sets/<setnummer>.jpg ab, benannt nach der Setnummer
allein — die Datei ist von Anfang an nutzerunabhängig, nur die Spalte
`image_local` lebt zufällig auf der Pro-Nutzer-Zeile in `sets`. Der
Katalog zeigt Sets, die der aktuelle Nutzer NICHT besitzt, aber ein
ANDERER Nutzer (oder er selbst bei einem früheren Set) kann dieselbe
Bilddatei schon heruntergeladen haben. In dem Fall die lokale Datei
servieren statt eine weitere CDN-Anfrage über den Proxy zu machen.

resolveIfExists() (utils/images.ts) statt eigener fs-Zugriffe: synchron
UND gecacht. Die vorige Fassung fragte bis zu 200 Sets pro Seite
gleichzeitig per fs.promises.access() ab — das läuft über den kleinen
libuv-Thread-Pool (standardmässig 4 Threads) und flutete ihn, was
andere Pool-Arbeit verzögerte (u. a. TLS-Handshakes neuer
Datenbank-Verbindungen — sichtbar als "timeout exceeded when trying to
connect" beim Filtern nach Jahr, wo viele Treffer auf einmal
ausgeliefert werden). Der Cache sorgt dafür, dass ein Set, das schon
einmal geprüft wurde, beim nächsten Mal keinen Dateisystem-Zugriff
mehr braucht.
```

<a id="get-catalog-sets-setnumber"></a>
## Abschnitt

```text
Noch nicht heruntergeladen? Jetzt holen und dauerhaft ablegen — nicht
nur im Bild-Proxy-Cache zwischenspeichern, der pro angefragter URL
lebt und beim Hinzufügen des Sets erneut heruntergeladen würde.

Der Detail-Dialog ist ein bewusstes Anschauen (wie bei BrickLink oben)
— anders als die Liste, wo Hunderte Kacheln beim Scrollen vorbeiziehen
und ein Download pro Kachel den Server unnötig belasten würde. Hier ist
GENAU EIN Set gemeint, also genau EIN CDN-Abruf. downloadSetImage()
prüft selbst zuerst, ob die Datei schon existiert (idempotent, egal ob
schon ein anderer Nutzer sie geholt hat), lädt sie nach
public/images/sets/ herunter und stösst über den bestehenden
Thumbnail-Mechanismus in server.ts (setImmediate nach dem Download) die
Erzeugung der "_thumb.jpg"-Vorschau an. Damit ist jeder folgende
Aufruf — auch die Kachel in der Liste — sofort lokal bedient, ohne
erneuten CDN-Umweg.
```

<a id="get-catalog-bricklink"></a>
## `get-/catalog/bricklink`

```text
── GET /api/v1/catalog/bricklink?sets=a,b,c ─────────────────────────────────
Gebündelte BrickLink-Links für eine ganze Katalogseite: EINE SQL-Abfrage
statt einer pro Set, und kein einziger BrickLink-API-Aufruf.

Gebündelt gegen BrickLink selbst geht nicht — deren Store-API kennt nur
GET /items/{type}/{no} und drosselt bei ~1 Anfrage/Sekunde. Rebrickable
wiederum führt external_ids nur bei Parts, nicht bei Sets. Die einzige
bündelbare Stelle ist deshalb der lokale Cache, und genau die nutzt dieser
Endpoint.
```
