# Begründungen zu `test/bedienung-browser.test.js`

Die ausführlichen Kommentare aus `test/bedienung-browser.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Einzelne Bedienbefunde in Chrome, an der echten App:
  - Bestätigungsdialog: Escape gibt den Fokus an den Auslöser zurück; ist
    „Weitere Aktionen“ zugeklappt (es klappt bei der Wahl zu), an dessen <summary>;
  - Set-Ansicht: „Teile neu importieren“ (unter „Weitere Aktionen“) ist ein
    beschrifteter Knopf von mindestens 24 × 24 px ohne Inline-Stil;
  - Konto: das Häkchen „Auch alle Passkeys entfernen“ ist selbst 24 × 24 px;
  - jede :hover-Regel der geladenen Stylesheets steht in @media (hover:hover):
    Auf Touchgeräten bleibt sonst der Hover-Zustand nach dem Tippen kleben;
  - Anmeldemaske in allen sechs Designs hell und dunkel: Knöpfe und Felder
    grenzen sich 3:1 ab („Mit Passkey anmelden“), Text 4,5:1.
```
