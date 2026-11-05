# Begründungen zu `test/frontend-imports.test.js`

Die ausführlichen Kommentare aus `test/frontend-imports.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Frontend-Module: Ruft eine Datei einen Namen auf, den ein ANDERES Modul
deklariert, ohne ihn zu importieren?

── Warum das nötig ist ─────────────────────────────────────────────────────
`public/js/` sind ES-Module, die der Bundler aneinanderreiht. Ein Aufruf, der
ins Leere zeigt, fällt weder beim Bauen noch beim Laden auf — erst wenn der
betroffene Knopf gedrückt wird, steht in der Browser-Konsole
„X is not defined", und die Handlung bricht mittendrin ab.

Genau so gemeldet: Beim Eigentümerwechsel im Kaufpreis-Dialog warf
`closeModal is not defined`. Die Funktion lag als modul-lokale Funktion in
02-gallery.js und war nur über registerActions() für data-click-Knöpfe
erreichbar — 07-admin.js rief sie direkt auf. Der Wechsel selbst war schon
gespeichert; sichtbar blieb ein offener Dialog und eine veraltete Galerie.

Das ist die Frontend-Fassung von test/require-exports.test.js: Dort prüft
TypeScript die späten require() nicht, hier prüft niemand die Modulgrenzen.
```

<a id="stelle"></a>
## `quellen.set('../i18n.js', ohneKommentare(`

```text
── i18n.js gehört dazu (Nachtrag 138) ────────────────────────────────────

Diese Prüfung las ausschliesslich public/js/. i18n.js liegt eine Ebene
höher (public/i18n.js) und war damit unsichtbar — ihre Exporte galten als
„unbekannter Name" und wurden übersprungen.

Marcos Befund: js/12-pdfviewer.js rief t() ohne Import. Im Browser
„ReferenceError: t is not defined", und zwar erst beim ÖFFNEN eines PDFs —
nicht beim Laden der Seite, also auch nicht beim Bündeln.
```
