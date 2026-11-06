# Begründungen zu `test/pdfkit-render.test.js`

Die ausführlichen Kommentare aus `test/pdfkit-render.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
pdfkit erzeugt tatsächlich ein gültiges PDF — mit genau der API, die diese
Anwendung benutzt.

── Warum es diesen Test gibt (Nachtrag 137) ────────────────────────────────

`npm ci` warnte:
    npm warn deprecated jpeg-exif@1.1.4: Package no longer supported.

jpeg-exif ist keine eigene Abhängigkeit, sondern kam über pdfkit 0.15.2. In
pdfkit 0.20.1 ist sie ersatzlos weg — die Behebung war also ein Versionssprung
über fünf Minor-Versionen.

Ein Sprung über eine Bibliothek, die PDFs zeichnet, verlangt mehr als „npm
install und Tests laufen lassen": Die vorhandenen Tests prüfen die
AUFTRAGSVERWALTUNG (pdf-jobs-db), nicht das Zeichnen. Ein pdfkit, das seine
API stillschweigend ändert, wäre grün durchgelaufen und erst bei Marcos
erstem Export aufgefallen.

Geprüft wird deshalb der ganze Methodensatz, den die Anwendung wirklich
ruft — ermittelt aus routes/api_v1/pdf.ts und src/katalog/instructions.ts:
  addPage, circle, currentLineHeight, end, font, fontSize, image,
  moveDown, moveTo, on, text
```
