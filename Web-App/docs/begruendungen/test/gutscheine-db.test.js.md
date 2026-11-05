# Begründungen zu `test/gutscheine-db.test.js`

Die ausführlichen Kommentare aus `test/gutscheine-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Gutscheine (LEGO-Geschenkkarten) — gegen eine echte Datenbank.

── Marcos Vorgabe ──────────────────────────────────────────────────────────

„Im Eigenen Profil sollen Lego-Gutscheine mit Gutscheinnummer und Pins und
Betrag hinterlegt werden können. Für die Erfassung soll dies entweder
manuell möglich sein für die 3 Werte oder das PDF des Gutscheins soll
hochgeladen werden können und die App soll daraus die Werte extrahieren.
[…] Die Erfassung, Änderung und Anzeige soll sowohl in der Android-App als
auch in der Webapp möglich sein […] Bitte die Login jeweils nur 1x im
Backend bauen. Beide Apps sollen die gleichen Services des Backends
verwenden."

── Warum mit DB und ueber HTTP ─────────────────────────────────────────────

Die wichtigste Aussage dieser Funktion ist eine ABGRENZUNG, und die steht
nirgends im Quelltext zu lesen: Ein Gutschein gehoert NUR seinem Konto.
Ueberall sonst im Baum gilt das Haushalts-Blickfeld — der Grossvater sieht
die Sets der Enkel. Hier nicht, denn Nummer und PIN sind alles, was zum
Einloesen noetig ist.

Eine Textpruefung koennte das nicht zeigen. Deshalb laufen hier echte
Anfragen gegen einen echten Router mit echter Datenbank, einmal mit
Sitzungscookie (Webapp) und einmal mit Bearer-Token (Android) — denn die
Aussage „beide Apps benutzen DENSELBEN Dienst" ist auch nur dann belegt,
wenn beide Wege an derselben Route ankommen.

Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
Ausfuehren: REQUIRE_DB=1 npm test
```

<a id="voucher-dir"></a>
## `const VOUCHER_DIR = path.join(ROOT, 'data', 'vouchers');`

```text
Wo die Gutschein-PDFs liegen.

Einmal aus festen Teilen zusammengesetzt, danach wird nur noch der
variable Rest drangehaengt. Der Grund steht in test/eigenbruecken.test.js:
Ein `path.join(ROOT, …)` mit variablem Segment nimmt jener Pruefung die
Sicht, ob ein Test eine Datei liest, die es gar nicht gibt. Hier ist der
feste Teil tatsaechlich fest — also gehoert er ausgeschrieben.
```

<a id="alshash"></a>
## `const alsHash = t => crypto.createHash('sha256').update(t).digest('hex`

```text
Marcos Vorgabe „beide Apps sollen die gleichen Services verwenden"
ist genau hier belegt: kein zweiter Router, kein zweiter Pfad — nur
ein anderer Ausweis an derselben Tuer.
Die Tabelle haelt den SHA-256-Hex des Tokens, nicht den Klartext —
der Klartext existiert nur beim Klienten (siehe src/konto/auth.ts). Ein
Test, der den Klartext einfuegt, prueft nichts.
```

<a id="stelle"></a>
## `const { ohneKommentare } = require('./helpers/sources');`

```text
Die Pfade unten stehen AUSGESCHRIEBEN und nicht hinter einem Helfer mit
Variable: Ein `path.join(ROOT, rel)` nimmt test/eigenbruecken.test.js die
Sicht darauf, ob ein Test eine Datei liest, die es gar nicht gibt — und
genau dieser Waechter ist hier prompt rot geworden.
ohneKommentare: Die Erklaertexte in 17-gutscheine.js nennen die
entfernten Wege beim Namen („Hier standen zwei Knoepfe: window.open …").
Eine Textpruefung, die sie mitliest, prueft die Prosa und nicht den Code —
und war prompt rot, obwohl der Code stimmte.
```

<a id="gutscheinkopieren"></a>
## `const kopierRumpf = js.slice(js.indexOf('function gutscheinKopieren'))`

```text
Kopiert wird die ROHE Nummer: Die Vierergruppen sind eine Lesehilfe,
ein Bezahlfeld nimmt sie nicht an.

Geprueft wird die Zeile IN der Kopierfunktion, nicht irgendein
`String(g.number)` in der Datei. Die erste Fassung tat Letzteres und
blieb bei der Gegenprobe gruen — die Anzeigefunktion darueber enthaelt
denselben Ausdruck, also bestand sie aus dem falschen Grund.
```
