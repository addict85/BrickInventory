# Begründungen zu `public/js/24-router.js`

Die ausführlichen Kommentare aus `public/js/24-router.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="jede-ansicht-steht-als-pfad-in-der-adres"></a>
## Jede Ansicht steht als `#/pfad` in der Adresse, Filter als Query dahinter.

```text
═══ Adresse und Verlauf ════════════════════════════════════════════════════

Jede Ansicht steht als `#/pfad` in der Adresse, Filter als Query dahinter.
Ein Hash-Router, damit der Server für Unterseiten nichts ausliefern muss
und die Anmeldelinks (?token=, ?set=) unverändert bleiben. Jeder offene
Dialog ist ein Verlaufseintrag: Die Zurück-Geste schliesst ihn, statt die
App zu verlassen.
```
