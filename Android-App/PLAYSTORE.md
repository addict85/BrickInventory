# Veröffentlichung im Google Play Store

> **Stand: aktiv.** Die Einlieferung läuft über den Job `play` in
> `.github/workflows/android-release.yml` (nicht über eine eigene,
> gleichnamige Aktion) — ausführlich dokumentiert in
> [`docs/ANDROID-RELEASE.md`](../docs/ANDROID-RELEASE.md), Abschnitte 8
> (Upload-Schlüssel) und 9 (`PLAY_SERVICE_ACCOUNT_JSON`). Diese Datei
> beschreibt nur noch, was zusätzlich in der **Play Console selbst** einmalig
> einzurichten ist — reine Verwaltungsarbeit, die keine Schnittstelle abnimmt.
> Für alles rund um Secrets, Schlüssel und den Workflow-Ablauf gilt
> ausschliesslich `docs/ANDROID-RELEASE.md`; bei Widerspruch hat jene Datei
> Vorrang.

---

## Kurzfassung

| | |
| --- | --- |
| Was hochgeht | Android App Bundle (`.aab`), nicht APK |
| Paketname | `ch.brickinventoryapp` — **nach der ersten Veröffentlichung unveränderlich** |
| Auslöser | automatisch nach einem grünen Baulauf zu einem Etikett `android-v…`, oder von Hand (Actions → *Android-Release* → Run workflow, Eingabe das Etikett) |
| Spur/Status | über die Repository-Variablen `PLAY_TRACK` (Vorgabe `internal`) und `PLAY_STATUS` (Vorgabe `draft`) — nichts wird ohne weiteres Zutun an Nutzer ausgeliefert |
| App-Signatur | von Google verwaltet; du lieferst nur mit deinem eigenen **Upload-Schlüssel** (`docs/ANDROID-RELEASE.md`, Abschnitt 8) |

---

## Was du einmalig in der Play Console tun musst (nicht automatisierbar)

### 1. Entwicklerkonto

Ein Google-Play-Entwicklerkonto kostet **einmalig 25 USD**. Bei einem
*persönlichen* Konto (kein Firmenkonto) verlangt Google seit 2023 zusätzlich:
Vor der ersten Produktionsveröffentlichung müssen **mindestens 12 Testende
14 Tage lang** in einem geschlossenen Test gewesen sein. Das ist keine
Formalität, die sich überspringen lässt — plane die Zeit ein.

### 2. Die App anlegen — und die erste Fassung von Hand hochladen

**Das ist der Punkt, an dem die meisten hängenbleiben.** Die
Android-Publisher-API kann eine App **nicht anlegen**. Solange der Paketname
`ch.brickinventoryapp` in deinem Konto nicht existiert, antwortet jeder
Automatiklauf mit `Package not found`.

Also:

1. Play Console → **App erstellen**, Name *BrickInventory Manager*, Sprache,
   App/Spiel, kostenlos/kostenpflichtig.
2. Beim App-Signatur-Einrichten **„Google-generierten Schlüssel verwenden"**
   wählen (empfohlener Standardweg).
3. Ein mit deinem Upload-Schlüssel signiertes Bundle **von Hand** hochladen
   (Erzeugen des Bundles und Signieren: `docs/ANDROID-RELEASE.md`,
   Abschnitte 7–8).
4. Damit einen Release im internen Test anlegen und speichern.

Ab diesem Moment — und erst ab dann — funktioniert der Automatiklauf
(`play`-Job).

### 3. Dienstkonto für die Schnittstelle

Siehe `docs/ANDROID-RELEASE.md`, Abschnitt 9 — dort steht das vollständig,
inklusive des Secrets `PLAY_SERVICE_ACCOUNT_JSON`.

### 4. Pflichtangaben in der Play Console

Ohne diese lässt sich nichts veröffentlichen, und keine davon lässt sich
automatisieren:

- **Datenschutzerklärung** als öffentlich erreichbare URL. Die App verlangt
  Kamera-Zugriff — ohne Erklärung geht gar nichts.
- **Datensicherheits-Formular**. Relevant für diese App: Kamera (Barcode- und
  Texterkennung), Konto-/Anmeldedaten gegenüber deinem eigenen Server.
  Gegenstellen der App (dieselbe Liste steht in der App unter Einstellungen →
  Datenschutz):
  - die von dir betriebene Web-App — alle Daten des Kontos;
  - **Google Play-Dienste** für den Barcode-Scan (ML Kit, nachgeladen) und Passkeys
    (Credential Manager); die Texterkennung (ML Kit) läuft auf dem Gerät, ihren
    Kanal für Nutzungsstatistiken an Google nimmt die App heraus;
  - fremde Websites (BrickLink, Hersteller-Anleitungen) nur auf Tipp, im Browser.
  Bilder laden nie direkt von einem CDN, sondern über den Proxy deines Servers.
- **Inhaltsbewertung** (Fragebogen).
- **Zielgruppe**.
- **Store-Eintrag**: Kurz- und Vollbeschreibung, App-Symbol (512×512),
  Grafikbanner (1024×500), mindestens 2 Screenshots je Formfaktor.

> Zu den Screenshots: Im Repository liegen unter `docs/screenshots/` nur
> Aufnahmen der **Web-App**. Für den Store braucht es Aufnahmen der **App auf
> einem Gerät** — die lassen sich nur dort erzeugen.

---

## Was der `play`-Job automatisch tut

Nach einem grünen Baulauf zu einem Etikett `android-v…` (oder von Hand
angestossen, siehe oben):

1. prüft `PLAY_SERVICE_ACCOUNT_JSON`; fehlt es, nur ein Hinweis, nichts
   wird eingeliefert;
2. liefert dasselbe Bundle ein, das für das GitHub-Release signiert wurde
   (Prüfsumme des Signierjobs, `docs/ANDROID-RELEASE.md` Abschnitt 7–8),
   über die Android Publisher API — ohne Checkout, ohne Drittaktion;
3. legt es in der Spur `PLAY_TRACK` (Vorgabe `internal`) mit Status
   `PLAY_STATUS` (Vorgabe `draft`) ab.

### Versionsnummern

Nichts zu tun. `app/build.gradle.kts` erzeugt bei jedem Bau:

```
versionCode = 200_000_000 + Anzahl Commits auf dem gebauten Stand
versionName = aus `git describe --tags`
```

Der `versionCode` steigt damit von allein und ist nie kleiner als ein
früherer — genau das verlangt Play. Google warnt bei der **ersten**
Veröffentlichung, der Versionscode sei „deutlich höher als der vorherige"
(es gibt ja noch keinen) — das ist erwartet, keine Fehlkonfiguration.

---

## Wenn etwas schiefgeht

| Meldung | Ursache |
| --- | --- |
| `Package not found` | Schritt 2 fehlt — die erste Fassung muss von Hand in die Console. |
| `The caller does not have permission` | Dienstkonto nicht (oder noch nicht wirksam) in der Play Console berechtigt, siehe `docs/ANDROID-RELEASE.md` Abschnitt 9. |
| „Versionscode deutlich höher als der vorherige" | Erwartet bei der ersten Veröffentlichung (siehe oben), keine Aktion nötig. |
| Bundle trägt den App- statt den Upload-Schlüssel | `ANDROID_UPLOAD_ZERT_SHA256` prüfen (`docs/ANDROID-RELEASE.md` Abschnitt 8) — der Lauf bricht dafür mit eigener Meldung ab, bevor Play es tut. |

## Was dieser Aufbau bewusst *nicht* tut

- **Kein automatisches Anlegen der App** in der Play Console (siehe oben).
- **Kein automatisches Hochstufen** von `internal` nach `production`.
- **Vorgabe `draft`, nicht `completed`.** Ein Lauf soll nichts an Nutzer
  ausliefern, sondern etwas zum Ansehen in der Console hinterlegen, bis du es
  selbst freigibst.
