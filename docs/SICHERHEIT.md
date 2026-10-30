# Sicherheit der Web-App

Kurzes Bedrohungsmodell für `Web-App/`. Pfade sind relativ zu `Web-App/`,
Tests liegen unter `Web-App/test/`. Die Begründungen stehen im Code und in
den Commits, nicht hier.

## Werte

| Wert | Wo |
|---|---|
| Konten, Passwort-Hashes (bcrypt), Sitzungen, API-Tokens (gehasht), Passkeys (öffentliche Schlüssel) | PostgreSQL |
| Interne CA (Wurzel und Schlüssel), TLS-Zertifikate | `caddy/data/` (nur root) |
| Sammlung, Kaufpreise, Finanzen je Konto und Haushalt | PostgreSQL |
| Geheimnisse: Gutschein-PIN, TOTP, API-Schlüssel, SMTP-Passwort | PostgreSQL, AES-256-GCM |
| Gutschein-PDFs (Kartennummer, PIN) | `data/vouchers/<konto>/`, AES-256-GCM |
| Eigene Anleitungen | `data/uploads/<konto>/` |
| Gemeinsamer Bildcache, geteilte Anleitungen | `data/images/`, `data/instructions/` |
| Datenschlüssel | `data/.datenschluessel` (0600) oder `DATA_KEY` |
| Kontingent bei Rebrickable, Brickset, BrickLink | Server-Schlüssel |

## Angreifer

1. **Im LAN** — liest und verändert den Verkehr (auch als Mann in der
   Mitte), kann Kopfzeilen frei setzen, steht vielleicht im selben Docker-Netz.
2. **Aus dem Internet** — hinter dem Reverse-Proxy; rät Passwörter, lockt
   angemeldete Nutzer auf fremde Seiten (CSRF).
3. **Ein anderes Konto** — angemeldet, versucht fremde Daten zu lesen oder
   gemeinsame Daten (Bildcache, Katalog, Anleitungen) zu verändern.
4. **Böswilliger Upload** — PDF/Bild mit falschem Typ, Entpackbombe,
   Pfadteile im Namen.
5. **Lieferkette** — npm-Pakete, Actions, Container-Images, fremde
   Antworten von Rebrickable, Brickset, LEGO.

## Schutzmaßnahmen

### Transport (1)
- HTTPS als Standard: Caddy mit eigener CA (`tls internal`) vor der App, die
  App veröffentlicht keinen Port; Port 80 leitet um und liefert nur `/ca.crt`:
  `compose.yaml`, `Caddyfile` — `compose-pgweb`.
- Die Wurzel signiert die Blätter (`sign_with_root`) und steht in der
  ausgelieferten Kette; die App pinnt ihren SPKI-Fingerabdruck aus dem QR-Code
  (`fp`): `utils/tlsWurzel.ts`, `routes/auth.ts` — `tls-wurzel-db`.
- `TRUST_PROXY` nennt genau Caddy; dahinter Cookie mit `Secure` und HSTS:
  `utils/konfig.ts` (`cookieSicher`), `server.ts` — `tls-wurzel-db`, `hsts`.
- Die Schlüssel der CA bleiben bei Caddy: Die App sieht den Ordner nur lesend
  und als Nicht-root nur die vom Entrypoint kopierte Wurzel.

### Anmeldung und Sitzung (2, 3)
- Sperre je Adresse und je Konto mit wachsender Wartezeit:
  `utils/loginLimiter.ts` — `anmeldesperre-db`, `ip-drossel-parallel-db`.
- Sitzung: `httpOnly`, `sameSite=lax`, `secure` hinter TLS, Leerlauf- und
  Höchstdauer, neue Sitzungs-ID beim Anmelden: `utils/sitzungsFrist.ts`,
  `utils/auth.ts` — `sitzung-leerlauf-db`, `sitzung-hoechstdauer`, `auth-sessions-db`.
- Passwortwechsel und Kontolöschung beenden Sitzungen und Tokens —
  `auth-sessions-db`, `token-laufzeit-db`.
- Tokens mit Scope: `app` hat nie Verwalterrechte, QR-Codes geben nur `app`;
  Verwalterrouten verlangen Sitzung oder Scope `voll`. Gleitender Ablauf
  (90 Tage), Tausch über `/auth/token-rotieren` mit 5 min Überlappung;
  „unbegrenzt“ nur über HTTPS und mit Tauschpflicht nach 60 Tagen;
  Geräteliste mit Scope, Netz und Ablauf: `utils/auth.ts` —
  `token-scope-rotation-db`, `token-gleitfrist-db`.
- Passkeys (WebAuthn) ohne Passwort und als zweiter Faktor; Challenge nur
  einmal gültig, Zähler, Herkunft aus `APP_BASE_URL`: `utils/passkeys.ts` —
  `passkeys-db`. TOTP: `utils/zweiterFaktor.ts` — `zweiter-faktor-db`.
- In Produktion kein Start mit Beispiel-`SESSION_SECRET` oder
  Beispiel-Datenbankpasswort: `server.ts`, `utils/konfig.ts` (`startVerbote`) — `startverbot`.

### Herkunft der Client-Adresse (1)
- `TRUST_PROXY` vertraut nur ausdrücklich genannten Adressen oder kleinen
  Netzen; Vorgabe Loopback, `docker`/`true`/Hop-Zahlen verweigern den Start:
  `utils/proxyVertrauen.ts` — `anmeldesperre-db`, `proxy-hinweis`, `startverbot`.
- `compose.yaml`: festes Netz `172.28.73.0/24`; ein Reverse-Proxy bekommt
  darin eine feste Adresse, und genau die steht in `TRUST_PROXY` — `compose-pgweb`.

### CSRF (2)
- Ändernde Anfragen: `Sec-Fetch-Site`, sonst `Origin`/`Referer` gegen Host
  und `APP_BASE_URL`; Cookie-Sitzung ohne Herkunft wird abgelehnt, Bearer
  ohne Cookie ausgenommen: `utils/herkunft.ts` — `herkunft`.

### Zugriff auf fremde Daten (3)
- Jede Abfrage über `scopeIds()`/`writableIds()` (Haushalt):
  `utils/household.ts` — `erfassung-fremd-loeschen-db`, `gutscheine-db`, `pdf-jobs-db`.
- Uploads nur für Besitzer und Hauptkonto: `routes/datenDateien.ts` — `daten-dateien-db`, `media-auth`.
- Gutscheine nie über den Haushalt, auch nicht für Verwalter — `gutscheine-db`.

### Gemeinsame Daten (3)
- Bildcache nur aus geprüften Katalogadressen (`bild_von IS NULL`), nie aus
  Angaben des Clients: `jobs/pdfErzeugung.ts`, `startup/bildNachlauf.ts` —
  `bildcache-quelle-db`.
- Setnummer für den Bild-Job nur aus einer reinen Rebrickable-Setadresse:
  `routes/imgProxy.ts` — `bildcache-quelle-db`.
- Geteilte Anleitungen neu laden: Verwalter, sonst einmal je Set und Tag:
  `routes/api_v1/sets.ts` — `anleitung-neu-laden-db`.

### Uploads (4)
- Typ aus dem Inhalt, Endung aus dem MIME-Typ, Name zufällig, Kontingent je
  Konto: `routes/api_v1/sets.ts`, `utils/dateiEmpfang.ts` — `upload-grenzen-db`.
- Gutschein-PDF höchstens 2 MB, Entpackgrenze: `utils/gutscheinPdf.ts` — `gutschein-pdf-bombe-db`.
- Gutschein-PDFs verschlüsselt, Konto löschen entfernt Uploads und
  Gutscheine: `utils/gutscheinDateien.ts` — `konto-dateien-db`.

### Abrufe nach aussen (SSRF, 5)
- Nur https, Host-Liste bei jedem Sprung, Schlüssel nicht über Hostwechsel,
  Größengrenze im Strom: `utils/fremdeAdressen.ts`, `clients/rebrickable.ts`,
  `utils/bildDatei.ts` — `umleitungen`, `download-grenzen`, `img-proxy-size`.
- Nummern als kodiertes Pfadsegment (`pfadSegment`) — `fremde-pfade-db`.

### Ausgabe und Kopfzeilen (2)
- CSP ohne Inline-Skripte, `X-Frame-Options`, `nosniff`, HSTS hinter TLS:
  `server.ts` — `csp-actions`, `hsts`, `frontend-escaping`.

### Protokoll und Kontingente
- `X-Request-Id` nur aus `[A-Za-z0-9._:-]{1,64}`, sonst eigene Kennung;
  Caddy setzt je Anfrage eine neue: `utils/protokoll.ts` — `protokoll`.
- Fremdkontingent: je Nicht-Verwalter ein Viertel, alle zusammen die Hälfte;
  Aufträge zählen beim Konto, das sie eingestellt hat:
  `utils/apiKontingent.ts`, `utils/auftraege.ts` — `api-kontingent-konto-db`.

### Ruhende Daten
- Geheimnisse und Gutschein-PDFs mit dem Datenschlüssel: `utils/geheimnis.ts`
  — `geheimnisse-verschluesselt-db`, `konto-dateien-db`.
- Mail-Links ohne Token in den Protokollen: `utils/mailer.ts`.

### Lieferkette (5)
- Actions per Commit-SHA, Images per Digest — `workflow-ort`, `compose-pgweb`.
- `npm ci` aus dem Lockfile; `npm audit --omit=dev` (web-ci.yml).
- `.github/workflows/sicherheit.yml`: CodeQL (TypeScript, Kotlin), Trivy
  (Abhängigkeiten, Image), ZAP-Baseline gegen den Produktionsserver.

## Betrieb

- `DB_PASSWORD` und `BRICK_HOST` sind Pflicht; Klartext nur als bewusste
  Ausnahme (Port 3000 in `compose.yaml` einkommentieren, `COOKIE_SECURE=0`).
- `caddy/data/` mitsichern und wie ein Passwort behandeln (Schlüssel der CA).
- pgweb nur auf `127.0.0.1`, nur mit Profil `tools`, nur lesend.
- Container ohne Capabilities ausser den nötigen, `read_only`, `no-new-privileges`.
- Datenschlüssel getrennt von `data/` sichern (`DATA_KEY`), sonst sind
  Geheimnisse und Gutschein-PDFs einer Sicherung nicht lesbar.

## Bekannte Restrisiken

- **Erste Kopplung des Wurzelzertifikats**: Wer `/ca.crt` bei der ersten
  Installation auf einem Gerät abfängt, kann eine eigene Wurzel unterschieben.
  Abhilfe ist der Abgleich des Fingerabdrucks mit dem auf dem Server
  (UPGRADE.md §14). Die App ist davon nicht betroffen: Sie bekommt den
  Fingerabdruck über den QR-Code vom angemeldeten Bildschirm.
- **Reichweite der internen CA**: Ein Gerät, das die Wurzel installiert,
  vertraut ihr für jede Adresse. Wer `caddy/data/` (Schlüssel) erbeutet, kann
  diesen Geräten jede Seite vortäuschen. Die App vertraut nur dem gepinnten
  Schlüssel. Caddy kennt keine Namensbeschränkung für seine CA.
- **Klartext als Ausnahme**: Wer Port 3000 wieder veröffentlicht, schickt
  Passwort, Sitzung und Token unverschlüsselt; der Serverbeweis der App
  erkennt einen falschen Server, nicht einen Mithörer.
- **Tokens im Überlappungsfenster**: Nach einem Tausch gilt der alte Token
  bis zu 5 min (bis zur ersten Nutzung des neuen). Geht die Antwort verloren
  und vergehen 5 min, muss die App neu gekoppelt werden.
- **„Unbegrenzt“** endet nur durch Widerruf oder fehlenden Tausch: Ein
  gestohlenes Gerät, das weiter tauscht, bleibt angemeldet, bis es in der
  Geräteliste entfernt wird.
- **Passkeys ohne zweiten Faktor**: Ein Konto ohne TOTP kann sich mit Passkey
  ODER Passwort anmelden; der Passkey verschärft die Passwortanmeldung nicht.
  Passkeys brauchen einen Namen in `APP_BASE_URL` (keine IP-Adresse).
- **Datenschlüssel neben den Daten**: Ohne `DATA_KEY` liegt der Schlüssel in
  `data/`. Wer das ganze Volume hat, hat auch die Geheimnisse.
- **Altbestand im Bildcache**: Bilder, die vor dieser Fassung aus Angaben
  eines Clients geladen wurden, bleiben liegen, bis sie neu geladen werden.
- **Fremdkontingent**: Nicht-Verwalter bekommen zusammen höchstens die Hälfte;
  ein Verwalter oder ein Hintergrundlauf kann den Rest weiterhin aufbrauchen.
- **ZAP ohne Anmeldung**: Der Baseline-Lauf sieht nur die öffentlichen Seiten.
- **Bilder der Container** (`postgres`, `caddy`, `pgweb`, ZAP) sind per Digest
  fest und veralten damit; Renovate (`renovate.json`) schlägt neue Fassungen vor.
