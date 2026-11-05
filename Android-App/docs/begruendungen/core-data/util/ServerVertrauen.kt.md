# Begründungen zu `core-data/util/ServerVertrauen.kt`

Die ausführlichen Kommentare aus `core-data/src/main/java/ch/brickinventoryapp/util/ServerVertrauen.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="z170"></a>
## z170

```text
Pinning für den eigenen Server: Ist ein Pin gemerkt (QR-Feld `fp` oder
bestätigter Erstkontakt), muss ein Zertifikat der gezeigten Kette ihn tragen,
und die Kette muss bis dahin lückenlos signiert sein — dann gilt sie auch ohne
bekannte CA. Ohne Pin wird nie still vertraut. Andere Hosts (Bild-CDN)
prüft nur die Kette.

Angeboten wird ein Schlüssel, der Erneuerungen übersteht: bei einer Kette, die
das System kennt, die Wurzel aus dem Vertrauensspeicher ([anker]) — das oberste
gesendete Zertifikat wäre bei öffentlichen CAs eine Zwischenstelle, und die
wechselt (Let's Encrypt). Sonst das oberste der Kette, bei Caddy mit
`sign_with_root` die Wurzel wie im QR-Code und in der Webapp. Ein Pin auf eine
System-Wurzel deckt jede öffentlich gültige Kette des Hosts — eine eigene CA
bleibt an ihren Schlüssel gebunden.
```

<a id="fingerabdruck-abtippen"></a>
## `FINGERABDRUCK_ABTIPPEN`

```text
Hat jemand den Fingerabdruck aus einer zweiten Quelle abgeschrieben (Webapp,
Zertifikatsanzeige des Browsers)? Ganz oder mindestens die letzten
[FINGERABDRUCK_ABTIPPEN] Hex-Zeichen: 96 Bit — einen Schlüssel mit passendem
Ende zu erzeugen, kostet auch mit viel Rechenzeit zu viel; 64 Bit lägen in
Reichweite. Doppelpunkte, Leerzeichen und Gross-/Kleinschreibung zählen
nicht; Base64 wie im QR-Code nur vollständig.
```
