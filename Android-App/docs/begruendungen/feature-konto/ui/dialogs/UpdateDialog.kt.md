# Begründungen zu `feature-konto/ui/dialogs/UpdateDialog.kt`

Die ausführlichen Kommentare aus `feature-konto/src/main/java/ch/brickinventoryapp/ui/dialogs/UpdateDialog.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="updateroute"></a>
## `UpdateRoute`

```text
„Es gibt eine neue Fassung — jetzt aktualisieren?“ Ein Dialog beim Start, weil
ein Punkt am Konto-Symbol leicht übersehen wird. Geladen wird trotzdem nie von
allein: Der Dialog fragt, der Ladevorgang beginnt erst auf „Jetzt aktualisieren“
— fragen ist nicht automatisch handeln.

Er bleibt offen, während geladen wird: Wer hier „Ja“ sagt, hat den Vorgang hier
angestossen; der Fortschritt stünde sonst nur in den Einstellungen, wo dieser
Nutzer gerade nicht ist. Er begleitet den Weg: fragen, laden, installieren
lassen.

Er erscheint nicht, solange nichts gefunden wurde, und nicht mehr nach „Später“
(für diesen App-Lauf, siehe UpdateUiState.dialogAbgelehnt). Während des Ladens
schliesst ihn kein Tippen daneben — ein halb geladenes APK ohne sichtbaren
Vorgang wäre schlechter als ein Dialog, der stehen bleibt.
```
