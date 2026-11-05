# Begründungen zu `public/js/01-bausteine.js`

Die ausführlichen Kommentare aus `public/js/01-bausteine.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="01-core-js-sammelt-werkzeuge-escaping-bi"></a>
## 01-core.js sammelt WERKZEUGE: Escaping, Bild-URLs, Formatierung, Toasts,

```text
── Bausteine für Ansichten ──────────────────────────────────────────────────

01-core.js sammelt WERKZEUGE: Escaping, Bild-URLs, Formatierung, Toasts,
Theme. Was dort fehlte, sind Bausteine für die ANSICHT — und die standen
deshalb als HTML-Zeichenkette in jedem Modul neu.

── Warum das mehr ist als Kosmetik ─────────────────────────────────────────

Die Detailzeile stand fünfzehnmal von Hand geschrieben, in vier Modulen:

    <div class="dr"><span class="dl">Label</span><span class="dv">Wert</span></div>

Wer die Zeile ändern will — Abstand, Trennlinie, Umbruchverhalten auf dem
Telefon —, muss heute alle fünfzehn finden. Und wer eine neue Detailansicht
baut, schreibt die sechzehnte ab, samt der Frage, ob `dl` oder `dt` die
richtige Klasse war.

Dieselbe Überlegung wie bei AppKarte und Formen.kachelBreite in der
Android-App: Was ALLE gleich aussehen soll, gehört an eine Stelle; was sich
unterscheidet, bleibt beim Aufrufer.

── Die Klassennamen bleiben, wie sie sind ──────────────────────────────────

`dr`, `dl`, `dv` sagen niemandem etwas ("detail row / label / value"). Sie
stehen aber auch in styles.css, mobile.css und brick.css; sie umzubenennen
hiesse, drei Stylesheets und ein Theme anzufassen, ohne dass sich etwas
verbessert, das man sehen kann. Ab jetzt sind sie eine INNERE Angelegenheit
dieser Datei — wer eine Detailzeile braucht, schreibt `detailZeile(…)` und
sieht die Kürzel nie. In styles.css steht daneben, wofür sie stehen.
```

<a id="zustands-plaketten-eines-eintrags-eine-j"></a>
## Zustands-Plaketten eines Eintrags — eine je erfasstem Zustand.

```text
Zustands-Plaketten eines Eintrags — eine je erfasstem Zustand.

── Warum eine Liste ────────────────────────────────────────────────────────
`condition` ist ein Aggregat und liefert genau einen Wert („gebraucht,
sobald eine Erfassung gebraucht ist"). Wer ein Exemplar neu und eines
gebraucht gekauft hat, sah damit nur „Gebraucht" — die Neu-Erfassung war
unsichtbar, obwohl sie mit ihrem eigenen Preis in die Bewertung eingeht.

`conditions` kommt vom Server (utils/handlers.ts, conditionsFromAcquisitions)
und ist die EINE Stelle, an der entschieden wird, welche Plaketten es gibt.
Hier wird nichts nachgerechnet; ältere Antworten ohne das Feld fallen auf
`condition` zurück.

Steht in dieser Datei, weil Galerie-, Minifiguren- und Teile-Kacheln sie
alle brauchen — vorher stand dieselbe Plakette viermal im Code, dreimal
davon mit fest eingetragenen Farben statt der CSS-Klassen.
```

<a id="besitzer-plaketten-nur-im-haushalt"></a>
## Besitzer-Plaketten — nur im Haushalt.

```text
Besitzer-Plaketten — nur im Haushalt.

Der Server hängt `owners` nur an, wenn mehrere Konten im Blickfeld sind. Im
Einzelkonto stünde an jeder Kachel „gehört mir", und das ist reines
Rauschen. Im Haushalt ist es dagegen die wichtigste Angabe der Kachel: Ohne
sie verschiebt man das falsche Exemplar.

Mehrere Namen heisst, dass dasselbe Set in mehreren Konten liegt — die
Kachel zeigt es bewusst nur EINMAL, mit der Summe der Mengen.
```
