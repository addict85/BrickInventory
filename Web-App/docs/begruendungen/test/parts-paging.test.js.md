# Begründungen zu `test/parts-paging.test.js`

Die ausführlichen Kommentare aus `test/parts-paging.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="stripmodulesyntax"></a>
## `function stripModuleSyntax(src) {`

```text
import-/export-Syntax aus einer Moduldatei entfernen.

Diese Tests werten den Quelltext in einer vm-Sandbox bzw. in jsdom als
KLASSISCHES Skript aus. Seit der Umstellung auf ES-Module enthalten die
Dateien import- und export-Anweisungen, die dort einen SyntaxError erzeugen
("Cannot use import statement outside a module"). Die geprüfte Logik ändert
sich dadurch nicht — nur die Modulverpackung muss weg.
```

<a id="registeractions"></a>
## `return 'function registerActions() {}\n'`

```text
registerActions() kommt sonst aus js/00-registry.js und ist nach dem
Entfernen der Importe nicht definiert. In der Sandbox interessiert die
Anmeldung nicht — dass sie aufgerufen WIRD, prüfen test/csp-actions.test.js
und test/bundle-smoke.test.js gegen den echten Quelltext.
tRaw() lebt in i18n.js und wird hier nicht mitgeladen. In der Sandbox
genügt die Weiterleitung an t(): Der Unterschied liegt allein in der
Maskierung der eingesetzten Werte, die diese Tests nicht prüfen.
```

<a id="parts"></a>
## `const parts = require('./helpers/sources').handlerQuelle();`

```text
parts.category_name enthält die Rebrickable-Kategorie-ID als Text — oder
'Unknown', wenn die Set-Teile-Antwort kein part_cat_id mitliefert. Das ist
bei /sets/{id}/parts/ die Regel: Das eingebettete part-Objekt führt das
Feld meist nicht. Die Filterliste zeigte deshalb nur einen Eintrag.
Die Liste steht seit dem 29.10. in src/teile/abfragen.ts
(getPartsCategories), einmal für Zusammenfassung und Live-Abfrage.
```

<a id="h-stelle"></a>
## `const h = require('./helpers/sources').handlerQuelle();`

```text
── Woher dieser Test kommt ─────────────────────────────────────────────
getParts hat zwei Wege: die Live-Abfrage und die vorberechnete
Zusammenfassung. Nur der erste deckelte page_size (bei 500), der zweite
reichte den Wert ungeprüft ins LIMIT durch. DIESELBE Anfrage lieferte
damit unterschiedlich viele Zeilen, je nachdem ob die Zusammenfassung
gerade frisch war — an 5000 Teilen mit page_size=100000 gemessen:
500 Zeilen über die Live-Abfrage, 5000 über die Zusammenfassung. Ein
Unterschied, der am Cache-Zustand hängt, ist beim Suchen eines Fehlers
das Letzte, was man vermutet — und nebenbei ein Weg, sich beliebig grosse
Antworten bauen zu lassen.
```

<a id="stelle"></a>
## `const { funktionsRumpf } = require('./helpers/sources');`

```text
Und der Weg, der sie NICHT hatte, deckelt jetzt ebenfalls.

Geprüft wird die AUSSAGE, nicht der Aufruf von clampPageSize: Seit die
Teileliste eines einzelnen Sets eine höhere Grenze hat
(SET_PARTS_MAX_PAGE_SIZE, weil die App sie in einem Stück holt), rechnet
der Pfad die Grenze selbst aus. Entscheidend bleibt, dass BEIDE Wege
dieselben zwei Grenzen kennen und keiner den Wert ungeprüft durchreicht.
```
