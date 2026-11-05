# Begründungen zu `test/csp-actions.test.js`

Die ausführlichen Kommentare aus `test/csp-actions.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Inline-Handler entfernen, damit `script-src 'unsafe-inline'` aus der CSP
verschwinden kann (Punkt 2 der Optimierungsliste).

Solange irgendwo `onclick="…"` im Markup steht, muss der Browser
Inline-Skript erlauben — und damit fehlt genau die Verteidigungslinie, die
bei einer übersehenen XSS-Lücke greifen würde.

Statt 140 Handler einzeln in addEventListener zu übersetzen, gibt es einen
delegierten Dispatcher (js/11-actions.js) mit data-click/data-change und
optionalen data-arg. Nebeneffekt: Der escJs-Kontext verschwindet, weil ein
Wert in einem data-Attribut nie als Code gelesen wird.

Ausführen: npm test
```

<a id="server"></a>
## `const server = fs.readFileSync(path.join(__dirname, '..', 'server.ts')`

```text
img-src trug ein pauschales `https:` mit der Begründung, Set-Bilder kämen
direkt von den CDNs. Seit hardened-69 stimmt das nicht mehr: imgUrl()
schickt jede absolute Adresse durch /api/img-proxy, und alle Bilder
verlangen Anmeldung. Die Erlaubnis blieb nur stehen — und ein
eingeschleustes <img src="https://fremd/?daten"> ist eine Anfrage nach
draussen, auch ohne ausführbares Skript. Genau den Kanal schliesst
connect-src 'self' auf der anderen Seite.
```

<a id="entry"></a>
## `const entry = fs.readFileSync(path.join(PUB, 'js', 'main.js'), 'utf8')`

```text
11-actions.js hat kein eigenes <script>-Tag mehr — es steckt im gebündelten
js/app.bundle.js. Ohne den Dispatcher wäre die App unbedienbar (alle
Interaktionen laufen seit der CSP-Umstellung über data-click/data-change),
deshalb wird geprüft, dass er Teil des Bündels IST und dass das Bündel
geladen wird.
Seit der Umstellung auf ES-Module gibt es keine Dateiliste mehr, sondern
einen Modulgraphen: js/main.js importiert den Dispatcher, esbuild zieht
ihn darüber ins Bündel.
```

<a id="strip"></a>
## `const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|`

```text
── Was sich geändert hat ────────────────────────────────────────────────
Vorher prüfte dieser Test, ob der Handlername IRGENDWO als Funktion
definiert ist. Das war die richtige Frage, solange der Dispatcher über
window[name] auflöste — definiert hiess dann automatisch erreichbar.

Mit ES-Modulen stimmt das nicht mehr: Eine Funktion kann sauber definiert
und trotzdem unerreichbar sein, wenn ihr Modul sie nicht bei der Registry
anmeldet (js/00-registry.js). Geprüft wird deshalb jetzt die Anmeldung.

Kommentare werden vor dem Sammeln entfernt: Der Erklärtext in
00-registry.js nennt selbst ein data-click-Beispiel und würde sonst als
fehlender Handler gemeldet.
```

<a id="versuch"></a>
## `const versuch = ACT.match(/setTimeout\(\(\) => \{([^}]*)\}, 1000\)/);`

```text
── Die Absicht statt des Wortlauts ──────────────────────────────────────

Hier stand der Aufruf ausgeschrieben, `el.src = ''` eingeschlossen. Genau
dieses leere src war aber selbst ein Fehler: Der Browser loest es gegen
die SEITENadresse auf und laedt die Startseite als Bild (siehe
leeres-bildquell.test.js). Beim Berichtigen schlug diese Zusicherung an —
obwohl die Absicht unveraendert war und der Fehler damit gerade
verschwand. Geprueft wird deshalb die Absicht: Adresse merken, Attribut
abraeumen, nach einer Sekunde dieselbe Adresse erneut setzen.
```

<a id="ausnahme"></a>
## `const AUSNAHME = new Set(['delInstr']);`

```text
── Die Regel statt der Anzahl ────────────────────────────────────────────

Hier standen feste Zahlen („02-gallery.js: 1, 06-minifigs.js: 4"), und die
Begründung darüber erzählte die Geschichte ihrer Änderungen: erst zwei,
dann drei, dann vier. Eine Zahl, die bei jedem Umbau nachgezogen werden
muss, prüft die Absicht nicht — sie prüft den letzten Stand.

Zuletzt schlug sie an, weil ein Löschknopf in der Figuren-TABELLE
entfernt wurde: Er hing an `f.source==='manual'`, und diese Liste lädt
ausschliesslich `source=set` — der Knopf war unerreichbar. Ein richtiger
Schritt, der einen roten Test erzeugte.

Geprüft wird jetzt, worum es geht: JEDER Löschknopf auf einer Kachel oder
in einer Tabellenzeile trägt den Papierkorb.

Die eine Ausnahme, mit Grund: `delInstr` entfernt einen Anleitungs-LINK
aus einer Liste im Set-Detail — ein kleines, graues ✕ neben dem Eintrag,
keine Kachelaktion. „Aus der Liste nehmen" und „diesen Eintrag löschen"
sind verschiedene Dinge, und der Titel dieses Tests spricht von Kacheln.
Wer das ändern will, entscheidet über die Darstellung — nicht über eine
Regel, die hier durchgesetzt wird.
```

<a id="knoepfegesamt"></a>
## `let knoepfeGesamt = 0;`

```text
── Der Selbstbeweis zählt über ALLE Dateien, nicht je Datei ─────────────

Er stand je Datei und schlug am 24.09. an, als 06-minifigs.js kurzzeitig
gar keinen Löschknopf mehr hatte. Er ist seither wieder da (Marco hat die
Entfernung für die Webapp zurückgenommen), aber die Summenform bleibt: Eine
Regel, die in JEDER Datei einen Knopf verlangt, bricht beim nächsten Umbau
einer einzelnen Datei — obwohl das, was sie sichern soll, weiter gilt.
Nämlich: Ein Löschknopf auf einer Kachel trägt den Papierkorb, und es gibt
überhaupt noch einen.
```

<a id="for-stelle"></a>
## `for (const [file, expected] of [['02-gallery.js', 1], ['03-parts.js', `

```text
Einheitliches Muster über alle drei Tabellen: .ca als Hover-Behälter mit
.delbtn darin. Vorher war der Minifiguren-Knopf ein "btn bd" mit eigenem
Inline-Style und dauerhaft sichtbar, Teile hatten gar keinen.

Die zwei in 06-minifigs.js: die Minifiguren-Kachel im Reiter „Minifiguren"
(nur bei source==='manual') und das Kachelraster der manuell erfassten
Minifiguren; die manuell erfassten Teile stehen in 03-parts.js. Marcos Vorgabe vom 24.09.:
„Im der Webapp soll auf den Kacheln bei den manuell erfassten Minifiguren
und den manuell erfassten Teilen […] der Papierkorb oben rechts angezeigt
werden analog den Kacheln bei den Sets. Dies aber nur in der webapp."
```

<a id="css-stelle"></a>
## `const css   = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');`

```text
── Was dieser Test NICHT mehr prüft ──────────────────────────────────────
Vorher standen hier konkrete Farbwerte: welchen Token der Hover nimmt, dass
der Ruhezustand nicht rot sein darf, dass im Stein-Design beim Überfahren
genau var(--b600) erscheint. Das ist Gestaltung, keine Zusicherung — ein
Test, der die Hover-Farbe festnagelt, verhindert nur, dass man sie ändert,
und schlägt dann fehl, obwohl nichts kaputt ist. Genau das war der Fall.

── Was er weiter prüft ───────────────────────────────────────────────────
Drei Dinge, die keine Geschmacksfragen sind und die alle aus echten
Fehlern stammen:
  1. Jedes Design hat eine eigene Fassung. Fehlt der Stein-Block, sitzt der
     helle Standard-Knopf auf der dunklen Noppenleiste und verschwindet.
  2. Es gibt einen Fokusring. Ohne ihn ist der Knopf per Tastatur
     unsichtbar — Barrierefreiheit, nicht Optik.
  3. Farben kommen aus Tokens, nicht als Literal. Sonst zieht die nächste
     Designänderung an diesem Knopf vorbei.
```

<a id="html"></a>
## `const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'ind`

```text
── Woher dieser Test kommt ─────────────────────────────────────────────
index.html lud Plus Jakarta Sans und JetBrains Mono von Google — die
letzte Fremdquelle, nachdem qrcodejs genau deswegen nach public/vendor/
gezogen ist. Drei Gründe, das zu beenden: eine LAN-/Offline-Installation
bekam die Schriften gar nicht, jeder Seitenaufruf meldete IP und
User-Agent an einen Dritten, und die CSP musste zwei fremde Hosts offen
halten. Die Dateien liegen jetzt unter public/vendor/fonts/.
```

<a id="html-2"></a>
## `const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'ind`

```text
Ein target="_blank" ohne rel="noopener" gibt der geöffneten Seite über
window.opener Zugriff auf das eigene Fenster — sie kann es umleiten
(Tabnabbing). Moderne Browser setzen noopener bei _blank inzwischen von
selbst; ältere und eingebettete WebViews nicht, und der Code setzte es an
allen anderen Stellen bereits. Die beiden Links zu rebrickable/brickset in
den Einstellungen waren die Ausnahme.
```
