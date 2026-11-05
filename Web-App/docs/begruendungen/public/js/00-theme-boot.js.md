# Begründungen zu `public/js/00-theme-boot.js`

Die ausführlichen Kommentare aus `public/js/00-theme-boot.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="laeuft-als-blockierendes-skript-im-head"></a>
## Läuft als blockierendes Skript im <head>, also VOR dem ersten Paint — und

```text
═══ Theme-Boot ═══════════════════════════════════════════════════════════
Läuft als blockierendes Skript im <head>, also VOR dem ersten Paint — und
bewusst vor 01-core.js.

Vorher wurde applyTheme() ausschliesslich aus showApp() heraus aufgerufen,
also erst NACH erfolgreichem Login. Login- und Startup-Screen bekamen
dadurch nie ein data-theme und blieben im Standard-Design, obwohl das Design
global (global_settings.app_theme) für alle gilt.

Zwei Stufen, damit es weder blinkt noch veraltet:
  1. Sofort: der zuletzt bekannte Wert aus localStorage. Kein Netzwerk, kein
     Aufblitzen des falschen Designs.
  2. Gleich danach asynchron: GET /api/v1/settings/theme (öffentlich, siehe
     routes/settings.ts). Weicht der Serverwert ab — anderer Browser, anderes
     Gerät, Admin hat gerade umgestellt — wird korrigiert und gecacht.

Der Server liefert das Design des angemeldeten Kontos (oder die Vorgabe des
Verwalters); der Cache merkt sich den zuletzt gelieferten Wert je Browser.
```

<a id="apply"></a>
## `apply`

```text
Wendet ein Design an. Unbekannte Werte (null, '', undefined) bedeuten
"keine Information" und ändern NICHTS.

Vorher fielen sie auf 'classic' zurück. Das war die Ursache des Flackerns
beim Login: showApp() ruft applyTheme(d.settings.app_theme) auf, und wenn
dieser Wert fehlte oder leer war, schaltete die Seite sichtbar von 'brick'
auf 'classic' zurück — und schrieb 'classic' obendrein in den Cache, sodass
der nächste Seitenaufruf schon falsch startete und beim Server-Abgleich
erneut umsprang.
```
