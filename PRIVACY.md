# Datenschutzerklärung – BrickInventory

*English version below.*

Stand: 27. November 2026

## Verantwortlich und Kontakt

BrickInventory ist ein privates Open-Source-Projekt.
Kontakt: **brickinventoryapp@gmail.com** oder über die
[GitHub-Issues](https://github.com/addict85/BrickInventory/issues).

## Grundsatz

Die Android-App „BrickInventory“ ist der Zugang zu einem **selbst betriebenen
BrickInventory-Server**. Die App spricht ausschliesslich mit dem Server, dessen Adresse du
selbst einträgst. Der Betreiber dieses Servers (meist du selbst oder dein Haushalt) ist für die
dort gespeicherten Daten verantwortlich. Die Entwickler der App erhalten keine Daten.

Die App enthält **keine Werbung, kein Tracking, keine Analyse- und keine Absturzdienste**.

## Welche Daten die App verarbeitet

| Daten | Zweck | Wo gespeichert |
|---|---|---|
| Benutzername, Passwort (nur bei der Anmeldung), E-Mail-Adresse (optional) | Anmeldung und Kontoverwaltung | auf deinem Server |
| Sammlung: Sets, Teile, Figuren, Lagerorte, Kaufpreise, Merkliste, Preisalarme | Inventar und Bewertung | auf deinem Server; eine Kopie zur Offline-Nutzung verschlüsselt auf dem Gerät |
| Gutscheine (Nummer, PIN, Betrag, PDF) | Gutscheinverwaltung | verschlüsselt auf deinem Server; auf dem Gerät nur kurzzeitig zur Anzeige |
| Anmelde-Token, Server-Adresse, Geräteschlüssel | angemeldet bleiben, Gerät freigeben | verschlüsselt im Android-Keystore des Geräts |
| Passkeys | Anmeldung ohne Passwort | im Passwort-Manager des Geräts (Android/Google) |

## Berechtigungen

- **Internet / Netzwerkstatus:** Verbindung zu deinem Server.
- **Kamera:** nur zum Scannen von Barcodes und zum Lesen von Setnummern. Die Erkennung läuft
  auf dem Gerät (Google ML Kit); Bilder werden nicht gespeichert und nicht übertragen. Das
  Erkennungsmodell für Barcodes stellen die Google-Play-Dienste bereit.
- **Biometrie / Gerätesperre:** nur lokal, um sensible Schritte (z. B. Gutscheinnummern) zu
  bestätigen. Biometrische Daten verlassen das Gerät nie und sind der App nicht zugänglich.
- **Benachrichtigungen:** Fortschritt und Abschluss von CSV-Import und PDF-Export sowie
  Preisalarme.
- **Start nach dem Neustart / Wake-Lock:** geplante Hintergrundaufgaben (z. B. Widget) laufen
  nach einem Neustart weiter.

## Dritte

Die App selbst überträgt keine Daten an Dritte. **Dein Server** fragt für die Bewertung
öffentliche Katalog- und Preisdaten bei BrickLink, Rebrickable und LEGO ab (z. B. Setnummern
und Gutscheinguthaben). Welche Daten dabei übertragen werden, hängt von der Konfiguration
deines Servers ab.

## Speicherdauer und Löschung

Daten bleiben auf deinem Server, bis du sie löschst. In der App kannst du dein Konto löschen.
Beim Abmelden oder Deinstallieren entfernt Android die lokal gespeicherten Daten der App.

## Deine Rechte

Da die Daten auf einem von dir oder deinem Haushalt betriebenen Server liegen, wende dich für
Auskunft, Berichtigung oder Löschung an dessen Betreiber. Fragen zur App beantworten wir unter
der oben genannten Adresse.

## Änderungen

Änderungen an dieser Erklärung werden in diesem Dokument veröffentlicht.

---

# Privacy Policy – BrickInventory

Last updated: 27 November 2026

## Controller and contact

BrickInventory is a private open-source project.
Contact: **brickinventoryapp@gmail.com** or via
[GitHub Issues](https://github.com/addict85/BrickInventory/issues).

## Principle

The Android app "BrickInventory" is a client for a **self-hosted BrickInventory server**. The
app talks only to the server whose address you enter. The operator of that server (usually you
or your household) is responsible for the data stored there. The app's developers receive no
data.

The app contains **no ads, no tracking, no analytics and no crash-reporting services**.

## Data processed by the app

| Data | Purpose | Stored |
|---|---|---|
| Username, password (only at sign-in), e-mail address (optional) | sign-in and account management | on your server |
| Collection: sets, parts, minifigures, storage locations, purchase prices, wanted list, price alerts | inventory and valuation | on your server; an encrypted copy on the device for offline use |
| Vouchers (number, PIN, amount, PDF) | voucher management | encrypted on your server; on the device only briefly for display |
| Sign-in token, server address, device key | staying signed in, device approval | encrypted in the device's Android Keystore |
| Passkeys | password-less sign-in | in the device's password manager (Android/Google) |

## Permissions

- **Internet / network state:** connection to your server.
- **Camera:** only to scan barcodes and read set numbers. Recognition runs on the device
  (Google ML Kit); images are neither stored nor transmitted. Google Play services provide the
  barcode recognition model.
- **Biometrics / device lock:** used locally only, to confirm sensitive steps (e.g. voucher
  numbers). Biometric data never leaves the device and is not accessible to the app.
- **Notifications:** progress and completion of CSV import and PDF export, and price alerts.
- **Run at startup / wake lock:** scheduled background work (e.g. the widget) continues after a
  reboot.

## Third parties

The app itself sends no data to third parties. **Your server** retrieves public catalogue and
price data from BrickLink, Rebrickable and LEGO for valuation (e.g. set numbers and voucher
balances). Which data is transferred depends on your server's configuration.

## Retention and deletion

Data stays on your server until you delete it. You can delete your account in the app. When you
sign out or uninstall, Android removes the app's locally stored data.

## Your rights

As the data lives on a server operated by you or your household, contact its operator for
access, correction or deletion. Questions about the app are answered at the address above.

## Changes

Changes to this policy are published in this document.
