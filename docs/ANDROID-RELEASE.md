# Android-Release: Einstellungen in GitHub

Signiert und veröffentlicht wird die App nur noch von
`.github/workflows/android-release.yml`, und zwar in der Fassung, die auf `main`
liegt. Der Lauf startet von selbst, sobald der Baulauf (`Android-App`) zu einem
Etikett `android-v…` grün ist, oder von Hand unter *Actions → Android-Release →
Run workflow* (Zweig `main`, Eingabe: das Etikett). Das Etikett liefert nur noch
Daten: das unsignierte APK aus seinem Baulauf, geprüft gegen die Prüfsummen, die
der Baulauf gemessen hat. Ein Etikett mit verändertem Workflow kommt an keinen
Schlüssel heran.

Diese Einstellungen kann nur ein Administrator des Repositorys setzen. Der
Workflow prüft sie über die API und signiert nicht, wenn eine fehlt.

**Kurz: Was nur der Inhaber tun kann**

| Schritt | Was | Wo |
| --- | --- | --- |
| 1, 2 | *Prevent self-review* in `release` und `release-beschreibung` einschalten, sobald es eine zweite Person als Pflichtprüfer gibt (bis dahin nur eine Warnung) | Settings → Environments |
| 3, 4 | Bypass-Listen leeren (main: niemand; Etiketten: nur *Repository admin*) | Settings → Rules → Rulesets |
| 6 | Lesetoken `REGELN_LESETOKEN` für die Bypass-Prüfung anlegen | Developer settings, Environment `release` |
| 7 | Offline signieren einrichten (`ANDROID_SIGNIERWEG=offline`), danach die Signier-Secrets löschen | Settings → Variables, Environment `release` |
| 8 | Eigenen Upload-Schlüssel für das App-Bundle erzeugen und bei Google Play registrieren | lokal, Play Console |

## 1. Environment `release` auf `main` beschränken

*Settings → Environments → release*

1. *Deployment branches and tags*: **Selected branches and tags**.
2. Die bisherige Regel für das Etikett `android-v*` **entfernen**.
3. *Add deployment branch or tag rule* → *Ref type: Branch* → `main`.
   Danach steht dort genau eine Regel: Zweig `main`.
4. *Required reviewers*: mindestens eine Person (wie bisher).
5. *Prevent self-review*: empfohlen **an**, sobald eine zweite Person unter *Required
   reviewers* steht (Vier-Augen-Prinzip). Solange der Inhaber allein veröffentlicht, ist es
   aus; der Signierlauf warnt dann („Selbstfreigabe“), signiert aber nach der Freigabe.
6. *Allow administrators to bypass configured protection rules*: **aus**.
7. Unter *Environment secrets* liegen bis zur Umstellung auf das Offline-Signieren
   (Schritt 7) `KEYSTORE_BASE64`, `KEYSTORE_PASSWORT`, `KEY_ALIAS`, `KEY_PASSWORT`.
   Das Secret `BESCHREIBUNG_SCHLUESSEL` hier **löschen**, sobald Schritt 2 erledigt ist.

## 2. Neue Environment `release-beschreibung` mit eigener Passphrase

Der Schlüssel der Fassungsbeschreibung liegt getrennt vom APK-Schlüssel, in einem
eigenen Job und verschlüsselt mit einer eigenen Passphrase.

1. Den bisherigen privaten Schlüssel (`beschreibung.pem`, ausserhalb des
   Repositorys) mit einer neuen, langen Passphrase verschlüsseln:

   ```
   openssl pkey -in beschreibung.pem -aes256 -out beschreibung-verschluesselt.pem
   ```

   Die Datei muss mit `-----BEGIN ENCRYPTED PRIVATE KEY-----` beginnen.
2. *Settings → Environments → New environment* → Name `release-beschreibung`.
3. *Deployment branches and tags*: **Selected branches and tags**, eine Regel:
   Zweig `main`.
4. *Required reviewers*: mindestens eine Person; *Allow administrators to bypass*
   **aus**; *Prevent self-review* wie oben (empfohlen an, sonst Warnung).
5. *Environment secrets*:
   - `BESCHREIBUNG_SCHLUESSEL`: der Inhalt von `beschreibung-verschluesselt.pem`
   - `BESCHREIBUNG_PASS`: die Passphrase aus Schritt 1
6. `beschreibung.pem` (unverschlüsselt) danach sicher löschen; die verschlüsselte
   Fassung und die Passphrase getrennt aufbewahren.

Der öffentliche Schlüssel in `core-resources/src/main/res/raw/beschreibungs_schluessel.pem`
bleibt, wie er ist.

Seit 12.11.2026 trägt die Beschreibung nur noch diese Signatur; der APK-Schlüssel
signiert keine Beschreibung mehr. Fehlt eines der beiden Secrets, bricht *Beschreibung
signieren* ab, statt ein Release ohne gültige Beschreibung zu veröffentlichen. Die
Beschreibung gilt **7 Tage**: Spätestens wöchentlich ein Etikett setzen (notfalls auf
denselben Commit), sonst meldet die App „veraltet oder manipuliert“.

## 3. Tag-Ruleset für `android-v*` und `apk-neuste`

*Settings → Rules → Rulesets → New ruleset → New tag ruleset*

1. Name: `Android-Etiketten`, *Enforcement status*: **Active**.
2. *Target tags → Add target → Include by pattern*: `android-v*`, `signiert-*` und `apk-neuste`.
3. *Bypass list*: nur die Rolle **Repository admin** (wer Fassungen veröffentlicht), kein
   anderer Akteur. Ohne sie könnte niemand ein Etikett anlegen; jeder weitere Eintrag
   (eine App, ein Team) lässt den Lauf abbrechen (Schritt *Rulesets ohne Umgehung*).
4. Regeln: **Restrict creations**, **Restrict updates**, **Restrict deletions**.

Damit setzt nur ein Administrator ein Etikett, und keines lässt sich auf einen
anderen Commit umhängen oder löschen. Der Workflow signiert ohnehin nur Commits,
die auf `main` liegen. Er liest das Ruleset vor dem Signieren über die API (Schritt
*Etiketten sind geschützt*): Trifft kein aktives Tag-Ruleset mit *Restrict creations*,
*Restrict updates* und *Restrict deletions* das Etikett, signiert er nicht. Ein
Ruleset im Modus *Evaluate* zählt nicht.

`apk-neuste` bleibt im Ruleset, obwohl der Workflow es nicht mehr beschreibt: Die
Release ist eingefroren (Stand 2.11.2026; *Immutable releases* lässt keinen Anhang
mehr ersetzen), und ältere installierte Fassungen fragen dort noch nach. Ab dem
ersten Etikett nach `android-v2026.11.12.1` gilt der feste Link
<https://github.com/addict85/BrickInventory/releases/latest/download/BrickInventory.apk>:
Jede Release kommt in einem Schritt mit allen Anhängen und wird „Latest“. Eine vor
der Umstellung installierte App braucht das Update einmal von Hand.

## 4. Was bleibt wie bisher

- Ruleset für `main`: *Require a pull request*, *Require status checks*
  (Android-App, Sicherheit), *Block force pushes*. Die *Bypass list* ist **leer**, auch
  ohne Administratoren: Sonst ginge ein Push an Review und CI vorbei. Der Lauf bricht ab,
  sobald ein Ruleset für `main` einen Bypass-Akteur hat.
- *Settings → General → Releases → Immutable releases*: an.
- Repository-Secrets mit den Namen der Environment-Secrets: keine (löschen, falls
  noch vorhanden).

## 5. Knopf „Android-Etikett setzen“ (Environment `etikett`)

Ohne eigenes Repository setzt der Workflow `android-etikett.yml` das Etikett.
Er braucht ein persönliches Token: Etiketten, die das eingebaute `GITHUB_TOKEN`
setzt, starten keinen Bau, und das Ruleset aus Schritt 3 lässt nur Admins
`android-v…` anlegen.

Das Token kann Etiketten setzen und damit einen Release anstossen; es braucht keinen
Prüfer. Darum so kurzlebig wie möglich: *Expiration* 7 bis 30 Tage statt 90, und
nach einem Verdacht sofort widerrufen. Signiert wird trotzdem erst nach den Freigaben
in `release` und `release-beschreibung`. Wer kein ablaufendes Token pflegen will,
legt stattdessen eine eigene GitHub App an (*Developer settings → GitHub Apps*,
Recht *Contents: Read and write*, nur dieses Repository) und holt im Workflow mit
`actions/create-github-app-token` ein Token, das nach einer Stunde verfällt; in der
Environment `etikett` liegen dann App-ID und privater Schlüssel statt `ETIKETT_TOKEN`,
und die App steht im Tag-Ruleset (Schritt 3) in der *Bypass list*.
Der Workflow ist heute auf das Token eingerichtet.

1. *Profilbild → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token*.
   - Name `BrickInventory Etikett`, *Expiration* höchstens 30 Tage.
   - *Repository access*: **Only select repositories** → `addict85/BrickInventory`.
   - *Permissions → Repository permissions → Contents*: **Read and write**
     (sonst nichts).
   - *Generate token* und den Wert kopieren.
2. *Settings → Environments → New environment* → Name `etikett`.
   - *Deployment branches and tags*: **Selected**, eine Regel: Branch `main`.
   - *Required reviewers*: **keine**. Der Knopf setzt nur das Etikett; die
     Freigaben mit den Signierschlüsseln (`release`, `release-beschreibung`)
     bleiben bei dir.
   - *Environment secrets → Add secret*: Name `ETIKETT_TOKEN`, Wert das Token.
3. Läuft das Token ab, ein neues anlegen und das Secret ersetzen.

## 6. Lesetoken für die Bypass-Prüfung (`REGELN_LESETOKEN`)

Die Bypass-Liste eines Rulesets zeigt die API nur, wer Rulesets bearbeiten darf; das
eingebaute `GITHUB_TOKEN` sieht sie nicht. Der Lauf bricht dann ab („Umgehung nicht lesbar“),
statt eine unsichtbare Liste für leer zu halten.

1. *Developer settings → Fine-grained tokens → Generate new token*: Name
   `BrickInventory Regeln lesen`, nur dieses Repository, *Repository permissions →
   Administration*: **Read-only** (sonst nichts), *Expiration* höchstens 90 Tage.
2. In der Environment `release` als Secret `REGELN_LESETOKEN` ablegen.
3. Läuft es ab, bricht der nächste Release-Lauf mit „Umgehung nicht lesbar“ ab: neues Token
   anlegen und das Secret ersetzen.

## 7. Offline signieren (`ANDROID_SIGNIERWEG=offline`)

Der Release-Schlüssel gehört nicht als Secret zu GitHub: Wer die Environment `release` oder
einen Runner kompromittiert, signierte sonst Updates für jede installierte App. Offline
signiert der Inhaber auf dem eigenen Rechner (am besten mit dem Schlüssel auf einem
Hardware-Token), und der Lauf **prüft** nur: dass APK und Bundle genau die gebauten Dateien
sind (gleiche Einträge, gleiche Bytes), dass das APK das Zertifikat aus
`Android-App/tools/release-certificate.sha256` trägt und das Bundle den Upload-Schlüssel.

Einrichten: *Settings → Secrets and variables → Actions → Variables → New repository
variable* `ANDROID_SIGNIERWEG` = `offline`. Danach in der Environment `release` die Secrets
`KEYSTORE_BASE64`, `KEYSTORE_PASSWORT`, `KEY_ALIAS`, `KEY_PASSWORT` (und gegebenenfalls
`UPLOAD_*`) **löschen**. Ohne die Variable gilt im Übergang weiter `secret` (mit Warnung).

Je Release, nachdem *Android-Release* mit „Offline-Signatur fehlt“ abbricht (die
Zusammenfassung des Laufs nennt Baulauf und Prüfsummen):

```
gh run download <BAULAUF> -n apk-unsigniert -D unsigniert
sha256sum unsigniert/apk/release/app-release-unsigned.apk unsigniert/bundle/release/app-release.aab
# beide Werte mit der Zusammenfassung vergleichen; weichen sie ab: aufhören

# build-tools 37.0.0
zipalign -f -P 16 4 unsigniert/apk/release/app-release-unsigned.apk ausgerichtet.apk
apksigner sign --ks release.jks --ks-key-alias <alias> \
  --v1-signing-enabled false --v2-signing-enabled true --v3-signing-enabled true \
  --out BrickInventory.apk ausgerichtet.apk
apksigner verify --print-certs BrickInventory.apk   # SHA-256 wie in tools/release-certificate.sha256

cp unsigniert/bundle/release/app-release.aab app-release.aab
jarsigner -keystore upload.jks app-release.aab <upload-alias>

gh release create signiert-android-v2026.11.22 BrickInventory.apk app-release.aab \
  --target main --prerelease --latest=false --title "Signiert: android-v2026.11.22" \
  --notes "Offline signiert; nur Eingang für Android-Release, nicht installieren."
```

Dann *Actions → Android-Release → Run workflow* (Zweig `main`, das Etikett) und wie gewohnt
freigeben. Die Vorab-Release ist unveränderlich; ein zweiter Versuch heisst
`signiert-<Etikett>-2` (die neueste zählt). Ein Signierdienst in der Cloud (etwa Google Cloud
KMS über OIDC) ist nicht eingerichtet: Er erzeugt ein eigenes Zertifikat, und ein APK mit
anderem Zertifikat nehmen die installierten Apps nicht als Update an. Das ginge nur mit einer
Schlüsselrotation (APK Signature Scheme v3, `apksigner rotate`), die der Inhaber einmal offline
ausführen müsste.

Der Beschreibungsschlüssel (Schritt 2, eigene Environment) und die Herkunftsbescheinigung
(`android-bescheinigung.yml`, schlüssellos über Sigstore) bleiben davon getrennt.

## 8. Upload-Schlüssel für das App-Bundle (`ANDROID_AAB_SCHLUESSEL=upload`)

Google Play signiert die App mit dem eigenen App-Signaturschlüssel neu und kennt vom
Entwickler nur den **Upload-Schlüssel**. Ein eigener Upload-Schlüssel heisst: Geht er verloren
oder wird er gestohlen, setzt Google ihn zurück, und der App-Schlüssel bleibt unberührt.

1. Lokal erzeugen: `keytool -genkeypair -keystore upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000`.
2. In der Play Console unter *App-Integrität → App-Signatur* als Upload-Schlüssel registrieren
   (`keytool -export -rfc -keystore upload.jks -alias upload -file upload.pem`).
3. Variable `ANDROID_AAB_SCHLUESSEL` = `upload`; Variable `ANDROID_UPLOAD_ZERT_SHA256` = der
   SHA-256-Fingerabdruck des Zertifikats (`keytool -list -v -keystore upload.jks`). Der Lauf
   prüft das Bundle dagegen und bricht ab, wenn es den App-Schlüssel trägt.
4. Offline signiert der Inhaber das Bundle selbst damit (Schritt 7). Nur im Übergang
   (`secret`) liegen `UPLOAD_KEYSTORE_BASE64`, `UPLOAD_KEYSTORE_PASSWORT`, `UPLOAD_KEY_ALIAS`,
   `UPLOAD_KEY_PASSWORT` in der Environment `release`.

## 9. Google Play: automatisch einliefern (`PLAY_SERVICE_ACCOUNT_JSON`)

Der Job `play` in `android-release.yml` liefert nach dem GitHub-Release dasselbe signierte
Bundle (Prüfsumme des Signierjobs) über die Android Publisher API ein. Er hat keinen
Checkout und keine Drittaktion; ohne das Secret bleibt es bei einem Hinweis.

1. Google Cloud: Projekt anlegen, *Google Play Android Developer API* aktivieren,
   Dienstkonto ohne Rollen anlegen, JSON-Schlüssel herunterladen.
2. Play Console → *Nutzer und Berechtigungen*: die Adresse des Dienstkontos einladen,
   für diese App „Apps für Test-Tracks veröffentlichen“ (später auch Produktion).
3. Secret `PLAY_SERVICE_ACCOUNT_JSON` = der ganze JSON-Inhalt, in der Environment `release`.
4. Variablen (optional): `PLAY_TRACK` (Vorgabe `internal`), `PLAY_STATUS` (Vorgabe `draft`;
   neue Apps nehmen nur Entwürfe an — nach der ersten Freigabe `completed`).
5. Die **erste** Fassung einer neuen App lädt der Inhaber von Hand in der Play Console hoch
   (Anhang `app-release.aab` des Artefakts `BrickInventory-bundle`); erst danach nimmt die
   API Bundles an. Paketname: `ch.brickinventoryapp`.
6. App-Signatur: *Vorhandenen App-Signaturschlüssel verwenden* und den bisherigen
   Release-Schlüssel per PEPK hochladen — sonst tragen GitHub-APK und Play-Fassung
   verschiedene Signaturen und lassen sich nicht gegenseitig aktualisieren.

## Ablauf eines Release

Im Browser: *Actions → Android-Etikett setzen → Run workflow* (Zweig `main`),
Name eintragen, z. B. `android-v2026.11.12.1`. Danach die Läufe in `release`
und `release-beschreibung` freigeben. Nur das Etikett setzen, **keine Release von Hand anlegen**: Eine
veröffentlichte Release ist unveränderlich und nimmt das APK nicht mehr an.

Oder mit Git (z. B. im Codespace):

```
git tag android-v2026.11.12 origin/main
git push origin android-v2026.11.12
```

1. `Android-App` baut das Etikett (ohne Secrets) und probesigniert.
2. `Android-Release` startet aus `main`, prüft Etikett, Commit auf `main`, Regeln
   von `main`, das Tag-Ruleset, die Lückenprüfung und die Prüfsummen der Übergabe.
3. Freigabe in `release` (APK signieren), dann in `release-beschreibung`
   (Beschreibung signieren), dann prüfen, bescheinigen, und nach einer letzten
   Freigabe in `release` veröffentlichen.

Startet `Android-Release` nicht von selbst (etwa weil der Baulauf neu gestartet
wurde), ihn von Hand mit dem Etikett anstossen.
