# APK automatisch nach Google Drive

Nach jedem grünen Build auf `main` landet `BrickInventory.apk` in deinem
Google Drive — **unter demselben Link wie beim letzten Mal**. Einmal freigeben
genügt; wer den Link hat, bekommt immer die neueste Fassung.

## Wozu, wenn es doch Artefakte gibt

Ein GitHub-Artefakt kann nur herunterladen, wer bei GitHub **angemeldet** ist,
und es verfällt nach 90 Tagen. Wer die App jemandem zum Ausprobieren geben
will, kann damit nichts anfangen. Ein Drive-Link geht an jeden.

---

## Die Falle vorweg

Fast jede Anleitung im Netz schlägt ein **Dienstkonto** vor. Bei einem privaten
Google-Konto funktioniert das **nicht**:

> Ein Dienstkonto hat in Drive kein Speicherkontingent und kann keine Dateien
> besitzen. Der Upload endet in `storageQuotaExceeded`.

Googles offizieller Ausweg sind *Geteilte Ablagen* — die es nur mit Google
Workspace gibt. Für ein `@gmail.com`-Konto scheidet der Weg damit aus.

Deshalb hier ein **OAuth-Refresh-Token deines eigenen Kontos**. Die Datei
gehört dann dir und zählt gegen deine 15 GB.

Der Workflow erkennt diesen Fall und sagt es im Klartext, falls doch ein
Dienstkonto-Token hinterlegt wird.

---

## Einrichtung

### 1 · OAuth-Zugangsdaten anlegen

1. [Google Cloud Console](https://console.cloud.google.com/) → Projekt wählen
   oder anlegen.
2. *APIs & Dienste* → **Google Drive API** aktivieren.
3. *OAuth-Zustimmungsbildschirm* → **Extern** → Name, deine Mail-Adresse.
4. Bei den Bereichen (*Scopes*) **nur** diesen hinzufügen:

   ```
   https://www.googleapis.com/auth/drive.file
   ```

   Das ist wichtig, und zwar in beide Richtungen:

   * Das Token sieht damit **ausschliesslich Dateien, die es selbst angelegt
     hat** — nicht dein übriges Drive. Unterschied zwischen „darf ein APK
     ablegen" und „darf alles lesen".
   * `drive.file` gilt bei Google als nicht-sensibel. Deshalb lässt sich die
     App ohne Prüfverfahren veröffentlichen — siehe Schritt 5.

5. **Status auf „Produktion" setzen** (*In Produktion veröffentlichen*).

   > Ohne das steht die App auf *Testing*, und dann **verfällt das
   > Refresh-Token nach 7 Tagen**. Der Build läuft eine Woche und bricht dann
   > ab. Das ist die zweithäufigste Ursache für Ärger nach der Dienstkonto-Falle.

6. *Anmeldedaten* → **OAuth-Client-ID erstellen** → Typ **Desktop-App**.
   Du bekommst `client_id` und `client_secret`.

### 2 · Refresh-Token holen

Einmalig auf deinem Rechner. Ersetze die beiden Werte:

```bash
CLIENT_ID='...apps.googleusercontent.com'
CLIENT_SECRET='...'

# a) Diese URL im Browser öffnen und bestätigen:
echo "https://accounts.google.com/o/oauth2/v2/auth?client_id=$CLIENT_ID\
&redirect_uri=urn:ietf:wg:oauth:2.0:oob\
&response_type=code\
&scope=https://www.googleapis.com/auth/drive.file\
&access_type=offline&prompt=consent"

# b) Den angezeigten Code hier einsetzen:
CODE='4/0A...'

# c) Gegen das Refresh-Token tauschen:
curl -s -X POST https://oauth2.googleapis.com/token \
  -d client_id="$CLIENT_ID" -d client_secret="$CLIENT_SECRET" \
  -d code="$CODE" -d grant_type=authorization_code \
  -d redirect_uri='urn:ietf:wg:oauth:2.0:oob'
```

Aus der Antwort brauchst du `refresh_token`.

> `access_type=offline` **und** `prompt=consent` sind beide nötig. Ohne
> `prompt=consent` liefert Google bei einer wiederholten Zustimmung *kein*
> `refresh_token` mehr, sondern nur ein kurzlebiges `access_token` — und dann
> fehlt genau der Wert, um den es hier geht.

### 3 · Zielordner (empfohlen, nicht zwingend)

Einen Ordner in Drive anlegen, hineinwechseln, die ID aus der Adresszeile
nehmen:

```
https://drive.google.com/drive/folders/1A2B3C...
                                       ^^^^^^^^ das ist die ID
```

Ohne Ordner-ID landet das APK in der obersten Ebene deines Drive.

### 4 · Die vier Secrets

*Settings → Secrets and variables → Actions*:

| Secret | Inhalt |
| --- | --- |
| `GDRIVE_CLIENT_ID` | aus Schritt 1.6 |
| `GDRIVE_CLIENT_SECRET` | aus Schritt 1.6 |
| `GDRIVE_REFRESH_TOKEN` | aus Schritt 2 |
| `GDRIVE_ORDNER_ID` | aus Schritt 3 (weglassen ⇒ oberste Ebene) |

Fehlt `GDRIVE_REFRESH_TOKEN`, wird der Schritt **übersprungen** — der Build
läuft normal durch. Es geht nichts kaputt, solange nichts eingerichtet ist.

### 5 · Freigeben

Nach dem ersten Lauf die Datei in Drive einmal freigeben
(*Freigeben → Jeder mit dem Link*). Der Link steht in der Zusammenfassung des
Workflow-Laufs.

Ab dann bleibt er gleich: Der Workflow sucht die Datei am Namen, findet sie und
**ersetzt den Inhalt**, statt eine neue anzulegen. Datei-ID und Freigabe bleiben
bestehen.

---

## Warum `curl` statt einer fertigen Action

Das Refresh-Token gibt Schreibzugriff auf Drive. Eine Action aus dritter Hand
bekäme es bei jedem Lauf in die Hand — auch in jeder künftigen Fassung, die
niemand mehr liest. Zwanzig Zeilen `curl` sind nachlesbar; ein npm-Bündel ist
es nicht.

## Wenn etwas schiefgeht

| Meldung | Ursache |
| --- | --- |
| `Zugriffstoken nicht erhalten` / `invalid_grant` | Zustimmungsbildschirm steht auf *Testing* — Token nach 7 Tagen verfallen. Auf *Produktion* setzen, Token neu holen. |
| `storageQuotaExceeded` | Es ist ein Dienstkonto-Token. Braucht ein Token eines echten Kontos, siehe oben. |
| `Drive meldet N Bytes, lokal sind es M` | Upload abgebrochen. Der Workflow bricht dann ab, statt einen Link auf ein halbes APK zu hinterlassen. |
| `File not found` bei der Ordner-ID | Ordner gelöscht, oder die ID stammt aus einem anderen Konto. |

## Sicherheit

- Das Token steht **nur** in den GitHub-Secrets, nie im Repository.
- Der Scope `drive.file` beschränkt es auf selbst angelegte Dateien.
- Das kurzlebige Zugriffstoken wird im Protokoll maskiert (`::add-mask::`).
- Zurückziehen jederzeit unter
  [Google-Konto → Sicherheit → Drittanbieter-Zugriff](https://myaccount.google.com/permissions).

---

## Verhältnis zum Play Store

Die beiden schliessen sich nicht aus:

| | Google Drive | Play Store |
| --- | --- | --- |
| Aufwand | vier Secrets | Entwicklerkonto 25 USD, Pflichtangaben, bei privatem Konto 12 Testende × 14 Tage |
| Format | APK, direkt installierbar | AAB |
| Installation | „Unbekannte Quellen" muss erlaubt werden | normal |
| Aktualisierung | von Hand | automatisch |
| Reichweite | wer den Link hat | jeder |

Für den kleinen Kreis ist Drive der kürzere Weg. Der Play-Workflow
(`android-playstore.yml`, siehe `PLAYSTORE.md`) bleibt daneben bestehen und
läuft nur auf Knopfdruck.
