# Begründungen zu `core-data/util/TokenTresor.kt`

Die ausführlichen Kommentare aus `core-data/src/main/java/ch/brickinventoryapp/data/util/TokenTresor.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="z12"></a>
## z12

```text
Verschlüsselung für das Bearer-Token. Das Token öffnet ein Konto auf dem Server
und läuft erst nach TOKEN_IDLE_DAYS Untätigkeit ab. `allowBackup="false"`
verschliesst `adb backup`; bei einem gerooteten Gerät oder einem ausgelesenen
Datenverzeichnis wäre Klartext sofort verwendbar, Geheimtext nicht — der
Schlüssel verlässt den Android-Keystore nie.

Eine eigene Hülle statt androidx.security: AES/GCM und der Keystore sind seit
API 23 Teil der Plattform (minSdk 30) — siebzig lesbare Zeilen statt einer
Abhängigkeit, deren Pflegezustand offen ist.

Ist der Schlüssel weg (Wiederherstellung auf ein anderes Gerät, zurückgesetzte
App-Daten), schlägt das Entschlüsseln fehl, und das heisst „kein gültiges Token
da“: null und die Anmeldemaske. Still auf Klartext zurückzufallen höbe den Sinn
auf. Antwortet der Keystore nur gerade nicht, heisst das nicht „weg“ (oeffne,
data/util/Tresorbefund.kt).
```
