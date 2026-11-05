# Begründungen zu `test/i18n-aufrufe.test.js`

Die ausführlichen Kommentare aus `test/i18n-aufrufe.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Jeder Schlüssel, den die Oberfläche ruft, steht auch im Wörterbuch.

── Der Befund ──────────────────────────────────────────────────────────────

`t()` fällt für einen unbekannten Schlüssel auf den SCHLÜSSEL SELBST zurück
(public/i18n.js: `dict[key] || I18N['de']?.[key] || key`). Das ist als
letzte Stufe richtig — sichtbar wird es aber sofort:

NACHGEMESSEN trugen NEUN Auswahlfelder in index.html ein `data-i18n` mit
`data-i18n-attr="aria-label"` auf einen Schlüssel, den es in KEINER der
beiden Sprachdateien gab — Jahr von/bis im Katalog, Sortierung und
Themenfilter in Galerie und Katalog, Farbe, Ersatzteile und Ansicht bei den
Teilen, die CSV-Auswahl, Registrierung und SMTP-Verschlüsselung in den
Einstellungen.

Im HTML stand jeweils ein deutsches `aria-label` als Vorgabe. `applyLang()`
läuft aber bei JEDEM Seitenaufbau über alle `[data-i18n]` und ÜBERSCHREIBT
das Attribut mit dem Ergebnis von `t()` — also mit dem rohen Schlüssel. Ein
Bildschirmleser las danach „catalog.year_from" vor, in beiden Sprachen. Wer
die Oberfläche sieht, merkt davon nichts; das ist der Grund, warum es so
lange stehen konnte.

── Warum die bestehenden i18n-Tests das nicht fanden ───────────────────────

i18n.test.js vergleicht DE und EN miteinander, i18n-duplicates.test.js sucht
doppelte Schlüssel. Beide sehen nur die Wörterbücher. Ein Schlüssel, der in
BEIDEN fehlt, ist für sie in Ordnung — die Frage „ruft ihn überhaupt jemand,
und gibt es ihn dann auch?" hat niemand gestellt.

── Die eine Ausnahme, und warum sie eine ist ───────────────────────────────

01-monitor.js baut einen Schlüssel zusammen: `t('monitor.job.' + k)`. Der
Aufruf prüft das Ergebnis SELBST gegen den Schlüssel und fällt auf die
Beschriftung des Servers zurück, wenn nichts da ist. Solche Präfixe enden
auf einen Punkt und werden hier übersprungen — mit einer Zusicherung auf
ihre Anzahl, damit ein zweiter Fall auffällt statt sich anzuschliessen.
```

<a id="jede-data-i18n-form-wird-von-applylang-a"></a>
## `test('jede data-i18n-Form wird von applyLang auch ausgewertet', () => `

```text
── Und die Form des Aufrufs? ───────────────────────────────────────────────

Die Prüfung oben fragt, ob es den SCHLÜSSEL gibt. Sie kann nicht fragen, ob
ihn überhaupt jemand liest — und genau daran lag ein zweiter Fall derselben
Sorte:

    <div … data-i18n-before="finance.market_label">Ø Marktpreis: <span …>

`applyLang()` kennt vier Formen (data-i18n, -attr, -vars, -tab). `-before`
ist keine davon; das Attribut stand da und tat nichts. Die Beschriftung des
Portfolio-Diagramms blieb deshalb in JEDER Sprache deutsch — und der
Schlüssel lag als „nie gerufen" im Wörterbuch, was ihn wie Ballast aussehen
liess statt wie eine Lücke.

Warum jemand ihn erfunden hat, ist am Markup ablesbar: Der Text steht neben
einem <span>, und `textContent` würde den span mitsamt Wert überschreiben.
Die Lösung braucht dafür keine fünfte Form — der Text bekommt seinen eigenen
<span data-i18n="…">, und die vorhandene Mechanik greift.

Die erlaubten Formen werden aus i18n.js GELESEN, nicht abgeschrieben: Eine
Liste, die eine Verdrahtung abschreibt, prüft die Verdrahtung nicht (siehe
test/helpers/sources.js, routerEinhaengungen).
```
