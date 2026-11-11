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

## 1. Environment `release` auf `main` beschränken

*Settings → Environments → release*

1. *Deployment branches and tags*: **Selected branches and tags**.
2. Die bisherige Regel für das Etikett `android-v*` **entfernen**.
3. *Add deployment branch or tag rule* → *Ref type: Branch* → `main`.
   Danach steht dort genau eine Regel: Zweig `main`.
4. *Required reviewers*: mindestens eine Person (wie bisher).
5. *Prevent self-review*: **an**, sobald zwei Personen prüfen (bis dahin nur eine
   Warnung im Lauf).
6. *Allow administrators to bypass configured protection rules*: **aus**.
7. Unter *Environment secrets* bleiben `KEYSTORE_BASE64`, `KEYSTORE_PASSWORT`,
   `KEY_ALIAS`, `KEY_PASSWORT`. Das Secret `BESCHREIBUNG_SCHLUESSEL` hier
   **löschen**, sobald Schritt 2 erledigt ist.

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
   **aus**; *Prevent self-review* wie oben.
5. *Environment secrets*:
   - `BESCHREIBUNG_SCHLUESSEL`: der Inhalt von `beschreibung-verschluesselt.pem`
   - `BESCHREIBUNG_PASS`: die Passphrase aus Schritt 1
6. `beschreibung.pem` (unverschlüsselt) danach sicher löschen; die verschlüsselte
   Fassung und die Passphrase getrennt aufbewahren.

Der öffentliche Schlüssel in `core-ressourcen/src/main/res/raw/beschreibungs_schluessel.pem`
bleibt, wie er ist.

## 3. Tag-Ruleset für `android-v*` und `apk-neuste`

*Settings → Rules → Rulesets → New ruleset → New tag ruleset*

1. Name: `Android-Etiketten`, *Enforcement status*: **Active**.
2. *Target tags → Add target → Include by pattern*: `android-v*` und `apk-neuste`.
3. *Bypass list*: nur die Rolle **Repository admin** (wer Fassungen veröffentlicht).
4. Regeln: **Restrict creations**, **Restrict updates**, **Restrict deletions**.

Damit setzt nur ein Administrator ein Etikett, und keines lässt sich auf einen
anderen Commit umhängen oder löschen. Der Workflow signiert ohnehin nur Commits,
die auf `main` liegen.

## 4. Was bleibt wie bisher

- Ruleset für `main`: *Require a pull request*, *Require status checks*
  (Android-App, Sicherheit), *Block force pushes*.
- *Settings → General → Releases → Immutable releases*: an.
- Repository-Secrets mit den Namen der Environment-Secrets: keine (löschen, falls
  noch vorhanden).

## Ablauf eines Release

```
git tag android-v2026.11.12 origin/main
git push origin android-v2026.11.12
```

1. `Android-App` baut das Etikett (ohne Secrets) und probesigniert.
2. `Android-Release` startet aus `main`, prüft Etikett, Commit auf `main`, Regeln
   von `main`, die Lückenprüfung und die Prüfsummen der Übergabe.
3. Freigabe in `release` (APK signieren), dann in `release-beschreibung`
   (Beschreibung signieren), dann prüfen, bescheinigen, und nach einer letzten
   Freigabe in `release` veröffentlichen.

Startet `Android-Release` nicht von selbst (etwa weil der Baulauf neu gestartet
wurde), ihn von Hand mit dem Etikett anstossen.
