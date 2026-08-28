# Security-, Performance- und Architektur-Fixes

Umsetzung der Punkte aus dem Review. Reihenfolge wie dort priorisiert.
Verifiziert mit `npx tsc --noEmit` (sauber) und `npm test` (31 bestanden,
2 übersprungen — die beiden DB-Suiten brauchen `TEST_DATABASE_URL`).

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

## Korrektur: fehlender Import nach der Navigationsaufteilung

`AppNavigation.kt:234 — Unresolved reference 'authGraph'`

Die vier Graph-Funktionen liegen in `ch.brickinventoryapp.nav`, `AppNavigation.kt`
im Wurzelpaket `ch.brickinventoryapp`. Den Import dazwischen habe ich beim
Erzeugen schlicht vergessen — genau die Klasse Fehler, für die der Zuschnitt
gedacht war (Compilerfehler statt stiller Verhaltensänderung), nur eben eine,
die ich vorher hätte sehen können.

Ergänzt:

```kotlin
import ch.brickinventoryapp.nav.authGraph
import ch.brickinventoryapp.nav.collectionGraph
import ch.brickinventoryapp.nav.catalogGraph
import ch.brickinventoryapp.nav.toolsGraph
```

Gegenprobe: Alle vier in `nav/` definierten Funktionen werden in
`AppNavigation.kt` benutzt und sind jetzt alle importiert — keine weitere Lücke
dieser Art.

Die umgekehrte Richtung geprüft: Die nav-Dateien greifen auf `MainScaffold`
(Wurzelpaket), die Screens (`ui.screens`) und `Screen`/`AppUiState` (`ui`) zu.
Alle drei Pakete sind in jeder der vier Dateien per Wildcard importiert.

---

## Korrektur: doppelter Import in den nav-Dateien

`AuthGraph.kt:24 — Conflicting import: imported name 'AppUiState' is ambiguous`

Beim Erzeugen habe ich den Importblock aus `AppNavigation.kt` übernommen **und**
zusätzlich explizite Importe angehängt. `ch.brickinventoryapp.ui.AppUiState` kam
dadurch zweimal vor; Kotlin wertet einen doppelten expliziten Import desselben
Namens als Konflikt.

Entfernt: das jeweils zweite Vorkommen in allen vier Dateien. `AppUiState` bleibt
über `import ch.brickinventoryapp.ui.*` sichtbar, das in jeder Datei steht.

**Gegenprobe auf dieselbe Fehlerklasse:** Kein einziger Typname des Projekts
existiert in mehr als einem Paket — es gibt also keine echte Mehrdeutigkeit, die
über die Wildcard-Importe hereinkommen könnte. Nach dieser Bereinigung hat keine
der vier Dateien mehr einen doppelten Import.

---

## Korrektur: Inline-`<script>` blockiert nach dem CSP-Schluss

`Executing inline script violates 'script-src 'self' https://cdnjs.cloudflare.com'`

Bei der Handler-Umstellung habe ich ausschliesslich `on*="…"`-Attribute
gesucht — und die Skript**blöcke** nie angesehen. In `index.html` stand ein
`<script type="module">`, das PDF.js lädt und als `window.pdfjsLib`
bereitstellt. Eigene Fehlerklasse, gleiche Wirkung: Von `script-src` ohne
`'unsafe-inline'` wird das blockiert.

Der Block liegt jetzt in `public/js/pdfjs-boot.js` und ist als externe Datei von
`'self'` gedeckt. Endung bewusst `.js` und nicht `.mjs`: Der Versions-Bumper in
`scripts/bump-version.js` ersetzt `\.js\?v=` — bei `.mjs?v=` hätte er nicht
gegriffen und die Cache-Busting-Version wäre eingefroren.

**Mitgeprüft:** `worker-src 'self' blob:` ist in der CSP vorhanden. Ohne diese
Direktive wäre der PDF.js-Worker auf `default-src` zurückgefallen und der
nächste Fehler gewesen.

**Test.** Zwei Fälle ergänzt: kein `<script>` ohne `src` in `index.html`, und
`worker-src` muss gesetzt bleiben.

Die Meldungen `vendor.js:132` und `tabs:outgoing.message.ready` aus derselben
Konsole stammen von einer Browser-Erweiterung, nicht von der App.

---

## Preise: Rückfall von `sold` auf `stock`

`routes/bricklink.ts`, `utils/financeCalc.ts`

`sold` (verkauft, letzte sechs Monate) ist die ehrlichere Grundlage — aber für
selten gehandelte Artikel gibt es in sechs Monaten schlicht keinen Verkauf, und
BrickLink antwortet dann mit `avg_price = 0`. Ohne Rückfall stünde dort dauerhaft
kein Marktpreis. Bei einzelnen Teilen in seltenen Farben ist das der Normalfall.

`getPriceGuide()` ist jetzt ein Wrapper: erst `sold`, und nur wenn dort kein
brauchbarer Preis steht, `stock`. Das Ergebnis trägt `guide_used` (und bei
Rückfall `guide_fallback: true`), damit nachvollziehbar bleibt, woher der Wert
kommt. Die eigentliche Abfragelogik samt Gear-/Book-Kette liegt unverändert in
`getPriceGuideRaw()`.

Teile- und Minifiguren-Preise gehen nicht über `getPriceGuide()`, sondern rufen
`bricklinkRequest` direkt — dort ist derselbe Rückfall einzeln ergänzt.

Der bestehende Test wurde präzisiert: `guide_type: 'stock'` ist jetzt erlaubt,
aber **nur als Rückfall** (erkennbar am vorangestellten Spread). Als
Erstabfrage schlägt er weiterhin rot.

### Zu den 76.03 CHF bei 10290-1

Deine Screenshots legen etwas anderes nahe als fehlende Daten. BrickLink zeigt
für das Set:

| | Neu | Gebraucht |
|---|---|---|
| Verkauft (6 Mon.), Avg | **US$ 148.72** | US$ 97.23 |
| Aktuelle Angebote, Avg | US$ 175.54 | US$ 113.98 |

76.03 CHF sind bei rund 0.80 CHF/USD etwa **95 US$** — das liegt auf dem
Gebraucht-Verkaufspreis von 97.23, nicht auf irgendeinem Neu-Wert.

Es wird also weiterhin der **Gebraucht**-Preis angezeigt, obwohl das Set nur
eine Neu-Erfassung hat. Für „Neu, verkauft" gibt es bei diesem Set aber
Verkäufe (35 Stück) — der Wert wäre da.

Naheliegendste Erklärung: In `price_cache` steht noch ein alter Eintrag. Die
Zeile für Neu stammt aus der Zeit vor der Umstellung und trägt vermutlich
`avg_price = 0`; der Zustands-Fallback greift dann korrekt auf Gebraucht zurück.
Solange der Eintrag im TTL-Fenster liegt, wird nichts neu geholt.

```sql
DELETE FROM price_cache;
```

Danach holt der Preisjob mit der jetzigen Logik neu. Wenn danach immer noch 76
statt 148 dasteht, ist es kein Cache-Problem und ich schaue mir den Abruf
konkret an.

---

## Fix: Minifiguren-Bilder luden alle gleichzeitig

`public/js/06-minifigs.js`, `04-finance.js`, `08-init.js`

Die Thumbnail-Umstellung war bei den Minifiguren bereits drin — der Aufruf ist
identisch zu Teilen und Galerie. Das Problem lag woanders: **Drei der vier
`<img>`-Tags hatten kein `loading="lazy"`.**

Damit startet der Browser sämtliche Bilder einer Liste gleichzeitig und drängt
sie durch die rund sechs Verbindungen pro Host. Sie tröpfeln dann sichtbar
herein — genau das Bild, das du beschreibst. Teile und Galerie hatten das
Attribut, die Minifiguren-Ansicht nicht.

Ergänzt an allen drei Stellen (Tabellenzeile, beide Kachel-Varianten), dazu
`decoding="async"`.

**Dieselbe Lücke fand sich in zwei weiteren Ansichten:** beide Bildspalten in
`04-finance.js` und die 44-px-Vorschau in `08-init.js`.

Nebenbei entfernt: In der Minifiguren-Kachel stand `thumbUrl(imgSrc)`, wobei
`imgSrc` bereits eine fertige Proxy-URL war. `thumbUrl()` reicht solche URLs
unverändert durch — der Aufruf war wirkungslos und nur verwirrend.

**Test.** `test/parts-paging.test.js` um einen Fall erweitert: Jedes dynamisch
erzeugte `<img>` in `public/js/0x-*.js` muss `loading="lazy"` tragen.
Platzhalter-SVGs sind ausgenommen. Damit fällt die nächste Ansicht ohne
verzögertes Laden beim Testlauf auf.

Stand: `tsc --noEmit` sauber, 85 Frontend-Tests grün.

---

## Fix: Android-App lud keine Daten — Zustand war eingefroren

**Fehlerbild:** Galerie und Finanzen zeigten dauerhaft den Ladeindikator, Teile
und Minifiguren „keine Einträge". Nur der Katalog funktionierte.

**Ursache — und es ist genau der Fehler, vor dem ich bei Punkt 9 gewarnt hatte.**

Beim Aufteilen von `AppNavigation.kt` habe ich `state` als Parameter an die
Graph-Funktionen durchgereicht:

```kotlin
collectionGraph(vm, navController, state, …)
```

Der `NavHost { … }`-Builder wird aber **nur einmal** ausgeführt — der Graph wird
danach von Navigation-Compose gehalten. Der übergebene Wert ist damit für immer
die Momentaufnahme vom ersten Frame: leere Listen, `isLoading = true`. Die Ziele
lasen anschliessend nie wieder etwas Neues.

Warum der Katalog lief: `CatalogScreen` liest seinen Zustand seit jeher
**innerhalb** des Ziels (`vm.catalogState.collectAsStateWithLifecycle()`) und
abonniert damit Änderungen. Genau das ist der Unterschied.

**Lösung:** `state` und `manDetailState` sind aus den Parameterlisten
verschwunden. Jedes Ziel liest den Zustand jetzt selbst:

```kotlin
composable(Screen.Gallery.route) {
    val state by vm.state.collectAsStateWithLifecycle()
    …
}
```

13 Ziele brauchten `state`, davon zwei zusätzlich `manDetailState`. Geprüft:
keine doppelte Deklaration im selben Block (der Katalog hatte bereits eine
eigene), Klammerbilanz in allen fünf Dateien ausgeglichen.

**Was ich daraus mitnehme:** Ich hatte dieses Fehlerbild wörtlich benannt — „eine
App, die baut, aber deren Ansicht bei bestimmten Zustandsänderungen nicht mehr
aktualisiert" — und dann die Variante gewählt, die es erzeugt. Die Begründung
damals war, dass explizite Parameter Compilerfehler produzieren statt stiller
Verhaltensänderungen. Das stimmt für fehlende Parameter; für einen Compose-State,
der ausserhalb der Recomposition gelesen wird, stimmt es nicht. Die Aufteilung
wäre besser gar nicht gemacht worden, als sie ohne laufende App zu machen.

---

## Preise: warum der sold→stock-Rückfall bisher nie greifen konnte

Der Rückfall in `getPriceGuide()` war seit zwei Runden drin — er lief nur nie
an. Der Grund liegt eine Ebene davor, in `fetchPrice()`:

```js
if (cached && parseFloat(cached.avg_price) === 0) {
  // … versucht den anderen ZUSTAND aus dem Cache
  return { …, no_price: true };     // ← gibt auf, OHNE neu zu fragen
}
```

Ein gecachter Null-Preis galt für das **volle TTL-Fenster** als endgültige
Antwort. Es wurde nie erneut abgefragt — und damit kam der sold→stock-Rückfall
nie zum Zug, denn der greift erst beim Abruf.

Schlimmer noch: Statt neu zu fragen, wich die Logik auf den **anderen Zustand**
aus. Für 10290-1 heisst das: Neu-Eintrag mit 0 im Cache, Gebraucht-Eintrag mit
Preis → angezeigt wird der Gebraucht-Preis. Das sind deine 76.03 CHF, die
umgerechnet auf dem Gebraucht-Verkaufspreis von US$ 97.23 liegen.

**Lösung:** Ein Eintrag ohne Preis bekommt ein eigenes, kürzeres Fenster
(`ZERO_PRICE_TTL_HOURS = 6`, bzw. das TTL, falls kleiner). Innerhalb dieser
sechs Stunden gilt er wie bisher; danach fällt er durch und löst einen
Neuabruf aus — und dort greift dann der Rückfall auf `stock`.

Kürzeres Fenster statt gar keinem, damit Artikel, die tatsächlich nirgends
gehandelt werden, ein paar Mal am Tag neu versucht werden und nicht bei jedem
Seitenaufruf.

Zusätzlich: `fetched_at` gehört jetzt zu `PRICE_CACHE_COLS`, sonst liesse sich
das Alter eines Eintrags gar nicht bewerten — auch nicht in der Vorlade-Map für
die Massenbewertung.

Verhalten geprüft:

```
Preis vorhanden, 20 h alt      → Cache gilt
0-Preis, 2 h alt               → Cache gilt (noch nicht neu fragen)
0-Preis, 8 h alt               → neu holen
0-Preis, TTL kürzer als 6 h    → neu holen
```

**Test.** `test/set-value.test.js` um einen Fall erweitert: `ZERO_PRICE_TTL_HOURS`
und `cacheUsable()` müssen existieren, ein alter 0-Eintrag muss durchfallen, und
ein vorhandener Preis muss **vor** jeder Ausweichlogik zurückgegeben werden.

Damit sollte auch ohne `DELETE FROM price_cache` innerhalb von sechs Stunden der
richtige Wert erscheinen. Wenn du nicht warten willst, geht das Leeren der
Tabelle weiterhin schneller.

---

## Drei Fehler aus dem Betrieb

### 1. „+" bei manuell erfassten Teilen machte aus 1 eine 11

`public/js/07-admin.js`, `05-settings.js`

Folgefehler meiner CSP-Umstellung, und ein systematischer: Der Dispatcher reicht
`data-arg` **immer als Zeichenkette** durch. Vorher stand im Markup
`onclick="manQtyChange(-1)"` — eine Zahl. Jetzt kommt `"1"` an, und
`parseInt(inp.value) + "1"` ergibt die Zeichenkette `"11"`.

Ich habe alle acht Handler durchgesehen, die vorher Zahlen bekamen. Zwei waren
tatsächlich kaputt:

- `manQtyChange(delta)` — rechnet mit dem Wert. Jetzt `parseInt(delta) || 0`.
- `toggleAdmin(uid, isAdmin)` — bildete `{is_admin: !isAdmin}`. **`!"0"` ist
  `false`**, weil jede nicht-leere Zeichenkette truthy ist. Das Umschalten der
  Admin-Rolle setzte damit *immer* auf „kein Admin". Jetzt explizit verglichen.

Die übrigen sechs (`acqDelete`, `acqSave`, `delInstr`, `delUser`, `openRpw`,
`openManDetail`) verwenden ihre IDs nur in URLs oder wandeln bereits selbst um —
dort ändert sich nichts.

### 2. Thumbnail auch in Detailansicht und Zoom

`public/js/01-core.js`, `07-admin.js`, `11-actions.js`, `06-minifigs.js`

Neu ist `fullUrl()` als Gegenstück zu `thumbUrl()`: entfernt `&thumb=1` aus
Proxy-URLs und den `_thumb`-Teil aus lokalen Pfaden. Verwendet in der
Set-Detailansicht, in der Detailansicht manuell erfasster Teile und im Zoom.

Der Zoom nahm bisher `this.src` — also genau die verkleinerte Kachelfassung.
Jetzt bevorzugt er `data-orig` und schickt das Ergebnis zusätzlich durch
`fullUrl()`.

Nebenbei: In der Minifiguren-Kachel war `data-orig` **dieselbe** Thumb-URL wie
`src`. Der Fehler-Rückfall hätte damit exakt dieselbe Adresse erneut geholt.

### 3. Wiederholte 404 auf den Bild-Proxy

`server.ts`

`cdn.rebrickable.com/media/sets/fig-009434/108116.jpg` gibt es beim CDN nicht —
der Proxy reicht den 404 korrekt durch. Nur holte der Browser das Bild bei
jedem Seitenaufruf erneut, und jedes Mal ging ein Roundtrip zum CDN raus.

Neu merkt sich der Proxy 404- und 403-Antworten eine Stunde lang und beantwortet
weitere Versuche sofort. Eine Stunde, damit ein nachgereichtes Bild nicht
dauerhaft ausgesperrt bleibt.

Das fehlende Bild selbst ist ein Datenproblem: `image_url` in deiner Datenbank
zeigt für diese Minifigur auf einen Pfad unter `/media/sets/`, den Rebrickable
nicht (mehr) bedient.

### Tests

`test/parts-paging.test.js` um vier Fälle erweitert: `fullUrl()` muss existieren
und in Detailansicht wie Zoom verwendet werden, `data-orig` darf nicht mit `src`
identisch sein, der Negativ-Cache muss 404/403 merken, und die beiden Handler
müssen ihre Zeichenketten-Argumente umwandeln.

Stand: `tsc --noEmit` sauber, 90 Frontend-Tests grün.

---

## Fix: Minifiguren-Bilder tröpfelten weiter herein

Das verzögerte Laden aus der letzten Runde war richtig, aber nicht die Ursache.
Zwei tiefere Gründe, einer davon ein Konstruktionsfehler von mir.

### Die Verkleinerung entstand zu spät — und blockierte dann

Der Proxy erzeugte die Vorschau **ausschliesslich im Cache-Hit-Zweig**: also
frühestens beim zweiten Seitenaufruf, und dann für alle Bilder einer Kachelwand
gleichzeitig. Die erste Ansicht hatte damit gar keinen Nutzen von der
Verkleinerung, die zweite bezahlte sie in einem Rutsch.

Gemessen an einem 1200-px-Bild:

```
Original (1200px PNG)   9 KB      Verkleinerung: 150 ms je Bild
Vorschau (200px JPEG)   2 KB      → 5.5x kleiner
```

150 ms klingt wenig, aber Jimp belegt dabei den Event-Loop. Bei 60 Minifiguren
sind das **neun Sekunden, in denen der Server für alle Anfragen steht** — meine
On-Demand-Erzeugung hätte es unter Last also schlimmer gemacht als vorher.

**Neu:**

- Die Vorschau entsteht **direkt nach dem ersten Holen**, nicht erst beim
  zweiten Aufruf.
- Sie läuft in einer Warteschlange mit höchstens zwei gleichzeitig.
- **Keine Anfrage wartet mehr darauf.** Fehlt die Vorschau, geht das Original
  sofort raus und die Verkleinerung entsteht im Hintergrund.

Warteschlangenlogik isoliert geprüft: 60 Bilder, jedes doppelt angefragt → 60
Läufe statt 120, nie mehr als zwei gleichzeitig, die Arbeit verteilt sich statt
am Stück zu blockieren.

### Minifiguren-Bilder liegen nie lokal

Set-Bilder werden heruntergeladen und in `image_local` abgelegt — für die
`minifigs`-Tabelle passiert das nicht. Der Anreicherungsjob füllt nur
`set_minifigs_catalog` und `set_parts_catalog`, also die Katalogtabellen.

Jede Minifigur läuft deshalb dauerhaft über den Proxy: beim ersten Anzeigen ein
CDN-Roundtrip pro Bild, danach immerhin von Platte. Sets sind hier klar besser
gestellt.

**Das ist der eigentliche Hebel und noch offen.** Ein Job, der Minifiguren-Bilder
wie Set-Bilder lokal ablegt, würde `thumbUrl()` greifen lassen — dann käme die
`_thumb.jpg` direkt vom eigenen Server, ohne Proxy und ohne CDN. Das ist ein
eigener Umbau; sag Bescheid, wenn ich ihn angehen soll.

Stand: `tsc --noEmit` sauber, 76 Frontend-Tests grün.

---

## Zwei Fehler aus dem Betrieb

### Bilder geladen, aber unsichtbar

`public/js/11-actions.js`

`styles.css` enthält:

```css
img[loading=lazy]{opacity:0;transition:opacity .25s ease}
img[loading=lazy].loaded{opacity:1}
```

**Jedes** Bild mit `loading="lazy"` startet also unsichtbar und wird erst durch
die Klasse `.loaded` eingeblendet. Mein Capture-Handler setzte die aber nur bei
zusätzlichem `data-fade` — und beim Ergänzen von `loading="lazy"` in der letzten
Runde habe ich das Attribut nirgends mitgesetzt.

Betroffen waren **sieben** Stellen, nicht nur die Finanzen: Galerie-Tabelle,
Teile-Tabelle, drei Minifiguren-Ansichten, beide Finanzspalten und die
Startübersicht.

Die Ursache ist behoben, nicht die Symptome: Der Handler markiert jetzt **jedes**
`img[loading=lazy]`, unabhängig von `data-fade`. Dazu ein MutationObserver für
Bilder, die aus dem Browser-Cache kommen und beim Einfügen bereits `complete`
sind — deren `load`-Ereignis ist längst durch und würde nie ankommen.

In jsdom geprüft: mit und ohne `data-fade` sichtbar, Bilder ohne `loading=lazy`
bleiben unangetastet.

### 10290-1 zeigte weiter 76 statt 148

Es war nicht der Cache — du hattest recht, ihn zu leeren, es hat nur nichts
geändert. Die Ursache lag in einer **fünften** Stelle mit derselben falschen
Sortierung, die ich beim ersten Preis-Fix übersehen hatte:

```sql
SELECT DISTINCT ON (set_number) set_number, qty_avg_price FROM price_cache
 WHERE …
 ORDER BY set_number, (qty_avg_price > 0) DESC, (condition = $2) DESC
```

Das ist die Abfrage hinter `/finance/pnl` — und **genau die** speist
`_pnlCache`, also den in Galerie und Detail-Dialog angezeigten „Marktpreis".
Zwei Fehler auf einmal:

1. Sie liest nur `qty_avg_price`. Die Auswertung darunter greift auf
   `r.avg_price` zu — das war `undefined`, also gewann immer der
   mengengewichtete Schnitt.
2. `(qty_avg_price > 0) DESC` vor `(condition = …) DESC`: „hat einen Preis"
   schlägt „passender Zustand". Mit `DISTINCT ON` gewinnt damit der
   Gebraucht-Preis, auch für ein Set mit ausschliesslich Neu-Erfassung.

Neu werden beide Zustände geholt und je Set nach **dessen eigenem** Zustand
gewählt — der globale Standardzustand passt für eine gemischte Sammlung ohnehin
nicht. Der andere Zustand springt nur ein, wenn der eigene keinen Preis hat.

Zwei weitere Fundstellen derselben Art mitbehoben: `routes/api_v1/sets.ts`
(Preisverlauf) und `utils/portfolioHistory.ts`.

**Test.** `test/set-value.test.js` prüft jetzt **alle fünf** Dateien auf die alte
Sortierung und verlangt für den P&L-Pfad die Auswahl nach Set-Zustand. Hätte ich
den Test beim ersten Mal so breit angelegt, wäre die Stelle sofort aufgefallen.

Stand: `tsc --noEmit` sauber, 91 Tests grün, Paritätssuite grün.

---

## Fix: Finanzen-Reiter zeigte weiter 76 statt 117

Der Detail-Dialog war nach dem letzten Fix richtig — der Finanzen-Reiter nicht,
weil er auf einem **dritten** Pfad läuft: `/finance/valuation` statt
`/finance/pnl`.

Serverseitig war dieser Pfad in Ordnung; `fetchPrice()` liefert korrekt beide
Werte. Der Fehler steckte in der Anzeige. Die Sets-Tabelle hat zwei
Preisspalten:

| Überschrift | zeigte | richtig? |
|---|---|---|
| „Ø Marktpreis" | `avg_price` | ✔ |
| **„Marktpreis"** | **`qty_avg_price`** | ✘ — das sind die 76 |
| „Total" | `total_qty_avg` | ✘ |

Die zweite Spalte trug die Überschrift „Marktpreis", zeigte aber den
mengengewichteten Schnitt. Und die Total-Spalte sowie die Summen oben rechneten
ebenfalls damit — obwohl sie mit „Ø Marktpreis" beschriftet sind.

**Geändert:**

- Total-Spalte und Summen laufen über `avg_price` bzw. `totals.avg`
- Die `qty_avg_price`-Spalte heisst jetzt ehrlich „Ø mengengewichtet"
  (`finance.qty_avg`, DE und EN) statt „Marktpreis"
- Teile- und Minifiguren-Zeilen nehmen `avg_price` zuerst

Die Teile-/Minifiguren-Tabelle behält ihre „Marktpreis"-Spalte — dort steht seit
dieser Änderung tatsächlich `avg_price` drin. Beim ersten Anlauf hatte ich
versehentlich diese Tabelle umbenannt statt der Sets-Tabelle; der Test hat es
gefangen.

**Test.** `test/set-value.test.js` prüft jetzt Total, Summen, die Feldreihenfolge
bei Teilen/Minifiguren und dass in der Sets-Tabelle auf „Ø Marktpreis" die
`qty_avg`-Spalte folgt und nicht ein zweites „Marktpreis".

Stand: `tsc --noEmit` sauber, 94 Tests grün.

**Anmerkung:** Damit zeigen „Ø Marktpreis" und die Total-Spalte dieselbe
Grundlage. Die mengengewichtete Spalte ist als Information erhalten geblieben —
wenn sie dich stört, kann sie ersatzlos weg, das ist eine Zeile plus Spaltenbreite.

---

## Finanzen: Kaufpreis statt zweiter Marktpreis-Spalte

**Zur Frage, ob die beiden Spalten noch Sinn ergeben: nein.** Seit `avg_price`
der Marktpreis ist, zeigten „Ø Marktpreis" und „Marktpreis" dasselbe Konzept
zweimal — einmal einfach, einmal mengengewichtet. Dein Vorschlag ist besser:
Kaufpreis neben Marktpreis erzählt die ganze Geschichte, und die
Teile-/Minifiguren-Tabellen hatten diese Form längst.

Die Sets-Tabelle hat jetzt dieselben Spalten wie die beiden anderen Sektionen:

```
… | Kaufpreis | Marktpreis | Total | Wertentwicklung
```

**Kaufpreis mengengewichtet.** `computeSetsValuation()` liefert ihn als

```sql
SUM(purchase_price * quantity) / NULLIF(SUM(quantity), 0)
```

über die Erfassungen. Zwei Exemplare zu 100 und eines zu 160 ergeben **120**,
nicht 130. Gibt es keine Erfassungen, zählt `sets.purchase_price`. Beides gegen
die Datenbank geprüft.

Der i18n-Schlüssel `finance.qty_avg` ist mit der Spalte entfallen.

## Fix: Minifiguren-Bilder fehlten „teilweise"

Das war mein Negativ-Cache aus der letzten Runde. Er merkte sich **404 und
403** für eine Stunde. Ein 403 kommt beim Rebrickable-CDN aber auch als
Drosselung vor, wenn eine Kachelwand viele Bilder gleichzeitig anfordert — die
betroffenen Bilder waren damit eine Stunde ausgesperrt, obwohl sie existieren.
Genau das Bild von „teilweise nicht geladen".

Neu wird **nur 404** gemerkt, und nur 15 Minuten statt einer Stunde.

Stand: `tsc --noEmit` sauber, 96 Tests grün, Paritätssuite grün.

---

## Neuer Job: Bildadressen reparieren

`jobs/imageRepair.ts` (neu), `db/database.ts`, `server.ts`,
`utils/jobMonitor.ts`, `public/js/01-core.js`, `public/i18n.js`,
`jobs/dailyScheduler.ts`

**Warum.** `minifigs.image_url` wird beim Import einmalig aus dem
Rebrickable-Feld `set_img_url` übernommen und danach nie überprüft. Die
Adressen zeigen auf konkrete Dateien (`…/media/sets/fig-009821/109929.jpg`) —
wird eine davon dort ersetzt oder gelöscht, liefert das CDN dauerhaft 404. Am
Proxy ist das nicht heilbar; die Adresse selbst ist falsch. Das erklärt auch,
warum die Nachbarkacheln problemlos luden: Deren Bilder gibt es noch.

**Wie er arbeitet.** Der Bild-Proxy schreibt jede 404-Adresse in die neue
Tabelle `dead_images` — der In-Memory-Negativcache ist prozesslokal und nach
einem Neustart weg. Der Job nimmt genau diese Liste, fragt für die betroffenen
Minifiguren `/api/v3/lego/minifigs/{fig_num}/` ab und schreibt die aktuelle
Adresse zurück.

- Kennt Rebrickable kein Bild mehr, wird `image_url` auf `NULL` gesetzt — dann
  zeigt die Kachel den Platzhalter statt dauerhaft ins Leere zu laufen.
- Fehlgeschlagene Abrufe bleiben Kandidaten (kein `repaired_at`), ein Netzfehler
  verbrennt also keinen Eintrag.
- Ein erneuter 404 setzt `repaired_at` zurück und macht die Adresse wieder zum
  Kandidaten.
- Höchstens 200 pro Lauf: ein Rundumschlag über den Bestand würde das
  Rebrickable-Tageslimit sprengen. Angefasst wird nur, wofür tatsächlich ein 404
  beobachtet wurde.

**Monitoring.** Eigener Eintrag „Bildadressen reparieren" / „Repair image links"
mit Fortschritt (`n / gesamt`) und laufender Zwischenmeldung
(`x ersetzt, y ohne Bild, z Fehler`). Das Icon ist ein Bildrahmen mit
Bergmotiv, davor ein Schraubenschlüssel — in derselben Farbwelt wie die übrigen
Job-Icons.

**Zeitplan.** Täglich um 05:00, also **nach** dem CSV-Sync (03:00) — der kann
selbst Adressen ändern. Die Uhrzeit ist im Monitoring konfigurierbar wie bei den
anderen Jobs.

**Verifikation.** Kandidatenauswahl, Reparatur, Markierung und
Wieder-Kandidat-Werden gegen die Datenbank durchgespielt.
`test/image-repair.test.js` (7 Fälle) sichert Tabelle, Auswahlbedingung,
`NULL`-Fall, Fehlerverhalten, Fortschrittsmeldungen, Icon/Beschriftung und die
Reihenfolge im Zeitplan.

**Nicht getestet:** der tatsächliche API-Abruf — `rebrickable.com` steht nicht
in meiner Netzwerk-Freigabe. Die Abruflogik ist dieselbe wie in
`routes/rebrickable.ts` (`getRbKey` + `httpsGetRobust`), aber den ersten echten
Lauf solltest du im Monitoring beobachten.

Stand: `tsc --noEmit` sauber, 69 Tests grün.

---

## Fix: `[gibCheck] Unexpected token '<'`

**Woher das HTML kommt: nicht aus der App.** Ich habe den Pfad geprüft —
`/api/sets/import/csv/status` existiert (`routes/sets.ts:493`), wird von keiner
parametrisierten Route verschattet, ist unter `/api/sets` gemountet, und der
JSON-404-Handler steht seit dem früheren Fix vor dem SPA-Catch-all. Ohne
Anmeldung kommt ein JSON-401. Für diesen Pfad kann der Node-Prozess also kein
`<html>` liefern.

Bleibt die Schicht davor: Bei `lego.bigolin.mywire.org` sitzt ein Reverse-Proxy
oder Tunnel dazwischen, und der antwortet bei einem Neustart oder Aussetzer mit
seiner eigenen HTML-Fehlerseite. Da du gerade deployt hast, passt das zeitlich.

**Zwei echte Schwächen hat die Meldung trotzdem aufgedeckt:**

1. `gibCheckOnLoad()` fragte **alle drei Sekunden** — auch auf dem Login-Screen,
   wo es nichts zu prüfen gibt, und auch dann, wenn jede Antwort scheiterte.
2. Sie rief `r.json()` ohne Statusprüfung. Jede nicht-JSON-Antwort erzeugte
   einen Parsefehler in der Konsole, im Drei-Sekunden-Takt.

Neu: Abfrage nur bei angemeldetem Nutzer, `Content-Type` und Status werden vor
dem Parsen geprüft, und nach drei Fehlschlägen geht das Intervall von 3 auf 30
Sekunden — statt gegen eine Wand zu laufen. Eine einzelne Warnung statt einer
Fehlerkaskade.

**Der Rest deines Logs** (`contentscript.js`, `ObjectMultiplex`,
`MaxListenersExceededWarning`) stammt von einer Browser-Erweiterung, nicht von
der Anwendung.

Stand: `tsc --noEmit` sauber, 70 Tests grün.

---

## Fix: 502 auf `/api/sets/import/csv/status`

Der 502 in deinem Log war die entscheidende Spur — und die Ursache liegt in der
Anwendung, nicht im Proxy.

**Express 4 kennt keine Promises.** Wirft ein `async (req, res) => …`-Handler,
landet die Rejection nirgends: Die Antwort bleibt aus, die Verbindung offen. Ein
Reverse-Proxy davor wartet auf sein Timeout und liefert dann 502 mit einer
HTML-Fehlerseite — das war auch die Quelle des `Unexpected token '<'`.

`/import/csv/status` hatte kein `try/catch`:

```js
router.get('/import/csv/status', requireLoginOrToken, async (req, res) => {
  const job = await jobGet(uid);      // wirft → Anfrage hängt für immer
  res.json(buildJobStatus(job));
});
```

Isoliert nachgestellt:

```
ohne Absicherung: KEINE ANTWORT (Verbindung hängt → Proxy liefert 502)
mit  Absicherung: HTTP 500 {"error":"kaputt"}
```

**22 Handler** waren so gebaut. Statt sie einzeln zu umschliessen — und die
nächste neue Route wieder zu vergessen — wird `express.Router` in `server.ts`
**einmal** erweitert: Gibt ein Handler ein Promise zurück, hängt sich ein
`.catch(next)` daran; synchrone Würfe gehen ebenfalls an `next()`. Damit greift
das zentrale Fehler-Sicherheitsnetz, und aus einem stillen Hänger wird eine
saubere 500.

Fehler-Middleware (vier Parameter) bleibt unangetastet, und die Erweiterung
steht vor den `require('./routes/…')`-Aufrufen — danach wären die Router bereits
gebaut.

**Weil das jede Route betrifft**, habe ich beide Postgres-Integrationssuiten
gefahren: Katalog 8/8, Parität 32/32, Zusammenfassung 5/5.

**Test.** `test/async-routes.test.js` (3 Fälle): Wrapper vorhanden,
Fehler-Middleware ausgenommen, Reihenfolge vor den Requires, und ein echter
HTTP-Durchlauf, der die 500 statt des Hängers nachweist.

Stand: `tsc --noEmit` sauber, 74 Tests grün plus die Integrationssuiten.

---

## Zwei Fehler: Log-Fenster ohne Funktion, Bild-Proxy mit 404

### Log-Fenster: Level, Neu laden und Auto reagierten auf nichts

Folgefehler meiner CSP-Umstellung. Das Log-Fenster ist ein **eigenes Dokument**
(`window.open` + `document.write`) mit eigenem `<script>`. Ich habe dort die
`onclick`-Attribute auf `data-click` umgestellt — aber der Dispatcher aus
`js/11-actions.js` läuft nur im Hauptfenster. Die Attribute liefen ins Leere.

Dass die Dauer noch funktionierte, passt: Das `<select>` ändert seinen Wert von
selbst, nur das `data-change="loadLogs"` griff nicht.

Das Fenster verdrahtet seine Bedienelemente jetzt in seinem eigenen Skript —
`data-click`, `data-change` und `data-input`, inklusive `data-arg` für die
Level-Umschalter.

### Bild-Proxy: 404 für Bilder, die direkt laden

`https://cdn.rebrickable.com/media/sets/fig-007247/79058.jpg` lädt im Browser,
über den Proxy kam 404. Das schliesst „Bild fehlt" aus — der Unterschied liegt
in den Kopfzeilen. Der Proxy schickt `Referer: https://rebrickable.com/` mit;
dein Browser beim direkten Aufruf nicht.

Vor dem CDN steht Cloudflare, und Hotlink-Schutz antwortet auf einen Referer,
der nicht zur anfragenden IP passt, typischerweise mit **404 statt 403** — die
Regel soll sich nicht verraten.

Der Proxy fasst deshalb bei 404 und 403 **einmal ohne Referer nach**, bevor er
die Adresse als tot einstuft. Gegen einen lokalen Server geprüft, der genau so
reagiert: erster Versuch 404, zweiter 200.

**Das ist eine Hypothese, keine Gewissheit** — ich kann `cdn.rebrickable.com`
von hier nicht erreichen. Wenn die Bilder nach dem Deploy laden, war es der
Hotlink-Schutz. Wenn nicht, brauche ich die Server-Log-Zeile des Proxys für
diese URL.

Nebenwirkung, die ohnehin richtig ist: Erst nach dem zweiten Fehlversuch landet
eine Adresse in `dead_images`. Der Reparaturjob bekommt damit nur noch echte
Ausfälle vorgesetzt statt Hotlink-Opfer.

Stand: `tsc --noEmit` sauber, 75 Tests grün, Paritätssuite 32/32.

---

## Android nachgezogen

**UNGEPRÜFT** — kein Android-SDK hier. `./gradlew assembleDebug` vor dem Bauen.

### Marktpreis

`avg_price` statt `qty_avg_price` an allen drei Stellen, an denen die App den
Marktpreis liest:

- `SetDetailScreen.kt` — Marktpreis im Detail-Dialog und in der Preiszeile
- `SetDetailComponents.kt` — Datenpunkte des Preisverlaufs
- `FinanceScreen.kt` — Zeilensumme (`total_avg`) und Gesamtsumme (`totals.avg`)

Das ist dieselbe Wurzel wie in der Webapp: Der mengengewichtete Schnitt liegt
systematisch unter dem, was BrickLink als „Avg Price" ausweist.

### Kaufpreis im Finanzen-Reiter

`ValuationSet` kennt jetzt `total_avg` und `purchase_price`. Die Zeile zeigt
Marktpreis und darunter klein den Kaufpreis („Kauf: …" / „Purchase: …") —
dieselbe Gegenüberstellung wie in der Webapp, nur an das Kartenlayout der App
angepasst. Der Kaufpreis kommt mengengewichtet vom Server.

Beide Felder sind optional: Ein älterer Server ohne sie bricht die App nicht,
die Anzeige fällt dann auf `total_qty_avg` zurück.

### Detailansicht aus dem Finanzen-Reiter

Ein Klick auf eine Set-Zeile öffnet dieselbe Detailansicht wie in der Galerie
(`Screen.SetDetail`).

**Die Scroll-Position** liegt bewusst **ausserhalb** des Ziels: `financeListState`
wird in `BrickInventoryManagerApp` mit `rememberLazyListState()` angelegt und an
`toolsGraph()` durchgereicht. Beim Öffnen der Detailansicht wird das Finanz-Ziel
verworfen — ein `rememberLazyListState()` darin wäre bei der Rückkehr
zurückgesetzt und die Liste spränge nach oben.

Das ist bewusst **anders** als beim Zustand aus dem ViewModel, den ich vorher
genau deshalb aus den Parametern entfernt habe: Hier wird eine stabile
Objektreferenz durchgereicht, kein zum Aufbauzeitpunkt abgelesener Wert. Die
Referenz bleibt gültig, gelesen wird erst im Ziel.

### Test

`ValuationPriceFieldsTest` in `ResponseCacheContractTest.kt`: `total_avg` und
`purchase_price` werden gelesen, und ihr Fehlen bricht die Deserialisierung
nicht.

### Was zu prüfen ist

1. `./gradlew assembleDebug` — `Card(onClick = …)` verlangt in manchen
   Material3-Versionen `ExperimentalMaterial3Api`; falls der Compiler das
   moniert, fehlt die Opt-in-Annotation.
2. Finanzen-Reiter: Zahlen gegen die Webapp vergleichen.
3. Zeile antippen, Detail öffnen, zurück — die Liste muss an derselben Stelle
   stehen.

---

## Minifiguren-Bilder: ein echter Fehler und ein Diagnose-Endpunkt

Deine beiden Beispiele haben es eingegrenzt: Die URL **mit** `&thumb=1`
funktioniert, die **ohne** nicht. Da beide Varianten denselben Cache-Schlüssel
benutzen, heisst das: Was auf Platte liegt, wird ausgeliefert — **jeder
Cache-Miss scheitert**. Das Problem sitzt also im CDN-Abruf, nicht in den
Adressen. Damit war meine bisherige Diagnose („Bilder existieren nicht mehr")
falsch, und auch der Reparaturjob konnte nichts ausrichten.

### Gefundener Fehler: der Cache konnte unvollständig sein

```js
(async () => {
  await fs.promises.mkdir(cacheDir, …);   // ← gibt den Event-Loop frei
  …
  r.pipe(ws);                             // Cache-Stream hängt ERST JETZT
})();

r.pipe(res);                              // läuft synchron VORHER
```

Das `await` stammt aus meiner ersten Härtungsrunde („blockierendes I/O
entfernen"). Damit hing der Cache-Stream erst, nachdem die Antwort bereits zum
Client lief — die Datei auf Platte konnte die ersten Bytes verlieren. Und ein
unvollständiges Bild wird beim nächsten Aufruf ausgeliefert.

Nachgestellt:

```
Cache-Stream nach await  → Client: AAABBBCCC | Cache: (leer/unvollständig)
Cache-Stream synchron    → Client: AAABBBCCC | Cache: AAABBBCCC
```

`mkdirSync` ist hier vertretbar: Das Verzeichnis existiert nach dem ersten Bild,
der Aufruf kostet danach nichts.

### Diagnose statt Vermutung

Ich habe vier Runden lang zwischen „Bild fehlt", „Hotlink-Schutz" und
„Netzproblem" geraten, ohne Sicht auf das, was der Server tatsächlich vom CDN
bekommt. Neu:

```
GET /api/v1/admin/img-probe?url=https%3A%2F%2Fcdn.rebrickable.com%2F…
```

Admin-only. Fragt die URL **vom Server aus** in drei Varianten ab — mit Referer,
ohne Referer, ganz ohne Kopfzeilen — und meldet je Versuch Statuscode, Dauer,
Content-Type, Bytes sowie `server`/`cf-ray` (verrät Cloudflare). Dazu, ob
Original und Vorschau bereits im Plattencache liegen.

**Bitte einmal aufrufen** für eine der fehlschlagenden URLs. Die Antwort
entscheidet die Frage endgültig:

| Beobachtung | Bedeutung |
|---|---|
| alle drei 404 | Bild existiert wirklich nicht |
| mit Referer 404, ohne Referer 200 | Hotlink-Schutz — der Retry greift |
| `error: ENOTFOUND` / `timeout` | Der Server erreicht das CDN nicht |
| alle 200, aber Proxy liefert trotzdem nichts | Fehler in meinem Proxy-Code |

Stand: `tsc --noEmit` sauber, 65 Tests grün, Paritätssuite 32/32.

---

## Minifiguren-Bilder: der Cache war beschädigt

Deine Probe-Ausgabe hat es entschieden:

```
cache: { original: { bytes: 376553 }, thumb: null }
probes: mit Referer 200 · ohne Referer 200 · nackt 200
```

**Alle drei Varianten liefern 200**, und das Original liegt bereits auf Platte.
Damit sind „Bild existiert nicht" und der Hotlink-Verdacht widerlegt — beides
war falsch, und der Reparaturjob konnte deshalb nichts ausrichten.

Ich habe die Proxy-Route danach isoliert nachgebaut und gegen ein lokales CDN
laufen lassen: Cache-Miss, Cache-Hit ohne Thumb, Cache-Hit mit Thumb — alle drei
korrekt. Die Logik ist also in Ordnung.

Bleibt genau eine Erklärung: **Die zwischengespeicherte Datei ist unvollständig.**
Der Browser bekommt dafür 200, kann das Bild aber nicht dekodieren — die Kachel
bleibt leer, ohne Fehlermeldung. Und weil eine kaputte Datei im Cache liegt,
wird sie bei jedem weiteren Aufruf erneut ausgeliefert.

Ursache ist der Pipe-Fehler aus dem vorigen Abschnitt: Solange `r.pipe(ws)`
hinter einem `await` stand, flossen die ersten Bytes zum Client, bevor der
Schreib-Stream hing.

### Zwei Absicherungen

**Beim Schreiben:** Die `content-length` der CDN-Antwort wird gemerkt und nach
dem Schreiben mit der tatsächlichen Dateigrösse verglichen. Stimmt sie nicht,
wird die Datei verworfen statt umbenannt — und der Fall landet im Log:

```
[img-proxy] unvollständig (12345/376553 Bytes), nicht gecacht: https://…
```

**Beim Start:** Ein einmaliger Durchlauf entfernt bereits vorhandene kaputte
Einträge. Erkennungsmerkmal ist die Endmarke — JPEG endet auf `FF D9`, PNG auf
`IEND`. Fehlt sie, wird die Datei samt `.ct` und Vorschau gelöscht und beim
nächsten Aufruf frisch geholt. Andere Formate werden nicht bewertet.

Nachgestellt: vollständiges JPEG bleibt, abgeschnittenes wird entfernt, PNG
bleibt.

### Was du tun musst

Nichts — die Startbereinigung räumt beim nächsten Neustart auf. Wer nicht warten
will: `rm -rf data/img_proxy_cache` hat denselben Effekt, kostet aber einen
neuen CDN-Abruf für **alle** Bilder statt nur für die kaputten.

Der Diagnose-Endpunkt `/api/v1/admin/img-probe` bleibt drin — er hat diese Frage
in einer Runde geklärt, nachdem ich vier Runden lang danebenlag.

Stand: `tsc --noEmit` sauber, 85 Tests grün, Paritätssuite 32/32.

---

## Korrektur: Cache-Bereinigung lief bei jedem Neustart

Berechtigter Einwand — mein Kommentar sagte „einmalig beim Start", gemeint war
„einmal pro Start". Tatsächlich lief der Durchlauf bei **jedem** Neustart, und
das gleich zweifach unschön:

1. Seit der Längenprüfung beim Schreiben können keine unvollständigen Dateien
   mehr entstehen. Ein Scan über tausende Dateien bei jedem Start prüft also
   dauerhaft etwas, das nicht mehr auftreten kann.
2. Er lief in **jedem Cluster-Worker**. Bei `WEB_WORKERS = 8` hätten acht
   Prozesse gleichzeitig dasselbe Verzeichnis durchsucht.

**Neu:** Der Durchlauf passiert genau einmal. Ein Marker in `global_settings`
(`img_cache_scanned`) hält fest, dass er gelaufen ist, und nur der
Primary-Worker führt ihn aus.

Läuft die Primary-Wahl beim Start noch, wird der Scan übersprungen — der Marker
wird dann auch nicht gesetzt, und der nächste Start holt es nach.

Wer ihn erneut auslösen will:

```sql
DELETE FROM global_settings WHERE key = 'img_cache_scanned';
```

Verhalten nachgestellt: erster Start als Primary führt aus, zweiter überspringt,
Nicht-Primary überspringt, nach dem Löschen des Markers läuft er wieder.

Stand: `tsc --noEmit` sauber, Tests grün.

---

## Die eigentliche Ursache: gleichzeitige Anfragen überschrieben dieselbe Datei

Die Zahlen aus deiner zweiten Probe haben es verraten:

```
Cache:  418'603 Bytes        CDN-Antwort: ~81'920 Bytes
418'603 / 81'920 ≈ 5,1
```

Und beim Bild davor: 376'553 / 72'872 ≈ 5,2. **Die Datei enthält dasselbe Bild
rund fünfmal hintereinander.**

Der Grund stand in einer Zeile:

```js
const tmpFile = cacheFile + '.tmp-' + process.pid;
```

Der Name enthielt nur die **Prozess-ID**, nicht die Anfrage. Fordert eine
Kachelwand dasselbe Bild mehrfach gleichzeitig an — bei Minifiguren der
Normalfall — schrieben alle Anfragen desselben Workers in **dieselbe** Datei.
Fünf Streams, ein Ziel.

Solche Dateien beginnen korrekt mit `FFD8` und enden auf `FFD9`. Sie fallen
weder beim Streamen auf noch bei meiner Endmarken-Prüfung — der Browser kann sie
aber nicht dekodieren, und die Kachel bleibt leer. Genau das Bild, das du
beschrieben hast.

### Zwei Änderungen

**Ursache:** Der Temp-Name trägt jetzt eine laufende Nummer je Anfrage
(`.tmp-<pid>-<n>`). Jede Anfrage schreibt ihre eigene vollständige Datei, das
letzte `rename` gewinnt — alle Kopien sind identisch, das ist unkritisch.

**Altbestand:** Die Startbereinigung sucht zusätzlich nach einer **zweiten
Startmarke** (`FFD8FF` ab Position 3, bei PNG die Signatur ab Position 1).
Dateien über 8 MB werden nicht komplett eingelesen.

Nachgestellt:

```
abgeschnitten     200 Bytes → wird entfernt
einfach           305 Bytes → in Ordnung
fünffach         1525 Bytes → wird entfernt
```

Da die Bereinigung bereits gelaufen sein kann, muss der Marker für einen
erneuten Durchlauf weg:

```sql
DELETE FROM global_settings WHERE key = 'img_cache_scanned';
```

Danach neu starten — der Durchlauf erwischt dann auch die mehrfach
geschriebenen Dateien.

Stand: `tsc --noEmit` sauber, 87 Tests grün, Paritätssuite 32/32.

---

## Der Marktpreis: Anzeige und Bewertung nutzten verschiedene Zustandsquellen

Das war die Wurzel — und sie erklärt, warum der Wert mal richtig und mal falsch
aussah.

| | Quelle für den Zustand |
|---|---|
| **Anzeige** (Kachel, Detail) | `getSetConditionAggregate()` — leitet ihn aus den **Erfassungen** ab |
| **Bewertung** (Marktpreis) | `sets.condition` — die **gespeicherte Spalte** |

Weichen die voneinander ab — etwa weil ein Set nachträglich auf „Neu" korrigiert
wurde, ohne dass `sets.condition` mitgezogen ist — zeigt die Kachel „Neu",
während der Preis aus dem Gebraucht-Eintrag stammt. Genau dein Fall:

```
sets.condition: U | Erfassungen: 1 | davon gebraucht: 0
→ Bewertung nahm: U   (der Gebraucht-Preis, 76.60)
→ Anzeige zeigte: Neu
```

**Neu:** `effectiveCondition()` in `utils/financeCalc.ts` bildet dieselbe Regel
wie die Anzeige — eine gebrauchte Erfassung genügt, sonst neu, ohne Erfassungen
zählt der gespeicherte Wert. Beide Bewertungspfade (`computeSetsValuation` und
der P&L-Pfad) benutzen sie. Direkte Zugriffe auf `sets.condition` gibt es in der
Bewertung nicht mehr — ein Test hält das fest.

Gegen die Datenbank durchgespielt: gespeicherter Zustand `U`, eine Neu-Erfassung
→ Bewertung wählt jetzt `N`.

Nebenbei korrigiert: Der mengengewichtete Kaufpreis zählte Erfassungen **ohne**
Kaufpreis im Nenner mit. Zwei Exemplare zu 100 und eines ohne Preis ergaben 66.67
statt 100. Jetzt filtern Zähler und Nenner gemeinsam.

## Diagnose-Endpunkt für Preise

```
GET /api/v1/admin/price-probe?set=10290-1[&live=1]
```

Zeigt Erfassungen, gespeicherten Zustand, den **daraus gewählten Zustand**, alle
`price_cache`-Zeilen mit Alter und die letzten Historieneinträge. Mit `&live=1`
zusätzlich, was BrickLink gerade für beide Zustände liefert.

Damit lässt sich künftig in einem Aufruf sehen, ob ein unerwarteter Preis an der
Zustandswahl, am Cache oder an BrickLink liegt — statt es über mehrere Runden
einzukreisen.

## Cache-Bereinigung mit Version

Der Marker hielt nur fest, *dass* die Bereinigung gelaufen ist. Nach der
Verbesserung der Erkennung (mehrfach geschriebene Dateien) hätte sie deshalb nie
wieder gegriffen — deine kaputten Dateien wären liegen geblieben.

Jetzt trägt der Marker eine Versionsnummer (`IMG_SCAN_VERSION`). Wird die
Erkennung erweitert, läuft der Durchlauf beim nächsten Start von selbst erneut.
Kein manuelles `DELETE` mehr nötig.

Stand: `tsc --noEmit` sauber, 76 Tests grün, Paritätssuite 32/32 (dreimal
gefahren — ein einzelner roter Lauf war nicht reproduzierbar).

---

## Bild-Proxy: Streaming belegt, Verbindungen begrenzt, Fehler sichtbar

### Zur Vermutung, der Server warte auf Download und Vorschau

Tut er nicht — belegt am Code:

```
r.pipe(ws)   Position 2078   ← Cache-Stream
r.pipe(res)  Position 3560   ← Client-Stream, unmittelbar danach
queueThumb   Position 3311   ← liegt IN ws.on('finish'), also nach der Antwort
```

Das Bild fliesst gleichzeitig zum Client und auf die Platte, die Verkleinerung
entsteht erst danach im Hintergrund. Ein Test hält diese Reihenfolge fest, damit
sie nicht versehentlich kippt — was sie schon einmal getan hatte.

### Was stattdessen die Ursache sein dürfte

Ohne Begrenzung öffnet Node **je Anfrage eine eigene Verbindung**. Eine
Minifiguren-Kachelwand löst rund 60 Proxy-Anfragen gleichzeitig aus, also 60
parallele TLS-Handshakes gegen Cloudflare. Ein Teil davon läuft in die
Zehn-Sekunden-Grenze oder wird gedrosselt — und genau diese Kacheln bleiben
leer, während die Nachbarn laden. Das passt zu „teilweise".

Neu: ein Verbindungs-Pool mit `maxSockets: 8` und `keepAlive`. Anfragen stehen
an, statt abgewiesen zu werden, und wiederverwendete Verbindungen sparen den
Handshake. Die Zeitgrenze steigt entsprechend von 10 auf 25 Sekunden — die alte
hätte genau die wartenden abgeschnitten.

**Das bleibt eine Hypothese.** Gegen einen schnellen lokalen Server ist der Pool
sogar langsamer (999 ms statt 204 ms für 60 Anfragen); sein Nutzen zeigt sich
erst bei einem drosselnden Gegenüber, und das kann ich hier nicht nachstellen.

### Damit die nächste Runde kein Raten wird

Der Proxy protokolliert jeden Fehlschlag mit Grund und URL:

```
[img-proxy] Zeitüberschreitung nach 25 s: https://…
[img-proxy] Verbindungsfehler ECONNRESET: https://…
[img-proxy] CDN antwortete 404 (auch ohne Referer): https://…
```

Und zählt sie mit. Die Zähler stehen in der Probe-Antwort:

```
GET /api/v1/admin/img-probe?url=…   →   "proxy_failures": {
  "timeout": 12, "error": 0, "notFound": 3, "other": 0,
  "lastError": "timeout — https://…"
}
```

**Bitte nach dem nächsten Öffnen der Minifiguren-Ansicht einmal abrufen.** Steht
dort `timeout` hoch, war die Verbindungsflut die Ursache und der Pool hilft.
Steht `notFound` hoch, fehlen die Bilder tatsächlich. Steht alles auf 0, obwohl
Kacheln leer bleiben, liegt es nicht mehr am Proxy — dann schaue ich im Client.

Stand: `tsc --noEmit` sauber, 70 Tests grün, Paritätssuite 32/32.

---

## Log-Fenster: Inline-Skript wurde von der eigenen CSP blockiert

Deine Beobachtung — nur die Dauer lässt sich ändern, sonst nichts — war der
entscheidende Hinweis. Ein `<select>` zeigt seinen Wert auch ohne JavaScript;
alles andere braucht welches.

**Ursache:** Ein per `window.open` geöffnetes und mit `document.write` gefülltes
Fenster **erbt die CSP des Öffners**. Seit `script-src` ohne `'unsafe-inline'`
wird das Inline-`<script>` des Log-Fensters dort blockiert — es lief nie. Meine
Verdrahtung aus der letzten Runde war korrekt, stand aber in genau diesem
blockierten Skript.

**Neu:** `public/js/logviewer.js` als eigene Datei, vom Popup per `<script src>`
geladen. Als externe Datei ist sie von `'self'` gedeckt. Zugangsdaten und
Übersetzungen kommen über `data-auth`, `data-base` und `data-i18n` am `<body>`,
abgesichert durch einen neuen `escHtmlAttr()`-Helfer.

In jsdom durchgespielt: Logs laden, Statuszeile mit übersetzten Texten, Filter
auf Warn/Error, Klick auf „Info" bringt den dritten Eintrag dazu.

## Bilder: ein einzelner Verbindungsfehler blendete die Kachel dauerhaft aus

Der Zähler aus deiner Probe hat es gezeigt:

```
"proxy_failures": { "timeout": 0, "error": 1, "notFound": 0,
                    "lastError": "ETIMEDOUT — …/fig-013102/110128.jpg" }
```

Ein einzelner Verbindungsfehler. Im Client hatte der aber dauerhafte Wirkung:
Der Fehler-Rückfall entfernte das `src` beziehungsweise blendete das Bild aus,
und `fallbackDone` verhinderte jeden weiteren Versuch — obwohl das Bild in
Ordnung ist und beim nächsten Abruf geladen hätte.

**Neu:** Ein Bildfehler löst zuerst **einen Wiederholversuch nach einer Sekunde**
aus. Erst wenn auch der scheitert, greift der bisherige Rückfall. Damit fangen
sich genau solche Aussetzer von selbst ab.

Nachgestellt: erster Fehler → erneuter Versuch, `src` bleibt erhalten; zweiter
Fehler → Rückfall wie bisher.

Stand: `tsc --noEmit` sauber, 87 Tests grün, Paritätssuite 32/32.

---

## Der Verbindungs-Pool verhungerte an abgebrochenen Anfragen

`timeout: 2` in deiner Diagnose war der entscheidende Wert — und die Ursache
liegt in dem Pool, den ich zwei Runden zuvor eingebaut habe.

Beim Scrollen über verzögert geladene Bilder bricht der Browser laufend
Anfragen ab. Der Proxy bekam davon nichts mit: Der Antwort-Stream vom CDN lief
weiter in ein totes `res`, die Gegendruck-Steuerung hielt ihn an, und der Socket
blieb belegt. Mit `maxSockets: 8` sind nach wenigen Abbrüchen alle Plätze
blockiert — nachfolgende Anfragen stehen dann bis zur 25-Sekunden-Grenze in der
Warteschlange und laufen in die Zeitüberschreitung.

Das erklärt auch, warum es nach dem Einbau des Pools **schlechter** wurde: Ohne
Begrenzung gab es keine Warteschlange, in der etwas verhungern konnte.

**Behoben:**

```js
res.on('close', () => {
  if (!res.writableFinished) { r.destroy(); activeReq?.destroy(); }
});
```

`activeReq` statt `request`, weil beim Rückfall ohne Referer nicht mehr die
erste Anfrage läuft — sonst bliebe genau deren Socket hängen.

Nachgestellt mit einem Pool von zwei Verbindungen: Zwei Clients brechen ab, drei
weitere Anfragen laufen danach in 442 ms durch, null Zeitüberschreitungen. Ohne
die Behandlung blieb der Nachstellversuch selbst hängen.

Stand: `tsc --noEmit` sauber, 74 Tests grün, Paritätssuite 32/32.

**Zur Erwartung:** Der Zähler sollte nach dem Deploy auf 0 bleiben. Tut er das
nicht, ist der Pool die falsche Antwort auf ein anderes Problem — dann würde ich
ihn wieder entfernen, statt weiter daran zu drehen.

---

## Weisse Seite trotz erfolgreicher Antwort: fehlende Content-Length

Deine Beschreibung war der Schlüssel: Bild in neuem Tab öffnen → weisse Seite;
nach 20 Sekunden neu laden → sofort da. Das heisst, der Inhalt kommt an, wird
aber nicht angezeigt — und beim zweiten Mal liegt er im Plattencache.

Die Zähler standen auf **0**: kein Timeout, kein Verbindungsfehler, kein 404.
Der Proxy arbeitet also korrekt. Der Unterschied liegt in den Kopfzeilen.

Der Miss-Pfad setzte nur `Content-Type` und `Cache-Control` — **keine
`Content-Length`**, obwohl das CDN sie mitliefert. Die Antwort geht dann als
`chunked` raus, und ein Reverse-Proxy davor kann sie puffern statt
durchzureichen. Beim zweiten Aufruf kommt das Bild aus dem Plattencache, dessen
Grösse bekannt ist — deshalb sofort.

Gemessen an einer 40-KB-Antwort: erste Bytes nach 21 ms ohne Länge, nach 8 ms
mit. Der Unterschied ist lokal klein, über einen puffernden Tunnel aber der
zwischen „läuft" und „weisse Seite".

`Content-Length` wird jetzt auf **allen drei** Auslieferungswegen gesetzt: beim
CDN-Abruf aus der Antwort des CDN, bei Plattencache und Vorschau aus der
Dateigrösse.

## Nebenbefund: Statistik wich zwischen Webapp und App ab

Die Paritätsprüfung schlug reproduzierbar fehl (`total_parts` unterschiedlich).
Ursache war meine Umstellung auf den Hintergrund-Neuaufbau: `getPartsStats`
benutzte die Zusammenfassung, sobald **irgendeine** existierte — auch eine
veraltete. Während eines Neuaufbaus las der eine Endpunkt daraus und der andere
live.

Für Listen ist ein veralteter Stand unkritisch; für Kennzahlen nicht, weil
Webapp und App dieselbe Zahl zeigen sollen. `ensureFresh(userId, { strict: true })`
akzeptiert nur einen aktuellen Stand — beide weichen dann gemeinsam auf die
Live-Abfrage aus, bis der Neuaufbau durch ist.

Paritätssuite dreimal gefahren: 32/32, 32/32, 32/32.

Stand: `tsc --noEmit` sauber, alle Tests grün.

---

## Vollständiger Testlauf zum Stand mit Content-Length

Beim letzten Mal war mein Budget aufgebraucht, bevor die Suiten durch waren.
Nachgeholt, in Blöcken:

| Block | Ergebnis |
|---|---|
| Statische Suiten (8 Dateien) | 60 / 60 |
| Frontend- und Logiksuiten (7 Dateien) | 60 / 60 |
| CSP, Preise, Async-Routen, Bilder (4 Dateien) | 58 / 58 |
| `parts-summary` (Postgres) | 6 / 6 |
| `catalog-api` (Postgres) | 8 / 8 |
| `api-parity` (Postgres) | 32 / 32 |
| **gesamt** | **224 / 224, 0 übersprungen** |

Dazu `tsc --noEmit` sauber. 26 Testdateien.

Damit ist der ausgelieferte Stand vollständig bestätigt — die offene Stelle aus
der letzten Runde ist geschlossen.

---

## Der Verbindungs-Pool ist raus — er war die Ursache

Deine Beobachtung war der Beweis: Ein **einzeln** geöffnetes Bild braucht 10 bis
15 Sekunden, danach ist es gecached und der Reload sofort da.

Ein einzelnes Bild kann nicht am CDN scheitern — die Diagnose zeigte 60 bis
200 ms Antwortzeit. Es stand in **meiner** Warteschlange: `maxSockets: 8` reihte
die Anfrage hinter die noch laufenden Kachel-Anfragen der geöffneten App-Seite.

Nachgestellt:

```
mit maxSockets: 8    einzelnes Bild nach 1199 ms (hinter 60 Kacheln)
ohne Begrenzung      einzelnes Bild nach  152 ms
```

Bei den realen CDN-Zeiten skaliert das genau auf die beobachteten 10–15
Sekunden.

**Die Begrenzung ist entfernt.** `keepAlive` bleibt — Verbindungen
wiederzuverwenden spart den TLS-Handshake und kostet nichts.

### Was ich daraus mitnehme

Ich habe den Pool eingebaut, weil ich vermutete, das CDN würde 60 gleichzeitige
Verbindungen drosseln. **Diese Vermutung haben die Messwerte nie gestützt** —
die Zähler standen durchgehend auf `timeout: 0, error: 0, notFound: 0`. Ich habe
danach zwei weitere Runden damit verbracht, Folgeprobleme des Pools zu beheben
(verhungernde Warteschlange bei abgebrochenen Anfragen), statt die Ursache zu
hinterfragen.

Was aus diesen Runden bleibt und für sich richtig ist:

- **`res.on('close')`** gibt die CDN-Verbindung bei Abbruch frei — sinnvoll,
  unabhängig vom Pool.
- **`Content-Length`** auf allen drei Auslieferungswegen — spart dem Proxy
  davor das Puffern.
- **Fehlerzähler und Logging** im Proxy — sie haben genau diese Fehldiagnose
  aufgedeckt.
- **Eindeutige Temp-Dateien** und die **Vollständigkeitsprüfung** — die
  behobenen echten Fehler.

Stand: `tsc --noEmit` sauber, 75 Tests grün, Paritätssuite 32/32.

---

## Weisse Seite: der Proxy verschluckte Content-Encoding

Dein Hinweis „auch bei sofortigem Reload erscheint das Bild" hat die
Warteschlangen-Erklärung endgültig widerlegt — es geht nicht um Zeit. Die
**erste** Antwort ist unbrauchbar, die zweite nicht.

Der Unterschied zwischen beiden: Die erste kommt vom CDN durch den Proxy, die
zweite aus dem Plattencache. Und im Miss-Pfad wurden vom CDN nur `content-type`
und `content-length` gelesen — **`content-encoding` nicht.**

Node entpackt nichts von selbst. Liefert das CDN den Inhalt komprimiert, reicht
der Proxy die rohen Bytes durch und behauptet `Content-Type: image/jpeg`. Der
Browser sieht gültige Kopfzeilen, eine passende Länge, Status 200 — und kann
nichts damit anfangen. Weisses Fenster, ohne Fehlermeldung. Aus dem
Plattencache liegt danach das entpackt gespeicherte Bild, deshalb der sofortige
Erfolg beim Neuladen.

Nachgestellt:

```
ohne Weitergabe   Content-Encoding: (fehlt)  → Browser sieht gzip-Bytes als JPEG → weiss
mit  Weitergabe   Content-Encoding: gzip     → entpacktes JPEG
```

**Behoben:** `Content-Encoding` wird weitergereicht, wenn das CDN sie setzt.

### Zusätzlich: Längenabgleich

Wie viele Bytes tatsächlich beim Client ankommen, wird jetzt mitgezählt und mit
der angekündigten Länge verglichen. Weicht es ab, landet das im Log und im
Fehlerzähler:

```
[img-proxy] an den Client gingen 41230 von 72872 Bytes: https://…
```

Eine zu kurz gelieferte Antwort lässt den Browser auf den Rest warten — auch das
ergibt eine weisse Seite und war bisher unsichtbar.

### Probe erweitert

`/api/v1/admin/img-probe` zeigt jetzt auch `content_encoding`,
`content_length` und `transfer_encoding` je Variante. Damit ist auf einen Blick
zu sehen, ob das CDN komprimiert ausliefert.

Stand: `tsc --noEmit` sauber, 62 Tests grün, Paritätssuite 32/32.

---

## Rückbau: Pool zurück, Reparaturjob und Cache-Bereinigung raus

### Verbindungs-Pool wieder da — mit 32 statt 8

Die Obergrenze schützt den Server davor, bei einer Kachelwand beliebig viele
gleichzeitige TLS-Verbindungen zu öffnen. Bei 8 war sie zu eng; gemessen an 60
Kachel-Anfragen:

```
maxSockets 8    einzelnes Bild nach 1195 ms
maxSockets 32   einzelnes Bild nach  282 ms
ohne Grenze     einzelnes Bild nach  153 ms
```

Mit 32 laufen die 60 Bilder in zwei Wellen statt in acht. Entscheidend bleibt
`res.on('close')`: Ohne die Freigabe bei Abbruch belegten tote Anfragen ihren
Platz — das war der eigentliche Schaden der ersten Fassung, nicht die Grenze.

### Reparaturjob entfernt

Er beruhte auf der Annahme, die gespeicherten Bildadressen seien kaputt. Die war
falsch: Das CDN liefert für alle geprüften URLs 200. Restlos ausgebaut —
`jobs/imageRepair.ts`, Zeitplan-Eintrag, Monitoring-Eintrag, Icon, beide
Beschriftungen, die Tabelle `dead_images` samt dem Eintrag im Proxy. Ein Test
hält fest, dass nichts zurückbleibt.

### Start-Bereinigung des Bild-Caches entfernt

Auf deinen Wunsch — du löschst die Bilder beim Testen von Hand. Mit der
Längenprüfung beim Schreiben und den eindeutigen Temp-Dateien können ohnehin
keine beschädigten Dateien mehr entstehen; der Scan war eine Reparatur für
Altbestand, den es nach einmaligem Löschen nicht mehr gibt.

Damit entfällt auch der Marker `img_cache_scanned` in `global_settings`. Ein
vorhandener Eintrag stört nicht, kann aber weg:

```sql
DELETE FROM global_settings WHERE key = 'img_cache_scanned';
```

### Tests

`test/image-repair.test.js` ist durch `test/img-proxy.test.js` ersetzt. Die
Prüfungen zum Job sind entfallen, alle übrigen erhalten: eindeutige
Temp-Dateien, Vollständigkeitsprüfung, Reihenfolge der Streams,
Content-Type/-Length/-Encoding, Freigabe bei Abbruch, Pool-Breite, Fehlerzähler,
Diagnose-Endpunkte — plus die Kontrolle, dass der Job restlos weg ist.

Stand: `tsc --noEmit` sauber, 68 Tests grün, Paritätssuite 32/32,
`parts-summary` 6/6.

---

## Weisse Bilder bei Status 200: Komprimierung wird jetzt entpackt

Deine Beobachtung — Server meldet 200, Seite bleibt weiss, und die
Längenabgleich-Meldung fehlt im Log — passt genau zu einem komprimiert
durchgereichten Körper: Status stimmt, Länge stimmt, nur der Inhalt ist für den
Browser kein Bild.

Statt die Kopfzeile weiterzureichen (so stand es im letzten Paket) geht der
Proxy das jetzt an der Wurzel an:

**1. Unkomprimiert anfordern.** Beide Kopfzeilen-Sätze senden
`Accept-Encoding: identity`.

**2. Trotzdem Komprimiertes wird entpackt.** Nicht jedes CDN hält sich an
`identity`. Kommt `gzip`, `deflate` oder `br` zurück, läuft der Körper durch
`zlib`, bevor er zum Client und in den Cache geht. Die angekündigte Länge wird
dann entfernt, weil sie für den komprimierten Körper galt.

Entpacken statt Weiterreichen ist die robustere Wahl: Ein Reverse-Proxy
dazwischen kann die Kopfzeile entfernen oder den Körper anfassen — und im
Plattencache läge sonst komprimierter Inhalt, der beim nächsten Ausliefern
wieder die passenden Kopfzeilen bräuchte. So ist die gespeicherte Datei immer
ein echtes Bild, unabhängig von allem davor.

Beide Fälle durchgespielt:

```
CDN identity → Client: echtes JPEG | Cache: echtes JPEG
CDN gzip     → Client: echtes JPEG | Cache: echtes JPEG
```

Wird entpackt, steht das im Log:

```
[img-proxy] entpacke gzip: https://…
```

Die Längenabgleiche (Cache-Schreiben und gelieferte Bytes) gelten nur noch für
unentpackte Antworten — nach dem Entpacken wäre der Vergleich sinnlos.

Stand: `tsc --noEmit` sauber, 65 Tests grün, Paritätssuite 32/32 (ein Lauf war
rot, zweimal wiederholt grün — nicht reproduzierbar).

---

## Diagnose: was liefert der Proxy tatsächlich aus?

Stand der Fakten nach dieser Runde:

- CDN antwortet mit **200** auf alle drei Kopfzeilen-Varianten
- Proxy meldet **200**
- **Kein einziger Log-Eintrag** — weder Fehler noch `entpacke gzip`
- Browser zeigt trotzdem nichts

Das heisst: keine Komprimierung, keine Zeitüberschreitung, kein Verbindungsfehler,
keine Längenabweichung. Der Proxy tut aus seiner Sicht alles richtig. Damit sind
alle meine bisherigen Erklärungen widerlegt — auch die Komprimierungs-These.

Der einzige Blickwinkel, der bisher fehlte, ist der **Inhalt**. Die Probe
liefert jetzt `body_check`:

```json
"body_check": {
  "status": 200,
  "content_encoding": null,
  "first_bytes_hex": "ff d8 ff e0 00 10 4a 46 49 46 00 01 01 01 00 60",
  "looks_like": "JPEG"
}
```

Erkannt werden:

| Erste Bytes | Bedeutung |
|---|---|
| `ff d8 ff` | gültiger JPEG-Anfang |
| `89 50 4e 47` | gültiger PNG-Anfang |
| `1f 8b` | gzip — die Komprimierungs-These wäre doch richtig |
| `3c …` (`<`) | HTML statt Bild — das CDN liefert eine Seite |

Erkennungslogik gegen alle vier Fälle geprüft.

**Damit ist die Frage in einem Aufruf entschieden:**

- `looks_like: "JPEG"` → Der Server holt ein einwandfreies Bild. Dann liegt es
  **nicht** am Proxy, sondern zwischen Server und Browser (Reverse-Proxy) oder
  im Client. Nächster Schritt wäre, `imgUrl()` zu überbrücken und direkt vom CDN
  zu laden — das trennt die beiden endgültig.
- `looks_like: "gzip …"` → Komprimierung nach allem doch, und die Entpackung im
  neuen Build behebt es.
- `looks_like: "HTML/XML statt Bild"` → Das CDN liefert für diese URL eine
  Seite, kein Bild.

Stand: `tsc --noEmit` sauber, 52 Tests grün, Kompilat für alle geänderten
Dateien neuer als die Quelle (geprüft — `npm start` fährt `server.js`).

---

## Die Ursache: mein Abbruch-Handler schoss gesunde Übertragungen ab

`body_check` hat es entschieden:

```
first_bytes_hex: "ff d8 ff e0 00 10 4a 46 49 46 …"   → JFIF, ein einwandfreies JPEG
content_encoding: null                                → keine Komprimierung
```

Der Server holt also ein gültiges Bild. Trotzdem bleibt der Cache leer
(`original: null`) und der Browser zeigt nichts — **ohne einen einzigen
Log-Eintrag**. Genau eine Stelle im Code kann das erzeugen, und es ist die, die
ich zwei Runden zuvor eingebaut habe:

```js
res.on('close', () => {
  if (!res.writableFinished) { r.destroy(); activeReq?.destroy(); }
});
```

`!writableFinished` ist zu scharf. Je nachdem, was zwischen Server und Browser
sitzt, kann `close` feuern, **bevor** Node `writableFinished` gesetzt hat. Dann
wird eine völlig gesunde Übertragung mittendrin abgeschossen:

- Der Client hat die Kopfzeilen schon — daher **Status 200**
- Danach kommt nichts mehr — daher **weisse Seite**
- Der Cache-Stream läuft nie zu Ende — daher **`original: null`**
- Der Pfad protokollierte nichts — daher **stilles Log**

Alle vier Beobachtungen aus einer Zeile.

**Behoben:** Abgebrochen wird nur noch, wenn `res.destroyed` gesetzt ist — das
ist bei einer regulär beendeten Antwort false. Und der Fall wird protokolliert:

```
[img-proxy] Client hat abgebrochen, Verbindung freigegeben: https://…
```

Das stille Abschiessen war überhaupt erst möglich, weil dieser Pfad keine Spur
hinterliess.

**Einschränkung:** Lokal feuert `close` immer nach `finish`, der Fehler tritt
hier also nicht auf — ich konnte ihn nicht nachstellen. Die Änderung ist
begründet, nicht bewiesen. Falls die Bilder danach laden, war es das; falls
nicht, taucht jetzt wenigstens eine Log-Zeile auf, wenn abgebrochen wird.

Stand: `tsc --noEmit` sauber, 66 Tests grün, Paritätssuite 32/32, Kompilat
aktuell.

---

## Absicherung: mehrfache Schrägstriche im Pfad

Beim Nachgehen der weissen Seite ist mir aufgefallen, dass eine Anfrage an
`//api/img-proxy?…` die Route **nicht** trifft. Sie landet stattdessen im
SPA-Catch-all:

```
/api/img-proxy?url=x    → 200 application/json  {"treffer":"img-proxy"}
//api/img-proxy?url=x   → 200 text/html         <html><body></body></html>
```

Für ein `<img>` heisst das: Status 200, weisse Fläche, kein Log-Eintrag, kein
Cache-Schreiben. **Genau die vier Symptome**, die wie ein Proxy-Fehler aussehen
und keiner sind.

Eine Middleware zieht führende Schrägstriche jetzt zusammen, vor allen
Route-Registrierungen. Geprüft mit einem, zwei und drei Schrägstrichen — alle
treffen die Route.

**Zur Einordnung:** Deine Probe-URL war korrekt, dieser Fall erklärt sie also
nicht. Die Absicherung bleibt trotzdem drin: Sie kostet nichts und schliesst
eine Fehlerquelle aus, deren Symptome von einem echten Proxy-Fehler nicht zu
unterscheiden sind.

Stand: `tsc --noEmit` sauber, 45 Tests grün, Paritätssuite 32/32 (ein Lauf rot,
Wiederholung grün — nicht reproduzierbar).

---

## Aufgelöst: der Browser lieferte aus seinem eigenen Cache

Der entscheidende Satz stand im Netzwerk-Tab:

```
Status Code: 200 OK (from disk cache)
2 requests, 697 B transferred
```

**Die Anfrage erreichte den Server gar nicht.** Der Browser lieferte aus seinem
eigenen Plattencache — und zwar die kaputte Antwort aus der Zeit der echten
Fehler (abgeschnittene Cache-Dateien, mehrfach geschriebene Dateien, der
abgeschossene Stream). Alles daraus erklärt sich:

| Beobachtung | Grund |
|---|---|
| kein Log-Eintrag | die Anfrage kam nie an |
| `cache: original: null` | der Server sah sie nie |
| weisse Fläche | die gemerkte kaputte Antwort |
| Reload funktioniert | ein Reload umgeht den Plattencache |
| nur wenige Bilder betroffen | nur die, deren Antwort damals kaputt war |

Ursache der Dauerhaftigkeit war mein eigener Header:
`Cache-Control: public, max-age=86400` — ohne Rückfrage, also einen ganzen Tag.

### Geändert

- **Gestreamte Antworten** (Inhalt noch ungeprüft): `max-age=3600,
  must-revalidate` statt 86400. Wäre etwas faul, heilt es innerhalb einer Stunde
  statt eines Tages.
- **Antworten aus dem Plattencache** (Inhalt geprüft): weiterhin 86400, aber mit
  `must-revalidate` und einem **ETag** aus Dateigrösse und Änderungszeit. Der
  Browser kann billig rückfragen, statt blind auszuliefern.

### Was du jetzt tun musst

Die bereits gemerkten kaputten Antworten sitzen in **deinem Browser**, nicht auf
dem Server. Kein Deploy holt sie da raus:

- **Strg+Umschalt+R** auf der Seite, oder
- DevTools offen → „Disable cache" ankreuzen → einmal neu laden, oder
- Browserdaten für die Seite löschen

Danach sollten die verbliebenen Kacheln laden.

Stand: `tsc --noEmit` sauber, 68 Tests grün, Paritätssuite 32/32.

---

## Fix: Zustand beim Anlegen eines Sets wurde verworfen

Ein als „Gebraucht" erfasstes Set landete als „Neu" in der Datenbank.

`addSet()` nimmt den Zustand als sechsten Parameter — **beide Webapp-Routen
haben ihn nicht weitergereicht:**

| Route | Fehler |
|---|---|
| `POST /api/sets` | las `condition` gar nicht erst aus dem Body |
| `POST /api/sets/add-stream` | las ihn als `setCondition`, benutzte ihn aber nie |

Ohne den Parameter greift in `addSet()` der Standardzustand des Nutzers, also in
aller Regel „Neu". Die Android-API (`routes/api_v1/sets.ts`) übergab ihn korrekt
— nur die Webapp nicht.

Beide Aufrufe reichen ihn jetzt durch.

**Test.** `test/set-condition-aggregate.test.js` prüft klammerbewusst, dass
**jeder** `addSet`-Aufruf sechs Argumente übergibt, und dass `POST /api/sets`
den Zustand aus dem Body liest. Ein Aufruf mit fünf Argumenten schlägt damit
sofort rot — die Signatur allein hätte den Fehler nicht verhindert, weil der
sechste Parameter einen Vorgabewert hat und ein Weglassen deshalb erlaubt ist.

Stand: `tsc --noEmit` sauber, 60 Tests grün, Paritätssuite 32/32.

---

## Endlich die Ursache: die Minifiguren-Liste baute sich bei jeder Seite neu auf

Deine Log-Zeilen waren der Beweis — Dutzende davon:

```
[img-proxy] Client hat abgebrochen, Verbindung freigegeben: …
```

Die Abbrüche sind **echt**. Ein Browser bricht Bildanfragen ab, wenn die
`<img>`-Elemente aus dem DOM verschwinden. Und genau das passierte:

```js
// in loadMinifigsMore(), bei JEDER nachgeladenen Seite:
renderFigs(allFigsCache);     // ← ersetzt die KOMPLETTE Liste per innerHTML
```

Bei 780 Minifiguren und 60 pro Seite sind das 13 vollständige Neuaufbauten.
Jeder wirft alle bereits laufenden Bildanfragen weg. Bilder, die es nie über
eine Nachladerunde hinaus schafften, blieben leer — und weil die abgebrochene
Antwort im Browser-Cache landete, blieben sie es auch nach dem Fix.

Die Galerie macht es seit ihrer Umstellung richtig (`appendGallery`); bei den
Minifiguren war es liegen geblieben. Mein Fehler beim Übertragen des Musters.

**Behoben:** `appendFigs(batch)` rendert die neue Seite in einen losgelösten
Knoten und hängt nur deren Zeilen beziehungsweise Kacheln an die bestehende
Liste an. `renderFigs(list, target)` nimmt dafür ein optionales Ziel. Passt die
Struktur nicht (etwa nach einem leeren Zustand), wird einmalig neu gebaut.

Nachgestellt: Nach dem Anhängen sind alle drei Zeilen da, und das bestehende
`<img>`-Element ist **dasselbe Objekt** wie vorher — es gibt also nichts
abzubrechen.

**Damit schliesst sich die Kette:**

1. Die Liste baute sich bei jedem Nachladen neu auf → Bildanfragen brachen ab
2. Die abgebrochenen Antworten landeten mit `max-age=86400` im Browser-Cache
3. Von da an lieferte der Browser sie ohne Rückfrage aus — „200 from disk cache",
   kein Server-Log, kein Server-Cache, weisse Fläche

Punkt 2 und 3 sind seit der letzten Runde entschärft, Punkt 1 jetzt behoben.

Stand: `tsc --noEmit` sauber, 88 Tests grün, Paritätssuite 32/32.

---

## Minifiguren-Bilder werden lokal abgelegt — im bestehenden Job

### Warum die Minifiguren langsamer waren

Beide Bildarten liegen benutzerunabhängig, aber sie werden völlig
unterschiedlich ausgeliefert:

| | Set-Bilder | Minifiguren-Bilder (vorher) |
|---|---|---|
| Ort | `public/images/sets/<nr>.jpg` | `data/img_proxy_cache/<sha1-der-url>` |
| Schlüssel | Set-Nummer | URL |
| Auslieferung | **`express.static`** | **`/api/img-proxy`** |

Ein Set-Bild geht durch Express' statische Auslieferung mit `ETag`,
`Last-Modified` und `sendFile`. Ein Minifiguren-Bild durchlief jedes Mal die
Proxy-Route: Session auflösen, Cache-Datei suchen, Stream aufsetzen. Bei 60
Kacheln summiert sich das — und beim ersten Anzeigen kam je Bild ein
CDN-Roundtrip dazu.

### Was geändert wurde

Der Hintergrundlauf `img-dl-bg` lud bisher Set-Bilder, manuelle Teile und
**nur manuell erfasste** Minifiguren. Die Beschränkung `source='manual'` ist
weg: Jetzt werden alle Minifiguren ohne lokales Bild geholt.

`DISTINCT ON (fig_number)`, weil die Datei nach der Figur benannt und von allen
Nutzern geteilt wird — sie muss nur einmal geladen werden. Das anschliessende
`UPDATE` setzt `image_local` für **alle** Zeilen dieser Nummer, über Nutzer und
Quellen hinweg.

Gegen die Datenbank geprüft: Dieselbe Figur bei zwei Nutzern ergibt **einen**
Kandidaten, und ein Download setzt **beide** Zeilen.

### Kein neuer Job im Monitoring

Wie gewünscht in `imgDl` („📥 Bild-Download (CDN)") integriert, nicht daneben.
Der Eintrag zeigt jetzt einen echten Fortschritt (`n / gesamt geladen`, alle
zehn Bilder aktualisiert) statt nur „läuft". Die offene Menge in der
Monitoring-Übersicht zählt die Minifiguren des Bestands mit.

Ein Test hält fest, dass **kein** separater Job dafür entsteht.

### Was du erwarten kannst

Der erste Lauf holt alle fehlenden Bilder — bei deinem Bestand dauert das, der
Fortschritt ist im Monitoring sichtbar. Danach kommen die Kacheln über
`express.static` statt über den Proxy, also so schnell wie die Set-Bilder in der
Galerie. Der Hintergrundlauf startet 30 Sekunden nach dem Serverstart und
wiederholt sich stündlich.

Stand: `tsc --noEmit` sauber, 69 Tests grün, Paritätssuite 32/32.

---

## Papierkorb statt ✕ auf den Löschknöpfen

`TRASH_ICON_SVG` in `01-core.js`, verwendet in:

- **Set-Kachel** (`02-gallery.js`) — der rote Knopf oben rechts
- **Minifiguren-Kachel** und **-Tabellenzeile** (`06-minifigs.js`), jeweils nur
  bei manuell erfassten

Das Symbol zeichnet mit `stroke="currentColor"` statt fester Farbe. Damit dient
derselbe Pfad weiss auf rotem Grund (`.delbtn`) und rot auf hellem Grund
(`.bd`) — keine zweite Fassung nötig.

**Beschriftung ergänzt:** Ohne Text braucht ein Knopf eine für Hilfstechnik
lesbare Bezeichnung. `title` und `aria-label` kommen aus `detail.delete`
(bestand schon) und `figs.delete` (neu, DE und EN). Das SVG selbst ist
`aria-hidden`, damit es nicht doppelt vorgelesen wird.

`.delbtn svg` bekommt in `styles.css` eine feste Grösse von 14 px — die alte
`font-size`-Angabe wirkt auf ein SVG nicht.

**Bei den manuell erfassten Teilen gibt es auf der Kachel keinen Löschknopf** —
dort führt der Weg über die Detailansicht. Da war also nichts zu ersetzen; sag
Bescheid, falls du dort auch einen möchtest.

Stand: `tsc --noEmit` sauber, 75 Tests grün.

---

## Android: Minifiguren-Bilder nutzen jetzt die lokale Kopie

**Ja, eine Anpassung war nötig** — und ohne sie hätte die App von der
serverseitigen Änderung nichts gehabt.

Die Minifiguren-Ansicht der App lud ausschliesslich über `image_url`, also
direkt vom Rebrickable-CDN. Das Feld `image_local` kannte sie gar nicht: Weder
`Minifig` noch `FigValuationItem` hatten es im Modell. Sets und Teile machen es
längst richtig (`part.imageLocal != null -> "$serverUrl${part.imageLocal}"`).

Der Server liefert das Feld bereits (`getMinifigs` selektiert
`MAX(m.image_local)` und reicht es durch `resolveImageLocal`) — es kam nur nie
an.

**Geändert:**

- `Minifig` und `FigValuationItem` haben `@SerialName("image_local")`
- `MinifigCard` und `ManualFigTile` lösen in derselben Reihenfolge auf wie die
  Teile-Ansicht: lokale Kopie, dann relativer Pfad am Server, dann CDN
- `ManualFigTile` bekommt dafür `serverUrl` durchgereicht

**Test.** `MinifigImageFieldTest` (3 Fälle): `image_local` wird gelesen und hat
Vorrang, ohne den Wert bleibt die CDN-Adresse, und die Finanz-Minifiguren kennen
das Feld ebenfalls.

**Nebenbefund:** Weil die App ihre Minifiguren-Bilder direkt vom CDN geholt hat,
war sie von den ganzen Proxy-Problemen der letzten Runden nie betroffen.

**Ungeprüft wie immer** — kein Android-SDK. Klammerbilanz in allen drei
geänderten Dateien ausgeglichen, aber `./gradlew assembleDebug` bleibt nötig.

---

## Korrektur: `image_local` landete in der falschen Klasse

`MinifigsScreen.kt:232 — Unresolved reference 'imageLocal'`

Beim Einfügen habe ich auf `@SerialName("fig_name")` gezielt — und den ersten
Treffer erwischt. Der liegt in `AddMinifigResponse`, nicht in
`FigValuationItem`. `Minifig` hatte das Feld korrekt bekommen, deshalb schlug
nur die eine der beiden Verwendungsstellen fehl.

Behoben: Feld aus `AddMinifigResponse` entfernt, in `FigValuationItem`
eingefügt.

**Gegenprobe über alle Dateien:** Jede `.imageLocal`-Verwendung in `ui/` wurde
gegen den Typ der Variablen aufgelöst und geprüft, ob die zugehörige Klasse das
Feld führt. Klassen mit `image_local`: `SetItem`, `Part`, `PartValuationItem`,
`FigValuationItem`, `ValuationSet`, `Minifig`, `BarcodeResponse` — keine
Verwendung ohne Feld.

Das ist derselbe Fehler wie beim `finance.qty_avg`-Umbenennen in der Webapp:
ein zu unspezifisches Suchmuster mit `count=1`. Beim nächsten Mal nehme ich
mehr Kontext in die Suche.

---

## Fix: Kaufpreis eines gebrauchten Sets war der Neupreis

**Gemeldet:** Set als „Gebraucht" erfasst, Marktpreis gebraucht 33 CHF, neu
55 CHF — eingetragen wurden 55 CHF bei Zustand „Gebraucht".

Wird beim Erfassen kein Kaufpreis angegeben, trägt der Server den aktuellen
Marktpreis ein. `getCurrentMarketPrice()` nimmt den Zustand als dritten
Parameter — **drei Aufrufstellen haben ihn nicht übergeben:**

| Stelle | Wirkung |
|---|---|
| `addSet()`, Hauptpfad | neues Set: Neupreis statt Gebrauchtpreis |
| `addSet()`, Wiederhinzufügen | dasselbe beim erneuten Erfassen |
| `PUT /sets/:sn`, leerer Kaufpreis | dasselbe beim nachträglichen Leeren |

Ohne den Parameter fällt die Funktion auf den Standardzustand des Nutzers
zurück, also in aller Regel „Neu".

**Behoben:**

- Im Hauptpfad wird `effectiveCondition` jetzt **vor** der Preisermittlung
  bestimmt und mitgegeben — vorher stand die Zeile darunter.
- Der Wiederhinzufügen-Pfad reicht den gewählten Zustand durch.
- Der Update-Pfad ermittelt den Zustand der **letzten Erfassung** — genau die
  wird anschliessend aktualisiert.

Gegen die Datenbank geprüft (33/55 CHF wie in deinem Fall): Zustand `U` liefert
33.00, Zustand `N` liefert 55.00, ohne Zustand kam 55.00 — der gemeldete Fehler.

**Test.** `test/set-condition-aggregate.test.js`: **jeder**
`getCurrentMarketPrice`-Aufruf in `routes/sets.ts` muss drei Argumente haben,
`effectiveCondition` muss vor der Preisermittlung stehen, und der Update-Pfad
muss den Zustand der letzten Erfassung lesen. Wie beim `addSet`-Fix zuvor
greift der Compiler hier nicht: Der dritte Parameter hat einen Vorgabewert.

**Bestehende Sets sind nicht rückwirkend korrigiert.** Wo der falsche Preis
schon drinsteht, hilft nur: Kaufpreis im Detail-Dialog leeren und speichern —
dann wird er mit dem Zustand der Erfassung neu geholt.

Stand: `tsc --noEmit` sauber, 59 Tests grün, Paritätssuite 32/32.

---

## Nachtrag: warum das Durchreichen des Zustands wirkungslos blieb

Mein Fix der letzten Runde war richtig, aber unvollständig — der Zustand kam
zwar bei `getCurrentMarketPrice()` an und wurde dort auch zu `effectiveCond`
verrechnet. Nur benutzt hat ihn die Funktion nicht:

```js
const effectiveCond = condition || await getUserDefaultCondition(userId);
…
const v = await getSetValue(userId, setNumber, currency);   // ← ohne condition
if (v.unit_price !== null) return v.unit_price;             // ← kehrt hier zurück
// … effectiveCond wird erst DARUNTER benutzt — unerreichbar
```

`getSetValue()` entscheidet anhand der **Erfassungen**. Beim Anlegen eines neuen
Sets gibt es aber noch keine, und `sets.condition` ist ebenfalls noch nicht
geschrieben — die Funktion fiel auf `'N'` zurück und lieferte den Neupreis.
Der berechnete `effectiveCond` wurde nur im nie erreichten Rückfall darunter
verwendet.

**Behoben:** Ein ausdrücklich angefragter Zustand schlägt die
Erfassungs-Bewertung. `getSetValue()` greift nur noch, wenn **kein** Zustand
angefragt wurde — das ist der Anzeigefall, wo die Erfassungen tatsächlich die
richtige Grundlage sind.

Gegen die Datenbank geprüft, mit deinen Zahlen:

```
neues Set, Zustand U →  33   (vorher 55)
neues Set, Zustand N →  55
ohne Zustand         →  55   (Anzeigefall, Erfassungs-Bewertung)
```

**Test.** `getSetValue` muss innerhalb von `if (!condition)` liegen — ein
Zurückverschieben fällt damit sofort auf.

Stand: `tsc --noEmit` sauber, 75 Tests grün, Paritätssuite 32/32 (ein Lauf rot,
Wiederholung grün — nicht reproduzierbar).

---

## Löschknopf auf den Kacheln: dezent statt rot

`styles.css`, `themes/brick.css`

Im Ruhezustand jetzt neutral, beim Überfahren rot. Der Knopf erscheint ohnehin
erst beim Überfahren der Kachel (`.ca` mit `opacity:0`) — ein dauerhaft rotes
Feld zog den Blick stärker auf sich als das Set selbst. Rot bleibt der
Bestätigung vorbehalten: Sobald der Zeiger auf dem Knopf steht, zeigt er, was er
tut.

**Beide Designs brauchen eigene Werte** — das war der nicht offensichtliche
Teil:

| | Ruhezustand | Grund |
|---|---|---|
| Hell | weisser Grund, Rahmen `--bdr`, Symbol `--s500` | sitzt auf hellem Kachelkopf |
| Stein | weiss 14 % auf dem Deckel, Symbol weiss 85 % | sitzt auf der **dunkelblauen Noppenleiste** (`--b600`, 18 px) |

Im Stein-Design liegt der Knopf innerhalb der Noppenleiste — dort wäre das helle
Grau ein Fleck. Stattdessen ein heller Strich auf dem Deckel selbst.

Kontrast geprüft (Richtwert 3:1 für Symbole):

```
Hell:  #64748b auf Weiss              → 4.76
Stein: weiss 85 % auf --b600 #3d5a80  → 5.22
beide: Weiss auf --r500 (Hover)       → 3.76
```

Dazu ein `:focus-visible`-Ring — ohne den ist der Knopf beim Bedienen per
Tastatur unsichtbar. Rot kommt aus dem vorhandenen Token `--r500`, nicht als
Literal.

**Test.** Ruhezustand nicht rot, Hover rot, Fokusring vorhanden, eigene Fassung
für das Stein-Design, kein hartkodiertes `#ef4444`.

Stand: `tsc --noEmit` sauber, 51 Tests grün.

---

## Fix: QR-Code-Hinweis nannte 30 Minuten — er gilt 5

Gute Frage, der Text war an **drei** Stellen veraltet. Bei der
Sicherheitshärtung ganz zu Beginn wurde der QR-Login auf eine einmal
verwendbare Nonce mit `QR_TTL_MS = 5 * 60 * 1000` umgestellt — die Anzeige ist
nie mitgezogen:

| Stelle | Vorher |
|---|---|
| `i18n.js`, DE und EN | „Der Code ist 30 Minuten gültig" |
| `index.html` | derselbe Text als Vorgabe im Markup |
| `05-settings.js` | Countdown zählte von `1800` Sekunden herunter |

Der Zähler lief also 25 Minuten weiter, obwohl der Code längst ungültig war —
das ist die unangenehmere Hälfte: Wer nach zehn Minuten scannt, sieht „noch
20:00" und bekommt trotzdem eine Fehlermeldung.

**Behoben:** Der Countdown nimmt die Dauer aus `expires_in`, das
`/auth/qr-token` schon immer mitgeliefert hat — der Client hat es nur ignoriert.
Damit stimmt die Anzeige automatisch, falls die Dauer je wieder geändert wird.

Die Texte nennen jetzt 5 Minuten und zusätzlich, dass der Code **nur einmal**
verwendbar ist. Das war bisher nirgends erwähnt, ist aber seit derselben
Härtung so und erklärt eine Fehlermeldung, die sonst rätselhaft wäre.

**Test.** Liest `QR_TTL_MS` aus `routes/auth.ts` und prüft, dass kein
Hinweistext mehr 30 Minuten nennt, dass der Client die Dauer nicht fest
verdrahtet und dass beide Sprachen die tatsächliche Zahl enthalten. Ändert sich
die Dauer, fällt ein vergessener Text sofort auf.

Stand: `tsc --noEmit` sauber, 53 Tests grün.

---

## Android: Autofokus des Scanners — jetzt mit Test gegen die Rückkehr

Du schreibst, es passiert bei jeder Korrektur wieder. Der Code sah richtig aus
(`CONTROL_AF_MODE_CONTINUOUS_PICTURE` gesetzt, kein Fokus-Pump, sogar ein
„Nicht wieder einbauen" im Kommentar) — der Modus stand aber **nur am
Preview-Use-Case**.

CameraX führt die Konfigurationen aller gebundenen Use Cases zu **einem**
Repeating-Request zusammen. Steht `CONTROL_AF_MODE` nur an einem, entscheidet je
nach Gerät und CameraX-Fassung die andere Konfiguration mit — und die Vorgabe
von `ImageAnalysis` ist nicht zwingend `CONTINUOUS_PICTURE`. Auf solchen Geräten
bleibt das Bild unscharf, obwohl der Code stimmig aussieht.

Betroffen waren **beide** Kamera-Ansichten: `BarcodeScannerScreen` und
`SetupScreen` (QR-Code beim Einrichten). Das erklärt „in den verschiedenen
Orten".

**Behoben:** Der AF-Modus steht jetzt an Preview **und** ImageAnalysis. Damit ist
das Ergebnis unabhängig davon, welcher Use Case die Führung übernimmt.

### Gegen die Wiederkehr

`CameraFocusConfigTest` prüft beide Dateien:

- `CONTROL_AF_MODE_CONTINUOUS_PICTURE` muss **zweimal** vorkommen — einmal je
  Use Case. Wird eine Stelle beim Umbau vergessen, schlägt der Test fehl.
- Kein periodisches `startFocusAndMetering`: In den 240 Zeichen davor darf kein
  `delay(`, `Timer`, `scheduleAtFixedRate` oder `while (` stehen. Tap-to-Focus
  im Touch-Listener bleibt erlaubt, ein Pump nicht.

Beide Prüfungen laufen gegen die aktuellen Dateien durch — nachgestellt, weil
ich die Kotlin-Tests hier nicht ausführen kann.

**Ungeprüft wie immer:** kein Android-SDK. Klammerbilanz in beiden Dateien
ausgeglichen, `CaptureRequest`-Import und `ExperimentalCamera2Interop`-Opt-in in
beiden vorhanden und für die neue Stelle wirksam.

---

## Absicherung gegen die Rückkehr des Autofokus-Fehlers

Du hast gefragt, ob ich sicherstellen kann, dass ich das nicht wieder ändere.
**Versprechen kann ich es nicht** — ich habe zwischen Sitzungen keine
Erinnerung an dieses Gespräch. Was mich aufhält, muss im Projekt selbst stehen.
Drei Schichten, von innen nach aussen:

**1. Warnblock am Kopf beider Kamera-Dateien.** Wer die Datei öffnet, sieht als
Erstes, welche zwei Fehler hier schon mehrfach passiert sind und warum der Code
trotzdem richtig aussieht. Ausdrücklich mit dem Hinweis: bei Testfehlschlag den
Code korrigieren, nicht den Test.

**2. `CameraFocusConfigTest`.** Prüft beide Dateien auf genau zwei Vorkommen des
AF-Modus (einmal je Use Case) und auf das Fehlen eines periodischen
`startFocusAndMetering`. Die Fehlermeldung erklärt die Ursache mit.

Wichtig dabei: Der Test blendet Kommentare aus, bevor er zählt — sonst hätte der
neue Warnblock die Zählung selbst verfälscht. Genau dieser Fehler ist mir in
dieser Sitzung schon dreimal unterlaufen (bei `eval`, `r.pipe(res)` und
`addSet()`), deshalb diesmal direkt mitgedacht und nachgestellt: 2 Treffer je
Datei, kein Pump.

**3. `INVARIANTEN.md` im Projektwurzelverzeichnis.** Eine kurze Liste der Dinge,
die schon mehrfach kaputtgegangen sind, mit Datei, Test und Begründung. Der
Anlaufpunkt, wenn jemand — auch ich in einer neuen Sitzung — sich einen
Überblick verschafft.

Die Liste hat bewusst nur einen Eintrag. Sie ist für Fehler gedacht, die
**wiederholt** auftreten, nicht als Sammelstelle für alles.

**Was das nicht leistet:** Der Test läuft nur, wenn `./gradlew test` läuft. Wenn
du ihn in deine Build-Pipeline aufnimmst, greift die Absicherung automatisch —
ohne das bleibt sie ein Angebot.

---

## Fix: Zustand manuell erfasster Teile und Minifiguren

**Gemeldet:** Auf der Kachel eines manuell erfassten Teils steht „Neu", obwohl
alle Kaufpreise mit „Gebraucht" erfasst sind.

`getManualParts()` und `getManualMinifigs()` lasen ausschliesslich die
Stammtabelle. `parts.condition` beziehungsweise `minifigs.condition` bleibt beim
Anlegen auf dem Vorgabewert stehen — die Erfassungen wurden nie befragt. **Die
Minifiguren hatten denselben Fehler**, wie von dir vermutet.

**Neu:** `applyManualCondition()` leitet den Zustand aus den Erfassungen ab,
nach derselben Regel wie bei Sets. Eine Abfrage für die ganze Seite, nicht eine
je Zeile.

### Die Regel steht jetzt an genau einer Stelle

Beim Umsetzen schlug ein bestehender Test an: *„Die Regel steht 2× im Code."*
Er hatte recht — ich hatte sie in `applyManualCondition()` neu ausformuliert.

Sie liegt jetzt in `conditionFromAcquisitions(acqCount, usedCount, stored)` und
wird von Sets **und** manuellen Einträgen benutzt:

```
usedCount > 0 → 'U'      eine gebrauchte Erfassung genügt
acqCount  > 0 → 'N'      Erfassungen, aber keine gebrauchte
sonst         → stored   ohne Erfassungen der gespeicherte Wert
```

Der Test wurde entsprechend nachgezogen: Er prüft weiterhin auf genau ein
Vorkommen, blendet aber Kommentare aus — der Erklärtext am Helfer zitiert die
Regel selbst. Diese Falle ist mir in dieser Sitzung nun zum vierten Mal
begegnet.

Gegen die Datenbank geprüft:

```
Teil mit U-Erfassung   → U
Teil ohne Erfassung    → N   (gespeicherter Wert)
Figur mit U-Erfassung  → U
Teil mit U + N gemischt → U  (wie bei Sets)
```

**Test.** Gemeinsamer Helfer vorhanden, beide Listen wenden ihn an, keine zweite
Ausformulierung, und `used_count` wird überhaupt ermittelt.

Stand: `tsc --noEmit` sauber, 64 Tests grün, Paritätssuite 32/32.

---

## Fix: manuell erfasstes Teil ohne Kaufpreis

Zwei Lücken auf einmal:

**1. Es entstand gar keine Erfassung.** Beim Anlegen wurde der Kaufpreis nur in
die Stammtabelle `parts` geschrieben — keine Zeile in `part_acquisitions`.
Detailansicht und Zustandsregel arbeiten aber mit den Erfassungen, deshalb war
kein Kaufpreis zu sehen. Bei Sets legt `recordAcquisition()` diese Zeile an; für
Teile fehlte das Gegenstück.

**2. Der Marktpreis wurde ohne Zustand geholt.**
`getCurrentPartMarketPrice(part_number, color_id, uid)` — der vierte Parameter
blieb leer, also fiel die Funktion auf `resolvePartCondition()` zurück. Die
kennt beim Anlegen noch keine Erfassung und liefert den Standardzustand, meist
„Neu". Ein als gebraucht erfasstes Teil hätte den Neupreis bekommen. Dieselbe
Ursache wie zuvor bei den Sets — ich habe damals nur `routes/sets.ts`
durchgesehen.

**Behoben:** Der Zustand geht in die Preisermittlung, und beim Anlegen entsteht
eine Erfassung mit Preis, Menge und Zustand. Liefert BrickLink keinen Preis,
steht dort `NULL` statt `0` — sonst sähe es aus wie ein Kaufpreis von null
Franken.

Gegen die Datenbank geprüft (Neupreis 1.20, Gebrauchtpreis 0.40, erfasst als
gebraucht):

```
Stammsatz  : Kaufpreis 0.40, Zustand U
Erfassung  : angelegt — Preis 0.40, Zustand U, Menge 2
Kachel     : Zustand U
```

**Offen und bewusst nicht angefasst:** Manuell erfasste **Minifiguren** legen
vermutlich ebenfalls keine Erfassung an — die Stelle sieht gleich aus. Ich habe
es nicht geändert, weil ich es nicht mehr messen konnte; wenn dir dort dasselbe
auffällt, ist es dieselbe Handvoll Zeilen.

Stand: `tsc --noEmit` sauber, 49 Tests grün, Paritätssuite 32/32.

---

## Fix: manuell erfasste Minifiguren bekamen keinen Preis

Anders als bei den Teilen fehlte hier **nicht** die Erfassung — die legt
`addManualFig()` seit jeher an, und die Preislogik samt Teile-Schätzung war
ebenfalls vollständig. Reproduziert habe ich trotzdem genau dein Bild: Trotz
4.50 CHF im Preis-Cache blieben Stammsatz **und** Erfassung auf `null`.

**Ursache** in `getCurrentFigMarketPrice()`:

```js
if (blFigNumber) {                       // ← nur MIT separater BL-Nummer
  const priceData = await fetchMinifigPrice(blFigNumber, …);
  …
}
return await estimateFigPriceFromParts(figNumber, userId);
```

Der BrickLink-Abruf lief nur, wenn eine **abweichende** `bl_fig_number`
hinterlegt war. Bei einer manuell erfassten Figur ist das die Ausnahme — meist
stimmt die eigene Nummer (`sw0001` &c.) mit der BrickLink-Nummer überein. Der
Abruf wurde übersprungen, die Teile-Schätzung übernahm, und die liefert ohne
Teile-Zusammensetzung von Rebrickable nichts:

```
[minifig-price-estimate] sw0001: keine Teile-Zusammensetzung erhalten
Stammsatz : purchase_price null
```

**Behoben:** Es werden beide Nummern versucht — die hinterlegte BL-Nummer und
die eigene. Sind sie identisch, wird nicht doppelt gefragt. Die Reihenfolge ist
die von dir gewünschte: **BrickLink zuerst, die Schätzung über die Einzelteile
nur, wenn dort nichts zu holen ist.**

Nachher, mit 9.90 (neu) und 4.50 (gebraucht) im Cache, erfasst als gebraucht:

```
Stammsatz : 4.50 / U
Erfassung : 4.50 / U
```

**Test.** Beide Nummern werden versucht, der Abruf hängt nicht mehr an einer
separaten BL-Nummer, die Teile-Schätzung steht dahinter, und die Erfassung trägt
den tatsächlich verwendeten Preis.

Stand: `tsc --noEmit` sauber, 50 Tests grün, Paritätssuite 32/32.

---

## Fix: Zweiterfassung eines manuellen Teils ohne Kaufpreis-Eintrag

Dein Verdacht stimmte — es hängt zusammen, aber die Ursache lag noch eine Ebene
tiefer als die Erfassung, die ich zuletzt ergänzt hatte.

`addManualPart()` hat einen **frühen Ausstieg** für bereits vorhandene Teile:

```js
if (existing) {
  await db.run('UPDATE parts SET quantity = quantity + $1 …');
  return { action: 'updated', part_number };   // ← endet hier
}
```

Meine Erfassung aus der letzten Runde steht weiter unten und wurde bei einer
Zweiterfassung nie erreicht. Ergebnis: Menge stieg, aber kein Kaufpreis-Eintrag
und kein Erfassungsdatum. Der CSV-Import macht an derselben Stelle seit jeher
beides — nur die Einzelerfassung nicht.

**Behoben:**

- Der `existing`-Pfad legt jetzt ebenfalls eine Erfassung an, mit eigenem
  Kaufpreis (eingegeben oder Marktpreis für den gewählten Zustand) und eigenem
  Datum.
- `acquired_at` wird aus dem Body übernommen: `COALESCE($7::timestamptz, NOW())`.

Gegen die Datenbank geprüft — zweimal dasselbe Teil, verschiedene Daten:

```
Erfassungen: 2
  2026-01-15 | Menge 2 | Preis 1.20
  2026-06-20 | Menge 3 | Preis 1.20
Teil-Menge : 5
```

**Zwei eigene Fehler auf dem Weg dorthin**, beide gemessen und korrigiert: Meine
erste Fassung prüfte die Existenz **nach** dem INSERT und zählte die frisch
angelegte Zeile doppelt (7 statt 5). Und der Test verlangte nur **einen**
Erfassungs-Insert — er wäre grün geblieben, obwohl der zweite Pfad fehlte. Er
verlangt jetzt beide.

Stand: `tsc --noEmit` sauber, 36 Tests grün, Paritätssuite 32/32.

**Nicht geprüft:** ob der Client (`03-parts.js`) beim manuellen Erfassen
überhaupt ein `acquired_at` mitschickt. Der Server nimmt es jetzt entgegen —
fehlt das Feld im Formular, greift `NOW()` wie bisher.

---

## Löschknopf: sichtbares Symbol, Hover ohne Rot

Der Screenshot zeigt das Stein-Design, und dort war meine Fassung von vorhin zu
zurückhaltend: Symbol und Rahmen lagen bei 85 % beziehungsweise 28 % Deckkraft
auf der dunkelblauen Noppenleiste — das wirkte ausgewaschen statt dezent.

**Jetzt:**

| | Ruhezustand | Beim Überfahren |
|---|---|---|
| Stein | Symbol und Rahmen **volles Weiss**, Grund weiss 22 % (Noppen bleiben sichtbar) | weisser Grund, Symbol in `--b600` |
| Hell | Symbol `--s500`, weisser Grund, Rahmen `--bdr` | Grund `--s500`, Symbol weiss |

Beim Überfahren dreht sich also das Verhältnis um, statt auf Rot zu wechseln —
in beiden Designs dieselbe Farbwelt wie das Symbol selbst, wie von dir
gewünscht. Rot war ohnehin fragwürdig für einen Knopf, der erst noch einen
Bestätigungsdialog öffnet.

Kontrast in allen vier Zuständen geprüft:

```
Stein Ruhe : Weiss auf --b600   → 7.06
Stein Hover: --b600 auf Weiss   → 7.06
Hell  Ruhe : --s500 auf Weiss   → 4.76
Hell  Hover: Weiss auf --s500   → 4.76
```

Vorher lag der Ruhezustand im Stein-Design bei 5.22 — und das rechnerisch, mit
dem 85-%-Weiss als Volltonwert. Die tatsächlich wahrgenommene Deckkraft war
niedriger, was deinen Eindruck erklärt.

Der Fokusring nimmt ebenfalls `--s500` statt Rot.

Stand: `tsc --noEmit` sauber, 48 Tests grün.

---

## Fix: Zweiterfassung manueller Minifiguren — derselbe frühe Ausstieg

Du hattest recht, und ich hätte es in derselben Runde mitmachen sollen:
`addManualFig()` hat exakt denselben Aufbau wie `addManualPart()`.

```js
if (existing) {
  await db.run('UPDATE minifigs SET quantity = quantity + $1 …');
  return { action: 'updated', fig_number: num };   // ← endet hier
}
```

Die Erfassung weiter unten wurde bei einer zweiten Erfassung nie erreicht:
Menge stieg, aber kein Kaufpreis-Eintrag und kein abweichendes Datum.

**Behoben, analog zu den Teilen:**

- Der `existing`-Pfad legt eine Erfassung an und ermittelt den Preis über
  dieselbe Funktion wie die Erstanlage (`resolveManualFigPurchase`) — also
  inklusive BrickLink-Abruf und Teile-Schätzung als Rückfall.
- `acquired_at` wird übernommen, auf **beiden** Pfaden:
  `COALESCE($6::timestamptz, NOW())`.

Gegen die Datenbank geprüft — zweimal dieselbe Figur, verschiedene Daten:

```
Erfassungen: 2
  2026-02-10 | Menge 1 | Preis 4.50
  2026-07-05 | Menge 2 | Preis 4.50
Figur-Menge: 3
```

**Zur Einordnung:** Ich habe die Minifiguren beim Teile-Fix ausdrücklich als
offenen Punkt benannt, statt sie mitzumachen — das war zu vorsichtig. Die Stelle
war identisch, die Prüfung hätte zwei Minuten gedauert. Beim nächsten
Doppel-Muster dieser Art gehe ich beide Seiten gleich an und melde das Ergebnis,
statt eine Seite als Hausaufgabe zurückzugeben.

Stand: `tsc --noEmit` sauber, 53 Tests grün, Paritätssuite 32/32.

---

## Farbnamen im Teile-Reiter auf Deutsch

Rebrickable liefert Farbnamen ausschliesslich englisch. Sie stehen so in der
Datenbank und werden für BrickLink-Abfragen gebraucht — übersetzt wird deshalb
**nur die Anzeige**, die Daten bleiben unverändert.

### Wortschatz statt Farbliste

Eine Liste aller rund 200 Farben wäre unvollständig, sobald Rebrickable eine
neue aufnimmt. LEGO-Farbnamen sind aber zusammengesetzt, deshalb ein Wortschatz
aus Modifikatoren und Grundfarben: Jedes Wort wird einzeln übersetzt, unbekannte
bleiben englisch stehen.

Im Deutschen werden die Teile zusammengeschrieben — `COLOR_PREFIX_DE` hält fest,
welche Wörter sich an das folgende anschliessen:

```
Dark Bluish Gray    → Dunkelbläulichgrau
Bright Light Orange → Leuchthellorange
Trans-Neon Green    → Trans-Neongrün
Reddish Brown       → Rötlichbraun
Pearl Gold          → Perlgold
Vibrant Coral       → Vibrant Koralle   (unbekanntes Wort bleibt)
```

Bindestriche bleiben erhalten, bei englischer Spracheinstellung passiert nichts.

**Ein Detail, das leicht kaputtgeht:** Der Filterwert (`data-arg`) und der
Vergleich `activeColor === c.color_name` laufen weiter über den **englischen**
Namen. Würde man dort mitübersetzen, fände der Filter nichts mehr. Übersetzt
sind nur Beschriftung und Anzeige. Ein Test hält beides fest.

**Nicht angefasst:** Farbnamen in Katalog, Galerie-Detailansicht und CSV-Export.
Wenn sie dir dort auch auffallen, ist `colorName()` bereits vorhanden — es wäre
je Stelle ein Aufruf.

Stand: `tsc --noEmit` sauber, 60 Tests grün.

---

## E-Mails im Design der Webapp

Die Bestätigungs- und Passwort-Mails hatten fest verdrahtete Farben. Jetzt
richten sie sich nach dem eingestellten Design.

**Wie das Design in die Mail kommt:** `app_theme` ist eine **globale**
Einstellung in `global_settings` — der Mailer liest sie beim Versand. Damit
gilt automatisch das aktuelle Design, auch wenn es sich zwischen zwei Mails
geändert hat.

**Warum eine gespiegelte Palette:** E-Mails kennen keine CSS-Variablen und kein
externes Stylesheet — jeder Wert muss direkt im Markup stehen. `MAIL_THEMES` in
`routes/mailer.ts` spiegelt deshalb die Werte aus `styles.css` und
`themes/brick.css`:

| | classic | brick |
|---|---|---|
| Primärfarbe | `#2563eb` | `#3d5a80` (`--b600`) |
| Hintergrund | `#f1f5f9` | `#c9d5e2` (`--bg`) |
| Rahmen | `#e5e7eb` | `#b7cbe0` (`--b200`) |
| Eckenradius | 10px | 14px (`--rad`) |

Geprüft, dass beide Designs tatsächlich unterschiedliches HTML erzeugen und die
jeweilige Primärfarbe darin vorkommt.

`emailTemplate()`, `emailBtn()` und `infoBox()` nehmen die Palette entgegen und
fallen ohne Angabe auf `classic` zurück. Schlägt das Laden fehl, greift
ebenfalls `classic` — **eine E-Mail darf nie am Design scheitern.**

Das Ziegel-Logo im Kopfbereich bleibt rot: Es ist eine Marke, kein
Design-Element.

**Wichtige Einschränkung:** Die Palette ist eine **Kopie**. Änderst du eine
Farbe in `themes/brick.css`, zieht die E-Mail nicht automatisch nach — das lässt
sich ohne CSS-Variablen in E-Mails nicht vermeiden. `test/mail-theme.test.js`
hält wenigstens fest, dass es zwei unterscheidbare Paletten gibt und sie
angewendet werden; die konkreten Werte musst du bei einer Designänderung von
Hand abgleichen. Ein Kommentar an der Palette weist darauf hin.

Stand: `tsc --noEmit` sauber, 24 Tests grün.

---

## Fix: Farbfilter im Teile-Reiter fand nichts

Jeder Klick auf eine Farbe endete in „Keine Teile gefunden". Die Ursache liegt
in der vorberechneten Zusammenfassung, die ich früher in dieser Sitzung
eingeführt habe:

```js
if (o.color) { cond.push(`color_id = $…`); params.push(parseInt(o.color)); }
```

Der Filter schickt den **Farbnamen** (`Black`), nicht die ID —
`parseInt('Black')` ergibt `NaN`, und die Bedingung traf auf nichts zu. Der
Live-Pfad darunter vergleicht seit jeher über `color_name`; nur der schnelle
Weg über die Zusammenfassung tat etwas anderes. Solange die Zusammenfassung noch
nicht aufgebaut war, funktionierte der Filter — deshalb fiel es erst jetzt auf.

**Behoben:** Beide Pfade filtern über `color_name`. Gegen die Datenbank geprüft:

```
ohne Filter → 2 Teile
Black       → 1
Red         → 1
Blue        → 0
```

Kurz hatte ich zusätzlich eine numerische ID als Alternative erlaubt — wieder
entfernt: Der Live-Pfad kann das nicht, und zwei Pfade mit unterschiedlichem
Verhalten waren ja gerade das Problem.

## Leer-Anzeige: Ziegel statt Puzzleteil

Das Puzzleteil-Emoji (🧩) hat mit LEGO nichts zu tun und passte nicht zur
Navigation. Die Leer-Anzeige zeigt jetzt dasselbe Ziegel-Symbol wie der Reiter
„Teile" — dieselbe SVG-Zeichnung aus `index.html`, nur grösser.

Ein Test hält beides fest: den Namensvergleich in der Zusammenfassung und das
Symbol in der Leer-Anzeige.

Stand: `tsc --noEmit` sauber, 42 Tests grün.

---

## Fix: `PARTS_ICON_SVG has already been declared` — Teile-Reiter tot

Mein Fehler von der letzten Runde, und ein folgenschwerer: Ich habe eine
Konstante `PARTS_ICON_SVG` in `03-parts.js` angelegt — **es gab sie bereits in
`02-gallery.js`**.

Alle `js/*.js` laufen im Browser in **einem** Gültigkeitsbereich. Eine zweite
`const`-Deklaration bricht die betroffene Datei sofort ab, und dann ist **keine**
ihrer Funktionen definiert. Daher die Folgefehler:

```
Uncaught SyntaxError: Identifier 'PARTS_ICON_SVG' has already been declared
Uncaught ReferenceError: loadParts is not defined
```

Der zweite führt von der Ursache weg — er ist nur die Folge des ersten.

**Behoben:** `03-parts.js` benutzt die vorhandene Konstante und skaliert sie für
die Leer-Anzeige (`partsIconLarge()`), statt eine zweite anzulegen. Die in
`02-gallery.js` ist auf `1em` ausgelegt, weil sie dort im Fliesstext steht.

### Damit das nicht wiederkommt

`test/dom-ids.test.js` liest die Skriptliste aus `index.html` in Ladereihenfolge
und meldet jede `const`/`let`/`class`-Deklaration, die in zwei Dateien vorkommt.
Aktuell: 13 Skripte, 50 Namen auf oberster Ebene, keine Kollision.

Diese Prüfung hätte den Fehler beim Schreiben gefangen. Sie kostet nichts und
deckt eine Fehlerklasse ab, die im Betrieb einen ganzen Reiter lahmlegt — genau
das, was du gesehen hast.

Stand: `tsc --noEmit` sauber, 76 Tests grün.

---

## Fix: Teile-Reiter lud gar nicht mehr — doppelte Deklaration

```
Uncaught SyntaxError: Identifier 'PARTS_ICON_SVG' has already been declared
Uncaught ReferenceError: loadParts is not defined
```

Mein Fehler aus der letzten Runde: `PARTS_ICON_SVG` war **längst in
02-gallery.js definiert** — und wird von `04-finance.js` und `06-minifigs.js`
mitbenutzt. Ich habe nicht danach gesucht und blind eine zweite Konstante in
`03-parts.js` angelegt.

Der Browser lädt alle Dateien in denselben globalen Bereich. Ein zweites
`const` bricht die betroffene Datei sofort ab — und dann ist **keine** ihrer
Funktionen definiert. Deshalb der Folgefehler `loadParts is not defined` und ein
komplett toter Teile-Reiter.

**Behoben:** Statt einer zweiten Konstante eine Funktion, die das vorhandene
SVG vergrössert:

```js
function partsIconLarge() {
  return PARTS_ICON_SVG.replace('width:1em;height:1em', 'width:56px;height:56px');
}
```

### Warum `node --check` das nicht gefunden hat

Ich prüfe nach jeder Änderung mit `node --check <datei>`. Jede Datei **für sich**
ist gültig — die Kollision entsteht erst beim gemeinsamen Laden. Genau diese
Lücke hat die Regression durchgelassen.

**Neuer Test** in `test/dom-ids.test.js`: Alle Skripte aus `index.html` werden in
Ladereihenfolge zu einem Programm verkettet und geparst. Gegenprobe gemacht —
mit künstlich eingebauter Doppel-Deklaration schlägt er mit exakt der gemeldeten
Meldung fehl, ohne sie ist er grün.

Damit ist eine ganze Fehlerklasse abgedeckt, nicht nur dieser eine Fall: doppelte
`const`/`let`/`class`-Deklarationen über Dateigrenzen hinweg.

Stand: `tsc --noEmit` sauber, 77 Tests grün.

---

## Fix: Kategorien zeigten nur „Unknown"

`parts.category_name` enthält die Rebrickable-Kategorie-**ID** als Text — oder
die Zeichenkette `'Unknown'`:

```js
const catName = p.part_cat_id ? String(p.part_cat_id) : 'Unknown';
```

Das eingebettete `part`-Objekt in `/sets/{id}/parts/` führt `part_cat_id`
**meist nicht** mit. Damit landete bei fast jedem Teil `'Unknown'` in der
Datenbank, der Join auf `rb_part_categories` griff nie, und die Filterliste
bestand aus einem einzigen Eintrag.

**Behoben ohne Datenänderung:** `rb_parts` stammt aus dem CSV-Sync und kennt
`part_cat_id` zu jeder Teilenummer. Die Kategorieliste löst jetzt darüber auf —
aus `'Unknown'` werden die echten Kategorien:

```
Kategorien:
  11 → Bricks (1)
  27 → Minifig Accessories (1)
Filter Kategorie 11 → 1 Teil
```

**Der Filter musste mit**, sonst wäre die Liste richtig und das Klicken
wirkungslos: Der Live-Pfad prüft zusätzlich über `EXISTS (SELECT 1 FROM
rb_parts …)`.

**Und die Zusammenfassung gibt den Fall ab.** Sie führt `category_name` so, wie
es gespeichert ist — eine eigene Auflösung dort hätte je nach Pfad andere
Ergebnisse geliefert. Genau dieser Fehler war beim Farbfilter eine Runde zuvor
die Ursache; deshalb weicht sie bei gesetztem Kategorie-Filter auf den Live-Pfad
aus, statt eine zweite Wahrheit zu erzeugen.

Ein Test hält alle drei Teile fest.

**Voraussetzung:** Der Rebrickable-CSV-Sync muss gelaufen sein, sonst ist
`rb_parts` leer und es bleibt bei „Unbekannt". Der Sync läuft täglich um 03:00
und ist im Monitoring sichtbar.

Stand: `tsc --noEmit` sauber, 58 Tests grün, Zusammenfassung 6/6.

---

## Nachtrag: Farbüberschriften waren noch englisch

Beim ersten Anlauf hatte ich die Gruppenüberschrift über den Kacheln nicht
erwischt — mein Suchmuster (`${esc(color)}`) passte nicht auf den tatsächlichen
Code (`${esc(g.color)}`), und statt nachzusehen habe ich die Meldung „Muster
nicht gefunden" einfach stehen lassen. Ergebnis: Filterliste auf Deutsch,
Überschrift daneben auf Englisch.

**Jetzt übersetzt:**

- Gruppenüberschrift im Teile-Reiter (`g.color`)
- Farbanzeige in den Finanzen (`04-finance.js`)
- Farbanzeige bei den Minifiguren (`06-minifigs.js`)

Die letzten beiden hatte ich beim ersten Mal gar nicht betrachtet.

**Damit das nicht wieder passiert**, prüft der Test jetzt nicht mehr einzelne
Fundstellen, sondern die Abwesenheit roher Anzeigen: In allen drei Dateien darf
kein `esc(x.color_name)` ohne `colorName()` davor stehen. Gegenprobe gemacht —
mit künstlich eingefügter roher Anzeige schlägt er an, im aktuellen Stand nicht.

Das ist die bessere Form: Eine Liste bekannter Stellen ist beim nächsten neuen
Anzeigeort wieder unvollständig; ein Verbot deckt auch die ab, die es noch nicht
gibt.

Stand: `tsc --noEmit` sauber, 75 Tests grün.

**Zum Kategorie-Filter im Screenshot** („Unknown 688"): Das ist der Stand vor
dem Fix aus der vorigen Runde. Nach dem Deploy braucht es zusätzlich einen
gelaufenen Rebrickable-CSV-Sync, damit `rb_parts` gefüllt ist — sonst bleibt es
bei einem Eintrag.

---

## Fix: Kaufpreis fehlte bei CSV-importierten Sets

Deine Erwartung ist richtig: Ohne manuell erfassten Preis muss der Kaufpreis
beim Anlegen dem damaligen Marktpreis entsprechen. Eine spätere Abweichung ist
die Wertentwicklung — beim Import darf sie nicht entstehen.

**Ursache.** Der CSV-Import fragt zuerst den Preis-Cache ab. Ist das Set dort
noch nicht drin — bei neu importierten Sets die Regel — folgt ein
BrickLink-Abruf, und der scheitert bei vielen Sets am Tageskontingent. Die
Erfassung entstand dann **ohne** Kaufpreis. Später füllte der Preis-Job den
Cache, ab da zeigte die Ansicht einen Marktpreis — der Kaufpreis blieb leer.

### Zwei Änderungen

**1. Beim Import: Historie als letzter Rückfall.** Reihenfolge jetzt
Preis-Cache im passenden Zustand → BrickLink → `price_history`. Der zuletzt
bekannte Preis ist eine bessere Grundlage als gar keiner.

**2. Nachtrag für alles, was trotzdem leer bleibt.** `purchasePriceBackfill.ts`
gab es bereits, hatte aber eine Lücke: `backfillSets()` betrachtet nur Sets mit
`purchase_price IS NULL` und zieht deren Erfassungen mit. Bekam die **Set-Zeile**
beim Import einen Preis, die **Erfassung** aber nicht, blieb sie dauerhaft leer
— genau dein Fall.

Neu findet `backfillAcquisitions()` alle preislosen Erfassungen unabhängig von
der Set-Zeile. Zwei Punkte dabei:

- Der Zustand der **Erfassung** bestimmt den Preis, nicht der des Sets. Ein
  gebraucht erfasstes Exemplar bekommt den Gebrauchtpreis, auch wenn das Set als
  neu geführt wird. Geprüft: bei Neu 80 / Gebraucht 44 im Cache liefert eine
  Gebraucht-Erfassung **44**.
- `sets.purchase_price` wird nur gesetzt, wo noch nichts steht — ein gepflegter
  Wert wird nicht überschrieben.

Der Job läuft 45 Sekunden nach dem Serverstart und pausiert 1,5 Sekunden je
Abruf, um das BrickLink-Kontingent zu schonen. Bei vielen betroffenen Sets
dauert das entsprechend; er nimmt beim nächsten Start das Verbleibende.

**Was er nicht anfasst:** Erfassungen mit einem Preis — auch nicht mit `0`.
Sollte bei dir irgendwo eine `0` statt `NULL` stehen, bleibt sie; dann bräuchte
es eine eigene Entscheidung, ob `0` „kostenlos" oder „unbekannt" heisst.

Stand: `tsc --noEmit` sauber, 77 Tests grün, Paritätssuite 32/32.

---

## Antwort: Währung in price_cache

Ja, sie ist vorhanden — `currency_code` ist Teil des Schlüssels, und alle
Preisabfragen filtern darauf:

```sql
SELECT avg_price FROM price_cache
 WHERE set_number=$1 AND condition IN ('N','U') AND currency_code=$3 …
```

Dasselbe in `part_price_cache` und `minifig_price_cache`. Preise verschiedener
Währungen liegen also nebeneinander und werden nicht verwechselt.

## Fix: CSV-Import las das Datum amerikanisch

Bestätigt und nachgestellt:

```
new Date('05.03.2026')  →  2026-05-03     (3. Mai statt 5. März)
```

JavaScript liest punktgetrennte Daten als MM.DD.YYYY; Postgres tut unter
DateStyle MDY dasselbe. Beide Importe — Sets und Teile — übernahmen den Wert
roh mit einem blossen `.trim()`.

Zwei Folgen: Bei Tagen bis 12 wurden Tag und Monat **stillschweigend
vertauscht**, bei Tagen darüber scheiterte der Import.

**Neu:** `parseCsvDate()` in `utils/csvExport.ts`, von beiden Importen benutzt.

| Eingabe | Ergebnis |
|---|---|
| `05.03.2026` | `2026-03-05` (5. März) |
| `05/03/2026` | `2026-03-05` |
| `31.12.2025` | `2025-12-31` |
| `05.03.26` | `2026-03-05` |
| `2026-03-05` | unverändert (eigenes Exportformat) |
| `31.02.2026` | `null` |
| `29.02.2025` | `null` (kein Schaltjahr) |
| `29.02.2024` | `2024-02-29` |

Zwei Entscheidungen dabei:

**Punkt und Schrägstrich gelten immer als Tag zuerst.** Eine Umdeutung nach
Plausibilität („13 kann kein Monat sein, also drehen") wäre gefährlich: Sie
träfe bei `05.03.` die falsche Wahl und wäre nicht vorhersehbar. ISO bleibt ISO,
weil der eigene Export so aussieht.

**Unmögliche Daten werden abgelehnt statt verschoben.** Eine Prüfung auf 1–31
allein liesse den 31. Februar durch, und `Date` rollt ihn still in den März — aus
einem Tippfehler würde ein falsches, aber plausibel aussehendes Datum. Die
Gegenprobe über ein echtes `Date` fängt das ab.

**Bereits importierte Daten sind nicht rückwirkend korrigiert.** Das liesse sich
auch nicht sicher tun: Ob `2026-05-03` ursprünglich der 3. Mai oder ein
verdrehter 5. März war, steht nirgends. Bei betroffenen Sets hilft nur ein
erneuter Import oder Nachtragen von Hand.

Stand: `tsc --noEmit` sauber, 38 Tests grün, Paritätssuite 32/32.

---

## Fix: „API-Endpunkt nicht gefunden" beim Setzen eines fremden Passworts

Der Dialog in den Einstellungen ruft seit jeher

```
PUT /api/auth/users/:id/password
```

auf — **die Route gab es nicht.** In `routes/auth.ts` standen nur
`/change-password`, `/forgot-password` und `/reset-password`, dazu
`PUT /users/:id/admin` und `DELETE /users/:id`. Der Fehler war also kein
Zufall, sondern eine schlicht nie gebaute Gegenstelle.

**Neu angelegt**, mit vier bewussten Entscheidungen:

**Nur Administratoren** (`requireAdmin`) — wie bei den benachbarten
Nutzerrouten.

**Das eigene Konto ist ausgenommen.** Hier wird kein aktuelles Passwort
verlangt, denn ein Administrator kennt es nicht. Für sich selbst führt der Weg
über `/change-password`, wo das alte geprüft wird. Ohne diese Ausnahme genügte
eine übernommene Sitzung, um das eigene Passwort ohne Kenntnis des alten zu
ändern und den rechtmässigen Besitzer auszusperren.

**Offene Zugänge werden geschlossen** — Sitzungen und API-Token des betroffenen
Kontos. Ein zurückgesetztes Passwort, bei dem alte Zugänge weiterlaufen, wäre
nur halb zurückgesetzt.

**Die Session-Tabelle wird vorher geprüft.** Sie legt der Session-Store zur
Laufzeit an und steht nicht im Schema — ein blindes `DELETE` bräche den Vorgang
ab, obwohl das Passwort längst gesetzt ist.

Gegen die Datenbank geprüft: Das neue Passwort gilt, das alte nicht mehr, ein
unbekannter Nutzer ergibt 404 statt stillem Erfolg.

**Nebenbei:** `test/api-inventory.test.js` hat die neue Route sofort als
unklassifiziert gemeldet — genau wofür er da ist. Eingeordnet als `nur-web`:
Die Android-App hat keine Nutzerverwaltung.

Stand: `tsc --noEmit` sauber, 46 Tests grün, Paritätssuite 32/32.

---

## Fix: Farbdropdown im Formular „Teil erfassen"

`renderColorDropdown()` in `06-minifigs.js` zeigte den rohen Rebrickable-Namen
sowohl im sichtbaren Text als auch im `data-name`-Attribut. Nur der sichtbare
Text ist jetzt übersetzt — `data-name` bleibt englisch, weil er beim Speichern
als `parts.color_name` übernommen wird und für BrickLink-Abgleiche gebraucht
wird. Dieselbe Funktion wie bei Filter und Anzeige im Teile-Reiter.

Ein Test prüft beides: übersetzter Text, unveränderter `data-name`.

Stand: `tsc --noEmit` sauber, 37 Tests grün.

## Zum Kaufpreis-/Marktpreis-Unterschied (Tower Bridge, CHF 216.24 vs 135.11)

Hier möchte ich ehrlich sein, statt eine weitere ungeprüfte Theorie zu liefern
— das habe ich in dieser Sitzung beim Bild-Proxy zu oft getan.

**Was ich geprüft habe:** Der komplette Preispfad für einen neu importierten
Satz sieht korrekt aus — Zustand wird vor der Preisermittlung bestimmt,
`getCurrentMarketPrice()` bekommt ihn als Parameter, die Abfrage bevorzugt den
angefragten Zustand. Kein struktureller Fehler, den ich am Code finden konnte.

**Was ich nicht ausschliessen kann, ohne deine Daten zu sehen:**

1. **`buildSetsCsv()` exportiert den historischen Kaufpreis unverändert** —
   absichtlich, damit eine Migration ihn 1:1 wiederherstellt. Stammt deine CSV
   aus einem Export der alten Instanz, ist 216.24 kein neu berechneter
   Marktpreis, sondern der damals gespeicherte Wert. Die Abweichung zu 135.11
   wäre dann echte Wertentwicklung seit der ursprünglichen Erfassung — keine
   Fehlfunktion.
2. **Deine CSV könnte den Kaufpreis explizit enthalten haben** — dann ist
   216.24 dein eingetragener Preis, nicht der Marktpreis, und eine Abweichung
   ist von Anfang an erwartet.
3. **Echte Marktpreis-Schwankung.** Bei einem grossen, möglicherweise
   auslaufenden Set können BrickLink-Gebraucht-Durchschnittspreise innerhalb
   von Tagen spürbar wandern.

**Um das zu entscheiden, statt weiter zu raten:**

```
GET /api/v1/admin/price-probe?set=10214-1&live=1
```

Das zeigt: die Erfassung mit ihrem gespeicherten Preis und Zustand, alle
`price_cache`-Zeilen mit Alter, und mit `live=1` zusätzlich, was BrickLink
gerade für beide Zustände liefert. Zusätzlich wäre hilfreich: der Inhalt der
`purchase_price`-Spalte in der CSV-Zeile für 10214-1 — war sie leer oder stand
dort ein Wert?

Damit lässt sich in einem Schritt entscheiden, ob hier überhaupt etwas zu
reparieren ist, und falls ja, was genau.

---

## Gefunden: die eigentliche Ursache des Preisunterschieds

Deine CSV-Zeile hat es entschieden: `10214-1,1,,U,01.08.2026` — Kaufpreis leer,
Zustand `U`. Kein manueller Preis, keine Migration mit historischem Wert. Genau
der Fall, den du erwartet hattest: Marktpreis und Kaufpreis hätten
übereinstimmen müssen.

### Der Mechanismus

Beim Anlegen eines **neuen** Sets existiert weder die `sets`-Zeile noch die
`set_acquisitions`-Zeile — beide werden erst geschrieben, nachdem der Kaufpreis
ermittelt wurde:

```
getCurrentMarketPrice(setNumber, userId, 'U')
  → refreshPriceForSet(setNumber, userId)
      → conditionsNeededFor(setNumber, userId)     // liest set_acquisitions + sets
          → BEIDE noch leer → fällt auf 'N' zurück
      → holt und cacht NUR den Neupreis
  → Preisabfrage bevorzugt 'U', findet aber nur den gerade gecachten
    Neupreis → weicht darauf aus
→ 216.24 (Neupreis) landet als Kaufpreis, obwohl „Gebraucht" gewählt war
```

Wenig später — beim Anzeigen des Marktpreises, wenn die Erfassung längst
existiert — sieht `conditionsNeededFor()` die `U`-Erfassung, holt jetzt korrekt
den Gebrauchtpreis (135.11), und die Anzeige stimmt. Der bereits gespeicherte
Kaufpreis bleibt aber auf dem einmal falsch geholten Neupreis stehen. Genau das
Bild aus deinem Screenshot.

### Behoben

`conditionsNeededFor()` und `refreshPriceForSet()` nehmen jetzt einen
**Hinweis-Parameter**. Beim Anlegen wird der gewählte Zustand mitgegeben, auch
wenn die Zeile noch nicht existiert:

```
ohne Hinweis (altes Verhalten)   → ['N']   — bekommt den Neupreis
mit Hinweis "U" (neues Verhalten) → ['U']  — bekommt den Gebrauchtpreis
```

`getCurrentMarketPrice()` reicht den angefragten Zustand jetzt als Hinweis
durch. Die zweite Aufrufstelle (Hintergrund-Anreicherung) brauchte keine
Änderung — sie läuft erst, nachdem die Erfassung bereits existiert.

### Nebenbei behoben: der 500er der Preis-Probe

`SELECT … added_at FROM set_acquisitions` — die Spalte heisst `created_at`.
Jede Probe endete deshalb in „Interner Serverfehler". Zusätzlich war die
Erklärung zur Zustandswahl in der Probe seit der `effectiveCondition`-Umstellung
veraltet und hätte fälschlich auf `sets.condition` verwiesen; sie zeigt jetzt
dieselbe Regel wie die tatsächliche Bewertung.

**Test.** Der Hinweis-Mechanismus ist nachgestellt: ohne Hinweis `['N']`, mit
Hinweis `['U']`. Die Probe ist gegen die korrekte Spalte und die aktuelle Regel
geprüft.

### Was du jetzt tun kannst

Für **neu** importierte Sets greift der Fix sofort. Für Tower Bridge und
ähnlich betroffene bereits importierte Sets: Kaufpreis im Detail-Dialog leeren
und speichern — das holt ihn über denselben, jetzt korrekten Weg neu.

Stand: `tsc --noEmit` sauber, 61 Tests grün, Paritätssuite 32/32.

---

## 10283-1: Daten sind konsistent — aber ein echter Bug daneben gefunden

**Zu deinem Probe-Ergebnis:** Kaufpreis 162.4163, Cache für `N` 162.4163, live
`N` 162.4163 — alle drei stimmen exakt überein. Zum Zeitpunkt der Probe zeigte
die Datenbank für dieses Set **keine Abweichung**. Vermutlich hat sich das
zwischen deinem Blick auf die Anzeige und dem Ausführen der Probe durch einen
zwischenzeitlichen Preis-Abgleich von selbst angeglichen.

**Beim genauen Nachsehen des Pfads, der die „Marktpreis"-Anzeige speist, ist mir
aber ein echter, unabhängiger Fehler aufgefallen** — er passt genau zum
gemeldeten Symptom und tritt bei anderen Sets auf:

`computePnl()` in `utils/financeCalc.ts` — speist `/finance/pnl` und damit den
Marktpreis in Galerie-Kachel **und** Detail-Dialog — selektierte in seiner
SQL-Abfrage **kein** `acq_count`/`used_count`:

```sql
SELECT s.set_number, …, s.condition, COALESCE(a.total_price / …, s.purchase_price)
FROM sets s LEFT JOIN (…) a ON …
```

`effectiveCondition(set)` braucht aber genau diese beiden Felder:

```js
const acqCount = parseInt(set?.acq_count) || 0;   // fehlte im SELECT → immer NaN → 0
const usedCount = parseInt(set?.used_count) || 0; // fehlte im SELECT → immer NaN → 0
if (usedCount > 0) return 'U';
if (acqCount > 0)  return 'N';
return set?.condition === 'U' ? 'U' : 'N';         // ← dieser Zweig lief IMMER
```

Ohne die Felder war `acqCount` immer `0`, `usedCount` immer `0` — die Funktion
fiel **ausnahmslos** auf `sets.condition` zurück, egal was die Erfassungen
tatsächlich sagten. `computeSetsValuation()` (der Finanzen-Reiter) hatte genau
diesen Fehler schon behoben; `computePnl()` (Galerie und Detail-Dialog) nicht.
**Zwei Wahrheiten für denselben Zustand — je nachdem, welcher der beiden Pfade
gerade angezeigt wird.**

Betroffen sind Sets, bei denen `sets.condition` veraltet ist oder gemischte
Erfassungen vorliegen (etwa 1× Neu, 1× Gebraucht). Für ein frisch importiertes
Set mit nur einer Erfassung — wie 10283-1 — stimmt der Fallback zufällig meist
mit dem tatsächlichen Zustand überein, deshalb kein durchgehender Fehler.

**Nachgestellt:** Set mit `sets.condition='N'` (veraltet), tatsächlich 1× Neu +
1× Gebraucht erfasst:

```
sets.condition (veraltet)  : N
computePnl condition       : U    (vorher hätte es N geliefert)
computePnl current_price   : 95   (vorher 160 — der Neupreis)
```

**Behoben:** Dieselbe Unterabfrage liefert jetzt `acq_count` und `used_count`
mit, genau wie bei `computeSetsValuation()`.

Stand: `tsc --noEmit` sauber, 57 Tests grün, Paritätssuite 32/32.

**Für 10283-1 selbst:** Da die Daten laut Probe bereits übereinstimmen, dürfte
sich nichts sichtbar ändern. Falls dir nach diesem Deploy irgendwo — auch bei
anderen Sets — weiterhin ein abweichender Marktpreis auffällt, wäre die Probe
für genau **dieses** Set der nächste Schritt.

---

## Gefunden: warum der Graph einen Abfall zeigt, den es nie gab

Dein Screenshot zeigt es genau: Kaufpreis 162.42, Marktpreis 162.42,
Entwicklung 0.0% — und trotzdem ein deutlicher Abfall im „Preisverlauf", beide
Punkte am selben Tag (1.8.2026).

**Ursache**, in `routes/finance.ts`:

```js
const condition = DEFAULT_PRICE_CONDITION;   // fest 'U'
```

Der Graph nahm den **globalen** Standardzustand (`'U'`, Gebraucht) statt des
**tatsächlichen** Zustands dieses Sets. Dein NASA Space Shuttle Discovery ist
als „Neu" geführt. Sobald für denselben Tag sowohl ein Neu- als auch ein
Gebraucht-Preis im Verlauf standen — was bei einem frischen Import mit
anschliessendem Preis-Abgleich der Normalfall ist —, bevorzugte die
Graph-Abfrage den Gebraucht-Preis für den Verlaufspunkt, während der zuerst
eingefügte Punkt (dein tatsächlicher Kaufpreis, korrekt „Neu") unverändert
blieb. Zwei Punkte, zwei Zustände, ein irreführender Abfall — der reale Preis
hat sich nie bewegt.

**Behoben:** Der Zustand wird jetzt aus den Erfassungen dieses Sets abgeleitet
— dieselbe Regel wie überall sonst (eine gebrauchte Erfassung gewinnt, sonst
Neu, ohne Erfassungen der gespeicherte Wert).

Nachgestellt mit deinem Fall (Set als Neu geführt, Neu-Preis 162.42 und
Gebraucht-Preis 110.48 am selben Tag im Verlauf):

```
aufgelöster Zustand (Fix)      : N
vorher (DEFAULT_PRICE_CONDITION): U  (fest, unabhängig vom Set)
Verlaufspunkt heute (Fix)      : 162.42  (vorher wäre 110.48 gezeigt worden)
```

Das ist die **vierte** Stelle mit demselben Grundproblem in dieser Sitzung —
nach `computeSetsValuation`, `getCurrentMarketPrice` und `computePnl`. Jede
zeigte den Zustand eines Sets über einen eigenen, leicht abweichenden Weg, und
jede mussten einzeln gefunden werden, weil sie unabhängig voneinander
entstanden sind.

Stand: `tsc --noEmit` sauber, 64 Tests grün, Paritätssuite 32/32.

**Für dein Space-Shuttle-Set** sollte der Graph nach dem Deploy eine gerade
Linie zeigen, keinen Abfall — die zugrunde liegenden Preise haben sich ja
nicht verändert, nur die falsche Abfrage hat sie falsch zusammengesetzt.

---

## Android-App: derselbe Fehler, zwei weitere Fundorte — jetzt zusammengefasst

Dein Screenshot der App zeigt es exakt: Marktpreis 110.48 CHF, Kaufpreis 162.42
CHF, „-32.0 %". Beide Zahlen stammen 1:1 aus dem Preis-Cache deines Sets (siehe
letzte Probe) — nur dass 110.48 der **Gebraucht**-Preis ist, während das Set
als „Neu" geführt wird.

**Ursache — dieselbe Zeile wie beim Webapp-Graphen, zweimal:**

```
routes/api_v1/sets.ts
  /sets/:setNumber/price          → fetchPrice(sn, DEFAULT_PRICE_CONDITION, …)
  /sets/:setNumber/price-history  → const condition = DEFAULT_PRICE_CONDITION;
```

`DEFAULT_PRICE_CONDITION` ist fest `'U'`. Beide Android-Endpunkte nahmen damit
unabhängig vom tatsächlichen Zustand deines Sets immer den Gebraucht-Preis.
Und dein Webapp-Graph aus der letzten Meldung zeigte weiterhin denselben
Abfall, weil er noch den alten Serverstand befragt hat — dein Fix aus der
letzten Runde war korrekt, nur noch nicht bei dir angekommen.

### Genug Fundorte — jetzt eine einzige Funktion

Das war der **fünfte** Fundort desselben Grundfehlers in dieser Sitzung:
`computeSetsValuation`, `getCurrentMarketPrice`, `computePnl`, die
Webapp-Verlaufsroute, jetzt die Android-API. Fünf eigene, leicht
unterschiedliche Fassungen derselben Regel zu pflegen ist selbst das Risiko —
deshalb jetzt `resolveSetCondition(uid, setNumber)` in `utils/financeCalc.ts`
als **einzige** Zustandsauflösung für Aufrufer, die nicht schon einen
batch-geladenen Datensatz mit `acq_count`/`used_count` in der Hand haben:

- `routes/api_v1/sets.ts` — beide Android-Routen (`/price`, `/price-history`)
- `routes/finance.ts` — die Webapp-Verlaufsroute (ersetzt die Inline-Fassung
  aus der letzten Runde)

`computeSetsValuation()` und `computePnl()` behalten ihre eigene, batch-
optimierte Variante (`effectiveCondition()` auf einer bereits per JOIN
geladenen Zeile) — das ist bewusst so, eine Einzelabfrage pro Set wäre dort
ein Performance-Rückschritt bei vielen Sets auf einmal.

Gegen die Datenbank nachgestellt, mit deinem exakten Fall:

```
aufgelöster Zustand (Fix) → N
/price liefert jetzt      → 162.4163   (vorher 110.481)
```

**Test.** Beide Android-Routen benutzen den Helfer, keine direkte
`DEFAULT_PRICE_CONDITION`-Verwendung mehr an diesen Stellen, und ein Test
zählt die Verwendungsstellen — künftig sollte niemand mehr eine sechste eigene
Fassung daneben schreiben, ohne dass ein Test anschlägt.

Stand: `tsc --noEmit` sauber, 76 Tests grün, Paritätssuite 32/32.

**Für dein Set:** Nach dem Deploy sollte sowohl die Webapp (Graph als gerade
Linie) als auch die Android-App (Marktpreis = Kaufpreis, 0 % Entwicklung) den
Space Shuttle korrekt zeigen. Falls die Webapp danach immer noch den Abfall
zeigt, prüfe bitte zuerst, ob der neue Stand tatsächlich läuft (Skript-Version
in den Browser-Entwicklertools, siehe `?v=` an den `.js`-Dateien).

---

## Android: Galerie-Kacheln teilweise ohne Bild — dieselbe Fehlerklasse wie beim Server

**Ursache:** Der `OkHttpClient` hinter Coil (`imageOkHttpClient`) ist eine
**einzige, app-weite Instanz** — dieselbe für Katalog, Galerie, Finanzen,
Minifiguren. Er war eng gedrosselt:

```kotlin
.dispatcher(Dispatcher().apply {
    maxRequests = 6
    maxRequestsPerHost = 3
})
```

Bewusst so gewählt, laut Kommentar im Code: Der Katalog lädt bis zu 60
CDN-Bilder pro Seite, und auf langsamen Verbindungen sättigten die Downloads
mit den OkHttp-Standardwerten (5/64) die Leitung, sodass API-Aufrufe in
Timeouts liefen.

**Das Problem:** Diese für den Katalog gedachte Drosselung galt für die ganze
App — auch für die Galerie. Bei einer Kachelwand mit mehr als drei
gleichzeitigen Bildanfragen an denselben Host standen die übrigen in einer
Warteschlange. Scrollt man daran vorbei, bricht Coil die wartende Anfrage ab —
die Kachel bleibt **dauerhaft** leer, nicht nur vorübergehend.

Das ist exakt dieselbe Fehlerklasse, die in dieser Sitzung schon einmal beim
serverseitigen Bild-Proxy für Aufregung gesorgt hat: eine zu enge
Nebenläufigkeits-Begrenzung lässt spät dran kommende Anfragen verhungern statt
sie nur zu verzögern.

**Behoben:** `maxRequestsPerHost` von 3 auf 6, `maxRequests` von 6 auf 12 — noch
deutlich unter den OkHttp-Standardwerten, die Drosselung für den Katalog auf
langsamen Verbindungen bleibt also erhalten, nur nicht mehr eng genug, um die
Galerie zu verhungern.

**Test.** Liest die Werte aus `AppModule.kt` und verlangt `maxRequestsPerHost
>= 6` sowie `maxRequests` im Bereich `[perHost, 32]` — eng genug, um weiterhin
als bewusste Drosselung zu gelten, nicht mehr eng genug, um eine übliche
Kachelwand zu verhungern.

**Das ist eine begründete Hypothese, keine bestätigte Diagnose** — ich kann
Android hier nicht ausführen und habe keinen Log-Zugriff auf dein Gerät. Die
Konstruktion (eine geteilte, eng gedrosselte Verbindung für die ganze App)
erklärt „teilweise nicht geladen" plausibel, aber es gibt noch eine
Alternative: Manche Sets haben schlicht noch kein `image_local` (der
Hintergrundlauf hat sie noch nicht heruntergeladen) und ihr `image_url` zeigt
auf eine beim CDN nicht mehr vorhandene Datei — dieselbe Ursache wie bei den
Minifiguren vor einigen Runden.

**Zur Unterscheidung, falls es nach dem Update weiterhin auftritt:** Bleiben
dieselben Kacheln bei jedem Öffnen leer (auch nach Zurückscrollen und erneutem
Warten), ist es die zweite Ursache — fehlendes Bild. Werden es bei jedem
Öffnen der Galerie andere, wechselnde Kacheln, spricht das für die
Nebenläufigkeit — dann wäre der nächste Schritt, `maxRequestsPerHost` probeweise
weiter zu erhöhen oder den Katalog auf einen eigenen, separat gedrosselten
Client umzustellen, statt die ganze App zu teilen.

Stand Webapp/Server unverändert von der vorigen Runde. Android-seitig
ungeprüft wie immer — kein SDK hier; Klammerbilanz in `AppModule.kt` stimmt.

---

## Android-Galerie: Bild erscheint erst beim Öffnen des Sets — jetzt mit Wiederholversuch

Dein Screenshot war der entscheidende Hinweis, den ich vorher nicht hatte: **fast
alle** Kacheln blieben leer (nur die erste zeigte ein Bild), und dein Zusatz —
das Bild erscheint, sobald man das Set öffnet — schliesst meine vorige
Vermutung aus. Wären die Bilder tatsächlich fehlend oder dauerhaft
unerreichbar, würde das Öffnen des Sets nichts ändern; es lädt exakt dieselbe
Adresse. Zeigt das Set-Detail sie trotzdem sofort, war die Adresse die ganze
Zeit gültig — nur der **erste** Ladeversuch in der Kachelwand ist gescheitert,
und Coil versucht eine fehlgeschlagene Anfrage nicht von sich aus erneut.

Das ist dieselbe Situation wie bei den `<img>`-Elementen der Webapp weiter oben
in dieser Sitzung: ein einzelner, transienter Fehlschlag (Zeitüberschreitung,
abgebrochene Verbindung) sollte nicht die Kachel dauerhaft leer lassen.

**Behoben in `GalleryScreen.kt`:** Ein Ladefehler löst jetzt **genau einen**
Wiederholversuch nach einer Sekunde aus:

```kotlin
var retryNonce by remember(set.setNumber, imageUrl) { mutableIntStateOf(0) }
…
onState = { st ->
    if (st is AsyncImagePainter.State.Error && retryNonce == 0) {
        retryScope.launch { delay(1000); retryNonce = 1 }
    }
}
```

`retryNonce` fliesst als `setParameter("retry", …)` in die Anfrage ein — ein
neues, für Coil unterscheidbares Objekt, das nicht mit dem fehlgeschlagenen
Vorgänger verwechselt wird, obwohl dieselbe Bildadresse angefragt wird.

**Zur vorigen Runde:** Die Warteschlangen-Verbreiterung
(`maxRequestsPerHost`) bleibt bestehen — sie senkt, wie viele Anfragen
überhaupt in eine solche Situation geraten. Der Wiederholversuch fängt jetzt
zusätzlich ab, was trotzdem einmal schiefgeht. Beides zusammen sollte
belastbarer sein als jede der beiden Massnahmen allein.

**Test.** Liest `GalleryScreen.kt` und prüft alle vier Bestandteile: der
Zähler ist an Set und Bildadresse gebunden, der Wiederholversuch ist auf genau
einmal begrenzt, die Anfrage trägt ein unterscheidbares Merkmal, und die
Verzögerung ist vorhanden. Alle vier Prüfungen laufen nachweislich gegen den
tatsächlichen Code durch (ausserhalb von Gradle nachgestellt, da hier kein
Android-Toolchain verfügbar ist).

**Was das nicht abdeckt:** Bricht der ZWEITE Versuch ebenfalls ab, bleibt die
Kachel leer — bewusst begrenzt auf einen Versuch, damit eine wirklich
unerreichbare Adresse nicht endlos neu angefragt wird. Bleibt eine bestimmte
Kachel auch nach dieser Änderung dauerhaft leer, während andere sich erholen,
wäre das ein Hinweis auf eine tatsächlich tote Bildadresse bei genau diesem
Set — dann bräuchte es die Diagnose, die für die Minifiguren schon existiert.

Stand: Webapp/Server unverändert. Android ungeprüft wie immer, Klammerbilanz
und Testlogik gegen den Quellcode verifiziert.

---

## Android-Galerie, dritter Anlauf: Bildanfragen sahen aus wie kein Browser

Dein „genau gleiches Verhalten" nach zwei Versuchen war die entscheidende
Information. Weder die breitere Warteschlange (Runde 1) noch der
Wiederholversuch (Runde 2) hatten irgendeine Wirkung — und das spricht **gegen**
einen transienten Fehler (Zeitüberschreitung, Überlastung) und **für** eine
**dauerhafte** Ablehnung, die bei jedem Versuch neu zuschlägt. Ein
Wiederholversuch kann eine solche Ablehnung naturgemäss nicht beheben, egal wie
oft man es versucht.

**Die wahrscheinlichste dauerhafte Ablehnung dieser Art:** OkHttps
Standard-`User-Agent` (`okhttp/4.x`) identifiziert die Anfrage eindeutig als
Nicht-Browser-Client. Vor Rebrickables CDN steht Cloudflare — das war schon
beim serverseitigen Bild-Proxy dieser Sitzung das Thema. Cloudflare kann
Anfragen ohne glaubwürdige Browser-Kennung dauerhaft blockieren oder mit einer
HTML-Challenge statt des Bildes beantworten, die Coil nicht als Bild entpacken
kann.

Das erklärt auch, warum ausgerechnet die **erste** Kachel funktionierte: Sie
zeigte vermutlich das einzige Set, dessen Bild bereits lokal auf deinem Server
liegt (`image_local`, heruntergeladen vom Hintergrundlauf) — dieser Weg geht nie
über die Rebrickable-CDN und war nie betroffen. Alle anderen, noch nicht lokal
vorliegenden Bilder, fragen die Android-App direkt vom Gerät bei Rebrickable
an — und genau die blieben leer.

**Behoben:** Ein Interceptor am Bild-Client sendet jetzt für Anfragen an
**fremde** Hosts (nicht den eigenen Server) dieselben Kopfzeilen, die sich beim
Server-Proxy bereits bewährt haben — Chrome-User-Agent, `Referer:
https://rebrickable.com/`, passender `Accept`-Header. Anfragen an den eigenen
Server bleiben unverändert.

```kotlin
val isOwnServer = host == "localhost" ||
    NetworkPolicy.isSameOrigin(req.url, prefs.serverUrlState.value ?: "")
if (isOwnServer) chain.proceed(req)
else chain.proceed(req.newBuilder().header("User-Agent", …).header("Referer", …).build())
```

Die Unterscheidung nutzt dieselbe `NetworkPolicy.isSameOrigin()`-Prüfung wie der
bestehende Token-Interceptor, damit die Browser-Kennung nicht versehentlich an
den eigenen Server geht (dort unnötig, aber harmlos gewesen wäre).

**Test.** Prüft, dass die Kopfzeilen gesetzt werden, dass die
Server/Fremd-Unterscheidung existiert, und dass die Drosselung aus der
vorigen Runde nicht verloren gegangen ist. Alle vier Teilprüfungen laufen
nachweislich gegen den tatsächlichen Code durch.

**Ehrlich zur Unsicherheit:** Auch das ist eine Hypothese, keine bestätigte
Diagnose — ich kann von hier aus nicht sehen, was Cloudflare deinem Gerät
tatsächlich antwortet. Sie ist aber die einzige der drei bisherigen Theorien,
die erklärt, warum die ersten beiden Massnahmen wirkungslos blieben. Bleibt das
Verhalten danach unverändert, brauche ich als Nächstes eine Möglichkeit, die
tatsächliche HTTP-Antwort zu sehen — am ehesten über die Logcat-Ausgabe beim
Öffnen der Galerie (`adb logcat` nach Fehlern von Coil oder OkHttp gefiltert),
oder testweise dieselbe Bildadresse direkt im Handy-Browser geöffnet: Lädt sie
dort, während sie in der App leer bleibt, bestätigt das die
Client-Erkennungs-These; bleibt sie auch im Browser leer, ist das Bild selbst
betroffen und wir sind wieder beim Reparaturmechanismus der Minifiguren.

Stand: Webapp/Server unverändert. Android ungeprüft wie immer.

---

## Selbst verursacht: „Failed to create image decoder with message 'unimplemented'"

Das ist mein eigener Fehler aus der letzten Änderung — und zum Glück eindeutig
zu erklären.

Der `Accept`-Header, den ich für die Cloudflare-Umgehung ergänzt hatte, enthielt
`image/avif`:

```
Accept: image/avif,image/webp,image/apng,image/*,*/*;q=0.8
```

Damit meldet der Client dem CDN: „Ich kann AVIF verarbeiten." Rebrickable /
Cloudflare antwortete daraufhin vermutlich mit einer **AVIF**-Datei statt des
gewohnten JPEG. Android übernimmt das Dekodieren nativer Bildformate über
`ImageDecoder` — und nicht jedes Gerät hat trotz ausreichender API-Stufe
tatsächlich einen AV1-Decoder verbaut. Genau das erzeugt „Failed to create
image decoder with message 'unimplemented'" statt eines angezeigten Bildes.
Die von mir zuvor selbst hinzugefügte Kopfzeile hat also ein neues Problem
erzeugt, während sie das ursprüngliche vermutlich löste.

**Behoben:** `image/avif` aus dem Accept-Header entfernt.

```
Accept: image/webp,image/apng,image/*,*/*;q=0.8
```

WebP bleibt drin — es wird auf jedem von dieser App unterstützten
Android-Gerät zuverlässig über Skia dekodiert, anders als AVIF.

**Test.** Verlangt jetzt explizit, dass `image/avif` **nicht** mehr im
Accept-Header steht, dass weiterhin ein Accept-Header mit WebP gesetzt ist, und
dass User-Agent, Referer sowie die Server/Fremd-Unterscheidung aus der letzten
Runde erhalten geblieben sind.

Bei dieser Testprüfung selbst ist mir dieselbe Falle wie mehrfach zuvor in
dieser Sitzung passiert: Mein Erklärkommentar nennt „image/avif" wörtlich, und
ein naives Herausschneiden aller Zeilen ab `//` hätte ausserdem `https://` in
den Kopfzeilen-Werten falsch abgeschnitten. Beides korrigiert — nur ganze
Kommentarzeilen werden ausgeblendet, keine Teilzeilen ab dem ersten `//`. Alle
sechs Teilprüfungen laufen jetzt nachweislich gegen den tatsächlichen Code
durch.

**Bitte nach dem Deploy sowohl bestätigen, dass der Absturz weg ist, als auch,
ob die Galerie-Bilder jetzt tatsächlich laden** — es ist möglich, dass die
Kopfzeilen-Änderung an sich richtig war und nur dieses eine Format zu weit
ging.

Stand: Webapp/Server unverändert. Android ungeprüft wie immer.

---

## Umgesetzt: alle Bilder über den Server, nicht direkt vom Gerät

Dein Grundsatz ist genau richtig — und er löst rückblickend die Ursache hinter
den letzten drei Runden auf: Warteschlangen-Enge, Wiederholversuch,
Browser-Kennung gegen Cloudflare, AVIF-Absturz. Jede dieser Massnahmen
behandelte ein **Symptom** des direkten Gerät-zu-CDN-Zugriffs, keine davon die
**Ursache**. Diese Runde behebt die Ursache: kein Bildschirm lädt mehr eine
rohe CDN-Adresse direkt vom Gerät.

### Der gemeinsame Helfer

`util/ImageUrls.kt`, neu — spiegelt exakt `thumbUrl()`/`imgUrl()` aus der
Webapp:

```
resolveThumbUrl(serverUrl, imageLocal, imageUrl)   // Kachel/Liste, 200px
resolveFullUrl(serverUrl, imageLocal, imageUrl)    // Detail/Zoom, Originalgrösse
```

Lokal abgelegtes Bild (`imageLocal`) hat Vorrang und geht direkt über
`express.static`; jede CDN-Adresse läuft über `/api/img-proxy` — mit `&thumb=1`
für Kacheln.

### Wo überall umgestellt

Galerie, Set-Detail (Vorschau **und** Zoom getrennt aufgelöst), Teile-Bildschirm
(zwei Stellen), Finanzen (Sets, Teile, Minifiguren), Minifiguren-Bildschirm
(zwei Stellen), Katalog-Übersicht, Katalog-Detail, Barcode-Scan-Ergebnis — neun
Bildschirme, zwölf Fundstellen.

**Dabei zwei weitere, bisher unentdeckte Bugs mitbehoben**, unabhängig vom
eigentlichen Umbau:

- Finanzen-Minifiguren-Zeile zeigte `fig.imageUrl` komplett unverarbeitet — kein
  `image_local`, kein Server-Präfix, nichts.
- Barcode-Scan-Ergebnisvorschau hatte dieselbe Lücke wie die übrigen
  Bildschirme vor dieser Runde.

### Eine bewusste Ausnahme — und ein Fehler, den ich dabei selbst gemacht und
wieder korrigiert habe

`PartsListScreen.kt` bekommt seine `part.imageUrl` bereits **vollständig
aufgelöst** von `PartsListFeature.kt` — die löst image_local/Server-Proxy schon
beim Laden auf, bevor ein `PlPart`-Objekt entsteht. Mein erster Versuch hat
`resolveThumbUrl()` versehentlich AUCH dort angewendet — das hätte eine bereits
proxy-gewickelte Adresse ein zweites Mal eingewickelt (`/api/img-proxy?url=<url-
codierter Proxy-Aufruf>`), ein defekter Doppel-Wrap. Beim Nachprüfen, ob dieses
Muster genau EINMAL pro Aufrufkette gilt, ist mir das aufgefallen, und ich habe
es zurückgenommen, bevor es ausgeliefert wurde.

Das war eine Lehre daraus, denselben Patch elf Mal an strukturell ähnlich
aussehenden Stellen anzuwenden, ohne bei jeder zu prüfen, ob die Daten dort
wirklich roh sind. Der Katalog behandelt seinerseits Bilder ausserhalb des
eigenen Bestands (kein `image_local` möglich) — dort greift ausschliesslich der
Proxy-Pfad, korrekt.

### Test

`NoDirectCdnAccessTest.kt`, neu, drei Prüfungen:

1. Jeder der acht betroffenen Bildschirme muss `resolveThumbUrl()` oder
   `resolveFullUrl()` tatsächlich aufrufen.
2. Der gemeinsame Helfer muss `image_local` bevorzugen und CDN-Adressen über
   `/api/img-proxy` schicken.
3. `PartsListScreen.kt` darf **keinen** der beiden Resolver aufrufen — sonst
   entstünde der Doppel-Wrap erneut.

Alle drei Prüfungen sind vor der Auslieferung ausserhalb von Gradle gegen den
tatsächlichen Code durchgerechnet worden (kein Android-SDK hier verfügbar).

### Folge für den Server

Der Server bekommt jetzt spürbar mehr Bildanfragen — auch für den Katalog mit
bis zu 60 Bildern pro Seite, den die Webapp selbst direkt im Browser lädt.
Das ist die bewusste Kehrseite deines Grundsatzes: ein einzelner,
kontrollierbarer Zugriffspunkt statt vieler Geräte, die einzeln mit
Rebrickable/Cloudflare verhandeln müssen — bezahlt mit mehr Last auf dem
eigenen Server. Die Proxy-Route ist aus den vorigen Runden bereits gehärtet
(Negativ-Cache, Referer-Rückfall, Entpacken, keine künstliche
Nebenläufigkeits-Grenze mehr), sollte das also tragen.

Stand: Webapp/Server unverändert. Android ungeprüft wie immer — kein SDK
verfügbar; Klammerbilanz in allen zehn geänderten/neuen Dateien geprüft, alle
Testprüfungen gegen den tatsächlichen Code nachgerechnet.

---

## Drei Punkte: Compile-Fehler, PartsListScreen-Frage, Preisverlauf-Graph

### 1. Compile-Fehler `Unresolved reference 'serverUrl'`

Mein eigener Fehler aus der letzten Runde: Ich habe `resolveFullUrl(serverUrl, …)`
in `CatalogDetailScreen.kt` eingebaut, ohne zu prüfen, ob die Funktion
`serverUrl` überhaupt als Parameter kennt — tat sie nicht. Behoben:

- `serverUrl: String` zur Signatur von `CatalogDetailScreen()` ergänzt
- den einzigen Aufrufer (`nav/CatalogGraph.kt`) mit `serverUrl =
  state.serverUrl` versorgt

Ich habe diesmal **alle zwölf** heute geänderten Android-Dateien auf
Klammer-/Parenthesen-Gleichgewicht geprüft, nicht nur die zuletzt bearbeitete
— derselbe Fehler sollte nicht an einer übersehenen Stelle nochmal auftreten.

### 2. Bezieht `PartsListScreen.kt` seine Bilder korrekt?

Ja. Es läuft über einen anderen, aber ebenfalls korrekten Weg:
`ui/PartsListFeature.kt` löst `part.imageUrl` bereits **vollständig** auf
(`image_local` bevorzugt, sonst `/api/img-proxy?url=…`), bevor das
`PlPart`-Objekt entsteht. `PartsListScreen.kt` bekommt damit nie eine rohe
CDN-Adresse zu Gesicht — es muss nichts mehr auflösen. Genau deshalb hatte ich
letzte Runde meinen ersten Versuch, dort zusätzlich `resolveThumbUrl()`
einzubauen, wieder zurückgenommen: Das hätte die bereits aufgelöste Adresse ein
zweites Mal in den Proxy gewickelt.

### 3. Preisverlauf-Graph — der eigentliche Fund dieser Runde

**Die 110.48-vs-162.42-Abweichung ist eine Deployment-Frage, kein neuer Fehler.**
Ich habe die Server-Logik erneut exakt gegen deinen Fall durchgerechnet:

```
resolveSetCondition() → N
fetchPrice() mit diesem Zustand → 162.4163
DEFAULT_PRICE_CONDITION ist U → falscher Weg liefert 110.481
```

Der zweite Wert trifft exakt deine Beobachtung — das ist der **alte**,
inzwischen ersetzte Pfad. Die Android-App ruft ausschliesslich
`/api/v1/sets/{setNumber}/price` auf, und diese Route benutzt seit mehreren
Runden bereits `resolveSetCondition()`. Wenn du weiterhin 110.48 siehst, läuft
der Server-Teil des Pakets noch auf einem älteren Stand — bitte einmal
gegenprüfen, ob der zuletzt gepackte `brickinventory-manager`-Ordner tatsächlich
neu aufgespielt wurde.

**Der Preisverlauf-Graph dagegen war ein echter, bisher unentdeckter Fehler —
und erklärt, warum er trotz korrekter Zustandsauflösung falsch blieb:**

```js
// public/js/07-admin.js, sparklineSVG()
const vals = data.map(d=>d.qty_avg_price||d.total||0);
```

Die Sparkline zeichnete `qty_avg_price`, nicht `avg_price` — eine **andere**
Preisspalte desselben, längst korrekt aufgelösten Zustands.
`qty_avg_price` kann für einen Tag fehlen oder 0 sein, während `avg_price`
vorhanden ist. Nachgestellt:

```
vorher (qty_avg_price zuerst): [162.4163, 0]        ← Absturz auf 0
jetzt  (avg_price zuerst)    : [162.4163, 162.4163]  ← korrekt konstant
```

Das erklärt den dramatischen, aber falschen Abfall, den du über mehrere Runden
gemeldet hast — er hatte nichts mit der Zustandsauflösung zu tun, die ich immer
wieder repariert hatte, sondern mit einer Preisspalte, die die Grafik nie hätte
verwenden sollen.

**Android hatte genau diese Stelle (`SetDetailComponents.kt`) längst richtig**
— `avgPrice ?: qtyAvgPrice` stand dort schon aus einer früheren Runde. Nur die
Webapp hatte den entsprechenden Fix nie bekommen. Jetzt:

```js
const vals = data.map(d=>d.avg_price||d.qty_avg_price||d.total||0);
```

**Test.** `test/set-condition-aggregate.test.js` verlangt jetzt genau diese
Reihenfolge und verbietet die alte. `CatalogUsesLocalImagesTest.kt` prüft
zusätzlich, dass `serverUrl` sowohl in der Signatur als auch am Aufrufer
vorhanden ist — Regressionsschutz gegen genau den Compile-Fehler von oben.

Stand: `tsc --noEmit` sauber, 55 Tests grün, Paritätssuite 32/32. Android
ungeprüft wie immer, aber alle Testprüfungen und Klammerbilanzen gegen den
tatsächlichen Code nachgerechnet.

---

## Nochmal derselbe Fehler — diesmal an der Kachel, nicht am Bildschirm

`CatalogSetCard()` (die einzelne Kachel im Katalog-Raster) kannte `serverUrl`
ebenso wenig wie `CatalogDetailScreen()` letzte Runde. Behoben:

- `serverUrl: String` zur Signatur von `CatalogSetCard()` ergänzt
- den einzigen Aufruf in `CatalogScreen.kt` mit `serverUrl` versorgt

### Diesmal systematisch statt punktuell geprüft

Nachdem derselbe Fehler zweimal hintereinander aufgetreten ist, habe ich eine
generische Prüfung geschrieben, die **jede** Funktion in den acht betroffenen
Bildschirmen findet, die `resolveThumbUrl()`/`resolveFullUrl()` mit `serverUrl`
aufruft, und verlangt, dass **dieselbe** Funktion `serverUrl` auch selbst als
Parameter führt — nicht nur irgendeine umgebende Datei.

**Beim Schreiben dieser Prüfung ist mir prompt derselbe Fehler unterlaufen, den
ich beheben wollte:** Meine erste Fassung hielt lokale, eingerückte
Hilfsfunktionen (`fmtDate` in `SetDetailScreen.kt`, `fmtPrice` in
`FinanceScreen.kt` — beide innerhalb eines Composable-Körpers definiert, keine
eigenen Bildschirme) fälschlich für den umschliessenden Aufrufer und meldete
sie als Fehler, obwohl beide Bildschirme korrekt sind. Korrigiert, indem nur
Funktionsdefinitionen auf Spalte 0 als eigener Gültigkeitsbereich zählen —
lokale, eingerückte `fun`-Deklarationen nicht.

Und beim Zählen der Klammerbilanz meines eigenen Tests bin ich auf eine
Klammer in einem Erklärkommentar gestossen (`"fun NAME(...) {"` als
Beispieltext), die meine grobe Zählmethode verwirrte, obwohl der Kotlin-Code
korrekt war — entfernt, damit die Prüfung beim nächsten Mal ohne Umweg
vertrauenswürdig ist.

Gegenprobe gemacht: mit künstlich entferntem `serverUrl`-Parameter an
`CatalogSetCard` schlägt die Prüfung an; im aktuellen Stand nicht.

Stand: Android ungeprüft wie immer, aber jede der acht betroffenen Dateien
einzeln gegen die neue, korrigierte Prüflogik nachgerechnet — alle bestehen.

---

## Gefunden: warum die Galerie trotz Server-Bezug weiterhin leere Kacheln zeigt

Deine Frage nach einem Caching-Problem war der richtige Anstoss — sie hat mich
zur Webapp-Logik zurückgeführt, statt eine vierte Theorie über Cloudflare oder
Nebenläufigkeit zu bauen.

**Die tatsächliche Ursache:** Nach einem CSV-Import legt der Server
Original-Bilder sofort ab (`image_local` wird gesetzt), erzeugt die
zugehörigen `_thumb.jpg`-Vorschaudateien aber **nachträglich**, in einer
eigenen, strikt sequenziellen Warteschlange (`server.ts`, „Generate missing
thumbnails" — ein Bild nach dem anderen, mit kleinen Pausen). Bei 371 frisch
importierten Sets kann diese Warteschlange eine Weile brauchen, um
durchzulaufen.

Fragt eine Kachel in dieser Zeit die Vorschau an, antwortet der Server mit
**404** — die Datei existiert schlicht noch nicht. Mein vorheriger
Wiederholversuch (letzte Runde) fragte danach dieselbe, weiterhin fehlende
Datei ein zweites Mal an — dieselbe 404, keine Besserung. Das erklärt, warum
weder die Warteschlangen-Verbreiterung noch der Wiederholversuch noch die
Browser-Kennung geholfen haben: Keines davon adressierte eine tatsächlich
**fehlende Datei**.

**Die Webapp hat dieses Problem nie gehabt**, weil sie einen zweistufigen
Rückfall besitzt (`public/js/11-actions.js`): Schlägt ein Bild zweimal fehl,
wechselt sie auf `data-orig` — die **volle Auflösung**, die immer existiert,
sobald `image_local` gesetzt ist. Genau das hat Android gefehlt.

### Behoben

Neuer, wiederverwendbarer Helfer `rememberTileImageWithFallback()` in
`util/ImageUrls.kt`: Bei einem Ladefehler wechselt die angefragte Adresse
sofort von der Vorschau auf die volle Auflösung — kein sinnloser
Wiederholversuch derselben fehlenden Datei mehr.

```kotlin
val (imageUrl, onImageError) = rememberTileImageWithFallback(serverUrl, set.imageLocal, set.imageUrl)
…
onState = { st -> if (st is AsyncImagePainter.State.Error) onImageError() }
```

In `GalleryScreen.kt` eingebaut, der bisherige (wirkungslose)
Wiederholversuch vollständig entfernt.

Nachgestellt: Vorschau fehlgeschlagen → Adresse wechselt von
`…_thumb.jpg` auf `….jpg` (Originalgrösse), exakt das Verhalten der Webapp.

**Test.** Zwei Prüfungen: Der Helfer wechselt tatsächlich auf `resolveFullUrl()`
im Fehlerfall, und `GalleryScreen.kt` benutzt ihn — der alte Mechanismus darf
nicht mehr vorkommen. Beide gegen den tatsächlichen Code nachgerechnet.

**Was ich bewusst NICHT angefasst habe:** Die serverseitige
Thumbnail-Warteschlange bleibt sequenziell. Mit dem Rückfall braucht es das
auch nicht mehr zwingend — die App zeigt jetzt einfach übergangsweise die volle
Auflösung, bis der Thumb nachgezogen ist, und heilt sich von selbst. Sollte dir
das zu langsam sein (grosse Bilder auf einer Kachelwand bis die Thumbs
nachkommen), wäre eine Parallelisierung der Warteschlange der nächste, separate
Schritt.

**Nicht auf andere Bildschirme übertragen:** Parts-, Minifig-, Finanz- und
Katalog-Kacheln nutzen weiterhin nur `resolveThumbUrl()` ohne Rückfall — sie
haben denselben, noch offenen Fehler. Ich habe mich auf die konkret gemeldete
Galerie beschränkt; sag Bescheid, wenn ich den Rückfall auf die übrigen
Bildschirme ausweiten soll.

Stand: Webapp/Server unverändert. Android ungeprüft wie immer, aber Logik
ausserhalb von Gradle nachgestellt und alle Testprüfungen gegen den
tatsächlichen Code verifiziert.

---

## Die tatsächliche Ursache: der Client hat die Antwort des Servers ignoriert

Deine Rückfrage war entscheidend — „auch nach vollständigem Neustart" passt
nicht zu „Zeit muss verstreichen, bis die Warteschlange nachzieht". Das hat
mich zurück zum Server geführt, und dort lag die eigentliche Wurzel.

**Der Server trifft die Thumb-Entscheidung längst selbst.**
`utils/images.ts`, `resolveImageLocal()`, existiert schon lange:

```js
// Liefert den _thumb.jpg-Pfad, falls das Thumbnail existiert — sonst das Original.
return exists ? thumbPath : localPath;
```

Mit eigenem Existenz-Cache (10 Minuten für „existiert nicht"). Das ist bereits
korrekt und wird für **jede** `image_local`-Antwort angewendet, auch für die,
die an Android geht.

**Der Fehler:** Androids `resolveThumbUrl()` hat diese bereits richtige
Antwort ignoriert und **selbst nochmal geraten**. Lieferte der Server den
Original-Pfad (weil die Vorschau fehlte), baute die App daraus ihren **eigenen**
`_thumb.jpg`-Pfad — denselben, von dem der Server soeben festgestellt hatte,
dass es ihn nicht gibt:

```
Server prüft:     /images/sets/10283-1_thumb.jpg  → existiert nicht
Server liefert:   /images/sets/10283-1.jpg          (Original, korrekt!)
App ignoriert das und rät:
                  /images/sets/10283-1_thumb.jpg  → 404, garantiert
```

Das erklärt „auch nach vollständigem Neustart": Es ging nie um verstrichene
Zeit oder einen kalten Start. Der Server hatte die richtige Antwort die ganze
Zeit parat — der Client hat sie weggeworfen und erneut die falsche Adresse
zusammengebaut. Kein Zeitablauf der Welt behebt das.

**Behoben:** `imageLocal` wird jetzt unverändert übernommen — kein
Rateversuch mehr. Die tote `toThumbPath()`-Funktion vollständig entfernt,
nicht nur ungenutzt gelassen.

```kotlin
imageLocal != null -> "$base$imageLocal"   // unverändert, wie vom Server entschieden
```

Nachgestellt:

```
Server liefert Thumb    : …_thumb.jpg  → App übernimmt …_thumb.jpg
Server liefert Original : ….jpg        → App übernimmt ….jpg (nicht mehr geraten)
```

**Test.** Prüft, dass `imageLocal` unverändert weitergereicht wird, dass
`toThumbPath()` an keiner Stelle mehr aufgerufen wird, und dass die Funktion
selbst nicht mehr existiert.

**Beim Schreiben des Tests** ist mir zweimal derselbe blinde Fleck begegnet —
ein Erklärkommentar, der den Funktionsnamen selbst nannte, und ein
Such-String, der eine unpaarige Klammer als Text enthielt. Beides hätte meine
eigene Klammerprüfung verfälscht; beide korrigiert.

**Der Rückfall-Mechanismus aus der letzten Runde bleibt bestehen**, ist für
lokale Bilder jetzt aber meist wirkungslos (beide Pfade liefern nach diesem
Fix dieselbe, bereits korrekte Adresse) — er bleibt für CDN-Bilder über den
Proxy relevant, wo Vorschau und volle Auflösung weiterhin unterschiedliche
Anfragen sind.

Stand: Server unverändert (die Logik war dort schon korrekt). Android
ungeprüft wie immer, Logik ausserhalb von Gradle nachgestellt.

---

## Teile, Minifiguren, Katalog auf dasselbe Muster umgestellt

Auf Wunsch alle drei angeglichen: Sie nutzten `resolveThumbUrl()` bereits
korrekt (kein Rateversuch mehr, seit dem letzten Fix), aber noch ohne den
Rückfall-Mechanismus, den die Galerie inzwischen hat. Jetzt einheitlich:

| Datei | Kacheln | Vorher | Jetzt |
|---|---|---|---|
| `PartsScreen.kt` | `ManualPartTile`, `PartCard` | `resolveThumbUrl()` | `rememberTileImageWithFallback()` |
| `MinifigsScreen.kt` | `ManualFigTile`, `MinifigCard` | `resolveThumbUrl()` | `rememberTileImageWithFallback()` |
| `CatalogScreen.kt` | `CatalogSetCard` | `resolveThumbUrl()` | `rememberTileImageWithFallback()` |

Fünf Kachel-Funktionen, alle nach demselben Schema: Schlägt das Laden fehl,
wechselt die Adresse von der Vorschau auf die volle Auflösung — kein
sinnloser zweiter Versuch derselben Datei mehr.

`CatalogDetailScreen.kt` bleibt unverändert: Sie fordert bereits die volle
Auflösung direkt an (kein Vorschaubild, kein Zoom-Wechsel), ein
Rückfall-Mechanismus hätte dort nichts, worauf er zurückfallen könnte.

### Ein Nebeneffekt, der mir beim Umbau aufgefallen ist

Der generische Regressionstest aus einer früheren Runde sucht nach direkten
`resolveThumbUrl(serverUrl`/`resolveFullUrl(serverUrl`-Aufrufen, um zu prüfen,
ob die umschliessende Funktion `serverUrl` selbst kennt. Da diese drei Dateien
jetzt `rememberTileImageWithFallback(serverUrl` aufrufen statt der
Einzel-Funktionen, wäre der Test für sie stillschweigend wirkungslos geworden
— er hätte einfach nichts mehr zu prüfen gehabt, ohne das zu melden. Das
Suchmuster ist entsprechend erweitert; alle dreizehn betroffenen
Funktionsdefinitionen sind erneut einzeln gegen den tatsächlichen Code
nachgerechnet, nicht nur die drei neuen.

**Test.** Neue Prüfung verlangt die erwartete Anzahl Verwendungen von
`rememberTileImageWithFallback()` je Datei (2, 2, 1) und dass kein direkter
`resolveThumbUrl()`-Aufruf mehr übrig ist.

### Zur Webapp-Frage

Nein — die Webapp verlässt sich nicht auf die bereits korrekte
Server-Antwort. `thumbUrl()` in `public/js/01-core.js` rät clientseitig
genau wie Androids alte Fassung; sie funktioniert nur wegen des
zweistufigen Rückfalls auf `data-orig`. Die Android-Lösung ist damit
strenger als die Webapp, nicht bloss ein Nachbau davon.

Stand: Server unverändert. Android ungeprüft wie immer; alle fünf
geänderten Dateien auf Klammerbilanz geprüft, alle Testerwartungen einzeln
gegen den tatsächlichen Code nachgerechnet.

---

## Webapp jetzt auf denselben Stand wie Android — `thumbUrl()` rät nicht mehr

Auf deinen Vorschlag hin dieselbe Bereinigung, die Android schon hat, jetzt
auch in der Webapp: `thumbUrl()` in `public/js/01-core.js` konstruierte aus
**jedem** lokalen Pfad seine eigene `_thumb.jpg`-Adresse — unabhängig davon,
ob der Server diese Vorschau bereits als existent bestätigt hatte oder nicht.

```js
// vorher
function thumbUrl(src) {
  ...
  return src.replace(new RegExp('\.'+ext+'$'), '_thumb.jpg');   // ← Rateversuch
}

// jetzt
function thumbUrl(src) {
  return src;   // unverändert — image_local ist bereits die richtige Adresse
}
```

`utils/images.ts` (`resolveImageLocal()`) prüft die Existenz serverseitig
längst und liefert je nachdem den Thumb- oder den Original-Pfad — genau wie
in der Android-Erklärung von eben. Der zweistufige Rückfall in
`public/js/11-actions.js` (Wiederholversuch, dann `data-orig`) hat diesen
Fehler bisher nur **maskiert**, nicht behoben — er sprang bei jedem falschen
Ratevorgang ein und liess die Ursache unbemerkt.

**Bewusst unverändert gelassen:**

- `imgUrl()` — wickelt CDN-Adressen weiterhin in `/api/img-proxy`, das ist
  weiterhin richtig client-seitig gesteuert (der Proxy-Cache hat keine
  serverseitige Vorab-Entscheidung wie `image_local`).
- `fullUrl()` — entfernt weiterhin ein vorhandenes `_thumb`-Suffix für Zoom
  und Detailansicht; das bleibt nötig, falls `image_local` selbst auf die
  Thumb-Datei zeigt.
- Der zweistufige Rückfall in `11-actions.js` bleibt bestehen — er fängt
  jetzt echte, transiente Netzwerkfehler ab, nicht mehr einen strukturellen
  Ratefehler.

Nachgestellt, alle vier Fälle:

```
Server lieferte Thumb    → unverändert übernommen
Server lieferte Original → unverändert übernommen (vorher: geraten, 404)
CDN-Adresse              → weiterhin korrekt über den Proxy
Zoom auf Server-Thumb    → weiterhin korrekt auf Originalgrösse zurückgerechnet
```

**Test.** `thumbUrl()` muss eine reine Durchreiche sein, keine
`_thumb.jpg`-Konstruktion mehr im Code.

Damit laden Webapp und Android-App Bilder jetzt nach demselben Prinzip:
Der Server entscheidet, welche Datei ausgeliefert wird — kein Client rät mehr
selbst.

Stand: `tsc --noEmit` sauber, 70 Tests grün.

---

## Compile-Fehler: `onState` und `error` schliessen sich in Coil gegenseitig aus

Mein eigener Fehler beim Umbau von `CatalogScreen.kt` auf den
Rückfall-Mechanismus: Coils `AsyncImage` hat zwei **getrennte**
Überladungsfamilien — eine mit `error`/`placeholder`/`fallback`/`onError` (für
einen Platzhalter-Painter), eine mit `transform`/`onState` (für den vollen
Zustand). Mit `imageLoader` **und** `error` gesetzt blieb nur die
Painter-Familie übrig — die kennt kein `onState`.

`CatalogSetCard` war die einzige der fünf umgestellten Kacheln mit einem
Logo-Platzhalter (`error = painterResource(...)`); die anderen vier
(`GalleryScreen`, `PartsScreen` ×2, `MinifigsScreen` ×2) setzen kein `error`
und durften deshalb bei `onState` bleiben — nur dort war es falsch.

**Behoben:** `onError = { onThumbError() }` statt `onState { if (… is Error) … }`
— derselbe Zweck, aber der zur Painter-Familie passende Parametername.

**Test.** Verlangt, dass `CatalogSetCard` `error` und `onError` zusammen
benutzt, kein `onState` mehr enthält, während die anderen vier Kacheln
weiterhin `onState` verwenden.

Beim Schreiben dieses Tests ist mir wieder ein unpaariges Klammerzeichen in
einem Such-String begegnet (`"onState = { st ->"` — genau der abgesuchte
Textausschnitt braucht diese offene Klammer, unvermeidbar). Anstatt den
String zu verbiegen, habe ich meine eigene Klammerprüfung robuster gemacht:
Sie entfernt jetzt Zeichenketten und Kommentare, bevor sie zählt, und bestätigt
für alle fünf heute geänderten Dateien ein sauberes Ergebnis.

Stand: Android ungeprüft wie immer, aber jetzt mit einer klammerbewussten statt
naiven Prüfung nachverfolgt.

---

## Fix: `duplicate key value violates unique constraint "parts_summary_pkey"`

**Ursache: Cluster-Modus.** Der Server läuft in Produktion mit mehreren
Worker-Prozessen (`server.ts`, `cluster.fork()`). Der bestehende Schutz gegen
doppelte Neuaufbauten — eine `_rebuilding`-Map — lebt **im Speicher eines
einzelnen Node-Prozesses** und weiss nichts von den anderen Workern.

Fragen zwei Worker fast gleichzeitig für **denselben Nutzer** an (z. B.
Webapp und Android-App kurz nacheinander, oder mehrere offene Tabs), können
beide unabhängig voneinander einen Neuaufbau starten:

```
Worker A: DELETE FROM parts_summary WHERE user_id=X   (nimmt Zeilensperren)
Worker B: DELETE FROM parts_summary WHERE user_id=X   (blockiert auf A)
Worker A: INSERT … (neue Zeilen) … COMMIT
Worker B: (entblockt) — sieht As neue Zeilen NICHT als Teil seines
          ursprünglichen Scans (sie kamen NACH dessen Beginn hinzu),
          löscht sie also nicht mit
Worker B: INSERT … dieselben Zeilen erneut … → doppelter Primärschlüssel
```

Das ist Standard-Verhalten unter PostgreSQLs READ-COMMITTED-Isolation, kein
Fehler in der Abfrage selbst — die `GROUP BY`-Logik kann für sich genommen
keine Duplikate erzeugen, das Problem entsteht ausschliesslich durch die
zwei nicht koordinierten, gleichzeitigen Transaktionen.

**Behoben:** Eine Datenbank-Sperre statt einer Speicher-Sperre —
`pg_try_advisory_xact_lock(77, userId)`, transaktionsgebunden, automatisch
freigegeben bei COMMIT/ROLLBACK, prozessübergreifend wirksam (dasselbe
Muster wie bereits in `jobs/partsCatalogEnrich.ts`, `server.ts`,
`routes/brickset.ts` — Namensraum 77, um mit deren 42 / 99999999 / 11223344
nicht zu kollidieren). Bekommt ein Worker die Sperre nicht (ein anderer baut
gerade für denselben Nutzer), bricht er sauber ab — kein Fehler, kein
Retry nötig, das Ergebnis des anderen Workers gilt gleich mit.

Nachgestellt: zwei parallele `rebuild()`-Aufrufe für denselben Nutzer,
genau das Szenario zweier Cluster-Worker:

```
Aufruf 1 : fulfilled
Aufruf 2 : fulfilled
Zeilen in parts_summary: 50   (korrekt, kein Fehler)
```

**Test.** Verlangt, dass die Sperre prozessübergreifend ist (nicht die
In-Memory-Map), dass ohne sie abgebrochen wird, und dass sie **vor** dem
DELETE erworben wird — sonst wäre sie wirkungslos.

Stand: `tsc --noEmit` sauber, 43 Tests grün, Paritätssuite 32/32.

---

## Dein Logcat zeigt einen blinden Fleck — nicht das eigentliche Problem

Danke für das Log. Es zeigt jede API-Anfrage (`/api/v1/sets`, `/stats`,
`/settings`) sauber protokolliert — aber **keine einzige Bildanfrage**. Das
liesse sich als „es werden gar keine Bilder angefragt" lesen, wäre aber die
falsche Schlussfolgerung.

**Der Grund:** Der HTTP-Logging-Interceptor hing nur am API-Client:

```kotlin
if (isApiClient && BuildConfig.DEBUG) {
    addInterceptor(HttpLoggingInterceptor()...)
}
```

Der Bild-Client (`isApiClient = false`, von Coil für Galerie, Teile,
Minifiguren, Katalog benutzt) hatte **nie** einen Logging-Interceptor — mit
oder ohne meine Fixes der letzten Runden. Das Fehlen von Bildanfragen im Log
ist also keine Erkenntnis über das eigentliche Problem, sondern eine Lücke in
der Beobachtbarkeit selbst. Ohne diese Lücke zu schliessen, hätte auch ein
zehntes Logcat nichts über Bilder verraten.

**Behoben:** Beide Clients protokollieren jetzt im Debug-Build gleichermassen.
`isApiClient` bleibt für seinen ursprünglichen Zweck erhalten (die
`localhost:3000`-Umschreibung auf die echte Server-Adresse) — nur die
Protokollierung war unnötig daran gekoppelt.

**Das behebt das Bildproblem nicht** — es macht es nur sichtbar. Magst du
dasselbe Logcat noch einmal aufnehmen (App schliessen, neu öffnen, Galerie
öffnen), sollte darin jetzt auch stehen, was mit den Bildanfragen tatsächlich
passiert: ob sie überhaupt gestellt werden, an welche Adresse, und mit
welchem Ergebnis. Das ist die Information, die ich für den nächsten Schritt
brauche, statt weiter zu raten.

**Test.** Verlangt, dass beide Clients im Debug-Build protokollieren und dass
`isApiClient` für die URL-Umschreibung erhalten bleibt.

Stand: Android ungeprüft wie immer, alle drei Testprüfungen gegen den
tatsächlichen Code nachgerechnet.

---

## Der Befund: kein Android-Problem, sondern der Server erreicht Rebrickable nicht

Das Server-Log war der entscheidende Durchbruch — und zeigt etwas völlig
anderes als alles, was ich in den letzten Runden untersucht habe:

```
[img-proxy] Zeitüberschreitung nach 25 s: https://cdn.rebrickable.com/media/sets/115514-1.jpg
[img-proxy] Zeitüberschreitung nach 25 s: https://cdn.rebrickable.com/media/sets/122509-1.jpg
[img-proxy] Zeitüberschreitung nach 25 s: https://cdn.rebrickable.com/media/sets/200632602-1.jpg
```

**Mehrere völlig unterschiedliche Sets, alle exakt bis zur eingestellten
Zeitgrenze — ohne je eine Antwort, keine Fehlermeldung, kein TCP-Reset,
einfach nichts.** Das ist nicht Android. Der Server selbst kommt bei
**seinen eigenen** Anfragen an Rebrickables CDN nicht durch.

### Die wahrscheinlichste Ursache: IPv6

Dieses Muster — mehrere unabhängige Ziele, alle bis zur vollen Zeitgrenze
hängend, ohne Fehler — ist das klassische Bild einer kaputten oder nicht
gerouteten IPv6-Verbindung des Hosters:

1. Node löst `cdn.rebrickable.com` auf und bekommt sowohl eine IPv4- als
   auch eine IPv6-Adresse von Cloudflares Edge.
2. Ohne explizite Vorgabe versucht Node zuerst IPv6.
3. Ist die IPv6-Route des Hosters kaputt oder gar nicht vorhanden, hängt der
   Verbindungsaufbau **lautlos** — kein Fehler, keine Ablehnung, einfach
   keine Antwort.
4. Ohne funktionierendes Happy-Eyeballs-Verhalten (RFC 8305, paralleler
   IPv4/IPv6-Versuch mit dem saubereren Ergebnis) wartet Node bis der
   **eigene** Timeout zuschlägt — hier 25 Sekunden.

**Behoben:** `family: 4` an beiden Stellen, die Bilder von Rebrickable holen
— dem interaktiven Bild-Proxy (`server.ts`, `_cdnAgent`) und dem
Hintergrund-Download beim Import (`routes/sets.ts`,
`downloadSetImage()`). Rebrickable/Cloudflare unterstützen IPv4
zuverlässig; das Erzwingen kostet nichts, falls IPv6 ohnehin funktioniert,
und behebt das Hängen, falls nicht.

**Test.** Verlangt `family: 4` an beiden Fundstellen.

### Ehrlich zur Unsicherheit

Ich kann von hier aus nicht prüfen, ob der Server tatsächlich eine kaputte
IPv6-Route hat — das ist eine begründete, aber nicht bestätigte Diagnose.
Falls du selbst Zugriff auf den Server-Rechner hast, bestätigt dieser Befehl
es unabhängig von jeder Code-Änderung:

```
curl -v --max-time 10 -o /dev/null https://cdn.rebrickable.com/media/sets/115514-1.jpg
```

Hängt das schon hier, ist es zu 100 % eine Netzwerk-/Hosting-Frage, keine
Anwendungslogik. Läuft es hier sofort durch, war meine Diagnose falsch, und
ich brauche als Nächstes die Ausgabe genau dieses Befehls.

**Nicht angefasst:** Weitere Stellen im Code, die ebenfalls roh gegen
Rebrickable/BrickLink sprechen (CSV-Sync, Preisabfragen, Teile-Anreicherung
— rund ein Dutzend Fundstellen). Wenn sich der IPv6-Verdacht bestätigt,
wären die vom selben Fehler betroffen; ich habe mich bewusst auf die zwei
Stellen beschränkt, die das Log direkt belegt.

Stand: `tsc --noEmit` sauber, 50 Tests grün, Paritätssuite 32/32.

---

## Bestätigt und ausgeweitet: IPv4 an allen 18 Fundstellen erzwungen

Dein `curl` hat es zweifelsfrei bewiesen:

```
* IPv6: 2400:52e0:1e09::889:1
* Immediate connect fail for 2400:52e0:1e09::889:1: Network is unreachable
*   Trying 89.187.165.194:443...
< HTTP/2 200
```

Der Server hat **keine IPv6-Route** — nicht unzuverlässig, gar keine. `curl`
scheitert an IPv6 sofort und wechselt automatisch zu IPv4; ohne `family: 4`
tut Node das nicht zuverlässig selbst.

Damit war klar: Das betrifft **jede** ausgehende HTTPS-Verbindung dieses
Servers, nicht nur Bilder. Ich habe alle Fundstellen durchsucht und `family:
4` überall ergänzt, wo roh gegen einen externen Host gesprochen wird:

| Datei | Ziel | Stellen |
|---|---|---|
| `server.ts` | Rebrickable-CDN (Bild-Proxy) | 1 |
| `routes/sets.ts` | Rebrickable-CDN (Set-Bild-Download) | 1 |
| `jobs/partsCatalogEnrich.ts` | Rebrickable API + CDN | 3 |
| `jobs/backfillBlPartNumbers.ts` | Rebrickable API | 1 |
| `jobs/rebrickableCsvSync.ts` | Rebrickable CSV + API | 4 |
| `routes/brickset.ts` | Brickset API | 1 |
| `routes/parts.ts` | Rebrickable API | 2 |
| `routes/bricklink.ts` | BrickLink API | 1 |
| `routes/api_v1/admin.ts` | Diagnose-Sonde (img-probe) | 2 |
| `routes/api_v1/sets.ts` | Rebrickable + UPCitemdb (Barcode) | 2 |

18 Fundstellen insgesamt. Auch die Diagnose-Sonde selbst ist jetzt korrigiert
— sie hätte sonst weiterhin ein irreführendes Bild geliefert, da sie nicht
denselben Netzwerkpfad genommen hätte wie der echte Proxy.

**Test.** Zählt `family: 4` je Datei und verlangt die exakte erwartete Anzahl
— eine fehlende Stelle fiele damit sofort auf. Beim Schreiben ist mir dabei
noch einmal derselbe wiederkehrende Fehler passiert: Mein eigener
Erklärkommentar in `rebrickableCsvSync.ts` nennt „family: 4" als Text und
zählte in meiner ersten Fassung des Tests mit — korrigiert, die erwartete
Zahl schliesst diese eine Kommentarstelle jetzt bewusst ein.

Stand: `tsc --noEmit` sauber, 54 Tests grün, Paritätssuite 32/32.

Damit sollte nicht nur der Bild-Proxy zuverlässig laufen, sondern auch der
Rebrickable-CSV-Sync, die Teile-Anreicherung, die BrickLink-Preisabfragen und
die Barcode-Erkennung — alle nutzten bisher denselben kaputten Netzwerkpfad,
nur seltener bemerkt, weil sie nicht bei jedem Seitenaufruf sichtbar
scheitern.

---

## Einheitliches Bild-Verhalten: Vorschau über den Server, volle Auflösung direkt vom CDN — überall

Auf deinen Vorschlag hin vereinheitlicht — für Sets, Teile, Minifiguren und
Katalog, in Webapp **und** Android:

**Kacheln/Listen:** immer über den Server-Proxy mit Vorschaubild
(`imgUrl(thumbUrl(...), true)` in der Webapp, `resolveThumbUrl()` in
Android). Kleinere Antworten, profitiert vom serverseitigen
Existenz-Check auf `image_local`.

**Detail/Zoom:** volle Auflösung **direkt vom CDN**, ohne den Server-Proxy.
Das war für Sets in der Webapp schon immer so (`fullUrl()` ohne
`imgUrl()`-Umwicklung) — dein direkt geöffneter Link (< 1 Sekunde) zeigt
genau, warum: ein einmaliger Abruf ist über das eigene Netzwerk schneller
und belastet den Server gar nicht erst.

### Was fehlte

**Der Katalog der Webapp** lud bisher gar nicht über den Server — weder
Kachel noch Detail, beides roh im Browser. Jetzt: Kachel über den Proxy
(Vorschau), Detail direkt vom CDN — deckungsgleich mit Sets.

**Android liess auch die volle Auflösung über den Proxy laufen** — für Sets
UND Katalog. `resolveFullUrl()` gibt bei einer CDN-Adresse jetzt die rohe
URL unverändert zurück, das Gerät lädt direkt; die Browser-Kennung aus einer
früheren Runde (User-Agent, Referer) macht das zuverlässig.

Nachgestellt, beide Umgebungen, beide Fälle:

```
Webapp — Kachel, nur CDN : /api/img-proxy?url=…&thumb=1
Webapp — Detail, nur CDN : https://cdn.rebrickable.com/…        (direkt)
Android — Vorschau, CDN  : …/api/img-proxy?url=…&thumb=1
Android — Volle Aufl., CDN: https://cdn.rebrickable.com/…        (direkt)
```

**Ein Nebeneffekt, der zur eigentlichen Ursache passt:** Weniger
Proxy-Anfragen an unseren Server bedeuten weniger gebündelte CDN-Anfragen von
derselben Server-Adresse — genau die Stelle, an der die vermutete Drosselung
durch BunnyCDN ansetzen würde. Das behebt sie nicht direkt, senkt aber die
Häufigkeit, mit der sie überhaupt ausgelöst werden könnte.

**Test.** Vier Prüfungen: Webapp-Katalogkachel nutzt den Proxy mit
Vorschaubild, Webapp-Katalogdetail lädt direkt (kein `imgUrl()` um
`fullUrl()`), Androids `resolveFullUrl()` gibt CDN-Adressen unverändert
zurück, Androids Vorschau bleibt beim Proxy mit `&thumb=1`.

Stand: `tsc --noEmit` sauber, 26 Tests grün (Webapp). Android ungeprüft wie
immer, Klammerbilanz und Logik ausserhalb von Gradle nachgestellt.

---

## Katalog-Detail: Bild wird jetzt dauerhaft gespeichert, nicht nur zwischengecacht

Auf Wunsch umgesetzt: Beim ersten Öffnen eines Katalog-Sets wird das Bild
jetzt **heruntergeladen und dauerhaft unter `public/images/sets/` abgelegt**,
mit Vorschau — genau wie beim Hinzufügen eines Sets zum eigenen Bestand,
nicht mehr nur über den Bild-Proxy-Cache zwischengespeichert.

**Der Unterschied zu vorher:** Der Endpunkt prüfte nur, *ob* die Datei
zufällig schon existiert (weil irgendein anderer Nutzer das Set besitzt).
Existierte sie nicht, blieb es dabei — ein rein durchstöbertes Set griff bei
jedem erneuten Anschauen wieder aufs CDN zu (über den Proxy-Cache, der pro
angefragter URL lebt, nicht pro Set). Jetzt wird beim ersten Öffnen aktiv
heruntergeladen:

```js
if (!image_local && set.image_url) {
  const { downloadSetImage } = require('../sets');
  image_local = await downloadSetImage(set.image_url, set.set_number).catch(() => null);
  if (image_local) {
    const { generateThumb } = require('../thumbs');
    setImmediate(() => generateThumb(image_local).catch(() => {}));
  }
}
```

**Zwei Dinge dabei bewusst beachtet:**

`downloadSetImage()` ist dieselbe Funktion, die `addSet()` beim Hinzufügen
zum Bestand benutzt — sie prüft selbst zuerst, ob die Datei schon existiert
(idempotent), sodass ein späteres tatsächliches Hinzufügen desselben Sets
**keinen** zweiten CDN-Abruf mehr braucht.

Die Vorschau-Erzeugung liegt **nicht** innerhalb von `downloadSetImage()`
selbst — das habe ich beim Nachlesen von `addSet()` gesehen und beim ersten
Versuch übersehen. Ohne den separaten `generateThumb()`-Aufruf läge das Bild
zwar dauerhaft ab, bekäme aber nie eine `_thumb.jpg`-Variante, und jede
Kachel würde weiterhin die grosse Originaldatei laden.

**Nachgestellt** (da mein Testrechner kein `cdn.rebrickable.com` erreicht,
gegen einen lokalen Ersatzserver mit einem echten, gültigen JPEG):

```
Datei nach Download vorhanden : true (3145 Bytes)
generateThumb() Rückgabe      : /images/sets/…_thumb.jpg
Thumb-Datei vorhanden         : true (1709 Bytes, kleiner als das Original)
```

Da die Webapp (`thumbUrl()`/`fullUrl()`) und Android (`resolveThumbUrl()`/
`resolveFullUrl()`) `image_local` bereits bevorzugen, sobald es gesetzt ist,
war **keine** Client-Änderung nötig — beide greifen automatisch auf die neu
gespeicherte lokale Datei zu, sobald sie existiert.

**Bewusst nur im Detail-Dialog, nicht in der Liste:** Die Kachelliste zeigt
beim Scrollen potenziell hunderte Sets — ein Download pro Kachel würde den
Server stark belasten und genau die vermutete CDN-Drosselung provozieren, die
wir gerade zu vermeiden versuchen. Der Detail-Dialog ist ein bewusstes
Anschauen eines einzelnen Sets — hier ist genau ein zusätzlicher CDN-Abruf
gerechtfertigt, danach nie wieder.

**Test.** Fünf Prüfungen: Download wird angestossen, Vorschau wird separat
erzeugt, beides nur wenn noch keine lokale Datei existiert.

Stand: `tsc --noEmit` sauber, 27 Tests grün, Paritätssuite 32/32.

---

## Katalog-Liste baut jetzt auch beim Scrollen einen dauerhaften Cache auf

Auf Wunsch ergänzt: Nicht mehr nur der Detail-Dialog, sondern auch die
**Liste selbst** reiht fehlende Bilder zum Herunterladen ein — begrenzt und
im Hintergrund, damit genau das nicht wieder passiert, was zu den
ursprünglichen Zeitüberschreitungen geführt hat.

### Die Begrenzung ist der wichtige Teil

Eine Kachelwand kann bis zu 200 Sets ohne lokales Bild pro Seite enthalten.
Ohne Begrenzung würde ein schnelles Scrollen durch mehrere Seiten genau die
Anfragenflut an Rebrickables CDN erzeugen, die vermutlich die Drosselung
auslöst — also dasselbe Problem nochmal, nur diesmal selbst verursacht.

Deshalb dieselbe Bauart wie die bestehende Vorschau-Warteschlange
(`server.ts`, `queueThumb`/`drainThumbQueue`): eine strikt auf **zwei**
gleichzeitige Downloads begrenzte, deduplizierte Warteschlange.

```js
const CATALOG_DL_MAX_PARALLEL = 2;
const _catalogDlSeen = new Set<string>();   // kein Set zweimal einreihen

function queueCatalogImageDownload(setNumber, imageUrl) {
  if (!imageUrl || _catalogDlSeen.has(setNumber)) return;
  _catalogDlSeen.add(setNumber);
  _catalogDlQueue.push({ setNumber, imageUrl });
  drainCatalogDlQueue();
}
```

In der Liste eingehängt, ohne die Antwort zu verzögern:

```js
if (!exists) queueCatalogImageDownload(s.set_number, s.image_url);
```

**Nachgestellt:** 20 Sets gleichzeitig eingereiht, gegen einen künstlich
verzögerten lokalen Ersatzserver — höchstens **2** liefen tatsächlich
gleichzeitig, unabhängig davon, wie viele in der Warteschlange standen.

**Eine bewusste Vereinfachung:** `_catalogDlSeen` markiert ein Set dauerhaft
als „schon versucht" — auch nach einem Fehlschlag wird es nicht erneut
eingereiht, bis der Server neu startet. Das verhindert, dass ein Set ohne
Bild bei Rebrickable (ein echter, dauerhafter 404) bei jedem Scrollen erneut
angefragt wird — auf Kosten davon, dass ein einmaliger, echt transienter
Fehlschlag ebenfalls erst nach einem Neustart erneut versucht würde. Für eine
rein opportunistische Hintergrund-Anreicherung ist das der richtige
Kompromiss.

**Test.** Sechs Prüfungen: Begrenzung vorhanden, Deduplizierung vorhanden,
beide Funktionen existieren, die Liste reiht tatsächlich ein, und tut das
nicht blockierend.

Stand: `tsc --noEmit` sauber, 28 Tests grün, Paritätssuite 32/32.

Damit sollte sich der lokale Bild-Bestand mit jeder Katalog-Nutzung
langsam füllen — nicht schlagartig, aber stetig, und ohne die
Nebenläufigkeit zu erzeugen, die vermutlich die eigentliche Ursache der
Zeitüberschreitungen war.

---

## Detailbilder von Teilen und Minifiguren jetzt über das Backend

Auf Wunsch anders entschieden als bei Sets/Katalog: Dort läuft die volle
Auflösung bewusst direkt vom Gerät zum CDN (schneller, entlastet den
Server). Für **Teile und Minifiguren** soll auch das Detailbild durch das
Backend laufen — in Webapp **und** Android.

### Webapp

`data-orig` (speist den Zoom, `11-actions.js`) zeigte bei Teilen bisher auf
die rohe, unveränderte Adresse — bei einer CDN-Quelle lud der Zoom damit
direkt im Browser, am Server vorbei. Jetzt:

```js
data-orig="${escUrl(rawSrc ? imgUrl(fullUrl(rawSrc), false) : '')}"
```

`imgUrl(..., false)` wickelt eine CDN-Adresse in `/api/img-proxy?url=…` ohne
`&thumb=1` — volle Auflösung, aber über den Server.

**Minifiguren-Zoom war beim Nachprüfen bereits korrekt** — `imgSrc` dort ist
schon `imgUrl(thumbUrl(...), true)`, und `fullUrl()` darauf entfernt nur das
`&thumb=1`, das Ergebnis bleibt proxy-gewickelt. Keine Änderung nötig.

**Dabei eine echte, bisher unentdeckte Stelle gefunden:** Die manuell
erfassten **Teile**-Kacheln (`renderManualParts()` in `06-minifigs.js`)
zeigten das Bild komplett unverarbeitet — `p.image_local || p.image_url`
direkt als `<img src>`, ohne Vorschau, ohne Proxy, die einzige Stelle im
ganzen Projekt mit diesem Muster. Behoben, jetzt wie jede andere Kachel:

```js
const imgSrc = imgUrl(thumbUrl(p.image_local || p.image_url) || …, true);
```

### Android

Es gibt für Teile/Minifiguren keinen eigenen Zoom-Dialog wie bei Sets — der
Rückfall-Mechanismus der Kachel (`rememberTileImageWithFallback`) übernimmt
diese Rolle. Neuer Parameter `fullViaProxy`:

```kotlin
fun rememberTileImageWithFallback(
    serverUrl: String, imageLocal: String?, imageUrl: String?,
    fullViaProxy: Boolean = false   // Sets/Katalog: false (direkt), Teile/Minifiguren: true (Proxy)
): Pair<String?, () -> Unit>
```

Neue Funktion `resolveFullUrlViaProxy()` — wie `resolveFullUrl()`, aber
wickelt eine CDN-Adresse weiterhin in den Server-Proxy statt sie roh
zurückzugeben. `PartsScreen.kt` und `MinifigsScreen.kt` (je zwei Kacheln)
übergeben jetzt `fullViaProxy = true`; `GalleryScreen.kt`/`CatalogScreen.kt`
bleiben unverändert bei der Vorgabe `false`.

Nachgestellt:

```
Sets/Katalog-Rückfall (bypass) : https://cdn.rebrickable.com/…        (direkt)
Teile/Minifig-Rückfall (Proxy) : https://…/api/img-proxy?url=…        (über Server)
```

**Test.** Webapp: zwei Prüfungen (Teile-Zoom proxy-gewickelt, manuelle
Teile-Kachel korrigiert). Android: zwei Prüfungen (der neue Helfer wickelt
korrekt, und die Verwendungsstellen sind exakt auf die vier betroffenen
Kacheln beschränkt — Sets/Katalog bleiben unangetastet).

Stand: `tsc --noEmit` sauber, 46 Tests grün (Webapp). Android ungeprüft wie
immer, Klammerbilanz und Logik ausserhalb von Gradle nachgestellt.

---

## Nachtrag: ein zweiter, eigenständiger Detail-Dialog hatte dieselbe Lücke

Dein Hinweis „kommt weiterhin vom CDN" war berechtigt — mein vorheriger Fix
deckte nur den **Kachel-Zoom** ab (`03-parts.js`, `06-minifigs.js`). Es gibt
aber einen **zweiten, unabhängigen** Ort: den Kaufpreis-Detail-Dialog für
manuell erfasste Teile/Minifiguren (`man-detail-img` in `07-admin.js`,
geöffnet über „Kaufpreise bearbeiten"). Der hatte seine **eigene**
Bild-Anzeige, komplett getrennt vom Kachel-Code, die ich beim ersten
Durchgang übersehen habe:

```js
// vorher
const imgSrc = fullUrl(item.image_url || item.image_local || '');

// jetzt
const rawImgSrc = item.image_local || item.image_url || '';
const imgSrc = rawImgSrc ? imgUrl(fullUrl(rawImgSrc), false) : '';
```

`fullUrl()` allein wickelt eine CDN-Adresse nicht in den Proxy — nur
`imgUrl(..., false)` tut das (volle Auflösung, kein `&thumb=1`). Genau dieselbe
Korrektur wie beim Kachel-Zoom, nur an einer zweiten, unabhängigen Stelle
nachgezogen.

**Android brauchte hier keine Änderung.** Das dortige Gegenstück
(`ManualItemComposables.kt`, der Kaufpreis-Dialog) zeigt gar kein eigenes
Bild — es verlässt sich vollständig auf die Kachel im Hintergrund, die bereits
über `fullViaProxy = true` korrigiert ist. Die Webapp hatte hier schlicht
doppelten, unabhängigen Code für dieselbe Sache; Android nicht.

**Test.** Prüft, dass der Dialog jetzt `imgUrl(fullUrl(...), false)` benutzt
statt der alten, unproxierten Zuweisung.

Stand: `tsc --noEmit` sauber, 47 Tests grün (Webapp).

---

## Fix: Katalog-Timeouts beim Jahres-Filter, fehlende Vorschau im Katalog, und Android-Set-Detail zeigte Vorschau statt Original

Drei Punkte in dieser Runde — zwei aus deiner letzten Meldung fertiggestellt,
einer neu.

### 1. Datenbank-Timeouts beim Filtern nach Jahr

**Bestätigt und behoben.** Die Katalog-Liste prüfte für bis zu 200 Sets pro
Seite gleichzeitig per `fs.promises.access()`, ob ein lokales Bild existiert.
Das läuft über den libuv-Thread-Pool — standardmässig nur **4 Threads** — und
flutete ihn. Andere Pool-Arbeit, darunter TLS-Handshakes neuer
Datenbank-Verbindungen, wurde dadurch verzögert: genau die „timeout exceeded
when trying to connect"-Fehler aus deinem Log, ausgelöst durch eine grosse
Trefferzahl auf einmal (Jahres-Filter mit vielen Treffern).

### 2. Katalog zeigte immer die volle Auflösung, nie die Vorschau

**Bestätigt und behoben — dieselbe Code-Stelle wie oben.** Meine eigene
Existenzprüfung fragte nur nach der Originaldatei, nie nach `_thumb.jpg` —
anders als die längst bestehende, korrekte `resolveImageLocal()`.

**Eine gemeinsame Lösung für beides:** neue Funktion `resolveIfExists()` in
`utils/images.ts` — synchron statt asynchron, mit Cache (positive Treffer
bleiben dauerhaft gültig, negative werden nach 10 Minuten erneut geprüft),
bevorzugt korrekt die Vorschau.

```js
function resolveIfExists(publicRelPath) {
  const hit = _existsCache.get(publicRelPath);
  if (hit && (hit.exists || Date.now() - hit.checkedAt < 10*60*1000))
    return hit.exists ? resolveImageLocal(publicRelPath) : null;
  const exists = fs.existsSync(fsPath);
  _existsCache.set(publicRelPath, { exists, checkedAt: Date.now() });
  return exists ? resolveImageLocal(publicRelPath) : null;
}
```

Katalog-Liste UND -Detail benutzen sie jetzt beide. Nachgestellt:

```
nichts existiert : null
nur Original     : .../TEST-B-ONLY-ORIGINAL.jpg
Original+Vorschau: .../TEST-C-WITH-THUMB_thumb.jpg   ← Vorschau bevorzugt
Cache nach Löschen (hält weiterhin Treffer)
```

**Test.** Acht Prüfungen — drei ältere Tests aus der vorigen Runde mussten
dabei aktualisiert werden, da sie noch die jetzt ersetzte, fehlerhafte
Implementierung erwarteten (unter anderem ein Test, der ausdrücklich
„muss parallel laufen" verlangte — genau das Gegenteil des jetzigen, richtigen
Verhaltens).

### 3. Android: Set-Detail-Dialog zeigte die Vorschau statt der vollen Auflösung

Auf deine Nachfrage hin geprüft: Die Webapp zeigt im Set-Detail-Dialog
(`07-admin.js`, `m-img`) immer `fullUrl()` — die volle Auflösung, keine
Vorschau. Android benutzte für dasselbe Hauptbild `resolveThumbUrl()`. Mein
eigener Kommentar an der Stelle behauptete fälschlich, das entspräche der
Webapp — das habe ich beim Nachschlagen widerlegt und korrigiert.

```kotlin
// vorher
val imageUrl = resolveThumbUrl(serverUrl, set.imageLocal, set.imageUrl)

// jetzt — wie die Webapp
val imageUrl = resolveFullUrl(serverUrl, set.imageLocal, set.imageUrl)
```

`CatalogDetailScreen.kt` war beim Nachprüfen bereits korrekt (nutzt nur
`resolveFullUrl()`) — nur `SetDetailScreen.kt` hatte die Abweichung.

**Test.** Drei Prüfungen, gegen den tatsächlichen Code nachgerechnet.

Stand: `tsc --noEmit` sauber, 39 Tests grün (Webapp, Katalog/Diverses),
Paritätssuite 32/32. Android ungeprüft wie immer, Klammerbilanz geprüft.

**Noch offen, nicht in diesem Paket:** Der Hintergrund-Job für manuell
erfasste Teile (und vermutlich auch Minifiguren) in `server.ts` lädt Bilder
herunter, ruft danach aber nie `generateThumb()` auf — anders als beim
Herunterladen eines Sets. Das war in der letzten Antwort bereits gefunden,
aber noch nicht behoben; folgt in der nächsten Runde.

---

## Papierkorb-Symbol: von Anfang an weiss hinterlegt (Brick-Design)

Per Screenshot gemeldet: Beim Überfahren der Kachel erschien der Papierkorb
oben rechts nur schwach (`rgba(255,255,255,.22)` — 22 % Deckkraft), erst beim
direkten Überfahren des Knopfes selbst wurde er voll weiss.

```css
/* vorher */
[data-theme="brick"] .sc .delbtn{
  background:rgba(255,255,255,.22);border-color:rgba(255,255,255,.75);color:#fff;
}

/* jetzt — von Anfang an */
[data-theme="brick"] .sc .delbtn{
  background:#fff;border-color:#fff;color:var(--b600);
}
[data-theme="brick"] .sc .delbtn:hover{
  background:#fff;border-color:#fff;color:var(--r500);
}
```

Beide Zustände jetzt voll weiss hinterlegt; als zusätzliche Rückmeldung
färbt sich das Symbol beim direkten Überfahren rot (statt vorher: Grund
wechselt von durchscheinend auf weiss).

**Test.** Verlangt, dass der schwache Ruhezustand nicht mehr vorkommt und der
Knopf von Anfang an voll weiss hinterlegt ist.

Stand: `tsc --noEmit` sauber, 34 Tests grün.

---

## Fertiggestellt: fehlende Vorschau für Teile und Minifiguren im Hintergrund-Job

Der letzte offene Punkt aus der vorigen Runde. Der stündliche
Hintergrund-Job (`server.ts`, `img-dl-bg`) lud Bilder für manuell erfasste
Teile und für Minifiguren herunter und aktualisierte `image_local` — rief
danach aber **nie** `generateThumb()` auf. Bei Sets (derselbe Job,
`downloadSetImages()`) geschah das schon immer korrekt.

```js
// Teile-Schleife, jetzt ergänzt
for (const p of manualParts) {
  const local = await enrich.downloadImage(p.image_url, p.part_number, p.color_id || 0).catch(() => null);
  if (local) {
    await db.run(/* image_local setzen */).catch(() => {});
    const { generateThumb } = require('./routes/thumbs');
    generateThumb(local).catch(() => {});   // ← fehlte
  }
  await tick();
}
```

Dieselbe Ergänzung für die Minifiguren-Schleife direkt darunter.

**Warum das bisher nicht auffiel:** Es gibt einen separaten, einmaligen
Startup-Job ("Generate missing thumbnails"), der fehlende Vorschauen für
Sets und Teile nachträglich erzeugt — aber nur **beim nächsten
Server-Neustart**, nicht wenn ein Bild gerade frisch heruntergeladen wurde.
Bei einem lange laufenden Server ohne Neustart blieb die Lücke deshalb
dauerhaft sichtbar. Ausserdem deckt dieser Startup-Job **keine
Minifiguren** ab (nur `sets` und `parts`) — für Minifiguren gab es also gar
keinen Auffangmechanismus.

Nachgestellt, beide Namensmuster:

```
Teil-Vorschau (Muster: nummer_farbe.jpg)   : true
Minifigur-Vorschau (Muster: nummer_0.jpg)  : true
```

**Test.** Zwei Prüfungen — je Schleife, dass `generateThumb()` importiert
und nach einem erfolgreichen Download aufgerufen wird.

Stand: `tsc --noEmit` sauber, 58 Tests grün, Paritätssuite 32/32.

Damit sind beide aus der letzten Antwort offenen Punkte erledigt — dieses
Paket enthält den Katalog-Timeout-Fix, die Katalog-Vorschau-Korrektur, den
Android-Set-Detail-Fix, das Papierkorb-Styling und jetzt diese
Vorschau-Lücke, alle in einem Download.

---

## Der eigentliche Grund: Android verlor die Thumb/Voll-Unterscheidung komplett

Du hattest recht — mein vorheriger Fix (Set-Detail-Dialog auf
`resolveFullUrl()` umgestellt) hat das Problem nicht wirklich behoben. Der
Fehler sass tiefer, in `resolveFullUrl()` selbst.

**Der Fehler:** Beim Entfernen des fehlerhaften Rateversuchs (`toThumbPath()`,
zwei Runden zuvor) habe ich versehentlich auch die **gegenteilige, aber
nötige** Operation entfernt — das Abschneiden eines bereits vorhandenen
`_thumb`-Suffixes für die volle Auflösung. Dadurch lieferten
`resolveThumbUrl()` **und** `resolveFullUrl()` bei gesetztem `imageLocal`
exakt denselben Wert:

```
resolveThumbUrl(imageLocal = .../10283-1_thumb.jpg) → .../10283-1_thumb.jpg
resolveFullUrl (imageLocal = .../10283-1_thumb.jpg) → .../10283-1_thumb.jpg   ← identisch!
```

Sobald ein Set lokal abgelegt ist — der Normalfall, sobald es einmal
heruntergeladen wurde — liefert der Server für `image_local` bevorzugt den
Vorschau-Pfad (`resolveImageLocal()`, serverseitig, schon immer korrekt).
Ohne das Abschneiden zeigte Android in Detail **und** Zoom exakt dieselbe
kleine Kachel-Vorschau, nie die tatsächliche volle Auflösung.

**Behoben, an beiden betroffenen Stellen** (`resolveFullUrl()` für
Sets/Katalog, `resolveFullUrlViaProxy()` für Teile/Minifiguren):

```kotlin
val path = if (thumb) imageLocal
           else imageLocal.replace(Regex("""_thumb(\.[^.?]+)(\?|$)"""), "$1$2")
```

Dieselbe Umkehrung, die die Webapp in `fullUrl()` schon immer macht — jetzt
in Android nachgebildet.

Nachgestellt:

```
resolveThumbUrl(Vorschau-Pfad hinterlegt): .../10283-1_thumb.jpg
resolveFullUrl (Vorschau-Pfad hinterlegt): .../10283-1.jpg   ← jetzt unterschiedlich
resolveFullUrl (Original hinterlegt)     : .../10283-1.jpg
```

**Test.** Drei Prüfungen — zwei gegen den Quelltext, eine, die das
tatsächliche Ergebnis beider Funktionen bei einem Vorschau-Pfad direkt
vergleicht und verlangt, dass sie sich unterscheiden.

Stand: Android ungeprüft wie immer, Klammerbilanz geprüft, Logik ausserhalb
von Gradle mit konkreten Beispielwerten nachgerechnet.

---

## Compile-Fehler behoben: `.slice()` ist in Kotlin kein JavaScript-`slice()`

Eigener Fehler beim Schreiben eines Tests: Kotlins `String.slice()` nimmt nur
einen `IntRange` entgegen (z. B. `slice(3..8)`), keine zwei einzelnen
Zahlen wie JavaScripts `slice(start, end)`. Ich hatte versehentlich die
JavaScript-Schreibweise benutzt.

```kotlin
// vorher — kompiliert nicht
val fn = src.slice(start, start + 800)

// jetzt
val fn = src.substring(start, start + 800)
```

Das gesamte Projekt (Test- **und** Produktionscode) nach demselben Muster
durchsucht — nur diese eine Stelle war betroffen.

Stand: Klammerbilanz geprüft, die betroffene Prüfung erneut gegen den
echten Code nachgerechnet (bleibt innerhalb der Dateigrenzen, die Assertion
gilt weiterhin).

---

## Preisverlauf: Doppel-Diagramm — und die Finanzliste je Kaufpreis

**Bruchänderung am Server.** `/api/v1/sets/:setNumber/price-history` liefert
seit Manager-Stand hardened-89 kein `history` mehr, sondern `history_new` /
`history_used`, dazu `current`, `by_condition` und fertige `chart`-Daten. Die
App las weiter `history` — das Diagramm blieb still leer, ohne Fehlermeldung.

**Modelle.** `PriceHistoryResponse` neu geschnitten. `N`/`U` bewusst als zwei
benannte Felder (`PriceByCondition`, `CurrentByCondition`) statt als Map: Es
gibt genau zwei Zustände, und so stehen sie beim Lesen da.

`firstRealIndex` ist **camelCase**, auch im JSON — der Wert kommt aus einem
TypeScript-Objektliteral, nicht aus einer Datenbankspalte. Die Beträge der
Verlaufszeilen kommen teils als String an (Postgres liefert NUMERIC so); der
lenient konfigurierte Json-Parser nimmt das an, ein Test hält es fest.

**Diagramm.** Zwei Linien mit Flächenverlauf, Rasterlinien, Legende und
Randdatum. Zwei Fallen, beide in `ui/PriceChartMath.kt` samt Test:

1. Die vom Server vorne **aufgefüllten Nullen** dürfen nicht gezeichnet werden.
   Als Punkt ergäben sie eine Linie, die bei null beginnt und senkrecht
   hochspringt — ein Kurssturz, den es nie gab. `firstRealIndex` sagt je Reihe,
   ab wo echte Werte stehen.
2. Die x-Position kommt vom **Datum**, nicht vom Index. Gebrauchtpreise setzen
   für viele Sets später ein; indexbasiert würden beide Reihen über die volle
   Breite gestreckt und Punkte aus verschiedenen Monaten lägen übereinander.

Beide Linien teilen sich eine Skala — der interessante Vergleich ist der
Abstand zwischen Neu und Gebraucht und wie er sich entwickelt.

Die Rechnung liegt in einer eigenen, Compose-freien Datei (Muster wie
`ui/CatalogYearMath.kt`): In einem Canvas-Block kann kein Unit-Test sie prüfen,
und genau diese Fehler sind am Gerät nicht als Fehler zu erkennen.

**Farben aus dem Design.** `LocalChartColors` in `ui/theme/Theme.kt` — im
Stein-Design Salbeigrün `#5F8468` (Neu) und Sand `#9A7A45` (Gebraucht),
klassisch `#2563EB` / `#D97706`. Dieselben Werte wie `--chart-new` /
`--chart-used` der Webapp, und dieselben Farben wie die Zustands-Plaketten:
Wer sie wiedererkennt, muss die Legende nicht lesen.

**Marktpreis je Zustand.** `MarketPriceByCondition` zeigt je Zustand eine Zeile
mit Marktpreis und Entwicklung. Welche Zeilen erscheinen, entscheidet der
Server (`by_condition`): nur Zustände, zu denen auch ein Kaufpreis erfasst ist
— sonst stünde dort ein Marktpreis ohne Bezugsgrösse und die Prozentangabe
daneben wäre gegen nichts gerechnet.

**Finanzliste: eine Zeile je Kaufpreis.** Ein Set mit einem Kaufpreis für „Neu"
und einem für „Gebraucht" zeigt jetzt zwei Zeilen, jede mit dem Marktpreis
**ihres** Zustands. Vorher galt das ganze Set als gebraucht, sobald eine
einzige Erfassung gebraucht war — auch das neu gekaufte Exemplar wurde mit dem
Gebrauchtpreis bewertet.

Alle Werte kommen fertig vom Server (`ValuationAcquisition`); hier wird nichts
nachgerechnet. Keine Summenzeile daneben: Die Gesamtsumme steht in der
Kopfkachel. Sets mit einer oder ohne Erfassung sehen unverändert aus.

**Nebenbei.** `PriceHistoryCard` entfernt (rief niemand auf), der
`currency`-Parameter von `PriceChart` ebenfalls — ein durchgereichter, aber
ungenutzter Parameter war in dieser Datei schon einmal teuer (`imageLoader`).
Das hartkodierte deutsche `"Kaufpreis: …"` im Detail-Dialog läuft jetzt über
`finance_purchase_short`.

**Tests.** `PriceChartMathTest` (8) und `PriceHistorySerializationTest` (7).
Neue String-Ressourcen waren keine nötig.

---

## Kacheln: eine Plakette je erfasstem Zustand

`condition` kennt nur einen Wert („gebraucht, sobald eine Erfassung gebraucht
ist"). Ein Set mit einem Exemplar neu und einem gebraucht zeigte deshalb nur
„Gebraucht" — obwohl die Neu-Erfassung mit ihrem eigenen Preis in die Bewertung
eingeht.

`ConditionBadges(conditions, fallback)` in `ui/screens/ManualItemComposables.kt`
zeigt je erfasstem Zustand eine Plakette, benutzt in Galerie-, Teile- und
Minifiguren-Kacheln. Welche es gibt, entscheidet der Server (`conditions`);
hier wird nichts abgeleitet. Antworten ohne das Feld fallen auf `condition`
zurück und sehen aus wie bisher.

`SetAggregate` trägt `conditions` und `avg_purchase_price` mit — ohne das
behielte die Kachel nach einer Zustandsänderung im Kaufpreis-Dialog die alten
Plaketten bis zum nächsten vollständigen Laden. Genau dafür gibt es das
Aggregat.

Preis und Veränderung der manuellen Kacheln kommen aus der Bewertungsantwort
und sind serverseitig jetzt mengengewichtet über alle Zustände — in der App war
dafür nichts zu ändern, weil dort nie nachgerechnet wurde.

**Aufgefallen, nicht angefasst:** `ManualItemCard` in `PartsScreen.kt` nimmt
einen Parameter `purchasePrice` entgegen und zeigt ihn nirgends an. Entweder
gehört der Preis auf die Karte oder der Parameter weg — sag, was dir lieber
ist.

**Tests.** `PriceHistorySerializationTest` um drei Fälle erweitert (Liste
kommt an, alte Antwort ohne das Feld, manuelle Minifiguren).

**Nachtrag (Kompilierfehler).** Beim Einfügen von `ConditionBadges` blieb das
`@Composable` der darunterliegenden Funktion über dem neuen Kommentarblock
stehen — `ConditionBadges` trug die Annotation damit zweimal
(*This annotation is not repeatable*, `ManualItemComposables.kt:106`). Die
überzählige Zeile ist entfernt.

Das gesamte Projekt nach demselben Muster durchsucht (Annotation, die direkt
von einer weiteren Annotation gefolgt wird): nur diese eine Stelle. Bei
`PriceChart` stand ausserdem ein Kommentar zwischen `@Composable` und `fun` —
gültig, aber unschön; er ist jetzt Teil des Dokumentationsblocks.

---

## Finanzliste: eine vollständige Karte je Kaufpreis

Die erste Fassung hängte die weiteren Erfassungen als schmale Unterzeilen an
eine Karte. Das las sich wie die Aufschlüsselung einer Summe darüber; die
Zeilen sind aber gleichrangig — jede steht für einen eigenen Kauf.

Die Liste wird deshalb vor dem Rendern flachgezogen (`setRows`): Ein Set mit
zwei Kaufpreisen ergibt zwei vollständige Karten mit Bild, Name, Nummer, Menge,
Kaufpreis, Marktpreis und Entwicklung dieser Erfassung. Unterschieden werden
sie durch die Zustands-Plakette (`ConditionBadges`), zusammengehalten durch Bild
und Setnummer; ein Tippen führt bei beiden auf dasselbe Set.

Der Schlüssel der LazyColumn ist jetzt `setnummer#erfassungs-id` — mit der
blossen Setnummer wären zwei Karten desselben Sets nicht unterscheidbar.

`AcquisitionValueRow` ist damit ohne Aufrufer und entfernt.

---

## Finanzen: manuelle Teile und Minifiguren je Kaufpreis

Dasselbe Muster wie bei den Sets: Ein Teil, das einmal neu und einmal gebraucht
gekauft wurde, erscheint mit zwei vollständigen Zeilen — je mit Menge,
Zustands-Plakette, Marktpreis dieses Zustands und eigener Entwicklung. Die
Liste wird dafür vor dem Rendern flachgezogen, der LazyColumn-Schlüssel ist
`part_<id>#<erfassungs-id>` bzw. `fig_<id>#<erfassungs-id>`.

`ManualFinanceRow` nimmt dafür `condition` und `pnlPct` entgegen; beide sind
optional, Einträge ohne Erfassungen sehen aus wie bisher. Gerechnet wird nichts
— die Werte kommen fertig aus der Bewertungsantwort (`acquisitions`).

Serverseitig gilt seit hardened-93 ausserdem: pro Tag und Zustand eine
Erfassung. Zweimal dasselbe Teil an einem Tag ergibt eine Zeile mit Menge 2,
nicht zwei Zeilen — in der App war dafür nichts zu tun.

**Test.** `PriceHistorySerializationTest` um den Teile-Bewertungsfall erweitert.

---

## Detail-Dialog manueller Teile und Minifiguren: Marktpreis je Zustand

Der Dialog zeigte Menge und Kaufpreise, aber keinen Marktpreis — anders als der
Set-Detail und anders als derselbe Dialog in der Webapp. Grund war nicht ein
vergessener Nachzug, sondern eine fehlende Route: Den Preisverlauf für Teile
und Minifiguren gab es nur für die Webapp. Mit Manager-Stand hardened-96 gibt
es beide auch unter `/api/v1`.

`getPartPriceHistory` / `getFigPriceHistory` in `BrickApiService` und
`BrickRepository`, geladen von `loadManualPriceHistory()` in
`ManualItemFeature.kt`. Bewusst ein eigener Aufruf neben
`loadManualAcquisitions()`: Die Erfassungsliste soll nicht warten, bis der
Preisabruf durch ist — sie ist das, was der Dialog zuerst zeigt.

Die Antwort passt in `PriceHistoryResponse`: Die Set-Felder (`set_number`,
`pnl_pct`, `purchase_price`) bleiben auf ihren Vorgaben, `by_condition` und
`chart` sind gleich. Der Dialog benutzt damit dieselben Composables wie das
Set-Detail — `MarketPriceByCondition` und `PriceChart`.

**Beim Wechsel auf einen anderen Eintrag** wird der alte Preisstand verworfen:
Die Antwort trägt keine Kennung, mit der der Dialog sie zuordnen könnte, sonst
stünde bis zum Eintreffen der neuen der Marktpreis des zuvor geöffneten Teils
da. Beim Neuladen desselben Eintrags (nach dem Speichern) bleibt er stehen —
sonst flackerte die Zeile bei jeder Änderung.

**Nebenbei.** Im Set-Detail stand neben der Prozentangabe `set.purchase_price`,
der gespiegelte Wert der letzten Erfassung. Jetzt `avg_purchase_price`, also
der mengengewichtete — die Zahl passt damit zur Prozentangabe daneben.

**Test.** `PriceHistorySerializationTest` um den Teile-Verlauf erweitert: Die
fehlenden Set-Felder müssen auf ihren Vorgaben landen statt zu werfen, sonst
bliebe der Dialog leer, ohne dass jemand sähe warum.

---

## Finanzen: Detail-Dialog auch für Teile und Minifiguren

Die Set-Zeilen im Finanzen-Reiter führen seit jeher auf die Detailansicht; die
Zeilen manueller Teile und Minifiguren waren die einzigen in dieser Liste, die
auf einen Klick nicht reagierten.

`ManualFinanceRow` nimmt jetzt ein optionales `onClick`. Bewusst zwei
`Card`-Zweige statt einer Karte mit `onClick = {}`: Material3 hat für die
anklickbare Karte eine eigene Überladung, und eine leere Rückruffunktion sähe
zwar gleich aus, gäbe aber Ripple und Rollenbeschreibung auch dort, wo es
nichts zu klicken gibt.

**Wo der Dialog lebt.** In `ToolsGraph.kt` beim Finanzen-Ziel, nicht in
`FinanceScreen`. Sets führen auf einen eigenen Screen, manuelle Einträge auf
einen Dialog — läge er im Screen, müsste der die Zustände und Rückrufe des
ViewModels kennen, die er sonst nirgends braucht. Der Screen meldet nur
`onManualClick(type, id, colorId)`.

Es ist derselbe `ManualItemDetailDialog` wie in den Reitern Teile und
Minifiguren, mit Kaufpreisen, Marktpreis je Zustand und Verlauf. Stamm- und
Preisdaten kommen aus der Bewertung, die diese Liste ohnehin geladen hat; die
Erfassungen holt `loadManualAcquisitions()` beim Öffnen. Änderungen an Menge
oder Kaufpreis lösen über `reloadItemList()` bereits ein `loadValuation()` aus
— die Liste dahinter stimmt danach von selbst.

---

## Detail-Dialog manueller Teile und Minifiguren: Bild ergänzt

Der Dialog kam ganz ohne Bild — anders als derselbe Dialog in der Webapp und
anders als das Set-Detail. `ManualItemDetailDialog` nimmt jetzt `imageUrl` und
`imageLoader`; fehlt eines von beiden, zeigt er an dieser Stelle nichts statt
eines leeren Rahmens.

Die Adresse kommt von `resolveFullUrlViaProxy()` — volle Auflösung **über den
Server-Proxy**, wie überall bei Teilen und Minifiguren. Der direkte
Geräte-zu-CDN-Weg ist hier bewusst nicht gewollt.

Versorgt sind alle drei Aufrufstellen: Reiter Teile, Reiter Minifiguren und der
Finanzen-Reiter (dort aus der Bewertungsantwort).

**Mitgezogen:** Der Dialoginhalt ist jetzt scrollbar. Mit Bild, Mengenwahl,
Kaufpreisen, Marktpreis je Zustand und Diagramm ist er deutlich länger als zu
der Zeit, als hier nur Menge und Kaufpreis standen — ein `AlertDialog`
schneidet zu langen Inhalt unten ab, und abgeschnitten wäre genau das gewesen,
was zuletzt dazukam.

**Zu den fehlenden Minifiguren-Preisen:** Das ist kein App-Fehler. Die App
zeigt, was `by_condition` liefert, und der Server hatte für Minifiguren ohne
BrickLink-Nummer nie einen Marktpreis abgelegt — dieselbe Ursache wie im
Webapp-Dialog, behoben in Manager-Stand hardened-98. Sichtbar nach dem nächsten
Bewertungslauf.

---

## Detail-Dialog manueller Teile und Minifiguren: Papierkorb oben rechts

Der Dialog war die einzige Stelle, an der ein manuell erfasstes Teil oder eine
Minifigur **nicht** löschbar war. Der Papierkorb sass nur auf der Kachel — und
aus dem Finanzen-Reiter gibt es gar keine Kachel, dort war der Eintrag also
überhaupt nicht mehr loszuwerden, seit die Zeile den Dialog öffnet.

Jetzt oben rechts im Titel, wie im Set-Detail: Titel und Untertitel in einer
Spalte mit `weight(1f)`, daneben der Knopf.

Gelöscht wird nicht sofort — dieselbe Nachfrage wie beim Löschen von der Kachel
aus, mit denselben Texten (`parts_delete_*` bzw. `minifigs_delete_*`), damit die
Frage überall gleich klingt. Neue String-Ressourcen waren keine nötig.

Nach dem Bestätigen schliesst sich auch der Detail-Dialog: Der Eintrag ist weg,
dahinter stünde sonst eine Karteileiche mit Mengenwahl und Kaufpreisen. Die
Listen dahinter aktualisieren sich von selbst — `deletePart()` und
`deleteMinifig()` rufen bereits `loadValuation()` und die jeweilige Liste.

`onDelete` ist optional: Ein Aufrufer ohne Löschweg zeigt keinen leeren Knopf.
Versorgt sind alle drei — Reiter Teile, Reiter Minifiguren, Finanzen.

---

## Manuelle Teile und Minifiguren: Detailansicht als ganzer Screen

Der Dialog ist über die letzten Runden gewachsen — Bild, Mengenwahl,
Kaufpreise je Zustand, Marktpreis je Zustand, Preisverlauf, Löschen. Zuletzt
hielt ihn nur noch ein eigener Scrollbereich zusammen: ein Screen im Kostüm
eines Dialogs, mit dem halben Bildschirm als Rand.

Jetzt `ui/screens/ManualItemDetailScreen.kt`, Aufbau wie `SetDetailScreen`:
Leiste mit Zurück-Pfeil und Papierkorb, darunter eine LazyColumn mit Bildkarte
(antippbar → Zoom), Kennzahlen-Chips, Abschnittskarte „Details" mit Mengenwahl
und Kaufpreisen, Abschnittskarte „Marktpreis" mit den Zeilen je Zustand und dem
Verlaufsdiagramm. Im Stein-Design zusätzlich die beiden Wert-Kacheln. Wer vom
Set zum Teil wechselt, findet dieselben Dinge an denselben Stellen.

**Der Screen liest vom ViewModel**, wie `AcquisitionManagementScreen`. Die
Alternative wäre gewesen, sechs Zustände und ebenso viele Rückrufe durch
`PartsScreen`, `MinifigsScreen` und `FinanceScreen` zu reichen — die drei haben
dadurch jetzt **weniger** Parameter als vorher: Statt acht Durchreichern melden
sie nur noch `onOpenDetail(...)`. `onUpdatePart`/`onUpdateFig` und `currency`
sind dort ganz entfallen, weil sie nur der Dialog brauchte.

Neue Route `manual_detail/{type}/{id}/{colorId}/{title}` nach dem Muster von
`AcquisitionManagement`, angesteuert aus allen drei Listen (Teile, Minifiguren,
Finanzen). Der Name für die Leiste kommt aus der Bewertung, die die jeweilige
Liste ohnehin geladen hat; bis dahin steht der aus der Navigation übergebene
Titel dort — deshalb `fallbackTitle`.

**Entfernt:** `ManualItemDetailDialog` samt der Importe, die nur er brauchte.
Ein Test hält fest, dass er weg ist und nicht bloss ungenutzt herumliegt.

**Neue Strings** (DE/EN): `detail_part_number`, `detail_fig_number`,
`detail_color`, `detail_section_item`. Die bestehende `detail_section_details`
lautet „Set-Details" und passt für ein Teil nicht.

**Test.** `ManualItemDetailRouteTest`: Die erzeugte Adresse muss dieselbe
Segmentzahl haben wie das Routenmuster (sonst wird das Ziel nie gefunden), und
ein Leerzeichen oder Schrägstrich im Namen darf kein zusätzliches Segment
aufmachen.

---

## Haushalt in der Android-App

Alles, was die Webapp seit hardened-101 kann — Kontofilter, Besitzer,
Verknüpfen, Erfassen für ein anderes Konto, Verschieben.

### Entschieden wird auf dem Server

Wer zum Haushalt gehört, wer schreiben darf und was ein Filterwert bedeutet,
beantwortet `utils/household.ts`. Die App reicht `accounts=` bzw.
`owner_user_id` durch und zeigt, was zurückkommt. Eine zweite Fassung dieser
Regeln hier wäre genau die Doppelung, an der in diesem Projekt schon mehrere
Zahlen auseinandergelaufen sind.

Dafür brauchte die `/api/v1` drei Ergänzungen: `GET /sets/household-members`,
`POST /sets/:sn/move` (mit optionaler `acquisition_ids`-Auswahl) und
`owner_user_id` an den drei Anlege-Routen. Alle über dieselbe Umsetzung wie die
Webapp-Routen; in der Inventur auf `paritaet` gestellt.

### Kontofilter je Ansicht

`ScopeFilter` hält den Wert **je Ansicht** im DataStore — wer in der Galerie
den ganzen Haushalt sieht, will in den Finanzen womöglich nur die eigenen
Zahlen. `ScopeFilterChip` steht in Galerie, Teilen, Minifiguren und Finanzen
und führt Alle, Eigene, den Sammelposten „Unterkonten" (erst ab zwei Kindern —
bei einem einzigen wäre er dasselbe wie dessen Name) und dann jedes Konto
namentlich.

Zwei Dinge, die dabei leicht schiefgehen:

* **Der Ablage-Cache greift nur ungefiltert.** Sonst läge die Antwort eines
  Kontos unter demselben Schlüssel wie die des ganzen Haushalts, und nach einem
  Neustart erschiene der falsche Bestand.
* **Umgeschaltet wird nur die betroffene Ansicht neu geladen** — und in den
  Reitern Teile und Minifiguren ausdrücklich **beide** Listen: Die manuell
  erfassten kommen aus der Bewertung, nicht aus der Teileliste. Genau dieser
  Fehler war in der Webapp gemeldet worden.

### Besitzer, Erfassen, Verschieben

Besitzer-Plaketten auf Galerie-, Teile- und Minifiguren-Kacheln (bei den
Minifiguren `Column` statt `Box`, sonst lägen Zustand und Besitzer am selben
Punkt übereinander). Kontoauswahl in allen drei Erfassen-Dialogen, vorbelegt
mit dem eigenen Konto — ohne Haushalt wird gar nichts mitgeschickt, und der
Server bleibt beim eigenen Konto wie bisher.

Verschieben an zwei Stellen, passend zur jeweiligen Ebene: das **ganze Set**
über die Leiste im Set-Detail, **einzelne Kaufpreise** über die
Eigentümer-Auswahl je Zeile im Kaufpreis-Screen. Der Hinweis im Dialog nennt,
dass Teile, Minifiguren und Anleitungen mitwandern — das sieht man der Galerie
nicht an, und wer es nicht erwartet, sucht sie später im falschen Konto.

### Einstellungen

Haushalts-Karte mit Einladungscode, Einlösen und Entkoppeln. Sie zeigt je nach
Rolle nur den passenden Kasten: Wer schon Unterkonto ist, sieht keinen
Einladungsknopf, wer Unterkonten hat, kein Eingabefeld. Beides würde der Server
ohnehin ablehnen — aber ein Knopf, der immer eine Fehlermeldung erzeugt, ist
schlimmer als keiner.

Die Meldungen des Servers (Währung weicht ab, Konto schon verknüpft, zweite
Stufe) werden im Wortlaut durchgereicht: Sie sind genauer als alles, was die
App daraus ableiten könnte.

**Tests.** `ScopeFilterTest` mit sechs Prüfungen zur Auswahllogik — Einträge je
Unterkonto, Sammelposten erst ab zwei, „all" wird weggelassen, eine Wahl auf
ein entkoppeltes Konto fällt zurück, jede Ansicht hat ihren eigenen Schlüssel.
Strings vollständig DE/EN.

---

## Verschieben nur noch über den Kaufpreis

Der Verschieben-Knopf in der Leiste des Set-Detail-Screens ist entfernt.
Bestand wandert ausschliesslich über die **Eigentümer-Auswahl je Zeile** im
Kaufpreis-Screen — und die gilt jetzt für alle drei Arten: Sets, manuell
erfasste Teile und manuell erfasste Minifiguren (vorher nur Sets).

Ein Set mit drei Erfassungen sind drei Käufe, die im Haushalt verschiedenen
Kindern gehören können. „Das Set verschieben" verdeckt, was tatsächlich
wandert; wer alles verschieben will, ändert jede Zeile und sieht dabei, wie
viele es sind.

`changeAcquisitionOwner()` in `HouseholdFeature.kt` schickt `owner_user_id` an
die passende Route (Set, Teil oder Minifigur). Der Server erzwingt dieselbe
Regel: `move` ohne `acquisition_ids` antwortet mit 400 — die Regel hängt nicht
an dieser Oberfläche.

---

## Nachtrag 79 — Zahlen und Beträge: eine Fassung, und sie folgt der Sprache

Aus der Gegenüberstellung von Webapp und App: Für denselben Betrag gab es drei
Schreibweisen.

| | Ausgabe |
|---|---|
| Webapp | `Intl.NumberFormat(locale(), {style:'currency', …})` |
| App, Finanzreiter | `"<Symbol> <Betrag>"` — Symbol VOR dem Betrag |
| App, überall sonst | `"<Betrag> <Code>"` — Code DAHINTER |

Dazu die Sprache: `locale()` in `public/i18n.js` folgt der eingestellten
UI-Sprache (de-CH oder en-GB), `fmtSwissAmount()` nagelte de-CH fest. Ein
englischsprachiger Nutzer sah in der App `1'234.50`, im Browser `1,234.50` —
dieselbe Zahl, zwei Bilder.

Und die Stückzahlen liefen daneben nochmal eigenständig: `"%,d".format(v)` mit
anschliessendem Ersetzen des Kommas durch einen Apostroph, an fünf Stellen
handgeschrieben, ebenfalls unabhängig von der Sprache.

**Jetzt:** `util/NumberFormatUtils.kt` ist die einzige Fassung.
`appNumberLocale()` liest die App-Sprache aus `AppCompatDelegate` — dieselbe
Quelle, aus der `LanguageManager` sie setzt — und bildet dieselbe Zuordnung ab
wie die Webapp. `fmtMoney()` benutzt die Währungs-Formatierung der Plattform
statt selbst zusammengesetzter Zeichenketten: Ob Symbol oder Code, davor oder
dahinter, entscheidet die Locale. Genau das trifft man von Hand nicht.

Am JDK nachgemessen: de-CH ergibt `CHF\u00A01\u2019234.50`, en-GB mit EUR
`€1,234.50` — beides deckungsgleich mit dem, was `Intl` im Browser liefert.

Dreizehn Aufrufstellen umgestellt, dazu fünf Stückzahl-Stellen auf `fmtInt()`.

### Die Finanz-Gesamtsumme kommt jetzt vom Server

`total_value` ist auf vier Nachkommastellen gerechnet, `display_value` auf
zwei. Die Kopfkachel las bereits `total_value`, die Zwischensummen und die
Gesamtsumme darunter addierten die gerundeten Zeilenwerte selbst — über viele
Positionen standen damit zwei verschieden gerundete Gesamtsummen in derselben
Ansicht. Die Webapp nimmt seit jeher die Serverzahl.

### Test

`NumberFormatTest.kt` prüft beides getrennt: die REGEL (keine Ansicht setzt
Betrag und Währung mehr selbst zusammen — die Aussage, die beim nächsten neuen
Bildschirm zählt) und das ERGEBNIS (die Helfer liefern tatsächlich Zahl,
Währung und zwei Nachkommastellen). Eine reine Quelltextregel hätte nicht
gereicht — das war die Lehre aus Nachtrag 48.

Bewusst NICHT festgenagelt: der genaue Wortlaut der Ausgabe. Ob de-CH das
Symbol vor oder hinter den Betrag setzt, entscheidet die Plattform und kann
sich mit einer JDK-Fassung ändern; ein Test darauf wäre eine Falle ohne
Aussage über unseren Code.

**Zur Prüfmethode:** Kotlin lässt sich im Container nicht kompilieren. Die
Quelltext-Prüfungen des Tests habe ich deshalb gegen die echten Dateien
nachgespielt (dabei kamen die fünf `"%,d"`-Stellen erst zum Vorschein), die
Formatierung selbst an einer echten JVM gemessen, und die Kommentar-Bilanz je
geänderter Datei gezählt — die verschachtelten Blockkommentare aus Nachtrag 39b.

---

## Nachtrag 80 — Die App rechnet nicht mehr, sie zeigt an

Zu Marcos Frage, ob Berechnungen zentral liegen können, damit die Oberflächen
nur noch zeichnen. Zwei Stellen in dieser App rechneten selbst, und beide
zeigten dadurch etwas anderes als die Webapp.

### Summenzeile der Erfassungen

`AcquisitionManagementScreen` und `ManualItemComposables` summierten Menge und
Betrag über die geladene Liste — die Webapp tat dasselbe an zwei eigenen
Stellen, und die vier Fassungen lasen den Preis aus verschiedenen Feldern.
Beide Ansichten lesen jetzt `totals` aus der Antwort
(`utils/acquisitions.ts`, `acquisitionTotals`).

Wichtig dabei: `amount = null` heisst „kein Kaufpreis erfasst" und ist etwas
anderes als ein Betrag von null. Diese Unterscheidung trifft der Server; die
Ansicht zeigt nur den Gedankenstrich. Für ältere Serverstände ist die Vorgabe
eine leere Summe — dann steht dort sichtbar „×0" statt einer still abweichenden
Zahl.

### Kennzahlen im Minifiguren-Reiter — die Kachel „manuell" stand immer auf 0

`MinifigsScreen` rechnete die drei Kacheln aus `figs`. Diese Liste ist aber
gefiltert (`source != "manual"`, weil manuelle Einträge weiter unten in eigenen
Karten stehen). Damit konnte `count { source == "manual" }` gar nichts anderes
als 0 ergeben, und Arten wie Stückzahl liessen die manuell erfassten Figuren
aus — die Webapp zählte sie mit.

Neu `GET /api/v1/minifigs/stats`: gezählt wird serverseitig über dieselbe
Gruppierung wie die Liste. Der Aufruf läuft NEBEN dem Listenabruf, damit die
Liste nicht auf die Zählung wartet; schlägt er fehl, behalten die Kacheln ihren
letzten Stand statt auf 0 zu springen.

Am laufenden Server nachgemessen (Haushalt, Set mit Menge 2 samt Figur, zwei
manuelle Figuren auf beiden Konten): Kachel und Liste nennen in jedem
Kontofilter dieselben Zahlen.

### Aufgeräumt

`AcquisitionEditDialog` in `ManualItemComposables.kt` wird von nirgendwo
aufgerufen — dieselbe Sorte Fund wie `ManualItemCard` in hardened-115.
Entfernt, samt der drei dadurch verwaisten Importe.

---

## Nachtrag 81 — Marcos zwei Entscheide

### A. Ein vorhandenes Set öffnet die Detailansicht — entschieden vom Server

Das Verhalten bleibt, wie es hier seit Nachtrag 57 war. Was sich ändert: Die
REGEL liegt nicht mehr in dieser App.

* **Nummern-Weg:** Der eigene `getSetDetail()`-Vorabaufruf ist entfallen. Das
  Erfassen selbst antwortet mit `action = "exists"` und schreibt nichts; die
  App öffnet daraufhin die Detailansicht. Ein Aufruf weniger — und die Webapp
  verhält sich jetzt genauso, was sie vorher nicht tat.
* **Scanner und Texterkennung:** fragen weiterhin VORHER, weil die Antwort
  darüber entscheidet, ob der Zwischendialog überhaupt erscheint. Aber sie
  fragen `GET /api/v1/sets/exists/:nummer`, das ausdrücklich `exists:
  true|false` sagt. Bisher wurde das aus dem FEHLER von `getSetDetail`
  abgeleitet — dort war „nicht vorhanden" dasselbe wie „Server nicht
  erreichbar", weshalb hier eine eigene `transient`-Auswertung nötig war.

Damit fällt diese Auswertung weg: Ein Fehler ist jetzt eindeutig ein Fehler und
führt zum Abbruch, statt auf gut Glück ein womöglich vorhandenes Set anzubieten.

Der Zwischendialog beim Scanner bleibt unverändert — er ist genau der
Unterschied, den Marco benannt hat.

### B. Die Galerie filtert nicht mehr selbst

Vorher holte die App ALLE Sets und filterte im Gerät: `sets.filter { … }` über
Nummer, Name und Thema, die Themenliste aus der geladenen Liste abgeleitet,
keine Sortierung. Die Webapp lässt den Server suchen — mit Jahr im Suchtext und
neun Sortierungen. Dieselbe Eingabe fand dort etwas, hier nicht.

Jetzt reicht die App `search`, `theme`, `sort` und `page` durch:

* `GalleryFeature` nach dem Muster von `CatalogFeature`, das seit jeher
  serverseitig sucht: entprellte Eingabe (350 ms), Filter-Generation gegen
  späte Antworten eines alten Filters, `loadMoreSets()` für den Endlos-Scroll.
* `GalleryScreen` filtert und sortiert nichts mehr. Die Themen-Chips kommen aus
  der Serverantwort (Themen des BESTANDS, nicht der geladenen Seite), und es
  gibt erstmals eine Sortierung — dieselben neun Werte wie in der Webapp.
  Ein Wert, den der Server nicht kennt, fiele dort still auf die Vorgabe
  zurück; deshalb sind es genau die Schlüssel aus SET_SORTS.
* Seitengrösse 60, wie in der Webapp. Zwei verschiedene Seitengrössen ergäben
  zwei verschiedene Scroll-Erlebnisse für denselben Bestand.
* Der Ablage-Cache greift weiterhin NUR ungefiltert — sonst läge die Antwort
  eines Filters unter demselben Schlüssel wie die volle Sicht, und nach einem
  Neustart erschiene der falsche Bestand. Dieselbe Regel wie beim Kontofilter.

Neue Strings `gallery_sort*` in DE und EN.

### Tests

`AddExistingSetTest` umformuliert statt abgeschaltet: Die Aussage lautet jetzt
„der Nummern-Weg prüft NICHT mehr selbst, sondern folgt der Serverantwort" und
„Scanner und Texterkennung fragen den eindeutigen Endpunkt". Dabei die bekannte
Falle wieder getroffen: Ein festes Zeichenfenster hinter `fun getSetExists(`
reichte in die nächste Deklaration, die einen `accounts`-Parameter hat — die
Prüfung wäre grundlos rot geworden. Jetzt wird bis zum Ende der Signatur
geschnitten. Dasselbe Muster ist in diesem Projekt schon viermal aufgefallen.

Neu `GalleryServerFilterTest`: kein `sets.filter` im Schirm, alle vier Rückrufe
vorhanden, die neun Sortierwerte sind die des Servers, das ViewModel reicht die
Filter durch und hat Generationszähler und Entprellung, und der Cache-Zweig
prüft weiterhin auf „ungefiltert".

**Zur Prüfmethode:** Kotlin lässt sich im Container nicht kompilieren. Die
Quelltext-Prüfungen beider Tests habe ich gegen die echten Dateien
nachgespielt, dazu Klammer- und Kommentar-Bilanz je geänderter Datei und die
XML-Wohlgeformtheit beider strings.xml. Die Galerie ist der grösste
Compose-Eingriff dieser Reihe — beim ersten Build dort zuerst hinsehen.

---

## Nachtrag 82 — Die Marktpreis-Karte wiederholt die Wert-Kacheln nicht mehr

Marcos Befund: „Der blau markierte Wert in der Android-App auf der Detailseite
kann entfernt werden. Dieser bietet keinen Mehrwert."

Er hat recht, und es war sogar mehr als eine Wiederholung. Im Stein-Design
steht der Marktpreis schon in der petrolfarbenen Kachel oben und der Kaufpreis
in der blauen daneben. Die grosse Zeile in der Marktpreis-Karte zeigte beide
noch einmal — und ihre Prozentangabe stammte aus dem GESAMTvergleich
(`history.pnlPct`), während die Zeilen darunter je Zustand rechnen.

Auf Marcos Bild ist das gut zu sehen: Das Set liegt einmal neu (7.99) und
einmal gebraucht (3.94) im Bestand. Oben stand „CHF 7.99 — 0,0 % — Kauf: CHF
5.97": ein Marktpreis, der nur für das neue Exemplar gilt, daneben ein
mengengewichteter Kaufpreis über beide, und dazwischen eine Prozentzahl, die
weder zum einen noch zum anderen Paar gehört. Direkt darunter dieselbe Zahl
zweimal richtig, je Zustand.

Entfernt ist die Zeile dort, wo die Kacheln stehen. Im klassischen Design gibt
es die Kacheln NICHT (`if (isBrick)` weiter oben) — dort bleibt sie, sonst
verschwände der Marktpreis von der Seite. Die Trennlinie erscheint nur noch,
wenn oben etwas steht, von dem zu trennen wäre.

Die Zwillingsansicht für Teile und Minifiguren kam schon immer ohne diese Zeile
aus und geht direkt zu den Zeilen je Zustand — die beiden Detailseiten
verhalten sich jetzt gleich.

### Test

`PurchasePriceDisplayTest` um eine Prüfung erweitert: Die Zeile hängt am
Design, die Kacheln bleiben, und die Ansicht für manuelle Einträge bekommt
keine grosse Preiszeile dazu. Geprüft wird die Kopplung, nicht das Aussehen —
ein einfaches „die Zeile ist weg" wäre auch dann grün, wenn sie im klassischen
Design mit verschwände und dort gar kein Marktpreis mehr stünde. Gegenprobe
durchgeführt.

---

## Nachtrag 83 — Der Mengenregler folgt der Serverantwort

Nachgezogen zu Nachtrag 85 des Servers: Angezeigt wird die Menge ALLER Konten,
geschrieben wird die Differenz auf das eigene. Unter den eigenen Bestand
deckelt der Server — fremde Exemplare lassen sich nicht wegnehmen — und
antwortet mit der tatsächlichen Gesamtmenge.

Der Regler zählte seine Zahl vorher hoch und behielt sie. Nach einem
gedeckelten Verringern stand damit die eigene Annahme auf dem Schirm, bis man
die Ansicht verliess und neu öffnete.

* `GenericResponse.quantity` (nullable) — null heisst „die Antwort kam nicht von
  einer Mengenänderung", und dann gilt wie bisher die gesendete Zahl. Der
  Rückfall ist absichtlich lautlos, damit ein älterer Server keine Fehlermeldung
  erzeugt.
* Übernahme in `updateQuantity` VOR dem Nachladen: `loadSetDetail()` läuft
  ohnehin gleich danach, aber es braucht eine Rundreise — und genau in dieser
  Zeit sieht man die falsche Zahl.
* Der Regler hängt sein `remember` jetzt an `set.setNumber` UND `set.quantity`.
  Hinge es nur an der Nummer, behielte er seinen alten Wert, obwohl der Zustand
  längst korrigiert ist — der Fix wäre unsichtbar geblieben.

Geprüft in `ServerComputedValuesTest`: Modellfeld vorhanden, Übernahme vor dem
Nachladen, Regler an die Menge gekoppelt. Kotlin ist im Container nicht
kompilierbar; die Prüfungen habe ich gegen die echten Dateien nachgespielt und
die Klammerbilanz gegen den Originalstand verglichen.

---

## Nachtrag 84 — Nach dem Löschen ziehen Teile und Minifiguren nach

Die Rückfrage beim Löschen war hier schon richtig (eine, sowohl von der Kachel
als auch aus der Detailansicht) — nur die Webapp fragte zweimal, das ist dort
behoben.

Was hier fehlte: `deleteSet()` lud Liste, Kennzahlen und Bewertung nach, aber
nicht die Teile- und Minifiguren-Reiter. Der Server löscht die Teile und
Minifiguren DES SETS mit (`deleteSetRows`), die beiden Reiter zeigten sie
trotzdem weiter, bis man sie neu öffnete. Die Webapp lädt sie seit jeher nach.

---

## Nachtrag 85 — Teile-Symbol statt Puzzleteil-Emoji

Marcos Wunsch, in beiden Apps. Betroffen waren die Katalog-Kachel (Teilezahl)
und der Bild-Platzhalter in der Teileliste. Beide zeigen jetzt
`ic_parts_bricks` — dasselbe Bild wie der Reiter „Teile" und wie die Webapp.

Ein Emoji hängt in seiner Darstellung an der Schriftart des Geräts; ein
Vektor-Symbol nicht. Das Figuren-Emoji in der Teileliste bleibt — dafür gibt es
kein eigenes Symbol.

---

## Nachtrag 86 — Die Jahres-Leiste springt, statt zu filtern

Marcos Vorgabe, und sein Hinweis auf die Umsetzung: „Kann nicht geprüft werden,
wo man hinscrollt, und dieser Teil wird dann geladen. So macht dies soweit ich
sehe auch die Foto-App von Google."

Genau so ist es jetzt — und dieser Hinweis hat den Bauplan verändert. Mein
erster Gedanke war rückwärts nachladen und voranstellen; Marcos Weg ist
einfacher und richtiger.

### Was sich ändert

Vorher hing die Liste am Endlos-Scroll: Seite 1, 2, 3 … angehängt. Wer auf Jahr
2005 springt, landet mitten im Bestand — und mit einer angehängten Liste gibt es
dort schlicht nichts, weder davor noch danach. Deshalb KONNTE die Leiste bisher
nur filtern.

Jetzt führt die Ansicht ALLE `total` Plätze und lädt die Seite, auf der ein
sichtbar gewordener Platz liegt — vorwärts, rückwärts und nach einem Sprung, mit
einer Seite Vorlauf in beide Richtungen. Was noch nicht da ist, steht als
Platzhalter.

* `CatalogUiState`: `loadedPages: Map<Int, List<CatalogSetItem>>` statt einer
  flachen Liste, dazu `loadingPages` und `scrollTo`. `loadingMore` ist entfallen
  — es gibt kein „mehr" mehr, nur noch „diese Seite".
* `ensureCatalogPage(seite)` überspringt Geladenes und gerade Ladendes; ohne das
  löste jeder Scroll-Schritt denselben Abruf mehrfach aus. Die Filter-Generation
  bleibt: Eine späte Seite des ALTEN Filters darf nicht in der neuen Liste
  landen.
* `jumpToCatalogYear(jahr)` fragt den Server (`GET
  /api/v1/catalog/year-offset`), lädt die Zielseite gleich mit — sonst stünden
  an der Sprungstelle für einen Moment nur Platzhalter — und setzt `scrollTo`.
* Der Platzhalter hat eine FESTE Höhe. Ohne die springt die Liste, sobald die
  Seite eintrifft, und ein Sprung an eine Jahresgrenze landet daneben.

### Die Leiste selbst

Kleines Etikett statt grosser Blase (Marcos Wunsch): heller Grund, eine Zeile,
direkt an der Leiste. Die Zahl der Sets steht nicht mehr dabei — sie war eine
Filter-Auskunft („so viele bekommst du"), und gefiltert wird hier nicht mehr.
`selectedYear` ist entfallen: Ein dauerhaft markiertes Jahr gibt es nicht, wenn
die Leiste nur springt. Der zugehörige String `catalog_scrubber_sets` ist
entfernt.

Der ausdrückliche Jahresfilter (Chip und Auswahlblatt) BLEIBT — Marco wollte die
Leiste anders, nicht das Filtern abschaffen.

### Test

`CatalogScrubberTest` hält die Regeln fest: Die Leiste ruft den Sprung und nicht
den Filter, die Liste zählt über `total`, geladen wird in beide Richtungen, der
Platzhalter hat eine feste Höhe, das Sprungziel rechnet der Server (mit
denselben Filtern), und eine Seite wird nicht mehrfach geladen. Kotlin ist im
Container nicht kompilierbar; die Prüfungen sind gegen die echten Dateien
nachgespielt, die Klammerbilanz gegen den Originalstand verglichen.

---

## Nachtrag 87 — Erfassen im Hintergrund, Zahlenfelder mit Zahlenpad

### 1. Ein fehlgeschlagenes Erfassen war UNSICHTBAR

Marcos Wunsch: „Wenn ein Set hinzugefügt wird, soll der Dialog direkt
geschlossen werden, damit das nächste Set direkt erfasst werden kann. Die
Erfassung soll dann im Hintergrund erfolgen. Sollte es beim Hinzufügen ein
Problem geben, soll eine Meldung angezeigt werden."

Der Dialog schloss schon vorher sofort, und der Abruf lief schon vorher
nebenläufig. Zwei Dinge fehlten:

* `isLoading` wurde für das Erfassen gesetzt und speist den
  Aktualisieren-Kringel der Galerie — die Oberfläche sah beschäftigt aus,
  während man schon die nächste Nummer tippen wollte. Weg damit; das Nachladen
  danach hat sein eigenes Flag.
* **Der Fehlerfall verschwand spurlos.** Er landete in `state.error`, und dieses
  Feld wird nur auf dem Anmeldebildschirm ausgewertet — in der Galerie nur dann,
  wenn die Liste LEER ist. Bei einer gefüllten Sammlung merkte man nichts. Genau
  der Fall, der durch das sofortige Schliessen häufiger wird: Man tippt weiter
  und stellt viel später fest, dass ein Set fehlt.

Jetzt kommt eine Meldung, und sie nennt die Setnummer — wer mehrere
hintereinander erfasst, muss wissen, WELCHES nicht durchkam.

### 2. Zahlenfelder: Zahlenpad und nur Ziffern

Neu `util/NumericInput.kt` — Tastaturwahl UND erlaubte Zeichen an einer Stelle.
Beides gehört zusammen: Die Tastaturwahl ist eine BITTE an die Tastatur-App,
keine Zusicherung (viele zeigen auf `Number` trotzdem eine Umschalttaste zu
Buchstaben, und aus der Zwischenablage kommt ohnehin alles herein). Ohne Filter
landete Text im Feld; ohne Tastaturwahl musste man auf dem Telefon jedes Mal
erst zu den Zahlen wechseln.

Angewandt auf alle Setnummern-, Mengen- und Preisfelder — sieben Dateien.
Sechs Felder hatten gar keine Tastaturwahl (Minifiguren, Teile-Dialoge,
Überwachung), der Rest hatte sie inline und wurde zusammengezogen. Die
handgeschriebenen Filter (`filter(Char::isDigit)` und die Preis-Variante) sind
verschwunden.

**Der Bindestrich bei der Setnummer bleibt erlaubt.** „Nur Zahlen" heisst hier:
keine BUCHSTABEN. LEGO-Setnummern tragen die Variante hinter dem Strich
(10179-2); verböte das Feld ihn, liesse sich jede Variante ausser der ersten gar
nicht mehr erfassen — die App ergänzt beim Erfassen nur „-1", wenn nichts
angegeben ist. Das Zahlenpad zeigt den Strich auf praktisch allen Tastaturen mit.

Beim Preis ist genau EIN Trennzeichen erlaubt (Punkt oder Komma). Ohne diese
Begrenzung wäre „12.3.4" tippbar und fiele erst beim Umwandeln auf — dann still
als Preis null.

### Tests

`NumericInputTest` prüft die Filterung mit ihren Randfällen UND die Regel, dass
kein Zahlenfeld ohne Tastaturwahl dasteht und keine Ansicht mehr selbst filtert.
Der Feld-Suchlauf ermittelt das Ende eines `OutlinedTextField(`-Aufrufs über die
Klammerbilanz statt über ein festes Zeichenfenster — die Falle, die in diesem
Projekt schon fünfmal zugeschlagen hat.

**Nebenbei aufgeräumt:** In zwei Testdateien standen aus früheren Nachträgen
escapte Anführungszeichen in KOMMENTAREN (`\"` in einem KDoc-Block). Für Kotlin
belanglos, aber sie verfälschten jede spätere Klammerbilanz-Prüfung — genau die
Prüfung, mit der ich hier ohne Compiler arbeite. Entfernt.

---

## Nachtrag 88 — Der Scanner-Dialog wartete auf den Server

Marcos Befund: „Der Dialog scheint zu warten, bis das Set komplett importiert
wurde (dauert meist 5-10 Sek)."

Er hat recht, und ich hatte im letzten Nachtrag die FALSCHE Stelle angesehen.
Der Galerie-Dialog schloss längst sofort — nachgesehen und bestätigt. Gewartet
hat der **Scanner-Dialog**: `confirmAddBarcode()` leerte `barcodeResult` erst
NACH der Antwort. Bis dahin stand der Dialog mit gesperrtem Knopf und Kringel
da.

Ausgerechnet dort stört es am meisten: Beim Scannen erfasst man mehrere Sets
hintereinander und will das nächste sofort einlesen. Wieder „dieselbe Regel
fehlt am zweiten Weg" — der eine Erfassungsweg schloss sofort, der andere nicht.

**Jetzt:** Der Dialog schliesst synchron, noch vor dem Start des Abrufs; die
Erfassung läuft im Hintergrund weiter.

### Was das für die Doppelklick-Sperre heisst

`barcodeAdding` kam aus einem früheren Bericht („da der Dialog träge reagiert,
wird oft 2x geklickt"). Ein Dialog, der sofort verschwindet, kann gar nicht mehr
zweimal getippt werden — die Sperre ist damit strenger, nicht schwächer. Sie
bleibt trotzdem stehen und wird weiterhin SYNCHRON vor dem Start gesetzt: Sie
schützt das Fenster zwischen Tipp und Rekomposition, das der frühere Bericht
beschreibt. Die vorhandenen Prüfungen dazu bleiben unverändert grün.

### Fehlermeldung

Der Fehlerfall meldete bisher `vm_error` — nur den Grund, ohne Setnummer. Bei
geschlossenem Dialog und mehreren gescannten Sets hintereinander sagt
„Fehler: Zeitüberschreitung" nicht, WELCHES fehlt. Jetzt dieselbe Meldung wie im
Galerie-Weg, mit Setnummer.

### Test

`BarcodeDoubleAddGuardTest` um zwei Teilschritte erweitert: Der Dialog schliesst
VOR dem `viewModelScope.launch`, und der Fehlschlag nennt die Setnummer. Die
vier bestehenden Prüfungen der Doppelklick-Sperre bleiben unangetastet.

---

## Nachtrag 89 — Übersetzungsfehler im Katalog-Graphen, und ein Ersatz für den Compiler

Marcos Meldung: `CatalogGraph.kt:80:66 Unresolved reference 'sets'`.

Beim Umbau auf das Fensterladen (Nachtrag 86) ist `CatalogUiState.sets`
entfallen — ersetzt durch `loadedPages` und `total`. Eine Stelle blieb zurück:
`CatalogGraph.kt` prüfte beim Betreten des Reiters weiter `catalogState.sets`.
Jetzt `catalogState.loadedPages.isEmpty()` — dieselbe Aussage („noch nichts
geladen"), mit dem Feld, das es gibt.

### Was daran wichtiger ist als die eine Zeile

Diesen Fehler hat Marco gefunden, nicht ich. Meine Behelfe ohne Compiler —
Klammerbilanz, Textsuche, Nachspielen der Testregeln — finden genau diese Sorte
nicht: Ein Feld verschwindet, und ein Aufrufer in einer ganz anderen Datei zeigt
weiter darauf.

Neu `UiStateFieldsTest`: Er sammelt die Felder JEDER `…UiState`-Datenklasse ein
und prüft jeden Zugriff der Form `xyzState.feld` dagegen — das, was der Compiler
hier täte.

Der Typ hinter einem Namen wird dabei JE DATEI bestimmt: In `CatalogScreen`
heisst der Parameter schlicht `state`, ist aber ein `CatalogUiState`. Ein Test,
der `state` überall für den App-Zustand hielte, meldete dort vierzig Fehlalarme
— und man gewöhnte sich an, ihn zu übergehen. Genau daran ist meine erste
Fassung der Prüfung gescheitert.

Gegenprobe: `catalogState.sets` wieder eingebaut → die Regel meldet
`CatalogGraph.kt:71  catalogState.sets in CatalogUiState`. Zurückgebaut →
sauber.

Ein zweiter Durchgang über alle `vm.…`-Zugriffe (Funktionen und Flows) fand
keine weitere Stelle, die ins Leere zeigt.

---

## Nachtrag 90 — Zweiter Übersetzungsfehler, und ein Prüfer, der ihn findet

Marcos Meldung: `CatalogFeature.kt:226 No parameter with name 'sets' found.`

`addCatalogSetToGallery()` setzte das „besitze ich"-Abzeichen sofort, ohne die
Liste neu zu holen — über `st.copy(sets = st.sets.map { … })`. Seit dem
Fensterladen (Nachtrag 86) gibt es `sets` nicht mehr; die Kacheln liegen in
`loadedPages` je Seite. Jetzt wird über alle geladenen Seiten gegangen, denn die
Kachel kann auf jeder stehen.

### Warum mein Prüfer aus Nachtrag 89 das nicht fand

Er band Namen an Zustandstypen über Deklarationen der Form `name: XxxUiState`.
Hier hiess der Zugriff aber `st` — der Parameter eines Lambdas in
`_catalogState.update { st -> … }`. Ein Muster über die ganze Datei half auch
nicht: Dasselbe `st` bedeutet ein paar Zeilen weiter einen ANDEREN Zustand.
Ein Prüfer, der das übergeht, meldet Fehlalarme, und dann gewöhnt man sich an,
ihn zu übergehen.

Der Test betrachtet jetzt jeden `update`-Block EINZELN: Der Lambda-Name gilt nur
innerhalb seiner geschweiften Klammern, die über die Klammerbilanz bestimmt
werden. Geprüft werden beide Formen, die der Compiler bemängelt — der
Lesezugriff `st.feld` und das benannte Argument `st.copy(feld = …)`.
Verschachtelte `copy()` bleiben aussen vor; sie gehören anderen Typen (etwa
einer Set-Kachel in der Liste).

Gegenprobe: `sets = st.sets.map(…)` wieder eingebaut → die Regel meldet BEIDE
Stellen, `copy(sets = …)` und `st.sets`. Zurückgebaut → sauber.

### Was das über die Prüfmethode sagt

Zwei Übersetzungsfehler in Folge, beide von Marco gefunden, beide aus demselben
Umbau: Ein Feld verschwindet, und ein Aufrufer anderswo zeigt weiter darauf.
Ohne Compiler ist jede Prüfung hier eine Näherung — sie wird mit jedem
gemeldeten Fehler genauer, aber sie ersetzt den Build nicht.

---

## Nachtrag 91 — Die Rollposition im Katalog überlebt die Detailseite

Marcos Befund: „Wenn in der Android-App im Katalog eine Detailseite aufgerufen
und wieder geschlossen wird, ist der Scrollbalken ganz zuoberst und nicht an der
Stelle von vor dem Aufruf."

### Warum das erst jetzt auffiel

Die Position lag im `LazyGridState` des Bildschirms. Die Detailseite ist ein
EIGENER Navigationspunkt — beim Wechsel verlässt die Liste die Komposition.

Normalerweise stellt Compose so etwas wieder her. Bei dieser Liste nicht mehr:
Seit dem Fensterladen (Nachtrag 86) treffen Länge (`total`) und Inhalt
(`loadedPages`) erst NACH dem Aufbau ein. Im Moment der Wiederherstellung gibt
es noch keine Plätze — und damit keine Stelle, an die gesprungen werden könnte.
Was danach kommt, beginnt oben.

Vor dem Umbau war die Liste beim Wiederaufbau sofort gefüllt, deshalb trat es
vorher nicht auf.

### Jetzt

Die Position liegt im ZUSTAND (`scrollIndex`, `scrollOffset`) — der lebt im
ViewModel und überlebt jeden Wechsel des Bildschirms. Die Ansicht meldet sie
laufend und springt beim Betreten EINMAL zurück, sobald die Länge da ist.

Beim Filterwechsel wird sie zurückgesetzt: Die alte Position zeigte sonst auf
Sets, die es in der neuen Liste nicht mehr gibt.

### Test

`CatalogScrubberTest` um einen Teilschritt erweitert: Zustandsfelder vorhanden,
Position wird gemeldet, Wiederherstellung hängt an `state.total` (vorher gäbe es
keine Stelle), ein Merker verhindert wiederholtes Springen, und der Filterwechsel
setzt zurück.

Geprüft habe ich ausserdem mit den beiden Behelfen aus Nachtrag 89/90 — kein
Zugriff auf ein Zustandsfeld, das es nicht gibt, und Signatur von
`CatalogScreen` gegen die Übergaben in `CatalogGraph` abgeglichen (keine
Abweichung in beide Richtungen).

---

## Nachtrag 92 — Der Scrollbalken sprang nach der Detailseite nach oben

Marcos Bericht: „In der Android-App springt der Scrollbalken immer ganz nach
oben, wenn man die Detailseite eines Sets öffnet und wieder schliesst. Der
Scrollbalken sollte aber an der Position verbleiben, wo er vorher war."

Die Detailansicht ist ein eigenes Navigationsziel. Beim Wechsel verlässt die
Galerie die Komposition, und das `rememberLazyGridState()` INNERHALB von
`GalleryScreen` beginnt bei der Rückkehr wieder bei null.

### Warum das ein Familienfehler war

Für die **Finanz-Liste** war es längst gelöst: `financeListState` liegt oberhalb
des NavHost und wird durchgereicht — mit einer Begründung im Code, die genau
diesen Fall beschreibt. Der **Katalog** hat es auf einem eigenen Weg gelöst: Er
meldet die Position laufend ins ViewModel und springt einmal zurück, sobald die
Liste ihre Länge hat.

Galerie, Teile und Minifiguren führen genauso in eine Detailansicht, hatten aber
weder das eine noch das andere. Bei den Minifiguren gab es nicht einmal einen
benannten Zustand — `LazyVerticalGrid` legte sich intern selbst einen an, mit
demselben Ergebnis.

Wieder das Muster dieses Projekts: eine Regel fehlt am zweiten Weg. Repariert
sind deshalb alle drei, nicht nur die gemeldete Galerie.

### Der Katalog bleibt bei seinem Weg

Bewusste Abweichung, kein Versehen. Seine Liste führt ALLE `total` Plätze und
lädt seitenweise nach; im Moment der Rückkehr sind noch keine Plätze da, ein
Zustand allein hätte also keine Stelle, an die er springen könnte. Der Test hält
die Abweichung fest, damit sie nicht später aus Gleichmacherei „aufgeräumt" wird.

### Tests

Neu `ListScrollPositionTest` mit vier Prüfungen: keine Liste legt ihren Zustand
selbst an; das Raster benutzt den übergebenen auch (bei den Minifiguren wäre ein
Parameter, der nirgends ankommt, schlimmer als keiner); die Zustände liegen
oberhalb des NavHost und werden durchgereicht; der Katalog behält seinen Weg.
Neuer Abschnitt in `INVARIANTEN.md`.

Drei Gegenproben nachgespielt (Galerie legt den Zustand wieder selbst an;
Übergabe in CollectionGraph gestrichen; `state` am Minifiguren-Raster entfernt)
— jede macht genau ihren Teilschritt rot.

HINWEIS: Kotlin lässt sich in meiner Umgebung nicht kompilieren (kein
Android-SDK). Geprüft wurden deshalb Klammer- und Kommentarbilanz aller
geänderten Dateien sowie die Testprüfungen selbst, nachgespielt in Python. Die
Änderungen folgen dem im Projekt vorhandenen Muster (`financeListState`) statt
neu erfundener Syntax. Ein `./gradlew testDebugUnitTest` steht noch aus.

---

## Nachtrag 93 — Der Katalog sprang doch nicht zurück (und mein Test deckte es)

Marcos Bericht: „Der Fehler wurde im Katalog festgestellt. Auch dort soll der
Scrollbalken die Position beibehalten, an der er war."

In Nachtrag 92 hatte ich den Katalog als bereits gelöst eingestuft und ihn
ausdrücklich von der Reparatur ausgenommen. Die Mechanik war da — sie war nur
gleich doppelt entwaffnet.

### Fehler 1: Der Merker überlebte, was er nicht überleben durfte

```kotlin
var wiederhergestellt by rememberSaveable { mutableStateOf(false) }
```

`rememberSaveable` überlebt den Ausflug in die Detailseite — genau das, was
dieser Merker nicht soll. Beim allerersten Betreten sprang der Katalog also
zurück (nirgendwohin, die Position war ja null), setzte den Merker, und ab da
war die Wiederherstellung **für immer** abgeschaltet. Jetzt `remember`: gilt je
Komposition, und nach der Rückkehr ist es eine neue.

### Fehler 2: Der Melder löschte, was er melden sollte

Die Meldung der Rollposition lief sofort los. Bei der Rückkehr steht der frische
`LazyGridState` auf null, und `snapshotFlow` gibt diesen Wert unverzüglich
heraus — die gemerkte Position war damit überschrieben, bevor sie jemand lesen
konnte. Der Melder wartet jetzt, bis zurückgesprungen wurde.

Jeder der beiden Fehler allein hätte gereicht. Die eigentliche Regel ist die
REIHENFOLGE: erst springen, dann melden. Deshalb steht `wiederhergestellt = true`
jetzt NACH dem `scrollToItem` (das unterbricht) und der Melder hängt an ihm.

### Was mein Test aus Nachtrag 92 falsch gemacht hat

Er prüfte, dass `onScrollPos` und `scrollToItem` im Katalog VORKOMMEN. Beides
tat es, und die Mechanik war trotzdem tot. Damit hat der Test den Fehler
festgeschrieben statt ihn zu finden — dieselbe Sorte Prüfung, die in dieser
Reihe schon einmal eine Sicherheitslücke konserviert hat. Anwesenheit von
Bauteilen ist keine Aussage über die Regel.

Die Prüfung verlangt jetzt: kein `rememberSaveable` am Merker, ein Melder, der
am Merker hängt, und `scrollToItem` VOR dem Setzen des Merkers.

### Gegenproben

Vier nachgespielt, alle rot: der alte Zustand wortgetreu wiederhergestellt (fünf
Prüfungen rot); nur der Merker wieder `rememberSaveable`; nur der Melder wieder
ungebremst; Merker vor dem Sprung. Die entscheidende ist die erste — sie zeigt,
dass die neue Fassung des Tests den gemeldeten Fehler gefunden hätte.

`CatalogScrubberTest` bleibt unverändert grün (nachgeprüft): Seine sechs
Aussagen betreffen den Zustand, die Meldung und das Zurücksetzen beim
Filterwechsel — alles unangetastet.

HINWEIS: weiterhin ohne Android-SDK, also nicht kompiliert. Geprüft wurden
Klammer- und Kommentarbilanz sowie alle Testprüfungen, nachgespielt in Python.
Der ungenutzt gewordene Import von `rememberSaveable` ist entfernt.

---

## Nachtrag 94 — Alle Reiter, einmal durchgezählt

Marcos Bericht: „Der Scrollbalken soll bei allen Reitern an der Position
verbleiben, wenn man eine Detailseite aufruft."

Das ist die dritte Meldung zum selben Fehler — Galerie (92), Katalog (93), jetzt
„alle". Jedes Mal hatte ich genau das repariert, was gemeldet war, statt die
sieben Reiter einmal durchzuzählen. Das ist hier nachgeholt.

### Der letzte offene Reiter: die Teileliste

`PartsListScreen` hatte für seine `LazyColumn` gar keinen benannten Zustand.
Auslöser ist dort keine Detailseite, sondern der **Barcode-Scanner** — der
führt genauso aus dem Bildschirm heraus.

Besonders ärgerlich: Dass dieser Bildschirm beim Scannen verlassen wird, war
seit Nachtrag 64 bekannt und im Code dokumentiert. Damals verschwanden an
derselben Stelle die gesammelten Sets, und `sets` wurde deshalb auf
`rememberSaveable` umgestellt. Die Rollposition hatte nur niemand nachgezogen.

Jetzt `partsListState`, oberhalb des NavHost, wie bei den Finanzen.

### Die übrigen beiden Reiter

- **Vergleich** ist ein Platzhalter ohne Rollbereich — nichts zu bewahren. Der
  Test prüft mit, dass das so bleibt: Bekommt der Bildschirm einen `LazyColumn`,
  `LazyVerticalGrid` oder `verticalScroll`, wird er rot.
- **Katalog** bleibt bei seinem ViewModel-Weg (Nachtrag 93).

Geprüft und NICHT geändert: Die **Einstellungen** haben zwar einen
`verticalScroll`, navigieren aber nirgendwohin ausser zum Abmelden — sie werden
nicht verlassen und wieder betreten. Die **Detailseiten** selbst (Set, manueller
Eintrag) rollen ebenfalls und führen weiter zu Erfassungen und PDF-Ansicht;
dort wäre ein hochgezogener Zustand aber falsch, weil er zwischen
verschiedenen Sets geteilt würde — Set B startete an der Rollposition von Set A.
Das bräuchte einen Zustand JE Setnummer und ist bewusst nicht Teil dieses
Nachtrags.

### Tests

`ListScrollPositionTest` um zwei Prüfungen erweitert: die Listen-Reiter
(Finanzen, Teileliste) bekommen ihren Zustand von aussen; und — die wichtigere —
**jeder Reiter mit Rollbereich ist abgedeckt**. Diese zählt die sieben Reiter
und zwingt jeden neuen in eine der beiden Gruppen. Sie ist die Antwort auf
„dreimal dieselbe Meldung": Die Lücke soll künftig auffallen, bevor Marco sie
findet.

Drei Gegenproben nachgespielt: Teileliste in ihre Ausgangslage zurückgesetzt
(zwei Prüfungen rot); Übergabe im ToolsGraph gestrichen; ein achter Reiter
angenommen (Vollständigkeitsprüfung rot).

HINWEIS: weiterhin ohne Android-SDK, also nicht kompiliert. Geprüft sind
Klammer- und Kommentarbilanz aller geänderten Dateien sowie sämtliche
Testprüfungen, nachgespielt.

---

## Nachtrag 95 — Zwei verschiedene Fehler unter einem Symptom

Marcos Bericht: „Weder in der Galerie noch im Katalog verbleibt die Position der
Liste dort, wo sie beim Aufruf war. In der Galerie ist sie verschoben, und im
Katalog ist sie auf der korrekten Zeile, aber die Scrollbar zeigt an, dass man
sich zuoberst befindet."

Zwei sehr genaue Beobachtungen — und sie beschreiben zwei völlig verschiedene
Fehler. Ohne diese Genauigkeit hätte ich wieder am falschen Ende gesucht.

### Katalog: die Liste war richtig, der Daumen nicht

„Auf der korrekten Zeile" heisst: Die Wiederherstellung aus Nachtrag 93 tut, was
sie soll. Was oben stand, war der Daumen der Jahresleiste.

Er folgte der Liste NIE. `previewYear` startet auf `yearMax`, und
`thumbOffset(yearMax)` ist rechnerisch genau null — der obere Anschlag. Bewegt
wurde er ausschliesslich durchs eigene Ziehen. Auch beim Rollen mit dem Finger
blieb er stehen; aufgefallen ist es erst nach der Detailseite, weil dort die
Komposition neu beginnt und ein vorher gezogenes Jahr verlorengeht.

Jetzt zeigt er beim Ziehen, WOHIN es geht, und sonst, WO man ist — abgeleitet
aus dem Jahr der obersten sichtbaren Kachel. Nur bei Sortierung nach Jahr: Steht
die Liste nach Name oder Nummer, springt das Jahr der obersten Kachel umher, und
ein zappelnder Daumen ist schlechter als ein stillstehender.

FALLE dabei: `state` ist in `CatalogScreen` ein PARAMETER, kein beobachteter
Wert. Ein `remember { derivedStateOf { … state … } }` hätte den Stand
eingefroren, den es beim Anlegen sah — und `loadedPages` füllt sich erst danach.
Deshalb `rememberUpdatedState(state)`.

### Galerie: der hochgezogene Zustand reicht nicht

„Verschoben" — nicht oben, aber auch nicht dort, wo sie war. Das Objekt aus
Nachtrag 92 überlebt den Ausflug also; das Raster misst beim Wiederanhängen nur
nicht dieselbe Stelle heraus.

Was nachweislich richtig landet, ist der Weg des Katalogs: mitschreiben und beim
Betreten ausdrücklich `scrollToItem(index, offset)` rufen. Marco im selben
Bericht: „im Katalog ist sie auf der korrekten Zeile."

Neu `ui/ScrollMemory.kt`: der Weg des Katalogs, EINMAL umgesetzt statt dreimal
unterschiedlich abgeschrieben — mit beiden Fallen aus Nachtrag 93 fest
eingebaut (Merker als `remember`, Melder erst nach dem Sprung). Benutzt von
Galerie, Teile, Minifiguren und Finanzen; der Katalog behält seine eigene
Fassung, weil sie an `state.total` hängt.

Die Position liegt in einer schlichten Karte im ViewModel, bewusst NICHT in
einem StateFlow: Sie ändert sich bei jeder Rollbewegung. Genau das tut die
Katalog-Fassung heute — jede Rollbewegung setzt dort den ganzen Bildschirm neu
zusammen. Beobachtet, nicht geändert; es gehört nicht in diesen Nachtrag.

Bei einem Filterwechsel (Suchtext, Thema, Sortierung) wird die gemerkte Stelle
verworfen — sie zeigt sonst auf Sets, die in der neuen Liste woanders oder gar
nicht stehen.

### Was NICHT geändert wurde

Die hochgezogenen Zustände aus 92/94 bleiben: Der Helfer braucht eine stabile
Objektreferenz. Die **Teileliste** bekommt keinen Keeper — ihre Daten liegen im
Bildschirm selbst, nicht im ViewModel; dort gibt es kein „bereit", auf das
gewartet werden könnte. Sollte sie auffallen, wandern ihre Sets ins ViewModel.

### Tests

`ListScrollPositionTest` um zwei Prüfungen erweitert: jeder Reiter stellt seine
Position ausdrücklich wieder her (samt der drei Reihenfolge-Regeln im Helfer und
dem Verwerfen beim Filterwechsel), und der Daumen der Jahresleiste folgt der
Liste.

Vier Gegenproben nachgespielt: Daumen wieder nur beim Ziehen; eingefrorener
Stand statt `rememberUpdatedState`; Keeper der Galerie entfernt; Melder im
Helfer ungebremst.

HINWEIS: weiterhin ohne Android-SDK, also nicht kompiliert. Klammer- und
Kommentarbilanz diesmal mit einem Scanner geprüft, der String- und Rohliterale
erkennt — die naive Zählung meldete falschen Alarm für ein `\{` in einem Regex.

---

## Nachtrag 96 — Reiter-Bildschirme lesen selbst (Punkt 5 des Aufräumens)

Aus Marcos Auftrag „Kannst du die Punkte umsetzen?". Gemessen war Punkt 5: vier
Bildschirme mit 15 bis 26 Parametern, während `ManualItemDetailScreen` und
`AcquisitionManagementScreen` längst `vm` nehmen und selbst lesen.

| Bildschirm | vorher | nachher |
|---|---|---|
| GalleryScreen | 26 | **5** |
| FinanceScreen | 21 | **5** |
| PartsScreen | 20 | **4** |
| MinifigsScreen | 15 | **4** |

Die breiten Signaturen waren der Grund, warum jede Erweiterung drei Dateien
anfasste — Screen, Graph, ViewModel. Beim Kontofilter und beim Scroll-Zustand
(Nachträge 92 bis 95) war das jedes Mal spürbar; der Aufruf von `GalleryScreen`
im Graphen schrumpft von 27 Zeilen auf sechs.

Navigations-Rückrufe bleiben Parameter: Nur der Graph kennt den NavController.

### Wie ohne Compiler abgesichert

Kotlin lässt sich hier nicht übersetzen (kein Android-SDK). Deshalb wurde
ausschliesslich der KOPF getauscht — die Werte behalten ihre alten Namen und
werden als lokale `val` neu gebunden. Der Rumpf darunter blieb Zeile für Zeile
unverändert; ein Tippfehler kann sich nicht durch fünfhundert Zeilen ziehen.

Der verbleibende Fehler wäre ein Zustandszugriff ins Leere (`state.gibtEsNicht`)
— genau das, was ein Compiler fängt. Neu `ScreenViewModelWiringTest` prüft
deshalb JEDEN `state.`/`partsState.`/`financeState.`-Zugriff gegen die
Datenklassen in `UiState.kt`. Alle Feldnamen wurden vor dem Umbau einzeln
verifiziert.

Drei Gegenproben nachgespielt: Zustandszugriff ins Leere (`partsStatsX`) → rot;
zurück zur breiten Signatur → rot; Screen greift selbst auf den NavController
zu → rot.

Klammer- und Kommentarbilanz aller sechs geänderten Dateien mit einem Scanner
geprüft, der String- und Rohliterale erkennt. Die Prüfungen aus Nachtrag 95
(Scroll-Position) bleiben grün.

HINWEIS: `./gradlew testDebugUnitTest` steht weiterhin aus.

---

## Nachtrag 97 — Der Barcode-Dialog raus aus dem Navigationsaufbau

Aus der zweiten Messung auf Marcos Frage „Gibt es auch Punkte in der
Android-App?". Von drei gemessenen Punkten der klarste — die anderen beiden
(MonitoringScreen, Screen-Rümpfe) waren Geschmack ohne Anlass.

`BrickInventoryManagerApp()` in AppNavigation.kt war **277 Zeilen**, der
längste Composable der App. Davon waren rund fünfzehn der eigentliche NavHost;
den grössten Block machte ein AlertDialog aus, der nach einem Barcode-Scan
Menge, Kaufpreis, Zustand und Eigentümer erfasst.

Dasselbe Muster wie im Webfrontend, wo Kaufpreis- und Detailfenster in
js/07-admin.js lagen (hardened-222): Ein Dialog liegt dort, wo er AUFGERUFEN
wird, statt wo er hingehört. Wer an der Navigation etwas ändern wollte, las
erst an einem Erfassungsformular vorbei.

| | vorher | nachher |
|---|---|---|
| `AppNavigation.kt` | 328 | **151** |
| `ui/dialogs/BarcodeResultDialog.kt` | — | 254 |

Der Dialog liest seinen Zustand selbst vom ViewModel — dieselbe Bauart wie die
Reiter-Bildschirme seit Nachtrag 96. Die BEDINGUNG bleibt beim Aufrufer, damit
an genau einer Stelle steht, wann der Dialog erscheint.

### Tote Importe — und ein Eigentor beim Aufräumen

Nach dem Umzug waren 29 Einzelimporte in AppNavigation.kt unbenutzt. Beim
Entfernen habe ich zuerst gegen die ganze Datei geprüft, inklusive
Importzeilen — dadurch galten Namen als „benutzt", weil sie in ihrem eigenen
Import vorkamen, und mein zweiter Anlauf entfernte prompt zu viel
(`Composable`, `NavHost`, `Text`). Aufgefallen ist es, weil ich danach jeden
Namen gegen den kommentar- und stringfreien Rumpf gegengeprüft habe.

Die Wildcard-Importe (`androidx.compose.material3.*` und sechs weitere) machen
die Prüfung tückisch: Sie decken die Mehrzahl aller Namen ab, also darf man nur
die EINZELimporte gegen den Rumpf halten. Beide Dateien sind so gegengeprüft:
kein benötigter Einzelimport fehlt.

### Tests

Neu `NavigationHostSizeTest` mit drei Prüfungen: kein Dialog im
Navigationsaufbau (aber der Aufruf samt Bedingung schon), die Datei bleibt unter
260 Zeilen, und der Dialog liest seinen Zustand selbst.

Drei Gegenproben nachgespielt: Dialog zurück in AppNavigation → rot; Bedingung
wandert mit → rot; Dialog bekommt Parameter statt ViewModel → rot. Die
Prüfungen aus den Nachträgen 95 und 96 bleiben grün.

HINWEIS: weiterhin ohne Android-SDK, also nicht kompiliert. `./gradlew
testDebugUnitTest` steht aus.

---

## Nachtrag 98 — Die grossen Bildschirme in Abschnitte geteilt

Marcos Auftrag: alle gemessenen Punkte umsetzen, dazu Monitoring und Katalog.

### Ein Messfehler vorweg

Meine bisherigen Angaben zu Funktionslängen waren teilweise falsch. Der Zähler
brach bei MEHRZEILIGEN Signaturen ab — also bei fast allen Compose-Funktionen.
`SetDetailScreen` wurde als „2 Zeilen" gemeldet. Meine frühere Aussage „die
längste Funktion hat 185 Zeilen" stimmte nicht.

Mit korrekter Messung:

| | vorher | nachher |
|---|---|---|
| `SetDetailScreen` | **526** | 169 |
| `FinanceScreen` | **482** | 132 |
| `CatalogScreen` | 339 | 218 |
| `MonitoringScreen.kt` (Datei) | 679 | 368 |

### Was entstanden ist

`SetDetailSections.kt` (6 Abschnitte), `FinanceSections.kt` (6),
`CatalogSections.kt` (4), `MonitoringSections.kt` (4 ganze Composables).

Die Listenabschnitte sind `fun LazyListScope.x(…)` und KEINE @Composable: Sie
tragen `item { … }` in eine LazyColumn ein. Beim Katalog sind es normale
Composables, weil dort eine `Column` steht.

Bei Monitoring wurden GANZE FUNKTIONEN verschoben statt Rümpfe zerschnitten —
der risikoärmere Eingriff, dafür bleibt `CacheAndLimitsSection` 185 Zeilen lang.
Sie weiter zu zerlegen hiesse, ein halbes Dutzend `var by remember` in
MutableState-Parameter zu verwandeln; ohne Compiler die fehleranfälligste Sorte
Änderung bei geringem Gewinn.

### Drei Zustände mussten zu MutableState werden

`detailRetryState`, `activeCategory` und die drei Katalog-Blätter werden von
den ausgelagerten Abschnitten GESETZT. Als Wert übergeben wären sie Kopien.

### MEINE FEHLER — und wie sie aufgefallen sind

**Ein Schnitt lief mitten durch ein `if`.** Bei `financeSetRows` begann mein
Bereich eine Zeile nach `if (showSets) {`. Die öffnende Klammer blieb in
`financeCategoryFilter` zurück, die schliessende wanderte mit. Beide Funktionen
waren unausgeglichen.

**Die schliessende Klammer der LazyColumn wanderte mit** — bei SetDetail und
bei Finance, jeweils im letzten Abschnitt.

Gefunden hat beides die Klammerbilanz je Funktion. Als Gegenprobe habe ich
danach jede Codezeile der neuen Dateien gegen das Original gezählt: Bei
Monitoring stimmt sie exakt (595 zu 595), bei den übrigen sind alle Abweichungen
erklärbar (`.value`-Umstellung, Funktionsköpfe, Aufrufe).

**Und der Test selbst brauchte zwei Anläufe.** Erst mass er die DATEI statt der
Funktion — `CatalogScreen.kt` hält legitim fünf weitere Composables. Dann zählte
er Klammern und verzählte sich an denen in Zeichenketten. Jetzt: Eine Funktion
endet auf einer schliessenden Klammer in SPALTE 0.

### Tests

Neu `ScreenSectionSplitTest` mit vier Prüfungen: jede Abschnittsdatei
existiert, die Bildschirm-Composables bleiben unter 300 Zeilen, Listenabschnitte
sind LazyListScope-Erweiterungen, veränderlicher Zustand kommt als MutableState.

Vier Gegenproben nachgespielt: Listenabschnitt wieder @Composable → rot;
activeCategory wieder per `by` → rot; 200 Zeilen zurück in den Screen → rot.
Die Prüfungen aus 95, 96 und 97 bleiben grün.

### Nicht angefasst

`CameraPreviewBarcode` (289 Z.) — dort hängt viel an Lebenszyklus-Feinheiten der
Kamera. `collectionGraph`/`toolsGraph` (210/178) — repetitiv, aber jede Zeile
steht aus nachvollziehbarem Grund.

### Klammerbilanz

Alle 112 Kotlin-Dateien geprüft. Drei sind unausgeglichen, alle drei von mir
UNVERÄNDERT (Klammern in Regex-Zeichenketten): SixteenKbAlignmentTest,
CameraXUpgradeTest, ImageUrls.kt.

HINWEIS: weiterhin ohne Android-SDK. Dies ist der grösste Eingriff der Reihe —
`./gradlew testDebugUnitTest` vor dem Installieren ist hier nicht optional.

---

## Nachtrag 99 — Die Bildanalyse getrennt von der Kamera-Vorschau

`CameraPreviewBarcode()` war 289 Zeilen — der letzte offene Punkt aus der
Android-Messung. Sie tat zwei völlig verschiedene Dinge: eine
ImageAnalysis-Schleife aufbauen (Barcode-Leser, Texterkennung,
Bestätigungszählung, OCR-Drosselung, Aufräumen) und daneben die Kamera-Vorschau
als AndroidView einbetten.

Nur das erste ist Bildverarbeitung; das zweite ist Einbettung von
Android-Views. Wer an der Erkennung etwas ändert, hat mit PreviewView,
Lebenszyklus und Fokus-Gesten nichts zu tun — und umgekehrt.

| | vorher | nachher |
|---|---|---|
| `CameraPreviewBarcode` | **289** | 137 |
| `BarcodeAnalyzer.kt` | — | 229 |

Mit hereingekommen sind die Zählerstände (`lastValue`, `confirmCount`), die
OCR-Drosselung und die beiden ML-Kit-Clients: Sie wurden im Bildschirm
gehalten, aber AUSSCHLIESSLICH in dieser Schleife benutzt. Das Aufräumen
(DisposableEffect) ebenfalls — es räumt genau diese Objekte weg.

### MEIN FEHLER

`_kameraCtrl` ist zuerst mitgewandert. Die Referenz gehört zur VORSCHAU: Der
Tipp-zum-Scharfstellen-Listener wird im factory-Block gesetzt, die
Kamerasteuerung existiert aber erst nach dem Binden. In der Analyse hätte sie
nichts zu füllen gehabt. Gefunden beim Durchsehen der verbliebenen Verweise;
die Prüfung hält es jetzt fest.

### Abgleich

Zeilenweise gegen das Original gezählt: **keine einzige Codezeile verloren**
(294 im Original, 311 neu — die 17 Zusätze sind Signatur und Aufruf). Klammer-
und Kommentarbilanz beider Dateien ausgeglichen; 33 unbenutzte Importe entfernt.

### Tests

`ScreenSectionSplitTest` um „die Bildanalyse steht getrennt von der
Kamera-Vorschau" erweitert: Analyse eigenständig, Bildschirm ruft sie auf, keine
Vorschau in der Analyse, kein Leser-Aufbau im Bildschirm, Kamerasteuerung im
Bildschirm und NICHT in der Analyse, und CameraPreviewBarcode unter 200 Zeilen.

Drei Gegenproben nachgespielt: Kamerasteuerung in die Analyse (mein echter
Fehler) → rot; Bildschirm baut wieder einen Leser → rot; Analyse zurück in den
Bildschirm → rot. Die Prüfungen aus 95 bis 98 bleiben grün.

Damit ist von den gemessenen Android-Punkten nur noch
`collectionGraph`/`toolsGraph` offen — repetitiv, aber jede Zeile mit
nachvollziehbarem Grund.

HINWEIS: weiterhin ohne Android-SDK, nicht kompiliert.

---

## Nachtrag 100 — Unresolved reference 'ArrowDropDown'

Marcos Build nach Nachtrag 98:

    CatalogSections.kt:55:53 Unresolved reference 'ArrowDropDown'.

### Was schiefging — und warum es meine Prüfung nicht sah

Beim Aufteilen habe ich die Importe der neuen Dateien gegen die Quelldatei
geprüft. Der Prüfer sammelte dabei nur die EINZELimporte. Namen, die im Original
per `androidx.compose.material.icons.filled.*` gedeckt waren, tauchten in dieser
Liste gar nicht auf — sie konnten also gar nicht als fehlend gemeldet werden.

Die Bildschirmdateien nutzen Wildcards reichlich: CatalogScreen fünf,
BarcodeScannerScreen sechs. Der Fehler war damit nicht die Ausnahme, sondern zu
erwarten.

### Die Behebung ist nicht „diesen Namen nachtragen"

Sondern: **Eine herausgelöste Datei erbt die Wildcards ihrer Quelle.** Damit
entfällt das Raten Name für Name.

| Datei | ergänzt |
|---|---|
| SetDetailSections.kt | `material.icons.filled.*` |
| FinanceSections.kt | `material.icons.filled.*` |
| CatalogSections.kt | `foundation.lazy.grid.*`, `material.icons.filled.*` |

Dazu sieben Einzelimporte für Icons, die vorher nirgends gedeckt waren
(ArrowDropDown, Check, Clear, PictureAsPdf, Remove, Add, ViewModule).

### Ein zweiter Fehler im Prüfwerkzeug

Mein erster Durchlauf meldete 72 Fehler quer durch den Baum — auch in Dateien,
die ich nie angefasst habe und die seit jeher bauen. Ursache: Der Ausdruck für
Importzeilen (`[\w.]+`) erfasst das `*` am Ende nicht, also galten alle
Wildcards als nicht vorhanden. Mit `[\w.*]+` blieben acht Fehler — alle in
meinen zwei neuen Dateien.

Das ist dieselbe Lehre wie beim Klammerzähler in Nachtrag 98: Ein Prüfwerkzeug,
das man nicht selbst gegenprüft, meldet Zahlen, die niemandem helfen.

### Tests

Neu `SplitFileImportsTest` mit zwei Prüfungen: Jede aufgeteilte Datei erbt die
Wildcards ihrer Quelle, und jeder `Icons.X.Y`-Verweis im GANZEN Baum ist gedeckt
(einzeln oder per Wildcard).

Gegenprobe: Marcos Fehler wiederhergestellt (beide Importe aus CatalogSections
entfernt) → beide Prüfungen rot. Die Prüfungen aus 95 bis 99 bleiben grün,
Klammerbilanz unverändert.

HINWEIS: weiterhin ohne Android-SDK. Diese Prüfung ersetzt den Compiler nicht —
sie fängt nur die eine Fehlerklasse, die er hier gefunden hat.

---

## Nachtrag 101 — Cannot access: it is private in file

Marcos Build nach Nachtrag 100:

    CatalogSections.kt:79:36 Cannot access 'fun sortLabel(sort: String): String':
    it is private in file.

### Eine Fehlerklasse, die keine Import-Prüfung sehen kann

`private` gilt in Kotlin DATEIWEIT. Ein Block, der beim Aufteilen in eine andere
Datei wandert, verliert den Zugriff auf alle privaten Nachbarn seiner Quelle —
ohne dass sich an Namen oder Importen irgendetwas ändert. Meine Prüfungen aus
Nachtrag 100 sind deshalb grün geblieben: Sie prüfen Importe, das hier ist eine
reine Sichtbarkeitsfrage.

### Drei Fälle, einer in der Gegenrichtung

| Deklaration | in | gerufen von |
|---|---|---|
| `ThemeRow` | CatalogScreen.kt | CatalogSections.kt |
| `sortLabel` | CatalogScreen.kt | CatalogSections.kt |
| `BricksetQueueRow` | MonitoringSections.kt | MonitoringScreen.kt |

Der dritte geht rückwärts: Beim Verschieben ganzer Composables nach
MonitoringSections.kt blieb der Aufrufer zurück.

Alle drei sind jetzt `internal` — sichtbar im Modul, weiterhin nicht Teil einer
öffentlichen Schnittstelle. Das ist die kleinste Änderung, die die Absicht
erhält.

### Neue Prüfung

`SplitFileImportsTest` um „keine Datei ruft eine private Deklaration einer
anderen" erweitert. Sie sammelt alle `private`-Deklarationen auf oberster Ebene
und sucht ihre Namen in ALLEN übrigen Dateien — nicht nur in den aufgeteilten
Paaren, damit auch künftige Verschiebungen erfasst sind.

Gegenprobe: `sortLabel` wieder auf `private` → rot.

### Und wieder ein Fehler im Prüfwerkzeug

Mein Klammerzähler meldete den neuen Test als unausgeglichen. Ursache: Er kannte
Kotlin-ZEICHENliterale nicht, und der Test enthält `'{'` und `'}'` als Zeichen.
Nach dem Ergänzen: ausgeglichen.

Das ist der dritte Werkzeugfehler dieser Reihe (Klammern in Zeichenketten,
Wildcards ohne `*`, jetzt Zeichenliterale). Sie haben eines gemeinsam: Das
Werkzeug meldete etwas, das ich zuerst für einen Befund am Code hielt.

HINWEIS: weiterhin ohne Android-SDK.

---

## Nachtrag 102 — This material API is experimental

Marcos Build nach Nachtrag 101:

    CatalogSections.kt:125:9 This material API is experimental and is likely to
    change or to be removed in the future.

`@OptIn` steht in Kotlin an der DEKLARATION (oder mit `@file:` an der Datei).
Beim Aufteilen trug die Quellfunktion `CatalogScreen()` die Annotation — die
beiden herausgelösten Auswahlblätter erben sie nicht. `ModalBottomSheet` ist in
Material3 weiterhin experimentell.

`CatalogYearSheet` und `CatalogThemeSheet` haben jetzt je ein
`@OptIn(ExperimentalMaterial3Api::class)`.

### Der Rest des Baums

Fünf weitere aufgeteilte Dateien haben KEIN Opt-in, obwohl ihre Quellen eines
tragen. Nachgesehen: Keine von ihnen ruft eine experimentelle API — die
Annotationen der Quellen gehören zu Funktionen, die dort geblieben sind. Nur
CatalogSections war betroffen.

### Die dritte Sache, die eine Aufteilung mitnehmen muss

Damit sind es drei, und keine davon sieht eine Import-Prüfung:

1. die **Wildcards** der Quelldatei (Nachtrag 100)
2. die **Sichtbarkeit** — `private` gilt dateiweit (Nachtrag 101)
3. die **Opt-ins** (dieser Nachtrag)

`SplitFileImportsTest` prüft jetzt alle drei. Die Opt-in-Prüfung geht über den
GANZEN Baum, nicht nur über die aufgeteilten Paare: Auch ein neu geschriebenes
Composable kann die Annotation vergessen.

Gegenprobe: Opt-in an CatalogYearSheet entfernt → rot.

HINWEIS: Die Liste der experimentellen APIs im Test ist eine Auswahl der
gebräuchlichen, keine vollständige. Sie ersetzt den Compiler nicht — sie fängt
die Fälle, die beim Aufteilen tatsächlich vorkommen.

---

## Nachtrag 103 — Unresolved reference 'setScope'

Marcos Build nach Nachtrag 102:

    FinanceScreen.kt:64:48 Unresolved reference 'setScope'.

`setScope` ist `internal fun MainViewModel.setScope(…)` im Paket
`ch.brickinventoryapp.ui` (HouseholdFeature.kt). Die Screens liegen in
`ch.brickinventoryapp.ui.SCREENS` — ein anderes Paket.

`import ch.brickinventoryapp.ui.MainViewModel` holt NUR die Klasse, nicht ihre
Erweiterungen. Dafür braucht es `import ch.brickinventoryapp.ui.*`, wie
SetDetailScreen.kt es seit jeher trägt — samt Kommentar
„// Feature-Extensions (loadSetDetail, updateQuantity, …)".

### Es waren 23 Aufrufe, nicht einer

Beim Umbau in Nachtrag 96 wanderten die vm-Aufrufe aus den Navigationsgraphen
(Paket …nav, dort mit Wildcard) in die Screens und verloren dabei die
Sichtbarkeit:

| Datei | betroffene Aufrufe |
|---|---|
| GalleryScreen | 9 |
| PartsScreen | 5 |
| MinifigsScreen | 5 |
| FinanceScreen | 3 |
| SetDetailSections | 1 |

Alle fünf haben jetzt den Wildcard. Marco hat den ersten gemeldet — die übrigen
22 wären in den nächsten vier Läufen gekommen.

### Und wieder ein Prüfwerkzeug, das zu viel meldete

Mein erster Durchlauf zeigte 28 Treffer, darunter SetDetailScreen und
MonitoringSections — beide bauen seit jeher. Ursache: Der Ausdruck für
Importzeilen endete auf `$` und traf die Zeile
`import ch.brickinventoryapp.ui.*  // Feature-Extensions (…)` nicht, weil dort
ein Kommentar folgt. Mit `\\s*(?://.*)?$` blieben 23 — die echten.

Das ist der vierte Werkzeugfehler dieser Reihe. Alle vier hatten dieselbe Form:
Das Werkzeug meldete etwas, das ich zuerst für einen Befund am Code hielt.

### Die vierte Sache, die eine Aufteilung mitnehmen muss

1. die **Wildcards** der Quelldatei (Nachtrag 100)
2. die **Sichtbarkeit** — `private` gilt dateiweit (101)
3. die **Opt-ins** (102)
4. die **Erweiterungs-Importe** (dieser)

`SplitFileImportsTest` prüft jetzt alle vier. Gegenprobe: Wildcard aus
FinanceScreen entfernt → rot, mit allen drei Aufrufen.

HINWEIS: weiterhin ohne Android-SDK.

---

## Nachtrag 104 — Die Typfehler, die nur der Compiler findet

Marcos Build meldete 29 Fehler in vier Dateien. Alle gehen auf dieselbe Ursache
zurück: Beim Aufteilen (Nachtrag 98) habe ich die Parametertypen GESCHÄTZT
statt sie in der Quelldatei nachzuschlagen.

### Sieben Klassen, alle behoben

**1. Funktion als Parameter braucht `::`** — `fmtPrice` ist in FinanceScreen ein
lokales `fun`. Als Argument übergeben verlangt Kotlin eine Funktionsreferenz:
`::fmtPrice`. Ohne sie: „Function invocation 'fmtPrice(...)' expected".
Fünf Aufrufe.

**2. Ein Smart-Cast wurde durchtrennt** — FinanceScreen steigt oben mit
`if (valuation == null) { … return }` aus; alles darunter lief unter einem
Smart-Cast auf den Nicht-Null-Typ. Meine Signaturen sagten `ValuationResponse?`,
die Rümpfe griffen ohne `?.` zu. Acht Fehler.

Behoben durch die Signatur (`ValuationResponse` ohne `?`), nicht durch `?.` im
Rumpf: Das hätte eine ANDERE Bedeutung — „darf fehlen" statt „ist hier immer
da". Der Aufrufer erfüllt die Zusage durch seinen frühen Ausstieg.

**3.–7. Falsch geratene Typen und fehlende Parameter:**

| Was | geschätzt | richtig |
|---|---|---|
| `pnlPct` | `Double?` | `String?` |
| `authToken` | `String?` | `String` |
| `fmtPrice` (SetDetail) | fehlte | `(Double?) -> String` |
| `fmtDate` | fehlte | `(String?) -> String` |
| `serverUrl` | fehlte | `String` |

`pnlPct` erklärt gleich zwei Folgefehler: `pnlPct?.toDoubleOrNull()` gibt es auf
`Double?` nicht, und `PnlBadge(pct)` bekam dadurch `Any` statt `Double`.

### Warum keine meiner Prüfungen das sah

Sie prüfen Namen (Nachtrag 100), Sichtbarkeit (101), Annotationen (102) und
Erweiterungen (103) — aber keine Typen. Typprüfung ohne Compiler nachzubauen
hiesse, einen Compiler zu bauen.

Was ich stattdessen gemacht habe: ein Werkzeug, das für jeden Parameter der
neuen Funktion die zugehörige Deklaration im ORIGINAL sucht und vergleicht.
Es hätte alle sieben Klassen gemeldet — und es meldet jetzt nur noch die drei
beabsichtigten Umwandlungen `fun` → Lambda.

Das ist die ehrliche Lehre dieses Nachtrags: Beim Aufteilen ist der
Parametertyp nachzuschlagen, nicht zu schätzen. Der Rumpf blieb wortgleich —
genau deshalb ist die Signatur die einzige Stelle, an der ein Fehler entstehen
kann, und genau dort war ich nachlässig.

HINWEIS: weiterhin ohne Android-SDK.

---

## Nachtrag 105 — Ein geratener Import

Marcos Build nach Nachtrag 104:

    SetDetailSections.kt:60:34 Unresolved reference 'fmtPrice'.

Zeile 60 war ein IMPORT: `import ch.brickinventoryapp.util.fmtPrice`. Den habe
ich beim Erzeugen der Datei geraten — in `util` gibt es nur `fmtMoney`,
`fmtMoneyOrDash` und `fmtInt`. `fmtPrice` ist eine LOKALE Funktion von
SetDetailScreen und kommt seit Nachtrag 104 als Parameter; der Import war schon
beim Anlegen der Datei überflüssig und falsch.

### Warum keine Prüfung das sah

Alle bisherigen fragen: Ist ein BENUTZTER Name gedeckt? Diese Richtung war
erfüllt — `fmtPrice` war ja „importiert". Die umgekehrte Frage stellte niemand:
Zeigt der Import überhaupt auf etwas?

`SplitFileImportsTest` prüft das jetzt für jeden projekteigenen Import im
ganzen Baum. `R` und `BuildConfig` sind ausgenommen, die erzeugt das
Bauwerkzeug.

Ergebnis der ersten Durchsicht: **genau ein falscher Import** im ganzen Projekt
— dieser.

### Sechs Dinge, die eine Aufteilung mitnehmen muss

1. die **Wildcards** der Quelldatei (100)
2. die **Sichtbarkeit** — `private` gilt dateiweit (101)
3. die **Opt-ins** (102)
4. die **Erweiterungs-Importe** (103)
5. die **Parametertypen** — nachschlagen, nicht schätzen (104)
6. **keine geratenen Importe** (dieser)

Gegenprobe: den falschen Import wiederhergestellt → rot.

HINWEIS: weiterhin ohne Android-SDK.

---

## Nachtrag 106 — Die Galerie sprang beim schnellen Scrollen zurück

Marcos Befund: „Wenn ich schnell nach unten scrolle, werden zwar neue Einträge
angezeigt, nach einer Sekunde springt die Liste aber wieder nach oben — immer
auf dieselbe Zeile. Auch beim Öffnen und Schliessen des Detail-Dialogs."

### Ein Wettrennen von einem Frame

Der Endlos-Scroll in GalleryScreen hängt an einem `snapshotFlow`, dessen
`LaunchedEffect` bei jeder Änderung von `sets.size` neu startet und sofort
wieder auswertet. Beim schnellen Wischen feuert er mehrfach im selben Frame.

`galleryLoadingMore` wurde INNERHALB der Koroutine gesetzt — also erst beim
nächsten Ablaufschritt. Zwei Aufrufe im selben Frame lasen deshalb beide
`false`, kamen beide am Wächter vorbei und forderten beide `galleryPage + 1`
an: **dieselbe Seite**. Die 100 Sets landeten zweimal in der Liste.

`items(sets, key = { it.setNumber })` bekam damit doppelte Schlüssel. Ein
LazyVerticalGrid löst eine Position über den Schlüssel auf und landet beim
ERSTEN Vorkommen — daher der Sprung, und daher immer auf dieselbe Zeile.

Das erklärt auch den zweiten Teil: Die gemerkte Rollposition (ScrollMemory,
Nachtrag 95) zeigt auf einen Index, der beim Zurückkehren erneut über den
doppelten Schlüssel aufgelöst wird. Der Merker war nie kaputt — er bekam eine
mehrdeutige Liste.

### Behebung, zweifach

1. **Sperre synchron vor dem `launch`.** Der zweite Aufruf sieht `true` und
   kehrt um. Folge davon: Sie muss in JEDEM Ausgang wieder gelöst werden —
   auch bei der verworfenen Antwort nach einem Filterwechsel, sonst lädt der
   Endlos-Scroll nie wieder nach.

2. **Bekannte Schlüssel beim Anhängen aussieben.** Der Wächter schliesst das
   Wettrennen im Client; der Server kann Überschneidungen aber auch von sich
   aus liefern. Bei einer Sortierung mit gleichen Werten (etwa nach Jahr) steht
   die Reihenfolge innerhalb einer Gruppe nicht fest, und zwischen zwei
   Seitenabfragen kann derselbe Datensatz erneut auftauchen.

### Tests

`GalleryLoadMoreRaceTest` mit drei Prüfungen: Sperre vor dem launch, Freigabe
bei verworfener Antwort, Aussieben beim Anhängen.

Drei Gegenproben nachgespielt. Die zweite ging beim ersten Anlauf durch, obwohl
ich die Freigabe entfernt hatte: Mein Prüffenster war 400 Zeichen breit und fand
die Freigabe im Fehlerzweig weiter unten. Jetzt reicht es nur bis zum
`return@launch`.

HINWEIS: weiterhin ohne Android-SDK.

---

## Nachtrag 107 — Der Gesamtwert kommt vom Server

Marcos Frage nach der Zentralisierung. Für die App war die Antwort bis auf eine
Stelle ja: Den Gesamtwert (Sets + manuell erfasste Teile + Minifiguren)
addierte sie selbst — genau wie die Webapp, jede auf ihre Art. Die Regel „was
zählt zum Gesamtwert" stand damit an drei Stellen.

Er kommt jetzt als `totals.grand_total` aus /finance/pnl (Manager-Nachtrag 145),
gebildet aus den Preisen JE ZEILE statt aus drei gerundeten Endsummen. Neues
Modellfeld in `PnlTotals`, nullbar — bei einem älteren Server fällt die App auf
die eigene Addition zurück.

`financeGrandTotal()` bekommt dafür `pnl` als Parameter; der Aufruf in
FinanceScreen wurde nachgezogen.

Die Teilsummen las die App schon immer als `total_value` vom Server — die
Webapp tat das NICHT und summierte selbst. Genau diese Divergenz war der Anlass.

### Neue Prüfung

`ClientRendersOnlyTest` sucht `sumOf` über Felder, deren Name auf Geld deutet,
und verlangt, dass der Gesamtwert vom Server gelesen wird. Summen über
Stückzahlen bleiben erlaubt: „x7" neben einer Zeile ist Anzeige, keine
Geschäftsregel.

Zwei Gegenproben: Gesamtwert wieder selbst addiert → rot; Geldsumme in die
Oberfläche eingebaut → rot.

HINWEIS: weiterhin ohne Android-SDK.

---

## Nachtrag 108 — Der Lade-Eintrag der Galerie hatte keinen Schlüssel

Marcos Befund: „Sobald neue Tiles geladen werden, springt die Galerie auf ca.
die 6. Zeile — unabhängig davon, ob ich schnell oder langsam scrolle."

Das „unabhängig" schliesst das Wettrennen aus Nachtrag 106 als alleinige
Ursache aus. Der Fix dort war richtig, aber offenbar nicht dieser Fehler.

### Was ich gefunden habe

Die Kacheln der Galerie sind verschlüsselt (`key = { it.setNumber }`), der
Lade-Eintrag darunter war es NICHT.

Ein Eintrag ohne Schlüssel bekommt in einer solchen Liste einen Ersatz aus
seinem INDEX. Wächst die Liste von 100 auf 200, wechselt dieser Ersatz — für
das Raster verschwindet ein Eintrag und ein anderer erscheint, statt dass
derselbe stehen bleibt.

Dass die Teile- und Minifiguren-Raster ihren Kopfzeilen längst Schlüssel geben
(`key = "manual-header"`, `key = "sets-header"`), war der Hinweis: Die Galerie
war die Ausnahme. Dieselbe Lücke fand sich im Lade-Eintrag der Teile-Liste.

### Was ich NICHT behaupte

Dass dies Marcos Sprung erklärt, ist damit nicht bewiesen. Aus dem Quelltext
war nicht zu entscheiden, ob die Wiederherstellung der Rollposition feuert oder
das Raster seine Stelle von sich aus verliert — beide Erklärungen passen zum
Bild, und ein dritter Rateversuch kostet einen weiteren Build-Durchgang.

Deshalb liegt in ScrollMemory.kt zusätzlich eine Log-Zeile:

    D/ScrollKeeper: gallery: springe auf <index>/<offset>

Erscheint sie im Moment des Sprungs, war es die Wiederherstellung. Erscheint
sie NICHT, war es das Raster — dann war der fehlende Schlüssel die Spur.

### Neue Prüfung

`LazyGridItemKeyTest` sucht im ganzen ui-Baum nach `item(…)` ohne `key` in
Dateien, die überhaupt mit Schlüsseln arbeiten.

Die Gegenprobe blieb beim ersten Anlauf GRÜN, obwohl ich den Schlüssel entfernt
hatte: Mein Ausdruck erfasste den mehrzeiligen Aufruf mit geschachtelten
Klammern (`span = { GridItemSpan(maxLineSpan) }`) nicht. Mit DOT_MATCHES_ALL und
einer Klammer-tauglichen Gruppe schlägt sie an. Ohne das Nachspielen hätte ich
einen Test geliefert, der nichts bewacht — zum zweiten Mal in dieser Reihe.

---

## Nachtrag 109 — Was das Video zeigt, und drei Meldungen, die den Rest klären

Marco hat ein Video des Rücksprungs geschickt. Ausgewertet (42 Einzelbilder,
Bildunterschied je Halbsekunde):

| Zeit | Bildunterschied |
|---|---|
| 2,0–4,5 s | gross — der Benutzer scrollt |
| 5,0 s | **0,6 — Bild steht still** |
| 5,5 s | **37,4 — SPRUNG** |
| 6,0 s | 0,4 — steht wieder still |
| 12,5–14,5 s | gross — Benutzer scrollt |
| 15,0 s | **0,9 — steht still** |
| 15,5 s | **42,5 — SPRUNG** |

Zwei belastbare Aussagen daraus:

1. **Der Sprung passiert bei STILLEM Bild.** Kein Finger, kein Ausrollen einer
   Wischbewegung — etwas im Programm springt.
2. **Rund eine Sekunde nach dem Loslassen**, also genau dann, wenn die
   Nachlade-Antwort eintrifft.

Das Ziel ist jedes Mal derselbe Eintrag (41702-1 Canal Houseboat), aus dem
Technic-Bereich zurück zu den Friends-Sets.

### Warum ich damit noch nicht behebe

Drei Erklärungen passen zu diesem Bild, und der Quelltext entscheidet nicht
zwischen ihnen:

- die Wiederherstellung der Rollposition (ScrollMemory) feuert erneut,
- das Raster verliert seine Stelle über die Schlüssel,
- die Liste wird ersetzt statt angehängt.

Nach zwei Fehlversuchen (Nachträge 106 und 108) rate ich nicht ein drittes Mal.

### Drei Meldungen, die ein einziger Durchlauf beantwortet

    D/ScrollKeeper:   gallery: springe auf <index>/<offset>
    D/GalleryScroll:  Seite N: 100 empfangen, 0 doppelt, Liste 100 -> 200 von 454
    D/GalleryScroll:  Liste=200 Stelle vorher=94 nachher=94

Auswertung:

| Beobachtung | Schuldiger |
|---|---|
| `ScrollKeeper springt` erscheint beim Sprung | die Wiederherstellung |
| „Liste 200 -> 100" (Länge SINKT) | die Liste wird ersetzt |
| Länge wächst, aber „vorher≠nachher" | das Raster selbst |

Aufzeichnen mit `adb logcat -s ScrollKeeper GalleryScroll` während des
Scrollens.

Der Schlüssel am Lade-Eintrag aus Nachtrag 108 ist in diesem Paket ebenfalls
enthalten — er war ein belegter Mangel, unabhängig davon, ob er DIESEN Sprung
erklärt.

---

## Nachtrag 110 — Gefunden: Der CSV-Statusstrom lud die Galerie alle paar Sekunden neu

Marcos Protokoll aus Nachtrag 109 hat es entschieden:

    Seite 2: 60 empfangen, 0 doppelt, Liste  60 -> 120 von 452
    Seite 3: 60 empfangen, 0 doppelt, Liste 120 -> 180 von 452
    Seite 4: 60 empfangen, 0 doppelt, Liste 180 -> 240 von 452
    Seite 2: 60 empfangen, 0 doppelt, Liste  60 -> 120 von 452   ← zurück

Alle fünf bis zehn Sekunden fiel die Liste auf 60 Einträge zurück. Das Raster
landete auf der letzten noch vorhandenen Zeile — immer derselben. Genau der
beobachtete Sprung, und genau in dem Takt, den die Videoauswertung gezeigt
hatte.

Bemerkenswert: „0 doppelt" und „Stelle vorher=51 nachher=51" schliessen die
beiden Erklärungen aus, die ich vorher verfolgt hatte. Weder kamen doppelte
Schlüssel vom Server, noch verlor das Raster seine Stelle beim Anhängen.

### Ursache

`handleCsvStatus()` prüfte:

    if (!running && s.status != null && s.status != "error") finishCsvImport()

Der SSE-Strom meldet den Importstatus fortlaufend, auch lange nachdem der
Import fertig ist. „Läuft gerade nicht und ist kein Fehler" trifft auf JEDE
solche Meldung zu — also lief `finishCsvImport()` alle paar Sekunden erneut und
ersetzte über `loadSets()` die ganze Liste durch Seite 1.

Der Wächter `csvFinishing` half nicht: Er wird nach fünf Sekunden freigegeben —
genau im Takt der Meldungen.

### Behebung

Ein Abschluss ist ein ÜBERGANG, kein Zustand. Nachgeladen wird nur, wenn vorher
tatsächlich ein Import lief:

    val warVorherAktiv = _csvImportState.value.running   // VOR dem Überschreiben
    …
    if (!running && warVorherAktiv && s.status != null && s.status != "error")

Dieselbe Verwechslung gab es zweimal im Manager: beim Takt der
Anleitungs-Warteschlange (Nachtrag 142) und beim Bild-Job (217). Eine Handlung
hing an einem ZUSTAND statt an dem Ereignis, das sie auslösen soll.

### Was aus den Fehlversuchen bleibt

Nachtrag 106 (Wettrennen beim Nachladen) und 108 (fehlender Schlüssel am
Lade-Eintrag) waren beide echte Mängel, nur nicht DIESER. Sie bleiben drin.

Die drei Diagnosezeilen sind wieder entfernt — sie haben ihre Frage beantwortet.

### Tests

`CsvStatusReloadTest` mit drei Prüfungen: nachgeladen wird nur beim Übergang,
der vorherige Zustand wird VOR dem Überschreiben gelesen (sonst wäre die
Prüfung wirkungslos), und `finishCsvImport()` lädt überhaupt nach.

Zwei Gegenproben: Bedingung ohne Übergang → rot; alten Zustand erst nach dem
Überschreiben lesen → rot.

HINWEIS: weiterhin ohne Android-SDK.

---

## Nachtrag 111 — Der Kaufpreis wurde nicht gespeichert

Marcos Befund: „Wenn ich in der Android-App den Kaufpreis anpasse (bei den
Minifiguren, evtl. auch bei den manuell erfassten Teilen und den Sets), wird
der Kaufpreis nicht gespeichert."

### Zwei Feldnamen — kein Versehen des Servers

Der Server liest das Preisfeld unter dem Namen der jeweiligen SPALTE
(`req.body[cfg.priceCol]`):

| | Feld |
|---|---|
| Sets | `purchase_price` |
| Teile und Minifiguren | `unit_price` |

Das ist konsequent: Bei einem Set ist es der Preis des Sets, bei Teilen und
Minifiguren der Preis JE STÜCK. Die Webapp bedient beide Namen seit jeher.

Die App schickte immer `purchase_price`. Für Teile und Minifiguren fand der
Server also gar kein Preisfeld — und liess den Preis unverändert, OHNE einen
Fehler zu melden. Deshalb wirkte es wie „wird nicht gespeichert": Die Anfrage
war erfolgreich, sie trug nur nichts bei.

Bei SETS ging es übrigens schon vorher richtig; Marcos „evtl. auch" trifft dort
nicht zu.

Bemerkenswert: Der Parameter in ManualItemFeature hiess schon immer
`unitPrice`. Er landete nur im falschen Feld.

### Behebung

`UpdateAcquisitionRequest` trägt jetzt beide Felder, und der Rumpf wird
ausschliesslich über `fuerSet()` bzw. `fuerStueck()` gebaut — jeder setzt genau
eines, das andere bleibt null und wird von kotlinx.serialization weggelassen.

Ein Erzeuger je Art statt einer Entscheidung an jeder Aufrufstelle: Sonst
entscheidet wieder jede für sich, und eine davon entscheidet falsch.

### Tests

`AcquisitionPriceFieldTest` mit drei Prüfungen: das Modell kennt beide Felder,
jeder Erzeuger setzt genau seines, und niemand baut den Rumpf von Hand.

Zwei Gegenproben: Preis wieder ins Set-Feld → rot; `fuerStueck()` setzt das
falsche Feld → rot.

### Zwei eigene Werkzeugfehler beim Bauen der Prüfung

Erst ankerte ich den Modellblock an einem KOMMENTAR — den mein eigenes
Entkleiden vorher entfernt. Dann prüfte ich `@SerialName("…")` im entkleideten
Text, wo Zeichenketten geleert sind. Beide Male meldete das Werkzeug einen
Fehler, den es im Code gar nicht gab.

HINWEIS: weiterhin ohne Android-SDK.

---

## Nachtrag 112 — Zwei Touch-Listener, einer hat gewonnen

Marcos Befund: „Die Kamera im Barcodescanner stellt WIEDER nicht scharf."

Das „wieder" traf zu — und der Grund dafür stand im Code: Der Dateikopf von
BarcodeScannerScreen.kt verweist auf einen `CameraFocusConfigTest`, den es
NICHT GAB. Er ist irgendwann verschwunden (schon vor Nachtrag 96), und damit
war die Regel unbewacht.

### Der Fehler

Auf derselben `previewView` standen ZWEI `setOnTouchListener`:

    Zeile 291  in der factory        → disableAutoCancel()
    Zeile 343  im Kamera-Rückruf     → setAutoCancelDuration(3, SECONDS)

`setOnTouchListener` fügt nicht hinzu, es ERSETZT. Der zweite läuft später und
überschrieb den ersten stillschweigend. Wirksam war damit die Fassung mit
Auto-Cancel — und genau davor warnt der Kommentar drei Zeilen über dem ersten:
„Bewusst mit disableAutoCancel(): Ohne das fällt die Kamera nach wenigen
Sekunden auf ihre eigene Wahl zurück."

Man tippt, es wird scharf, und Sekunden später ist es wieder weg.

### Nicht meine Aufteilung

Erste Vermutung war Nachtrag 99 (Trennung von Analyse und Vorschau). Der
zeilenweise Abgleich gegen den Stand davor zeigt: keine Zeile verloren, die
17 Zusätze sind Signatur und Aufruf. Beide AF-Modi stehen unverändert an ihren
Use Cases.

### Ein Eigentor beim Aufräumen

Nach dem Entfernen des zweiten Listeners waren `MotionEvent`, `TimeUnit` und
`FocusMeteringAction` scheinbar unbenutzt. Mein Prüfausdruck schloss Treffer
NACH EINEM PUNKT aus — und `16.dp`, `11.sp`, `Modifier.background(…)`,
`Icons.Default.Close` stehen alle so. Ich entfernte fünf Importe zu viel.

Aufgefallen beim Gegenzählen ohne diesen Ausschluss; alle fünf sind wieder
drin, nur `TimeUnit` bleibt entfernt. Denselben Fehler hatte ich in Nachtrag 97
schon einmal gemacht.

### Neuer Test

`CameraFocusConfigTest` — der Test, auf den der Dateikopf seit jeher verweist,
existiert wieder. Vier Prüfungen: genau ein Touch-Listener, der Fokus wird
gehalten (`disableAutoCancel`, kein `setAutoCancelDuration`), der AF-Modus steht
an beiden Use Cases, und kein periodisches Nachfokussieren.

Zwei Gegenproben: zweiter Listener zurück → rot (zwei Meldungen); AF-Modus aus
der Analyse entfernt → rot.

HINWEIS: weiterhin ohne Android-SDK.

---

## Nachtrag 113 — Erfolgloser Scan führt zur manuellen Erfassung

Marcos Vorgabe: „Wenn der Barcode erkannt wurde, aber die API keine Setnummer
liefert, oder wenn die Texterkennung keine Nummer erkennt, soll automatisch die
manuelle Erfassung erscheinen. An allen Stellen, wo der Barcodescanner
implementiert ist. Wenn der Dialog erscheint, soll der Cursor bereits im
Set-Feld sein — immer, wenn das Formular angezeigt wird."

### Vier erfolglose Wege, ein Feld

Alle vier liegen im ViewModel:

1. EAN gar nicht auflösbar
2. EAN aufgelöst, aber ohne Setnummer
3. Texterkennung ohne verwertbare Nummer
4. Katalogabfrage zur erkannten Nummer scheitert

Nummer 4 stand nicht in der Aufgabe, endet aber genauso ohne Nummer — sie ist
mit drin.

Statt in jeden Bildschirm einen Aufruf zu setzen, melden sie sich über
`manuelleErfassungAnfordern` im Zustand. Wer den Scanner einbindet, liest das
Feld und öffnet SEINE Erfassung. Die Meldungen bleiben stehen: Sie sagen, WARUM
der Dialog aufgeht.

### Zwei Einstiege, zwei Formen

| Einstieg | Reaktion |
|---|---|
| Galerie | öffnet den Erfassen-Dialog |
| Teileliste | setzt den Cursor in ihr Eingabefeld |

Die Teileliste hat KEINEN Dialog — sie erfasst über ein Feld auf der Seite. Das
Gegenstück zum aufgehenden Dialog ist dort: Cursor hinein, Tastatur offen.

Beide QUITTIEREN; ohne das ginge die Erfassung beim nächsten Zusammensetzen
erneut auf.

### Der Cursor im Set-Feld

`LaunchedEffect(Unit)` im Dialog — er wird bei jedem Öffnen neu zusammengesetzt,
läuft also bei JEDER Anzeige genau einmal. Die kurze Pause davor ist nötig, weil
das Feld beim ersten Durchlauf noch nicht angeordnet ist; ein `requestFocus()`
liefe dann ins Leere.

### Nicht angefasst: ComparisonScreen

Der bindet den Scanner ebenfalls ein, hat aber keine Erfassung — er reicht den
Rohcode als Suchbegriff an eine Webseite weiter. Dort gibt es nichts manuell zu
erfassen; ein Dialog wäre dort sinnlos.

### Tests

`ManualEntryAfterScanTest` mit drei Prüfungen: alle VIER Wege setzen die
Anforderung, jeder Einstieg reagiert und quittiert, und der Fokus-Anker hängt am
SET-Feld (nicht an Menge oder Preis).

Drei Gegenproben: ein Weg vergessen → rot („3 statt 4"); Anker vom Set-Feld
entfernt → rot; Galerie quittiert nicht → rot.

HINWEIS: weiterhin ohne Android-SDK.

---

## Nachtrag 114 — Reiter öffnen sich wieder oben

Marcos Vorgabe: „Im Reiter Teile muss ich beim Öffnen nach oben scrollen, damit
die manuell erfassten Teile angezeigt werden. Das Gleiche gilt evtl. auch im
Reiter Minifiguren. Wenn der Reiter geöffnet wird, soll die Seite direkt die
manuell erfassten Teile bzw. Minifiguren anzeigen."

Sein „evtl. auch" traf zu: Beide Raster beginnen mit `key = "manual-header"` und
den manuell erfassten Einträgen, danach folgt „Aus Sets".

### Zwei Absichten, die man trennen muss

Der Scroll-Merker (Nachträge 92 bis 95) ist dafür da, dass die Liste beim
ZURÜCKKEHREN aus einer Detailansicht wieder an derselben Stelle steht. Er griff
bisher auch beim Antippen des Reiters — dann öffnete sich dieser irgendwo in der
Mitte.

„Ich komme zurück" behält die Stelle. „Ich gehe auf diesen Reiter" fängt oben
an. Beides sieht IM BILDSCHIRM gleich aus; unterschieden werden kann es nur
dort, wo der Unterschied bekannt ist — in der unteren Leiste.

`MainScaffold` bekommt dafür `onTabAngetippt`, alle neun Einbindungen reichen
`vm.scrollMemory.vergissReiter(ziel.route)` durch. Die Routennamen sind zugleich
die Schlüssel des Merkers, eine zweite Zuordnungstabelle entfällt.

### Zwei Feinheiten, die der Test festhält

Der Rückruf muss VOR der Navigation laufen — danach kann der Bildschirm die alte
Stelle bereits wiederhergestellt haben.

Und JEDE Einbindung muss ihn durchreichen. Sonst hinge es davon ab, über welchen
Reiter man kommt: Von der Galerie aus oben, vom Katalog aus in der Mitte.

### Tests

`TabOpensAtTopTest` mit drei Prüfungen: das Antippen verwirft die Position und
zwar vor der Navigation, jede der neun Einbindungen reicht den Rückruf durch,
und die manuell erfassten Einträge stehen tatsächlich oben (sonst wäre das
Verwerfen wirkungslos).

Zwei Gegenproben: Rückruf nach der Navigation → rot; eine Einbindung ohne
Rückruf → rot mit Zählung („4 Einbindungen, 3 Rückrufe").

HINWEIS: weiterhin ohne Android-SDK.

---

## Nachtrag 115 — Was die Code-Durchsicht ergeben hat, und was davon zu beheben war

Marcos Frage nach der Codequalität, danach: „Kannst du die Dinge die nicht
optimal sind gleich korrigieren".

Der Baum ist in gutem Zustand — 22 % Kommentaranteil, und die Kommentare
erklären das WARUM samt der verworfenen Alternative. Kein `TODO`, kein
`printStackTrace`, kein echtes `GlobalScope`. Was folgt, sind die Ausnahmen.

### Vier Texte gab es nur auf Englisch

`settings_default_condition`, `_hint`, `_global` und
`monitoring_default_condition` standen nur in `values/strings.xml`. Ein
deutscher Nutzer las in den Einstellungen „Default condition" und „— Global
default —". Android meldet das nicht: Fehlt ein Eintrag, fällt es still auf die
Vorgabesprache zurück.

### Der PDF-Betrachter sprach immer Deutsch

`PdfViewerScreen.kt` benutzte kein einziges `stringResource`. Beschriftungen,
Ladetexte und drei Toasts standen als deutsche Literale im Code — für einen
englischsprachigen Nutzer der einzige Bildschirm, der die Sprache wechselt,
samt unübersetzter Beschriftungen für den Bildschirmleser. `IconButtonLabelTest`
liess es durch, weil er verlangt, dass eine Beschriftung DA ist, nicht dass sie
übersetzbar ist.

17 Literale sind jetzt Ressourcen. Die beiden Helfer ohne Context
(`downloadPdfWithResume`) bekommen ihre zwei Meldungen als Parameter — sie
laufen auf dem IO-Dispatcher und bleiben so frei von Ressourcenzugriff.

Beim Aufräumen fielen vier weitere Stellen auf: „Versuch x/30 · Retry:" und
„x Stunden" im Monitoring, „Total ×x" in der Kaufpreis-Verwaltung, und im
Setup-Bildschirm ein fest eingetragenes `Build 2026.06.14` — ein Datum vom Juni,
das seither bei keinem Build nachgeführt wurde und also verlässlich das Falsche
zeigte. Jetzt aus `BuildConfig.VERSION_NAME`.

### Eine Einstellung, die nichts tat

Beim Umbau von `SettingsScreen` (siehe unten) kam heraus: Die Karte
„Standard-Zustand" war tot. `userDefaultCondition` und
`onSaveUserDefaultCondition` hatten Vorgabewerte (`null` bzw. `{}`), und die
einzige Aufrufstelle in `ToolsGraph.kt` reichte BEIDE nicht durch. Folge: Die
Karte zeigte immer den Preiszustand, der Speichern-Knopf wurde bei einer
Änderung aktiv, und die Wahl fiel beim Speichern still unter den Tisch.
`saveUserDefaultCondition()` im ViewModel hatte keinen einzigen Aufrufer.

Es ist dieselbe Einstellung, deren vier Texte auf Deutsch fehlten — sie wurde
nie fertig verdrahtet, und beides fiel niemandem auf, weil nichts abstürzte.

Ohne die Vorgabewerte wäre es ein Compilerfehler gewesen. Nach dem Umbau gibt
es die Parameter gar nicht mehr.

### Zwei Muster nebeneinander

`CatalogScreen` hatte 13 Parameter, `SettingsScreen` 12 — die letzten beiden
nach dem alten Muster, während Galerie, Finanzen, Teile und Minifiguren seit
Nachtrag 96 ihren Zustand selbst beim ViewModel abholen. Wer den nächsten
Bildschirm anfasste, musste erst herausfinden, welches Muster gilt.

Jetzt 3 bzw. 2 Parameter. Vorgehen wie damals: nur den KOPF tauschen, die Werte
unter den alten Namen neu binden, den Rumpf unverändert lassen.

Eine Feinheit dabei: In `SettingsScreen.kt` heisst die Bindung `appState`, nicht
`state` — `HouseholdCard()` weiter unten hat schon einen Parameter dieses Namens
vom Typ `HouseholdUiState`. Für den Compiler wären das getrennte
Gültigkeitsbereiche, für den Leser und für `UiStateFieldsTest` nicht.

### `onTabAngetippt` ohne Vorgabewert

Der Rückruf aus Nachtrag 114 hatte `= {}`. Alle neun Einbindungen reichen ihn
durch — eine zehnte könnte ihn stillschweigend weglassen, und dann hinge es
davon ab, über welchen Reiter man kommt. Ohne Vorgabewert meldet es der
Compiler statt eines Regex-Tests. Dieselbe Überlegung wie beim Server: Die Regel
gehört an die Stelle, die sie erzwingen kann.

### Die Testsuite prüft Text, nicht Verhalten

41 von 47 Testdateien lesen Quelltext — unvermeidlich ohne Android-SDK, aber der
Preis stand verstreut in jeder Datei: `lies()` und `code()` zeichengleich in
mehreren Dateien, der Pfad 29-mal neu gebaut, und mindestens zwölf Stellen mit
FESTEM Zeichenfenster (`substring(i, i + 400)`). Genau diese Konstruktion ist in
dieser Reihe viermal gebrochen, sobald ein Erklärkommentar wuchs.

Neu `test/…/Quellen.kt` als gemeinsame Fassung — das Gegenstück zu
`test/helpers/sources.js` im Manager. `fenster()` misst ZEILEN statt Zeichen,
`funktion()` liefert den Rumpf bis zur schliessenden Klammer, `ohneKommentare()`
arbeitet zeilenweise (kein Muster über die ganze Datei, wegen Kotlins
VERSCHACHTELTER Blockkommentare — Nachtrag 39b).

ZWEI eigene Fehler beim Bauen dieses Helfers, beide beim Nachspielen gefunden:

1. `funktion()` suchte die schliessende Klammer in Spalte 0. Für eine Methode
   INNERHALB einer Klasse ergab das den Rest der ganzen Klasse — `getSets(` in
   `BrickRepository` lieferte 320 statt 16 Zeilen. Die Prüfung blieb grün und
   wäre auch grün geblieben, wenn der gesuchte Text in einer anderen Methode
   gestanden hätte. Ein zu WEITES Fenster ist genauso wertlos wie ein zu enges,
   nur fällt es nicht auf.
2. Die Korrektur nahm dann den Abstand der Fundstelle zum Zeilenanfang als
   Einzug. Bei `internal fun MainViewModel.x(` liegt dazwischen das Wort
   `internal` — neun Leerzeichen Einzug für eine Funktion auf Spalte 0, Ende nie
   gefunden, Fenster wieder zu weit. Jetzt die tatsächliche Einrückung der
   Zeile.

### Zwei Tests wurden rot, obwohl das Verhalten gleich blieb

- `UiStateFieldsTest` und `ScreenViewModelWiringTest` bestimmten den Zustandstyp
  eines Namens aus der PARAMETERLISTE. Bildschirme, die ihren Zustand selbst
  abholen, haben keinen Parameter mehr — `state` in `CatalogScreen` galt
  plötzlich als App-Zustand, 25 bzw. 28 Fehlalarme. Beide leiten die Zuordnung
  jetzt über `Quellen.zustandsNamen()` ab, und welcher Fluss welchen Typ trägt,
  wird aus `MainViewModel.kt` SELBST gelesen statt im Test aufgezählt.
- `MediaAuthTest` suchte `downloadPdfWithResume(pdfUrl, cacheFile, httpClient)`
  zeichengenau. Durch die zwei Meldungsparameter wurde der Aufruf mehrzeilig.
  Auf die eigentliche Aussage umformuliert: Der Download läuft über den
  injizierten Client, und im Bildschirm wird kein eigener gebaut.

Beides ist dieselbe Sorte Test, die im Manager in hardened-118 eine
Sicherheitslücke festgeschrieben hatte. Umformuliert, nicht abgeschaltet.

### Neu: StringResourceParityTest

Zwei Prüfungen, die es vorher nicht gab:

- Jeder Schlüssel steht in BEIDEN Sprachdateien (408/408), in beide Richtungen.
  Die vorhandenen Prüfungen (`ServicePolishTest`, `IconButtonLabelTest` ) haken
  je eine LISTE ab — was nicht auf der Liste steht, prüft niemand.
- Kein Klartext in `Text(…)`, `contentDescription =` oder `Toast.makeText`.
  Emoji, Zahlenformate und die vier Eigennamen (Produktname, „PDF") sind
  ausgenommen; Ausdrücke werden vor der Sprachprüfung entfernt, sonst zählt der
  VARIABLENNAME in einer Einsetzung als Text.

Gegenproben bestanden: deutschen Eintrag entfernt → rot mit Namen; Literal
eingeschleust → rot mit Datei und Zeile.

### Nachgespielt statt geraten

Ohne Android-SDK ist nichts kompiliert. Jede betroffene Prüfung wurde per
Python gegen den echten Quelltext nachgespielt: `UiStateFieldsTest`,
`ScreenViewModelWiringTest` (alle drei Prüfungen), `CatalogScrubberTest`,
`ListScrollPositionTest`, `MediaAuthTest`, `ResourceAndCacheTest`,
`CatalogUsesLocalImagesTest`, `ThumbFallbackTest`, `ScreenSectionSplitTest`,
`SplitFileImportsTest`, `TabOpensAtTopTest` und die zwei neuen. Dazu
Klammer- und Kommentarbilanz aller elf geänderten Dateien (Zeichenketten
vorher ausgeblendet, sonst verfälschen Regex und Accept-Header die Zählung).

HINWEIS: weiterhin ohne Android-SDK. `./gradlew testDebugUnitTest` steht aus.

---

## Nachtrag 116 — Governance und Fehlermeldungen (Punkte 3, 4, 5, 6)

Marco: „Kannst du die Punkte bitte alle umsetzen". Gemeint sind die sechs
Punkte aus der Architektur-Durchsicht.

VORWEG, weil es die Lieferung erklärt: Punkte 1 (Testinfrastruktur) und 2
(Aufteilung von `AppUiState`) sind Kotlin-Umbauten über Dutzende Dateien und
lassen sich hier nicht kompilieren. Zusammen mit den übrigen vier in EIN Paket
gepackt, hätte ein Übersetzungsfehler sechs ineinandergeschobene Änderungen zur
Auswahl gehabt. Sie kommen deshalb als Nachtrag 117 nachgereicht — dieses Paket
zuerst bauen.

### Punkt 3 — Fehlermeldungen kamen aus zwei Sprachregimen

`BrickRepository.safeCall()` formulierte selbst: „Netzwerkfehler",
„Zeitüberschreitung", „Leere Antwort vom Server". Deutsche Sätze in einer
Schicht ohne `Context`, die also gar nicht übersetzen KANN — für einen
englischsprachigen Nutzer war damit jede Fehlermeldung der App deutsch, egal
wie sauber der Bildschirm darüber lokalisiert war. Von 36
Snackbar-Zuweisungen liefen 19 über `getString`, der Rest reichte durch, was
aus der Datenschicht kam.

Neu: `Result.Error` trägt eine `Fehlerart` (Aufzählung) statt eines Satzes,
dazu `httpCode` und `technisch` (nur fürs Log — Bibliothekstexte wie
„unexpected end of stream" sind englisch und wechseln mit der
Bibliotheksversion). Den Satz bildet `MainViewModel.meldung()` aus den
Sprachdateien. 33 Aufrufstellen in elf Feature-Dateien laufen jetzt darüber.

Vorrang hat weiter die Meldung des SERVERS: Er kennt seine Fälle genauer
(Kaufdatum-Konflikt, Währung passt nicht, Code schon eingelöst) und antwortet
in der Sprache des Kontos. Nur wenn er keine schickt, formuliert die App.

Beim Umbau mitgefunden: `SessionFeature` hatte zwei weitere deutsche Literale
(„Login fehlgeschlagen", „QR-Login fehlgeschlagen") — dieselbe Klasse, andere
Stelle.

EIGENER FEHLER dabei: Die Massenersetzung erwischte auch
`PartsListFeature.kt:158`, wo `result` ein `PdfExportState.Error` ist und kein
`Result.Error` — das wäre ein Übersetzungsfehler gewesen. Gefunden, weil ich
jede der 33 Stellen gegen ihre umgebende Funktionssignatur geprüft habe statt
die Ersetzung zu glauben. Zurückgenommen und mit einem Kommentar versehen.

Neu `ErrorMessageLayerTest`: (a) die Datenschicht baut keine Meldung mehr,
(b) jede `Fehlerart` hat einen Satz, (c) die Servermeldung läuft VOR der
eigenen Formulierung.

### Punkt 4 — Abhängigkeiten: Werkzeuge von 2026, Bibliotheken von 2024

Neu `renovate.json`: gesammelte PRs montags früh für kleine Sprünge, einzelne
für grosse. Zwei Pins sind ABGESCHALTET, damit Renovate sie nicht hebt —
`datastore-preferences` (1.2.0 ist wieder 4-KB-ausgerichtet) und
`graphics-path`. Die Begründung steht als `description` in der Regel selbst,
damit sie beim Lesen mitkommt.

NICHT gemacht: die Bibliotheken blind hochgezogen. Compose BOM `2024.09.03`
auf aktuell, Coil 2→3, OkHttp 4→5, Navigation 2→3 sind Umbauten mit
Quelltextfolgen, und ohne Compiler wäre das geraten. Der README-Abschnitt
„Abhängigkeiten und Lieferkette" listet sie einzeln mit dem, was jeweils
betroffen ist.

Ebenfalls dort: `distributionSha256Sum` fehlt im Gradle-Wrapper. Die Prüfsumme
lässt sich nicht raten und services.gradle.org ist von hier nicht erreichbar —
im README steht der eine `curl`-Befehl, der sie holt, und wohin die Zeile
gehört.

### Punkt 5 — zwei Build-Bremsen aus einem alten Workaround

`org.gradle.caching` und `ksp.incremental` standen beide auf `false`, als Teil
des Windows-KSP-Workarounds. Beide jetzt auf `true`; das Init-Skript bleibt.
Der Kommentar in `gradle.properties` nennt die zwei Zeilen zum Zurückdrehen und
bittet, das Scheitern dort zu vermerken — sonst probiert es der nächste
Durchgang wieder.

### Punkt 6 — was bewusst NICHT gemacht wird

Neuer Abschnitt „Bewusst nicht gemacht" in INVARIANTEN.md: Token unverschlüsselt
in DataStore (kein gepflegter Aufrüstweg, `security-crypto` ist abgekündigt; der
wirksamere Hebel ist serverseitig `TOKEN_IDLE_DAYS`), kein `SavedStateHandle`,
kein detekt/ktlint (Kopplung an die Kotlin-Version). Damit der nächste
Durchgang die Fragen nicht neu aufwirft.

### Punkt 2, erste Hälfte — die Domänengrenze ist jetzt durchgesetzt

Der Umbau von `AppUiState` kommt in 117. Was schon jetzt geht, ist die REGEL:
`StateDomainBoundaryTest` hält fest, welche Feature-Datei welche Felder
schreiben darf. `isLoading` und `error` sind querschneidend und für alle offen
— sie sind auch der Grund, warum es das gemeinsame Objekt noch gibt
(`PartsFeature` fasst siebzehnmal auf `_state` zu, ausschliesslich für diese
beiden).

Der Test fand beim ersten Lauf sofort einen Übergriff, den ich in der
Durchsicht übersehen hatte: `SetDetailFeature.applySetAggregate()` schreibt in
`state.sets`. Es ist begründet (sonst bleibt die Galerie-Kachel nach einer
Zustandsänderung im Kaufpreis-Dialog auf dem alten Label) und steht jetzt als
Ausnahme MIT Grund in der Liste — vier sind es insgesamt. Ein zweiter Test
schlägt an, wenn eine Ausnahme nicht mehr gebraucht wird: Eine Erlaubnis, die
niemand mehr prüft, ist schlimmer als keine.

### Nachgespielt

Beide neuen Tests plus die aus 115 (`UiStateFieldsTest`,
`StringResourceParityTest`) gegen den echten Quelltext nachgespielt,
Gegenproben bestanden (Übergriff eingeschleust → rot mit Datei und Feld).
Sprachparität 418/418. Klammer- und Kommentarbilanz aller geänderten Dateien.
Jede der 33 Meldungs-Ersetzungen einzeln gegen ihre Funktionssignatur geprüft.

HINWEIS: weiterhin ohne Android-SDK. `./gradlew testDebugUnitTest` steht aus.

---

## Nachtrag 116-fix1 — Übersetzungsfehler aus dem Bildschirm-Umbau

Marco meldete:

```
CatalogScreen.kt:230:30 Smart cast to 'String' is impossible,
because 'error' is a delegated property
```

Mein Fehler aus Nachtrag 115. Solange `state` ein PARAMETER von
`CatalogScreen` war, ging `state.error != null` gefolgt von `Text(state.error)`
durch. Seit dem Umbau auf `val state by vm.catalogState.collectAsStateWithLifecycle()`
ist es ein delegiertes Property — jeder Zugriff ruft erneut `getValue()` auf,
der Wert ist für den Compiler zwischen Prüfung und Verwendung nicht stabil, der
Smart Cast entfällt.

Behoben durch Heben in eine lokale Variable (`val fehlertext = state.error`).
Bewusst KEIN `?: ""`: Das würde im Fehlerfall einen leeren Text anzeigen und
die Ursache verstecken.

DANACH die ganze Klasse durchsucht statt nur die gemeldete Zeile: alle
delegierten Namen im Baum, dazu jede Null- und `is`-Prüfung auf ihren Feldern.
Ergebnis: zehn Fundstellen, davon neun harmlos — im BarcodeResultDialog steht
überall schon explizit `!!`, und in FinanceScreen/ToolsGraph wird der Wert nach
der Prüfung nicht roh verwendet. Nur `CatalogScreen` war betroffen, und
`SettingsScreen` (die andere umgebaute Datei) gar nicht.

Die Suche selbst hat beim ersten Lauf fünf Fehlalarme geliefert, weil mein
Muster `!!` nicht ausnahm. Genau deshalb wird daraus KEIN Test: Ein Test, der
korrekten Code anmeckert, wird abgeschaltet statt befolgt — und der Compiler
meldet diesen Fall ohnehin, genauer als jede Textsuche. Die Regel steht
stattdessen in INVARIANTEN.md.

Regressionsprüfung nachgespielt: UiStateFieldsTest, ScreenViewModelWiringTest
und die sechs CatalogScreen-Behauptungen aus CatalogScrubberTest und
ListScrollPositionTest bleiben grün.

LEHRE (dritte dieser Art nach den zwei Kotlin-Fallen aus Nachtrag 39b und 115):
Ein Umbau, der einen Parameter zu einem Delegierten macht, ändert nicht nur die
Signatur — er ändert, was der Compiler über den Wert weiss. Bei künftigen
Kopftauschen dieser Art gehört eine Suche nach Null-Prüfungen im Rumpf dazu.

---

## Nachtrag 117 — Testinfrastruktur und Barcode-Zustand (Punkte 1 und 2)

Der Build von 116 lief, also die beiden Umbauten, die einen Compiler brauchen.

### Punkt 1 — warum 41 von 47 Testdateien Text lasen

`testImplementation(libs.junit)` war die EINZIGE Testabhängigkeit. Ohne
Testbibliothek für Koroutinen und ohne HTTP-Attrappe blieb nur die Textsuche —
und die findet, ob eine Regel im Code STEHT, nie, ob sie WIRKT.

Neu: `kotlinx-coroutines-test` und `mockwebserver` (aus derselben
OkHttp-Version wie der Produktionsclient, also keine zweite
Netzwerkbibliothek im Testpfad), dazu Retrofit und der
Serialisierungs-Konverter für den Testpfad.

Zwei Stellen mussten dafür ihren Android-Anteil loswerden — und das ist der
eigentliche Gewinn, nicht die Abhängigkeiten:

- **`ResponseCache`** hing an einem `Context`, nur um an `cacheDir` zu kommen.
  Der Ordner kommt jetzt als Funktion herein (`() -> File`); der `@Inject`-
  Konstruktor reicht `{ context.cacheDir }` durch. Damit ist der Cache im Test
  mit einem Wegwerf-Verzeichnis baubar — und damit auch `BrickRepository`, das
  ihn im Konstruktor verlangt.
- **Die Zuordnung Fehlerart → Text** lag in `meldung()` und brauchte deshalb
  einen `Context`. Sie steht jetzt als reine Funktion `fehlerTextId()` in
  `ui/FehlerTexte.kt`. `meldung()` bleibt die Stelle, die den Satz holt und die
  Servermeldung bevorzugt — das ist Verhalten, das Android braucht; WELCHER
  Text zu welcher Ursache gehört, ist es nicht.

Das ist die Lehre im Kleinen: Was schwer prüfbar ist, ist meistens nicht zu
kompliziert, sondern nur mit etwas verwoben, das es nicht braucht.

Zwei neue Tests, beide führen Code AUS:

- **`BrickRepositoryErrorMappingTest`** startet einen echten HTTP-Server und
  prüft die Abbildung aus Nachtrag 116 gegen echte Antworten: 409 mit
  Fehlerrumpf (Servermeldung gewinnt, `art` bleibt null), 500 ohne Rumpf
  (`SERVER` + httpCode, kein Satz aus der Datenschicht), 401 (abgelaufene
  Sitzung, NICHT vorübergehend), Zeitüberschreitung, Verbindungsabriss — und
  ein Erfolgsfall als Gegenprobe, ohne den die Abbildung auch dann grün wäre,
  wenn schlicht ALLES als Fehler endet.
- **`FehlerTexteTest`** prüft, dass jede Fehlerart einen eigenen Text hat und
  nur der Serverfehler den HTTP-Code einsetzt. Das stand in 116 noch als
  Textsuche in `ErrorMessageLayerTest`; die fand einen vergessenen Zweig, aber
  nicht zwei Arten mit demselben Text — und brach, sobald jemand die Funktion
  umformulierte. Genau das ist jetzt passiert, und der Test ist deshalb
  umgezogen statt angepasst.

KEIN Repository-Interface eingeführt. Es hätte nur Sinn, um Feature-Funktionen
zu testen — die hängen aber am `MainViewModel` und damit an `Application`,
brauchen also Robolectric. Eine Abstraktion, die kein Problem löst, ist
Ballast; das bleibt offen, siehe unten.

### Punkt 2 — BarcodeUiState aus AppUiState herausgelöst

Zwölf Felder (`barcodeResult`, `scannerSource`, `barcodeAdding`, …) lagen im
gemeinsamen Objekt, an dem jeder Reiter hängt. Jeder Zwischenstand eines Scans
rekomponierte Galerie, Teile, Minifiguren und Finanzen mit. Dieselbe
Begründung, aus der `_snackbar`, `PartsUiState` und `FinanceUiState` schon
eigene Flüsse haben.

`AppUiState` geht damit von 37 auf 25 Felder. Die Namen verlieren den
`barcode`-Vorsatz (`barcodeSetName` → `setName`), weil er innerhalb der Klasse
nur den Klassennamen wiederholt; am Zugriffsort steht dafür
`barcodeState.setName`.

Alle 85 Fundstellen in sieben Dateien umgestellt. Geprüft habe ich das nicht
über die Anzahl, sondern über den Diff gegen den laufenden Stand von 116 —
jede Änderung einzeln angesehen, damit die Massenersetzung keine gleichnamigen
Felder anderer Klassen erwischt. Hilfreich dabei: KEIN `copy()` mischte
Barcode- und Nicht-Barcode-Felder, die Trennung war also sortenrein.

MITGEFUNDEN: `logout()` setzte `AppUiState`, `PartsUiState`, `FinanceUiState`
und `CsvImportUiState` zurück — der neue Fluss hätte gefehlt. Ein offener
Barcode-Dialog trüge dann Setname, Bild und Nummer des vorigen Kontos. Jetzt
mit drin, und der bestehende Test verlangt es.

DER AUSNAHMEN-TEST AUS 116 HAT GEARBEITET: Er meldete, dass die Ausnahme
`PartsList → barcodeForPartsList` nicht mehr gebraucht wird — das Feld liegt
nicht mehr im gemeinsamen Objekt. Genau dafür war er da: Eine Erlaubnis, die
niemand mehr prüft, ist schlimmer als keine. Ausnahme entfernt, drei bleiben.

Der Geltungsbereich dieses Tests steht jetzt ausdrücklich in seiner
Beschreibung: geprüft wird `AppUiState`, nicht die eigenen Flüsse. Dort ist ein
Zugriff von aussen meist berechtigt (`logout()` setzt alle zurück, die
Teileliste verbraucht den gescannten Wert) — eine Prüfung darüber hätte sofort
fünf Ausnahmen gebraucht, und eine Regel mit fünf Ausnahmen ist keine.

### Fünf Tests nachgezogen

`BarcodeDoubleAddGuardTest`, `ManualEntryAfterScanTest`, `PartsListScannerTest`,
`NavigationHostSizeTest` und `ResultAndStateSplitTest` nannten die alten
Feldnamen. Alle auf die neuen umgestellt, ihre Aussage unverändert;
`ResultAndStateSplitTest` verlangt zusätzlich, dass die zwölf Felder NICHT
nach `AppUiState` zurückwandern.

### Nachgespielt

Alle betroffenen Prüfungen gegen den echten Quelltext: die fünf nachgezogenen,
`UiStateFieldsTest` (0 Fehler, erkennt den neuen Fluss automatisch, weil die
Zuordnung aus `MainViewModel.kt` gelesen wird), `StateDomainBoundaryTest`
(0 Übergriffe, 0 tote Ausnahmen), `ErrorMessageLayerTest`. Dazu Klammer- und
Kommentarbilanz aller 20 geänderten Dateien und — Lehre aus 116-fix1 — eine
Suche nach Null-Prüfungen auf dem neu delegierten `barcodeState`: zwei Treffer,
beide Fehlalarme (Stringvorlage bzw. `!!`, beide unverändert gegenüber 116).

### Damit sind alle sechs Punkte der Durchsicht erledigt

Offen bleibt bewusst: Robolectric für die ViewModel-Schicht (Feature-Funktionen
sind weiterhin nur über Textsuche erreichbar), der Sprung der Bibliotheken auf
aktuelle Versionen (Renovate erzeugt die PRs jetzt, das Einspielen ist
Handarbeit mit Gerät) und `distributionSha256Sum` im Gradle-Wrapper (der
`curl`-Befehl steht im README).

HINWEIS: weiterhin ohne Android-SDK gebaut. `./gradlew testDebugUnitTest` steht
aus — bei den zwei neuen Verhaltenstests ist das diesmal besonders wichtig, weil
sie echte Abhängigkeiten ziehen.

---

## Nachtrag 118 — die vier Punkte aus der zweiten Durchsicht

### Punkt 1 — ein Feld, in das geschrieben, aus dem nie gelesen wurde

`AppUiState.error` wurde an 24 Stellen beschrieben und an EINER gelesen: dem
Anmeldebildschirm. Achtzehn Fehlerpfade meldeten damit ins Leere. Ein
misslungenes Löschen einer Minifigur, ein fehlgeschlagener Bewertungsabruf,
eine Galerie, die nicht lädt — der Nutzer sah nichts.

Auffällig: Es WAR schon einmal aufgefallen. Der Kommentar über
`meldeFehlgeschlageneErfassung()` in GalleryFeature.kt beschreibt genau dieses
Problem — behoben wurde damals nur die eine Stelle, an der es jemand bemerkt
hatte.

Jetzt heisst das Feld `loginError` und wird nur noch dort beschrieben, wo es
auch gelesen wird. Die anderen achtzehn Stellen gehen in `_snackbar`.
`clearError()` (null Aufrufer) ist weg. Die Regel steht als Kommentar an der
Felddeklaration: flüchtig → Snackbar, bleibender Formularfehler → `loginError`,
ganzseitige Fehlerfläche → das `error` des Bereichszustands (nur `CatalogUiState`,
und der Katalog zeigt es auch).

NEBENFUND beim Aufräumen: `AppUiState.defaultPriceCondition` — die globale
Vorgabe des Servers — wurde aus der Antwort geladen und dann NIRGENDS gelesen.
Die Einstellungen zeigten stattdessen `priceCondition` als „globale Vorgabe",
also die Grundlage für BrickLink-BEWERTUNGEN statt die Vorbelegung beim
ERFASSEN. Wer die Bewertung auf „Gebraucht" stellte, sah als angebliche globale
Vorgabe „Gebraucht", obwohl der Server „Neu" vorgibt. Dieselbe Ecke wie der
tote Standard-Zustand aus Nachtrag 115.

Neu `ErrorChannelTest`: nur die Anmeldung schreibt `loginError`, und JEDES Feld
von `AppUiState` wird irgendwo in der Oberfläche gelesen (eine Ausnahme mit
Grund: `galleryPage`, der Seitenzähler des Endlos-Scrolls).

EINEN TEST HABE ICH GEBAUT UND WIEDER VERWORFEN: „jeder `Result.Error`-Zweig
meldet etwas" fand zwanzig Zweige, und die meisten sind zu Recht still — ein
misslungener Hintergrund-Nachladevorgang behält den letzten Stand, statt zu
nörgeln. Zwanzig Ausnahmen sind keine Regel. Die Begründung steht als
Kommentar im Test, damit sie nicht beim nächsten Mal neu erarbeitet wird.

### Punkt 2 — Korrektur an meiner eigenen Meldung

Ich hatte sechs `IconButton` unter 48 dp als Barrierefreiheits-Mangel
gemeldet. Beim Umsetzen zwei Korrekturen an mir selbst:

1. Es sind VIERZEHN in neun Dateien, nicht sechs — meine Suche fand nur die
   einzeiligen Formen, in denen der Modifier direkt hinter dem Klammerbeginn
   steht.
2. Der Mangel war zu scharf formuliert. Material3 legt in `IconButton` ein
   `minimumInteractiveComponentSize()` in die Modifier-Kette, das die
   ANTIPPFLÄCHE unabhängig von der sichtbaren Grösse auf 48 dp aufzieht. Die
   Stellen sind also mit hoher Wahrscheinlichkeit in Ordnung.

Deshalb wurde an KEINEM Pixel etwas geändert. Was bleibt, ist eine kleine
sichtbare Fläche (zweimal 24 dp mit 14-dp-Symbol auf Kachelecken), und ob das
in der Praxis gut zu treffen ist, entscheidet ein Gerät und der Accessibility
Scanner, nicht ein Test. Neu `TouchTargetSizeTest` hält die neun bekannten
Dateien fest, damit eine zehnte auffällt — und meldet Einträge, die nicht mehr
gebraucht werden.

### Punkt 3 — profileinstaller ohne Baseline-Profil

`implementation(libs.androidx.profileinstaller)` war eingebunden, im Baum gab
es kein `baseline-prof.txt` und kein Benchmark-Modul. Die Bibliothek kostete
APK-Grösse und eine Initialisierung beim Start, ohne etwas zu tun. Entfernt;
der Weg zum Zurückholen (Modul `:macrobenchmark`, Lauf auf dem Gerät, Profil
nach `app/src/main/`) steht als Kommentar an der Stelle. Der Eintrag im
Versionskatalog bleibt.

### Punkt 4 — Sammelnde Tests ohne Untergrenze

Fast alle quelltextlesenden Tests haben dieselbe Form: Verstösse sammeln, am
Ende `assert(fehler.isEmpty())`. Findet der Dateilauf nichts, ist die Liste
leer und der Test GRÜN, ohne etwas geprüft zu haben. Betroffen waren 21
Stellen in zehn Dateien.

Die Grenze steht jetzt in `Quellen.alle()` — an einer Stelle statt in
einundzwanzig Methoden. Wer selbst läuft, hat eine `check()`-Wache daneben
bekommen.

DABEI EIN EIGENER FEHLER GEFUNDEN: Mein `ErrorChannelTest` filterte mit
`it.path.contains("/screens/")`. Auf Windows — und dort wird dieses Projekt
gebaut — liefert `File.path` BACKSLASHES, der Filter hätte also nichts
gefunden und der Test wäre grün gewesen, ohne eine Datei zu prüfen. Exakt die
Falle, gegen die dieser Punkt gebaut ist, im selben Nachtrag hineingeschrieben.
Neu `Quellen.unter(ordner)` vergleicht über `invariantSeparatorsPath` und
scheitert laut, wenn ein Ordner leer ist.

### Nachgespielt

`UiStateFieldsTest` (0 Fehler), `StateDomainBoundaryTest` (0 Übergriffe, 0 tote
Ausnahmen — `error` ist aus der Querschnitt-Liste raus, `loginError` gehört
jetzt der Sitzung), `ErrorChannelTest`, `TouchTargetSizeTest`, Klammer- und
Kommentarbilanz aller geänderten Dateien.

### Zusätzlich: push-fertig

Neu `.gitignore` (Build-Ordner, IDE, Signaturen, APKs — mit ausdrücklicher
Ausnahme für den Gradle-Wrapper, der ins Repository GEHÖRT). Ein zweites Paket
legt denselben Inhalt unter `Android-App/` ab, passend zu
github.com/addict85/Brickinventory.

WICHTIG: `gradlew`, `gradlew.bat` und `gradle/wrapper/gradle-wrapper.jar`
fehlen in allen bisherigen ZIPs — sie kamen nie mit. Ohne sie kann niemand das
Repository auf einem frischen Rechner bauen. Bitte aus dem lokalen Projekt
ergänzen, bevor du pushst.

HINWEIS: weiterhin ohne Android-SDK gebaut.

---

## Nachtrag 119 — was nicht mehr benutzt wird, und was nie benutzt wurde

### Punkt 1 — die Karte „Standard-Zustand" hatte keinen Rückweg

Zwei Textressourcen lagen seit Langem in strings.xml und wurden nie angezeigt:
`settings_default_condition_global` („— Globale Vorgabe —") und
`settings_default_condition_hint`. Die Karte bot nur zwei Chips, Neu und
Gebraucht.

Folge: Wer den Standard-Zustand einmal setzte, hatte für immer eine eigene
Übersteuerung. Der Weg zurück zur Vorgabe des Servers war überall vorgesehen —
`userDefaultCondition` ist nullable, `setUserDefaultCondition("")` setzt
serverseitig zurück, die Texte lagen bereit — nur der Knopf fehlte. Dazu sah
„Neu" ausgewählt aus, sobald der Wert nicht „U" war, also auch bei jemandem,
der nie etwas gewählt hatte.

Ich habe die Karte so gebaut, wie die vorhandenen Texte es beschreiben: DREI
Chips, „— Globale Vorgabe —" zuerst. `null` ist jetzt ein eigener
Auswahlzustand und nicht dasselbe wie „N"; gespeichert wird der leere String.
Der Hinweistext nennt zusätzlich, worauf die globale Vorgabe gerade steht —
sonst wählt man sie blind (neuer Text `settings_default_condition_effective`).

Das ist der dritte unfertige Teil derselben Karte nach Nachtrag 115 (tote
Verdrahtung) und 118 (falscher Rückfall auf die Bewertungsgrundlage).

### Punkt 2 — 325 Zeilen Composables ohne Aufrufer

Entfernt: `AcquisitionEditRow` (134 Zeilen), `AcquisitionRow` (96),
`EditManualItemDialog` (81), `InfoCell` (8), dazu die Einzeiler `StatChip`,
`StatChipMf`, `thumbUrl` und die nur von `thumbUrl` benutzte Konstante
`THUMB_EXT_REGEX`. Kein Test nannte eine davon.

MITGEFUNDEN: In AcquisitionManagementScreen.kt stand „Code-Sharing: Die
editierbaren Zeilen nutzen AcquisitionEditRow aus ManualItemComposables.kt."
Das stimmte nicht mehr — der Bildschirm hat eine eigene Fassung
(`AcquisitionManagementRow`), und `AcquisitionEditRow` hatte gar keinen
Aufrufer. Ein Kommentar, der eine Struktur behauptet, die es nicht gibt, ist
schlimmer als keiner: Wer die eine Stelle ändert, glaubt, die andere
mitgeändert zu haben. Korrigiert.

### Punkt 3 — 21 tote Textressourcen in zwei Sprachen

17 auf einen Schlag: neun `barcode_*` aus einem früheren Scanner-Dialog, fünf
`household_move_*` aus dem Verschieben-Kasten (in hardened-113 entfernt), dazu
`gallery_sort`, `household_owner`, `household_invite_copied` und
`partslist_not_implemented`.

Vier weitere kamen erst durch Punkt 2 ans Licht: `parts_bl_hint`,
`parts_bl_number`, `parts_bl_placeholder`, `parts_save` gehörten allein zum
gelöschten `EditManualItemDialog`. Gemeldet hat sie der neue Test, nicht ich —
er lief nach dem Löschen sofort rot.

418 → 398 Schlüssel, in beiden Sprachdateien gleich.

### Punkt 4 — der Test, der das künftig auffängt

Neu `DeadCodeTest` mit zwei Prüfungen: jede Textressource wird irgendwo benutzt
(Kotlin, die übrigen XML-Dateien, das Manifest), und jede Funktion hat einen
Aufrufer (Aufruf, `::`-Referenz oder benanntes Argument; Einstiegspunkte wie
`onCreate` sind ausgenommen).

Der Anlass: Derselbe Fehlertyp ist dreimal aufgetreten und zweimal davon nur
ZUFÄLLIG aufgefallen, beim Umbau von etwas anderem — `saveUserDefaultCondition`
ohne Aufrufer (115), `defaultPriceCondition` geladen und nie gelesen (118), und
jetzt die Karte ohne Rückweg. Der Schaden ist selten der tote Code selbst,
sondern was er verdeckt: Zwei der Texte waren nicht übrig geblieben, sondern
nie angekommen.

### Der Ausnahmen-Test hat wieder gearbeitet

`TouchTargetSizeTest` meldete nach dem Löschen, dass `ManualItemComposables.kt`
und `SetDetailComponents.kt` nicht mehr in der Liste der bekannten kleinen
Bedienelemente gebraucht werden — ihre Knöpfe standen in `AcquisitionEditRow`
und `AcquisitionRow`. Aus vierzehn Stellen in neun Dateien sind zwölf in sieben
geworden.

### Nachgespielt

`DeadCodeTest` (beide Prüfungen), `StringResourceParityTest` (398/398),
`UiStateFieldsTest`, `ErrorChannelTest`, `TouchTargetSizeTest`, die
Literal-Prüfung, Klammerbilanz aller geänderten Dateien und die XML-Gültigkeit
beider Sprachdateien.

HINWEIS: weiterhin ohne Android-SDK gebaut. Punkt 1 ändert sichtbares
Verhalten — die Karte bitte nach dem Bauen einmal durchklicken, besonders den
Wechsel zurück auf „— Globale Vorgabe —" und dass der Speichern-Knopf dabei
aktiv wird.

---

## Nachtrag 120 — Wiederholung abbauen: Gerüst, Formen, Farben

### ZUERST: ein Fehler von mir aus Nachtrag 118

`TabOpensAtTopTest` hatte eine Untergrenze `>= 20` auf einem Ordner mit VIER
Dateien (`nav/`). Der Test wäre bei jedem Lauf an seiner eigenen Wache
gescheitert. Ich hatte in 118 dieselbe Zahl in fünf Testdateien gesetzt, ohne
zu prüfen, worauf sie jeweils zeigt — bei den anderen vier (77 bzw. 51 Dateien)
ging es gut. Eine Untergrenze muss zum Bereich passen, sonst ist sie kein
Schutz, sondern ein Ausfall.

Aufgefallen ist es beim Umbau von Punkt 1, nicht durch Nachdenken. Falls du 118
oder 119 schon gebaut hast: Das war der Grund, wenn `testDebugUnitTest` rot war.

### Punkt 1 — neun identische Blöcke bei der Navigation

Alle neun `MainScaffold`-Einbindungen waren Zeichen für Zeichen gleich, bis auf
den Titel: derselbe Abmelde-Rückruf, dasselbe Verwerfen der Rollposition,
dieselbe Weitergabe von `serverUrl` und `isAdmin`.

Das ist die Form, aus der der Fehler in Nachtrag 114 entstand — eine Einbindung
vergass `onTabAngetippt`, und der Reiter fing je nach Herkunft oben oder in der
Mitte an. Damals habe ich den Vorgabewert entfernt, damit der Compiler es
meldet. Richtig als Sofortmassnahme, aber nicht die Ursache: Die fünf Zeilen
standen neunmal da.

Neu `ReiterGeruest(titel, vm, navController, bottomNavItems, snackbarHostState)`
in MainScaffold.kt. Alle neun Ziele nutzen es; zwei `val state by vm.state…`
in den Graphen wurden dadurch ungenutzt und sind weg. `MainScaffold` bleibt
offen für den Fall, dass ein Ziel abweichen muss — dann fällt es beim Lesen auf.

`TabOpensAtTopTest` zählt nicht mehr Rückrufe (es gibt nur noch einen), sondern
prüft: kein Ziel baut das Gerüst selbst.

### Punkt 2 — Formen und Erhebungen waren nirgends zentral

129 fest eingetragene `RoundedCornerShape(N.dp)` in neun Radien, die
Kartenoptik siebenmal wörtlich, dazu elf Erhebungen als Zahl. Auffällig war
das, weil die FARBEN es längst richtig machen — zwei Designs über
`colorScheme`, Diagrammfarben über `LocalChartColors`.

Neu `ui/theme/Formen.kt`: neun benannte Formen (karte, chip, knopf, kachel,
leiste, etikett, marke, fab, strich), zwei Erhebungen (flach/hoch) und `AppKarte`
für die Hülle. Alle 121 Formen und 11 Erhebungen umgestellt.

WICHTIG: Die Werte sind ZAHLENGLEICH mit dem, was vorher dastand. Dieser
Nachtrag verschiebt nur, wo sie stehen — er ändert nichts am Aussehen. Ein
Design ändert man danach, in einem eigenen Schritt, den man auch ansehen kann.

BEWUSST NICHT an `MaterialTheme(shapes = …)` gehängt: Das würde auch alle
Bauteile umformen, die heute keine Form angeben und die Material3-Vorgabe
benutzen — nicht ohne Gerät beurteilbar. Bleibt offen, ist dann eine Zeile.

`AppKarte` kapselt nur die Hülle, nicht den Innenabstand: Genau darin
unterschieden sich die Fundstellen (14 dp hier, 16 dp dort). Ihn mitzuziehen
hiesse, an vier Stellen das Aussehen zu ändern.

### Punkt 3 — zwölf feste Farben ausserhalb des Themes

Darunter ZWEI verschiedene Grüns für dieselbe Aussage („erfolgreich"):
`0xFF16A34A` in MonitoringScreen und SetDetailComponents, `0xFF22C55E` in
SetupScreen und BarcodeScannerScreen. Im Stein-Design zogen alle nicht mit.

Neu `StatusFarben` (erfolg/warnung/fehler) über `LocalStatusFarben`, je Design
gesetzt — im Stein-Design gedeckter, damit sie neben Salbeigrün und Sand nicht
herausstechen. `ChartColors` bekam `linie`, `raster` und `gedaempft` dazu;
PortfolioChart hatte diese vier fest eingetragen, obwohl `new`/`used` daneben
schon aus dem Design kamen.

Die klassischen Werte sind zahlengleich mit vorher — bis auf die
Vereinheitlichung der beiden Grüns auf das häufigere.

### Neu: DesignTokensTest

Vier Prüfungen: keine festen Eckenradien, keine festen Farben, keine festen
Erhebungen ausserhalb von `ui/theme/`, und beide Designs liefern Status- wie
Diagrammfarben (sonst fällt eines auf die Vorgabe des CompositionLocal zurück —
und die ist die klassische).

### Nachgespielt

DesignTokensTest (alle vier), TabOpensAtTopTest in der neuen Fassung,
DeadCodeTest (398 Texte, 104 Funktionen), Sprachparität, UiStateFieldsTest,
Klammer- und Kommentarbilanz. Gegenprobe: ein fester Radius eingeschleust →
rot mit Datei und Zeile, danach wiederhergestellt und wieder grün.

HINWEIS: weiterhin ohne Android-SDK gebaut. Punkt 1 verändert die Navigation an
neun Stellen — bitte nach dem Bauen einmal durch alle Reiter klicken und
prüfen, dass jeder oben anfängt und das Abmelden funktioniert.

---

## Nachtrag 121 — Release signieren

Marco: „Wie kann ich die Signatur-Informationen mitgeben?"

Vorher gab es im Projekt gar keine Signaturkonfiguration; `assembleRelease`
erzeugte `app-release-unsigned.apk`, das sich auf keinem Gerät installieren
lässt.

Neu liest das Buildskript vier Werte aus ZWEI Quellen, in dieser Reihenfolge:
Umgebungsvariable (`BRICK_KEYSTORE_PFAD` …), dann Gradle-Property
(`brickKeystorePfad` …). Die erste bedient GitHub Actions, die zweite den
lokalen Bau über `~/.gradle/gradle.properties` — eine Datei AUSSERHALB des
Projekts, die deshalb nicht versehentlich mitcommittet werden kann. Eine
`keystore.properties` neben dem Buildskript wäre beim nächsten `git add -A`
dabei; sie steht trotzdem in der .gitignore, zusammen mit `signing.properties`,
`*.jks` und `*.keystore` — doppelt hält.

Fehlen die Werte, gibt es keine Signaturkonfiguration und `assembleRelease`
baut UNSIGNIERT durch statt abzubrechen. Absicht: Ein lokaler Bau soll nicht
daran scheitern, dass jemand die Werte nicht gesetzt hat. Der CI-Ablauf setzt
in diesem Fall eine deutliche Warnung ins Protokoll, statt still etwas
Uninstallierbares hochzuladen.

Kein Vorgabewert irgendwo. Ein fest eingetragenes Passwort wäre schlimmer als
gar keine Signatur, weil es aussieht, als wäre es geschützt.

README: neuer Abschnitt „Release signieren" mit dem `keytool`-Aufruf, den drei
Wegen (lokal dauerhaft, lokal für eine Sitzung, GitHub Actions) und dem
`apksigner verify` zum Nachprüfen. Dazu der Hinweis, der am meisten kostet,
wenn er fehlt: Ohne den Schlüsselspeicher lässt sich eine installierte App nie
wieder aktualisieren.

EIGENER FEHLER im CI-Ablauf des Vortags, dabei korrigiert: `if: ${{
secrets.KEYSTORE_BASE64 != '' }}` auf Schrittebene. Der `secrets`-Kontext steht
dort nicht zur Verfügung — die Frage wird jetzt einmal in einer Job-Variablen
beantwortet und über `env` geprüft.
