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
| Datenschlüssel | `schluessel/datenschluessel` (0400, für app und jobs nur lesend) oder `DATA_KEY` |
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
- HTTPS als Standard: Caddy vor der App, die App veröffentlicht keinen Port;
  Port 80 leitet um und liefert nur `/ca.crt`: `compose.yaml`, `Caddyfile` —
  `compose-haertung`.
- Keine CA ohne Namensbeschränkung als stiller Rückfall: Caddy startet nur mit
  eigener, auf `BRICK_HOST` beschränkter CA (`scripts/ca-einrichten.sh`), mit
  `BRICK_TLS=acme` (öffentlicher Name) oder ausdrücklich mit
  `CA_OHNE_NAMENSBESCHRAENKUNG=ja`; ohne Aussteller aus dem Startskript ist
  das Caddyfile ungültig. Das Protokoll von Caddy und `ca-einrichten.sh`
  nennen den SHA-256-Fingerabdruck der Wurzel zum Abgleich auf dem Gerät —
  `ca-eigene-wurzel`.
- Anmeldewege (Passwort, Passkey, QR, Registrierung, Rücksetzen) nehmen an
  Caddy Rümpfe bis 16 KB an und gehen ohne Verbindungsgrenze an die App: Die
  Zahl gleichzeitiger Passwortprüfungen begrenzt die bcrypt-Schranke des
  Servers (Vorrang bekannter Anmeldungen, sonst 503), die Raten je Adresse
  und Konto zählt der Server — `caddy-anmeldebremse`, `bcrypt-schranke-db`.
- bcrypt rechnet in höchstens 4 Worker-Threads (weniger bei kleinerem
  cgroup-Kontingent, mehr mit `BCRYPT_ARBEITER`); untätige enden nach 60 s —
  `bcrypt-pool`.
- Langsame Clients erreichen die App nicht: Caddy liest den Rumpf der
  Anmeldewege ganz (`request_buffers 32KB`, grösser als `max_size`), bevor er
  ihn weiterreicht; Köpfe müssen in 10 s da sein. Die App
  selbst: Kopf 15 s, ganze Anfrage 5 min (Uploads), ohne Anmeldung Rumpf
  10 s (sonst 408 `anfrage_zu_langsam`): `Caddyfile`, `server.ts`,
  `rumpfFrist` in `routes/api_v1/middleware.ts` — `caddy-anmeldebremse`,
  `sicherheit-runde11-db`.
- Die Wurzel signiert die Blätter (`sign_with_root`) und steht in der
  ausgelieferten Kette; die App pinnt ihren SPKI-Fingerabdruck aus dem QR-Code
  (`fp`): `src/infra/tlsWurzel.ts`, `routes/auth.ts` — `tls-wurzel-db`.
- `TRUST_PROXY` nennt genau Caddy; dahinter Cookie mit `Secure` und HSTS:
  `src/infra/konfig.ts` (`cookieSicher`), `server.ts` — `tls-wurzel-db`, `hsts`.
- Die Schlüssel der CA bleiben bei Caddy: Die App sieht den Ordner nur lesend
  und als Nicht-root nur die vom Entrypoint kopierte Wurzel.

### Anmeldung und Sitzung (2, 3)
- „Passwort ≠ Benutzername“ gilt auch beim Ändern mit App-Token und beim
  Setzen durch den Verwalter (Name aus der Tabelle) — `passwort-regel-db`.
- „Andere Sitzungen beenden“ verlangt das Passwort (und bei aktivem TOTP den
  Code): Eine erbeutete Sitzung sperrt den Inhaber nicht aus — `web-ohne-token-db`.
- Bremsen der erneuten Bestätigung je Konto **und** Zugang (Sitzung, gehasht,
  oder Token-Familie über `created_at`, das der Tausch erbt): Fehlversuche aus
  einer erbeuteten Sitzung sperren weder „andere beenden“ noch den
  Passwortwechsel des Inhabers. Falsche Codes zählen in einem eigenen Zähler
  (5 je Stunde), den nur ein richtiger Code löscht; ein richtiges Passwort
  setzt ihn nicht zurück: `src/konto/passwortBestaetigung.ts`,
  `src/konto/loginLimiter.ts` — `bestaetigung-bremsen-db`.
- Kein Passwort-Orakel: Ein gesperrtes oder unbestätigtes Konto bekommt bei
  richtigem Passwort dieselbe 401 `anmeldedaten_ungueltig` wie bei falschem
  (gezählt als Fehlversuch). Einen neuen Bestätigungslink gibt
  `POST /auth/bestaetigung-erneut` mit gleicher Antwort und Dauer für jede
  Adresse — `konto-deaktivieren-db`.
- Sperre je Adresse und je Konto mit wachsender Wartezeit:
  `src/konto/loginLimiter.ts` — `anmeldesperre-db`, `ip-drossel-parallel-db`.
- Sitzung: `httpOnly`, `sameSite=lax`, `secure` hinter TLS, Leerlauf- und
  Höchstdauer, neue Sitzungs-ID beim Anmelden: `src/konto/sitzungsFrist.ts`,
  `src/konto/auth.ts` — `sitzung-leerlauf-db`, `sitzung-hoechstdauer`, `auth-sessions-db`.
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
- App-Anmeldung: Token mit fester Höchstdauer 180 Tage ab Anmeldung, die der
  Tausch erbt — `token-scope-rotation-db`.
- Tokens mit Scope: `app` hat nie Verwalterrechte, QR-Codes geben nur `app`;
  Verwalterrouten verlangen Sitzung oder Scope `voll`. Gleitender Ablauf
  (90 Tage), Tausch über `/auth/token-rotieren` mit 5 min Überlappung;
  „unbegrenzt“ nur über HTTPS und mit Tauschpflicht nach 60 Tagen;
  Geräteliste mit Scope, Netz und Ablauf: `src/konto/auth.ts` —
  `token-scope-rotation-db`, `token-gleitfrist-db`.
- Passkeys (WebAuthn) ohne Passwort und als zweiter Faktor; Challenge nur
  einmal gültig, Zähler, Herkunft aus `APP_BASE_URL`: `src/konto/passkeys.ts` —
  `passkeys-db`. TOTP: `src/konto/zweiterFaktor.ts` — `zweiter-faktor-db`.
- Kein Weg am zweiten Faktor vorbei: Es gibt genau einen Bestätigungsweg,
  `bestaetigeMitFaktor` (`src/konto/http/anmeldung.ts`). Bei aktivem TOTP
  verlangt er immer Code oder Passkey-Antwort, auch mit dem
  Verwalterpasswort; fehlt beides, 400 `zweiter_faktor_noetig` ohne Zählung.
  Jede Route, die einen Zugang prägt oder Schutz abbaut, trägt im API-Vertrag
  `bestaetigung` (token-create, qr-token, Passkey anlegen/löschen, alle
  Verwalterrouten an Konten, `DELETE /bestand`, andere beenden, Passwort,
  E-Mail, 2FA abschalten, Haushalt beitreten, SMTP). Der Wächter
  `bestaetigung-vertrag-db` ruft jede markierte Route ohne und mit falschem
  Code, verlangt die Marke für jede Passwort-Eingabe des Vertrags und lässt
  `bcrypt.compare` nur in Anmeldung und Bestätigung zu; eine Route ohne Marke,
  die bestätigt, antwortet in Tests mit 500. Den Notausgang des Verwalters
  (`DELETE /auth/users/:id/zweiter-faktor`) gibt es nur für fremde Konten.
  Eine neue E-Mail gilt auch beim Verwalter erst nach dem Link als bestätigt
  — `zweiter-faktor-heikel-db`, `passkeys-db`, `haushalt-beitreten-db`.
- Hinweis-Mails bei neuem App-Token und QR-Zugang (Inhaber), neuem Verwalter
  und vom Verwalter entferntem zweitem Faktor (alle Verwalter, das Konto
  selbst): `src/konto/kontoHinweis.ts` — `zugang-hinweis-db`.
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
  Beispiel-Datenbankpasswort: `server.ts`, `src/infra/konfig.ts` (`startVerbote`) — `startverbot`.
- `/api/v1/startup-status` nennt Schritt und Unterstand nur angemeldet — `gesundheit-db`.

### Herkunft der Client-Adresse (1)
- `TRUST_PROXY` vertraut nur ausdrücklich genannten Adressen oder kleinen
  Netzen; Vorgabe Loopback, `docker`/`true`/Hop-Zahlen verweigern den Start:
  `src/infra/proxyVertrauen.ts` — `anmeldesperre-db`, `proxy-hinweis`, `startverbot`.
- `compose.yaml`: festes Netz `172.28.73.0/24`; ein Reverse-Proxy bekommt
  darin eine feste Adresse, und genau die steht in `TRUST_PROXY` — `compose-haertung`.

### CSRF (2)
- Ändernde Anfragen: `Sec-Fetch-Site`, sonst `Origin`/`Referer` gegen Host
  und `APP_BASE_URL`; Cookie-Sitzung ohne Herkunft wird abgelehnt, Bearer
  ohne Cookie ausgenommen: `src/infra/herkunft.ts` — `herkunft`.
- Mit `APP_BASE_URL` antwortet die App nur unter deren Namen (sonst 421
  `fremder_host`), gegen DNS-Rebinding im Klartextbetrieb. Frei bleiben
  Loopback, Bearer-Token, `/ca.crt` und die Gesundheitspfade:
  `nurEigenerHost` in `src/infra/herkunft.ts` — `sicherheit-runde11-db`.
- E-Mail-Bestätigung erst per Knopf: `GET /verify` zeigt die Seite,
  `POST /auth/email-bestaetigen` bestätigt; ein Link-Scanner bestätigt nichts
  — `sicherheit-runde11-db`.

### Zugriff auf fremde Daten (3)
- Jede Abfrage über `scopeIds()`/`writableIds()` (Haushalt):
  `src/haushalt/haushalt.ts` — `erfassung-fremd-loeschen-db`, `gutscheine-db`, `pdf-jobs-db`.
- Uploads nur für Besitzer und Hauptkonto: `routes/datenDateien.ts` — `daten-dateien-db`, `media-auth`.
- Kaufpreis umhängen: Eine fremde Erfassungs-ID antwortet wie eine fehlende
  (404 `kaufpreis_nicht_gefunden`), kein Orakel für vergebene IDs:
  `acquisitionMoveSource` in `src/haushalt/haushalt.ts` — `sicherheit-runde11-db`.
- Set-Bilder (`/images/sets/…`) nur im Blickfeld (Bestand, Merkliste,
  Preisalarme des Haushalts), Anleitungen (`/data/instructions/…`) nur zu Sets
  im Bestand; fremd und fehlend antworten gleich (404). Teile- und
  Figurenbilder sind Katalog. Katalog, `/sets/info` und `/sets/barcode` nennen
  `image_local` nur im Blickfeld: `src/katalog/bilder/bildBlickfeld.ts` —
  `bild-blickfeld-db`, `katalog-bilder-db`.
- Teile-Import (`POST /sets/:setNumber/parts`) nur für Sets im Blickfeld, für
  deren Besitzer: `routes/api_v1/sets.ts` — `teile-import-besitz-db`.
- Die Haushaltswährung stellt nur das Hauptkonto (Unterkonto: 403
  `waehrung_nur_hauptkonto`) und nur für seinen Haushalt abwärts; hängt ein
  Unterkonto auch an einem fremden Hauptkonto mit anderer Währung: 409
  `waehrung_geteiltes_unterkonto`: `src/konto/nutzerEinstellung.ts` — `haushalt-waehrung-db`.
- Gutscheine nie über den Haushalt, auch nicht für Verwalter — `gutscheine-db`.

### Gemeinsame Daten (3)
- Bildcache nur aus geprüften Katalogadressen (`bild_von IS NULL`), nie aus
  Angaben des Clients: `jobs/pdfErzeugung.ts`, `jobs/bildNachlauf.ts` —
  `bildcache-quelle-db`.
- Setnummer für den Bild-Job nur aus einer reinen Rebrickable-Setadresse:
  `routes/imgProxy.ts` — `bildcache-quelle-db`.
- Geteilte Anleitungen ersetzen (löschen und neu holen) nur der Verwalter;
  wer das Set hat, holt nur fehlende, einmal je Set und Tag:
  `routes/api_v1/sets.ts` — `anleitung-neu-laden-db`.

### Uploads (4)
- Typ aus dem Inhalt, Endung aus dem MIME-Typ, Name zufällig, Kontingent je
  Konto: `routes/api_v1/sets.ts`, `src/infra/dateiEmpfang.ts` — `upload-grenzen-db`.
- Gutschein-PDF höchstens 2 MB, Entpackgrenze: `src/gutscheine/gutscheinPdf.ts` — `gutschein-pdf-bombe-db`.
- Gutschein-PDFs verschlüsselt, Konto löschen entfernt Uploads und
  Gutscheine: `src/gutscheine/gutscheinDateien.ts` — `konto-dateien-db`.

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
  Hinaus geht nur ein Bildtyp aus einer Liste (JPEG, PNG, GIF, WebP, AVIF),
  nie der rohe Kopf des CDN; sonst JPEG (`bildTyp`) — `img-cache-serve`,
  `bild-proxy-deckel`.
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
  `src/mail/mailer.ts` — `mail-fremder-text-db`, `mail-link-konsole`.

### Ausgabe und Kopfzeilen (2)
- CSP ohne Inline-Skripte, `X-Frame-Options`, `nosniff`, HSTS nur bei
  `req.secure` (also hinter dem vertrauten Proxy), nicht nach einem rohen
  `X-Forwarded-Proto`: `server.ts` — `csp-actions`, `hsts`, `frontend-escaping`.
- Ströme und Sammelberichte (Erfassungsstrom, CSV-/XML-Importe) melden
  Fachfehler mit Code, alles andere als `interner_fehler`; der Text steht nur
  im Protokoll: `oeffentlicherFehler` in `src/infra/fehler.ts` — `fehlertext-intern-db`.
- 4xx ohne Code nennen nie den Text einer Bibliothek (Parser, Dateipfad,
  zlib), sondern `anfrage_ungueltig`, `nicht_gefunden` oder
  `anfrage_zu_gross`; eigene Sätze tragen die Klasse `Meldung`:
  `handleRouteError` — `sicherheit-runde11-db`.
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
  Caddy setzt je Anfrage eine neue: `src/infra/protokoll.ts` — `protokoll`.
- Fremdkontingent: je Nicht-Verwalter ein Viertel, alle zusammen die Hälfte;
  Aufträge zählen beim Konto, das sie eingestellt hat:
  `src/katalog/apiKontingent.ts`, `src/auftraege/auftraege.ts` — `api-kontingent-konto-db`.
- Je Zieladresse (gehasht): Registrierung 3/h (429), „Passwort vergessen“ 3/h
  (still keine Mail): `src/konto/zielDrossel.ts` — `mail-fremder-text-db`.
- Prüfung eines Haushaltscodes (`redeem/pruefen`) 30/h je Konto —
  `haushalt-beitreten-db`.
- Bestätigungslink: Vor dem Einlösen nennt `POST /auth/email-bestaetigen/vorschau`
  nur den Benutzernamen des Kontos (30/h je Adresse), die Seite und ihr Knopf
  nennen ihn; nennen mehrere offene Registrierungen die Adresse, verweist die
  Mail ohne Namen darauf — `email-neu-db`, `email-bestaetigen-browser`,
  `mail-fremder-text-db`.
- Teile-Import 30/h je Konto, leere Rebrickable-Antworten 10 min gemerkt;
  Währungswechsel 5/h je Konto (jeder zieht den Preislauf vor).
- Rumpf höchstens 256 KB, nur der PDF-Auftrag 4 MB (pfadgenau vor dem
  allgemeinen Parser): `server.ts` — `upload-grenzen-db`.

### Ruhende Daten
- Der Fingerabdruck eines `Idempotency-Key` enthält keine Passwort-, Code-,
  PIN- oder Schlüsselfelder und ist ein HMAC mit eigenem Teilschlüssel des
  Datenschlüssels — `idempotenz-geheim-db`.
- Geheimnisse und Gutschein-PDFs mit dem Datenschlüssel: `src/infra/geheimnis.ts`
  — `geheimnisse-verschluesselt-db`, `konto-dateien-db`.
- Mail-Links ohne Token in den Protokollen: `src/mail/mailer.ts`.

### Lieferkette (5)
- Actions per Commit-SHA, Images per Digest — `workflow-ort`, `compose-haertung`.
  Renovate schlägt neue Fassungen vor: Actions, Dockerfiles (auch
  `Dockerfile.caddy`) und die Dienste in `compose.yaml` (`docker-compose`), npm und Gradle
  (`renovate.json` im Wurzelverzeichnis), frühestens drei Tage nach
  Erscheinen (`minimumReleaseAge`).
- `npm ci --ignore-scripts` aus dem Lockfile (Dockerfile, CI); Install-Skripte
  nur gezielt für die Pakete, die eines haben (`npm rebuild esbuild`) —
  `dockerfile`. `npm audit --omit=dev` ist rot ab `moderate` (web-ci.yml) —
  `build-tooling`.
- Images mit Herkunft (SLSA-Provenance `mode=max`) und Stückliste (BuildKit
  mit per Digest festem Scanner; npm als CycloneDX) am Image, dazu
  `actions/attest-build-provenance` und `actions/attest-sbom` am signierten
  Digest; prüfen mit `cosign verify` und `gh attestation verify` (README) —
  `workflow-ort`.
- Der Test-Schlüssel `Web-App/test/fixtures/abruf-test.key` (mit
  `abruf-test.crt`, selbstsigniert, `CN=abruf-test`, SHA-256
  `25:B4:03:BD:C0:2F:3B:87:7B:DC:7F:B6:69:4D:C3:AF:FE:79:C1:42:C9:CE:DD:1E:C1:B2:6C:EF:F7:96:B3:BC`)
  steht seit Commit `227229e` öffentlich in der Historie. Er war nie
  produktiv: Nur zwei Tests (`abruf-helfer`, `gutschein-guthaben-abruf`)
  starten damit einen HTTPS-Server auf `127.0.0.1` und reichen das Zertifikat
  ihrem eigenen Client als `ca` — kein Image, kein Truststore, keine
  Konfiguration enthält es. Trotz der Namen im Zertifikat (`localhost`,
  `cdn.rebrickable.com`, `example.org`) ist es öffentlich und darf nirgends
  als vertrauenswürdig eingetragen werden; ein Gerät, das es zeigt, wird
  getäuscht. Die Historie bleibt unverändert.
- PDF.js lädt ohne eval (`isEvalSupported: false`) und ohne Skripte im PDF;
  die ausgelieferten Dateien enthalten weder `eval(` noch `new Function(` —
  `pdf-zoom`, `pdfjs-fassung`.
- PDF.js als `pdfjs-dist` mit exakter Fassung; `public/vendor/pdfjs/` ist eine
  beim Bauen geschriebene, byte-gleiche Kopie — `pdfjs-fassung`. Als
  devDependency fehlt es in `npm audit --omit=dev`; web-ci.yml prüft es
  deshalb zusätzlich im vollen `npm audit`.
- Build-Kontext ohne `.env`, `backups/`, `schluessel/`, `data/` — `dockerfile`.
- Der Entrypoint richtet als root nur `/app/data` selbst (`chown -h`); die
  Unterordner legt er als `brickinv` an, die Marke schreibt er als
  `brickinv`, und der Reparaturschritt (`find -xdev … -exec chown -h`) folgt
  keinem Symlink des Dienstes und bleibt im Datenträger — `entrypoint-start`.
- `docker-publish.yml`: Ein Image entsteht nur aus einem Commit mit grüner
  CI, auch beim Handstart (nur `main`, grüner Lauf von `web-ci.yml` auf genau
  diesem Commit, sonst Abbruch); Hochladen und Signieren laufen in der
  Umgebung `docker-hub` mit Freigabe. Der Tag beim Handstart nur über `env`
  und in Docker-Tag-Form — `workflow-tag`.
- Checkouts ohne gespeicherte Zugangsdaten (`persist-credentials: false`),
  ausser in den zwei Jobs, die einen Zweig pushen — `workflow-ort`.
- `su-exec` im Laufzeit-Image mit fester Fassung — `dockerfile`.
- `.github/workflows/sicherheit.yml`: CodeQL (TypeScript, Kotlin), Trivy
  (Abhängigkeiten, Image), ZAP-Baseline gegen den Produktionsserver. Die
  fremden Images aus `compose.yaml` (Postgres) liest der Lauf aus der Datei
  und prüft sie mit Trivy; eine behebbare Lücke ab high ist rot, ausser sie
  steht mit Ablaufdatum in `.github/trivy-betrieb.ignore`. Caddy baut
  `Dockerfile.caddy`; der Job `trivy-eigenbau` prüft das Ergebnis ohne
  Ausnahmen. Ein Digest, der hinter seinem Tag zurückliegt, wird gemeldet —
  `workflow-ort`, `compose-betrieb`.
- `docker-publish.yml` baut ohne Cache (`no-cache: true`): Den GHA-Cache auf
  `main` beschreibt auch die CI mit allen Entwicklungspaketen. Vor `cosign
  sign` prüft Trivy den veröffentlichten Digest; `web-ci.yml` prüft nach
  `npm ci` die Registry-Signaturen (`npm audit signatures`) — `workflow-ort`.

## Betrieb

- App und Jobs verbinden sich als `brickinventory_app` ohne
  Superuser-, CREATEROLE- oder CREATEDB-Recht und ohne Mitgliedschaft in
  `pg_execute_server_program` & Co.; die Rolle besitzt Datenbank, Tabellen und
  Funktionen (Migrationen). Den Superuser kennen nur Postgres und der
  einmalige Dienst `db-rolle` (`postgres/app-rolle.sh`). Läuft die App doch als
  Superuser, warnt der Start — `db-rolle-db`, `compose-haertung`.
- `db-rolle` läuft als Superuser in einer Datenbank, die der App-Rolle gehört.
  Deshalb fester `search_path=pg_catalog,pg_temp` und `role=none` schon beim
  Verbinden (PGOPTIONS), nur `pg_catalog.`-Funktionen, zuerst
  `ALTER DATABASE … RESET ALL` und `ALTER ROLE <app> … RESET ALL`; bei aktiven
  Event-Triggern bricht es ab — `db-rolle-db` (stellt den Angriff mit eigenem
  `set_config` und Operator nach). Wer selbst als Superuser `psql` in dieser
  Datenbank öffnet, setzt `PGOPTIONS='-c search_path=pg_catalog,pg_temp'`.
- `scripts/restore.sh` spielt den Dump als App-Rolle ein, in einer
  Transaktion; Funktionen und Prüfregeln aus dem Dump laufen nie als
  Superuser — `backup-restore-db`.
- Sitzungsgeheimnis und alle Datenbankpasswörter nur als Docker-Secrets
  (`./geheimnisse/`, Ordner 700, `scripts/geheimnisse-einrichten.sh`), kein
  Dienst bekommt sie als Umgebungsvariable (`docker inspect`) —
  `compose-geheimnisse`, `geheimnisse-einrichten`, `db-rolle-db`. Klartext
  nur als bewusste Ausnahme (Port 3000 in `compose.yaml` einkommentieren,
  `COOKIE_SECURE=0`).
- `caddy/data/` mitsichern und wie ein Passwort behandeln (Schlüssel der CA).
- Postgres hängt nur im internen Netz `db-net` (ohne Weg nach draussen),
  schreibt nur in Daten und Socket (`read_only`); jedes tmpfs ist `noexec`,
  `nosuid`, `nodev` und begrenzt; jeder Dienst schreibt sein Docker-Protokoll
  mit `driver: local`, höchstens 5 × 10 MB — `compose-betrieb`.
- Ohne `NODE_ENV` gelten alle Regeln des Betriebs (Startverbote, Superuser-
  Verbot, verborgene 5xx-Texte, sicheres Cookie); nur `development` und
  `test` lockern sie — `betrieb-ohne-node-env-db`.
- Der Datenschlüssel lässt sich wechseln (`scripts/datenschluessel-wechseln.sh`,
  `DATA_KEY_ALT_FILE`); der Start schreibt alles mit dem neuen neu —
  `datenschluessel-wechsel-db`.
- Gelöschte Konten verschwinden auch aus den Kopien `vor_migration_*`; diese
  verfallen nach 30 Tagen, das Verwaltungsprotokoll nach einem Jahr —
  `konto-loeschen-spuren-db`. Sicherungen enthalten Sitzungen,
  Anmeldezähler und Protokollzeilen nicht — `backup-restore-db`.
- Kein Datenbank-Werkzeug im Browser: pgweb (Debian 11 ohne Pflege) ist
  entfernt — `compose-betrieb`. Zum Nachsehen dient `psql` als Leserolle
  `brickinventory_lesen` im Postgres-Container. Die Leserolle liest nur eine
  Allowlist je Tabelle (`LESEN_SPALTEN` in `postgres/app-rolle.sh`): eine neue
  Tabelle oder Spalte bleibt unlesbar, bis sie dort steht; Tokens, Sitzungen,
  Passwort-Hashes, TOTP, Einstellungswerte und Gutschein-PINs stehen nicht
  darin — `db-rolle-db`.
- `scripts/restore.sh` entpackt ein data-Archiv nur, wenn es aus Dateien und
  Ordnern unter `data/` besteht (`scripts/archiv-pruefen.sh`) — `restore-archiv`.
- Container ohne Capabilities ausser den nötigen, `read_only`,
  `no-new-privileges`, und mit Grenzen für Speicher, Prozesse und CPU
  (`mem_limit`, `pids_limit`, `cpus`) — `compose-grenzen-schluessel`.
- Den Datenschlüssel legt der Einmal-Dienst `schluessel` an
  (`schluessel-anlegen.sh`, ohne Netz); app und jobs sehen ihn nur lesend —
  `compose-grenzen-schluessel`. Getrennt von `data/` sichern, sonst sind
  Geheimnisse und Gutschein-PDFs einer Sicherung nicht lesbar.
- Der Server liest Geheimnisse aus Dateien (`SESSION_SECRET_FILE`,
  `PGPASSWORD_FILE`, `DATABASE_URL_FILE`, `ADMIN_PASSWORD_FILE`) —
  `geheimnis-dateien`.
- Sicherungen immer mit age an öffentliche Schlüssel verschlüsselt
  (`./backup-empfaenger.txt`), ohne Klartext daneben; ohne Empfänger keine
  Sicherung, ausser mit ausdrücklichem `BACKUP_KLARTEXT=ja`. Der private
  Schlüssel liegt nicht auf dem Server — `backup-verschluesselt`.

## Bekannte Restrisiken

- **Erste Kopplung des Wurzelzertifikats**: Wer `/ca.crt` bei der ersten
  Installation auf einem Gerät abfängt, kann eine eigene Wurzel unterschieben.
  Abhilfe ist der Abgleich des Fingerabdrucks mit dem auf dem Server
  (UPGRADE.md §14). Die App ist davon nicht betroffen: Sie bekommt den
  Fingerabdruck über den QR-Code vom angemeldeten Bildschirm.
- **Reichweite der internen CA**: Ein Gerät, das die Wurzel installiert,
  vertraut ihr für jede Adresse. Wer `caddy/data/` (Schlüssel) erbeutet, kann
  diesen Geräten jede Seite vortäuschen. Die App vertraut nur dem gepinnten
  Schlüssel. Die eigene CA aus `scripts/ca-einrichten.sh` ist auf `BRICK_HOST`
  namensbeschränkt; nur mit `CA_OHNE_NAMENSBESCHRAENKUNG=ja` gilt Caddys eigene
  CA für jede Adresse.
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
- **Datenschlüssel auf demselben Rechner**: `schluessel/` liegt neben `data/`.
  Wer den ganzen Rechner hat, hat auch die Geheimnisse; nur eine Sicherung von
  `data/` allein gibt sie nicht preis.
- **Mehrere erbeutete Zugänge**: Die Bremsen gelten je Sitzung bzw.
  Token-Familie. Wer mehrere Sitzungen desselben Kontos erbeutet, rät in jeder
  5 Codes je Stunde. Einen neuen Zugang prägt nur, wer den zweiten Faktor
  hat. Bei der Anmeldung zählen falsche Codes in die Anmeldebremse je
  Adresse und Konto.
- **Geheimnisse auf demselben Rechner**: `./geheimnisse/` ist nur für seinen
  Besitzer offen; wer root auf dem Server ist, liest sie trotzdem.
- **Anfrage-Raten am Rand**: Caddy begrenzt bei den Anmeldewegen nur Grösse
  und Tempo des Rumpfs, weder gleichzeitige Anmeldungen noch Raten je Adresse.
  Die Zahl gleichzeitiger Passwortprüfungen begrenzt der Server (Schranke mit
  Vorrang bekannter Anmeldungen, 503 bei Überlast); eine Flut verlangsamt die
  Anmeldung für alle, statt den Server zu belegen.
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
- **Bilder der Container** (`postgres`, die Basis von `Dockerfile.caddy`, ZAP)
  sind per Digest fest und veralten damit; Renovate schlägt neue Fassungen vor
  (ZAP und die Dienst-Container der Workflows nicht). Eine hingenommene Lücke
  in `postgres` steht mit Ablaufdatum in `.github/trivy-betrieb.ignore`; Caddy
  prüft der Job `trivy-eigenbau` ohne Ausnahmen.
