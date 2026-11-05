# Begründungen zu `test/markup-und-sprachtext.test.js`

Die ausführlichen Kommentare aus `test/markup-und-sprachtext.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Was im Markup steht, ist auch das, was der Sprachtext sagt.

── Woher das kommt ─────────────────────────────────────────────────────────

Marcos Meldung vom 17.10.: „Bitte bei Profil-Einstellungen auch noch ein
Icon verwenden." Das Symbol stand längst im Markup — nur ersetzt
`data-i18n` beim Übersetzen den ganzen Inhalt durch den Sprachtext, und der
hatte keines. Sichtbar war also nie, was dasteht.

NACHGEZÄHLT waren es nicht ein, sondern 36 solcher Stellen in index.html:
„Minifigs" ↔ „Minifiguren", „Setnummer" ↔ „Set-Nummer", „🗑️ Reset" ↔
„🗑️ Zurücksetzen". Alle kosmetisch — sichtbar ist immer der Sprachtext —,
aber jede einzelne ist eine Stelle, an der man beim Entwickeln das eine
sieht und im Betrieb das andere.

test/menue-sichten.test.js hält das für die acht Menüeinträge fest. Diese
Prüfung zieht denselben Strich durch die ganze Datei.

── Zwei Ausnahmen, beide begründet ─────────────────────────────────────────

1. Elemente mit `data-i18n-attr`: Dort setzt i18n ein ATTRIBUT. Der Inhalt
   gehört nicht dazu und darf etwas anderes sein.

2. Sprachtexte mit Platzhalter (`{n}`): Das Markup trägt die echte Zahl
   („(Standard: 4000)"), der Sprachtext die Form. Als Rückfall ist die Zahl
   BESSER — ein sichtbares „{n}" wäre Unsinn. GEMESSEN sind das genau drei
   Stellen, alle `settings.default_n`.

── Und die schärfere Regel daneben ─────────────────────────────────────────

Ein Element mit `data-i18n` darf keine KIND-Elemente haben. `textContent`
ersetzt den gesamten Inhalt, Kinder inbegriffen. GEMESSEN gab es genau
einen solchen Fall:

    <div data-i18n="settings.global_title">🌐 Globale Einstellungen
      <span …>(Admin)</span></div>

Beim ersten Übersetzen verschwanden dort das 🌐 UND das „(Admin)". Der
Schlüssel sitzt jetzt am inneren Feld — dieselbe Lösung wie beim
Benutzernamen (test/benutzername-menueknopf.test.js).
```
