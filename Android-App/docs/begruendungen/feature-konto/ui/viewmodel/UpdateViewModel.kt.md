# Begründungen zu `feature-konto/ui/viewmodel/UpdateViewModel.kt`

Die ausführlichen Kommentare aus `feature-konto/src/main/java/ch/brickinventoryapp/ui/viewmodel/UpdateViewModel.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="constructor"></a>
## `constructor`

```text
Selbstaktualisierung: nachsehen, laden, installieren lassen. Beim Start still
prüfen, nie von allein laden, dazu ein Knopf in den Einstellungen. Die stille
Prüfung meldet keinen Fehler: Wer ohne Netz startet, hat nichts gefragt; wer den
Knopf drückt, schon.

An die Activity gebunden (aktivitaetsViewModel), damit Startprüfung, Dialog,
Punkt am Kontosymbol und Einstellungen dieselbe Instanz sehen. Der eigene
HTTP-Client kennt weder Server noch Token — nichts davon geht GitHub etwas an.
```

<a id="ladeupdate"></a>
## `ladeUpdate`

```text
Lädt das APK und bietet es zur Installation an. Drei Bedingungen, bevor etwas
installiert wird: 1. Die Adresse zeigt in unsere Release-Ablage (schon in der
Prüfung, hier nochmal — zwischen Prüfung und Klick kann ein neuer Zustand
stehen). 2. Die Signatur stimmt mit der installierten App überein. 3. Der Nutzer
hat die Systemerlaubnis erteilt.

Erst danach öffnet sich der System-Installer, und auch der fragt nochmal.
```

<a id="obergrenze"></a>
## `obergrenze`

```text
── Wieviel darf höchstens kommen? ──

Die angekündigte Grösse (plus ein Megabyte Luft) oder die feste
Obergrenze — was kleiner ist. Die Ankündigung stammt aus
version.json, der hier nicht blind vertraut wird; die feste Grenze
allein liesse eine Antwort durch, die 46 MB verspricht und 300
liefert.
```
