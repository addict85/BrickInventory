# Begründungen zu `test/theme.test.js`

Die ausführlichen Kommentare aus `test/theme.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Das global eingestellte Design (global_settings.app_theme) muss auch VOR dem
Login gelten — auf Login- und Startup-Screen.

Es waren drei unabhängige Ursachen, jede für sich ausreichend, um den
Login-Screen im Standarddesign zu lassen:

  1. GET /api/settings/theme lag hinter router.use(requireLogin) — der Wert
     war vor dem Login gar nicht abrufbar (der Kommentar an der Route sagte
     schon immer „von allen Nutzern lesbar").
  2. applyTheme() wurde nur aus showApp() aufgerufen, also erst NACH
     erfolgreichem Login.
  3. #login-screen und #startup-screen hatten background:#fff hartkodiert —
     der Startup-Screen sogar als Inline-Style, der jede Stylesheet-Regel
     überstimmt.

Der Test prüft alle drei, ohne DB und ohne Browser. Ausführen: npm test
```

<a id="alsdatei"></a>
## `const alsDatei = fs.readdirSync(path.join(PUB, 'themes'))`

```text
── Warum das eine eigene Pruefung ist ──────────────────────────────────

Ein Design steht an FUENF Stellen: als Datei unter public/themes/, als
<link> in index.html, in der Whitelist des Servers, in ALLOWED des
Boot-Skripts und in der App (PreferencesManager.ERLAUBTE_DESIGNS). Fehlt
es an einer davon, faellt das nicht auf, sondern wirkt teilweise: Der
Admin kann es waehlen, der Server nimmt es an, und das Boot-Skript
verwirft es beim naechsten Start stillschweigend — genau die Sorte
Fehler, die man erst im Betrieb sieht.

── Die fuenfte Liste kam dazu, nachdem sie gefehlt hat ─────────────────

"noppe" und "hochglanz" wurden ausgeliefert, ohne dass index.html ihre
Stylesheets lud. Diese Pruefung war damals gruen: Die Datei lag da, die
drei Listen nannten das Design, und der Server lieferte es aus. Im
Browser kamen dann NUR die Farben an — die stehen in tokens.css, EINER
Datei fuer alle Designs — und keine einzige Struktur. Das Design sah
aus wie das Grunddesign mit roten Knoepfen.

Der <link> ist damit die fuenfte Stelle, und sie ist die einzige, an der
ein Fehlen nicht zum Verwerfen fuehrt, sondern zu einer halben Anzeige.
```

<a id="tokens"></a>
## `const tokens = fs.readFileSync(path.join(PUB, 'tokens.css'), 'utf8');`

```text
── Warum das festgehalten wird ──────────────────────────────────────────
Schieferblau steht im Stein-Design für „Neu", Sand für „Gebraucht"
(.cond-new / .cond-used). Tragen die Diagrammlinien dieselben Farben, muss
niemand die Legende lesen — die Zuordnung ist schon gelernt.

Läuft eines von beiden künftig auseinander, ist die Wiedererkennung
stillschweigend weg: Das Diagramm sieht weiterhin richtig aus, führt aber
in die Irre.

Kommentare werden entfernt: Der Erklärtext daneben nennt die frühere Farbe
(#3d5a80), und ein einfacher Regex-Treffer landete zuerst dort.
── Zwei Dateien, seit die Tokens erzeugt werden ────────────────────────
Die WERTE (--chart-new/--chart-used) stehen seit dem Zusammenlegen in
public/tokens.css, erzeugt aus shared/design-tokens.json, damit die
Android-App dieselben fuehrt. Die PLAKETTEN (.cond-new/.cond-used) sind
reine Web-Gestaltung und blieben in themes/brick.css.

Die Regel ueberspannt damit beide Dateien — und das ist ihr Punkt: Sie
haelt Wert und Plakette zusammen, ganz gleich, wo beide wohnen.
Nur der STEIN-Block von tokens.css: Die Datei fuehrt beide Designs
untereinander, und ein blosses match() nimmt den ersten Treffer — das
waere der klassische Wert, waehrend die Plakette daneben die des
Stein-Designs ist. Genau so ist diese Pruefung beim Umbau einmal
fehlgeschlagen, und zwar mit der richtigen Meldung.
```

<a id="designs"></a>
## `const DESIGNS = ['classic', ...fs.readdirSync(path.join(PUB, 'themes')`

```text
── Der Fehler, den diese Regel verhindert (Nachtrag 168) ────────────────

Marco: „Teilweise (nicht bei allen Designs) muss beim Aendern die Seite
neu geladen werden."

js/01-konto.js fuehrte in applyTheme() eine ZWEITE Liste:

    if (theme !== 'brick' && theme !== 'classic') return null;

geschrieben, als es zwei Designs gab. Inzwischen sind es sechs. Die vier
neueren wurden dort abgewiesen, BEVOR der Aufruf das Boot-Skript
erreichte — sie wirkten erst beim naechsten Seitenaufruf.

Die Pruefung „applyTheme laeuft ueber den Boot-Helfer" daneben war die
ganze Zeit gruen: Sie sieht nach, ob `__bimApplyTheme` im Quelltext
VORKOMMT, nicht ob der Aufruf dort ankommt. Zwischen Erwaehnung und
Erreichbarkeit lag ein `return null`.

Deshalb hier die Regel dahinter: Die Liste steht an genau einer Stelle.
Die Designs aus den Dateien ableiten, nicht aufzaehlen — sonst haette
diese Regel selbst die Liste, gegen die sie gebaut ist.
```

<a id="wer-die-reiterleiste-umbrechen-laesst-ve"></a>
## `test('wer die Reiterleiste umbrechen lässt, verschmälert sie unbedingt`

```text
Ein Design, dessen Reiterleiste umbrechen darf, verschmälert die Reiter
UNBEDINGT — nicht hinter einer Medienabfrage.

── Marcos Befund, zweimal ──────────────────────────────────────────────────

  „Monitoring sollte auf der gleichen Zeile sein wie die restlichen Tabs."
  … und nach dem ersten Anlauf: „Die Menüs in der Webapp sind nicht alle
  auf einer Zeile."

Der erste Anlauf hat die Reiter nur für MITTLERE FENSTER verschmälert, und
genau das ging am Kern vorbei: Eine Medienabfrage misst das Fenster. Die
Reiter stehen im Design „Stein" aber in #app, und das ist auf 1200px
gedeckelt. Auf einem breiten Bildschirm griff die Abfrage also nicht, und
die vollen Pills mussten sich trotzdem in dieselben 1168px drängen.

Im Browser auf der ECHTEN Seite gemessen (Chromium, Design „Stein",
neun Reiter — die Zahl, die ein Verwalter sieht):

    Fenster 1920px  →  #app 1200px  →  nav 1168px
    volle Pills                        1162px nötig   (sechs Pixel Luft)
    schmale Pills                       968px nötig

── Was hier geprüft wird ───────────────────────────────────────────────────

Nicht die Pixel — die kann ein Test ohne Browser nicht sehen —, sondern die
NAHT: Wer seine Reiterleiste umbrechen lässt und seinen Inhalt zugleich auf
eine feste Breite deckelt, darf die Verschmälerung nicht von der
Fensterbreite abhängig machen. Die beiden Grössen haben nichts miteinander
zu tun.
```
