# Begründungen zu `test/kontofilter-mitgeben.test.js`

Die ausführlichen Kommentare aus `test/kontofilter-mitgeben.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Was der Kontofilter neu lädt, muss den Kontofilter auch mitschicken.

── Der Befund ──────────────────────────────────────────────────────────────
`onScopeChange('gallery')` in 02-gallery.js ruft zwei Dinge auf:

    if (view === 'gallery')  { loadGallery(); loadStats(); }

`loadGallery()` schickte den Filter mit, `loadStats()` nicht — es rief
schlicht `api('GET', '/v1/stats')`. Die Route wertet `accounts` aus
(routes/api_v1/misc.ts, parseScopeMode), bekam ihn aber nie.

Wer auf „nur meine" stellte, sah darunter eine gefilterte Liste und darüber
weiter die Zahlen des ganzen Haushalts — Sets, Teile, Minifiguren,
Anleitungen. Am Telefon stimmten beide: Die App schickt accounts an
/v1/stats seit jeher.

── Warum das ein BEWEIS ist und keine Vermutung ────────────────────────────
Der Aufruf von `loadStats()` steht IM Filterwechsel. Etwas neu zu laden, das
sich durch den Wechsel gar nicht ändern kann, ergibt nur einen Sinn, wenn es
sich ändern sollte. Die Absicht steht also im Code selbst — sie war nur
nicht umgesetzt.

── Der zweite Fund, und warum der Test dafür umgebaut wurde ────────────────
Die erste Fassung fragte je LADEFUNKTION: „steht irgendwo in ihrer
Aufrufkette ein scopeQuery()?" Damit war sie blind für
`enrichGalleryWithPrices()`: Es hängt am Ende von `loadGallery()`, das den
Filter über galleryParams() sehr wohl mitgibt — der Aufruf auf
/v1/finance/pnl darin aber nicht. Die Kette trug ihn, der Aufruf nicht.

Geprüft wird deshalb JE AUFRUF. Das ist die Regel, die beide Fälle trifft.

── Warum gesucht und nicht aufgezählt ──────────────────────────────────────
Drei Seiten werden gelesen: WAS der Filterwechsel neu lädt (aus
onScopeChange), WELCHE v1-Routen `accounts` überhaupt auswerten (aus den
Router-Dateien) und OB jeder Aufruf dorthin den Filter mitgibt. Ein neuer
Endpunkt, eine neue Ansicht, ein neuer Zwischenaufruf — alles ist von selbst
mitgeprüft. Eine Liste hier wäre eine zweite Wahrheit, die beim nächsten
Umbau still veraltet.
```

<a id="aufrufeohnefilter"></a>
## `function aufrufeOhneFilter(name, konten, tiefe = 0, gesehen = new Set(`

```text
Trägt dieser Aufruf den Filter?

Geprüft wird JE AUFRUF, nicht je Ladefunktion. Die erste Fassung dieses
Tests fragte „steht irgendwo in der Aufrufkette ein scopeQuery()?" — und
war damit blind für genau den zweiten Fund: `loadGallery()` baut den
Filter über galleryParams(), ruft am Ende aber
`enrichGalleryWithPrices()`, das /v1/finance/pnl OHNE Filter holte. Die
Kette trug ihn, der Aufruf nicht.
```

<a id="aufruf"></a>
## `const aufruf = aufrufText(treffer.koerper, m.index);`

```text
Der Filter darf im Aufruf selbst stehen (scopeQuery/scopeMode) oder in
einem Helfer, dessen Ergebnis angehängt wird.

── Zwei Verschärfungen vom 20.10. (GEMESSEN) ────────────────────────

1. Geprüft wird der AUFRUF, nicht die nächsten 220 Zeichen. Hier stand
   `koerper.slice(m.index, m.index + 220)`, und das Fenster reichte in
   die NÄCHSTE Zeile: In loadManualParts() stehen zwei Abrufe im selben
   Promise.all, und der zweite trug `scopeQuery('parts')`. Der erste
   galt damit als geprüft, obwohl in ihm nichts davon stand — er war
   grün durch seinen Nachbarn.
2. Der Helfer wird am INHALT erkannt, nicht am Namen. Hier stand
   `\w*[Pp]arams\(`. manuellQuery() baut denselben Filter für die
   manuellen Listen und heisst nur anders — die Regel hätte einen
   Umbau gemeldet, der sie erfüllt.
```
