# Begründungen zu `core-data/data/TokenTausch.kt`

Die ausführlichen Kommentare aus `core-data/src/main/java/ch/brickinventoryapp/data/TokenTausch.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="tokentausch"></a>
## `TokenTausch`

```text
Tauscht den Token, wenn der Server es verlangt (Kopfzeile `X-Token-Rotation:
faellig` oder 401 `token_rotation_noetig`). Der neue Token wird gespeichert,
BEVOR ihn jemand benutzt: Ginge die App zwischen Antwort und Speichern zu,
stünde sonst nur noch der alte da — und der gilt nach dem Tausch nur 5 min.

Nur ein Tausch zugleich (Sperre): Sehen mehrere Anfragen die Kopfzeile, tauscht
die erste; die übrigen finden danach einen anderen Token vor und tun nichts.
Geht die Antwort verloren, wird mit dem alten Token wiederholt — aber nur,
solange die Sitzung dieselbe ist ([TokenSchranke]).
```
