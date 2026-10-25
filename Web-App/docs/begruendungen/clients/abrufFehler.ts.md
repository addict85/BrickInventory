# Begründungen zu `clients/abrufFehler.ts`

Die ausführlichen Kommentare aus `clients/abrufFehler.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abruffehler"></a>
## `AbrufFehler`

```text
Die Zusatzangaben, die die Abruf-Klienten an ihre Fehler haengen.

── Warum es diesen Typ gibt ────────────────────────────────────────────────
brickset.ts und bricklink.ts reichern geworfene Fehler seit Langem an:
`err.isTransient = true` bei einem Netzabbruch, `isQuota` beim
Tageskontingent, `isCloudflare` bei einer 1015-Sperre, `detail` mit der
Antwort der Gegenstelle. Die Empfaenger — dieselben Dateien und
jobs/instructionQueue.ts — verzweigen danach.

Diese Verstaendigung war nirgends aufgeschrieben. Sie funktionierte nur,
weil der gefangene Wert `any` war: Jeder Tippfehler (`isCloudFlare`) haette
still `undefined` ergeben und den Zweig lautlos uebersprungen — bei einer
Cloudflare-Sperre heisst das, dass die Warteschlange NICHT pausiert und
weiter gegen eine geschlossene Tuer laeuft.

Jetzt steht die Verstaendigung an einer Stelle, und der Uebersetzer prueft
die Feldnamen.
```
