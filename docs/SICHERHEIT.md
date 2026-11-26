# Sicherheit der Web-App

Kurzes Bedrohungsmodell für `Web-App/`. Pfade sind relativ zu `Web-App/`,
Tests liegen unter `Web-App/test/`. Die Begründungen stehen im Code und in
den Commits, nicht hier.

## Werte

| Wert | Wo |
|---|---|
| Konten, Passwort-Hashes (argon2id, alte noch bcrypt), Sitzungen, API-Tokens (gehasht), Passkeys (öffentliche Schlüssel) | PostgreSQL |
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

**Was der Zeilenschutz nicht leistet.** Die Zeilenregeln folgen `app.konto`, und
das kann jede Rolle per `set_config()` umsetzen (Migration 0112). Sie fangen
deshalb **vergessene Filter** ab — eine Abfrage ohne Bedingung auf `user_id` —,
aber kein eingeschleustes SQL: Eine eingeschleuste Anweisung, die das Konto selbst
umsetzt, liest danach das andere Konto; in einer Transaktion mit mehreren
Anweisungen (`einmaligeTransaktion`, `db/database.ts`) gilt das Umsetzen auch für
die folgenden. Eine Prüfung von `app.konto` vor dem COMMIT hälfe nicht: Gelesenes
ist dann gelesen, und die Anweisung kann das Konto vorher zurücksetzen. Gegen
eingeschleustes SQL schützen gebundene Parameter (kein SQL aus Zeichenketten der
Eingabe) und die Rollenrechte: Die Laufzeitrolle liest weder Passwort-Hashes noch
Sitzungen (0115), keine Adressen und Links in `users` (0121) und schreibt weder
Passwort noch Verwalterrecht (0117). In `users` sieht sie nur das eigene Konto und
den Haushalt, in `account_links` nur Verknüpfungen mit dem eigenen Konto (0121) —
`accounts-rows-protection-db`.

**Zwei Systemrollen.** Den Zeilenschutz heben zwei Rollen auf (`BYPASSRLS`):
`brickinventory_system` hält nur der Dienst `jobs` (Aufträge, Umschlüsselung,
Aufräumen über alle Konten). Der Web-Prozess hat nur
`brickinventory_system_web`; Migration 0119 gibt ihr
- volle Zeilenrechte auf Zugang und Verwaltung (`users`, `user_sessions`,
  `api_tokens*`, `passkeys`, `webauthn_challenges`, `zweiter_faktor*`,
  `qr_login_tokens`, `geraete_*`, `schritt_*`, `rate_limit_attempts`,
  `account_links`, `account_link_invites`, `household_former_links`,
  `verwalter_uebernahmen`, `global_settings`), auf `user_settings` (Sprache einer
  Mail vor der Anmeldung, Währung des ganzen Haushalts) und auf `auftraege`
  (einstellen, vorziehen, abbrechen);
- `verwaltungsprotokoll` nur lesen und anfügen;
- volle Zeilenrechte auf Tabellen ohne Kontobezug (Katalog, Preis- und
  Bildspeicher, Laufzustand), die auch die Laufzeitrolle hat;
- aus dem Bestand nur Nummern ohne Konto (`sets.set_number`,
  `parts.part_number`/`source`, `minifigs.fig_number`) für die Übersichten der
  Verwaltung, dazu den Stand je Konto (`parts_version_user`), den Trigger beim
  Löschen eines Kontos hochzählen;
- zwei Funktionen der Eigentümerin: `konten_mit_set()` (nur die Zahl der Konten
  mit einem Set) und `konto_aus_sicherungen_loeschen()` (ein gelöschtes Konto
  auch aus den Kopien vor Migrationen).

Gutscheine, Kaufpreise, Sammlung, Papierkorb, Merkliste, Preisalarme,
Teilezusammenfassungen, Importe, Idempotenz und die Kopien vor Migrationen
erreicht sie nicht. Fehlt in einem Systemrahmen einer Anfrage ein Filter, bleibt
der Fehler auf diese Tabellen beschränkt. `test/systemrolle-web-db.test.js` hält
die Liste fest; alle Tests über `testServer` laufen mit dieser Rolle.

**Codeausführung im Prozess.** Wer im Web-Prozess Code ausführt (eingeschleuste
Abhängigkeit, RCE), hat Laufzeit- und Web-Systemrolle. Über `app.konto` liest er
mit der Laufzeitrolle trotzdem jedes Konto der Reihe nach, Gutscheine
eingeschlossen; Passwörter, Verwalterrecht und Sitzungen ändert er über die
Web-Systemrolle. Die engere Rolle begrenzt Logikfehler, keine Codeausführung.
Wer Code im Dienst `jobs` ausführt, hat die volle Systemrolle. Dagegen helfen nur
Lieferkette, Container-Härtung (ohne root, schreibgeschützt) und die getrennte
Migrationsrolle, die keinem Prozess der App gehört. Das Verwaltungsprotokoll ist
für beide Systemrollen nur anfügbar: Eine Spur lässt sich so nicht nachträglich
tilgen.

Ein echter Gewinn gegen Codeausführung verlangte, dass die Datenbank das Konto
selbst nachweist — `app.konto` nur über eine Funktion, die einen Sitzungs- oder
Token-Hash gegen die Tabelle prüft, Verwaltungsrechte daraus abgeleitet,
Anmeldung als Funktion, die nur das Konto zum passenden Nachweis liefert. Das ist
ein Umbau der Datenbankschicht und der Anmeldung, kein Rechteschnitt; selbst dann
handelte der Prozess für jede gerade aktive Sitzung.

5. **Lieferkette** — npm-Pakete, Actions, Container-Images, fremde
   Antworten von Rebrickable, Brickset, LEGO.

## Schutzmaßnahmen

### Transport (1)
- HTTPS als Standard: Caddy vor der App, die App veröffentlicht keinen Port;
  Port 80 leitet nur um, `/ca.crt` gibt es nur über HTTPS (nach einmal
  bestätigter Warnung, Abgleich des Fingerabdrucks): `compose.yaml`,
  `Caddyfile`, `routes/certificate.ts` — `compose-haertung`, `tls-root-db`.
- Keine CA ohne Namensbeschränkung als stiller Rückfall: Caddy startet nur mit
  eigener, auf `BRICK_HOST` beschränkter CA (`scripts/setup-ca.sh`), mit
  `BRICK_TLS=acme` (öffentlicher Name) oder ausdrücklich mit
  `CA_OHNE_NAMENSBESCHRAENKUNG=ja`; ohne Aussteller aus dem Startskript ist
  das Caddyfile ungültig. Das Protokoll von Caddy und `setup-ca.sh`
  nennen den SHA-256-Fingerabdruck der Wurzel zum Abgleich auf dem Gerät —
  `ca-own-root`.
- Anmeldewege (Passwort, Passkey, QR, Registrierung, Rücksetzen) nehmen an
  Caddy Rümpfe bis 16 KB an und gehen ohne Verbindungsgrenze an die App: Die
  Zahl gleichzeitiger Passwortprüfungen begrenzt die Schranke des Servers
  (`src/account/bcryptLimit.ts`, Vorrang bekannter Anmeldungen, sonst 503),
  die Raten je Adresse und Konto zählt der Server — `caddy-login-brake`,
  `bcrypt-limit-db`.
- Passwörter als argon2id (19 MiB, 2 Durchläufe, OWASP-Vorgabe:
  `src/account/passwordHash.ts`); ein alter bcrypt-Hash gilt, bis die nächste
  Anmeldung ihn ersetzt — `password-argon2-db`. bcrypt rechnet dafür in
  höchstens 4 Worker-Threads (weniger bei kleinerem cgroup-Kontingent, mehr
  mit `BCRYPT_WORKERS`); untätige enden nach 60 s — `bcrypt-pool`.
- Langsame Clients erreichen die App nicht: Caddy liest den Rumpf der
  Anmeldewege ganz (`request_buffers 32KB`, grösser als `max_size`), bevor er
  ihn weiterreicht; Köpfe müssen in 10 s da sein. Die App
  selbst: Kopf 15 s, ganze Anfrage 5 min (Uploads), ohne Anmeldung Rumpf
  10 s (sonst 408 `anfrage_zu_langsam`): `Caddyfile`, `server.ts`,
  `rumpfFrist` in `routes/api/middleware.ts` — `caddy-login-brake`,
  `security-server-limits-db`.
- Die Wurzel signiert die Blätter (`sign_with_root`) und steht in der
  ausgelieferten Kette; die App pinnt ihren SPKI-Fingerabdruck aus dem QR-Code
  (`fp`): `src/infra/tlsRoot.ts`, `routes/auth.ts` — `tls-root-db`.
- `TRUST_PROXY` nennt genau Caddy; dahinter Cookie mit `Secure` und HSTS:
  `src/infra/config.ts` (`cookieSicher`), `server.ts` — `tls-root-db`, `hsts`.
- Die Schlüssel der CA bleiben bei Caddy: Die App sieht den Ordner nur lesend
  und als Nicht-root nur die vom Entrypoint kopierte Wurzel.

### Anmeldung und Sitzung (2, 3)
- „Passwort ≠ Benutzername“ gilt auch beim Ändern mit App-Token und beim
  Setzen durch den Verwalter (Name aus der Tabelle) — `password-rule-db`.
- „Andere Sitzungen beenden“ verlangt das Passwort (und bei aktivem TOTP den
  Code): Eine erbeutete Sitzung sperrt den Inhaber nicht aus — `web-without-token-db`.
- Bremsen der erneuten Bestätigung je Konto **und** Zugang (Sitzung, gehasht,
  oder Token-Familie über `created_at`, das der Tausch erbt): Fehlversuche aus
  einer erbeuteten Sitzung sperren weder „andere beenden“ noch den
  Passwortwechsel des Inhabers. Falsche Codes zählen in einem eigenen Zähler
  (5 je Stunde), den nur ein richtiger Code löscht; ein richtiges Passwort
  setzt ihn nicht zurück: `src/account/passwordConfirmation.ts`,
  `src/account/loginLimiter.ts` — `confirmation-brakes-db`.
- Kein Passwort-Orakel für gesperrte und unbestätigte Konten: Sie bekommen bei
  richtigem Passwort dieselbe 401 `anmeldedaten_ungueltig` wie bei falschem
  (gezählt als Fehlversuch). Einen neuen Bestätigungslink gibt
  `POST /auth/bestaetigung-erneut` mit gleicher Antwort und Dauer für jede
  Adresse — `account-deactivate-db`. **Ausnahme, bewusst:** Bei aktivem zweitem
  Faktor antwortet ein richtiges Passwort ohne Code mit 401
  `zweiter_faktor_noetig` (ohne Fehlversuch), ein falsches mit
  `anmeldedaten_ungueltig` — die Absage verrät also, dass das Passwort stimmte.
  Weiter kommt man damit nicht: Nach 20 falschen Codes in 24 Stunden gelten nur
  noch Wiederherstellungscode und Passkey, und der Inhaber erfährt es per Mail (`src/account/loginCheck.ts`) —
  `second-factor-db`.
- Sperre je Adresse und je Konto mit wachsender Wartezeit:
  `src/account/loginLimiter.ts` — `login-lock-db`, `ip-throttle-parallel-db`.
- Tagesgrenze: Nach 50 Fehlversuchen in 24 Stunden gilt das Passwort nur noch
  mit zweitem Faktor. Unbekannte Adressen zählen gemeinsam, jede bekannte
  Adresse (dort zuletzt erfolgreich angemeldet, 30 Tage) für sich; ein Fremder
  sperrt den Inhaber so nicht an seinen Geräten aus. „Passwort vergessen“ leert
  alle Zähler. Ohne zweiten Faktor bekommt der Inhaber für einen gesperrten neuen
  Ort einen signierten, einmal gültigen Link, der diese Adresse einen Tag lang wie
  eine bekannte zählen lässt (je Adresse eine Mail pro Stunde, zehn am Tag):
  `src/account/loginLimiter.ts` — `login-daily-limit-db`.
- Sitzung: `httpOnly`, `sameSite=strict`, `secure` hinter TLS, Leerlauf- und
  Höchstdauer, neue Sitzungs-ID beim Anmelden: `src/account/sessionDeadline.ts`,
  `src/account/accessEnd.ts` — `session-idle-db`, `session-max-duration`, `session-app-db`, `auth-sessions-db`.
- Passwortwechsel und Kontolöschung beenden Sitzungen und Tokens —
  `auth-sessions-db`, `token-runtime-db`.
- Beendete Sitzungen bleiben beendet: Jede Sitzung trägt
  `users.sitzungs_version` von der Anmeldung; wer Zugänge beendet (Passwort,
  Sperre, Rolle, Löschen, „andere beenden“, 2FA eingeschaltet), erhöht sie,
  jede Anfrage vergleicht (5 s Zwischenspeicher je Konto, den eine Erhöhung in jedem
  Web-Prozess über NOTIFY sofort leert; ohne Horch-Verbindung keiner). Eine von einer
  laufenden Anfrage zurückgeschriebene Zeile gilt damit nicht mehr:
  `src/account/sessionVersion.ts` — `session-version-db`, `session-version-processes-db`.
- Drosseln je Adresse zählen ein IPv6-/64 als eine Adresse, IPv4 in IPv6 als
  IPv4: `drosselAdresse` in `src/account/loginLimiter.ts` — `throttle-ipv6-db`.
- App-Anmeldung: Token mit fester Höchstdauer 180 Tage ab Anmeldung, die der
  Tausch erbt — `token-scope-rotation-db`.
- Tokens mit Scope: `app` hat nie Verwalterrechte, QR-Codes geben nur `app`;
  Verwalterrouten verlangen Sitzung oder Scope `voll`. Gleitender Ablauf
  (90 Tage), Tausch über `/auth/token-rotieren` mit 5 min Überlappung;
  „unbegrenzt“ nur über HTTPS und mit Tauschpflicht nach 60 Tagen;
  Geräteliste mit Scope, Netz und Ablauf: `src/account/deviceToken.ts` —
  `token-scope-rotation-db`, `token-gleitfrist-db`.
- Passkeys (WebAuthn) ohne Passwort und als zweiter Faktor; Challenge nur
  einmal gültig, Zähler, Herkunft aus `APP_BASE_URL`: `src/factors/passkeys.ts` —
  `passkeys-db`. TOTP: `src/factors/secondFactor.ts` — `second-factor-db`.
- Schrittschutz der App: Den Geräteschlüssel nimmt der Server nur mit Android
  Key Attestation an (`src/devices/attestation/`): Kette bis zu Googles Wurzel,
  kein Glied auf Googles Widerrufsliste, Schlüssel im TEE oder StrongBox mit
  Gerätesperre bei jeder Benutzung, gesperrter Bootloader und verifizierter
  Start (RootOfTrust `deviceLocked`, `verifiedBootState = Verified`), auf Wunsch
  ein Mindest-Patchstand (`ATTESTATION_PATCH_MINIMUM`). Die Liste lädt der
  Job-Prozess alle sechs Stunden (Auftrag `widerrufsliste`); fehlt sie oder ist
  sie älter als `ATTESTATION_REVOCATION_DAYS` (7), nimmt der Server keinen neuen
  Schlüssel an, statt ungeprüft anzunehmen (UPGRADE.md §60) —
  `devices-attestation`, `step-protection-db`, `attestation-revocation-list-db`.
- Kein Weg am zweiten Faktor vorbei: Es gibt genau einen Bestätigungsweg,
  `bestaetigeMitFaktor` (`src/account/http/login.ts`). Bei aktivem TOTP
  verlangt er immer Code oder Passkey-Antwort, auch mit dem
  Verwalterpasswort; fehlt beides, 400 `zweiter_faktor_noetig` ohne Zählung.
  Jede Route, die einen Zugang prägt oder Schutz abbaut, trägt im API-Vertrag
  `bestaetigung` (token-create, qr-token, Passkey anlegen/löschen, alle
  Verwalterrouten an Konten, `DELETE /bestand`, andere beenden, Passwort,
  E-Mail, 2FA abschalten, Haushalt beitreten, SMTP). Der Wächter
  `confirmation-contract-db` ruft jede markierte Route ohne und mit falschem
  Code, verlangt die Marke für jede Passwort-Eingabe des Vertrags und lässt
  `bcrypt.compare` nur im Pool und `@node-rs/argon2` nur in
  `src/account/passwordHash.ts` zu (Vergleich nur über `passwortPasst`); eine Route ohne Marke,
  die bestätigt, antwortet in Tests mit 500. Den Notausgang des Verwalters
  (`DELETE /auth/users/:id/zweiter-faktor`) gibt es nur für fremde Konten.
  Eine neue E-Mail gilt auch beim Verwalter erst nach dem Link als bestätigt
  — `second-factor-sensitive-db`, `passkeys-db`, `household-join-db`.
- Hinweis-Mails bei neuem App-Token und QR-Zugang (Inhaber), neuem Verwalter
  und vom Verwalter entferntem zweitem Faktor (alle Verwalter, das Konto
  selbst): `src/account/accountNotice.ts` — `access-hint-db`.
- Wiederherstellungscodes: 80 Bit, als HMAC mit Teilschlüssel des
  Datenschlüssels und an das Konto gebunden — `second-factor-db`. Codes von vor
  dem 01.11.2026 (50 Bit, SHA-256) gelten nur noch 90 Tage ab dem Update (0122);
  wer einen benutzt, bekommt eine Mail — `old-recovery-codes-db`.
- Verwalter gegen Verwalter: Passwort setzen, zweiten Faktor entfernen,
  deaktivieren, Rolle entziehen und löschen gelten erst nach 24 Stunden, mit Mail an
  das Ziel und alle Verwalter. Das Ziel bricht ab durch Anmeldung (Passwort,
  Passkey, QR-Abholung) oder über den einmal gültigen Link in seiner Mail; eine
  fällige Übernahme entfällt, wenn das Ziel inzwischen deaktiviert wurde:
  `src/account/adminActions.ts` — `admin-takeover-db`.
- AES-GCM nur mit vollem 16-Byte-Tag: `src/infra/secret.ts` — `secret-tag-length`.
- Passwort zurücksetzen widerruft Tokens, Sitzungen und alle Passkeys und löst
  ausserdem, was ein Eindringling angelegt haben könnte: die Verknüpfung mit
  Hauptkonten über diesem Konto (der Haushalt nach oben), offene
  Haushaltseinladungen und eine ausstehende Adressänderung; die Hinweis-Mail
  nennt, was wegfiel (`setzePasswortZurueck` in `src/account/accounts.ts`) —
  `password-forgotten-foreign-access-db`. Der Wechsel widerruft Passkeys auf
  Wunsch der API (`passkeys_widerrufen`); die Oberfläche belegt das Häkchen vor. Hinweis-Mail bei neuem Passkey und bei
  Passwortwechsel/-rücksetzung, mit den Konten, die die Sammlung sehen —
  `passkeys-db`.
- „Passwort vergessen": ein Link je Konto und 15 Minuten, gleiche Antwort
  und Mindestdauer für bekannte und unbekannte Adressen; Links nur aus
  `APP_BASE_URL`, nie aus Kopfzeilen — `forgot-password-db`.
- Startpasswort (`must_change_password`): bis zum Wechsel nur
  `change-password`, `logout` und `POST /geraet/schluessel` (der
  Geräteschlüssel der App, den der Server nur gleich nach der Anmeldung
  annimmt), sonst 403 `passwort_wechsel_noetig`: `VOR_DEM_WECHSEL` in
  `routes/api/middleware.ts` — `password-required-switch-db`, `step-protection-db`.
- Benutzernamen ohne Rücksicht auf Gross-/Kleinschreibung eindeutig
  (Index, Migration 0090) — `account-create-db`.
- „Alle meine Daten löschen" nur mit Passwort — `everything-delete-household-db`.
- Mailadressen stehen im Protokoll nur maskiert — `household-join-db`.
- In Produktion kein Start mit Beispiel-`SESSION_SECRET` oder
  Beispiel-Datenbankpasswort: `server.ts`, `src/infra/config.ts` (`startVerbote`) — `startverbot`.
- `/api/v1/startup-status` nennt Schritt und Unterstand nur angemeldet — `gesundheit-db`.

### Herkunft der Client-Adresse (1)
- `TRUST_PROXY` vertraut nur ausdrücklich genannten Adressen oder kleinen
  Netzen; Vorgabe Loopback, `docker`/`true`/Hop-Zahlen verweigern den Start:
  `src/infra/proxyTrust.ts` — `login-lock-db`, `proxy-hint`, `startverbot`.
- `compose.yaml`: festes Netz `172.28.73.0/24`; ein Reverse-Proxy bekommt
  darin eine feste Adresse, und genau die steht in `TRUST_PROXY` — `compose-haertung`.

### CSRF (2)
- Ändernde Anfragen: `Sec-Fetch-Site`, sonst `Origin`/`Referer` gegen Host
  und `APP_BASE_URL`; Cookie-Sitzung ohne Herkunft wird abgelehnt, Bearer
  ohne Cookie ausgenommen: `src/http/origin.ts` — `origin`.
- Die App antwortet nur unter dem Namen aus `APP_BASE_URL` (sonst 421
  `fremder_host`), gegen DNS-Rebinding im Klartextbetrieb; ohne
  `APP_BASE_URL` (nur mit `APP_BASE_URL_MISSING_OK=1`) unter keinem Namen. Frei
  bleiben Loopback, IP-Adressen, `/ca.crt` und die Gesundheitspfade:
  `nurEigenerHost` in `src/http/origin.ts` — `security-server-limits-db`, `origin`.
- E-Mail-Bestätigung erst per Knopf: `GET /verify` zeigt die Seite,
  `POST /auth/email-bestaetigen` bestätigt; ein Link-Scanner bestätigt nichts
  — `security-server-limits-db`.

### Zugriff auf fremde Daten (3)
- Jede Abfrage über `scopeIds()`/`writableIds()` (Haushalt):
  `src/household/household.ts` — `entry-foreign-delete-db`, `vouchers-db`, `pdf-jobs-db`.
- Uploads nur für Besitzer und Hauptkonto: `routes/dataFiles.ts` — `data-files-db`, `media-auth`.
- Kaufpreis umhängen: Eine fremde Erfassungs-ID antwortet wie eine fehlende
  (404 `kaufpreis_nicht_gefunden`), kein Orakel für vergebene IDs:
  `acquisitionMoveSource` in `src/household/household.ts` — `security-server-limits-db`.
- Set-Bilder (`/images/sets/…`) nur im Blickfeld (Bestand, Merkliste,
  Preisalarme des Haushalts), Anleitungen (`/data/instructions/…`) nur zu Sets
  im Bestand; fremd und fehlend antworten gleich (404). Teile- und
  Figurenbilder sind Katalog. Katalog, `/sets/info` und `/sets/barcode` nennen
  `image_local` nur im Blickfeld: `src/images/imageScope.ts` —
  `image-scope-db`, `catalog-images-db`.
- Teile-Import (`POST /sets/:setNumber/parts`) nur für Sets im Blickfeld, für
  deren Besitzer: `routes/api/sets.ts` — `parts-import-ownership-db`.
- Die Haushaltswährung stellt nur das Hauptkonto (Unterkonto: 403
  `waehrung_nur_hauptkonto`) und nur für seinen Haushalt abwärts; hängt ein
  Unterkonto auch an einem fremden Hauptkonto mit anderer Währung: 409
  `waehrung_geteiltes_unterkonto`: `src/settings/userSetting.ts` — `household-currency-db`.
- Gutscheine nie über den Haushalt, auch nicht für Verwalter — `vouchers-db`.
- Datenbankrechte nach Rolle (Migration 0117, `postgres/app-role.sh`): Die
  Laufzeitrolle schreibt in `users` nur Vor- und Nachname und liest
  `global_settings` nur; Passwort, Verwalterrecht, Adresse, Links,
  Sitzungsversion und globale Einstellungen schreibt nur die Systemrolle.
  `verwaltungsprotokoll` ist für beide nur anfügbar, aufgeräumt wird über eine
  Funktion der Eigentümerin mit fester Frist. Gutscheine und Idempotenzeinträge
  sieht nur das eigene Konto (0118) — `db-role-db`, `rows-protection-db`.

### Gemeinsame Daten (3)
- Bildcache nur aus geprüften Katalogadressen (`bild_von IS NULL`), nie aus
  Angaben des Clients: `src/catalog/pdf/pdfGeneration.ts`, `src/catalog/imageFollowUp.ts` —
  `image-cache-source-db`.
- Setnummer für den Bild-Job nur aus einer reinen Rebrickable-Setadresse:
  `routes/imgProxy.ts` — `image-cache-source-db`.
- Geteilte Anleitungen ersetzen (löschen und neu holen) nur der Verwalter;
  wer das Set hat, holt nur fehlende, einmal je Set und Tag:
  `routes/api/sets.ts` — `instruction-new-load-db`.

### Uploads (4)
- Typ aus dem Inhalt, Endung aus dem MIME-Typ, Name zufällig, Kontingent je
  Konto: `routes/api/sets.ts`, `src/http/fileUpload.ts` — `upload-limits-db`.
- Gutschein-PDF höchstens 2 MB, Entpackgrenze: `src/vouchers/pdfParsing.ts` — `voucher-pdf-bombe-db`.
- Gutschein-PDFs verschlüsselt, Konto löschen entfernt Uploads und
  Gutscheine: `src/vouchers/voucherFiles.ts` — `account-files-db`.

### Abrufe nach aussen (SSRF, 5)
- Die Guthaben-Abfrage bei lego.com geht über `src/infra/fetch.ts`: nur
  `www.lego.com`, auch nach einer Umleitung; ein POST folgt keiner; Antworten
  höchstens 4 MB (Seite) bzw. 512 KB (Abfrage), 20 s — `voucher-balance-fetch`.
- Ein Weg nach draussen: `src/infra/fetch.ts` (`holeHttps`, `oeffneHttps`).
  Nur https, Host-Liste für Start und jeden Sprung, relative `Location`
  aufgelöst, höchstens 5 Umleitungen, Byte-Grenze (angesagt und gezählt),
  Gesamtfrist, `Authorization`/`Cookie` fallen bei Hostwechsel weg; jeder
  Fehler wird Ablehnung, kein Wurf im Antwort-Rückruf. Fehlertexte ohne
  Anfrageteil (dort stehen API-Schlüssel), fremder Antworttext nur gekürzt
  im Protokoll — `fetch-helper` (echter TLS-Server), `redirects` (niemand
  sonst ruft `https.get`/`fetch`), `download-limits`, `img-proxy-size`.
  Hosts exakt (Unterdomänen nur über `*.`-Eintrag, nur bei `lego.com`), nur
  Standardport, keine Userinfo: `hostErlaubt` in `src/infra/foreignAddresses.ts` — `redirects`.
  Ausgenommen sind nur `scripts/loadtest.js` und `scripts/check-api-contract.js`,
  die von der Kommandozeile den eigenen Server rufen.
- Bild-Proxy: Cache-Schlüssel ohne Zeitstempel im Anfrageteil, CDN-Abrufe je
  Konto gedrosselt (`IMAGE_FETCHES_PER_MINUTE`), Cache gedeckelt
  (`IMAGE_CACHE_MAX_MB`), Antworten `Cache-Control: private`:
  `routes/imgProxy.ts`, `src/images/imgCacheServe.ts` — `image-proxy-deckel`.
  Hinaus geht nur ein Bildtyp aus einer Liste (JPEG, PNG, GIF, WebP, AVIF),
  nie der rohe Kopf des CDN; sonst JPEG (`bildTyp`) — `img-cache-serve`,
  `image-proxy-deckel`.
- Nummern als kodiertes Pfadsegment (`pfadSegment`) — `foreign-paths-db`.

### Eingaben (2, 3)
- Teileliste des PDF-Auftrags nach Schema (`PdfEingabe`): höchstens 5000
  Posten, Feldlängen, Menge 1–9999; nur bekannte Felder gehen in den Auftrag
  — `pdf-jobs-db`.
- Rumpf und Abfrage im Betrieb gegen den API-Vertrag, unmittelbar vor der
  Route (`eingabePruefen` in `src/http/contractRouter.ts`): falscher Typ,
  zu langer Text oder wiederholter Abfrageparameter ergeben 400
  `eingabe_ungueltig` — `input-contract-db`. Routen ohne `eingabe` im
  Vertrag prüfen selbst (`src/infra/validate.ts`).
- Vor-/Nachname ohne Steuerzeichen und Webadressen (`nameGueltig`). Mails an
  unbestätigte Adressen (Bestätigung, Rücksetzen, „Name vergeben“) grüssen
  ohne Namen; die Konsole zeigt nur den vom Absender übergebenen Link:
  `src/mail/transport.ts`, `src/mail/mailer.ts` — `mail-foreign-text-db`, `mail-link-console`.

### Ausgabe und Kopfzeilen (2)
- CSP ohne Inline-Skripte, `X-Frame-Options`, `nosniff`, HSTS nur bei
  `req.secure` (also hinter dem vertrauten Proxy), nicht nach einem rohen
  `X-Forwarded-Proto`: `server.ts` — `csp-actions`, `hsts`, `frontend-escaping`.
- Ströme und Sammelberichte (Erfassungsstrom, CSV-/XML-Importe) melden
  Fachfehler mit Code, alles andere als `interner_fehler`; der Text steht nur
  im Protokoll: `oeffentlicherFehler` in `src/infra/error.ts` — `error-text-internal-db`.
- 4xx ohne Code nennen nie den Text einer Bibliothek (Parser, Dateipfad,
  zlib), sondern `anfrage_ungueltig`, `nicht_gefunden` oder
  `anfrage_zu_gross`; eigene Sätze tragen die Klasse `Meldung`:
  `handleRouteError` — `security-server-limits-db`.
- Aktions-Dispatcher kein Skript-Gadget: kein `mouseenter`, je Ereignis nur
  die genutzten Handler, kein Rückfall auf `window`; Löschen, Konto, Tokens
  und Verwaltung nur von Elementen aus dem Markup beim Laden oder aus
  Vorlagen mit `echt()` (Zufallsmarke je Seitenladung):
  `public/js/actions.js`, `public/js/registry.js` — `actions-protection`.

### Protokoll und Kontingente
- Guthaben-Abfrage bei lego.com: zuerst höchstens 20 je Konto und Stunde
  (429 `zu_viele_anfragen`, `grund: konto`), dann eine je 30 s über alle
  Konten; die Pause nach dem Bot-Schutz löst nur eine Abfrage aus, die beide
  Grenzen passiert hat: `src/vouchers/balanceThrottle.ts` —
  `voucher-balance-db`.
- `X-Request-Id` nur aus `[A-Za-z0-9._:-]{1,64}`, sonst eigene Kennung;
  Caddy setzt je Anfrage eine neue: `src/infra/log.ts` — `log`.
- Fremdkontingent: je Nicht-Verwalter ein Viertel, alle zusammen die Hälfte;
  Aufträge zählen beim Konto, das sie eingestellt hat:
  `src/externalSources/apiQuota.ts`, `src/jobQueue/jobs.ts` — `api-quota-account-db`.
- Je Zieladresse (gehasht): Registrierung 3/h (429), „Passwort vergessen“ 3/h
  (still keine Mail): `src/account/targetThrottle.ts` — `mail-foreign-text-db`.
- Prüfung eines Haushaltscodes (`redeem/pruefen`) 30/h je Konto —
  `household-join-db`.
- Jede angemeldete Anfrage zählt in ein Budget je Konto: 600 Einheiten je
  5 Minuten, ein Leseaufruf 1, ein Katalogabruf 5, ein Auftragsstart (PDF,
  Import, Export) 25 und zusätzlich höchstens 20 Aufträge je Fenster; 429
  `zu_viele_anfragen` mit `Retry-After`: `src/http/apiThrottle.ts` —
  `api-quota` (Prozessspeicher, wie die Schranken in
  `src/http/accountLimit.ts`).
- `GET /api/v1/einrichtung/stand` ist ohne Anmeldung erreichbar und nennt nur
  Schalter (Datenbank, APP_BASE_URL, TLS, CA, Konto, Rebrickable), den
  Fingerabdruck der CA und den Download; Konten und Schlüssel stehen nicht
  darin, nach `einrichtung_erledigt` nur noch „erledigt“. Ohne Verwaltersitzung
  fehlen die Basis-URL und das Startpasswort („Konto“ heißt dann nur „es gibt
  eines“): `src/profile/setupStatus.ts` — `setup-status-db`.
- Bestätigungslink: Vor dem Einlösen nennt `POST /auth/email-bestaetigen/vorschau`
  nur den Benutzernamen des Kontos (30/h je Adresse), die Seite und ihr Knopf
  nennen ihn; nennen mehrere offene Registrierungen die Adresse, verweist die
  Mail ohne Namen darauf — `email-new-db`, `email-confirm-browser`,
  `mail-foreign-text-db`.
- Teile-Import 30/h je Konto, leere Rebrickable-Antworten 10 min gemerkt;
  Währungswechsel 5/h je Konto (jeder zieht den Preislauf vor).
- Rumpf höchstens 256 KB, nur der PDF-Auftrag 4 MB (pfadgenau vor dem
  allgemeinen Parser): `server.ts` — `upload-limits-db`.

### Ruhende Daten
- Der Fingerabdruck eines `Idempotency-Key` enthält keine Passwort-, Code-,
  PIN- oder Schlüsselfelder und ist ein HMAC mit eigenem Teilschlüssel des
  Datenschlüssels — `idempotency-secret-db`.
- Geheimnisse und Gutschein-PDFs mit dem Datenschlüssel: `src/infra/secret.ts`
  — `secrets-encrypted-db`, `account-files-db`.
- Mail-Links ohne Token in den Protokollen: `src/mail/transport.ts`.
- Aufbewahrung von Adressen in `rate_limit_attempts` (Anmeldebremsen,
  `src/account/loginLimiter.ts`): Die Zeilen `login|<Adresse>|<Konto>`
  und `login-adresse|<Adresse>` stehen mit der IP (IPv6 als /64)
  im Klartext und werden nach einem Tag aufgeräumt. `login-bekannt|…` (Vorrang
  bekannter Anmeldungen, 30 Tage) und `login-erfolg|…` (1 Tag) tragen statt der
  IP deren HMAC mit eigenem Teilschlüssel des Datenschlüssels, Konten stehen
  als `konto:<id>` oder als HMAC des Namens — `login-known-address-db`.
  Bei der Umstellung verlor jede bekannte Adresse einmal den Vorrang, bis zur
  nächsten erfolgreichen Anmeldung.

### Lieferkette (5)
- Actions per Commit-SHA, Images per Digest — `workflow-location`, `compose-haertung`.
  Dependabot schlägt neue Fassungen vor: Actions, Dockerfiles (auch
  `Dockerfile.caddy`) und die Dienste in `compose.yaml` (`docker-compose`), npm und Gradle
  (`.github/dependabot.yml`), npm und Gradle frühestens drei Tage nach
  Erscheinen (`cooldown`).
- `npm ci --ignore-scripts` aus dem Lockfile (Dockerfile, CI); Install-Skripte
  nur gezielt für die Pakete, die eines haben (`npm rebuild esbuild`) —
  `dockerfile`. `npm audit --omit=dev` ist rot ab `moderate` (web-ci.yml) —
  `build-tooling`.
- Images mit Herkunft (SLSA-Provenance `mode=max`) und Stückliste (BuildKit
  mit per Digest festem Scanner; npm als CycloneDX) am Image, dazu
  `actions/attest-build-provenance` und `actions/attest-sbom` am signierten
  Digest; prüfen mit `cosign verify` und `gh attestation verify` (README) —
  `workflow-location`. Das Caddy-Image (`addict85/brickinventory-caddy`) läuft durch
  dieselben Schritte (Bau ohne Cache, Trivy vor der Signatur, cosign keyless,
  Provenance, Stückliste aus Trivy); compose.yaml nimmt es nur als geprüften
  Digest (`CADDY_IMAGE`, `scripts/check-image.sh`) — `workflow-signature`,
  `image-check`.
- Der Test-Schlüssel `Web-App/test/fixtures/fetch-test.key` (mit
  `fetch-test.crt`, selbstsigniert, `CN=abruf-test`, SHA-256
  `25:B4:03:BD:C0:2F:3B:87:7B:DC:7F:B6:69:4D:C3:AF:FE:79:C1:42:C9:CE:DD:1E:C1:B2:6C:EF:F7:96:B3:BC`)
  steht seit Commit `227229e` öffentlich in der Historie. Er war nie
  produktiv: Nur zwei Tests (`fetch-helper`, `voucher-balance-fetch`)
  starten damit einen HTTPS-Server auf `127.0.0.1` und reichen das Zertifikat
  ihrem eigenen Client als `ca` — kein Image, kein Truststore, keine
  Konfiguration enthält es. Trotz der Namen im Zertifikat (`localhost`,
  `cdn.rebrickable.com`, `example.org`) ist es öffentlich und darf nirgends
  als vertrauenswürdig eingetragen werden; ein Gerät, das es zeigt, wird
  getäuscht. Die Historie bleibt unverändert.
- PDF.js lädt ohne eval (`isEvalSupported: false`) und ohne Skripte im PDF;
  die ausgelieferten Dateien enthalten weder `eval(` noch `new Function(` —
  `pdf-zoom`, `pdfjs-version`.
- PDF.js als `pdfjs-dist` mit exakter Fassung; `public/vendor/pdfjs/` ist eine
  beim Bauen geschriebene, byte-gleiche Kopie — `pdfjs-version`. Als
  devDependency fehlt es in `npm audit --omit=dev`; web-ci.yml prüft es
  deshalb zusätzlich im vollen `npm audit`.
- Build-Kontext ohne `.env`, `backups/`, `schluessel/`, `data/` — `dockerfile`.
- `app` und `jobs` laufen als `brickinv` ohne Capability; `./data` richtet
  vorher der Dienst `daten-rechte` (`data-permissions.sh`) als root ein, ohne Netz
  und mit nur `./data` eingehängt. Er ändert als root nur `/app/data` selbst
  (`chown -h`), legt Unterordner und Marke als `brickinv` an, und der
  Reparaturschritt (`find -xdev … -exec chown -h`) folgt keinem Symlink des
  Dienstes und bleibt im Datenträger — `entrypoint-start`, `compose-haertung`.
- `docker-publish.yml`: Ein Image entsteht nur aus einem Commit mit grüner
  CI, auch beim Handstart (nur `main`, grüner Lauf von `web-ci.yml` auf genau
  diesem Commit, sonst Abbruch); Hochladen und Signieren laufen in der
  Umgebung `docker-hub` mit Freigabe. Der Tag beim Handstart nur über `env`
  und in Docker-Tag-Form — `workflow-tag`.
- Checkouts ohne gespeicherte Zugangsdaten (`persist-credentials: false`),
  ausser in den zwei Jobs, die einen Zweig pushen — `workflow-location`.
- `su-exec` im Laufzeit-Image mit fester Fassung — `dockerfile`.
- `.github/workflows/sicherheit.yml`: CodeQL (TypeScript, Kotlin), Trivy
  (Abhängigkeiten, Image), ZAP-Baseline gegen den Produktionsserver. Die
  fremden Images aus `compose.yaml` (Postgres) liest der Lauf aus der Datei
  und prüft sie mit Trivy; eine behebbare Lücke ab high ist rot, ausser sie
  steht mit Ablaufdatum in `.github/trivy-betrieb.yaml`. Caddy entsteht aus
  `Dockerfile.caddy`; der Job `trivy-eigenbau` prüft das Ergebnis ohne
  Ausnahmen. Ein Digest, der hinter seinem Tag zurückliegt, wird gemeldet —
  `workflow-location`, `compose-operation`.
- `docker-publish.yml` baut ohne Cache (`no-cache: true`): Den GHA-Cache auf
  `main` beschreibt auch die CI mit allen Entwicklungspaketen. Vor `cosign
  sign` prüft Trivy den veröffentlichten Digest; `web-ci.yml` prüft nach
  `npm ci` die Registry-Signaturen (`npm audit signatures`) — `workflow-location`.

## Betrieb

- App und Jobs verbinden sich als Laufzeitrolle `brickinventory_app` ohne
  Superuser-, CREATEROLE- oder CREATEDB-Recht und ohne Mitgliedschaft in
  `pg_execute_server_program` & Co.; sie darf nur Zeilen lesen und schreiben,
  Sequenzen weiterzählen und temporäre Tabellen anlegen (ab PostgreSQL 17
  dazu MAINTAIN für VACUUM/ANALYZE), kein DROP, ALTER oder CREATE. Datenbank,
  Tabellen und Funktionen gehören der Migrationsrolle
  `brickinventory_migration`, deren Passwort nur der einmalige Dienst
  `migration` kennt (Erststart, Migrationen, Restore); Default Privileges geben
  der Laufzeitrolle die Zeilenrechte an jeder neuen Tabelle. Den Superuser
  kennen nur Postgres und der einmalige Dienst `db-rolle`
  (`postgres/app-role.sh`). Läuft die App doch als Superuser, warnt der
  Start — `db-role-db`, `compose-haertung`.
- `db-rolle` läuft als Superuser in einer Datenbank, die der Migrationsrolle gehört.
  Deshalb fester `search_path=pg_catalog,pg_temp` und `role=none` schon beim
  Verbinden (PGOPTIONS), nur `pg_catalog.`-Funktionen, zuerst
  `ALTER DATABASE … RESET ALL` und `ALTER ROLE <app> … RESET ALL`; bei aktiven
  Event-Triggern bricht es ab — `db-role-db` (stellt den Angriff mit eigenem
  `set_config` und Operator nach). Wer selbst als Superuser `psql` in dieser
  Datenbank öffnet, setzt `PGOPTIONS='-c search_path=pg_catalog,pg_temp'`.
- `scripts/restore.sh` spielt den Dump als Migrationsrolle ein, in einer
  Transaktion; Funktionen und Prüfregeln aus dem Dump laufen nie als
  Superuser — `backup-restore-db`.
- Sitzungsgeheimnis und alle Datenbankpasswörter nur als Docker-Secrets
  (`./geheimnisse/`, Ordner 700, `scripts/setup-secrets.sh`), kein
  Dienst bekommt sie als Umgebungsvariable (`docker inspect`) —
  `compose-secrets`, `secrets-set-up`, `db-role-db`. Klartext
  nur als bewusste Ausnahme (Port 3000 in `compose.yaml` einkommentieren,
  `COOKIE_SECURE=0`).
- `caddy/data/` mitsichern und wie ein Passwort behandeln (Schlüssel der CA).
- Postgres hängt nur im internen Netz `db-net` (ohne Weg nach draussen),
  schreibt nur in Daten und Socket (`read_only`); jedes tmpfs ist `noexec`,
  `nosuid`, `nodev` und begrenzt; jeder Dienst schreibt sein Docker-Protokoll
  mit `driver: local`, höchstens 5 × 10 MB — `compose-operation`.
- `migration` hängt ebenfalls nur an `db-net`, `schluessel`, `daten-rechte`
  und `caddy-rechte` laufen ohne Netz. `app`, `jobs` und `caddy` brauchen das
  Internet; den Weg ins Heimnetz sperrt optional eine `DOCKER-USER`-Regel auf
  ihr festes Subnetz (UPGRADE.md, Abschnitt 52) — `compose-haertung`.
- Mehrere Web-Prozesse je Datenbank: Budget je Konto und PDF-Tickets zählen in
  PostgreSQL (`api_budget`, `pdf_tickets`, Migration 0135), Anmelde- und
  Gutscheinbremsen schon vorher; die Kontoschranke schützt bewusst den Speicher
  des einzelnen Prozesses (UPGRADE.md §71) — `web-two-instances-db`.
- Ohne `NODE_ENV` gelten alle Regeln des Betriebs (Startverbote, Superuser-
  Verbot, verborgene 5xx-Texte, sicheres Cookie); nur `development` und
  `test` lockern sie — `operation-without-node-env-db`.
- Der Datenschlüssel lässt sich wechseln (`scripts/rotate-data-key.sh`,
  `DATA_KEY_ALT_FILE`); der Start schreibt alles mit dem neuen neu —
  `data-key-switch-db`.
- Gelöschte Konten verschwinden auch aus den Kopien `vor_migration_*`; diese
  verfallen nach 30 Tagen, das Verwaltungsprotokoll nach einem Jahr —
  `account-delete-traces-db`. Sicherungen enthalten Sitzungen,
  Anmeldezähler und Protokollzeilen nicht — `backup-restore-db`.
- Kein Datenbank-Werkzeug im Browser: pgweb (Debian 11 ohne Pflege) ist
  entfernt — `compose-operation`. Zum Nachsehen dient `psql` als Leserolle
  `brickinventory_lesen` im Postgres-Container. Die Leserolle liest nur eine
  Allowlist je Tabelle (`LESEN_SPALTEN` in `postgres/app-role.sh`): eine neue
  Tabelle oder Spalte bleibt unlesbar, bis sie dort steht; Tokens, Sitzungen,
  Passwort-Hashes, TOTP, Einstellungswerte und Gutschein-PINs stehen nicht
  darin — `db-role-db`.
- `scripts/restore.sh` entpackt ein data-Archiv nur, wenn es aus Dateien und
  Ordnern unter `data/` besteht (`scripts/check-archive.sh`) — `restore-archive`.
- Container ohne Capabilities ausser den nötigen, `read_only`,
  `no-new-privileges`, und mit Grenzen für Speicher, Prozesse und CPU
  (`mem_limit`, `pids_limit`, `cpus`) — `compose-limits-key`.
- Den Datenschlüssel legt der Einmal-Dienst `schluessel` an
  (`create-keys.sh`, ohne Netz); app und jobs sehen ihn nur lesend —
  `compose-limits-key`. Getrennt von `data/` sichern, sonst sind
  Geheimnisse und Gutschein-PDFs einer Sicherung nicht lesbar.
- Der Server liest Geheimnisse aus Dateien (`SESSION_SECRET_FILE`,
  `PGPASSWORD_FILE`, `DATABASE_URL_FILE`, `ADMIN_PASSWORD_FILE`) —
  `secret-files`.
- Sicherungen immer mit age an öffentliche Schlüssel verschlüsselt
  (`./backup-empfaenger.txt`), ohne Klartext daneben; ohne Empfänger keine
  Sicherung, ausser mit ausdrücklichem `BACKUP_KLARTEXT=ja`. Der private
  Schlüssel liegt nicht auf dem Server — `backup-encrypted`.

## Android: Resilienz (MASVS)

Angestrebt ist **MASVS L1 ohne RESILIENCE (Profil „L1“, nicht „R“)**, mit einzelnen
L2-Massnahmen dort, wo Daten des Kontos liegen (sec17 B-N11):

- Keine Root-, Debugger-, Hook- oder Play-Integrity-Erkennung und kein Abgleich
  der eigenen Signatur zur Laufzeit. Die App ist quelloffen und selbst verteilt;
  wer sie auf seinem Gerät untersucht, ist meist ihr Besitzer. Solche Prüfungen
  lassen sich mit Frida oder Magisk umgehen und sperrten Nutzer eigener ROMs aus,
  ohne Daten zu schützen.
- Was sie schützen sollten, liegt an anderer Stelle: Der Server prüft jeden
  Zugriff; Token und lokale Ablagen sind im Keystore bzw. mit einem davon
  umhüllten Schlüssel verschlüsselt, beim Abmelden wird dieser erneuert; Updates
  sind signiert und werden vor der Installation geprüft; PDFs von Dritten
  rendert ein isolierter Prozess.
- R8 verkleinert und benennt um, auch die API-Modelle; Keep-Regeln nur, wo
  Reflexion oder das Framework es verlangen (`Android-App/app/proguard-rules.pro`).

- **MASVS-R wird nicht angestrebt, Play Integrity nicht eingebaut** (Prüfung vom
  14.11.2026, M3): Die App wird nicht über Google Play verteilt; Play Integrity
  bräuchte ein Google-Cloud-Projekt und ein Play-Konto, meldete jede Prüfung an
  Google und schlösse eigene ROMs aus. Was davon für die Daten zählt, prüft der
  Server selbst und nicht umgehbar in der App: Den Geräteschlüssel des
  Schrittschutzes nimmt er nur mit Key Attestation an (TEE oder StrongBox,
  Gerätesperre, App-Paket und Signatur, gesperrter Bootloader und verifizierter
  Start aus RootOfTrust, keine widerrufene Kette, auf Wunsch Mindest-Patchstand;
  siehe „Anmeldung und Sitzung“). Heikle Schritte (Gutschein-PIN, Verwaltung,
  zweiter Faktor) gehen damit nur von einem unveränderten Gerät mit echter App.
  Nicht abgedeckt: Lesen und Ändern auf einem gerooteten oder mit Hooks
  versehenen Gerät ausserhalb dieser Schritte (Anzeige, Bestand) und eine
  Lücke im Gerät selbst, die RootOfTrust nicht verrät.
- **App-Sperre ist ein Sichtschutz der Oberfläche** (N3): Sie verdeckt die App
  nach der gewählten Zeit im Hintergrund und verlangt zum Weitermachen
  Gerätesperre oder Biometrie. Neu installiert mit Displaysperre steht sie auf
  5 Minuten, und die Einrichtung bietet sie an; ein Update stellt nichts um. Sie verschlüsselt nichts zusätzlich und hält
  Hintergrundarbeit (Ausgang, Preisalarm, Widget-Abruf) nicht auf. Die Daten
  schützen der Keystore (Token und Ablagen nur bei entsperrtem Gerät) und der
  Schrittschutz am Server; das Widget verdeckt Beträge, solange die Sperre
  greifen kann. Ist sie eingeschaltet, zeigt die App-Übersicht kein Vorschaubild
  (ab Android 13 `setRecentsScreenshotEnabled(false)`, darunter FLAG_SECURE),
  unabhängig von „Vorschau verbergen“.
- **Release-Signatur** (N5): Der Signierschlüssel liegt als Base64-Secret in der
  GitHub-Environment `release` (`.github/workflows/android-signieren.yml`); dass
  der Inhaber seine eigene Freigabe erteilen darf (`prevent_self_review` aus),
  meldet der Workflow nur als Warnung. Bewusste Entscheidung des
  Ein-Personen-Projekts: Heute gibt eine Person frei. Wie sich das ohne zweiten
  Menschen stärken lässt, steht im nächsten Abschnitt; umgesetzt ist davon nichts,
  der Inhaber entscheidet. Das Restrisiko steht unten („Update der Android-App per
  Sideload“).
- **Erstkontakt und neuer Serverschlüssel unter öffentlicher CA** (Prüfung
  476e4a4, M1; Tiefprüfung A-S-5): Auf Android 11–15 nur mit abgetipptem
  Fingerabdruck aus dem Browser am Rechner, ab Android 16 (CT im System) mit
  einem bewussten Tipp. Caddy behält seinen
  Schlüssel beim Erneuern (`reuse_private_keys`, UPGRADE.md Abschnitt 62), damit
  die Frage selten und auffällig bleibt.
- **Daten auf dem Gerät** (N1, N3): Adresse, Benutzername, Herkunft des Tokens,
  Widget-Zahlen und Abmeldeaufträge liegen unter einem Keystore-Schlüssel, der
  nur entsperrt arbeitet; ein Schlüssel ohne diese Bedingung bleibt nur für Pins
  und den Nutzer-CA-Schalter, weil jede TLS-Verbindung sie braucht. Einzelheiten
  und Begründung: `Android-App/INVARIANTEN.md`, „Daten auf dem Gerät“.

### Release-Freigabe stärken (Anleitung für den Inhaber)

Heute genügt eine Person mit Zugang zum GitHub-Konto, um ein Update zu
veröffentlichen, das jede installierte App annimmt: Sie gibt `release` und
`release-beschreibung` frei, beide Schlüssel liegen als Secret bei GitHub. Drei
Wege machen daraus mehr als eine Hürde; jeder lässt sich einzeln einführen.
Workflow-Änderungen dafür bespricht der Inhaber vorher, sie stehen hier nur als
Vorschlag.

1. **Beschreibungsschlüssel offline (Hardware).** Die App nimmt eine Fassung
   nur mit einer Beschreibung an, die einer der Schlüssel aus
   `Android-App/core-resources/src/main/res/raw/beschreibungs_schluessel.pem` signiert hat
   (ECDSA P-256, SHA-256). Liegt dieser Schlüssel nicht bei GitHub, genügt ein
   erbeutetes Konto nicht mehr.
   - Schlüssel auf einem Token erzeugen, etwa YubiKey (PIV, Slot 9c):
     `ykman piv keys generate --algorithm ECCP256 9c beschreibung.pub.pem`, dann
     `ykman piv certificates generate --subject "CN=BrickInventory Beschreibung" 9c beschreibung.pub.pem`.
     Ohne Token: auf einem Rechner ohne Netz mit
     `openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -aes256 -out beschreibung.pem`.
   - Den öffentlichen Teil **zusätzlich** in `beschreibungs_schluessel.pem`
     eintragen und eine Fassung mit dem bisherigen Schlüssel veröffentlichen. Erst
     wenn die Geräte sie haben, mit dem neuen signieren; danach den alten Block
     und die Secrets `BESCHREIBUNG_SCHLUESSEL`/`BESCHREIBUNG_PASS` entfernen.
   - Signieren je Fassung: Der Job `beschreibung` legt dann statt zu signieren
     `version-daten.json` als Artefakt ab (Workflow-Änderung). Der Inhaber prüft
     Prüfsumme und Inhalt (versionCode, apkSha256 gegen den Lauf), signiert lokal
     — mit Token z. B. `openssl dgst -sha256 -sign "pkcs11:object=Private key for Digital Signature" -provider pkcs11 version-daten.json > beschreibung.sig`,
     offline mit `openssl dgst -sha256 -sign beschreibung.pem` — und lädt
     `version-signiert.json` (Format wie im Workflow: `daten` und
     `beschreibungssignatur` in Base64) an die Release.
   - Vor dem Hochladen gegenprüfen und zusammensetzen:
     `openssl dgst -sha256 -verify beschreibung.pub.pem -signature beschreibung.sig version-daten.json`,
     dann `jq -n --arg d "$(base64 -w0 version-daten.json)" --arg s "$(base64 -w0 beschreibung.sig)" '{daten:$d, beschreibungssignatur:$s}' > version-signiert.json`
     und `gh release upload <etikett> version-signiert.json`. Der öffentliche Teil
     muss als `-----BEGIN PUBLIC KEY-----` (SPKI) in der App stehen; offline liefert
     ihn `openssl pkey -in beschreibung.pem -pubout`.
   - Die Frist bleibt sieben Tage: Auch das Auffrischen braucht dann jede Woche den
     Token. Ohne Auffrischen bietet die App eine neuere Fassung weiter an, warnt aber,
     dass es Neueres geben könnte.
2. **Zweiter Prüfer.** Eine zweite Person (eigenes Konto mit Zwei-Faktor) unter
   *Settings → Environments → release* und *release-beschreibung* als
   *Required reviewer* eintragen und *Prevent self-review* einschalten; der
   Workflow meldet das dann nicht mehr als Warnung. Der zweite Prüfer gibt nur
   frei, wenn Etikett, Commit und Änderungen zu einer angekündigten Fassung passen.
   *Allow administrators to bypass* bleibt aus (der Workflow prüft es).
   - Prüfen: `gh api repos/<besitzer>/<repo>/environments/release --jq '.protection_rules'`
     zeigt `"prevent_self_review": true` und den zweiten Prüfer; dasselbe für
     `release-beschreibung`. Die Warnung „Selbstfreigabe“ im Lauf *APK signieren* fehlt dann.
   - Der zweite Prüfer bekommt Leserecht am Repository, kein Schreibrecht: Er muss
     nur freigeben, nicht pushen; *Deployment branches* bleibt auf `main`.
3. **Haltefenster vor „Latest“.** Die App liest nur die als „Latest“ markierte
   Release. Veröffentlicht der Workflow zunächst ohne diese Marke
   (`gh release create … --latest=false`) und setzt sie erst nach 48–72 Stunden
   von Hand (`gh release edit <etikett> --latest`), bleibt Zeit, eine unerwartete
   Release zu bemerken (GitHub-Benachrichtigung „Releases“ für das Repository
   abonnieren) und sie zu löschen, bevor ein Gerät sie lädt. Nachteil: Ein
   dringender Fix braucht ebenso lang oder einen bewussten Handgriff.
   - Workflow-Änderung: in `android-release.yml` bei `gh release create` `--latest`
     durch `--latest=false` ersetzen.
   - Im Fenster: `gh release download <etikett> -p 'BrickInventory-*.apk' -p version-signiert.json`,
     `sha256sum` des APK mit `apkSha256` aus `daten` (Base64) und mit der Summe im Lauf
     (*Übergabe an das Signieren*) vergleichen; Commit des Etiketts gegen `main` prüfen.
   - Erst dann `gh release edit <etikett> --latest`. Die Frist der Beschreibung läuft
     ab dem Signieren: Bei 72 Stunden Fenster bleiben vier Tage bis zum Auffrischen.
     Bis zur Marke prüft das nächste Etikett seine Fassung gegen die alte „Latest“.

Reihenfolge nach Wirkung: 1 nimmt GitHub den Schlüssel, 2 verlangt einen
zweiten Menschen, 3 gibt Zeit zum Bemerken. Ein Schlüssel in HSM oder Cloud-KMS
für die APK-Signatur bleibt eine Entscheidung über Infrastruktur.

Einzelheiten: `Android-App/README.md`, Abschnitte „Manipulationsschutz“ und
„Daten auf dem Gerät“. Eine Änderung dieser Entscheidung gehört hierher.

## Bekannte Restrisiken

- **Erste Kopplung des Wurzelzertifikats**: Wer `/ca.crt` bei der ersten
  Installation auf einem Gerät abfängt, kann eine eigene Wurzel unterschieben.
  Abhilfe ist der Abgleich des Fingerabdrucks mit dem auf dem Server
  (UPGRADE.md §14). Die App ist davon nicht betroffen: Sie bekommt den
  Fingerabdruck über den QR-Code vom angemeldeten Bildschirm.
- **Reichweite der internen CA**: Ein Gerät, das die Wurzel installiert,
  vertraut ihr für jede Adresse. Wer `caddy/data/` (Schlüssel) erbeutet, kann
  diesen Geräten jede Seite vortäuschen. Die App vertraut nur dem gepinnten
  Schlüssel. Die eigene CA aus `scripts/setup-ca.sh` ist auf `BRICK_HOST`
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
- **Tagesgrenze von unbekannten Adressen**: 50 Fehlversuche eines Fremden
  sperren die Passwortanmeldung ohne zweiten Faktor für einen Tag an jeder
  Adresse, an der sich der Inhaber noch nicht angemeldet hat (neues Gerät,
  neues Netz). Bekannte Adressen, Passkey und „Passwort vergessen“ bleiben
  offen; die Mail an den Inhaber meldet die Grenze.
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
  sind per Digest fest und veralten damit; Dependabot schlägt neue Fassungen vor
  (ZAP und die Dienst-Container der Workflows nicht). Eine hingenommene Lücke
  in `postgres` steht mit Ablaufdatum in `.github/trivy-betrieb.yaml`; Caddy
  prüft der Job `trivy-eigenbau` ohne Ausnahmen.
- **Verwalter setzen jedes Konto zurück**: Ein Verwalter kann Passwort und
  zweiten Faktor jedes Kontos zurücksetzen. Gedeckelt ist das durch Passwort
  und zweiten Faktor des Verwalters selbst, eine Hinweis-Mail an den Inhaber
  und alle Verwalter und das Verwaltungsprotokoll; verhindern lässt es sich
  nicht, nur erkennen.
- **Updates der Android-App über Google Play**: Die App installiert keine Pakete
  selbst und verlangt `REQUEST_INSTALL_PACKAGES` nicht; die Prüfung des fertigen
  APK (`tools/manifest-permissions.txt`) ist rot, sobald die Berechtigung wieder
  auftaucht. Restrisiko: Wer das Play-Konto oder den Upload-Schlüssel erbeutet,
  kann Updates veröffentlichen.
