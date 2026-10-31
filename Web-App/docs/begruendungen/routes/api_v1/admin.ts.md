# Begründungen zu `routes/api_v1/admin.ts`

Die ausführlichen Kommentare aus `routes/api_v1/admin.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="job-frisch-ms"></a>
## `JOB_FRISCH_MS`

```text
Wie lange ein gemeldeter Betrieb ohne neues Lebenszeichen gilt.

Steht an EINER Stelle, weil zwei Kacheln dieselbe Frage beantworten: Ist das
„laeuft" von eben noch aktuell? Vorher stand die Zahl nur beim Katalog-Job;
der Bilder-Nachlauf daneben hatte gar keine Frist und blieb nach einem
abgebrochenen Lauf fuer immer auf „laeuft".

Drei Minuten: lang genug, dass ein langsamer Durchgang nicht faelschlich als
tot gilt (der Takt schreibt alle zwanzig Sekunden), kurz genug, dass ein
abgestuerzter Lauf nicht den ganzen Tag Betrieb vortaeuscht.
```

<a id="get-admin-image-diag-setnumber"></a>
## `get-/admin/image-diag/:setNumber`

```text
── GET /api/v1/admin/image-diag/:setNumber ───────────────────────────────────

„Warum fehlt das Bild für Set X?" — in EINER Antwort (Nachtrag 50).

Dieser Endpunkt ist die Lehre aus einer Fehlersuche, die fünf Anläufe
gebraucht hat. Dasselbe Symptom („Kachel bleibt leer") hatte nacheinander
fünf verschiedene Ursachen, und jede Runde begann damit, dieselben Fragen
von Hand zu beantworten: Kennt die Datenbank überhaupt eine Adresse? Liegt
die Datei da? Die Vorschau? Ist sie plausibel gross? Was sagt der
Proxy-Cache? Jede Antwort lag woanders — in der Datenbank, auf der Platte,
im Cache-Verzeichnis.

Bewusst nur BEOBACHTUNG, keine Reparatur: Der Endpunkt lädt nichts nach und
erzeugt nichts. Wer reparieren will, nimmt den Bilder-Nachlauf. Ein
Diagnosewerkzeug, das nebenbei Zustand verändert, macht die nächste
Fehlersuche schwerer statt leichter.
```

<a id="post-admin-forget-image-misses"></a>
## `post-/admin/forget-image-misses`

```text
── POST /api/v1/admin/forget-image-misses ────────────────────────────────────

Fehlanzeigen zurücknehmen, damit die betroffenen Bilder wieder geholt werden.

── Warum das fehlte (Nachtrag 123) ──────────────────────────────────────────
Ein Bild, das einmal als fehlend vermerkt war, wurde sieben Tage lang nicht
mehr versucht — und es gab keinen Weg, das zurückzunehmen. Der Knopf
„Fehlende neu laden" hilft nicht: Er sieht nur Zeilen mit gesetztem
`image_local` an, also Bilder, die schon einmal da waren. Ein Katalogbild,
das nie ankam, fiel durch jedes Raster.

Ohne Angabe werden alle Set-Fehlanzeigen zurückgenommen; mit `set_numbers`
nur die genannten. Die Vorschau-Vermerke (`thumb:…`) lassen sich über
`thumbs: true` mitnehmen — sie hängen an Dateipfaden, nicht an Setnummern.
```

<a id="post-admin-cache-clear"></a>
## `post-/admin/cache-clear`

```text
POST /api/v1/admin/cache-clear — Preis-Cache leeren, optional alle Caches.

Etappe 7: Stand als /api/finance/refresh und /refresh-all nur in der Webapp.
Das Leeren ist eine GLOBALE Aktion (price_cache ist nicht pro Konto, und
jeder Neuaufbau kostet Anfragen aus dem gemeinsamen Tageskontingent) —
deshalb gehört sie zu den Admin-Werkzeugen, nicht in die Finanz-Routen.

`all=true` nimmt Teil- und Katalog-Caches mit.
```

<a id="get-admin-job-status"></a>
## `get-/admin/job-status`

```text
GET /api/v1/admin/job-status — Stand des Preis-Jobs samt Kontingent.

Etappe 7: Die Webapp fragte das unter /api/finance/job-status ab, die App
hatte kein Gegenstück. Zwei Adressen für denselben Job wären wieder die
Doppelung, an der in dieser Reihe schon mehrfach eine Regel nur an einer
Stelle nachgezogen wurde — jetzt gibt es eine, und requireApiAdmin nimmt
beide Ausweise.
```

<a id="post-admin-catalog-images"></a>
## `post-/admin/catalog-images`

```text
POST /api/v1/admin/catalog-images — alle fehlenden Katalogbilder einreihen.

── Marcos Wunsch ───────────────────────────────────────────────────────────
„Wenn dieser geklickt wird, sollen alle fehlenden Bilder des Katalogs
heruntergeladen werden resp. in die Queue gestellt werden."

Bisher füllte sich der lokale Bildbestand nur beim Blättern: Was man nie
ansieht, wird nie geholt. Für ein gezieltes Vorbefüllen — etwa über Nacht —
fehlte der Anstoss.

── Warum nur EINE Anweisung und keine Prüfung je Datei ─────────────────────
Der Katalog hat rund 25 000 Sets. Für jedes zu prüfen, ob die Datei schon
liegt, wären 25 000 Dateizugriffe in einer Anfrage — auf einem Raspberry Pi
eine spürbare Blockade. Die Prüfung gehört ohnehin dorthin, wo abgearbeitet
wird: jobs/imageQueue.ts überspringt, was bereits lokal liegt, und ergänzt
dort nur eine fehlende Vorschau.

── Fehlanzeigen werden zurückgenommen (Nachtrag 124) ──────────────────────
Marcos Wunsch: „Kannst du die Logik von ‚Alle fehlenden Katalogbilder' so
anpassen, dass er die image_misses löscht und sie erneut versucht? Aktuell
stehen in der Tabelle sehr viele Einträge."

Er hat recht, und der Grund für die vielen Einträge ist mein Fehler aus
Nachtrag 123: Bis dahin vermerkte der Job JEDEN gescheiterten Download als
„dieses Bild gibt es nicht" — auch eine Zeitüberschreitung oder einen
Netzwerkaussetzer. Diese Einträge sind schlicht falsch, und der Knopf war die
einzige Stelle, an der sie jemandem im Weg standen.

WELCHE zurückgenommen werden, ist die entscheidende Frage. Ein bestätigter
404 heisst wirklich „kein Bild vorhanden" — für alte Sets hat Rebrickable
meist keines, das sind Tausende. Die alle erneut zu holen, wäre bei dreissig
Anfragen je Minute ein halber Tag reiner 404-Verkehr, und beim nächsten Klick
wieder.

Deshalb: Zurückgenommen wird, was NICHT als bestätigter 404 vermerkt ist —
also die Altbestände ohne Grund und alles, was vorübergehend gescheitert ist.
Seit Nachtrag 123 trägt ein echter 404 seinen Grund, und die Sache heilt sich
selbst: Ein Altbestand, der beim erneuten Versuch wieder 404 liefert, wird
diesmal richtig vermerkt und bleibt beim nächsten Klick draussen.

`alle_erneut: true` nimmt auch die bestätigten 404er zurück — für den Fall,
dass der CDN Bilder nachgereicht hat. Bewusst nicht die Vorgabe.
```

<a id="post-admin-catalog-images-fs"></a>
## `fs`

```text
── Was schon fertig ist, wird nicht wieder eingereiht ────────────────

Marcos Befund: „Wenn ich auf den Button klicke, werden immer ca. 29 000
Bilder eingereiht. Auch wenn der Job bereits einmal erfolgreich
durchgelaufen ist."

Er hatte recht, und die Begründung, die ich in Nachtrag 111 dafür notiert
habe, war zu kurz gedacht: Ich wollte 25 000 einzelne Dateizugriffe in
einer Anfrage vermeiden — richtig — und habe daraus geschlossen, gar
nicht zu prüfen. Dabei geht es EINMAL: Ein Verzeichnis lesen liefert alle
Namen in einem Zug.

Ohne die Prüfung reihte jeder Klick den ganzen Katalog ein. Der Job
arbeitete das zwar richtig ab (Datei da → überspringen), aber die Kachel
zeigte 29 000 offene Bilder, und jede Notiz kostete einen Durchgang.
```

<a id="get-admin-logs"></a>
## `get-/admin/logs`

```text
── Nutzerverwaltung: NUR unter /api/v1/auth/users ───────────────────────────────

Hier standen GET /api/v1/admin/users und PUT /api/v1/admin/users/:id/role.
Beide hat kein Client gerufen — nachgemessen ueber den Browser-Code und die
Retrofit-Anmerkungen der App (test/api-aufrufer.test.js). Die Webapp
verwaltet Konten ueber /api/v1/auth/users, die App hat keine Nutzerverwaltung.

Schwerer als das Totliegen wog die Doppelung: Adminrechte liessen sich hier
mit dem Feld `is_admin` und dort mit `role` umschalten — zwei Schreibweisen
fuer dieselbe Umschaltung, jede mit eigener Pruefung. Bei Rechten ist genau
das die Sorte Doppelung, bei der irgendwann eine Seite grosszuegiger ist.

Der Selbstschutz („eigene Admin-Rolle kann nicht entfernt werden") und die
strictBool-Pruefung stehen weiter in routes/auth.ts, PUT /users/:id/admin.
```

<a id="get-admin-jobs-seitredl"></a>
## `seitReDl`

```text
── „laeuft" heisst auch hier: hat KUERZLICH etwas getan ──────────────────

Hier stand `reDl?.running === true` — der Wert allein, ohne sein Alter.
Ein Prozess, der mitten im Lauf beendet wird (Neustart, Auslieferung,
Container gestoppt), kommt nie mehr dazu, `false` zu schreiben. Der Stand
blieb dann fuer immer auf „laeuft", und diese Kachel meldete Betrieb, bis
jemand den Schluessel von Hand loeschte.

Der Zeitstempel dafuer wird laengst mitgeschrieben: _redlSetStatus() in
jobs/partsCatalogEnrich.ts haengt an JEDEN Stand ein `at`. Gelesen wurde
er nie.

Zwoelf Zeilen weiter unten steht fuer den Katalog-Job dieselbe Regel, und
zwar begruendet mit genau diesem Befund von Marco („Der Job scheint zu
laufen laut Monitoring, aber im Log sind keine Eintraege dazu zu finden").
Sie stand nur an einer der beiden Stellen. Deshalb jetzt EINE Konstante
fuer beide — sonst laufen die zwei Fenster beim naechsten Anfassen
auseinander.

NACHGEMESSEN: Ein hinterlassenes {running:true} macht
test/image-queue-db.test.js rot („'running' !== 'idle'"). So ist der
Fehler ueberhaupt aufgefallen — im allerersten CI-Lauf dieses Repositories.
```

<a id="get-admin-jobs-katalogoffen"></a>
## `katalogOffen`

```text
── Katalog-Bilder gehören in DIESE Kachel ────────────────────────────────

Marcos Wunsch: „Ich fände es sprechend, wenn diese in der Kachel
‚Bild-Download (CDN)' enthalten sind, da der Titel nichts von meinen Sets
aussagt."

Er hat recht: Die Kachel zählte ausschliesslich Bilder des eigenen
BESTANDES und meldete „Alle 62 170 Bilder gecacht", während der
Hintergrund-Job gerade hunderte Katalogbilder nachlud. Der Titel verspricht
aber alles, was vom CDN kommt.

`image_wanted` ist die Warteschlange des Jobs (jobs/imageQueue.ts): Jede
Bildanfrage über den Proxy hinterlässt dort eine Notiz.
```

<a id="get-admin-jobs-letzterlauf"></a>
## `letzterLauf`

```text
── „läuft" heisst: hat kürzlich etwas getan ─────────────────────────────

Marcos Befund: „Der Job scheint zu laufen laut Monitoring und
Fortschrittsbalken, aber im Log sind keine Einträge dazu zu finden."

Die Kachel meldete „läuft", sobald die Warteschlange nicht leer war
(Nachtrag 108). Das ist keine Aussage über TÄTIGKEIT: Eine
steckengebliebene Warteschlange sah genauso aus wie eine, die abgearbeitet
wird. Jetzt zählt der Zeitpunkt des letzten Durchgangs — bleibt er aus,
steht die Kachel auf „idle" und nennt den Grund.

── Der Stand kommt aus der DATENBANK (Nachtrag 121) ─────────────────────

Marcos Kachel meldete „Job noch nicht gelaufen", während im Log gerade
fünf Durchgänge standen. Hier stand vorher

    const { letzterLauf } = require('../../jobs/imageQueue');

— also ein Blick in den ARBEITSSPEICHER des Prozesses, der diese Anfrage
gerade bedient. Gesetzt wird der Merker aber nur dort, wo der Job läuft
(Primär-Worker). Bei vier Workern war die Antwort in drei von vier Fällen
`null`. Der Job schrieb in `global_settings`, sobald er etwas getan hat;
von dort sehen ihn alle Worker.
```

<a id="get-admin-img-probe"></a>
## `get-/admin/img-probe`

```text
GET /api/v1/admin/img-probe?url=…

Fragt eine Bild-URL vom SERVER aus ab und meldet, was das CDN antwortet —
mit Referer, ohne Referer und ganz ohne Kopfzeilen. Damit lässt sich der
Unterschied zwischen „Bild fehlt", „Hotlink-Schutz" und „Server kommt gar
nicht raus" belegen, statt ihn zu vermuten.

Entstanden, weil Minifiguren-Bilder über den Proxy fehlschlugen, während
dieselbe URL im Browser lud. Ohne Sicht auf die Serverantwort war das nicht
zu entscheiden.
```

<a id="get-admin-img-probe-2"></a>
## Abschnitt

```text
Dieselbe Host-Allowlist wie der Bild-Proxy.

Ohne sie holt diese Route JEDE https-Adresse über den Server — auch
interne, die von aussen nicht erreichbar sind (Datenbank-Oberflächen,
Metadaten-Endpunkte der Cloud, Nachbardienste im Docker-Netz). Dass nur
Admins sie aufrufen dürfen, macht das nicht harmlos: Ein Admin-Konto ist
genau das Ziel, das ein Angreifer zuerst übernimmt, und die Antwort
(Status, Kopfzeilen, erste 64 KB) reicht zum Abtasten des internen Netzes.
Eine Liste, zwei Aufrufer: Die Kopie hier ist durch den gemeinsamen Helfer
aus routes/imgProxy.ts ersetzt — sonst wird beim nächsten neuen CDN genau
eine der beiden Stellen nachgezogen.
```

<a id="get-admin-img-probe-head"></a>
## `head`

```text
Was würde der Proxy AUSLIEFERN? Ein Abruf durch dieselbe Kette wie im
Bild-Proxy, aber statt zum Client gehen die ersten Bytes hierher — als Hex.

Grund: Der Server meldet 200, das CDN liefert 200, nichts steht im Log, und
der Browser zeigt trotzdem nichts. Der einzige Blickwinkel, der bisher
fehlte, ist der tatsächliche Inhalt.

  FF D8 FF …  gültiger JPEG-Anfang
  89 50 4E 47 gültiger PNG-Anfang
  1F 8B …     gzip — dann liegt es an der Komprimierung
  3C 21 44 …  "<!D" — eine HTML-Seite statt eines Bildes
```

<a id="get-admin-price-probe"></a>
## `get-/admin/price-probe`

```text
GET /api/v1/admin/price-probe?set=10290-1

Zeigt für ein Set alles, was in die Marktpreis-Anzeige einfliesst:
Erfassungen, gespeicherter Zustand, sämtliche price_cache-Zeilen und — auf
Wunsch — was BrickLink gerade antwortet.

Entstanden nach mehreren Runden, in denen ein zu niedriger Preis angezeigt
wurde und nicht zu klären war, ob es an der Zustandswahl, am Cache oder an
der BrickLink-Antwort liegt. Wie beim Bild-Proxy gilt: erst messen.

`&live=1` fragt BrickLink zusätzlich direkt ab (kostet Kontingent).
```

<a id="get-admin-price-probe-anyused"></a>
## `anyUsed`

```text
Welchen Zustand würde die Bewertung wählen? Dieselbe Regel wie
conditionFromAcquisitions() in src/bestand/gemeinsam.ts: Eine gebrauchte
Erfassung genügt, sonst Neu.

Die Probe zeigte hier zweimal eine überholte Regel — erst „nur
sets.condition zählt", dann „ohne Erfassungen zählt sets.condition". Beide
Male war es derselbe Fehler: eine ZWEITE Abschrift der Zustandsregel, die
nicht mitgepflegt wurde. Seit Migration 0032 gibt es die Spalte nicht mehr,
und damit auch keinen dritten Fall, der auseinanderlaufen könnte.
```
