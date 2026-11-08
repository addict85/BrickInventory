# Begründungen zu `core-update/util/AppUpdate.kt`

Die ausführlichen Kommentare aus `core-update/src/main/java/ch/brickinventoryapp/update/util/AppUpdate.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="z20"></a>
## z20

```text
Die App aktualisiert sich selbst aus dem GitHub-Release: beim Start still
prüfen, nie von allein laden. Es geht, weil der versionCode monoton steigt
(VERSION_CODE_BASE + Anzahl Commits, app/build.gradle.kts).

1. version-signiert.json aus dem Release lesen und ihre Signatur prüfen: gegen
   die Beschreibungsschlüssel der App, solange es keine gibt gegen die Signierer
   der installierten App ([gepruefteBeschreibung])
2. Frist und Stand prüfen ([bewerteFrische]), dann versionCode vergleichen —
   echt grösser, nie „ungleich“
3. APK nach <files>/update/ laden, Adresse gegen die Release-Ablage und die
   signierte Prüfsumme prüfen ([pruefsummePasst])
4. Signatur mit der installierten App vergleichen und den versionCode IM APK
   gegen die Beschreibung ([fassungPasst]), erst dann anbieten

Schritt 4 ersetzt Androids Prüfung nicht, er kommt früher: Ein fremdes APK wird
gar nicht erst angeboten.
```
