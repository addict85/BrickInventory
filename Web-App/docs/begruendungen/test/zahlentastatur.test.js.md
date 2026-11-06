# Begründungen zu `test/zahlentastatur.test.js`

Die ausführlichen Kommentare aus `test/zahlentastatur.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Auf dem Handy erscheint bei Zahlenfeldern die Zahlentastatur.

── Marcos Vorgabe vom 28.09. ───────────────────────────────────────────────

  „Bitte auch in der Webapp sicherstellen, dass wenn man mit einem mobilen
   Device aufruft, dass in allen Eingabefeldern nur das Zahlenfeld
   erscheint."

── Warum `type="number"` allein nicht reicht ───────────────────────────────

Es reicht MEISTENS: Chrome und Safari zeigen dann eine Ziffernblock-Tastatur.
Aber es ist eine Typ-Angabe, keine Tastatur-Angabe — was der Browser daraus
macht, ist ihm überlassen. Mehrere Android-Tastaturen zeigen dort die volle
Tastatur mit einer Ziffernreihe obendrauf, und bei Preisen sitzt das Komma
dann nicht auf dem Block.

`inputmode` sagt es direkt und ist genau dafür da: `numeric` für ganze
Zahlen (Menge, Port, Kontingent), `decimal` für alles mit Komma (Preise,
Schwellen). Beides zusammen — der Typ für die VALIDIERUNG, der Modus für die
TASTATUR.

── Warum die Regel nur `type="number"` verlangt ────────────────────────────

Ein Feld ist für diese Prüfung genau dann ein Zahlenfeld, wenn es sich
selbst so nennt. Nach „sieht numerisch aus" zu suchen hiesse raten: Die
Teilenummer „3001pb01" und die Figurennummer „sw0001" sehen wie Zahlen aus
und sind keine — eine Zahlentastatur machte sie unbenutzbar. Wer ein neues
Zahlenfeld anlegt, schreibt `type="number"` ohnehin hin; genau dort greift
die Regel.
```
