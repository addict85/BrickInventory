# Begründungen zu `public/js/01-dialoge.js`

Die ausführlichen Kommentare aus `public/js/01-dialoge.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="fuer-jedes-ovl-role-dialog-an-einer-stel"></a>
## Für jedes `.ovl[role=dialog]` an EINER Stelle: Escape schliesst den

```text
═══ Tastaturbedienung aller Dialoge ════════════════════════════════════════

Für jedes `.ovl[role=dialog]` an EINER Stelle: Escape schliesst den
obersten offenen Dialog, beim Öffnen springt der Fokus hinein, Tab bleibt
darin, und beim Schliessen kehrt der Fokus dorthin zurück, wo er vorher war.

Geschlossen wird über den Knopf mit `data-dialog-zu` — so läuft dieselbe
Aufräumarbeit wie beim Klick auf ✕, statt sie hier nachzubauen.
```
