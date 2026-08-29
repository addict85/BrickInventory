# Nachträge 101–125

Teil der Fix-Historie — Übersicht in [CHANGELOG-fixes.md](../CHANGELOG-fixes.md).

---

## Nachtrag 101 (hardened-197) — Der Katalog erzeugt gar keine Vorschauen mehr

Marcos Frage: „Der Proxy sollte das Bild, wenn er es vom CDN holen muss, in
Originalgrösse weitergeben und die Bilder mit einem Job nachladen und das Thumb
erstellen. Dadurch sollte die Last doch klein bleiben?"

Sein Modell ist richtig — und der Proxy hält es bereits ein. Nachgesehen:

    // Original liegt vor, Verkleinerung fehlt noch. NICHT darauf warten:
    // Das Original geht sofort raus, die Verkleinerung entsteht in der
    // Warteschlange und steht ab dem nächsten Aufruf bereit.

Keine Anfrage wartet also auf Jimp. Die Last kam von einer anderen Stelle:
Der Proxy stiess für JEDES neue Bild eine Verkleinerung an — und der Katalog
zeigt rund 25 000 fremde Sets. Der „Job im Hintergrund" lief, er hatte nur
25 000 Aufträge.

### Die Frage, die ich nie gestellt hatte

Wofür genau ist die Verkleinerung da? Für einen Bestand von ein paar hundert
Bildern, die man täglich wiedersieht, lohnt sie: einmal rechnen, oft sparen.
Für 25 000 Katalog-Sets, an denen man vorbeiscrollt, lohnt sie nie — man sieht
jedes davon höchstens ein Mal.

`imgUrl(src, thumb)` kennt jetzt einen dritten Wert:

    false   volle Auflösung
    true    Vorschau; fehlt sie, wird sie erzeugt   → eigener Bestand
    'nur'   Vorschau NUTZEN, aber keine erzeugen    → Katalog

Serverseitig entspricht dem `&gen=0`. Damit löst Blättern im Katalog KEINE
Verkleinerung mehr aus; wo eine existiert (weil das Set im Bestand ist), wird
sie weiter benutzt. Das Original geht ohnehin sofort raus.

### Zusammen mit den Nachträgen davor

    95   Bild-Warteschlange des Katalogs gedeckelt
    98   fehlende Bilder prozessübergreifend gemerkt
    99   Vorschau-Parallelität von 2 auf 1
    100  Sperre über die Datenbank — EINE Verkleinerung serverweit
    101  Katalog erzeugt gar keine mehr

Die ersten vier haben die Arbeit begrenzt. Diese hier lässt sie weg.

### Test

`set-value` prüft beide Hälften: dass der Proxy das „nutzen, nicht erzeugen"
überhaupt kennt, dass die Katalog-Kachel es benutzt — und dass die Galerie es
NICHT tut, dort lohnt die Verkleinerung ja.

`catalog-local-images` nagelte `true` fest; umformuliert auf `'nur'`. Die
geprüfte Aussage bleibt dieselbe: Kachel über den Proxy, nicht roh vom CDN.

623 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 102 (hardened-198) — Bilder und Vorschauen entstehen im Hintergrund

Marcos Vorgabe: „Ich fänd es sinnvoll, wenn die Bilder lokal gecached werden
inkl. Thumbs. Bitte aber die Bilder im Hintergrund mit dem Bilder-Download-Job
herunterladen und das Thumb erstellen, sobald sie einmal via Proxy geladen
wurden. Das sollte das gleiche Prinzip wie bei den anderen Reitern sein."

Das ist die richtige Aufteilung, und sie korrigiert meinen letzten Nachtrag: Da
hatte ich die Verkleinerung im Katalog GANZ abgeschaltet. Zu grob — wer ein Set
zweimal ansieht, soll beim zweiten Mal das kleine Bild bekommen.

### Was an der Anfrage hing

Der Proxy holte das Bild UND stiess sofort die Verkleinerung an. Bei den eigenen
Sets fiel das nie auf: ein paar hundert Bilder, einmalig. Im Katalog mit 25 000
fremden Sets wurde daraus eine Rechenlawine, die lange nach dem Scrollen
weiterlief.

### Jetzt

* Die Anfrage liefert sofort aus — Vorschau, wenn es sie gibt, sonst das
  Original — und hinterlässt nur eine NOTIZ.
* `jobs/imageQueue.ts` arbeitet die Notizen gestapelt ab: fünf je Durchgang,
  alle 20 Sekunden, nur auf dem Primärprozess. Original ablegen, verkleinern,
  Notiz entfernen.

Die Notizen stehen in der DATENBANK (`image_wanted`), nicht im Arbeitsspeicher.
Sie überleben den Neustart, alle Arbeitsprozesse schreiben in dieselbe, und
dieselbe Adresse zweimal zu notieren kostet nichts. Das ist die Lehre aus den
Nachträgen 98 bis 100, wo Grenzen je Prozess galten und deshalb nicht wirkten.

Fehlschläge werden nicht wiederholt: Die Notiz verschwindet, und der Merker für
fehlende Bilder (Nachtrag 98) hält fest, dass es dieses Bild nicht gibt.

### Gemessen

Acht Notizen, davon eine doppelt:

    Notizen in der DB      8   (die doppelte fällt weg)
    1. Durchgang           5   Bilder geholt, 5 verkleinert
    Notizen danach         3
    2. Durchgang           3
    Notizen am Ende        0

### Tests

Neu `test/image-queue-db.test.js`: Entdopplung, gestapelte Abarbeitung, keine
Notiz bleibt liegen. Dazu zwei Quelltextregeln — der Proxy notiert im
gen=0-Fall, statt zu rechnen, und der Job steht im Primärprozess-Block. Ohne die
zweite liefe er in jedem Arbeitsprozess, und die Drosselung wäre wirkungslos;
genau dieser Fehler steckte in den Nachträgen 99 und 100. Gegenprobe bestanden.

628 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 103 (hardened-199) — Ich hatte den Verbindungspool leergezogen

Marcos Log, und damit war es endlich klar:

    [route-error] 500: Error: timeout exceeded when trying to connect
        at pg-pool
        at getStats

und gleichzeitig `docker logs | grep -c img-proxy` → praktisch null.

Beide Zeilen zusammen kehren die Diagnose um: NICHT die Bildarbeit war die
Last — es scheiterte eine ganz andere Route daran, keine Datenbankverbindung
mehr zu bekommen. Das erklärt auch Marcos frühere Beobachtung „als könnte der
Server weniger Requests gleichzeitig bearbeiten". Genau das war es.

### Was ich falsch gemacht habe

In Nachtrag 98 und 102 habe ich zwei Nachschläge aus dem Arbeitsspeicher in die
Datenbank verlegt — mit gutem Grund: Im Cluster teilen sich die Prozesse nichts,
und genau daran waren die Nachträge 98 bis 100 gescheitert.

Übersehen habe ich, WIE OFT sie laufen. Bildanfragen sind der häufigste Vorgang
der ganzen Anwendung; eine Kachelwand sind dutzende gleichzeitig. Jede belegte
eine Verbindung aus dem Pool (10–15 je Arbeitsprozess). Ein richtiger Gedanke
am falschen Ort — im heissesten Pfad.

Der Unterschied Android/Webapp, den Marco gemeldet hat, passt dazu: Ein
Telefon zeigt ~8 Kacheln gleichzeitig, ein Desktop-Browser leicht 36.

### Jetzt

Lesen aus dem Arbeitsspeicher, Schreiben gebündelt im Takt:

* `istBekanntFehlend()` ist SYNCHRON und ohne Datenbank. Der Bestand liegt
  vollständig im Speicher und wird alle fünf Minuten aufgefrischt — eine
  Abfrage je Prozess und Intervall statt einer je Bild.
* `merkeFehlend()` und `merkeGebraucht()` puffern; weggeschrieben wird in EINEM
  Statement.

Gemessen:

    60 Kacheln       vorher 120 Abfragen   →   jetzt 0
    Wegschreiben                            →   1 Abfrage
    40 Fehlanzeigen                         →   1 Abfrage

### Nebenbefund: die Sitzungssperre war kaputt

`mitVorschauSperre` (Nachtrag 100) nahm `pg_try_advisory_lock` über den Pool und
gab es über den Pool wieder frei — womöglich auf einer ANDEREN Verbindung. Eine
Sitzungssperre gehört aber der Verbindung, die sie genommen hat: Das Freigeben
auf einer anderen tut nichts, die Sperre bleibt für immer bestehen, und ab dann
entstünde nie wieder ein Vorschaubild. Jetzt eine feste Verbindung für Nehmen,
Arbeiten und Freigeben.

### Tests

Neu `test/image-pool-db.test.js` — er zählt ABFRAGEN, nicht Ergebnisse: 60
Kacheln dürfen null auslösen, das Wegschreiben höchstens eines, und nach
geleertem Speicher muss das Wissen aus der Tabelle zurückkommen. Dazu eine
Quelltextregel für die Sperre auf fester Verbindung. Beide Gegenproben
bestanden.

Drei bestehende Tests umformuliert: Sie riefen `await istBekanntFehlend(...)`
und verliessen sich darauf, dass geschrieben wird, sobald gemerkt wird. Beides
gilt nicht mehr; sie stossen das Wegschreiben jetzt ausdrücklich an.

634 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 104 (hardened-200) — Webp-Bilder wurden bei jedem Ansehen neu versucht

Marcos Log, dieselbe Zeile wieder und wieder:

    [thumb] Vorschau fehlgeschlagen für /images/sets/40393-1.jpg:
            Mime type image/webp does not support decoding

Jimp kann webp nicht entpacken. Scheitert der Versuch, entsteht KEINE Datei —
und beim nächsten Aufruf desselben Bildes sah der Proxy „keine Vorschau da" und
versuchte es erneut. Für jedes webp-Bild also bei jedem Ansehen ein
vergeblicher Anlauf, der das Bild erst einliest und dann aufgibt.

Der vorhandene Schutz `_thumbInFlight` galt nur für die Dauer eines Laufs —
wieder ein Geltungsbereich, der enger ist als das Problem. Dass Rebrickable
webp ausliefert, war dabei nicht der Fehler; der Fehler war, aus einem
Fehlschlag nichts zu lernen.

Jetzt landet er im gemeinsamen Merker (`utils/imageMisses`, Schlüssel
`thumb:<datei>`): prozessübergreifend, über den Neustart hinweg, und nach sieben
Tagen wird es wieder versucht — falls die Bibliothek inzwischen mehr kann.

Gemessen (Ablauf nachgestellt): Fünf Seitenaufrufe ergaben vorher fünf
Versuche, jetzt einen. Nach geleertem Speicher und Nachladen aus der Tabelle
bleibt es bei null.

### Test

`image-pool-db` um eine Regel erweitert: `queueThumb()` fragt den Merker ab, und
der Fehlschlag wird an BEIDEN Stellen festgehalten, an denen er auftreten kann —
in der Vorprüfung (`isDecodable`) und im `catch`. Gegenprobe bestanden.

635 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 105 (hardened-201) — Der zweite, ungebremste Erzeuger

Marcos Zuordnung: „Die CPU ist seit der Umstellung des Katalogs mit dem
Scrolling so stark ausgelastet." Damit war die Suche endlich am richtigen Ort.

### Der Befund

`routes/api_v1/catalog.ts` hatte eine EIGENE Bild-Warteschlange. Sie holte zu
jedem gelisteten Set das Bild und rief `generateThumb()` DIREKT auf — vorbei an
allem, was ich in fünf Nachträgen gedrosselt hatte:

* nicht an `THUMB_MAX_PARALLEL` (das gilt im Bild-Proxy),
* nicht an der Sitzungssperre aus Nachtrag 100 (dito),
* mit eigener Parallelität 2 — bei vier Arbeitsprozessen acht gleichzeitige
  Jimp-Läufe. Das sind die über 300 %.

Dazu ein zweiter direkter Aufruf im Detail-Zweig derselben Datei.

Vor dem Umbau der Liste fiel das nicht auf: Sie zeigte nur, wozu man sich
hingescrollt hatte, also ein paar Seiten. Seit dem Fensterladen kommen bei
jedem Sprung hunderte Sets vorbei — genau der Zusammenhang, den Marco benannt
hat.

### Was ich daraus lerne

Ich habe fünf Nachträge lang die Drosselung des EINEN Erzeugers verfeinert,
während der zweite ungebremst danebenlief. Gefunden hat ihn nicht meine
Vermutung darüber, WAS rechnet, sondern Marcos Hinweis, WANN es angefangen hat.

Die Regel dazu: Bevor man eine Begrenzung verschärft, erst zählen, wie viele
Stellen die begrenzte Arbeit überhaupt anstossen. `grep generateThumb` hätte den
zweiten Erzeuger in zehn Sekunden gezeigt.

### Jetzt

Die Warteschlange ist ersatzlos entfallen, beide direkten Aufrufe ebenso. Der
lokale Cache baut sich weiter auf, nur über den anderen Weg: Bildanfrage über
den Proxy → Notiz → `jobs/imageQueue.ts` legt Bild UND Vorschau an, gebündelt
und nur auf dem Primärprozess. EIN Erzeuger statt zweier, und dieser ist
gedrosselt.

### Tests

Drei bestehende umformuliert, alle in dieselbe Richtung — aus „begrenzt" wird
„gar nicht":

* `catalog-local-images`: Die Datei darf `generateThumb` nicht mehr enthalten;
  der Detail-Zweig meldet beim Job an.
* `catalog-image-queue-db`: Die Liste löst NULL Bild-Aufträge aus (vorher:
  weniger als 200).
* `image-misses-db`: prüft den Merker selbst statt über die Liste.

635 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 106 (hardened-202) — Die Notizen erreichten die Datenbank nie

Marcos Befund: „Ich habe das Gefühl, die Bilder aus dem Katalog werden nicht
heruntergeladen im Hintergrund. Der ‚Bild-Download (CDN)' unter Monitoring zeigt
nicht an, dass er was herunterlädt, und es sind immer gleich viele Bilder im
Ordner images/sets."

Er hatte recht, und es war mein eigener Fix von zwei Nachträgen zuvor.

### Der Fehler

`merkeGebraucht()` puffert die Notizen im ARBEITSSPEICHER — das war richtig, ein
INSERT je Bildanfrage hatte den Verbindungspool geleert (Nachtrag 103). Das
Wegschreiben hing aber an `start()`, und `start()` läuft nur auf dem
PRIMÄRPROZESS.

Bildanfragen verteilen sich über alle vier Arbeitsprozesse. Drei Viertel aller
Notizen wurden also nie geschrieben — und was der Primär notierte, nur wenn er
die Anfrage zufällig selbst bediente. Da die Warteschlange in Nachtrag 105
ausserdem der einzige verbliebene Weg war, kam gar nichts mehr an.

Derselbe Geltungsbereichs-Fehler wie in den Nachträgen 98 bis 100 und 105:
Etwas Prozess-LOKALES an etwas Prozess-GLOBALES gehängt. Diesmal habe ich ihn
selbst eingebaut, in genau der Änderung, mit der ich einen anderen Fall davon
behoben habe.

### Jetzt

Der Takt zum Wegschreiben steht in `initImageQueue()` — das läuft beim Aufbau
der Datenbank und damit in JEDEM Arbeitsprozess. `start()` bleibt für das
ABARBEITEN zuständig und damit beim Primär: Der Puffer ist je Prozess, das
Abarbeiten ist es nicht.

### Gemessen

Ganze Kette, Notiz in einem Prozess, der `start()` NIE aufgerufen hat:

    Notizen sofort in der DB   0   (gepuffert, wie gewollt)
    nach dem Takt              6
    Bilder geholt/verkleinert  6 / 6
    Notizen übrig              0

### Test

`image-queue-db` um eine Regel erweitert: Das Wegschreiben steht in
`initImageQueue()`, diese wird beim Datenbankaufbau gerufen, und das Abarbeiten
steht im Primärprozess-Block. Gegenprobe bestanden.

636 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 107 (hardened-203) — Die Tabellen wurden nie angelegt

Marcos Ausgabe, auf einem Server mit der AKTUELLEN App-Version:

    ERROR:  relation "image_wanted" does not exist

### Warum

Ich hatte die Tabellen am Ende von `initSchema()` angelegt. Die läuft aber nur,
wenn sich die App-VERSION geändert hat (`schema_meta`) — und der Aufruf stand
hinter einem `.catch(...)`, das Fehler bloss protokolliert.

Schlug er beim ersten Start einer Version fehl, wurde die Version trotzdem als
„angewandt" vermerkt. Danach wurde `initSchema()` nie wieder ausgeführt, und
damit auch der Tabellenaufbau nie wieder versucht. Ein einziger stiller
Fehlschlag schaltete den Bild-Job dauerhaft ab — und alles, was ich seither
gebaut habe, lief bei Marco ins Leere.

Die Datei `db/migrate.ts` beschreibt in ihrem Kopf genau dieses Problem und
bietet die Lösung an: nummerierte Migrationen, die IMMER laufen und EINZELN
vermerkt werden. Ich hatte den vorgesehenen Weg nicht benutzt.

### Jetzt

`db/migrations/0009-bild-tabellen.sql` legt beide Tabellen an. Die
init-Funktionen legen nichts mehr an; sie laden nur noch den Bestand in den
Speicher und setzen ihre Takte — und sie laufen NACH den Migrationen (sonst
fehlte die Tabelle beim Laden) und AUSSERHALB von `initSchema()` (sonst nur in
dem einen Worker, der gerade migriert).

### Gemessen

Marcos Lage nachgestellt — Tabellen gelöscht, Version als angewandt vermerkt:

    ✅ Migration angewandt: 0009-bild-tabellen.sql
    image_wanted -> angelegt
    image_misses -> angelegt

### Test

`image-queue-db` um eine Regel erweitert: Die Tabellen stehen in der Migration
und NIRGENDWO sonst; die init-Aufrufe laufen nach `runMigrations` und ausserhalb
von `initSchema()`.

637 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 108 (hardened-204) — Katalog-Bilder in der Kachel; Rate auf 60/min

Zwei Wünsche von Marco, nachdem die Kette endlich lief.

### 1. Die Kachel sagte nichts über den Katalog

„Ich fände es sprechend, wenn diese in der Kachel ‚Bild-Download (CDN)'
enthalten sind, da der Titel nichts von meinen Sets aussagt."

Er hat recht: Die Kachel zählte ausschliesslich Bilder des eigenen BESTANDES
und meldete „Alle 62 170 Bilder gecacht", während der Hintergrund-Job gerade
hunderte Katalogbilder nachlud. Der Titel verspricht aber alles, was vom CDN
kommt.

Jetzt kommt die Warteschlange aus `image_wanted` dazu:

    ohne offene Bilder   status=done     "Alle 62170 Bilder gecacht"
    mit 137 offenen      status=running  "Bestand: … · 137 Katalog-Bilder in
                                          Warteschlange"

Drei Details, die daran hängen:

* „Bestand:" steht nur davor, wenn Katalogzahlen daneben stehen — sonst liesse
  sich nicht sagen, worauf sich welche Zahl bezieht.
* Der Status wird `running`, sobald etwas in der Warteschlange steht. Vorher
  hätte die Kachel „fertig" gemeldet, während sie lud.
* Der Balken bezieht die Warteschlange in `total` ein, sonst stünde er auf
  100 %, während noch hunderte Bilder ausstehen.

### 2. Rate von 15 auf 60 Bilder je Minute

Marcos Messung: CPU im Leerlauf bei 0 %. `STAPEL` von 5 auf 20 (alle 20
Sekunden). Die ursprünglichen 5 waren bewusst zurückhaltend, solange unklar
war, woher die Last kam — diese Frage ist mit den Nachträgen 103 bis 107
beantwortet.

### Tests

Neu in `image-queue-db`: die Kachel in beiden Zuständen (leer und mit 137
offenen), samt Status, Beschriftung und Balkengrundlage. Gegenprobe bestanden.

Der bestehende Stapel-Test verlangte „weniger als 8 in einem Durchgang" — eine
Zahl, die zur alten Stapelgrösse gehörte. Er liest sie jetzt aus der Quelle:
Die geprüfte REGEL ist „nicht alles auf einmal", nicht „genau fünf".

Eigene Falle dabei: Der erste Test der Datei schloss den Verbindungspool in
seinem `finally`. Der neue Kachel-Test lief danach ins Leere („Cannot use a pool
after calling end"). Jetzt schliesst der LETZTE DB-Test.

638 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 109 (hardened-205) — Ein Wettlauf im Dialog, und vermeidbare 404er

Aus Marcos Browser-Konsole zwei Funde.

### 1. TypeError beim Schliessen des Set-Dialogs

    [promise] TypeError: Cannot read properties of null (reading 'minifigs')

Als `[promise]` gemeldet, also aus einer Fortsetzung. `openModal()` fragt die
Minifiguren-Zahl nach, NACHDEM der Dialog schon steht — die Abfrage geht über
alle Minifiguren und dauert. Wer den Dialog vorher schliesst, setzt `curSet` auf
null, und die späte Antwort läuft in den Fehler.

Die vorhandene Prüfung auf das ELEMENT genügte nicht: Öffnet man ein ANDERES
Set, gibt es das Element weiterhin — die Zahl landete dann im falschen Dialog.
Ein Fehler, den man nicht als Absturz sieht, sondern als falsche Zahl.

Verglichen wird jetzt die Setnummer: Nur wenn noch dasselbe Set offen ist,
gehört das Ergebnis dorthin.

### 2. Dieselben 404er immer wieder

In der Konsole steht dieselbe Adresse mehrfach hintereinander, etwa
`9780241838570-1.jpg` gleich zweimal.

Ein 404 OHNE `Cache-Control` ist für den Browser nicht zwischenspeicherbar: Er
fragt bei jedem Rendern der Kachel erneut. Beim Blättern durch alte Jahrgänge,
wo fast jedes Bild fehlt, ist das ein voller Satz Anfragen je Bildschirm — bis
zum Server, dort in den Merker und wieder zurück.

Jetzt trägt der 404 eine Stunde Gültigkeit. Bewusst kurz: Wird ein Bild
nachgereicht, soll es nicht einen Tag lang unsichtbar bleiben. Der SERVER merkt
sich die Fehlanzeige länger (sieben Tage) — dort kostet ein erneuter Versuch ja
auch mehr.

Ein 403 bekommt den Hinweis NICHT: Das ist eine Drosselung, kein fehlendes Bild
— dasselbe Argument wie beim serverseitigen Merker.

### Tests

Zwei neue Regeln, beide mit bestandener Gegenprobe: Die späte Antwort prüft die
Setnummer, und der 404 trägt den Cache-Hinweis auf BEIDEN Wegen (Treffer im
Merker und Absage vom CDN), der 403 nicht.

640 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 110 (hardened-206) — Das Jahres-Etikett klebte in allen Reitern

Marcos Bild: „2027" steht in der GALERIE oben rechts, ohne dass jemand zieht.

Zwei Ursachen, beide in meinem Code.

### 1. Eine Inline-Angabe schlägt jede CSS-Regel

Die Regel zeigt das Etikett nur während `.dragging`. `rollen()` setzt aber
`style.display` DIREKT am Element — und eine Inline-Angabe gewinnt gegen jede
Regel. Nach dem Loslassen blieb sie stehen, also blieb auch das Etikett stehen,
in JEDEM Reiter und an der Stelle, wo man zuletzt losgelassen hat.

Der Ende-Handler nimmt sie jetzt wieder weg (`style.display = ''`), damit die
Regel wieder zuständig ist.

### 2. Der Katalog meldete sich nie ab

`setScrollLabel()` wurde beim Betreten des Katalogs gesetzt und nie
zurückgenommen. Die Funktion lieferte weiter ein Jahr — auch in der Galerie, wo
die Zahl nichts bedeutet. Beim Reiterwechsel wird jetzt abgemeldet.

Beide zusammen: Ohne (1) klebt das Etikett, ohne (2) enthält es beim nächsten
Ziehen eine Zahl aus dem falschen Zusammenhang. Deshalb sind beide nötig.

### Test

Zwei Regeln in `app-scrollbar`, beide mit bestandener Gegenprobe.

Eigene Falle dabei, und ausgerechnet die bekannteste: Der erste Entwurf schnitt
den Ende-Handler mit einem festen Zeichenfenster aus und traf die geprüfte Zeile
nicht, weil die Begründung im Kommentar länger ist als das Fenster. Jetzt wird
bis zum Ende des Handlers geschnitten — dieselbe Lehre wie bei den
Kotlin-Prüfungen: nie nach fester Länge, immer bis zur Struktur.

642 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 111 (hardened-207) — Knopf „Katalogbilder holen", und die Vorschauen dazu

Marcos Wunsch: „Kannst du im Monitoring beim Bilder-Download-Job noch einen
Button erstellen. Wenn dieser geklickt wird, sollen alle fehlenden Bilder des
Katalogs heruntergeladen werden resp. in die Queue gestellt werden. Bitte auch
prüfen, dass für Katalogbilder jeweils ein Thumbs-Image erstellt wird."

### Der Knopf

Bisher füllte sich der lokale Bildbestand nur beim Blättern: Was man nie
ansieht, wird nie geholt. Für ein gezieltes Vorbefüllen — etwa über Nacht —
fehlte der Anstoss.

Neu `POST /api/v1/admin/catalog-images`. Er REIHT NUR EIN, in einer einzigen
Anweisung, ohne je Datei zu prüfen: Bei 25 000 Sets wären das ebenso viele
Dateizugriffe in einer Anfrage — auf einem Raspberry Pi eine spürbare Blockade.
Sets ohne Bildadresse und solche mit bekannter Fehlanzeige bleiben aussen vor.

Die Rückmeldung nennt die Zahl der WARTENDEN Bilder, nicht „gestartet": Bei
gedrosselten 60 Bildern je Minute dauert ein voller Katalog Stunden, und eine
Erfolgsmeldung wäre irreführend.

### Die Vorschauen

Marcos zweite Frage war berechtigt. Der Job erzeugte sie nur nach einem
Download — für Bilder, die schon vorher lokal lagen (etwa aus der alten
Katalog-Warteschlange), fehlte sie womöglich für immer.

Jetzt prüft der Job beides: Liegt die Datei schon, wird NICHT erneut geladen —
fehlt aber die Vorschau, wird sie nachgeholt. Damit heilt der Knopf zugleich
alle Altbestände ohne Vorschau.

### Gemessen

Zehn Katalog-Sets; eines mit Bild ohne Vorschau, eines mit beidem, eines mit
bekannter Fehlanzeige:

    eingereiht     9   (die Fehlanzeige bleibt aussen vor)
    Downloads      7   (die beiden vorhandenen übersprungen)
    Vorschau nachgeholt für das Bild ohne Vorschau: ja
    Vorschau erneut gerechnet für das mit Vorschau: nein

### Tests

Neu `test/catalog-images-button-db.test.js` mit drei Teilschritten gegen die
echten Routen, dazu eine Prüfung der Verdrahtung: Knopf in der Kachel,
Klick-Handler, Registrierung in der Aktions-Liste und beide Übersetzungen. Ohne
die letzte tut ein Klick nichts, und das fällt erst am Gerät auf. Gegenprobe
bestanden.

647 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 112 (hardened-208) — Drosselung ist keine Fehlanzeige

Marcos Frage: „Wie schätzt du den CDN ein, können so viele Requests abgefragt
werden, oder wird da Cloudflare die IP sperren?"

Die Frage hat einen Fehler aufgedeckt, der ohne sie unbemerkt geblieben wäre.

### Der Fund

`downloadSetImage()` antwortet auf JEDEN Fehlschlag mit `null` — bei 404
(„dieses Bild gibt es nicht") ebenso wie bei 403 („du fragst zu schnell"). Der
Hintergrund-Job leitete daraus eine Fehlanzeige ab und sperrte das Bild für
sieben Tage.

Bei einer Drosselung ist das genau falsch herum: Dann sind die Bilder
VORHANDEN, und ausgerechnet der Ansturm, der die Drosselung auslöst, hätte
hunderte davon dauerhaft ausgesperrt. Ein Knopf, der 25 000 Bilder einreiht,
wäre damit der sicherste Weg gewesen, den halben Katalog dauerhaft bildlos zu
machen.

Der Bild-Proxy unterscheidet die beiden Fälle längst (nur 404 wird gemerkt,
403 nicht) — dem Job fehlte schlicht die Auskunft. `downloadSetImage()` nimmt
jetzt ein optionales Feld entgegen, in das es den Statuscode schreibt;
bestehende Aufrufer bleiben unberührt.

### Was jetzt gilt

    404      → Fehlanzeige, nicht wieder versuchen
    403/429  → fünf Minuten Pause, alle unbearbeiteten Notizen zurück in die
               Warteschlange

Stur weiterzufragen ist genau das Verhalten, das eine Sperre verlängert.

### Eigener Fehler beim Bauen

Der erste Entwurf legte beim Abbruch nur die AKTUELLE Notiz zurück. Der Stapel
wird aber mit `DELETE … RETURNING` geholt — die übrigen neunzehn waren damit
still verloren. Gemessen: 10 Notizen rein, nach der Drosselung war 1 übrig.
Jetzt geht der ganze Rest zurück.

### Gemessen

    403:  0 abgearbeitet, 1 Versuch, 10 Notizen erhalten, 0 Fehlanzeigen
          nächster Lauf: kein weiterer Versuch (Pause greift)
    404: 10 Versuche, 10 Fehlanzeigen

### Test

Neu `test/image-throttle-db.test.js` mit drei Teilschritten. Gegenprobe
bestanden.

651 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 113 (hardened-209) — Schonender Umgang mit dem Bildserver

Marcos vier Vorgaben, alle umgesetzt und gemessen.

    Bilder im Durchgang       10
    gleichzeitige Downloads    1
    Abstände (ms)              754 … 1002
    Rate                       10 je 20 s = 30 je Minute

### Im Einzelnen

**Verzögerung 500–1000 ms.** Zufällig gestreut, nicht fest: Ein exakt gleicher
Abstand ist selbst ein Muster — eine Heuristik, die nach Maschinen sucht,
erkennt Gleichmass leichter als Unregelmässigkeit. Die Pause liegt ZWISCHEN den
Anfragen, nicht vor der ersten, und nur zwischen solchen, die wirklich ans CDN
gehen: Sets mit bereits vorhandener Datei werden vorher abgekürzt und kosten
dort nichts.

**Sequenziell.** War es bereits (`for` mit `await`), ist jetzt aber geprüft —
der Test zählt die Gleichzeitigkeit und verlangt 1.

**30 Anfragen je Minute.** `STAPEL` von 20 auf 10, Takt unverändert 20 s.

**User-Agent.** Hier stand eine vorgetäuschte Chrome-Kennung. Das ist die
schlechteste aller Möglichkeiten: Sie sagt nicht, wer wir sind, und ein
„Browser", der tausende Bilder ohne die üblichen Begleitanfragen holt, fällt
einer Heuristik gerade dadurch auf. Jetzt eine ehrliche Produktkennung mit
Version.

Umschaltbar über `IMG_USER_AGENT`: Ich kann von hier aus nicht ausprobieren, wie
der echte Bildserver auf die neue Kennung reagiert. Sollte er ausgerechnet
Produktkennungen abweisen, lässt sich das ohne neuen Build zurücknehmen.

### Warum unbedingt und nicht erst ab 200 Bildern

Marco hatte die Vorgaben für Läufe über 200 Bildern gestellt. Zwei Verhalten
einzubauen hiesse, beide zu pflegen und zu prüfen — für den Gewinn, beim
Blättern drei Bilder eine Sekunde früher zu haben. Der Vorablauf ist ohnehin
nichts, worauf jemand wartet.

### Was das für einen vollen Durchlauf bedeutet

25 000 Bilder bei 30 je Minute sind rund 14 Stunden. Das ist der Preis der
Vorsicht — und angesichts dessen, dass eine Sperre den Bildbestand für Tage
lahmlegen würde, der richtige.

### Tests

Neu `test/image-politeness-db.test.js` mit vier Teilschritten plus einer Prüfung
des User-Agent: Produktkennung, Version, umschaltbar, und die alte Tarnung darf
nicht zurückkommen. Beide Gegenproben bestanden.

657 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 114 (hardened-210) — Die Version im User-Agent stimmte nicht

Marcos Frage: „Was wird neu als user_agent gesendet?"

Beim Nachsehen — und die Frage war der einzige Grund, warum ich nachgesehen
habe — kam heraus:

    BrickInventoryManager/3.0 (self-hosted; +https://github.com/brickinventory)

„3.0" ist ein Vorgabewert, der seit Jahren nicht stimmt. Gesendet werden sollte
die Version der Installation.

### Die Ursache

`require('../package.json')` löst vom Ordner des MODULS aus auf, nicht vom
Projekt. Übersetzt liegt das Modul unter `dist/routes/`, sucht also
`dist/package.json` — die gibt es nicht, weder hier noch im Container. Der
Fehler landete im `catch`, übrig blieb der Vorgabewert.

Ich hatte diese Zeile aus `db/database.ts` übernommen, wo sie dasselbe Problem
hat. Dort fällt es nicht auf: Für die Schemaversion genügt „unknown", um
Migrationen auszulösen.

Neu `utils/appVersion.ts`: EINE Stelle, die mehrere Orte durchprobiert.

### Gemessen

    BrickInventoryManager/2026.08.23.1015 (self-hosted; +https://github.com/brickinventory)

### Test

Der Test prüft jetzt am ÜBERSETZTEN Stand statt an der Quelle — genau zwischen
beiden lag der Fehler. Er lädt `dist/routes/sets.js`, führt die Funktion mit dem
richtigen Modulkontext aus und vergleicht mit der Version aus package.json.

Gegenprobe: den zweiten Suchort entfernt → „BrickInventoryManager/unbekannt",
Test rot.

Eine Lehre, die ich mir merken sollte: Ein Test, der die QUELLE liest, sieht
nicht, was der übersetzte Stand tut. Bei allem, was von Dateipfaden abhängt,
muss gegen dist/ geprüft werden.

657 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 115 (hardened-211) — Die Vorschau-Sperre nahm dem Pool Verbindungen weg

Marcos Log:

    timeout exceeded when trying to connect … at getSets

Nicht die Bildarbeit scheiterte, sondern eine gewöhnliche Anfrage bekam keine
Datenbankverbindung mehr.

### Die Ursache — mein eigener Fix von Nachtrag 100

`mitVorschauSperre` lieh sich für die Dauer JEDER Verkleinerung eine
Pool-Verbindung. Das war die Korrektur eines echten Fehlers (Nehmen und
Freigeben müssen auf DERSELBEN Verbindung laufen) — nur am falschen Ort geholt.

Der Pool ist auf 10–15 Verbindungen je Arbeitsprozess ausgelegt und dafür da,
ANFRAGEN zu bedienen. Auf dem Primärprozess halten Preis-Job,
Anleitungs-Warteschlange und Teile-Anreicherung ohnehin schon je eine dauerhaft
fest — und dieser Prozess bedient nebenbei Anfragen. Eine weitere, die über die
ganze Jimp-Arbeit gehalten wird, war zu viel.

Dasselbe Muster wie in Nachtrag 103: ein richtiger Gedanke im heissesten Pfad.

Neu `db.eigeneVerbindung()`: eine Verbindung AUSSERHALB des Pools, einmal
aufgebaut und wiederverwendet. Sie kostet eine zusätzlich, dauerhaft — das ist
der Preis dafür, dass eine Sitzungssperre an ihrer Sitzung hängt.

### Dazu: ein fehlender Index

Der Job sucht alle 20 Sekunden die ÄLTESTEN Einträge der Warteschlange. Mit ein
paar Dutzend Zeilen gleichgültig; mit rund 25 000 (nach „Katalogbilder holen")
bedeutet jeder Lauf einen vollständigen Durchgang samt Sortierung — dreimal je
Minute. `db/migrations/0010-image-wanted-index.sql`.

### Gemessen

    Pool vor der Sperre : {"total":2,"idle":2,"active":0}
    Sperre genommen     : true
    Pool mit Sperre     : {"total":2,"idle":2,"active":0}   ← unverändert

### Tests

Zwei neue Regeln (Sperre ohne Pool-Verbindung, Index vorhanden), die alte Regel
aus Nachtrag 100 auf die neue Fassung gezogen. Gegenprobe bestanden.

Eigene Falle, zum zweiten Mal in dieser Reihe: Der erste Test der Datei schloss
den Pool in seinem `finally`, der neue lief danach ins Leere. Jetzt schliesst
der LETZTE DB-Test.

659 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 116 (hardened-212) — Die Pause galt für den billigen Teil, nicht für den teuren

Marcos Log: Zeile um Zeile „[image-queue] N Bilder lokal abgelegt", dazwischen
`Connection terminated due to connection timeout` — bis hin zum
Sitzungsspeicher, der keine Verbindung mehr bekam.

### Der Fehler

Die Verzögerung aus Nachtrag 113 hing an einem Zähler, der nur echte DOWNLOADS
zählte. Lag ein Bild bereits lokal, fehlte ihm aber die Vorschau, lief ein
anderer Zweig: Vorschau rechnen, `continue` — OHNE Pause.

Nach dem Knopf „Katalogbilder holen" ist genau das der Normalfall: Bei Marco
lagen 16 000 Bilder bereits, ihnen fehlte nur die Vorschau. Der Job rechnete
also zehn Verkleinerungen je Durchgang am Stück, ohne Atempause, auf einem
Raspberry Pi.

Eine Verkleinerung ist die TEUERSTE Einzelarbeit im Server. Dass die Pause
ausgerechnet den teuren Teil nicht betraf, war der Fehler — und dass „Bilder
lokal abgelegt" im Log auch dann steht, wenn gar nichts geladen wurde, hat mich
die Lage falsch einschätzen lassen.

### Jetzt

Der Zähler heisst `arbeit` und zählt beides: einen Download ODER eine
Verkleinerung. Zwischen je zwei Schritten liegt die Pause von 500–1000 ms.

### Gemessen

Zehn Sets, Bilder vorhanden, Vorschauen fehlend — Marcos Lage:

    Vorschauen gerechnet   10
    Abstände (ms)          535 … 862
    Dauer                  6691 ms   (vorher: wenige hundert)

### Test

Neuer Teilschritt in `image-politeness-db`, der genau diesen Fall nachstellt.
Gegenprobe bestanden (ohne die Pause: kleinster Abstand 0 ms).

### Zum dritten Mal dieselbe Falle im Test

Der erste Test einer Datei schloss den Pool und nahm das Abfangen zurück; der
neue lief danach ins Leere. Das ist mir jetzt dreimal passiert
(Nachträge 108, 115, 116). Die Regel dazu, damit sie hier steht: In einer
Testdatei mit mehreren DB-Tests räumt NUR DER LETZTE auf — Pool schliessen und
`Module.prototype.require` zurücksetzen gehören dorthin, nirgendwo sonst.

660 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 117 (hardened-213) — Der webp-Merker galt nur im Proxy

Marcos Log, immer wieder dieselben Sets:

    [thumb] Vorschau fehlgeschlagen für /images/sets/5007579-1.jpg:
            Mime type image/webp does not support decoding

### Der Fehler

Jimp kann webp nicht entpacken. In Nachtrag 104 habe ich das gemerkt — aber nur
im Bild-Proxy. Der JOB ruft `generateThumb()` direkt auf und verschluckte den
Fehler (`.catch(() => {})`). Also:

* Es entsteht keine Datei.
* Beim nächsten Durchgang gilt „Bild da, Vorschau fehlt" — erneuter Versuch.
* Nach jedem Klick auf „Katalogbilder holen" wieder.

Für jedes webp-Bild also ein vergeblicher Jimp-Lauf, der die Datei erst einliest
und dann aufgibt. Zum wiederholten Mal derselbe Befund: Der Schutz existierte,
sein Geltungsbereich war zu eng.

### Gemessen

Drei Durchgänge über dasselbe Set, dessen Vorschau nicht gelingen kann:

    vorher   3 Versuche
    jetzt    1 Versuch, Fehlanzeige dauerhaft gespeichert

### Was das NICHT löst

Marcos Zeitfehler kommen von einer ausgelasteten Maschine — `Connection
terminated due to connection timeout` heisst, dass schon der VERBINDUNGSAUFBAU
zu Postgres nicht durchkommt, nicht dass der Pool leer wäre. Dieser Nachtrag
nimmt eine Quelle vergeblicher Rechenarbeit weg; die grundsätzliche Frage
bleibt, ob Jimp auf einem Raspberry Pi das richtige Werkzeug ist. Siehe die
Anmerkung am Ende.

661 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 118 (hardened-214) — Vorschaubilder mit sharp statt Jimp

Marcos Auftrag, nachdem fünf Nachträge Drosselung nicht gereicht hatten.

### Warum

Jimp ist reines JavaScript. Jede Verkleinerung läuft im selben Thread wie alles
andere — auf einem Raspberry Pi die teuerste Einzelarbeit im ganzen Server. Ich
habe sie in den Nachträgen 95, 99, 100, 113 und 116 immer weiter gedrosselt, und
am Ende blieb: dreissig Läufe je Minute sind immer noch zu viel, weil jeder
einzelne teuer ist.

Die Drosselung war jedes Mal richtig — sie hat nur ein Werkzeugproblem
verwaltet.

### Gemessen (PNG 1200×900 mit Transparenz)

    sharp     16 ms
    Jimp     566 ms          → Faktor 35

    webp:  sharp  12 ms
           Jimp   „Mime type image/webp does not support decoding"

Der webp-Fehler ist genau der, der in Marcos Log immer wieder auftauchte
(Nachträge 104 und 117 haben ihn nur GEMERKT, damit er nicht wiederholt wird —
jetzt tritt er gar nicht mehr auf).

sharp rechnet ausserdem im libuv-Threadpool, also AUSSERHALB des Event-Loops.
Das ist der eigentliche Gewinn: nicht nur schneller, sondern nicht mehr im Weg.
Genau daran hingen Marcos `Connection terminated due to connection timeout` —
selbst der Verbindungsaufbau zu Postgres kam nicht mehr durch.

### Jimp bleibt als Rückfall

sharp lädt eine fertige Binärdatei für Plattform und C-Bibliothek. Steht für
eine Plattform keine bereit, wäre der Ausfall sonst total — keine Vorschau mehr,
nirgends. `verkleinern()` fällt dann auf den alten Weg zurück und schreibt eine
Warnung ins Log.

Der Rückfall greift NUR beim Laden von sharp, nicht bei einem defekten Bild:
Ein defektes Bild soll scheitern und gemerkt werden, nicht zweimal gerechnet.

### Erhalten geblieben

Die drei Eigenschaften, die über Jahre erkämpft wurden, prüft der Test
ausdrücklich: mittiger Zuschnitt (`fit: 'cover'`), weisser Grund statt schwarz
bei Transparenz (`flatten`), und das unteilbare Schreiben über eine temporäre
Datei mit `rename` (Nachträge 41 und 48).

### Dockerfile

Der Kommentar dort beschrieb ausdrücklich, dass NICHTS im Abhängigkeitsbaum
nativ ist. Das stimmt nicht mehr und ist nachgezogen — samt der Warnung, dass
`npm ci` hier ohne `--ignore-scripts` laufen muss, weil sharp sonst seine
Binärdatei nicht lädt und jede Vorschau still über den langsamen Rückfall liefe.

### Drosselung vorerst unverändert

`STAPEL = 10`, Takt 20 s — 30 Bilder je Minute. Die Zahlen können jetzt deutlich
hoch, aber das gehört gemessen und nicht geraten: erst einspielen, `docker
stats` ansehen, dann entscheiden.

Ein bestehender Test verlangte wörtlich `await bg.write(tmpThumb` in BEIDEN
Erzeugern. Umformuliert auf die Aussage — geschrieben wird auf den temporären
Namen — statt auf eine bestimmte Bibliothek.

664 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 119 (hardened-215) — Der Knopf reihte immer den ganzen Katalog ein

Marcos Befund: „Wenn ich auf den Button klicke, werden immer ca. 29 000 Bilder
eingereiht. Auch wenn der Job bereits einmal erfolgreich durchgelaufen ist."

### Warum

Die Route reihte alles ein, was eine Bildadresse hatte und keine Fehlanzeige
trug — ob die Datei schon lokal liegt, prüfte sie NICHT.

Die Begründung, die ich in Nachtrag 111 dafür notiert habe, war zu kurz
gedacht: Ich wollte 25 000 einzelne Dateizugriffe in einer Anfrage vermeiden —
das ist richtig — und habe daraus geschlossen, gar nicht zu prüfen. Dabei geht
es EINMAL: Ein Verzeichnis lesen liefert alle Namen in einem Zug.

Der Job arbeitete das Ergebnis korrekt ab (Datei da → überspringen), aber die
Kachel zeigte Zehntausende offene Bilder, und jede Notiz kostete einen
Durchgang.

### Jetzt

Ein Verzeichnislesen, daraus die Menge der FERTIGEN Sets — Original UND
Vorschau. Fehlt die Vorschau, gehört das Set weiter in die Warteschlange; der
Job holt sie dann nach, ohne erneut zu laden.

Verglichen wird mit derselben Namensregel wie in `downloadSetImage()`
(`[^a-z0-9-]` → `_`). Ohne die verglichen wir Setnummern mit Dateinamen und
fänden nie eine Übereinstimmung.

### Gemessen

Zwanzig Sets, dann „Job läuft durch": 15 mit Bild und Vorschau, 3 nur mit Bild:

    1. Klick   queued 20, skipped  0
    2. Klick   queued  5, skipped 15

Die fünf sind die drei halben und die zwei unberührten — genau richtig.

### Rückmeldung

Der Toast nennt jetzt beide Zahlen. Ohne die zweite sähe „0 Bilder in der
Warteschlange" nach einem Fehlschlag aus, obwohl es die beste aller Meldungen
ist: alles ist da.

### Tests

Zwei neue Teilschritte, darunter der entscheidende: Nach einem vollständigen
Durchlauf reiht ein Klick NICHTS mehr ein. Gegenprobe bestanden (ohne die
Prüfung: 9 statt 0).

Eigene Falle: Mein neuer Teilschritt leerte die Warteschlange, und der darauf
folgende fand nichts mehr zu tun. Er stellt sie jetzt am Ende wieder her —
Teilschritte in einer Datei laufen der Reihe nach und teilen den Zustand.

665 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.
## Nachtrag 120 (hardened-216) — Der Job arbeitete, sagte es aber nicht

Marcos Befund: „Der Bild-CDN-Job scheint zu laufen laut Monitoring und
Fortschrittsbalken, aber im Log sind keine Einträge dazu zu finden."

Zwei Ursachen, beide von mir gebaut.

### 1. Das Schweigen war eingebaut

Der Takt meldete nur, wenn etwas GELADEN wurde. Ein Durchgang, der zehn Notizen
abarbeitet und alle überspringt — weil Bild und Vorschau längst liegen —, sagte
nichts.

Ausgerechnet wenn der Job am schnellsten arbeitet, schwieg er am lautesten. Von
aussen sah das aus wie ein hängender Job, obwohl die Warteschlange schrumpfte.

Der Durchgang liefert jetzt eine Aufschlüsselung statt einer nackten Zahl, und
der Takt meldet jeden Durchgang mit Inhalt:

    [image-queue] 10 bearbeitet: 3 geladen, 2 Vorschau erzeugt, 5 bereits vorhanden

### 2. Die Kachel meldete Betrieb, den sie nicht kannte

„läuft" hiess seit Nachtrag 108: die Warteschlange ist nicht leer. Das ist keine
Aussage über TÄTIGKEIT — eine steckengebliebene Warteschlange sah genauso aus
wie eine, die abgearbeitet wird. Die Anzeige konnte den Unterschied gar nicht
kennen, und genau daran ist Marco hängengeblieben.

Jetzt zählt der Zeitpunkt des letzten Durchgangs. Bleibt er aus, steht die
Kachel auf „idle" UND nennt den Grund: „Job noch nicht gelaufen" oder „seit
N min kein Durchgang".

Festgehalten wird er im Durchgang selbst, nicht im Takt: Wer ihn ausführt, hat
gearbeitet — gleich, von wo er gerufen wurde.

### Tests

Neu: Der Takt meldet auch reine Übersprünge; die Kachel unterscheidet
„Warteschlange gefüllt" von „Job tätig". Beide Gegenproben bestanden.

Vier bestehende Testdateien lasen den Rückgabewert als Zahl. Sie lesen jetzt
das Feld, das ihre jeweilige Aussage trägt (`.gesamt`) — umformuliert, nicht
abgeschaltet.

666 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

---
## Nachtrag 121 (hardened-217) — Das Kontingent galt für Notizen statt für Anfragen

Marcos Log, fünfmal hintereinander:

    [image-queue] 10 bearbeitet: 0 geladen, 0 Vorschau erzeugt, 10 bereits vorhanden

daneben in der Kachel: `1113 Katalog-Bilder in Warteschlange · Job noch nicht
gelaufen`. Seine Frage: „Wieso ist die Verarbeitung so langsam? Anscheinend wird
ja nichts abgearbeitet?"

Abgearbeitet wurde durchaus — die Warteschlange schrumpfte um zehn je Durchgang.
Es war nur die langsamste denkbare Art, nichts zu tun.

### 1. Übersprünge verbrauchten das CDN-Kontingent

`jobs/imageQueue.ts`

Die Taktung stand fest: `STAPEL = 10` Notizen je `TAKT_MS = 20_000`. Das sind
dreissig je Minute, also gut 37 Minuten für Marcos 1113 — davon praktisch die
ganze Zeit Warten.

Die Dreissiger-Grenze ist Marcos Vorgabe gegen eine Sperre durch das CDN („nur
30 Requests pro Minute", Nachtrag 113). Gezählt wurden aber NOTIZEN. In diesen
fünf Durchgängen gab es null CDN-Anfragen: Für alle zehn lagen Bild und Vorschau
längst in `data/images/sets/`. Zwanzig `existsSync`-Aufrufe, wenige
Millisekunden, danach knapp zwanzig Sekunden Stillstand.

Innerhalb eines Stapels war der Zuschnitt längst richtig — der Zähler `arbeit`
sorgt seit Nachtrag 116 dafür, dass Übersprünge keine Höflichkeitspause kosten.
Nur auf den NÄCHSTEN Stapel wirkte er nicht.

Neu `taktDurchgang()`: Ein Takt holt so lange Stapel nach, bis `STAPEL` echte
Arbeitsschritte getan sind (Download oder Verkleinerung), die Warteschlange leer
ist oder `DURCHGANG_MAX_NOTIZEN = 500` erreicht sind. Die Rate am CDN bleibt
damit unverändert bei zehn je zwanzig Sekunden; Marcos 1113 fertige Bilder sind
in gut einer Minute abgeräumt statt in 37.

Der Deckel ist kein Zierrat: `existsSync` ist synchron. Ohne ihn liefe eine
Warteschlange aus 25 000 fertigen Bildern in einem Zug durch und hielte den
Event-Loop des Arbeitsprozesses in Schüben auf.

Die Höflichkeitspause misst jetzt den Abstand zwischen zwei ARBEITSSCHRITTEN,
gleich in welchem Stapel sie liegen (`_letzteArbeit` modulweit statt eines
Zählers je Stapel). Ohne das wäre der erste Arbeitsschritt jedes Folgestapels
ohne Abstand gelaufen — zwei CDN-Anfragen unmittelbar hintereinander, genau das
Muster, das die Vorgabe vermeiden soll.

### 2. „Job noch nicht gelaufen", während im Log Durchgänge stehen

`jobs/imageQueue.ts`, `routes/api_v1/admin.ts`

Der Stand des letzten Durchgangs lag als `letzterLauf` im Arbeitsspeicher des
Moduls. Gesetzt wird er dort, wo der Job läuft (Primär-Worker); gelesen wurde er
in der Monitoring-Route von dem Worker, der die Anfrage zufällig bediente. Bei
vier Workern sah die Kachel in drei von vier Fällen `null` und schloss daraus
auf „noch nicht gelaufen".

Siebte Instanz desselben Musters dieser Reihe: prozesslokaler Zustand im
Cluster. Bitter ist, dass es für genau diesen Zweck `utils/jobMonitor.ts` gibt
(„stores status in PostgreSQL so all cluster workers share state") — die
vorgesehene Ablage wurde umgangen.

Der Takt legt den Stand jetzt unter `global_settings.imgqueue_last_run` ab, die
Route liest von dort. Einmal je Takt und nicht je Stapel: Ein Takt besteht jetzt
aus bis zu fünfzig Stapeln, und ein Schreibvorgang alle paar Millisekunden ist
auf der SD-Karte eines Raspberry Pi keine gute Idee.

### 3. Der Verfall verfiel nicht

Bei `NOTIZ_GILT_MS` stand „Ältere Notizen als diese verfallen". Sie verfielen
nicht: Die Abfrage des Stapels grenzt nur ein, was sie AUSWÄHLT — gelöscht wurde
nie etwas. Notizen älter als drei Tage blieben für immer liegen, zählten weiter
in der Kachel (`COUNT(*)` ohne Frist) und liessen den Job verstummen, weil die
Logzeile an `gesamt > 0` hängt. Von aussen sah das aus wie eine Warteschlange,
die bei einer Zahl stehenbleibt.

Neu `loescheVerfallene()`, stündlich im Takt, mit Logzeile.

### Tests

Neu `test/image-queue-pace-db.test.js` mit sechs Prüfungen: ein Takt räumt
fertige Notizen ab; das Kontingent gilt für echte Arbeit; Übersprünge
verbrauchen es nicht (Marcos gemischte Warteschlange); der Deckel greift;
verfallene Notizen werden gelöscht; und ein ANDERER Prozess sieht den Durchgang
bis hinauf zur Kachel — der Job läuft dafür in einem Kindprozess, gefragt wird
im Elternteil.

EIGENER FEHLER beim Bauen dieses Tests: Die erste Fassung des Kontingent-Tests
reihte zehn zu ladende Bilder ein — die lagen alle im ERSTEN Stapel, also wurde
nie eine Stapelgrenze gemessen. Die Gegenprobe „Pause nur innerhalb eines
Stapels" blieb dadurch grün. Jetzt muss jeder dritte Eintrag geladen werden, der
Rest liegt fertig da, und eine Vorbedingung im Test wird rot, falls die Anfragen
doch wieder in einen Stapel fallen.

ZWEITER Fund dabei: Ein einzelnes `INSERT … generate_series` trägt für ALLE
Zeilen dasselbe `NOW()` ein — `ORDER BY requested_at ASC` ist dann beliebig, und
ein Test, der auf Stapelgrenzen zielt, misst Zufall. Der Einreih-Helfer setzt
`requested_at` jetzt zeilenweise aufsteigend.

Sechs Gegenproben bestanden: nur ein Stapel je Takt; Kontingent auf Notizen;
Pause ganz entfernt; Pause nur innerhalb eines Stapels; Verfall löscht nichts;
Route liest wieder den Modulspeicher; `speichereLauf` entfernt.

Im bestehenden Kachel-Test (`image-queue-db.test.js`) ersetzt ein Löschen der
DB-Zeile das frühere `letzterLauf.zeit = null` — genau diese Zeile hat
mitverdeckt, dass die Kachel eine prozesslokale Zahl las.

675 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

---
## Nachtrag 122 (hardened-218) — Vier stille Ausgänge, ein Zähler für alle

Marcos Log:

    [image-queue] 2 bearbeitet: 0 geladen, 0 Vorschau erzeugt, 0 bereits vorhanden
    [image-queue] 2 bearbeitet: 0 geladen, 0 Vorschau erzeugt, 0 bereits vorhanden

und seine Frage: „Wieso werden die 2 Bilder nicht geladen?"

Die Zahlen gehen nicht auf, und das war kein Zufall. VIER Wege durch die
Schleife in `arbeiteStapel()` endeten, ohne einen der drei Zähler zu erhöhen:

1. Notiz ohne Setnummer (`if (!r.set_number) continue`)
2. Verkleinerung gescheitert (der Erfolgsfall zählt, der Fehlschlag nicht)
3. Download gescheitert (404, Netzwerkfehler, zu kleine Antwort)
4. Abbruch nach einer Drosselung durch das CDN

Die Meldung konnte die vier nicht unterscheiden und meldete für alle dasselbe
Nichts. Aus dieser Zeile ist die Frage nicht zu beantworten — und das ist der
eigentliche Fehler, nicht die zwei Bilder.

Das ist derselbe Befund wie in Nachtrag 120, eine Ebene tiefer: Dort schwieg der
Job, wenn nichts GETAN wurde; hier schweigt er, wenn etwas SCHIEFGING.

### 1. Ein Zähler je Ausgang

`jobs/imageQueue.ts`

`StapelErgebnis` bekommt `nichtGeladen`, `keineVorschau`, `bekanntFehlend`,
`ohneNummer` und `zurueckgelegt`. Neu `meldung(e)` als EINZIGE Stelle, die den
Text baut — genannt wird, was nicht null ist:

    [image-queue] 2 bearbeitet: 0 geladen, 0 Vorschau erzeugt, 0 bereits vorhanden, 2 Download fehlgeschlagen

Bei wenigen Fällen (bis fünf) nennt eine zweite Zeile die Setnummern beim Namen:

    [image-queue] 4287-1: Download fehlgeschlagen (HTTP 404) · 6285-1: Vorschau fehlgeschlagen

Eine Zahl sagt „zwei sind gescheitert", nicht WELCHE. Mit der Setnummer
beantwortet `GET /api/v1/admin/image-diag/:setNumber` (Nachtrag 50) den Rest in
einer Antwort.

Neu `leeresErgebnis()` als einzige Stelle, an der die Zähler aufgezählt werden —
sonst wird beim nächsten Zähler eine der drei Fundstellen vergessen.

### 2. Zurückgelegt ist nicht bearbeitet

`erg.gesamt` stand auf `rows.length` — auch dann, wenn der Stapel schon an der
ERSTEN Zeile in eine Drosselung lief und alle zehn Notizen zurück in die
Warteschlange gingen. Im Log stand dann „10 bearbeitet", obwohl null Zeilen
verbraucht waren. Genau diese Kombination erklärt Marcos zwei identische Zeilen
im Abstand der Drosselpause. Jetzt `rows.length - zurueckgelegt`, und der Takt
meldet auch einen Durchgang, der NUR zurückgelegt hat.

### 3. Bekannt Aussichtsloses kostet weder Kontingent noch Wartezeit

`merkeFehlend('set:…')` wurde geschrieben, aber im Job nirgends gelesen — der
Knopf „Katalogbilder holen" achtet darauf (per SQL), der Job nicht. Eine Notiz,
die über den Proxy erneut entsteht, löste deshalb bei jedem Durchgang wieder
einen Roundtrip zu einem Bild aus, von dem längst feststand, dass der CDN es
nicht hat. Jetzt `istBekanntFehlend('set:…')` VOR der Pause.

Dasselbe bei den Vorschauen: Die Prüfung stand INNERHALB von
`vorschauErzeugen()`, also hinter Pause und Kontingent. Eine Verkleinerung, die
nie gelingen kann, kostete bei jedem Durchgang eine Höflichkeitspause UND einen
Platz im CDN-Kontingent — für einen Aufruf, der sofort `false` zurückgibt. Zehn
solcher Notizen verbrauchten einen ganzen Takt mit reinem Schlafen. Beide
Prüfungen stehen jetzt vor beidem: Was den CDN nichts kostet, darf ihn auch
nichts kosten.

### Tests

`test/image-queue-pace-db.test.js` um „jeder Ausgang der Schleife hat einen
Zähler" erweitert (Notiz ohne Setnummer, gescheiterter Download, bekannt
fehlendes Bild ohne Kontingent und ohne Wartezeit).
`test/image-throttle-db.test.js` prüft im 403-Fall jetzt auch, dass `gesamt` auf
null steht und `zurueckgelegt` die zehn nennt.

EIGENE FALLE: Der erste Anlauf stellte `downloadSetImage` im Teilschritt per
`Object.defineProperty` auf null um — wirkungslos, weil der require-Abfang oben
in der Testdatei für diesen Namen IMMER seinen eigenen Ersatz liefert und den
Patch stillschweigend überschreibt. Dieselbe Klasse wie die esbuild-Getter aus
Nachtrag 143. Aufgefallen ist es nur, weil der Test die WIRKUNG prüft und nicht
den Patch. Der Ersatz trägt den Schalter jetzt selbst.

UMFORMULIERT: „der Job meldet auch reine Übersprünge" (Nachtrag 120) hing am
WORTLAUT der Takt-Funktion — `if (e.gesamt)` und der Name `uebersprungen` im
Meldungstext. Als die Meldung nach `meldung()` wanderte, wurde der Test rot,
ohne dass sich seine Aussage geändert hätte; dieselbe Sorte Test, die in
Nachtrag 118 eine Sicherheitslücke festgeschrieben hat. Geprüft wird jetzt, was
der Text SAGT, plus die Gegenrichtung, dass der Takt nicht auf `e.geholt` gatet
und den Text nicht selbst zusammenbaut.

Zehn Gegenproben bestanden (die sechs aus Nachtrag 121 plus: `ohneNummer` zählt
nicht, `nichtGeladen` zählt nicht, bekannt fehlendes Bild wird doch geholt,
`gesamt` zählt Zurückgelegtes mit).

679 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

---
## Nachtrag 123 (hardened-219) — Job und Proxy waren sich uneinig, was „fehlend" heisst

Marcos Log, jetzt mit den Zählern aus Nachtrag 122:

    [image-queue] 2 bearbeitet: 0 geladen, 0 Vorschau erzeugt, 0 bereits vorhanden, 2 als fehlend bekannt

Damit war der Ausgang benannt: Die beiden Bilder stehen in `image_misses` und
werden deshalb gar nicht mehr versucht. Offen blieb, wie sie dorthin kamen — und
das ist die Frage, die zählt.

### 1. Jeder Fehlschlag galt als „Bild existiert nicht"

`jobs/imageQueue.ts`

Der Job vermerkte JEDEN gescheiterten Download ausser 403/429: eine
Zeitüberschreitung, einen DNS-Aussetzer, eine abgebrochene Verbindung, „Antwort
zu klein", „zu viele Weiterleitungen", ein zu grosses Bild — und über den
umgebenden catch sogar einen Schreibfehler auf der eigenen Platte. Alles davon
sperrte das Bild SIEBEN TAGE aus, und von aussen war nicht einmal zu erkennen,
dass es je einen Versuch gab.

Der Bild-Proxy macht es längst richtig und begründet es im Code: dort wird nur
bei 404 gemerkt, weil ein 403 beim CDN auch als Drosselung vorkommt. Zwei
Bauteile, DIESELBE Tabelle, zwei verschiedene Auslegungen von „fehlend" — wieder
„Regel fehlt am zweiten Weg", diesmal als Widerspruch statt als Lücke.

Jetzt gilt auch im Job: nur 404 und 410 heissen „das Bild gibt es nicht". Ein
vorübergehender Fehler wird gezählt und benannt, aber nicht vermerkt; entsteht
die Notiz über den Proxy neu, wird es erneut versucht.

### 2. Der Grund wird festgehalten

`db/migrations/0011-image-misses-grund.sql`, `utils/imageMisses.ts`

`image_misses` bekommt eine Spalte `reason`; `merkeFehlend(key, grund)` schreibt
sie mit, `grundFuer(key)` liest sie. Ohne den Grund ist „gilt als fehlend" keine
Auskunft, sondern nur eine andere Formulierung derselben Frage. Altbestände
bleiben NULL — dafür sagt es der Hinweis in image-diag ausdrücklich.

Die Meldung des Jobs nennt jetzt auch bei bekannt fehlenden Bildern die
Setnummer samt Grund. Ohne Setnummer führt kein Weg zu image-diag.

### 3. image-diag sah ausgerechnet diese Tabelle nicht an

`GET /api/v1/admin/image-diag/:setNumber` sollte seit Nachtrag 50 „warum fehlt
das Bild für Set X?" in EINER Antwort beantworten. Es prüfte Datenbank, Platte
und Proxy-Cache — nur nicht die Tabelle, die den Abruf VERHINDERT. Steht dort
ein Eintrag, ist jede andere Auskunft gegenstandslos. Neu im Ergebnis:
`merker: { seit, grund }` plus ein Klartext-Hinweis.

### 4. Zurücknehmen war gar nicht vorgesehen

Neu `POST /api/v1/admin/forget-image-misses` (`set_numbers` optional, sonst alle
Set-Vermerke; `thumbs: true` nimmt die Vorschau-Vermerke mit).

Bis hierher gab es keinen Weg, eine Fehlanzeige zurückzunehmen — man konnte nur
sieben Tage warten. Der Knopf „Fehlende neu laden" hilft dabei nicht: Er sieht
ausschliesslich Zeilen mit gesetztem `image_local` an, also Bilder, die schon
einmal da waren. Ein Katalogbild, das nie ankam, fiel durch jedes Raster.

Ohne Angabe werden bewusst NUR die `set:`-Vermerke entfernt: Die
Vorschau-Vermerke halten fest, dass eine Verkleinerung nicht gelingen KANN, und
haben damit einen anderen Zweck. Der Merker der übrigen Arbeitsprozesse liegt im
Speicher und frischt sich im Fünf-Minuten-Takt vollständig aus der Tabelle auf —
länger dauert es dort also nicht.

### Tests

Neu `test/image-misses-reason-db.test.js`: 404 wird mit Grund gemerkt; eine
Zeitüberschreitung sperrt NICHT aus; Job und Proxy legen denselben Massstab an;
image-diag nennt Merker und Grund; Zurücknehmen wirkt auch im Arbeitsspeicher;
Vorschau-Vermerke bleiben bei einem Lauf ohne Angabe unangetastet.

Fünf Gegenproben bestanden (unbedingtes Merken zurück; Grund nicht mitschreiben;
image-diag ohne Merker; Rücknahme leert den Speicher nicht; Rücknahme ohne
Angabe nimmt alles mit). Zwei davon trafen im ersten Anlauf ihre Zeile gar nicht
und liefen deshalb grün durch — MERKE: Bei einer Gegenprobe per Textersetzung
gehört ein `assert alt in s` davor, sonst prüft man nichts und hält es für einen
Erfolg.

687 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

---
## Nachtrag 124 (hardened-220) — „Katalogbilder holen" nimmt Fehlanzeigen zurück

Marcos Wunsch: „Kannst du die Logik von ‚Alle fehlenden Katalogbilder' so
anpassen, dass er die image_misses löscht und sie erneut versucht? Aktuell
stehen in der Tabelle sehr viele Einträge."

Die vielen Einträge sind mein Fehler aus Nachtrag 123: Bis dahin vermerkte der
Job JEDEN gescheiterten Download als „dieses Bild gibt es nicht" — auch eine
Zeitüberschreitung, einen DNS-Aussetzer oder einen Schreibfehler auf der eigenen
Platte. Diese Einträge sind schlicht falsch, und der Knopf war die einzige
Stelle, an der sie jemandem im Weg standen: Er nahm Sets mit Fehlanzeige
ausdrücklich aus.

### Welche zurückgenommen werden

Nicht alle — und das ist die eigentliche Entscheidung. Ein bestätigter 404
heisst wirklich „kein Bild vorhanden"; für alte Sets hat Rebrickable meist
keines, das sind Tausende. Die alle erneut zu holen wäre bei dreissig Anfragen
je Minute ein halber Tag reiner 404-Verkehr — und beim nächsten Klick wieder.
Genau davor schützt `image_misses` seit ihrer Einführung.

Zurückgenommen wird deshalb, was NICHT als bestätigter 404 vermerkt ist: die
Altbestände ohne Grund und alles, was vorübergehend gescheitert ist. Seit
Nachtrag 123 trägt ein echter 404 seinen Grund in der Spalte `reason`, und die
Sache heilt sich selbst: Ein Altbestand, der beim erneuten Versuch wieder 404
liefert, wird diesmal richtig vermerkt und bleibt beim nächsten Klick draussen.
Nach ein, zwei Durchläufen enthält die Tabelle nur noch, was hineingehört.

`{ "alle_erneut": true }` nimmt auch die bestätigten 404er zurück — für den
Fall, dass der CDN Bilder nachgereicht hat. Bewusst nicht die Vorgabe.

### Die Rückmeldung sagt jetzt, was passiert

Neu in der Antwort: `verworfen` (zurückgenommene Fehlanzeigen) und
`dauer_minuten`. Ohne die erste Zahl bliebe unklar, warum plötzlich wieder
Bilder anstehen, die zuletzt als fehlend galten; ohne die zweite ist „29 000 in
der Warteschlange" keine Auskunft darüber, ob das Minuten oder Stunden dauert.
Die Rate kommt aus `anfragenJeMinute()` im Job selbst, damit sie nicht an zwei
Stellen gepflegt wird und beim nächsten Ändern von STAPEL oder TAKT_MS
auseinanderläuft.

Neue Schlüssel `monitor.catalog_images_retried` und `monitor.catalog_images_eta`
in de und en; beide werden nur genannt, wenn sie ungleich null sind.

### Tests

`test/catalog-images-button-db.test.js` umgestellt: Die Bühne trägt jetzt eine
Fehlanzeige MIT bestätigtem 404 (bleibt draussen) und eine OHNE Grund (wird
zurückgenommen). Dazu ein Teilschritt für `alle_erneut`. Drei Gegenproben
bestanden (keine Rücknahme; auch bestätigte 404er zurücknehmen; `alle_erneut`
wirkungslos).

ZWEI EIGENE FEHLER dabei, beide vom Test gefunden:
- Erwartung auf neun statt acht eingereihte Sets — schlicht falsch gezählt.
- Der neue Teilschritt stand ZUERST und nahm die Fehlanzeige von `_3` zurück.
  Die Job-Prüfungen darunter sahen dadurch einen Download mehr als erwartet. Die
  Teilschritte dieser Datei teilen sich eine Bühne; wer sie verändert, gehört
  ans Ende. Steht jetzt als Begründung im Test.

688 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

---
## Nachtrag 125/126 (hardened-221) — Aufräumen, Durchgang 1 und 2

Marcos Frage: „Gibt es noch Dinge, die man softwaretechnisch verbessern könnte?
Klassen abstrahieren, Funktionen auslagern?" Gemessen ergaben sich fünf Punkte;
dies sind die ersten zwei Durchgänge am grössten davon.

### Der Befund

247 späte `require()` (157 in Funktionsrümpfen) und **129 Import-Zyklen**. Die
Ursache ist mechanisch: Router-Dateien exportieren Hilfsfunktionen. Wer die
braucht, importiert den Router, das schliesst einen Kreis, und der Kreis
erzwingt das späte `require()`.

Der Preis ist nicht theoretisch: `require()` liefert `any`, tsc prüft den NAMEN
also nicht. Genau daran hingen die beiden 500er aus Nachtrag 131.

### Durchgang 1 — Helfer aus routes/sets.ts

| Was | Wohin | Aufrufer |
|---|---|---|
| `getUserDefaultCondition` | gelöscht — Dublette | 11 |
| `downloadSetImage`, `bildUserAgent`, `SET_IMG_MAX_BYTES` | `utils/setImages.ts` | 20 |
| `getCurrentMarketPrice` | `utils/marketPrice.ts` | 7 |

`getUserDefaultCondition` war eine wortgleiche Zweitfassung von
`effectiveCondition()` in utils/settings.ts — dieselben zwei Abfragen, dieselben
Schlüssel. Ein Unterschied: Die Router-Fassung reichte einen ungültigen globalen
Wert durch (`|| 'N'`), die Utils-Fassung normalisiert. Die strengere gewinnt.

### Durchgang 2 — zwei Bauteile am falschen Platz

**routes/finance.ts war eine Durchreiche.** Im Anhang standen dreizehn Namen,
von denen die Datei KEINEN selbst herstellt: elf leben in utils/financeCalc.ts,
je einer in utils/settings.ts und utils/images.ts. Bezahlt wurde das mit
siebzehn späten `require('./finance')` in acht Dateien. Jetzt `export = router`.

**clients/ statt routes/.** `rebrickable.ts` und `brickset.ts` enthalten NULL
Routen und werden nirgends montiert — reine API-Clients, in routes/ nur aus
Gewohnheit. Wer sie importierte, importierte scheinbar einen Router.

### Zwei eigene Fehler, beide gefangen

**server.ts hätte geworfen.** Ich hatte 19 der 20 Aufrufer von
`downloadSetImage` umgestellt und einen übersehen — ein spätes `require()` auf
einen Namen, den es dort nicht mehr gab. Gefunden von
`test/require-exports.test.js`, also von dem Test, den es nur wegen dieses
Musters gibt.

**Ein API-Name ist kein Pfad.** Beim Umzug nach clients/ hat meine
Textersetzung auch das getroffen:

    checkAndIncrementRateLimit('rebrickable')  →  ('../clients/rebrickable')

Das sind die Schlüssel der TAGESKONTINGENTE. Unter einem neuen Schlüssel hätte
jede API bei null zu zählen begonnen — lautlos, ohne Absturz, nur ein
Kontingent, das nie mehr erreicht wird. Neun Stellen in vier Dateien. Beim
Zurückdrehen habe ich dann prompt zu breit ersetzt und drei echte Modulpfade
mitgenommen (500er: „Cannot find module 'rebrickable'").

Neu `test/module-layout.test.js` mit drei Prüfungen, die genau diese beiden
Verwechslungen fangen (plus: clients/ enthält keine Routen und steht im
Bauskript). Alle drei per Gegenprobe gegen meine echten Fehler verifiziert.

### Beinahe-Fehler

`scripts/build-ts.js` kennt eine feste Liste `SRC_DIRS`. Ohne den Eintrag
`'clients'` wäre kein `dist/clients/` entstanden und JEDER Import darauf beim
Start ins Leere gelaufen — derselbe Fehler, den das Projekt bei `jobs/` schon
einmal hatte (siehe test/jobs-typescript.test.js). Der neue Test hält es fest.

### Wirkung

| | vorher | nachher |
|---|---|---|
| Import-Zyklen | 129 | **27** |
| späte `require()` in Rümpfen | 247 | 210 |

691 Tests grün gegen echtes Postgres 16, 0 übersprungen.

### Testarbeit

27 Tests wurden nach Durchgang 1 rot, keiner wegen geänderten Verhaltens: acht
`Module.prototype.require`-Abfänge zeigten auf `routes/sets` und liefen ins
Leere (hätten also still den echten CDN-Download gemessen), der Rest waren
quelltextlesende Prüfungen am alten Fundort. Aussagen unverändert, Pfade
nachgezogen, Begründung jeweils im Test.

EIGENE FALLE dabei: In review-131.test.js habe ich per Massenersetzung BEIDE
Verweise auf routes/sets.ts umgezogen — der zweite gehörte zur
CSV-Fortschrittsprüfung, die weiterhin im Router lebt.

### Offen in Punkt 1

`addSet` (139 Z.), `updateSet` (156 Z.), `buildSetsCsv` und die
Anleitungs-Kette (`downloadSetInstructions` + `collectAndBuildPDF`, zusammen
~180 Zeilen) stehen weiter in routes/sets.ts. Die Punkte 2 bis 5 (initSchema
als .sql, registerImgProxy aufteilen, Frontend-Dateien, Android-Signaturen)
sind noch nicht angefasst.

---
