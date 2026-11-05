# Begründungen zu `src/katalog/http/bildAuslieferung.ts`

Die ausführlichen Kommentare aus `src/katalog/http/bildAuslieferung.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

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
