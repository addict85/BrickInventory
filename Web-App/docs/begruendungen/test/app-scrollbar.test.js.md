# Begründungen zu `test/app-scrollbar.test.js`

Die ausführlichen Kommentare aus `test/app-scrollbar.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der eigene Scrollbalken der Anwendung erscheint wirklich.

── Marcos Meldung ──────────────────────────────────────────────────────────
„Der Scrollbalken des Browsers ist nun ausgeblendet, aber die App hat keinen
eigenen."

── Die Ursache, und warum sie so leicht zu übersehen war ───────────────────
`app.bundle.js` ist ein KLASSISCHES Skript — kein Modul, kein `defer`. Es
läuft, sobald der Parser es erreicht, und das ist VOR allem, was danach im
Markup steht. Das `<div id="app-scrollbar">` stand am Ende des Body, hinter
dem Skript. Beim Start gab es das Element also noch nicht,
`initScrollbalken()` kehrte still um (`if (!bar) return`) — und weil der
Balken des Browsers per CSS verborgen ist, hatte die Anwendung GAR KEINEN.

Ein stiller Rückzug an einer Stelle, die nur einmal beim Start durchlaufen
wird: Keine Fehlermeldung, kein Eintrag in der Konsole, nichts zu sehen
ausser dem fehlenden Balken.

Deshalb erzeugt die Anwendung das Element jetzt SELBST. Damit hängt der
Balken an keiner Reihenfolge im HTML mehr — und dieser Test prüft nicht die
Reihenfolge, sondern das Ergebnis: Ist die Seite rollbar, ist der Balken da.
```

<a id="scrollbalkencode"></a>
## `function scrollbalkenCode() {`

```text
Den Scrollbalken-Code auswerten.

Er lag bis Nachtrag 136 in 01-core.js, und dieser Test schnitt ihn an der
Kommentarmarke „═══ Eigener Scrollbalken" heraus — der Rest der Datei bindet
beim Auswerten an Elemente der ganzen Oberfläche (Anmeldeformular, Reiter,
Dialoge), und die hier alle nachzubauen hiesse, das halbe index.html zu
kopieren.

Seit dem Umzug IST js/15-scrollbar.js genau dieser Abschnitt. Der Schnitt
entfällt; die Importzeile am Kopf muss weg, weil hier kein Modulsystem läuft
(G() stellt die Bühne unten selbst bereit).
```

<a id="code"></a>
## `const code = scrollbalkenCode();`

```text
── Marcos Bild (Nachtrag 110) ────────────────────────────────────────────
Das Jahr „2027" stand in der GALERIE oben rechts, ohne dass jemand zog.

Zwei Ursachen, beide in meinem Code:

1. Die CSS-Regel zeigt das Etikett nur während `.dragging`. rollen() setzt
   aber `style.display` DIREKT am Element, und eine Inline-Angabe schlägt
   jede Regel. Nach dem Loslassen blieb sie stehen — also blieb das
   Etikett stehen, in jedem Reiter.
2. Der Katalog meldete seine Funktion nie ab. Sie lieferte weiter ein
   Jahr, auch dort, wo die Zahl nichts bedeutet.
```
