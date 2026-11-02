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
- „Passwort ≠ Benutzername“ gilt auch beim Ändern mit App-Token und beim
  Setzen durch den Verwalter (Name aus der Tabelle) — `passwort-regel-db`.
- „Andere Sitzungen beenden“ verlangt das Passwort: Eine erbeutete Sitzung
  sperrt den Inhaber nicht aus — `web-ohne-token-db`.
- Sperre je Adresse und je Konto mit wachsender Wartezeit:
  `utils/loginLimiter.ts` — `anmeldesperre-db`, `ip-drossel-parallel-db`.
- Sitzung: `httpOnly`, `sameSite=lax`, `secure` hinter TLS, Leerlauf- und
  Höchstdauer, neue Sitzungs-ID beim Anmelden: `utils/sitzungsFrist.ts`,
  `utils/auth.ts` — `sitzung-leerlauf-db`, `sitzung-hoechstdauer`, `auth-sessions-db`.
- Passwortwechsel und Kontolöschung beenden Sitzungen und Tokens —
  `auth-sessions-db`, `token-laufzeit-db`.
- Beendete Sitzungen bleiben beendet: Jede Sitzung trägt
  `users.sitzungs_version` von der Anmeldung; wer Zugänge beendet (Passwort,
  Sperre, Rolle, Löschen, „andere beenden“, 2FA eingeschaltet), erhöht sie,
  jede Anfrage vergleicht (5 s Zwischenspeicher je Konto). Eine von einer
  laufenden Anfrage zurückgeschriebene Zeile gilt damit nicht mehr:
  `src/konto/sitzungsVersion.ts` — `sitzungsversion-db`.
- Drosseln je Adresse zählen ein IPv6-/64 als eine Adresse, IPv4 in IPv6 als
  IPv4: `drosselAdresse` in `src/konto/loginLimiter.ts` — `drossel-ipv6-db`.
- Tokens mit Scope: `app` hat nie Verwalterrechte, QR-Codes geben nur `app`;
  Verwalterrouten verlangen Sitzung oder Scope `voll`. Gleitender Ablauf
  (90 Tage), Tausch über `/auth/token-rotieren` mit 5 min Überlappung;
  „unbegrenzt“ nur über HTTPS und mit Tauschpflicht nach 60 Tagen;
  Geräteliste mit Scope, Netz und Ablauf: `utils/auth.ts` —
  `token-scope-rotation-db`, `token-gleitfrist-db`.
- Passkeys (WebAuthn) ohne Passwort und als zweiter Faktor; Challenge nur
  einmal gültig, Zähler, Herkunft aus `APP_BASE_URL`: `utils/passkeys.ts` —
  `passkeys-db`. TOTP: `utils/zweiterFaktor.ts` — `zweiter-faktor-db`.
- Kein Weg am zweiten Faktor vorbei: Ein neuer Passkey und das Einlösen
  einer Haushaltseinladung verlangen bei aktivem TOTP auch den Code; jede
  Code-Prüfung (auch das Bestätigen der Einrichtung) läuft über die
  Konto-Bremse — `passkeys-db`, `haushalt-beitreten-db`, `zweiter-faktor-db`.
  Ebenso Passwortwechsel, Passkey löschen und neue E-Mail (`code`; fehlt er,
  400 `zweiter_faktor_noetig` ohne Zählung) — `zweiter-faktor-heikel-db`.
  Eine neue E-Mail gilt auch beim Verwalter erst nach dem Link als bestätigt.
- Wiederherstellungscodes: 80 Bit, als HMAC mit Teilschlüssel des
  Datenschlüssels und an das Konto gebunden — `zweiter-faktor-db`.
- Passwort zurücksetzen widerruft Tokens, Sitzungen und alle Passkeys; der
  Wechsel Passkeys auf Wunsch. Hinweis-Mail bei neuem Passkey und bei
  Passwortwechsel/-rücksetzung, mit den Konten, die die Sammlung sehen —
  `passkeys-db`.
- „Passwort vergessen": ein Link je Konto und 15 Minuten, gleiche Antwort
  und Mindestdauer für bekannte und unbekannte Adressen; Links nur aus
  `APP_BASE_URL`, nie aus Kopfzeilen — `forgot-password-db`.
- Startpasswort (`must_change_password`): bis zum Wechsel nur
  `change-password`/`logout`, sonst 403 — `passwort-pflichtwechsel-db`.
- Benutzernamen ohne Rücksicht auf Gross-/Kleinschreibung eindeutig
  (Index, Migration 0090) — `konto-anlegen-db`.
- „Alle meine Daten löschen" nur mit Passwort — `alles-loeschen-haushalt-db`.
- Mailadressen stehen im Protokoll nur maskiert — `haushalt-beitreten-db`.
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
- Set-Bilder (`/images/sets/…`) nur im Blickfeld (Bestand, Merkliste,
  Preisalarme des Haushalts), Anleitungen (`/data/instructions/…`) nur zu Sets
  im Bestand; fremd und fehlend antworten gleich (404). Teile- und
  Figurenbilder sind Katalog. Katalog, `/sets/info` und `/sets/barcode` nennen
  `image_local` nur im Blickfeld: `src/katalog/bilder/bildBlickfeld.ts` —
  `bild-blickfeld-db`, `katalog-bilder-db`.
- Teile-Import (`POST /sets/:setNumber/parts`) nur für Sets im Blickfeld, für
  deren Besitzer: `routes/api_v1/sets.ts` — `teile-import-besitz-db`.
- Die Haushaltswährung stellt nur das Hauptkonto (Unterkonto: 403
  `waehrung_nur_hauptkonto`): `src/konto/settings.ts` — `haushalt-waehrung-db`.
- Gutscheine nie über den Haushalt, auch nicht für Verwalter — `gutscheine-db`.

### Gemeinsame Daten (3)
- Bildcache nur aus geprüften Katalogadressen (`bild_von IS NULL`), nie aus
  Angaben des Clients: `jobs/pdfErzeugung.ts`, `startup/bildNachlauf.ts` —
  `bildcache-quelle-db`.
- Setnummer für den Bild-Job nur aus einer reinen Rebrickable-Setadresse:
  `routes/imgProxy.ts` — `bildcache-quelle-db`.
- Geteilte Anleitungen ersetzen (löschen und neu holen) nur der Verwalter;
  wer das Set hat, holt nur fehlende, einmal je Set und Tag:
  `routes/api_v1/sets.ts` — `anleitung-neu-laden-db`.

### Uploads (4)
- Typ aus dem Inhalt, Endung aus dem MIME-Typ, Name zufällig, Kontingent je
  Konto: `routes/api_v1/sets.ts`, `utils/dateiEmpfang.ts` — `upload-grenzen-db`.
- Gutschein-PDF höchstens 2 MB, Entpackgrenze: `utils/gutscheinPdf.ts` — `gutschein-pdf-bombe-db`.
- Gutschein-PDFs verschlüsselt, Konto löschen entfernt Uploads und
  Gutscheine: `utils/gutscheinDateien.ts` — `konto-dateien-db`.

### Abrufe nach aussen (SSRF, 5)
- Die Guthaben-Abfrage bei lego.com geht über `src/infra/abruf.ts`: nur
  `www.lego.com`, auch nach einer Umleitung; ein POST folgt keiner; Antworten
  höchstens 4 MB (Seite) bzw. 512 KB (Abfrage), 20 s — `gutschein-guthaben-abruf`.
- Ein Weg nach draussen: `src/infra/abruf.ts` (`holeHttps`, `oeffneHttps`).
  Nur https, Host-Liste für Start und jeden Sprung, relative `Location`
  aufgelöst, höchstens 5 Umleitungen, Byte-Grenze (angesagt und gezählt),
  Gesamtfrist, `Authorization`/`Cookie` fallen bei Hostwechsel weg; jeder
  Fehler wird Ablehnung, kein Wurf im Antwort-Rückruf. Fehlertexte ohne
  Anfrageteil (dort stehen API-Schlüssel), fremder Antworttext nur gekürzt
  im Protokoll — `abruf-helfer` (echter TLS-Server), `umleitungen` (niemand
  sonst ruft `https.get`/`fetch`), `download-grenzen`, `img-proxy-size`.
  Hosts exakt (Unterdomänen nur über `*.`-Eintrag, nur bei `lego.com`), nur
  Standardport, keine Userinfo: `hostErlaubt` in `src/infra/fremdeAdressen.ts` — `umleitungen`.
  Ausgenommen sind nur `scripts/loadtest.js` und `scripts/check-api-contract.js`,
  die von der Kommandozeile den eigenen Server rufen.
- Bild-Proxy: Cache-Schlüssel ohne Zeitstempel im Anfrageteil, CDN-Abrufe je
  Konto gedrosselt (`BILD_ABRUFE_JE_MINUTE`), Cache gedeckelt
  (`BILD_CACHE_MAX_MB`), Antworten `Cache-Control: private`:
  `routes/imgProxy.ts`, `src/katalog/bilder/imgCacheServe.ts` — `bild-proxy-deckel`.
- Nummern als kodiertes Pfadsegment (`pfadSegment`) — `fremde-pfade-db`.

### Eingaben (2, 3)
- Teileliste des PDF-Auftrags nach Schema (`PdfEingabe`): höchstens 5000
  Posten, Feldlängen, Menge 1–9999; nur bekannte Felder gehen in den Auftrag
  — `pdf-jobs-db`.
- Rumpf und Abfrage im Betrieb gegen den API-Vertrag, unmittelbar vor der
  Route (`eingabePruefen` in `src/infra/vertrag/pruefen.ts`): falscher Typ,
  zu langer Text oder wiederholter Abfrageparameter ergeben 400
  `eingabe_ungueltig` — `eingabe-vertrag-db`. Routen ohne `eingabe` im
  Vertrag prüfen selbst (`src/infra/validate.ts`).
- Vor-/Nachname ohne Steuerzeichen und Webadressen (`nameGueltig`). Mails an
  unbestätigte Adressen (Bestätigung, Rücksetzen, „Name vergeben“) grüssen
  ohne Namen; die Konsole zeigt nur den vom Absender übergebenen Link:
  `src/infra/mailer.ts` — `mail-fremder-text-db`, `mail-link-konsole`.

### Ausgabe und Kopfzeilen (2)
- CSP ohne Inline-Skripte, `X-Frame-Options`, `nosniff`, HSTS nur bei
  `req.secure` (also hinter dem vertrauten Proxy), nicht nach einem rohen
  `X-Forwarded-Proto`: `server.ts` — `csp-actions`, `hsts`, `frontend-escaping`.
- Ströme und Sammelberichte (Erfassungsstrom, CSV-/XML-Importe) melden
  Fachfehler mit Code, alles andere als `interner_fehler`; der Text steht nur
  im Protokoll: `oeffentlicherFehler` in `src/infra/httpError.ts` — `fehlertext-intern-db`.
- Aktions-Dispatcher kein Skript-Gadget: kein `mouseenter`, je Ereignis nur
  die genutzten Handler, kein Rückfall auf `window`; Löschen, Konto, Tokens
  und Verwaltung nur von Elementen aus dem Markup beim Laden oder aus
  Vorlagen mit `echt()` (Zufallsmarke je Seitenladung):
  `public/js/11-actions.js`, `public/js/00-registry.js` — `aktionen-schutz`.

### Protokoll und Kontingente
- Guthaben-Abfrage bei lego.com: zuerst höchstens 20 je Konto und Stunde
  (429 `zu_viele_anfragen`, `grund: konto`), dann eine je 30 s über alle
  Konten; die Pause nach dem Bot-Schutz löst nur eine Abfrage aus, die beide
  Grenzen passiert hat: `src/gutscheine/gutscheinGuthabenSchranke.ts` —
  `gutschein-guthaben-db`.
- `X-Request-Id` nur aus `[A-Za-z0-9._:-]{1,64}`, sonst eigene Kennung;
  Caddy setzt je Anfrage eine neue: `utils/protokoll.ts` — `protokoll`.
- Fremdkontingent: je Nicht-Verwalter ein Viertel, alle zusammen die Hälfte;
  Aufträge zählen beim Konto, das sie eingestellt hat:
  `utils/apiKontingent.ts`, `utils/auftraege.ts` — `api-kontingent-konto-db`.
- Je Zieladresse (gehasht): Registrierung 3/h (429), „Passwort vergessen“ 3/h
  (still keine Mail): `src/konto/zielDrossel.ts` — `mail-fremder-text-db`.
- Teile-Import 30/h je Konto, leere Rebrickable-Antworten 10 min gemerkt;
  Währungswechsel 5/h je Konto (jeder zieht den Preislauf vor).
- Rumpf höchstens 256 KB, nur der PDF-Auftrag 4 MB (pfadgenau vor dem
  allgemeinen Parser): `server.ts` — `upload-grenzen-db`.

### Ruhende Daten
- Der Fingerabdruck eines `Idempotency-Key` enthält keine Passwort-, Code-,
  PIN- oder Schlüsselfelder und ist ein HMAC mit eigenem Teilschlüssel des
  Datenschlüssels — `idempotenz-geheim-db`.
- Geheimnisse und Gutschein-PDFs mit dem Datenschlüssel: `utils/geheimnis.ts`
  — `geheimnisse-verschluesselt-db`, `konto-dateien-db`.
- Mail-Links ohne Token in den Protokollen: `utils/mailer.ts`.

### Lieferkette (5)
- Actions per Commit-SHA, Images per Digest — `workflow-ort`, `compose-pgweb`.
  Dependabot schlägt neue Fassungen vor: Actions, Dockerfiles und die Dienste
  in `compose.yaml` (`docker-compose`); npm und Gradle über Renovate
  (`renovate.json` im Wurzelverzeichnis).
- `npm ci` aus dem Lockfile; `npm audit --omit=dev` (web-ci.yml).
- PDF.js als `pdfjs-dist` mit exakter Fassung; `public/vendor/pdfjs/` ist eine
  beim Bauen geschriebene, byte-gleiche Kopie — `pdfjs-fassung`. Als
  devDependency fehlt es in `npm audit --omit=dev`; web-ci.yml prüft es
  deshalb zusätzlich im vollen `npm audit`.
- Build-Kontext ohne `.env`, `backups/`, `schluessel/`, `data/` — `dockerfile`.
- Der Entrypoint schreibt seine Marke unter `/app/data` nicht als root und
  folgt keinem Symlink des Dienstes — `entrypoint-start`.
- `docker-publish.yml`: Der Tag beim Handstart nur über `env` und in
  Docker-Tag-Form, sonst Abbruch — `workflow-tag`.
- `.github/workflows/sicherheit.yml`: CodeQL (TypeScript, Kotlin), Trivy
  (Abhängigkeiten, Image), ZAP-Baseline gegen den Produktionsserver. Die
  Images aus `compose.yaml` (Caddy, Postgres, pgweb) liest der Lauf aus der
  Datei, prüft sie mit Trivy (Bericht) und meldet einen Digest, der hinter
  seinem Tag zurückliegt.

## Betrieb

- Die App, die Jobs und pgweb verbinden sich als `brickinventory_app` ohne
  Superuser-, CREATEROLE- oder CREATEDB-Recht und ohne Mitgliedschaft in
  `pg_execute_server_program` & Co.; die Rolle besitzt Datenbank, Tabellen und
  Funktionen (Migrationen). Den Superuser kennen nur Postgres und der
  einmalige Dienst `db-rolle` (`postgres/app-rolle.sh`). Läuft die App doch als
  Superuser, warnt der Start — `db-rolle-db`, `compose-pgweb`.
- `DB_PASSWORD`, `DB_APP_PASSWORD` und `BRICK_HOST` sind Pflicht; Klartext nur als bewusste
  Ausnahme (Port 3000 in `compose.yaml` einkommentieren, `COOKIE_SECURE=0`).
- `caddy/data/` mitsichern und wie ein Passwort behandeln (Schlüssel der CA).
- pgweb nur auf `127.0.0.1`, nur mit Profil `tools`, nur lesend und nur mit
  Anmeldung (`PGWEB_PASSWORD`, sonst startet er nicht) — `compose-pgweb`.
- `scripts/restore.sh` entpackt ein data-Archiv nur, wenn es aus Dateien und
  Ordnern unter `data/` besteht (`scripts/archiv-pruefen.sh`) — `restore-archiv`.
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
- **Klartext**: Wer Port 3000 wieder veröffentlicht, schickt im Browser
  Passwort und Sitzung unverschlüsselt. Die Android-App verbindet sich nur
  über HTTPS; eine `http://`-Adresse lehnt sie ab.
- **Tokens im Überlappungsfenster**: Nach einem Tausch gilt der alte Token
  bis zu 5 min (bis zur ersten Nutzung des neuen). Geht die Antwort verloren
  und vergehen 5 min, muss die App neu gekoppelt werden.
- **„Unbegrenzt“** endet nur durch Widerruf oder fehlenden Tausch: Ein
  gestohlenes Gerät, das weiter tauscht, bleibt angemeldet, bis es in der
  Geräteliste entfernt wird.
- **Passkeys ohne zweiten Faktor**: Ein Konto ohne TOTP kann sich mit Passkey
  ODER Passwort anmelden; der Passkey verschärft die Passwortanmeldung nicht.
  Passkeys brauchen einen Namen in `APP_BASE_URL` (keine IP-Adresse).
- **Haushalt nach einem Einbruch**: Zurücksetzen löst Haushaltsverknüpfungen
  nicht; die Hinweis-Mail nennt die Hauptkonten, trennen muss der Inhaber
  selbst (Einstellungen → Haushalt).
- **Alte Wiederherstellungscodes** (vor dem 01.11.2026, 50 Bit, SHA-256) gelten, bis
  sie verbraucht oder neu erzeugt sind.
- **Datenschlüssel neben den Daten**: Ohne `DATA_KEY` liegt der Schlüssel in
  `data/`. Wer das ganze Volume hat, hat auch die Geheimnisse.
- **Altbestand im Bildcache**: Bilder, die vor dieser Fassung aus Angaben
  eines Clients geladen wurden, bleiben liegen, bis sie neu geladen werden.
- **Fremdkontingent**: Nicht-Verwalter bekommen zusammen höchstens die Hälfte;
  ein Verwalter oder ein Hintergrundlauf kann den Rest weiterhin aufbrauchen.
- **Sitzungsversion zwischengespeichert**: Läuft mehr als ein Webprozess,
  sieht ein anderer Prozess eine beendete Sitzung bis zu 5 s später als
  beendet (im eigenen Prozess sofort).
- **ZAP ohne Anmeldung**: Der Baseline-Lauf sieht nur die öffentlichen Seiten.
- **Gemeinsamer Set-Katalog**: `set_catalog` füllt sich beim Erfassen. Name
  und Daten eines Sets (etwa über `/sets/info`) verraten deshalb weiterhin,
  dass es jemand auf dem Server erfasst hat — nur das Bild nicht mehr. Ebenso
  erscheinen geteilte Anleitungen eines selbst erfassten Sets sofort, wenn sie
  schon jemand geladen hatte.
- **Bilder der Container** (`postgres`, `caddy`, `pgweb`, ZAP) sind per Digest
  fest und veralten damit; Dependabot schlägt neue Fassungen vor (ZAP und die
  Dienst-Container der Workflows nicht). Trivy meldet Lücken der drei
  Betriebs-Images vorerst nur, ohne den Lauf rot zu machen.
