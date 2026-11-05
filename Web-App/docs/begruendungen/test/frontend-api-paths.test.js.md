# Begründungen zu `test/frontend-api-paths.test.js`

Die ausführlichen Kommentare aus `test/frontend-api-paths.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Jeder API-Pfad des Frontends trifft eine Route des Servers.

── Marcos Befund (Nachtrag 141) ────────────────────────────────────────────
„Auf dem Detail-Dialog ist ein '—' beim Kaufpreis. Wenn ich auf Kaufpreise
bearbeiten klicke, ist im neuen Dialog die Tabelle leer."

Elf Aufrufe in js/13-acquisition-modals.js sprachen
    /api/parts/…/acquisitions   und  /api/minifigs/…/acquisitions
an. Diese Routen gibt es NUR unter /api/v1/. `api()` hängt lediglich `/api`
davor — die Anfragen liefen ins Leere, und der Dialog zeigte „—" statt eines
Fehlers, weil der Aufruf ein `.catch(() => null)` trägt.

Der Fehler ist ALT: schon in hardened-221, vor dem Aufteilen der Datei.

── Warum auch Pfade in VARIABLEN geprüft werden ────────────────────────────
Der erste Entwurf sah nur `api('GET', '/…')` — und schwieg. Denn genau die
kaputten Pfade entstehen vorher in einer Variablen:

    const acqUrl = type === 'fig' ? `/minifigs/…` : `/parts/…`;
    const ad = await api('GET', acqUrl);

Deshalb werden zusätzlich alle Pfad-Literale geprüft, deren erstes Segment
der Server unter /api kennt. Ihre HTTP-Methode ist unbekannt; es genügt, dass
IRGENDEINE Methode die Route bedient.
```

<a id="normieren"></a>
## `function normieren(roh) {`

```text
`${…}` wird zu einem Platzhalter-Segment, Abfrageteil fällt weg.

Die Auflösung steht in test/helpers/sources.js und NICHT mehr hier: Diese
Datei hatte eine eigene, naive Fassung (`[^}]*`), die über ein
VERSCHACHTELTES `${…}` nicht hinwegkam. GEMESSEN lieferte sie für

    `/v1/parts/${nr}/${farbe}${owner ? `?owner=${…}` : ''}`

den Text `/api/v1/parts/:x/:x:x` : ''}` — und diese Prüfung blieb trotzdem
grün, weil der Müll zufällig in einem Segment landete, wo die Route `:colorId`
erwartet. Der Vergleich unten nimmt jedes `:`-Segment hin. Begründung und
Messung stehen beim Helfer.
```

<a id="dateien"></a>
## `const dateien = [`

```text
── Auch die .js direkt unter public/ ───────────────────────────────────

Hier stand nur public/js/. Am 25.09. hat das genau einen Aufruf durchgehen
lassen: public/i18n.js rief `api('POST', '/settings', …)` — eine Adresse,
die es seit dem Umzug nach /api/v1/settings nicht mehr gibt. Fuenf 404er
in Marcos Browserkonsole, und aus seiner Sicht liess sich die Sprache
nicht waehlen.

Die Regel war richtig und hat trotzdem geschwiegen, weil sie EINEN Ordner
las. Frontend-Code liegt aber an zwei Stellen: die Module unter public/js/
und i18n.js daneben. Eine Regel, die nach Ordner statt nach Gegenstand
sucht, hat immer so eine Luecke.

app.bundle.js faellt raus: Es ist das Erzeugnis, nicht die Quelle — jeder
Fund darin waere ein zweites Mal derselbe.
```

<a id="for-stelle"></a>
## `for (const m of s.matchAll(/\bapi(?:Roh)?\(\s*'(GET|POST|PUT|DELETE|PA`

```text
Das Literal wird GELESEN, nicht mit einem Muster geschnitten: Hier
stand ``(`[^`]*`|'[^']*')``, und das bricht an einem Backtick IM
Inneren ab. GEMESSEN lieferte es für

    `/v1/parts/${nr}/${farbe}/color${owner ? `?owner=${owner}` : ''}`

den Text `/v1/parts/${nr}/${farbe}/color${owner ` — gemeldet wurde ein
Pfad, den niemand aufruft, und die Route dahinter gab es sehr wohl.
leseLiteral() zählt die Verschachtelung mit (test/helpers/sources.js).
```
