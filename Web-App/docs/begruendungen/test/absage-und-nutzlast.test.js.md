# Begründungen zu `test/absage-und-nutzlast.test.js`

Die ausführlichen Kommentare aus `test/absage-und-nutzlast.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="absagen-aus-src-haushalt-haushalt-ts-hei"></a>
## `test('Absagen aus src/haushalt/haushalt.ts heissen fehler, nicht code'`

```text
Eine Absage darf nicht heissen wie die Nutzlast.

── Der Fehler aus dem Betrieb ──────────────────────────────────────────────

Marco: „Wenn ich auf Einladungscode erzeugen klicke, kommt folgender Fehler:
POST /api/v1/settings/household/invite 500: TypeError: Cannot read
properties of undefined (reading 'de')".

createInvite() lieferte im ERFOLGSFALL `{ code: <Einladungstoken> }` und im
FEHLERFALL `{ code: 'konto_bereits_verknuepft' }`. Die Route
entschied mit `if (r.code)`, ob etwas schiefgegangen war — und hielt damit
jede erfolgreiche Einladung fuer einen Fehler. Der Zufallstoken ging als
Fehlercode in fehlerText(), stand dort in keiner Tabelle, und der Zugriff
auf `eintrag['de']` lief in undefined.

Die Funktion hat seit jenem Umbau NIE funktioniert.

── Warum es keine Pruefung gemerkt hat ─────────────────────────────────────

household-db.test.js prueft beide Rueckgaben — aber einzeln, direkt an der
Funktion, und beide Male ueber `.code`. Die ENTSCHEIDUNG trifft die Route,
und die kam in keinem Test vor. Ein Feld, das zwei Dinge bedeutet, faellt
genau dann nicht auf, wenn man beide Bedeutungen getrennt betrachtet.

Deshalb pruefen die Regeln hier die Naht zwischen Helfer und Route, nicht
die Enden.
```

<a id="quelle"></a>
## `const quelle = require('./helpers/sources').ansichtQuelle('05');`

```text
── Marcos Befund ────────────────────────────────────────────────────────

„Wenn ich die Waehrung aendere z. B. von CHF auf Euro, steht beim
Einladungscode noch immer CHF (Dieses Konto ist mit keinem anderen
verknuepft. Waehrung: CHF)."

Die Karte nennt die Waehrung im Klartext — locales/de.js:
'household.state_none': '… Waehrung: {cur}'. Gezeichnet wird sie von
loadHousehold(), und die lief nach dem Speichern nicht noch einmal. Der
Wert war also nicht falsch, sondern alt; sichtbar wurde es erst beim
naechsten Seitenaufruf.

Geprueft wird die NACHBARSCHAFT und keine Aufrufreihenfolge: Wer die
Waehrung setzt, muss auch die Karte nachziehen. Dieselbe Regel gilt zwei
Zeilen weiter schon fuer den Standard-Zustand.
```
