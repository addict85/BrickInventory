# Begründungen zu `public/js/11-actions.js`

Die ausführlichen Kommentare aus `public/js/11-actions.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="ziel-script-src-unsafe-inline-aus-der-cs"></a>
## Ziel: `script-src 'unsafe-inline'` aus der CSP entfernen. Solange irgendwo

```text
═══ AKTIONEN OHNE INLINE-HANDLER ═══════════════════════════════════════════

Ziel: `script-src 'unsafe-inline'` aus der CSP entfernen. Solange irgendwo
`onclick="…"` im Markup steht, muss der Browser Inline-Skript erlauben — und
damit fehlt genau die Verteidigungslinie, die bei einer übersehenen
XSS-Lücke greifen würde.

Statt 140 Handler einzeln in addEventListener-Aufrufe zu übersetzen, gibt es
hier einen delegierten Dispatcher. Aus

    <button onclick="plGenerate()">
    <button onclick="setChartPeriod('year')">
    <div onclick="openModal('${escJs(s.set_number)}')">

wird

    <button data-click="plGenerate">
    <button data-click="setChartPeriod" data-arg="year">
    <div data-click="openModal" data-arg="${esc(s.set_number)}">

Das löst zwei Probleme auf einmal: Die CSP kann zumachen, UND der ganze
escJs-Kontext verschwindet. Ein Wert in einem data-Attribut wird nie als
Code gelesen — es gibt keinen JS-String mehr, aus dem ein Apostroph
ausbrechen könnte.

Kein eval, kein new Function: Der Name wird in einer Tabelle nachgeschlagen.
Steht er nicht drin, passiert nichts (und es gibt eine Konsolenmeldung).
```

<a id="resolve"></a>
## `resolve`

```text
Löst den Handlernamen über die Registry auf (js/00-registry.js).

VORHER: `window[name]`. Das setzte voraus, dass alle Handler globale
Funktionsdeklarationen sind — eine Annahme, die mit der Umstellung auf
ES-Module wegfällt, weil Modul-Deklarationen nicht auf window liegen.
Ohne Ersatz wären schlagartig alle Handler tot gewesen, und zwar erst
beim Klicken sichtbar.

resolveAction() fällt intern weiterhin auf window zurück — das brauchen
die vier Handler des Log-Betrachters, der als klassisches Skript in ein
eigenes Popup geladen wird.
```

<a id="die-anmelde-registrier-und-passwortfelde"></a>
## Die Anmelde-, Registrier- und Passwortfelder liegen seit Nachtrag … in

```text
── Formulare: absenden heisst hier „den Knopf druecken" ──────────────────

Die Anmelde-, Registrier- und Passwortfelder liegen seit Nachtrag … in
einem <form>. Nicht aus Formtreue: Ohne umgebendes Formular meldet Chrome
„Password field is not contained in a form", und Passwortmanager bieten
Speichern und Ausfuellen dann nur noch nach Heuristik an — mal ja, mal
nein, ohne dass jemand sagen koennte warum.

Abgesendet wird aber NICHTS: Die Oberflaeche spricht ueber fetch() mit dem
Server, ein echtes Absenden wuerde die Seite neu laden und den Zustand
verlieren. Deshalb hier abbrechen und stattdessen den Knopf ausloesen, den
`data-submit` nennt. Nebeneffekt, und ein erwuenschter: Die EINGABETASTE
im Passwortfeld meldet jetzt an, statt nichts zu tun.

Warum kein onsubmit="…" im HTML: Das waere ein Inline-Handler, und die
CSP dieses Projekts kommt ohne `unsafe-inline` aus (siehe den Kopf dieser
Datei und test/csp-actions.test.js).

Die Knoepfe tragen type="button". Ohne das waeren sie Absendeknoepfe, ihr
Klick loeste wieder ein submit aus, und .click() hier drehte sich im
Kreis.
```

<a id="einmal-wiederholen-bevor-aufgegeben-wird"></a>
## `if`

```text
Erst einmal wiederholen, bevor aufgegeben wird.

Ein einzelner Verbindungsfehler — gemessen ETIMEDOUT beim CDN-Abruf —
liess die Kachel bisher dauerhaft leer: Der Rückfall entfernte das src
oder blendete das Bild aus, und `fallbackDone` verhinderte jeden weiteren
Versuch. Das Bild selbst war in Ordnung. Ein Versuch nach einer Sekunde
fängt genau diese Aussetzer ab.
```

<a id="markloaded"></a>
## `markLoaded`

```text
styles.css blendet JEDES img[loading=lazy] auf opacity:0 aus und erst die
Klasse .loaded wieder ein. Die Markierung darf deshalb nicht an data-fade
hängen — sonst bleibt jedes Bild unsichtbar, dem beim Ergänzen von
loading="lazy" das Zusatzattribut gefehlt hat. Genau das ist passiert:
sieben Stellen in Finanzen, Minifiguren, Galerie, Teilen und der
Startübersicht waren dauerhaft leer, obwohl das Bild geladen war.
```

<a id="renderfigsall"></a>
## `renderFigsAll`

```text
Der Ansichtsumschalter des Figuren-Reiters — fuer BEIDE Listen.

Dieselbe Luecke wie bei den Teilen (Marcos Befund vom 20.10.) und aus
demselben Grund: Hier stand allein renderFigs(), also nur die Figuren aus
Sets. Die manuell erfassten darunter blieben Kacheln, obwohl der Umschalter
ueber beiden steht. Marco hat es an den Teilen gesehen; die Figuren trugen
es unbemerkt mit.
```

<a id="deletemanualfigstop"></a>
## `deleteManualFigStop`

```text
Löschen von einer KACHEL aus — Figur, Teil, Merkposten.

── Warum es diese Stop-Fassungen gibt ──────────────────────────────────────

Die Kachel traegt selbst ein data-click (openManDetail bzw.
oeffneMerkpostenDetail). Ohne stopPropagation oeffnete der Klick auf den
Papierkorb ZUSAETZLICH den Dialog — hinter der Loeschabfrage.

── Hin und zurueck, und warum ──────────────────────────────────────────────

Am 24.09. waren sie kurz weg: „Den Papierkorb auf den Kacheln der manuell
erfassten Teilen und manuell erfassten Minifiguren entfernen." Marcos
naechste Vorgabe hat das fuer die WEBAPP zurueckgenommen — „soll auf den
Kacheln […] der Papierkorb oben rechts angezeigt werden analog den Kacheln
bei den Sets. Dies aber nur in der webapp." In der App bleibt es beim
Entfernen; dort loescht man im Detail.
```
