# Veröffentlichung im Google Play Store

Diese Datei beschreibt, was einmalig einzurichten ist und was danach
automatisch läuft. Sie ist bewusst offen darüber, **was die Action nicht kann**
— das meiste an einer Play-Veröffentlichung ist Verwaltungsarbeit in der Play
Console, die keine Programmierschnittstelle abnimmt.

---

## Kurzfassung

| | |
| --- | --- |
| Was hochgeht | Android App Bundle (`.aab`), nicht APK |
| Paketname | `ch.brickinventoryapp` — **nach der ersten Veröffentlichung unveränderlich** |
| Auslöser | nur von Hand: Actions → *Android-App zu Play veroeffentlichen* → **Run workflow** |
| Vorgabe | Spur `internal`, Status `draft` — es wird nichts ohne weiteres Zutun ausgeliefert |
| Versionsnummer | erzeugt sich selbst aus der Uhrzeit, steigt monoton — nichts von Hand zu pflegen |

---

## Teil 1 — was du einmalig tun musst (nicht automatisierbar)

### 1.1 Entwicklerkonto

Ein Google-Play-Entwicklerkonto kostet **einmalig 25 USD**. Bei einem
*persönlichen* Konto (kein Firmenkonto) verlangt Google seit 2023 zusätzlich:
Vor der ersten Produktionsveröffentlichung müssen **mindestens 12 Testende
14 Tage lang** in einem geschlossenen Test gewesen sein. Das ist keine
Formalität, die sich überspringen lässt — plane die Zeit ein.

### 1.2 Die App in der Play Console anlegen — und die erste Fassung von Hand hochladen

**Das ist der Punkt, an dem die meisten hängenbleiben.** Die
Veröffentlichungs-Schnittstelle kann eine App **nicht anlegen**. Solange der
Paketname `ch.brickinventoryapp` in deinem Konto nicht existiert, antwortet
jeder Automatiklauf mit `Package not found`.

Also:

1. Play Console → **App erstellen**, Name *BrickInventory Manager*, Sprache,
   App/Spiel, kostenlos/kostenpflichtig.
2. Ein Bundle **von Hand** hochladen. Woher nehmen: Der normale
   Android-Workflow legt bei jedem Lauf `BrickInventory-bundle` als Artefakt ab
   (Actions → Lauf öffnen → unten *Artifacts*). Darin liegt `app-release.aab`.
3. Damit einen Release im internen Test anlegen und speichern.

Ab diesem Moment — und erst ab dann — funktioniert der Automatiklauf.

### 1.3 Play App Signing und der Hochladeschlüssel

Google unterscheidet zwei Schlüssel:

* **App-Signaturschlüssel** — damit signiert Google das, was auf den Geräten
  landet. Google verwahrt ihn. Ein verlorener Schlüssel ist damit kein
  Weltuntergang mehr.
* **Hochladeschlüssel** — damit signierst *du*, und daran erkennt Play, dass
  ein Upload wirklich von dir kommt.

Der Schlüsselspeicher, den du in Android Studio erzeugt hast und der schon als
`KEYSTORE_BASE64` hinterlegt ist, wird beim ersten Upload zum
**Hochladeschlüssel**. Es ist nichts weiter zu tun — aber:

> **Diese Datei gehört nie ins Repository.** Sie liegt als Secret bei GitHub
> und sonst nirgends. Wenn du sie verlierst, lässt sich der Hochladeschlüssel
> über den Support zurücksetzen; ein *ins Repository geratener* Schlüssel
> dagegen ist dauerhaft kompromittiert und steht in der Historie.

### 1.4 Dienstkonto für die Schnittstelle

1. **Google Cloud Console** → Projekt wählen oder anlegen →
   *Google Play Android Developer API* aktivieren.
2. *IAM & Verwaltung* → **Dienstkonten** → Dienstkonto erstellen.
3. Beim Dienstkonto → *Schlüssel* → **Neuen Schlüssel erstellen** → **JSON**.
   Die Datei wird genau einmal heruntergeladen.
4. **Play Console** → *Nutzer und Berechtigungen* → **Nutzer einladen** →
   die E-Mail-Adresse des Dienstkontos eintragen.
   Rechte: App-Zugriff auf *BrickInventory Manager*, darin
   **Releases in Testspuren verwalten** und **Produktionsreleases verwalten**.
5. Den **gesamten Inhalt** der JSON-Datei als Secret
   `PLAY_SERVICE_ACCOUNT_JSON` hinterlegen.

> Die Berechtigung in der Play Console braucht nach dem Einladen manchmal bis
> zu 24 Stunden, bis sie in der Schnittstelle greift. Ein `The caller does not
> have permission` direkt nach dem Einrichten ist meist nur das.

### 1.5 Die fünf Secrets

Unter *Settings → Secrets and variables → Actions → New repository secret*:

| Secret | Inhalt | schon gesetzt? |
| --- | --- | --- |
| `KEYSTORE_BASE64` | Schlüsselspeicher, base64-kodiert | ja (für den APK-Bau) |
| `KEYSTORE_PASSWORT` | Passwort des Schlüsselspeichers | ja |
| `KEY_ALIAS` | Alias des Schlüssels | ja |
| `KEY_PASSWORT` | Passwort des Schlüssels | ja |
| `PLAY_SERVICE_ACCOUNT_JSON` | vollständiger JSON-Inhalt aus 1.4 | **neu** |

Der Workflow prüft alle fünf im ersten Schritt und bricht mit Klartext ab,
wenn eines fehlt — statt nach fünf Minuten Übersetzungszeit mit einer Meldung,
die nicht sagt, welches.

### 1.6 Pflichtangaben in der Play Console

Ohne diese lässt sich nichts veröffentlichen, und keine davon lässt sich
automatisieren:

- **Datenschutzerklärung** als öffentlich erreichbare URL. Die App verlangt
  Kamera-Zugriff — ohne Erklärung geht gar nichts.
- **Datensicherheits-Formular**. Relevant für diese App: Kamera (Barcode- und
  Texterkennung), Konto-/Anmeldedaten gegenüber deinem eigenen Server.
  Die App spricht ausschliesslich mit der von dir betriebenen Web-App.
- **Inhaltsbewertung** (Fragebogen).
- **Zielgruppe**.
- **Store-Eintrag**: Kurz- und Vollbeschreibung, App-Symbol (512×512),
  Grafikbanner (1024×500), mindestens 2 Screenshots je Formfaktor.

> Zu den Screenshots: Im Repository liegen unter `docs/screenshots/` bisher nur
> Aufnahmen der **Web-App**. Für den Store braucht es Aufnahmen der **App auf
> einem Gerät** — die lassen sich nur dort erzeugen.

---

## Teil 2 — was danach automatisch läuft

Actions → **Android-App zu Play veroeffentlichen** → *Run workflow*. Drei
Angaben:

| Eingabe | Bedeutung |
| --- | --- |
| **Spur** | `internal` (nur eingetragene Testende, sofort da) · `alpha` (geschlossen) · `beta` (offen) · `production` (alle) |
| **Status** | `draft` — landet als Entwurf, wird **nicht** ausgeliefert, bis du in der Console freigibst · `completed` — geht sofort raus |
| **Hinweise** | Text für „Was ist neu". Leer lassen ⇒ neutraler Text mit Commit-Kürzel |

Der Lauf tut dann:

1. prüft die fünf Secrets,
2. lässt die Unit-Tests laufen — ein Build, der in den Store geht, soll nicht
   weniger geprüft sein als einer, der es nicht tut,
3. baut `bundleRelease` mit deinem Schlüssel,
4. prüft nach, dass das Bundle **wirklich signiert** ist (ein unsigniertes
   weist Play mit einer Meldung zurück, die nach einem Fehler bei Google
   aussieht),
5. lädt Bundle **und** `mapping.txt` hoch — ohne die Zuordnungsdatei sind die
   Absturzberichte in der Console unlesbar verschleiert,
6. legt Bundle und Zuordnungsdatei zusätzlich als Artefakt ab.

### Versionsnummern

Nichts zu tun. `app/build.gradle.kts` erzeugt bei jedem Bau:

```
versionName = 2026.08.29.1612          (Zeitstempel)
versionCode = 100000000 + Minuten seit 2020-01-01
```

Der `versionCode` steigt damit von allein und ist nie kleiner als ein früherer
— genau das verlangt Play. Der Sockel von 100 Mio. liegt über den alten
`YYYYMMDD`-Nummern; ohne ihn hielte Play das Update für einen Rückschritt.

Wer eine bestimmte Nummer braucht, überschreibt sie beim Aufruf:

```bash
./gradlew bundleRelease -PbuildVersionCode=123456789 -PbuildVersionName=1.2.3
```

---

## Wenn etwas schiefgeht

| Meldung | Ursache |
| --- | --- |
| `Package not found` | Schritt 1.2 fehlt — die erste Fassung muss von Hand in die Console. |
| `The caller does not have permission` | Dienstkonto nicht (oder noch nicht wirksam) in der Play Console berechtigt, siehe 1.4. |
| `Precondition check failed` bei `production` | Vor der Produktionsspur muss mindestens ein Release durch `internal`, `alpha` oder `beta` gelaufen sein. |
| `Changes cannot be sent for review automatically` | Es liegen Angaben in der Console, die noch nicht zur Prüfung eingereicht sind. Entweder dort abschliessen — oder im Workflow bei der Upload-Action `changesNotSentForReview: true` ergänzen und danach in der Console von Hand einreichen. |
| `Version code N has already been used` | Sollte durch die Zeitstempel-Nummer nicht vorkommen. Falls doch: einmal mit `-PbuildVersionCode=` eine höhere Nummer setzen. |
| Bundle ist unsigniert | Eines der vier Keystore-Secrets stimmt nicht. Der Workflow bricht dafür mit eigener Meldung ab, bevor Play es tut. |

## Was dieser Aufbau bewusst *nicht* tut

- **Kein `on: push`.** Eine Veröffentlichung ist nach aussen gerichtet und
  kaum zurückzunehmen; sie darf kein Nebeneffekt eines Commits sein.
- **Kein automatisches Hochstufen** von `internal` nach `production`.
- **Vorgabe `draft`, nicht `completed`.** Der erste Lauf soll nichts
  ausliefern, sondern etwas zum Ansehen in der Console hinterlegen.
