# Begründungen zu `public/js/00-stile.js`

Die ausführlichen Kommentare aus `public/js/00-stile.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="die-csp-erlaubt-keine-style-attribute-im"></a>
## Die CSP erlaubt keine style-Attribute im Markup: Eine eingeschleuste

```text
── Stile ohne 'unsafe-inline' ───────────────────────────────────────────────

Die CSP erlaubt keine style-Attribute im Markup: Eine eingeschleuste
Auszeichnung soll die Seite nicht umgestalten können (falsches Formular über
dem echten). Das Markup trägt den Stil deshalb als data-stil, und diese Datei
setzt ihn per CSSOM — aber nur Werte, die so im Quelltext stehen. Die Liste
baut scripts/build-frontend.js; was nicht darauf steht, bleibt wirkungslos.
```
