# Vor der Nummerierung, Teil 1

Teil der Fix-Historie — Übersicht in [CHANGELOG-fixes.md](../CHANGELOG-fixes.md).

---

## Security

### QR-Login: bcrypt-Hash raus, Nonce rein
`routes/auth.ts`

Der QR-Code enthielt bisher `h: user.password_hash`. Der Kommentar dort
argumentierte mit „can't reverse to plaintext" — das gilt fürs Reversieren,
nicht fürs Knacken. Wer den Code fotografiert oder den Screenshot findet, hat
den Hash offline und unbegrenzt zum Durchprobieren, und derselbe Hash ist der
Webapp-Login.

Neu: Tabelle `qr_login_tokens` (wird beim ersten Aufruf angelegt). `/qr-token`
erzeugt eine 32-Byte-Nonce, legt nur deren SHA-256 ab, TTL 5 Minuten.
`/qr-login` löst sie atomar ein:

```sql
UPDATE qr_login_tokens SET used_at = NOW()
WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()
RETURNING user_id
```

Nur die erste Anfrage bekommt eine Zeile zurück — zwei Geräte können denselben
Code nicht parallel einlösen. HMAC-Signatur und die Zweitverwendung des
`SESSION_SECRET` als Signierschlüssel entfallen ersatzlos, ebenso die
Fallback-Konstante `brickinventory-manager-secret-change-in-production`.

Abgelaufene Nonces werden beim nächsten `/qr-token` mit weggeräumt.

### Login-Vorbedingungen: eine Quelle statt zwei
`utils/auth.ts`, `routes/auth.ts`, `routes/api_v1/auth.ts`

`/api/v1/auth/login` prüfte weder `is_active` noch `email_verified` und stellte
danach einen Token mit `expires_at = NULL` aus. Ein deaktiviertes oder nie
bestätigtes Konto hatte über die Android-API also unbefristeten Vollzugriff,
während der Webapp-Login beides ablehnt.

Neu: `assertLoginAllowed(user)` in `utils/auth.ts`, aufgerufen von beiden
Login-Handlern und vom QR-Login. Behandelt sowohl `0/1` als auch `false/true`
(je nach Spaltentyp liefert Postgres beides). Der v1-Login akzeptiert jetzt
zusätzlich die E-Mail-Adresse als Kennung — vorher nur den Benutzernamen,
anders als die Webapp.

### Token-Speicherung vereinheitlicht
`routes/auth.ts`, `server.ts`

`verification_token` und `reset_token` lagen im Klartext in `users`, während
`api_tokens` längst gehasht waren. Bei einem DB-Leak war damit jeder ausstehende
Bestätigungs- und Reset-Link direkt einlösbar. Beide laufen jetzt über dasselbe
`hashToken()` — Erzeugung, Lookup in `/verify`, `/reset-password` und
`/check-token`, und der zweite `/verify`-Handler in `server.ts` gleich mit.

### Benutzername-Regeln
`routes/auth.ts`

`PUT /api/auth/profile` validierte den Benutzernamen gar nicht (Login und
Register erzwingen `USERNAME_RE`) und prüfte die Eindeutigkeit case-*sensitiv*,
während der Login mit `LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)`
sucht. Zwei Folgen: „Marco" und „marco" konnten nebeneinander existieren (welcher
beim Login trifft, war ohne `ORDER BY` undefiniert), und man konnte seinen
Benutzernamen auf die E-Mail-Adresse eines anderen Nutzers setzen.

Neu: dieselbe Regex im Profil-Update, Eindeutigkeitsprüfung case-insensitiv und
über *beide* Spalten (Username gegen Email und umgekehrt), E-Mail-Format
zusätzlich geprüft. `POST /api/auth/users` (Admin) validiert jetzt ebenfalls
Benutzername und Mindestpasswortlänge.

### bcrypt-Kostenfaktor
`utils/auth.ts`

War 10 in `/register`, `/change-password` und `POST /users`, 12 in
`PUT /profile`. Jetzt überall `BCRYPT_ROUNDS = 12`.

### Rate-Limits
`utils/loginLimiter.ts`, `routes/auth.ts`

`/register`, `/forgot-password`, `/reset-password` und `/check-token` waren
völlig unbegrenzt — beliebig viele Konten, beliebig viele Mails an eine fremde
Adresse, beliebig viele Token-Versuche. Neu: `ipThrottle(bucket, max, windowMs)`
als Express-Middleware, gleiche In-Memory-Mechanik wie der Login-Limiter:

| Endpoint | Limit |
|---|---|
| `/register` | 5 / Stunde / IP |
| `/forgot-password` | 5 / Stunde / IP |
| `/reset-password` | 10 / Stunde / IP |
| `/check-token` | 30 / Stunde / IP |

### Kleinere Befunde
- `DELETE /api/settings/tokens/:tokenId` baute ein LIKE-Pattern aus ungeprüftem
  Input — ein `%` löschte alle eigenen Tokens. Jetzt `escapeLike()` +
  `ESCAPE '\'` + Längenbegrenzung.
- `GET /api/v1/` (Endpoint-Übersicht) lief ohne Auth. Jetzt hinter `requireToken`.
- `/api/debug/test` antwortet in Produktion mit 404.

---
## Stored XSS

Zwei Hälften, beide umgesetzt.

### Frontend
`public/js/01-core.js` (+ alle übrigen `0x-*.js`)

`esc`, `escHtml` und `escJs` waren in `03-parts.js` definiert, wurden aber auch
von `02-gallery.js` und `04-finance.js` benutzt — von Dateien also, die *vorher*
geladen werden. Das ging nur gut, weil die Aufrufe erst nach dem Laden aller
Skripte passieren. Die Helfer liegen jetzt zentral in `01-core.js`:

| Helfer | Kontext |
|---|---|
| `esc()` | Textinhalt und doppelt-gequotete Attribute — escaped jetzt auch `'` |
| `escJs()` | JS-String im Attribut: `onclick="fn('${escJs(x)}')"` |
| `escUrl()` | `src` / `href` — nur relative Pfade und http(s), `javascript:` fliegt raus |
| `escHex()` | `style="background:…"` — nur 6 Hex-Ziffern, sonst Fallback |

Gehärtet wurden 79 Attribut- und Handler-Stellen sowie 45 Textstellen. Die
betroffenen Sinks waren unter anderem `src="${p.image_url}"` (bei manuell
erfassten Teilen frei wählbar), `data-orig`, `title`, `value`,
`onclick="openModal('${s.set_number}')"`, `${p.color_name}` und
`style="background:#${p.color_hex}"`.

`toast()` baute die Nachricht per `innerHTML` — sie enthält regelmässig
Server-Fehlermeldungen und Set-Nummern aus Nutzereingaben. Jetzt zwei
`<span>`-Elemente mit `textContent`.

### Backend
`utils/validate.ts` (neu), `routes/parts.ts`, `routes/minifigs.ts`

`addManualPart()` und `addManualFig()` übernahmen `part_number`, `part_name`,
`color_name`, `category_name`, `note` und `image_url` genau so, wie sie ankamen
— beliebige Länge, beliebige Zeichen, beliebiges URL-Schema.

Neu:
- `requireItemNumber()` — `/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/`
- `optionalText()` — Steuerzeichen raus, auf Feldlänge gekappt
- `optionalImageUrl()` — muss parsebar und **https** sein
- `positiveInt()`, `colorId()`, `optionalHex()`, `optionalCondition()`

### Was bewusst NICHT geändert wurde
`script-src 'unsafe-inline'` steht weiterhin in der CSP. Es rauszunehmen
erfordert, alle ~140 Inline-Handler in `index.html` und den generierten
Templates auf `data-`-Attribute mit delegierten Listenern umzustellen. Das ist
ein eigener, grösserer Umbau und ohne laufende App nicht verifizierbar — ihn
blind mit den Sicherheitsfixes zu vermischen wäre das grössere Risiko gewesen.
Die Sinks selbst sind jetzt dicht; die CSP wäre die zweite Verteidigungslinie.

---
## Korrektheit

### `toPostgres()` entfernt
`db/database.ts`

Die SQLite→PostgreSQL-Übersetzung aus der Migrationszeit produzierte zwei
Klassen stiller Fehler:

1. Sie hängte an **jedes** INSERT ohne `ON CONFLICT` automatisch
   ` ON CONFLICT DO NOTHING` an. `POST /api/auth/users` meldete deshalb
   `success: true`, obwohl kein Nutzer angelegt wurde — der `23505`-Zweig im
   catch war toter Code. Und weil `RETURNING` mit dieser Regel kollidiert, war
   `db.run().lastID` dauerhaft `null`.
2. Sie ersetzte **jedes** Fragezeichen durch `$n` — auch in String-Literalen und
   in den JSONB-Operatoren `?`, `?|`, `?&`. Bei `csv_import_jobs.results`
   (JSONB) ist das keine Theorie.

Vorgehen: erst geprüft, dass es kein `INSERT OR IGNORE/REPLACE`, kein
`datetime()`, kein `GLOB` und keinen `?`-Platzhalter mehr gibt. Dann alle 34
INSERTs, die über die Schicht liefen und auf das implizite Verhalten bauten,
durchgegangen und ihr `ON CONFLICT DO NOTHING` explizit an die Aufrufstelle
geschrieben — inklusive der Testfixtures und des `mkInsert('rb_inventory_minifigs', …, '')`
in `jobs/csvImportWorker.js`. Ausgenommen: die beiden `users`-INSERTs, wo 23505
jetzt wieder fliegt und behandelt wird.

`toPostgres()` bleibt als Identitätsfunktion stehen, damit die Aufrufstellen
unverändert lesbar sind und ein späterer Hook (Query-Timing, Logging) genau
einen Ort hätte.

### `/api`-404 vor dem SPA-Catch-all
`server.ts`

`app.get('*')` war *vor* `app.use('/api', 404)` registriert und gewann damit.
Jeder unbekannte GET auf `/api/…` bekam die ~189 KB grosse `index.html` mit
Status 200 — für die Android-App ein Serialisierungsfehler statt eines 404, und
bei Retry-Schleifen die volle HTML-Seite pro Versuch. Reihenfolge getauscht.

### `deleteSet()` atomar
`utils/handlers.ts`

Vier sequenzielle DELETEs ohne Transaktion. Brach eins ab, blieben Teile und
Minifiguren ohne Set zurück und tauchten in Teileliste und Finanzsummen weiter
auf. Jetzt in `db.transaction()`.

---
## Performance

### `getSets()`: drei korrelierte Subqueries → ein Join
`utils/handlers.ts`

Statt `MAX(purchase_price)`, `COUNT(*)` und `COUNT(*) FILTER` je einzeln pro
Zeile zu korrelieren, hängt jetzt ein gruppiertes Subselect per `LEFT JOIN` an.
Die Spaltenliste ist dabei mit `s.` qualifiziert worden — die Subquery führt
`set_number` ebenfalls, unqualifiziert wäre sie ab jetzt mehrdeutig.

### Blockierender I/O
`server.ts`

- Bild-Proxy, Cache-*Miss*-Pfad: `mkdirSync` / `writeFileSync` / `renameSync`
  blockierten den Event-Loop pro neuem Bild — ein frisch geöffneter
  Katalog-Screen lädt bis zu 60 davon hintereinander. Jetzt durchgehend
  `fs.promises`.
- Thumbnail-Erzeugung beim Start: `existsSync` in einer Schleife über *alle*
  Bilder von Sets und Teilen, direkt nach `app.listen()`. Jetzt
  `fs.promises.access()`.

---
## Android

### Token-Speicherung
`AndroidManifest.xml`, `res/xml/data_extraction_rules.xml`

`allowBackup="true"` ohne Ausschlussregeln plus Bearer-Token im Klartext im
DataStore plus `expires_at = NULL` serverseitig: der Zugang landete im
Cloud-Backup und in jedem `adb backup`. Jetzt `allowBackup="false"` und
zusätzlich `dataExtractionRules` mit `<exclude domain="file" path="datastore" />`
für Cloud-Backup *und* Geräte-Transfer (Android 12+ läuft unabhängig vom
Backup-Flag).

### Klartext-Verkehr
`AndroidManifest.xml`, `res/xml/network_security_config.xml`,
`util/NetworkPolicy.kt` (neu), `di/AppModule.kt`, `ui/screens/PdfViewerScreen.kt`

`usesCleartextTraffic="true"` galt app-weit. Eine Network-Security-Config mit
Domain-Whitelist geht hier nicht, weil die Server-URL frei konfigurierbar ist und
Android für RFC1918-Bereiche keine Wildcards kennt.

Gelöst eine Ebene höher: `NetworkPolicy.isCleartextAllowed()` erlaubt `http` nur
noch zu privaten Adressen (10/8, 172.16/12, 192.168/16, 169.254/16, Loopback,
`.local`, `.home.arpa`, IPv6-ULA). Zu öffentlichen Hosts bricht der Interceptor
die Anfrage mit einer `IOException` ab, statt den nie ablaufenden Token im
Klartext übers Internet zu schicken. Der PDF-Viewer baut bewusst einen eigenen
Client (Range-Resume) und prüft deshalb separat.

Die Config selbst nimmt zusätzlich `<certificates src="user" />` auf — damit
funktioniert HTTPS mit selbst ausgestelltem Zertifikat, sobald die eigene CA
installiert ist. Das ist der saubere Weg raus aus dem Klartext-Betrieb.

### Token-Anhängen: Origin statt Präfix
`di/AppModule.kt`, `util/NetworkPolicy.kt`

Der Interceptor entschied per `finalUrl.startsWith(serverUrl)`. Bei
`serverUrl = "https://brick.example.com"` matchte auch
`https://brick.example.com.angreifer.tld/…` — der Token wäre mitgegangen.
Jetzt `NetworkPolicy.isSameOrigin()`: Scheme, Host und Port der geparsten
`HttpUrl`.

### `provideOkHttpClient` entkoppelt
`di/AppModule.kt`, `MainActivity.kt`, `data/BarcodeResolver.kt`

Das unqualifizierte Binding lieferte still den api-Client an jeden, der
`OkHttpClient` injizierte. Entfernt; `MainActivity` und `BarcodeResolver` geben
`@Named("api")` jetzt explizit an. Ungenutzter Import in `AppNavigation.kt` raus.

---
## Neue Tests

| Datei | Deckt ab | DB nötig |
|---|---|---|
| `test/frontend-escaping.test.js` | Verhalten von `esc`/`escJs`/`escUrl`/`escHex` + statischer Sink-Scan über alle `public/js/0x-*.js` | nein |
| `test/auth-parity.test.js` | `assertLoginAllowed()`, Aufruf in beiden Login-Handlern, Username-Regeln im Profil-Update, einheitlicher bcrypt-Faktor, `escapeLike`, kein `password_hash` mehr im QR-Abschnitt | nein |
| `app/src/test/.../NetworkPolicyTest.kt` | `isSameOrigin` (inkl. Suffix-Angriff), `isPrivateHost`, `isCleartextAllowed` | nein |

Der statische Sink-Scan ist der eigentliche Wert des ersten Tests: Der Fix hält
nur, wenn die nächste Zeile `src="${x}"` beim Testlauf rot wird statt in
Produktion.

---
## Bekannte Einschränkungen

1. **Android nicht kompiliert.** Hier ist kein Android SDK verfügbar. Die
   Kotlin-Änderungen sind klein und lokal (ein neues Objekt, drei
   Injection-Punkte, ein Interceptor-Block), aber `./gradlew assembleDebug` und
   `./gradlew test` solltest du einmal laufen lassen, bevor du das APK baust.
2. ~~**Die beiden DB-Testsuiten** wurden nicht ausgeführt (kein Postgres).~~
   **Nachgeholt** — siehe „Verifikation gegen eine echte Datenbank" am Ende.
3. **`qr_login_tokens`** wird per `CREATE TABLE IF NOT EXISTS` beim ersten
   `/qr-token` angelegt. Sauberer wäre die Tabelle in `initSchema()` — dort
   liegen alle anderen. Habe ich bewusst nicht angefasst, um die Schema-Init
   nicht in denselben Change zu ziehen.
4. **Die Fehlermeldung** des Klartext-Abbruchs ist hartkodiert deutsch, während
   die App sonst über `strings.xml` läuft. Sie ist eine Exception-Message, keine
   UI-Zeichenkette — falls sie irgendwo in einer Snackbar landet, gehört sie in
   die Ressourcen.
5. **Nicht angefasst** (aus dem Review, bewusst zurückgestellt): CSP ohne
   `unsafe-inline`, Pagination/Virtualisierung für Galerie und Teileansicht,
   `LISTEN`/`NOTIFY` statt der drei Poller, `server.ts` aufteilen,
   TS-Migration von `jobs/`, Room-Cache in der Android-App.

---
## Nachtrag: Globales Design galt nicht auf dem Login-Screen

Drei unabhängige Ursachen — jede allein hätte gereicht.

**1. Der Theme-Endpoint lag hinter der Login-Pflicht.**
`routes/settings.ts`

```ts
router.use(requireLogin);
…
// GET /api/settings/theme — aktuelles App-Design (von allen Nutzern lesbar)
router.get('/theme', …)
```

Der Kommentar stimmte, die Platzierung nicht: `router.use()` gilt für alles,
was danach registriert wird. Vor dem Login war der Wert also gar nicht
abrufbar. Route jetzt vor das Gate gezogen — sie liefert `'classic'` oder
`'brick'` und sonst nichts.

**2. `applyTheme()` lief erst nach dem Login.**
`public/js/00-theme-boot.js` (neu), `public/js/01-core.js`, `public/index.html`

Aufgerufen wurde es ausschliesslich aus `showApp()` und aus dem
Admin-Speichern-Handler. Neu ist ein blockierendes Skript im `<head>`, das in
zwei Stufen arbeitet: erst den letzten bekannten Wert aus `localStorage`
(sofort, kein Netz, kein Aufblitzen des falschen Designs), dann asynchron
`GET /api/settings/theme` zum Abgleich. `applyTheme()` in `01-core.js` reicht
jetzt an denselben Helfer durch, damit der Cache nach einem Design-Wechsel des
Admins aktuell bleibt.

**3. Beide Screens waren hart auf Weiss.**
`public/styles.css`, `public/index.html`, `public/themes/brick.css`

`#login-screen` und `#startup-screen` hatten `background:#fff` — beim
Startup-Screen sogar als Inline-Style, der jede Stylesheet-Regel überstimmt.
Neu: die Variable `--screen-bg`, in `:root` weiss, im Brick-Theme auf die
Plattenfarbe gesetzt. Die Inline-Farben im Startup-Screen (Fortschrittsbalken,
Beschriftungen) laufen jetzt über `var(--b600)`, `var(--g500)`, `var(--txt)`,
`var(--mut)` und `var(--s200)`; nur die Marken-Rot- und -Gelbtöne des
Logo-SVGs bleiben fest.

`brick.css` bekommt dazu einen eigenen Abschnitt für die beiden Screens: die
`.lcard` wird zur schwebenden Kachel mit Noppenreihe am oberen Rand — dasselbe
Motiv wie `.sc` und `.bstat` im eingeloggten Zustand, damit der Übergang nach
dem Login nicht wie ein Designwechsel wirkt. Eingabefelder, Buttons und Links
in der Karte folgen der Theme-Palette.

**Für neue Designs** gilt damit zusätzlich zur Anleitung im Kopf von
`brick.css`: `--screen-bg` setzen und den Login-Screen mitstylen. Beides prüft
`test/theme.test.js` für jede Datei unter `public/themes/` automatisch.

### Test

`test/theme.test.js` (ohne DB, 6 Fälle) sichert alle drei Ursachen ab:
Reihenfolge von `/theme` und `requireLogin`, Boot-Skript im `<head>` inklusive
Cache und Server-Abgleich, `applyTheme`-Durchreichung, kein fester Hintergrund
auf den beiden Screens, keine Inline-Farben im Startup-Block, und für jedes
Theme unter `public/themes/` eine Regel für `#login-screen` plus `--screen-bg`.

Stand danach: `tsc --noEmit` sauber, `npm test` 38 bestanden, 0 rot, 2
übersprungen.

---
## Nachtrag: BrickLink-Link im Katalog-Detail

### Befund — die Annahme in der Anfrage trifft so nicht zu

Ich habe zuerst nach dem Weg gesucht, BL-IDs gebündelt abzufragen. Den gibt es
nicht, und zwar aus zwei unabhängigen Gründen:

**Rebrickable kennt für Sets keine BrickLink-ID.** `external_ids` gibt es dort
ausschliesslich bei Parts — im API-Changelog steht der Eintrag als „Added
external_ids section to Part listings" (14.09.2017), das Set-Schema hat kein
solches Feld. Die CSV-Downloads (`sets.csv`, aus denen `rb_sets` gefüllt wird)
haben ebenfalls keine BrickLink-Spalte. Es gibt also weder einzeln noch
gebündelt einen Weg, Rebrickable nach der BL-ID eines Sets zu fragen.

**Die BrickLink-Store-API hat keinen Sammelendpunkt für Katalogartikel.** Nur
`GET /items/{type}/{no}`, einzeln, bei laut Doku durchschnittlich einer Anfrage
pro Sekunde — mit ausdrücklicher Warnung, dass anhaltendes Ignorieren von 429ern
zur IP-Sperre führt. Ein Durchlauf über die rund 27'000 Katalog-Sets wären über
sieben Stunden Dauerlast.

### Was tatsächlich falsch war

Der eigentliche Fehler ist ein anderer, als „falsche ID" vermuten lässt: Für
echte Sets **stimmt** die Nummer, Rebrickable und BrickLink verwenden dort
dieselbe. Falsch wird es bei allem, was BrickLink nicht als Set führt.

`routes/bricklink.ts` weiss das längst — beim Preisabruf probiert es
`set → gear → book` durch und schreibt das Ergebnis nach
`catalog_cache.bl_type`. Der Katalog-Link hat diese Information ignoriert und
immer `?S=<nummer>#T=S` gebaut. Bei Gear und Büchern ist damit beides falsch:

| | Set | Gear | Book |
|---|---|---|---|
| Parameter | `S=` | `G=` | `B=` |
| Nummer | `5005358-1` | `5005358` | `5005358` |

BrickLink vergibt bei Gear und Büchern keinen `-N`-Suffix — die alte URL landete
dort auf „item not found".

### Umsetzung

**`utils/bricklinkLink.ts` (neu)** — eine Quelle für Typ, Nummer und URL:

- `resolveMany(setNumbers)` löst beliebig viele Nummern mit **einer** SQL-Abfrage
  gegen `catalog_cache` auf (`WHERE set_number = ANY($1::text[])`). Das ist die
  Stelle, an der „gebündelt" tatsächlich möglich ist und auch die Latenz spart —
  ohne einen einzigen API-Aufruf.
- `resolveViaApi(setNumber)` löst einen noch unbekannten Typ einmalig gegen
  BrickLink auf (`/items/{type}/{no}` statt der teureren Preisabfrage) und cacht
  ihn dauerhaft. Wird nur für eine bewusst geöffnete Detailseite aufgerufen, nie
  für Listen.
- Ohne Cache-Eintrag ist die Annahme `SET` — das trifft auf die grosse Mehrheit
  zu, und der erste Detailaufruf korrigiert sie dauerhaft.

**API** — `GET /api/v1/catalog/sets/:setNumber` liefert zusätzlich

```json
"bricklink": { "type": "GEAR", "number": "5005358", "url": "https://…", "resolved": true }
```

Neu ist `GET /api/v1/catalog/bricklink?sets=a,b,c` (max. 500) für die
Sammelauflösung einer ganzen Katalogseite.

**Clients** bauen die URL nicht mehr selbst. Ist `url` null (BrickLink führt den
Artikel gar nicht, `bl_type = NONE`), wird der Kauf-Button ausgeblendet statt
wissentlich auf eine Fehlerseite zu verlinken. `BrickLinkUrls` in der App kann
jetzt alle drei Typen und bleibt als Fallback für ältere Server, die das Feld
noch nicht liefern — `detail.bricklink == null` unterscheidet „Altserver" von
„nicht gelistet".

### Tests

`test/bricklink-link.test.js` (7 Fälle, ohne DB): Suffix-Behandlung in beide
Richtungen, korrekter Parameter und For-Sale-Tab je Typ, `null` bei `NONE`,
URL-Kodierung — und ein statischer Check, dass `09-catalog.js` kein
`catalogitem.page` mehr enthält.

`CatalogSerializationTest.kt` bekommt `BrickLinkRefTest`: Deserialisierung des
neuen Felds, fehlendes Feld bei Altservern, `url: null`, und die typisierte
Fallback-URL.

`test/api-inventory.test.js` ist um den neuen Endpunkt ergänzt — der Test hat
beim ersten Lauf korrekt rot geschlagen.

Stand: `tsc --noEmit` sauber, `npm test` 45 bestanden, 0 rot, 2 übersprungen.

### Offen

Falls dir konkrete Set-Nummern auffallen, deren Link trotz `type: "SET"` ins
Leere geht, schick sie mir — dann gibt es dort eine dritte Abweichung, die ich
in `catalog_cache` noch nicht abgedeckt sehe.

---
## Nachtrag: Rebrickable-Tageslimit auf 25'000

Standard von 4000 auf 25000 angehoben (zwischenzeitlich stand hier 10000).
Beim Umsetzen kamen drei Sachen mit ans Licht, die zum selben Thema gehören.

**Der eingestellte Wert überlebte keinen Neustart.**
`utils/rateLimiter.ts`, `server.ts`

`global_settings.api_limit_rebrickable` wurde ausschliesslich im PUT-Handler von
`/api/v1/admin/api-limits` per `setMax()` in den Limiter geschrieben. Beim
Serverstart passierte das nie — es galt immer der hartkodierte
Konstruktorwert. Wer in den Einstellungen etwas anderes eingetragen hatte, lief
nach dem nächsten Neustart wieder mit dem Standard, ohne Hinweis.

Neu: `loadDailyLimitsFromDb()` in `utils/rateLimiter.ts`, aufgerufen in
`server.ts` im `initSchemaOnce().then()`-Callback **vor** `app.listen()` — sonst
träfen die ersten Anfragen noch den Standardwert.

**Bestandsinstallationen.**
`db/database.ts`

Der Seed-Block läuft mit `ON CONFLICT (key) DO NOTHING`, ein geänderter
Seed-Wert erreicht bestehende Datenbanken also nicht. Ergänzt um eine gezielte
Migration:

```sql
UPDATE global_settings SET value = '25000'
WHERE key = 'api_limit_rebrickable' AND value IN ('4000', '10000')
```

Beide früheren Standards stehen drin, damit die Migration unabhängig davon
greift, welche Version zuletzt lief. Nur exakte Standardwerte werden angehoben —
wer bewusst etwas anderes eingestellt hat, auch etwas Kleineres, behält es.
Falls du selbst mal genau 4000 oder 10000 eingetragen hattest, wird das hier
mit angehoben; das ist die einzige Stelle, an der die Migration nicht zwischen
„Standard" und „Absicht" unterscheiden kann.

**Die angezeigten Zahlen waren schon vorher falsch.**
`routes/rebrickable.ts`, `public/i18n.js`, `public/index.html`

Drei Fehlermeldungen nannten „Tageslimit erreicht (100/Tag)", während das
tatsächliche Limit bei 4000 lag — ein Rest aus einer früheren Version. Sie
lesen jetzt `rebrickableDailyLimiter.status.max`.

Dieselbe Doppelquelle steckte in den Monitor-Labels: „Rebrickable (4000/Tag)"
als i18n-Text, obwohl direkt darüber schon `count / limit` mit den echten Werten
steht. Die Zahl ist aus den Labels raus (DE und EN, alle drei Dienste) — sie
wäre bei jeder Limitänderung wieder falsch geworden.

**Nebenbei:** `PUT /api/v1/admin/api-limits` hat `parseInt(rebrickable)`
ungeprüft weitergereicht. Bei einer nicht-numerischen Eingabe landete der String
`"NaN"` in `global_settings`, und `setMax(NaN)` liess anschliessend **jeden**
`tryConsume()` fehlschlagen — die Rebrickable-Anbindung wäre still komplett
tot gewesen. Jetzt auf 1…100000 geprüft, sonst 400.

### Test

`test/rate-limit.test.js` (7 Fälle, ohne DB): Standardwert in Konstante, Limiter,
Seed, Migration, Eingabefeld und Hinweistext müssen übereinstimmen, und jeder
frühere Standard muss in der Migrations-IN-Liste auftauchen;
`loadDailyLimitsFromDb()` muss vor `app.listen()` stehen; keine fest
eingetragenen Limitzahlen mehr in Meldungen und i18n-Labels; dazu das Verhalten
von `DailyLimiter` selbst (Zählen, Sperren, Tageswechsel, `setMax` mitten im
Tag).

Stand: `tsc --noEmit` sauber, `npm test` 52 bestanden, 0 rot, 2 übersprungen.

---
## Fix: BrickLink-Button war bei Sammelminifiguren verschwunden

Regression aus dem BrickLink-Umbau oben.

**Ursache.** Rebrickable führt Sammelminifiguren als *Sets* (`71021-1`).
BrickLink führt sie als eigenen Item-Typ **MINIFIG** unter einer völlig anderen
Nummer (`col325`). Die Sondierungskette in `getPriceGuide()`
(`routes/bricklink.ts`) probiert nur `set → gear → book`; für diese Artikel
schlägt alles fehl, und sie schreibt `bl_type = 'NONE'` nach `catalog_cache`.

Mein `resolveOne()` hat aus `NONE` ein `url: null` gemacht, und beide Clients
haben den Button daraufhin ausgeblendet. Vorher war er sichtbar — mit kaputtem
`?S=`-Link, aber sichtbar. Unterm Strich also eine Verschlechterung: Der Artikel
existiert auf BrickLink sehr wohl, nur unter einer Nummer, die sich nicht
herleiten lässt.

**Warum sich das nicht "richtig" lösen lässt.** Die Zuordnung
Rebrickable-Set-Nummer → BrickLink-Minifig-Nummer gibt es in keiner der beiden
Datenquellen: Rebrickable führt `external_ids` nur bei Parts, BrickLink kennt
die Rebrickable-Nummer gar nicht. Ein Deep-Link ist hier prinzipiell nicht
konstruierbar.

**Lösung.** `BlLink.url` ist jetzt **immer** gesetzt und es gibt ein neues Feld
`exact`:

| Fall | `url` | `exact` |
|---|---|---|
| Typ bekannt (SET/GEAR/BOOK/MINIFIG) | Katalogseite, For-Sale-Tab | `true` |
| `bl_type = NONE` | `search.page?q=<nummer ohne Suffix>` | `false` |

Der Button verschwindet nie mehr. Bei `exact: false` wechselt die Beschriftung
auf „Auf BrickLink suchen" (`catalog.search_bricklink`, DE/EN, und
`catalog_search_bricklink` in beiden `strings.xml`), in der Webapp mit einem
`title`, der den Grund nennt.

Zusätzlich kennt `buildUrl()` jetzt `MINIFIG` (`M=`), und `resolveViaApi()`
sondiert den Typ mit. Das trifft nur, wenn BrickLink zufällig dieselbe Nummer
führt — bei Sammelminifiguren nicht, dafür bei anderen Artikeln.

**Test.** `test/bricklink-link.test.js` um drei Fälle erweitert: `M=`-Parameter
für MINIFIG, `searchUrl()` ohne Variantensuffix (der engt die Suche sonst
unnötig ein), und ein statischer Check, dass `09-catalog.js` kein
`display = 'none'` mehr auf den Button setzt.

Stand: `tsc --noEmit` sauber, `npm test` 55 bestanden, 0 rot, 2 übersprungen.

**Offen:** In `catalog_cache` stehen bei dir vermutlich schon `NONE`-Einträge aus
früheren Preisabrufen. Die sind mit dem Suchlink jetzt gut bedient; wenn du
willst, dass MINIFIG dort auch sauber erkannt wird, müsste die Kette in
`getPriceGuide()` ebenfalls `minifig` probieren — das ist aber der Preispfad und
gehörte nicht in diesen Fix.

---
## Fix: Galerie-Kachel behielt nach Zustandsänderung das alte Label

**Fehlerbild.** Zustand im Kaufpreis-Dialog von „neu" auf „gebraucht" ändern,
Dialog schliessen — die Kachel in der Galerie zeigt weiter „neu". Erst ein
Neuladen der Liste korrigiert es. Gemeldet für Android; die Webapp war
tatsächlich ebenfalls betroffen, nur anders.

**Zwei verschiedene Ursachen.**

*Android:* `updateAcquisition()` rief nach dem Schreiben `loadAcquisitions()`
und `loadSetDetail()` auf — beide aktualisieren nur `_setDetailState`. Die
Galerie liest aus `_state.sets`, und das blieb unberührt.

*Webapp:* Hier gab es bereits eine lokale Aktualisierung, aber mit der falschen
Regel:

```js
const latestCond = ad.acquisitions[ad.acquisitions.length - 1].condition;
```

Der Server sagt dagegen: sobald **eine** Erfassung `U` ist, gilt das Set als
gebraucht. Bei der Reihenfolge `[U, N]` zeigte die Kachel „neu", während der
Server „gebraucht" meinte — ein Widerspruch, der bis zum nächsten Reload stehen
blieb. Ausserdem lief der Patch nur im Zweig `field === 'cond'`.

**Lösung: die Regel gehört an eine Stelle.** Sie stand vorher dreimal im Code
(`getSets()`, `getSet()`, Frontend). Neu:

- `getSetConditionAggregate(userId, setNumber, storedCondition)` in
  `utils/handlers.ts` — die einzige Definition. Liefert `condition`,
  `acq_count`, `used_count` und `max_purchase_price`.
- `getSet()` gibt diese Felder jetzt mit zurück. Vorher fehlten sie, weshalb ein
  Client die Listen-Kachel nicht einfach aus dem Detail-Objekt aktualisieren
  konnte, ohne genau diese Werte zu verlieren.
- `PUT` und `DELETE` auf `set_acquisitions` hängen das neu berechnete Aggregat
  an ihre Antwort (`withSetAggregate()`). Teile- und Minifiguren-Erfassungen
  bleiben unberührt — die haben kein Set-Aggregat.
- Beide Clients **übernehmen** den Wert nur noch:
  `applySetAggregate()` in `public/js/02-gallery.js` (dort, wo `allSets` lebt)
  und in `ui/SetDetailFeature.kt`. Keine lokale Neuberechnung mehr, und der
  Patch greift bei jeder Änderung, nicht nur beim Zustand.

**Test.** `test/set-condition-aggregate.test.js` (4 Fälle, ohne DB): Die Regel
darf nur einmal im Code stehen (`usedCount > 0 ? 'U'` wird gezählt), das
Aggregat muss alle vier Felder führen, PUT und DELETE müssen es beide
zurückgeben, und die Webapp darf `latestCond` nicht wieder einführen.

Stand: `tsc --noEmit` sauber, `npm test` 59 bestanden, 0 rot, 2 übersprungen.

**Offen:** Der Android-Teil ist wie immer nicht kompiliert (kein SDK hier).
`SetAggregate` ist ein neues Serialisierungsmodell — `./gradlew test` läuft am
besten einmal drüber, bevor du das APK baust.

---
## Fix (2. Anlauf): Zustands-Label in der Webapp + Flackern beim Login

Zwei Nachbesserungen, beide Fehler aus den vorherigen Runden.

### 1. Das Label aktualisierte sich in der Webapp weiterhin nicht

Mein `withSetAggregate()` sass nur in `routes/api_v1/acquisitions.ts`. Die
Webapp benutzt aber einen **eigenen** Handler in `routes/sets.ts:1102` — genau
die Art von Doppelspur, die euer „einmal implementieren, über zwei Routen
anbieten"-Muster eigentlich verhindern soll. Die PUT-Antwort der Webapp enthielt
also gar kein `set`, und `applySetAggregate(d.set)` bekam `undefined`.

Der Wrapper liegt jetzt in `utils/handlers.ts` neben
`getSetConditionAggregate()`, und **beide** Routenfamilien rufen ihn auf — PUT
und DELETE jeweils.

Der Test prüft das jetzt explizit für beide Dateien, nicht mehr nur für die
v1-Variante. Dass er beim ersten Mal grün war, obwohl der Fehler bestand, lag
genau daran: er sah nur eine Hälfte.

### 2. Flackern beim Login

Ursache war der Rückfall auf `'classic'` bei unbekanntem Wert:

```js
var val = ALLOWED.indexOf(theme) !== -1 ? theme : 'classic';
```

`showApp()` ruft `applyTheme(d.settings.app_theme)` auf. Fehlt dieser Wert oder
ist er leer — `/settings/raw` merged `user_settings` über `global_settings`, ein
leerer Nutzereintrag überschreibt also das globale Design — schaltete die Seite
beim Login sichtbar von `brick` auf `classic` zurück. Und schlimmer: mein
`__bimApplyTheme` schrieb den Ersatzwert in den localStorage, sodass der nächste
Seitenaufruf schon falsch startete und beim Server-Abgleich erneut umsprang.
Genau das ergibt das beschriebene „als würde der Inhalt kurz neu laden".

Neu bedeutet ein unbekannter Wert **keine Information**: `apply()` ändert dann
nichts und gibt `null` zurück, `__bimApplyTheme()` cacht nichts, und
`applyTheme()` in `01-core.js` steigt vorher aus.

**Was bleibt:** Beim allerersten Aufruf nach diesem Update ist der Cache leer.
Dann startet die Seite ohne `data-theme` (= classic) und schaltet nach dem
Server-Abgleich einmalig um. Das ist einmal pro Browser sichtbar und heilt sich
danach selbst. Ganz vermeiden liesse es sich nur, indem der Server `data-theme`
direkt in die `index.html` schreibt — dafür müsste `app.get('*')` die Datei
lesen und patchen statt sie per `sendFile` auszuliefern. Das wollte ich nicht
ungefragt in einen Bugfix packen; sag Bescheid, wenn es dich stört.

Stand: `tsc --noEmit` sauber, `npm test` 60 bestanden, 0 rot, 2 übersprungen.

---
## Fix: einmaliger Design-Sprung beim ersten Aufruf entfernt

`utils/indexHtml.ts` (neu), `server.ts`, `routes/settings.ts`,
`public/js/00-theme-boot.js`

Der SPA-Catch-all liefert die `index.html` nicht mehr per `sendFile` aus,
sondern gerendert — mit bereits gesetztem `data-theme` auf dem `<html>`-Element.
Damit steht das richtige Design schon im ersten Byte, und der Sprung beim
allerersten Aufruf in einem Browser entfällt.

**Zwei Caches**, beide bewusst klein:

- *Dateiinhalt*: einmal gelesen. In Produktion ändert sich die Datei nur beim
  Deploy, und der Versions-Bumper läuft vor dem Serverstart. Ausserhalb von
  Produktion wird die mtime geprüft, damit Änderungen ohne Neustart ankommen.
- *Theme-Wert*: gecacht, invalidiert beim Speichern (`invalidateTheme()` in
  `routes/settings.ts`) — kein DB-Treffer pro Seitenaufruf.

Zum Theme-Cache gehört eine Lebensdauer von 30 Sekunden, und zwar wegen des
Clusters: Der Cache ist prozesslokal, ein Speichern invalidiert nur den Worker,
der die Anfrage bearbeitet hat. Die übrigen ziehen über den Ablauf von allein
nach. `LISTEN`/`NOTIFY` wäre die exakte Lösung, steht aber in keinem Verhältnis
zu einer Einstellung, die sich vielleicht einmal im Jahr ändert.

**Das Boot-Skript wird dadurch schlanker statt doppelt.** Findet es bereits ein
gültiges `data-theme` vor, schreibt es nur noch den localStorage-Cache nach und
steigt aus: kein erneutes Anwenden, kein `GET /api/settings/theme`. Das spart
zusätzlich eine Anfrage pro Seitenaufruf. Die alte Logik bleibt als Fallback für
den Fall, dass das HTML doch einmal ungerendert ankommt — statisch ausgeliefert,
über einen vorgelagerten Cache, oder wenn das Rendern fehlschlägt. Auch der
Catch-all selbst fällt bei einem Fehler auf `sendFile` zurück.

Die Injektion ist idempotent: Ein bereits vorhandenes `data-theme` wird ersetzt,
nicht ein zweites danebengesetzt.

**Test.** `test/theme.test.js` um zwei Fälle erweitert: Der Catch-all muss
`renderIndexHtml()` benutzen *und* einen `sendFile`-Fallback behalten,
`invalidateTheme()` muss beim Speichern gerufen werden, der TTL muss existieren,
und das Boot-Skript muss bei servergesetztem Wert früh aussteigen.

Stand: `tsc --noEmit` sauber, `npm test` 62 bestanden, 0 rot, 2 übersprungen.


---
## Verifikation gegen eine echte Datenbank

Nachgeholt: PostgreSQL 16 im Container installiert, Rolle `tester` und Datenbank
`cattest` angelegt, komplette Suite gefahren.

**`npm test`: 102 Tests, 102 bestanden, 0 rot, 0 übersprungen.**

Damit liefen erstmals auch die beiden Integrationssuiten mit, die sich sonst
selbst überspringen:

- `test/api-parity.test.js` — API-Parität Webapp ↔ Android, 32 Prüfungen
- `test/catalog-api.test.js` — Katalog-API, 8 Prüfungen

Zusätzlich habe ich die vier Änderungen, die sich nur zur Laufzeit zeigen,
gezielt gegen die DB durchgespielt:

| Prüfung | Ergebnis |
|---|---|
| `getSets()` als Join — keine Spalten-Mehrdeutigkeit, Aggregate korrekt | `condition=U acq=2 used=1 max=200` ✔ |
| `getSets()` und `getSet()` liefern dieselben Werte | identisch ✔ |
| Erfassungsreihenfolge `[U, N]` ergibt „gebraucht" | `U` ✔ |
| Doppelter Benutzername wirft wieder `23505` | Fehlercode `23505` ✔ |
| `deleteSet()` lässt keine verwaisten Erfassungen zurück | 0 Reste ✔ |

Der letzte Punkt ist der wichtigste Beleg für die `toPostgres()`-Entfernung: Vor
dem Umbau hat die Kompatschicht die Unique-Verletzung verschluckt, der
`23505`-Zweig war toter Code und `POST /api/auth/users` meldete Erfolg, ohne
einen Nutzer anzulegen. Der Fehler kommt jetzt nachweislich wieder an.

Die Meldungen „BrickLink API Zugangsdaten nicht vollständig" im Log der
Paritätssuite sind erwartet — ohne hinterlegte BL-Zugangsdaten überspringt sie
die Preisabrufe und prüft die übrigen Paare.

**Weiterhin offen bleibt nur die Android-Seite**: Hier gibt es kein Android SDK,
`./gradlew test assembleDebug` musst du selbst laufen lassen. Betroffen sind
`SetAggregate`, `BrickLinkRef` und `NetworkPolicy` — alles neue oder geänderte
Serialisierungsmodelle bzw. neue Klassen.

---
## Fix: Flackern der Kachelwand (Video-Analyse)

Meine bisherigen Vermutungen zum Flackern lagen daneben. Die Frames aus dem
Video zeigen: Der Seitenhintergrund bleibt über die gesamte Aufnahme konstant
bei `rgb(183,194,206)` — es ist **kein** Design-Wechsel. Bei Sekunde ~3,0 bis
~3,8 werden nur die Kacheln kurz weiss, das Layout bleibt stehen.

**Ursache, zwei Teile.**

*1. Ein zweiter kompletter Neuaufbau.* `loadGallery()` rendert die Galerie und
startet danach `enrichGalleryWithPrices()`. Das holt asynchron `/finance/pnl`
und rief am Ende `renderGallery()` auf — ein voller `innerHTML`-Neuaufbau der
gesamten Kachelwand, nur um pro Kachel eine Preiszeile zu ergänzen.

*2. Die Einblendung startet dabei neu.* `styles.css`:

```css
img[loading=lazy]        { opacity:0; transition:opacity .25s ease }
img[loading=lazy].loaded { opacity:1 }
```

Nach einem `innerHTML`-Aufbau sind alle `<img>` neue Elemente und starten wieder
bei `opacity:0` — auch bei warmem Cache. Die `.loaded`-Klasse kam ausschliesslich
aus dem `IntersectionObserver`-Callback, und der ist asynchron: Zwischen
`innerHTML` und Callback liegt mindestens ein Paint mit unsichtbaren Bildern.
Zusammen ergibt das die 250-ms-Einblendung der kompletten Wand, genau wie im
Video.

**Lösung, beide Teile.**

- `observeLazyImages()` markiert Bilder mit `complete && naturalWidth > 0` jetzt
  **synchron**, vor dem nächsten Paint. Das behebt das Flackern grundsätzlich —
  auch für künftige Aufrufstellen. Nebenbei aufgefallen: Die Listenansicht der
  Galerie hat `observeLazyImages()` überhaupt nie aufgerufen, ihre Bilder
  blendeten also jedes Mal ein.
- `enrichGalleryWithPrices()` baut nichts mehr neu, sondern trägt über
  `updateGalleryPrices()` nur die Preis-Container nach. Dafür hat die Preiszeile
  einen stabilen Anker (`data-price-for`) bekommen und liegt immer im Markup,
  bei leerem Inhalt `hidden`. Dazu die nötige Regel
  `.price-badge[hidden]{display:none}` — ohne die bliebe `[hidden]` gegen
  `display:flex` wirkungslos.

Bilder, Scrollposition und Fokus bleiben damit beim Preis-Update unberührt.

**Test.** `test/gallery-render.test.js` (4 Fälle): synchrone Markierung vor dem
Observer-Setup, `observeLazyImages()` in **beiden** Ansichten, kein
`renderGallery()` mehr in `enrichGalleryWithPrices()`, und der Preis-Anker
inklusive der `[hidden]`-Regel.

### Testlauf mit Datenbank

In diesem Durchlauf war eine Postgres-Instanz erreichbar, die beiden bisher
übersprungenen Integrationssuiten sind also mitgelaufen:

```
# tests 106   # pass 106   # fail 0   # skipped 0
```

Darunter „API-Parität Webapp ↔ Android" und „Katalog-API (Postgres-Integration)"
— genau die Suiten, die die `ON CONFLICT`-Umstellung, den `getSets()`-Join und
die Aggregat-Änderungen abdecken. Die sind damit jetzt auch praktisch bestätigt,
nicht nur durch Codelektüre.

---
## Fix: Doppelter Neuaufbau des Inhalts beim Neuladen / nach dem Login

**Diagnose aus dem Video.** Frames bei 10 fps extrahiert und die mittlere
Helligkeit je Bild verglichen: Zwischen 3,1 s und 3,8 s vier Wechsel —
Inhalt → leer → Inhalt → leer → Inhalt. Layout, Kopfzeile und das Stein-Design
standen dabei durchgehend. Es war also **kein Theme-Wechsel**, sondern ein
zweifacher Neuaufbau des Inhaltsbereichs. Meine bisherigen Theme-Fixes haben am
richtigen Ort gearbeitet, nur eben nicht an diesem Fehler.

**Zwei Ursachen, die sich addierten.**

*1. `applyLang()` lud am Ende den aktiven Tab neu* — für die Galerie sogar
beides:

```js
if (activeTab === 'gallery') { renderGallery(); loadGallery(); }
```

Der Block lief bei **jedem** Aufruf. Beim Start kommt `applyLang()` aber
zweimal mit derselben Sprache: einmal aus `checkAuth()` (damit der Login-Screen
übersetzt ist) und einmal aus `showApp()`. Zweimal voller Neuaufbau, obwohl sich
nichts geändert hatte.

*2. `loadGallery()` leerte das Grid, bevor die Anfrage draussen war:*

```js
G('gallery').innerHTML = `<div class="loading">…Spinner…</div>`;
const d = await api('GET','/sets');
```

Beim Auffrischen verschwanden dadurch gültige Kacheln für die Dauer eines
Roundtrips.

**Lösung.**

- `applyLang()` merkt sich in `_langApplied`, was zuletzt angewendet wurde, und
  steigt bei gleicher Sprache sofort aus.
- Der Neuaufbau-Block läuft nur noch bei einem **echten** Sprachwechsel
  (`isRealSwitch`). Beim ersten Anwenden gibt es nichts nachzuziehen — der
  normale Startpfad lädt ohnehin gleich alles.
- Das zusätzliche `loadGallery()` im Galerie-Zweig ist raus. Ein Sprachwechsel
  ändert keine Daten; `renderGallery()` aus dem Cache genügt.
- `loadGallery()` zeigt den Spinner nur noch, wenn das Grid wirklich leer ist.
  Sind Kacheln da, bleiben sie stehen, bis die neue Antwort eintrifft.

Das passt zu dem, was in diesem Bereich schon vorher gemacht wurde:
`updateGalleryPrices()` ersetzt seit Längerem einen vollen `renderGallery()`
nach dem Preisabruf, und `observeLazyImages()` markiert bereits gecachte Bilder
synchron als geladen. Beide Kommentare beschreiben dasselbe Muster — es gab nur
noch einen dritten Auslöser, der übrig geblieben war.

**Test.** `test/no-reload-flicker.test.js` (4 Fälle, ohne DB): No-Op bei
gleicher Sprache, Neuaufbau nur bei echtem Wechsel, kein `loadGallery()` im
Galerie-Zweig, und der Spinner-Guard muss vor dem Leeren stehen (sonst wäre er
wirkungslos).

Stand: `tsc --noEmit` sauber, `npm test` **110 bestanden, 0 rot, 0 übersprungen**
— inklusive der beiden Postgres-Integrationssuiten.

---
## Performance: Teileliste lädt seitenweise

**Messung statt Schätzung.** PostgreSQL mit realistischem Datensatz befüllt —
380 Sets, 171'000 `parts`-Zeilen — und die Ansicht durchgemessen:

| | Zeit | Nutzlast |
|---|---|---|
| `getParts()` bisher, alles auf einmal | ~1'300 ms | **20,65 MB** |
| davon reine SQL-Abfrage | ~520 ms | |
| erste Seite, `page_size=100` | ~650 ms | **0,03 MB** |

Nicht die Datenbank war das Problem, sondern die Nutzlast: Der Frontend-Aufruf
sendete kein `page_size`, also kam jede Teil/Farb-Kombination auf einmal, und
der Browser baute daraus in einem Rutsch die komplette Kachelwand.

Einordnung zur Messung: Die Testdaten streuen gleichverteilt über 1200
Teilenummern und 60 Farben und ergeben damit 66'000 Gruppen. Eine echte Sammlung
klumpt stärker, realistisch sind eher 10'000–20'000. Das ändert die
Grössenordnung, nicht die Schlussfolgerung.

### Serverseitig

- **Funktionaler Index** `idx_parts_group` auf
  `(user_id, COALESCE(bl_part_number, part_number), color_id)` — genau der
  Ausdruck, nach dem gruppiert wird. Seitenabfrage 372 ms → 190 ms.
- **Zähler** von `COUNT(DISTINCT <concat>)` auf `COUNT(*)` über dieselbe
  Gruppierung: 176 ms → 65 ms. Der alte Ausdruck baute pro Zeile einen String
  und sortierte ihn anschliessend.
- **`in_sets` ist Opt-in** (`with_sets=1`). `STRING_AGG(DISTINCT set_number)`
  kostet 155 ms und 2 MB, wird aber nur in der Tabellenspalte „Sets" gebraucht.
- **Die drei Abfragen laufen parallel** statt nacheinander, und das
  Manuell-Aggregat entfällt ganz, wenn `exclude_manual=1` gesetzt ist — dann
  kann keine Ergebniszeile davon betroffen sein.

### Frontend

Endlos-Scroll nach dem Muster des Katalogs: Sentinel plus
IntersectionObserver mit 600 px Vorlauf, Scroll-Fallback, Generationszähler
gegen späte Antworten verworfener Filterkombinationen.

Die eine Stelle mit echtem Aufwand ist die Gruppierung nach Farbe: Die
Kachelansicht setzt eine Zwischenüberschrift je Farbe, und eine Farbe kann über
eine Seitengrenze laufen. Da der Server nach `MIN(color_name), MIN(part_name)`
sortiert, kommen die Seiten farbsortiert an — die neue Seite hängt ihre ersten
Karten deshalb in die **bestehende** letzte Gruppe ein, statt eine zweite
Überschrift derselben Farbe zu erzeugen. Der Zähler in der Überschrift wächst
dabei mit; sonst stünde dort dauerhaft die Anzahl aus der ersten Seite.

`#parts-sentinel` steht statisch in `index.html` (wie `cat-sentinel`) und liegt
bewusst **neben** `#parts-main`: dessen Inhalt wird bei jedem Filter- und
Moduswechsel ersetzt, der Sentinel muss das überleben. Die beiden dynamischen
Container sprechen über Klassen an, nicht über IDs — sie sind Kinder, keine
Seiten-Landmarken.

**Nebenbei entfernt:** Der Client deduplizierte nach `bl_part_number|color_id` —
genau danach gruppiert der Server bereits, die Schleife lief also über alle
Zeilen und fand nie ein Duplikat. Ausserden standen `grouped`/`deduped0` und
`grouped2`/`deduped` nebeneinander; die erste Fassung wurde gebaut und nie
benutzt.

### Test

`test/parts-paging.test.js` (8 Fälle, jsdom, ohne DB): Gruppenbildung,
Fortsetzung einer Farbe über die Seitengrenze ohne zweite Überschrift,
mitwachsender Zähler, Tabellenansicht hängt an denselben `tbody` an,
Moduswechsel räumt auf, und die Anfrageparameter inklusive `with_sets` nur im
Tabellenmodus.

Stand: `tsc --noEmit` sauber, `npm test` 89 + 2 Integrationssuiten = **91
bestanden, 0 rot**.

---
## Fix: Marktpreise wurden zu niedrig geladen (10290-1)

**Gemeldet:** 10290-1 zeigt CHF 92.68, obwohl nur eine Neu-Erfassung existiert
und BrickLink für Neu einen Avg Price von US$ 148.72 ausweist.

**Drei Ursachen, alle in dieselbe Richtung wirkend.**

*1. Die Zustandssortierung war falsch herum.* In `routes/sets.ts` an vier
Stellen und in `routes/finance.ts`:

```sql
ORDER BY (qty_avg_price > 0 OR avg_price > 0) DESC, (condition = $3) DESC LIMIT 1
```

„Hat überhaupt einen Preis" stand vor „passender Zustand". Lag ein
Gebraucht-Preis im Cache und der Neu-Eintrag war leer oder 0, gewann Gebraucht —
auch wenn ausdrücklich Neu angefragt wurde.

*2. `qty_avg_price` wurde `avg_price` vorgezogen.* Der mengengewichtete Schnitt
liegt systematisch unter dem, was BrickLink als „Avg Price" anzeigt. Dazu eine
JavaScript-Falle: Postgres liefert NUMERIC als String, und `"0.00"` ist truthy —
`qty_avg_price || avg_price` ergab damit 0 statt auf einen gültigen `avg_price`
auszuweichen.

*3. `getPriceGuide()` hatte `condition = 'U'` als Vorgabe*, schrieb also ohne
expliziten Zustand den Gebraucht-Preis in den Cache.

**Neu: Bewertung je Erfassung** (`utils/setValue.ts`)

Jede Erfassung wird mit dem `avg_price` **ihres** Zustands bewertet:

```
Gesamtwert = Σ (Menge_i × avg_price[Zustand_i])
Stückpreis = Gesamtwert / Σ Menge_i
```

Damit gilt:

| Zusammensetzung | Stückpreis (Anzeige) | Summe (Finanzen) |
|---|---|---|
| 1× Neu | `neu` | `neu` |
| 1× Neu, 1× Gebraucht | `(neu + gebraucht) / 2` | `neu + gebraucht` |
| 2× Neu, 1× Gebraucht | `(2·neu + gebraucht) / 3` | `2·neu + gebraucht` |

Die ersten beiden Zeilen sind genau deine Vorgabe. Die dritte ist die
Verallgemeinerung — sie ergibt sich zwangsläufig daraus, dass Anzeige × Menge
immer die Summe ergeben muss. Ein reiner Mittelwert über die vorkommenden
Zustände würde bei ungleichen Stückzahlen von der Summe abweichen.

Fehlt der Preis für einen Zustand, wird auf den anderen ausgewichen. Fehlt jeder
Preis, ist das Ergebnis `null` und nicht `0` — eine 0 sähe in den Summen wie ein
bekannter Wert von null Franken aus.

**Angepasst:** Alle fünf Set-Preis-Lookups in `routes/sets.ts` und
`routes/finance.ts` lesen jetzt `avg_price` und filtern strikt auf den
angefragten Zustand. Die Finanzsumme läuft über `valueSet()`; dabei war
aufzupassen, dass die Menge nicht doppelt multipliziert wird — `setPriceMap`
hält seit der Umstellung den Gesamtwert, nicht den Stückpreis.

Teile- und Minifiguren-Preise (`part_price_cache`, `minifig_price_cache`) sind
unverändert; dort gilt dieselbe Fragestellung, sie war aber nicht Gegenstand der
Meldung.

**Test.** `test/set-value.test.js` (10 Fälle, ohne DB): der gemeldete Fall
10290-1, die Mischung neu/gebraucht, die Konsistenz von Anzeige × Menge, das
Ausweichen bei fehlendem Preis, `null` statt `0`, sowie statische Prüfungen,
dass weder `qty_avg_price` in Set-Abfragen noch die alte Sortierung
zurückkommen.

**Offen:** `guide_type` steht weiterhin auf `'stock'` (aktuelle Angebote) statt
`'sold'` (verkauft, letzte sechs Monate). Für „was ist meine Sammlung wert" ist
`sold` in der Regel die ehrlichere Grundlage. Das ist eine fachliche
Entscheidung, die ich nicht ungefragt getroffen habe.

---
## Nachtrag: `guide_type` auf `sold` + Zustands-Fallback wiederhergestellt

**`sold` statt `stock`** — an allen sechs Stellen: der Vorgabewert in
`getPriceGuide()`, die Einstellung `price_guide_type` in `routes/api_v1/sets.ts`
und `utils/financeCalc.ts`, die beiden hartkodierten Minifiguren-/Teile-Abrufe
in `financeCalc.ts` und die zwei Vorgaben in `jobs/priceJob.js`. Damit zählen
tatsächlich erzielte Preise der letzten sechs Monate statt eingestellter
Angebote.

**Fallback zwischen den Zuständen** — im vorherigen Schritt hatte ich die
Lookups strikt auf den angefragten Zustand gesetzt und damit das Ausweichen
mitentfernt. Es ist zurück, aber mit der richtigen Priorität:

```sql
WHERE set_number=$1 AND currency_code=$2
  AND condition IN ('N','U') AND avg_price > 0
ORDER BY (condition = $3) DESC LIMIT 1
```

Der angefragte Zustand gewinnt **immer**, wenn er einen Preis hat. Der andere
kommt nur zum Zug, wenn dort keiner steht — `avg_price > 0` filtert leere
Einträge vorher weg. Genau umgekehrt war der ursprüngliche Fehler: dort stand
„hat einen Preis" vor „passender Zustand", weshalb ein neues Set den
Gebraucht-Preis bekam.

In `utils/setValue.ts` macht `priceFor()` dasselbe auf Anwendungsebene, und
`utils/financeCalc.ts` hatte die Mechanik mit `is_fallback` / `condition_used`
ohnehin schon.

**Der Preisjob holt jetzt alle benötigten Zustände.** Bisher wurde je Set genau
ein Zustand abgerufen und nur bei komplett fehlendem Preis auf den anderen
ausgewichen. Mit der zustandsabhängigen Bewertung braucht ein Set mit einem
neuen *und* einem gebrauchten Exemplar aber beide Preise im Cache — sonst fehlt
dauerhaft eine Hälfte der Rechnung. `conditionsNeededFor()` liest die
tatsächlich vorkommenden Zustände aus `set_acquisitions`; reine Sets kosten
weiterhin genau einen Abruf, gemischte zwei.

**Teilepreise** (`routes/parts.ts`) lesen ebenfalls `avg_price` statt
`qty_avg_price` — dieselbe Begründung wie bei den Sets, inklusive der
`"0.00"`-Truthiness.

**Test.** `test/set-value.test.js` auf 13 Fälle erweitert: kein `'stock'` mehr
in Vorgaben oder Abfrageparametern, jede Fallback-Abfrage muss `avg_price > 0`
und `ORDER BY (condition = $n) DESC` führen und darf die alte Sortierung nicht
zurückbringen, und der Preisjob muss die Zustände aus den Erfassungen ableiten.

Stand: `tsc --noEmit` sauber, `npm test` 102 bestanden, 0 rot, 2 übersprungen
(die Postgres-Suiten — der Container wurde zwischenzeitlich neu gestartet).

---
## Mobile-Version (Stufe 1 + 2) und seitenweise Teileliste

### Mobile

`public/mobile.css` (neu), `public/js/10-mobile.js` (neu), `index.html`

Alle Responsive-Regeln liegen in **einer** Datei, geladen nach `styles.css` und
nach dem Theme. Grund: Das Layout ist in beiden Designs identisch — `brick.css`
besteht fast nur aus Farbvariablen und Dekoration, nur 14 seiner 66 Regeln
fassen überhaupt Layout an. Die Regeln gelten damit für classic **und** brick,
und für jedes künftige Design gratis. Ein klar markierter Block am Ende deckt
die Stellen ab, an denen Brick eigenes Layout mitbringt (Noppenreihen,
Innenabstände, `.brick-stats`).

Breakpoints: 900 px (mehrspaltiges einspaltig), 640 px (Telefon), 380 px
(Feinschliff).

**Stufe 1** — Touch-Ziele ≥ 42 px, `font-size:16px` in Eingabefeldern (darunter
zoomt iOS beim Fokussieren hinein), Innenabstände, Grid-Dichte, die zwei
Admin-Tabellen ohne `.tw`-Wrapper nachgerüstet.

Die rund 90 Inline-Styles mit festen px-Breiten — darunter
`style="table-layout:fixed;width:1065px"` in vier Finanztabellen — werden gezielt
per `!important` überstimmt, statt 90 Stellen im JS umzubauen. `!important`
steht deshalb nur dort, wo nachweislich ein Inline-Style dagegenhält.

**Stufe 2** — Tabellen werden unter 640 px zu Kartenlisten, Modals zu Sheets
(`border-radius` oben, `env(safe-area-inset-bottom)`), Toasts über die volle
Breite, Login- und Startup-Screen mit angepassten Abständen.

Für die Kartenlisten braucht jede `<td>` die Beschriftung ihrer Spalte.
`10-mobile.js` stempelt sie per MutationObserver nachträglich aus dem `<thead>`
— damit musste **kein** einziges der zehn Tabellen-Templates in sechs Dateien
angefasst werden, und künftige Tabellen bekommen das Verhalten automatisch.
Mehrzeilige Köpfe (Finanztabellen) und `colspan` sind berücksichtigt.

**Abweichung von meiner Schätzung:** Ich hatte eine Bottom-Navigation
vorgeschlagen. Bei acht Reitern müsste die ebenfalls scrollen, womit ihr
einziger Vorteil entfällt. Stattdessen bleibt die horizontale Leiste, bekommt
aber Snap-Punkte, ein Rand-Fade und grössere Trefferflächen; `10-mobile.js`
scrollt den aktiven Reiter in den sichtbaren Bereich. Unter 380 px zeigen
inaktive Reiter nur noch ihr Icon.

### Teileliste seitenweise mit Endlos-Scroll

`public/js/03-parts.js`, `index.html`

Muster wie im Katalog: Sentinel plus IntersectionObserver mit 600 px Vorlauf,
Scroll-Fallback, Generationszähler gegen späte Antworten. Seitengrösse 100.

Die eine Stelle mit echtem Aufwand ist die Farbgruppierung: Der Server sortiert
nach `MIN(color_name), MIN(part_name)`, eine Farbe kann also über eine
Seitengrenze laufen. Die Folgeseite hängt ihre ersten Karten deshalb in das
**bestehende** letzte Raster ein, statt eine zweite Überschrift derselben Farbe
zu erzeugen — inklusive Hochzählen des Zählers in der Überschrift.

Weitere Details:
- Der Sentinel steht **neben** `#parts-main`, nicht darin — dessen Inhalt wird
  bei jedem Filterwechsel ersetzt und der Observer verlöre sein Ziel.
- Nachgeladen wird nur, solange der Teile-Tab sichtbar ist.
- Füllt die erste Seite den Bildschirm nicht, gäbe es nie ein Scroll-Ereignis —
  dann wird per `requestAnimationFrame` direkt nachgelegt.
- `with_sets=1` geht nur noch in der Tabellenansicht raus, die als einzige eine
  Sets-Spalte hat.
- Die clientseitige Deduplizierung ist entfallen: Der Server gruppiert bereits
  nach `COALESCE(bl_part_number, part_number)` und `color_id`, die Schleife fand
  nie ein Duplikat. Ebenso die doppelt gebauten `grouped`/`deduped0`-Fassungen,
  die nur erzeugt und nie benutzt wurden.

**Wirkung**, gemessen an 380 Sets / 171'000 Zeilen: erste Seite 0,03 MB statt
20,65 MB, 100 Kacheln statt zehntausende.

### Tests

| Datei | Fälle |
|---|---|
| `test/mobile.test.js` | 10 — Beschriftung aus dem Kopf, mehrzeilige Köpfe, `colspan`, nachträglich eingefügte Tabellen, keine Doppelverarbeitung, `mobile.css` steht vollständig in Media Queries, Ladereihenfolge in `index.html` |
| `test/parts-paging.test.js` | 10 — Seitenparameter, Gruppenfortsetzung, Generationszähler, alle Filter lösen Neuaufbau aus, Sentinel ausserhalb von `#parts-main`, kein Nachladen im Hintergrund |

Stand: `tsc --noEmit` sauber, `npm test` **144 bestanden, 0 rot, 0 übersprungen**
— inklusive beider Postgres-Integrationssuiten.

---
## Fix: Erste Teile im Reiter „Teile" brauchten ~3 Sekunden

**Gemeldet:** Im Reiter „Teile" dauert es rund drei Sekunden, bis die ersten
Set-Teile erscheinen. Manuell erfasste Teile sind sofort da.

Der zweite Teil der Meldung war der entscheidende Hinweis: Manuelle Teile laufen
über eine eigene Abfrage ohne die vorberechnete Zusammenfassung.

**Ursache.** `ensureFresh()` in `utils/partsSummary.ts` baute die
Zusammenfassung **im Request** neu auf:

```ts
if (state && parseInt(state.built_version) === v) return true;
await rebuild(userId, v);      // ← hier hing die Anfrage
return true;
```

Die Entwertung hängt an einem Statement-Trigger auf `parts` und `sets` — das ist
richtig so, kein Schreibpfad kann daran vorbei. Nur bedeutet es eben auch: Jede
Änderung an `parts` setzt die Version hoch, und der nächste Aufruf des Reiters
zahlt den vollen Aufbau. Und `parts` ändert sich ständig — CSV-Import, Set
hinzufügen, Katalog-Anreicherung, Bild-Backfill.

Gemessen an 380 Sets / 171'000 Zeilen: **3016 ms** für den Aufbau.

**Lösung.** Der Aufbau läuft nicht mehr im Request:

| Zustand | Verhalten |
|---|---|
| aktuell | sofort aus der Zusammenfassung |
| veraltet, aber vorhanden | sofort mit dem **alten** Stand; Aufbau im Hintergrund |
| gar nicht vorhanden | Live-Abfrage (langsamer, aber korrekt); Aufbau im Hintergrund |

Eine `Map` verhindert, dass parallele Anfragen denselben Aufbau mehrfach
starten. Für Stellen, die anschliessend garantiert aktuelle Zahlen brauchen,
gibt es `rebuildNow()`.

Gemessen nach dem Fix:

```
Zusammenfassung aktuell                        27 ms
nach einer Änderung an parts                   31 ms   (vorher 3016 ms)
nach dem Hintergrundaufbau                     36 ms
```

**Der Preis dafür:** Direkt nach einer Änderung kann ein einzelner Seitenaufruf
den vorherigen Stand zeigen. Löschst du ein Set und öffnest sofort „Teile",
erscheinen dessen Teile unter Umständen noch einmal — der nächste Aufruf ist
wieder korrekt. Das halte ich gegenüber drei Sekunden Wartezeit für den besseren
Handel, aber es ist eine bewusste Abwägung: Wenn dir Aktualität wichtiger ist,
ist `rebuildNow()` an den Schreibpfaden der Hebel.

**Test.** `test/parts-summary.test.js` um einen Fall erweitert: `ensureFresh()`
darf kein `await rebuild(...)` enthalten, muss in den Hintergrund delegieren und
bei fehlendem Stand `false` liefern. Der bestehende Inhaltstest wurde an die neue
Semantik angepasst — er prüft jetzt zusätzlich, dass ein Lesezugriff nach einer
Änderung den alten Stand liefert statt zu warten.

Stand: `tsc --noEmit` sauber, **150 Tests, alle grün, nichts übersprungen**
(in Blöcken gefahren, weil der Gesamtdurchlauf mein Zeitlimit sprengt).

---
## Nachtrag: Punkt 5 und 6 der Optimierungsliste

**Korrektur vorweg:** Punkt 1 (Session-Rotation) war bereits umgesetzt —
`establishSession()` in `utils/auth.ts` macht `regenerate()` plus `save()` und
wird von beiden Login-Wegen benutzt. Ich hatte bei der Prüfung nur `routes/` und
`server.ts` durchsucht und die Lücke daraufhin fälschlich als offen gemeldet.

**Punkt 5 — Vorschaubilder in der Galerie**
`public/js/02-gallery.js`

`thumbUrl()` greift nur bei lokal abgelegten Bildern (`_thumb`-Variante). Sets
ohne lokale Kopie kamen über den Proxy in voller Auflösung — in der Kachel wie
in der 36-px-Tabellenzelle. Beide laufen jetzt über `imgUrl(…, true)` und damit
über die serverseitige Verkleinerung, die für die Teileansicht schon existierte.

**Punkt 6 — `qty_avg_price` als Wert**
`utils/financeCalc.ts`, `routes/finance.ts`

Von den 44 Fundstellen sind die meisten Spaltennamen in `INSERT`/`SELECT` und
Feldnamen der Antwortobjekte — die bleiben, sie sind Verträge nach aussen.
Umgestellt wurden die vier Stellen, an denen der Wert tatsächlich in eine
Rechnung eingeht (`unitVal` an zwei Stellen, `priceMap`/`firstHistMap` in der
Verlaufsberechnung). Überall gilt jetzt `avg_price` zuerst, `qty_avg_price` nur
als Rückfall — inklusive der `"0.00"`-Truthiness, die den gültigen Wert
verdecken konnte.

`routes/finance.ts` las bereits `avg_price` für die Teile- und
Minifiguren-Karten.

Stand: `tsc --noEmit` sauber, **151 Tests, alle grün, nichts übersprungen.**

---
## Punkt 4 (Teil 1): Galerie lädt seitenweise

`utils/handlers.ts`, `routes/sets.ts`, `routes/api_v1/sets.ts`,
`public/js/02-gallery.js`, `index.html`

**Der Knackpunkt war nicht die Paginierung selbst**, sondern dass die Galerie
clientseitig filterte und sortierte — über `allSets`, also über den kompletten
Bestand. Mit seitenweisem Laden geht das nicht zusammen: Ein Filter hätte nur
die bereits geladene Seite durchsucht, eine Sortierung nur eine Teilmenge
geordnet. Beides liegt deshalb jetzt auf dem Server.

`getSets(userId, query)` nimmt `search`, `theme`, `sort`, `page` und
`page_size`. Die Sortierschlüssel stehen in einer Whitelist (`SET_SORTS`) — der
Wert kommt aus einem `<select>` und darf nie ungeprüft in die `ORDER BY`-Klausel;
ein unbekannter Wert fällt auf `added_desc` zurück. Der Suchbegriff wird
gebunden, nicht interpoliert.

**Rückwärtskompatibel:** Ohne `page_size` verhält sich der Endpunkt exakt wie
bisher und liefert alles. Die Android-App ruft ihn so auf und bleibt unverändert
lauffähig — der Paritätstest bestätigt das.

**Themenliste:** Kommt jetzt vom Server (`SELECT DISTINCT theme`), sonst wäre
das Auswahlfeld nach dem ersten Ladevorgang unvollständig. Nur bei Seite 1, die
Folgeseiten sparen die Abfrage. Die Namen werden beim Rendern escaped — sie
stammen aus Rebrickable-Daten und wurden vorher roh ins `<option>` geschrieben.

**Client:** Endlos-Scroll nach demselben Muster wie Katalog und Teileansicht —
Sentinel neben `#gallery` (nicht darin, dessen Inhalt wird bei jedem
Filterwechsel ersetzt), IntersectionObserver mit 600 px Vorlauf,
Generationszähler gegen späte Antworten, Nachladen nur im sichtbaren Reiter.
Folgeseiten werden per `insertAdjacentHTML` angehängt statt die Wand neu zu
bauen — sonst würden alle Bilder erneut geladen.

Gemessen an 380 Sets:

```
ohne Paginierung (wie bisher)    40 ms   109 KB
Seite 1 (60 Sets)                22 ms    17 KB
Seite 2                           5 ms
gefiltert (search=100)            5 ms   101 Treffer
sortiert (name_asc)               3 ms
unbekannte Sortierung → Fallback, keine Injektion
```

**Test.** `test/gallery-paging.test.js` (8 Fälle): Whitelist statt
Interpolation, gebundener Suchbegriff, Rückwärtskompatibilität ohne `page_size`,
Themenliste vom Server und escaped, `renderGallery()` filtert/sortiert nicht
mehr, alle drei Bedienelemente lösen einen Neuaufbau aus, Sentinel-Platzierung,
Anhängen statt Neubauen.

Stand: `tsc --noEmit` sauber, **159 Tests, alle grün, nichts übersprungen.**

**Noch offen aus Punkt 4:** `getMinifigs`, `getManualParts` und
`getManualMinifigs` — gleiches Muster, aber jeweils eigene Filterlogik im
Client, die mitgezogen werden muss.

---
## Punkt 4 (komplett) und Punkt 3

### Punkt 4, Teil 2: Minifiguren und manuelle Listen

`utils/handlers.ts`, `routes/minifigs.ts`, `routes/api_v1/minifigs.ts`,
`public/js/06-minifigs.js`, `index.html`

`getMinifigs()` hatte Suche und Quellenfilter schon serverseitig — es fehlten
nur `page`/`page_size`. Beim Zähler war Sorgfalt nötig: Die Abfrage gruppiert
pro Figur (`GROUP BY LOWER(TRIM(fig_number)), source`), ein `COUNT(*)` über die
Zeilen hätte eine Figur aus fünf Sets fünfmal gezählt. Der Zähler läuft deshalb
über dieselbe Gruppierung.

Im Client war der wichtigste Punkt der Ausschluss manueller Figuren. Der lief
als `.filter(f => f.source !== 'manual')` **nach** dem Laden — mit Seiten hätte
eine Seite, die nur manuelle Figuren enthält, eine scheinbar leere Liste
ergeben. Der Ausschluss geht jetzt als `source`-Parameter an den Server.
`filterFigs()` lädt neu, statt clientseitig zu filtern.

`getManualParts()` und `getManualMinifigs()` haben ebenfalls `page`/`page_size`
bekommen, mit gebundenen LIMIT/OFFSET-Parametern.

### Punkt 3: Rate-Limits in die Datenbank

`utils/loginLimiter.ts`, `db/database.ts`, `routes/auth.ts`,
`routes/api_v1/auth.ts`

Die Zähler lagen im Prozessspeicher. Der Server läuft im Cluster mit
`WEB_WORKERS` Prozessen (Vorgabe: Anzahl CPU-Kerne), und jede Anfrage kann in
einem beliebigen davon landen — aus fünf Fehlversuchen wurden faktisch N×5, auf
einem Achtkerner also vierzig. Der Kommentar im Code nannte das „völlig
ausreichend"; das gilt für gelegentliches Raten, nicht für einen automatisierten
Angriff.

Neu: Tabelle `rate_limit_attempts`. Das Hochzählen passiert atomar in **einem**
Statement — `ON CONFLICT (key) DO UPDATE` mit einem `CASE`, das ein abgelaufenes
Fenster gleich mit zurücksetzt. Kein SELECT-dann-UPDATE, also kein Race zwischen
parallelen Versuchen.

Kosten: ein Primärschlüssel-Lookup pro Login-Versuch, ein UPSERT je Fehlversuch.

**Rückfallebene:** Ist die Datenbank nicht erreichbar, greift der alte
In-Memory-Zähler. Ein schwächeres Limit ist besser als ein Login, der gar nicht
mehr funktioniert.

**Fallstrick beim Umbau:** `checkLoginAllowed()` ist jetzt asynchron. Ein
vergessenes `await` hätte ein Promise geliefert — immer truthy, also **jeder**
Login gesperrt. Alle vier Aufrufstellen sind umgestellt, ein Test prüft das.

Verifiziert gegen die laufende Datenbank: fünf Fehlversuche sperren, ein anderer
Benutzername ist davon unberührt, ein erfolgreicher Login räumt die Zeile weg.

### Tests

`test/gallery-paging.test.js` auf 13 Fälle erweitert (Minifiguren, Zähler über
die Gruppierung, serverseitiger Quellenfilter, manuelle Listen, Sentinels),
`test/rate-limit.test.js` auf 11 (Tabelle, atomares Hochzählen, Rückfallebene,
`await` an allen Aufrufstellen).

Stand: `tsc --noEmit` sauber, **168 Tests, alle grün, nichts übersprungen.**

**Noch offen:** Punkt 7 (LISTEN/NOTIFY), Punkt 9 (AppNavigation.kt aufteilen),
Punkt 10 (jobs nach TypeScript).

---
## Punkt 2 (Teil 1): Inline-Handler raus aus index.html

`public/js/11-actions.js` (neu), `public/index.html`, `public/styles.css`

**Ziel:** `script-src 'unsafe-inline'` aus der CSP entfernen. Solange irgendwo
`onclick="…"` im Markup steht, muss der Browser Inline-Skript erlauben — und
damit fehlt genau die Verteidigungslinie, die bei einer übersehenen XSS-Lücke
greifen würde.

**Ansatz:** Statt 140 Handler einzeln in `addEventListener` zu übersetzen, gibt
es einen delegierten Dispatcher. Aus

```html
<button onclick="setChartPeriod('year')">
<div onclick="openModal('${escJs(s.set_number)}')">
```

wird

```html
<button data-click="setChartPeriod" data-arg="year">
<div data-click="openModal" data-arg="${esc(s.set_number)}">
```

Der Dispatcher schlägt den Namen in `window` nach — **kein `eval`, kein
`new Function`**, sonst bräuchte es `'unsafe-eval'` und das Problem wäre nur
verschoben. Unbekannte Namen melden sich in der Konsole, statt stumm nichts zu
tun.

**Nebeneffekt, der mir wichtiger ist als die CSP selbst:** Der ganze
`escJs`-Kontext verschwindet. Ein Wert in einem `data`-Attribut wird nie als
Code gelesen — es gibt keinen JS-String mehr, aus dem ein Apostroph ausbrechen
könnte. Genau diese Klasse Fehler hatte die Escaping-Härtung zu Beginn
beschäftigt.

**Erledigt:** Alle 44 Inline-Handler in `index.html`. Vier brauchten eine
benannte Funktion (`closePwModal`, `closeImportProgress`, `lightboxBackdrop`,
`openImageLightboxFromEl`), zwei Hover-Effekte sind ins Stylesheet gewandert
(`.hover-row:hover`), und die `onerror`/`onload`-Attribute übernimmt ein
Capture-Handler am `document` — beide Ereignisse steigen nicht auf.

**Test.** `test/csp-actions.test.js` (6 Fälle): keine Inline-Handler mehr in
`index.html`, kein `eval` im Dispatcher, **jeder referenzierte Handlername
existiert tatsächlich** (das ist der wichtigste — ein Tippfehler wäre sonst erst
im Browser aufgefallen), Capture-Phase für Bildfehler, Hover im Stylesheet.

### Noch offen

93 Inline-Handler in den generierten Templates:

| Datei | Anzahl |
|---|---|
| `07-admin.js` | 33 |
| `01-core.js` | 17 |
| `02-gallery.js` | 15 |
| `06-minifigs.js` | 9 |
| `03-parts.js` | 7 |
| `04-finance.js` | 4 |
| übrige | 8 |

**Die CSP bleibt bis dahin unverändert.** Sie erst zu schliessen, wenn noch 93
Handler inline sind, würde die halbe Oberfläche lahmlegen — der Gewinn entsteht
ausschliesslich am Ende.

Stand: `tsc --noEmit` sauber, 174 Tests grün.

---
## Punkt 2 (Teil 2): Templates — 87 von 137 Handlern konvertiert

Der Dispatcher kann jetzt mehr, weil die Templates mehr brauchen:

- **`data-arg` bis `data-arg4`** für mehrere Parameter
- **`data-val="1"`** hängt den aktuellen Feldwert an — deckt die Handler ab, die
  früher `this.value` gelesen haben
- **`data-onerror="hide" | "clear"`** für die beiden Bildfehler-Varianten aus den
  Templates; ohne Angabe greift der Rückfall auf `data-orig`
- **`data-fade="1"`** ersetzt `onload="this.classList.add('loaded')"`

`fn.apply(el, args)` — `this` bleibt das auslösende Element, wie beim
Inline-Handler.

**Stand: 87 von 137 konvertiert, 50 offen.** Verteilung der Reste:

| Datei | offen |
|---|---|
| `07-admin.js` | 20 |
| `01-core.js` | 11 |
| `02-gallery.js` | 6 |
| `06-minifigs.js` | 6 |
| `04-finance.js` | 3 |
| übrige | 4 |

Was daran nicht mechanisch geht: `event.stopPropagation()` vor dem eigentlichen
Aufruf (Löschknopf auf einer klickbaren Kachel), `if(event.key==='Enter')
{this.blur()}`, verschachtelte Ausdrücke wie
`onerror="this.src='${escJs(imgUrl(…))}';this.onerror=null"` und ein Fall, in
dem der Handler selbst aus einer Variablen kommt (`onclick="${onclickAttr}"`).
Jeder davon braucht eine eigene kleine Funktion — das ist Handarbeit, keine
Regel.

**Die CSP bleibt weiterhin offen.** Sie zu schliessen, solange 50 Handler inline
sind, würde diese Bedienelemente stumm machen.

**Test.** `test/csp-actions.test.js` auf 9 Fälle erweitert. Der wichtigste:
Jeder in den Templates referenzierte `data-click`/`data-change`-Name muss als
Funktion existieren — ein Tippfehler beim Konvertieren wäre sonst erst beim
Klicken aufgefallen. Alle 87 bestehen diese Prüfung.

Stand: `tsc --noEmit` sauber, 177 Tests grün.

---
## Punkt 2 abgeschlossen: CSP ohne `unsafe-inline`

Alle **137** Inline-Handler sind ersetzt, die CSP ist geschlossen:

```
script-src 'self' https://cdnjs.cloudflare.com
```

Damit greift sie erstmals als zweite Verteidigungslinie — bei einer übersehenen
XSS-Lücke würde eingeschleustes `<script>` nicht mehr ausgeführt. Vorher hätte
`'unsafe-inline'` genau das erlaubt.

### Wie die letzten 45 gelöst wurden

Der Dispatcher hat dafür drei Erweiterungen bekommen:

- **`data-self="1"`** — Element als erstes Argument, für Handler wie
  `triggerCsvSync(this)`
- **`data-arg` bis `data-arg6`** — `manAcqSave` trägt fünf Parameter
- **`data-val="1"`** — hängt den Feldwert an, für die elf Handler, die früher
  `this.value` gelesen haben

Dazu elf benannte Wrapper für das, was sich nicht in Attribute übersetzen lässt:
`stopEvent`, `blurOnEnter`, `delSetStop`, `deleteManualFigStop`,
`openPdfViewerLink` (mit `preventDefault` statt `return false`), `mQtyDec`,
`mQtyInc`, `saveJobTime`, `saveJobMinutes`, `saveManualFigBl`,
`clickJobTrigger`.

Der Bildfehler-Handler kennt jetzt drei Modi (`hide`, `clear`, `placeholder`)
plus den Standardfall mit Rückfall auf `data-orig`.

**Nebenbefund:** `pmRow()` in `04-finance.js` hatte einen dritten Parameter
`onclickAttr`, den keiner der beiden Aufrufer je gesetzt hat — ein toter Zweig,
der einen Inline-Handler erzeugt hätte. Entfernt.

### Was `style-src` angeht

`style-src` behält `'unsafe-inline'`. Die Templates setzen an vielen Stellen
`style="…"` für berechnete Werte (Fortschrittsbalken, Farbpunkte). Das ist eine
deutlich harmlosere Klasse als ausführbares Skript und wäre ein eigener Umbau.

### Test

`test/csp-actions.test.js` (10 Fälle). Die beiden entscheidenden:

- **Kein Inline-Handler mehr**, weder in `index.html` noch in den Templates. Das
  Muster schliesst `data-onerror` aus und verlangt `="` — `el.onclick = fn` in
  JavaScript ist CSP-konform und darf bleiben.
- **Jeder referenzierte Handlername existiert als Funktion.** Bei 137
  Konvertierungen ist ein Tippfehler sonst erst beim Klicken aufgefallen.

Dazu: kein `eval`/`new Function` im Dispatcher, `script-src` ohne
`unsafe-inline`, Capture-Phase für Bildfehler, alle drei Fehlermodi vorhanden.

Stand: `tsc --noEmit` sauber, **179 Tests, alle grün, nichts übersprungen.**

### Was du prüfen musst

Ich kann verifizieren, dass jeder Handlername existiert — **nicht**, ob jeder
Knopf noch das Richtige tut. Ein falsch zugeordnetes `data-arg` wäre ein Knopf,
der stumm etwas anderes macht. Vor dem Produktivgang bitte einmal durchklicken,
mit offener Browser-Konsole: Der Dispatcher meldet jeden unbekannten Handler mit
`[actions] unbekannter Handler: …`.

Besonders ansehen würde ich mir die Kaufpreis-Dialoge (`acqSave`, `manAcqSave` —
die meisten Parameter), die Löschknöpfe auf klickbaren Kacheln
(`event.stopPropagation`) und die Job-Steuerung im Monitoring (`data-self`).

---
## Punkt 9: AppNavigation.kt aufgeteilt — UNGEPRÜFT

**Diese Änderung ist nicht kompiliert.** Hier gibt es kein Android-SDK, und
anders als PostgreSQL lässt es sich nicht aus dem Ubuntu-Archiv nachinstallieren.
Ich hatte davon abgeraten; auf ausdrücklichen Wunsch ist sie trotzdem drin.
Behandle sie als Entwurf, nicht als fertigen Stand.

**Was gemacht wurde.** Die 16 Navigationsziele sind in vier Dateien unter
`ui/../nav/` gewandert:

| Datei | Ziele | Zeilen |
|---|---|---|
| `nav/AuthGraph.kt` | Setup, Login | 110 |
| `nav/CollectionGraph.kt` | Gallery, SetDetail, Parts, Minifigs, Comparison, AcquisitionManagement | 250 |
| `nav/CatalogGraph.kt` | Catalog, CatalogDetail | 120 |
| `nav/ToolsGraph.kt` | Finance, BarcodeScanner, PartsList, Settings, Monitoring, PdfViewer | 180 |

`AppNavigation.kt` schrumpft von **627 auf 239 Zeilen**; der `NavHost`-Rumpf
sind vier Aufrufe.

**Bewusst mechanisch.** Die Blöcke sind Zeile für Zeile unverändert übernommen.
Die einzige Änderung: Werte, die vorher aus dem umgebenden Scope eingefangen
wurden, kommen jetzt als Parameter herein. Ich habe je Ziel ermittelt, welche
das sind (`vm`, `navController`, `state`, `manDetailState`, `imageLoader`,
`bottomNavItems`, `snackbarHostState`, `activity`), und jeder Graph-Funktion
genau die gegeben, die ihre Ziele brauchen.

Der Grund für diesen Zuschnitt: Ein fehlender oder falsch typisierter Parameter
ist ein **Compilerfehler** — laut und sofort. Hätte ich stattdessen umgebaut,
wie der Zustand gelesen wird, wäre das Fehlerbild eine App, die baut, aber deren
Ansicht bei bestimmten Änderungen nicht mehr aktualisiert. Das hätte ich nicht
erkennen können.

**Prüfungen, die ohne Compiler möglich waren:** Alle 16 Ziele sind genau einmal
vorhanden, in `AppNavigation.kt` ist keines mehr übrig, und die Klammerbilanz
stimmt in allen fünf Dateien.

**Was du machen musst:**

1. `./gradlew assembleDebug` — hier fallen fehlende Importe und Typen auf. Ich
   habe `NavGraphBuilder`, `NavHostController`, `NavType`, `navArgument` sowie
   `ch.brickinventoryapp.*` und `ui.screens.*` ergänzt, aber die Importliste ist
   aus `AppNavigation.kt` kopiert und enthält vermutlich Überflüssiges.
2. Danach durch alle Reiter navigieren, inklusive Detailseiten und Rücksprüngen.

**Wenn es Ärger macht:** Die vier Dateien löschen und `AppNavigation.kt` aus dem
vorherigen ZIP zurückholen — die Aufteilung ist vollständig isoliert, sonst
wurde nichts angefasst.

---
## Punkt 8: Lokale Persistenz — als Plattenspeicher statt Room

**Ich habe den Zuschnitt geändert und erkläre warum.** Empfohlen hatte ich
„Room-Persistenz". Beim Umsetzen zeigte sich, dass Room hier das falsche
Werkzeug ist:

- Die App fragt **ganze Listen** ab und ersetzt sie ganz. Es gibt keine
  Teilaktualisierungen, keine Joins, keine Abfragen über den Cache — nichts,
  wofür man eine relationale Schicht baut.
- Room verlangt Entities, DAOs, TypeConverter für verschachtelte Listen
  (`SetItem.instructions`), eine Datenbankklasse, ein Hilt-Modul und eine zweite
  KSP-Verarbeitung. Jede dieser Stellen ist ein Fehler, der erst beim
  Kompilieren auffällt — und kompilieren kann ich hier nicht.
- Alle Modelle sind bereits `@Serializable`, kotlinx.serialization ist
  eingebunden. Der Plattenspeicher braucht damit **keine neue Abhängigkeit und
  keine Änderung am Build**.

Der Nutzen für dich ist derselbe: Die App ist nach dem Start sofort gefüllt und
bleibt ohne Netz benutzbar, statt bei jedem Öffnen alles neu zu laden und
offline leer zu bleiben.

**`data/cache/ResponseCache.kt` (neu).** Datei je Schlüssel, atomar geschrieben
(`.tmp` + rename, damit nie eine halbe Datei gelesen wird), Formatversion im
Verzeichnisnamen. Ändert sich ein Modell, wird `VERSION` erhöht und alles Alte
ist schlicht nicht mehr auffindbar — kein Migrationsproblem.

**Reihenfolge ist bewusst „erst Netz, dann Cache".** Der Server bleibt die
Wahrheit; der Cache springt nur ein, wenn der Abruf scheitert. Cache-First würde
frische Daten verdrängen.

Gecacht werden die vier Listen, die den Start ausmachen: `sets`, `minifigs`,
`stats`, `catalog-meta`, dazu die ungefilterte erste Teileseite. Für
Suchergebnisse wäre ein Cache wertlos.

**Beim Abmelden wird geleert** (`repo.clearCache()` in `logout()`) — sonst sähe
der nächste Nutzer auf demselben Gerät fremde Daten, bis der erste Abruf durch
ist.

**Test.** `ResponseCacheContractTest.kt` (4 Fälle, ohne Android): Die
Serialisierungsrunde muss für jede gecachte Antwortklasse verlustfrei sein —
inklusive verschachtelter Listen, also genau dort, wo Room TypeConverter
gebraucht hätte. Und: Unbekannte Felder dürfen einen alten Cache-Eintrag nicht
unlesbar machen, damit der Server seine Antwort erweitern kann.

**Ungeprüft wie Punkt 9** — kein Android-SDK. Die Fehlerfläche ist aber
erheblich kleiner als bei Room: eine neue Klasse, ein Konstruktorparameter, fünf
umgestellte Methoden, keine Annotationsverarbeitung. `./gradlew assembleDebug`
und ein Start im Flugmodus zeigen, ob es trägt.

---
