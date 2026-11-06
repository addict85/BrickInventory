# Begründungen zu `test/frontend-escaping.test.js`

Die ausführlichen Kommentare aus `test/frontend-escaping.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Statischer XSS-Regressionstest für public/js/.

Die Listen- und Detailansichten entstehen per innerHTML aus
Template-Literalen; jedes Datenfeld, das ungeescaped in ein Attribut oder
einen JS-String im Attribut wandert, ist ein Stored-XSS-Vektor.

Geprüft ohne DB und ohne Browser:
  1. Die Escaping-Helfer verhalten sich in ihrem Kontext korrekt.
  2. Es gibt keine ungeschützten Sinks in den Frontend-Dateien — die
     nächste Zeile `src="${x}"` wird hier rot statt in Produktion.
```

<a id="jsdir"></a>
## `const jsDir = path.join(__dirname, '..', 'public', 'js');`

```text
── Woher dieser Test kommt ──────────────────────────────────────────────
t() maskiert die eingesetzten Werte, weil das Ergebnis meist in innerHTML
landet. Geht es dagegen nach textContent, erscheint die Maskierung
WÖRTLICH: Aus der Schweizer Tausendertrennung 9'325 wurde im Katalog
sichtbar "9&#39;325 Sets im Katalog".

Die Regel lautet deshalb: HTML-Ziel → t(), Textziel → tRaw().

Bewusst auch dort angewandt, wo gerade keine Variable übergeben wird —
ohne Variablen sind beide identisch, aber so bricht die Stelle nicht
erneut, sobald jemand einen Wert ergänzt.
```

<a id="bad-stelle"></a>
## `const bad = [];`

```text
── Woher dieser Test kommt (Nachtrag 30) ────────────────────────────────
Die Finanztabelle setzte den Fehlertext eines Sets roh in innerHTML:
    `<td …>${s.error ? s.error : fmtN(total, cur)}</td>`
Diese Meldung kommt nicht aus dem eigenen Haus: clients/bricklink.ts baut
sie bei einer Nicht-JSON-Antwort aus dem ANTWORTKÖRPER —
    `BrickLink non-JSON (HTTP ${status}): ${body.substring(0, 200)}`
Liefert BrickLink (oder ein Proxy, ein Portal, eine CDN-Fehlerseite) HTML
statt JSON, landen dessen erste 200 Zeichen unmaskiert im DOM. Mit
`<img src=x onerror=…>` in diesen 200 Zeichen ist das ein aktiver Handler
in der Seite des Nutzers — die Kette wurde nachgestellt, bevor sie
gemeldet wurde.

Die Regeln oben decken Attribut- und Handler-Kontexte ab. Diese hier
deckt den TEXTkontext ab, und zwar nur für Felder, deren Inhalt von aussen
kommen kann (.error/.message).

Bewusst NICHT gemeldet werden:
  • Zeilen ohne HTML-Tag — dort geht der Wert an textContent oder in eine
    Variable, die an ihrer Einsetzstelle maskiert wird (nachgeprüft für
    addCsvLog in 02-gallery.js und priceStatusBadge in 04-finance.js)
  • Vorkommen in BEDINGUNGSstellung (`s.error ? … : …`) — dort entscheidet
    der Wert nur, ausgegeben wird er nicht
  • Zeichenkettenliterale wie t('settings.error') — Übersetzungsschlüssel
```
