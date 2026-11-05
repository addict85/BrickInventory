# Begründungen zu `public/js/15-scrollbar.js`

Die ausführlichen Kommentare aus `public/js/15-scrollbar.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="marcos-vorgabe-der-rechte-scrollbalken-i"></a>
## Marcos Vorgabe: „Der rechte Scrollbalken ist der vom Browser, der durch den

```text

Marcos Vorgabe: „Der rechte Scrollbalken ist der vom Browser, der durch den
eigenen ersetzt werden soll. Gerne gleich in der ganzen App."

Der des Browsers ist per CSS ausgeblendet; dieser hier sitzt an derselben
Stelle, fest am rechten Fensterrand, und rollt die SEITE. Ein eigener
Scrollkasten im Katalog (die vorige Fassung) hatte zwei Nachteile: Der Balken
sass mitten im Fenster, und der Beobachter, der die Katalogseiten nachlädt,
mass gegen diesen Kasten statt gegen das Fenster — beim Scrollen nach unten
kam nichts nach.

Das Etikett neben dem Griff füllt, wer es braucht: Der Katalog trägt dort
eine Funktion ein, die das Jahr an der aktuellen Stelle liefert. Ohne
Eintrag bleibt es leer, und der Balken ist ein gewöhnlicher Scrollbalken.
```

<a id="erzeugescrollbalken"></a>
## `_erzeugeScrollbalken`

```text
Das Balken-Element erzeugen, falls es noch nicht da ist.

── Warum aus JavaScript und nicht aus dem Markup ───────────────────────────
app.bundle.js ist ein KLASSISCHES Skript (kein Modul, kein defer) und läuft,
sobald der Parser es erreicht — also vor allem, was danach im Markup steht.
Genau daran ist die erste Fassung gescheitert: Das <div> stand am Ende des
Body, hinter dem Skript. Beim Start gab es das Element noch nicht,
initScrollbalken() kehrte still um, und weil der Balken des Browsers per CSS
verborgen ist, hatte die Anwendung GAR KEINEN mehr.

Selbst erzeugt hängt der Balken an keiner Reihenfolge im HTML.
```

<a id="if"></a>
## `if`

```text
Die INLINE gesetzte Sichtbarkeit wieder wegnehmen.

Marcos Bild: Das Jahr „2027" stand in der Galerie oben rechts, ohne dass
jemand zog. Die CSS-Regel zeigt das Etikett nur während `.dragging` —
aber rollen() setzt `style.display` direkt am Element, und eine
Inline-Angabe schlägt jede Regel. Nach dem Loslassen blieb sie stehen,
also blieb auch das Etikett stehen, in JEDEM Reiter.
```
