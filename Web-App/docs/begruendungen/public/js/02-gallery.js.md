# Begründungen zu `public/js/02-gallery.js`

Die ausführlichen Kommentare aus `public/js/02-gallery.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kennzahlen-mit-demselben-kontofilter-wie"></a>
## `d`

```text
Mit Kontofilter. Hier stand `api('GET', '/v1/stats')` ohne ihn — und das
war nachweislich nicht so gemeint: onScopeChange('gallery') ruft
ausgerechnet loadStats() gleich nach loadGallery() auf. Etwas neu zu laden,
das sich nicht ändern kann, ergibt nur einen Sinn, wenn es sich ändern
SOLLTE.

Die Wirkung: Wer auf „nur meine" stellte, sah darunter eine gefilterte
Liste und darüber weiter die Zahlen des ganzen Haushalts. Am Telefon
stimmten beide — die App schickt accounts an /v1/stats seit jeher
(BrickApiService.getStats).
```

<a id="applysetaggregate"></a>
## `applySetAggregate`

```text
Übernimmt das vom Server gelieferte Zustands-Aggregat eines Sets in die
Galerie-Liste und zeichnet neu.

Vorher hat das Frontend die Regel selbst nachgebaut und dabei die Bedingung
der ZULETZT erfassten Position genommen. Der Server sagt aber: sobald EINE
Erfassung "U" ist, gilt das Set als gebraucht. Bei der Reihenfolge [U, N]
zeigte die Kachel deshalb "neu", bis die Liste neu geladen wurde.
```

<a id="kickgallerysentinel"></a>
## `kickGallerySentinel`

```text
Nachfassen, wenn der Sentinel OHNE Zustandswechsel sichtbar bleibt.

IntersectionObserver meldet nur ÜBERGÄNGE. Steht der Sentinel schon im
Sichtfeld und der Inhalt wird darunter ersetzt (Eigentümerwechsel, Filter,
kurze Seite), kommt kein neues Ereignis — es lädt nichts mehr, bis der
Nutzer erst hoch- und wieder runterscrollt. Genau das hat Marco gemeldet.
Deshalb nach jedem Anhängen selbst nachsehen.
```

<a id="updategalleryprices"></a>
## `updateGalleryPrices`

```text
Trägt Marktpreis und Gewinn/Verlust in die bestehenden Kacheln nach.

Ersetzt den früheren renderGallery()-Aufruf am Ende von
enrichGalleryWithPrices(): Der hat die komplette Kachelwand per innerHTML neu
gebaut, nur um pro Kachel eine Zeile zu ergänzen. Alle <img> waren dadurch
neue Elemente und blendeten erneut ein — das sichtbare Flackern ein paar
Sekunden nach dem Laden bzw. direkt nach dem Login.

Hier wird ausschliesslich der Preis-Container angefasst; Bilder, Scrollposition
und Fokus bleiben unberührt.
```

<a id="derselbe-zeilenbauer-wie-in-01"></a>
## `z`

```text
Derselbe Bauer wie oben und in 01-fortschritt.js. Hier war die
DRITTE Fassung derselben drei Zeilen — und es ist die, die Marco
am 21.10. fotografiert hat: der Dialog NACH dem Import, in der
Sitzung, die ihn gestartet hat.

Ohne esc(): addCsvLog setzt textContent, nicht innerHTML. Eine
Maskierung davor wird dort nicht aufgeloest, sondern sichtbar
(„Brick &amp; Co"). Der Zeitueberschreitungs-Hinweis bleibt — er
gilt nur fuer den CSV-Import und reist deshalb als Zusatz mit.
```

<a id="delset"></a>
## `delSet`

```text
Ein Set löschen — mit GENAU EINER Rückfrage.

── Marcos Befund ──────────────────────────────────────────────────────────
„Wenn ich in der Webapp ein Set lösche, erscheinen 2 Rückfragen."

Der Löschknopf im Detail-Dialog fragte selbst nach und rief danach diese
Funktion, die ein zweites Mal fragte. Von der Kachel und aus der Listenzeile
kam nur eine — dieselbe Handlung, drei Einstiege, zwei verschiedene
Erlebnisse.

Die Rückfrage steht jetzt NUR hier, an der einen Stelle, die tatsächlich
löscht. Ein Aufrufer, der selbst fragt, ist damit gar nicht mehr möglich,
ohne dass es auffällt.

Der Text nennt den Namen, wenn er bekannt ist. Das war vorher der einzige
Vorzug der Extra-Rückfrage im Dialog, und der bleibt erhalten.

Gelöscht wird beim Server in einer Transaktion: Set, seine Teile, seine
Minifiguren und die Kaufpreise (deleteSetRows in utils/handlers.ts).
```

<a id="registeractions"></a>
## `registerActions`

```text
── Handler beim Dispatcher anmelden (siehe js/00-registry.js) ──────────────
`benutzerMenue` und `oeffneSicht` sind das Menü hinter dem Benutzernamen.
Der Hinweis steht VOR dem Aufruf und nicht zwischen den Namen: Die Prüfung
in test/bundle-smoke.test.js liest die Schlüssel, indem sie den Inhalt an
Kommas trennt — ein Kommentar vor dem ersten Namen wandert dabei IN den
Namen, und der Handler gilt als nicht angemeldet. GEMESSEN: genau so ist
der erste Lauf dieses Umbaus rot geworden.
```
