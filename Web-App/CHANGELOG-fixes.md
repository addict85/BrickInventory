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

## Finanztabelle: eine Zeile je Kaufpreis — und die Bewertung je Zustand

**Gemeldet.** Ein Set mit einem Kaufpreis für „Neu" und einem für „Gebraucht"
stand mit **einer** Zeile in der Tabelle, und die Bewertung nahm den
Gebrauchtpreis für **beide** Exemplare: `effectiveCondition()` gab `'U'`
zurück, sobald eine einzige Erfassung gebraucht war.

Wirkung: Wer ein neu gekauftes Exemplar besass und später ein zweites
gebraucht dazukaufte, sah die Sammlung schlagartig weniger wert — ohne dass
sich am Markt etwas geändert hätte.

**Wo die Regel jetzt steht.** Nicht in einer neuen Datei: `utils/setValue.ts`
enthielt die zustandsabhängige Bewertung bereits (`valueSet`, `priceFor` mit
dem Ausweichen auf den anderen Zustand). Dort sind lediglich
`valueAcquisitionRows()`, `weightedPurchase()` und `pnlPct()` dazugekommen.

Ich hatte zwischenzeitlich eine eigene `utils/acquisitionValue.ts` angelegt und
wieder verworfen — genau die Doppelung, an der in diesem Projekt schon die
Zustandsauflösung (fünf Fundorte) und die Preisverlauf-Route auseinandergelaufen
sind.

**`computeSetsValuation()`.** Holt Preise jetzt für die tatsächlich
vorkommenden Zustände statt für einen ausgerechneten Set-Zustand. Ein reines
Neu- oder Gebraucht-Set holt weiterhin genau einen Preis — die Zahl der
BrickLink-Abrufe steigt nur für gemischte Sets. Neu in der Antwort:

```
acquisitions: [ { id, condition, quantity, purchase_price,
                  avg_price, total_avg, pnl_pct, created_at } ],
conditions: ['N','U'], mixed: true
```

Die Set-Zeile bleibt vollständig (`avg_price`, `total_avg`, `purchase_price`),
damit bestehende Aufrufer unverändert funktionieren. Der Stückpreis ist der
mengengewichtete Schnitt — `avg_price × quantity` ergibt weiterhin **exakt**
die Summe der Einzelzeilen. Ein Test hält das fest; laufen die beiden Zahlen
auseinander, stehen in einer Tabelle zwei Wahrheiten.

**`computePnl()` mitgezogen.** Diese Antwort speist die Galerie-Kachel und den
Detail-Dialog. Sie rechnete ebenfalls mit einem Zustand fürs ganze Set — wäre
sie stehen geblieben, hätte die Kachel einen anderen Marktpreis gezeigt als der
Finanzen-Reiter. Kaufpreis und Menge kommen dort jetzt ebenfalls aus den
Erfassungen; `sets.purchase_price` ist nur noch Rückfall für Altbestände.

**Webapp.** `public/js/04-finance.js` erzeugt eine Zeile je Erfassung. Bild,
Nummer, Name und Jahr stehen in der ersten Zeile des Sets, die weiteren sind
eingerückt und tragen die Zustands-Plakette (`.cond-new`/`.cond-used`).
**Ohne** zusätzliche Summenzeile je Set: Die Einzelzeilen sind die Wahrheit,
die Gesamtsumme steht wie bisher im Tabellenfuss. Sets mit genau einer oder
ohne Erfassung sehen unverändert aus.

**Tests.** `test/set-value.test.js` um acht Prüfungen erweitert (Preis je
Zustand, Prozentangabe gegen den Kaufpreis der Zeile, Menge, Kaufpreis 0 vs.
nicht erfasst, Ausweichen auf den anderen Zustand, gewichteter Kaufpreis,
Zeilensumme = Set-Summe).

Drei bestehende Prüfungen bildeten die alte Codeform ab und wurden auf die neue
umgeschrieben — die geschützte Absicht ist dieselbe geblieben (der Marktpreis
darf nicht aus dem falschen Zustand stammen).

Stand: `tsc --noEmit` sauber, 302 Tests, 0 Fehler (4 übersprungen mangels
Postgres).

---

## Kacheln: eine Plakette je Zustand, Preis mengengewichtet

**Was falsch war.** `condition` ist ein Aggregat und liefert genau einen Wert
(„gebraucht, sobald eine Erfassung gebraucht ist"). Auf der Kachel war das zu
wenig: Wer ein Exemplar neu und eines gebraucht gekauft hatte, sah nur
„Gebraucht" — die Neu-Erfassung war unsichtbar, obwohl sie seit hardened-90 mit
ihrem eigenen Preis in die Bewertung eingeht.

**Die Regel** steht in `utils/handlers.ts` neben der bestehenden:
`conditionsFromAcquisitions()` liefert die Liste, `conditionFromAcquisitions()`
weiterhin den Einzelwert. Bewusst nebeneinander — sie müssen zusammenpassen,
und getrennt gepflegt sind sie in diesem Projekt schon einmal
auseinandergelaufen. Reihenfolge fest Neu vor Gebraucht: nach Häufigkeit
sortiert würden die Plaketten beim nächsten Kauf die Plätze tauschen.

`conditions` hängt jetzt an Sets (`getSets`, `getSetConditionAggregate` — sonst
verlöre die Kachel nach dem Speichern die zweite Plakette bis zum nächsten
Laden), an manuellen Teilen und Minifiguren (`applyManualCondition`) sowie an
den Bewertungsantworten.

**Preis und Veränderung.** Beides ist jetzt der mengengewichtete Durchschnitt:

* Sets-Kachel: `avg_purchase_price` statt `MAX(purchase_price)` — bei 2×100 und
  1×160 stand dort bisher 160 statt der tatsächlichen 120. Der Marktpreis und
  die Prozentangabe laufen seit hardened-90 über `computePnl()` und sind
  bereits gewichtet.
* Manuelle Teile und Minifiguren: `computePartsValuation()` und
  `computeMinifigsValuation()` holen einen Preis **je vorkommendem Zustand**
  und fassen ihn über `valueSet()` gewichtet zusammen — dieselbe Regel wie bei
  Sets. Vorher entschied ein einzelner Zustand über den Wert aller Exemplare.
  Kaufpreis und G&V ebenso, über `weightedPurchase()`.
  Ein Eintrag mit nur einem Zustand holt weiterhin genau einen Preis.

**Webapp.** `condBadges()` in `public/js/02-gallery.js` — eine Fassung für
Galerie-, Minifiguren- und Teile-Kacheln sowie die Finanzzeilen. Vorher stand
dieselbe Plakette viermal im Code, dreimal mit fest eingetragenen Farben statt
der Klassen `.cond-new`/`.cond-used`. Ein Test hält fest, dass keine Zeile eine
Zustands-Beschriftung zusammen mit einer eigenen Farbe trägt.

**Nebenbei.** `PNL_EPS` stand in `financeCalc.ts` und `setValue.ts` doppelt —
zwei Konstanten mit derselben Bedeutung driften irgendwann auseinander. Jetzt
importiert.

Stand: `tsc --noEmit` sauber, 308 Tests, 0 Fehler (4 übersprungen mangels
Postgres).

---

## Finanztabelle: zwei vollständige Zeilen statt eingerückter Unterposition

Die erste Fassung sparte in den Folgezeilen eines Sets Bild, Nummer, Name und
Jahr und rückte stattdessen mit „↳" ein. Das las sich wie die Aufschlüsselung
einer Summe darüber — die Zeilen sind aber gleichrangig: Jede steht für einen
eigenen Kauf mit eigenem Zustand, eigenem Marktpreis und eigener Entwicklung,
und eine Summe gibt es je Set gar nicht.

Jede Zeile ist jetzt vollständig. Zusammengehalten werden sie durch die
Zustands-Plakette am Namen, die ohnehin jede Zeile trägt; die Cache-Anzeige
(⚡/🔴) steht ebenfalls auf beiden, weil je Zustand ein eigener Preis geholt
wird.

Sets mit genau einer (oder ohne) Erfassung sehen unverändert aus.

Stand: 308 Tests, 0 Fehler (4 übersprungen mangels Postgres).

---

## Pro Tag und Zustand eine Erfassung — und Teile/Minifiguren je Kaufpreis

**Gemeldet.** Ein manuell erfasstes Teil, heute zweimal erfasst, stand im
Detail-Dialog zweimal untereinander: „×1 · Neu · CHF 0.60 · 9.8.2026". Richtig
ist eine Zeile mit Menge 2.

**Die Regel** liegt jetzt in `utils/acquisitions.ts`
(`recordAcquisitionForDay`) und gilt für Sets, manuelle Teile und Minifiguren
gleichermassen: Existiert für diesen Tag bereits eine Erfassung **im selben
Zustand**, wächst ihre Menge, statt dass eine zweite Zeile entsteht.

Der Zustand gehört in den Schlüssel: Ein neu und ein gebraucht gekauftes
Exemplar am selben Tag bleiben zwei Zeilen. Sie haben verschiedene Marktpreise
und verschiedene Entwicklungen und stehen seit hardened-90 in Tabelle und
Kachel bewusst getrennt — sie zu verschmelzen würde genau die Unterscheidung
zerstören, für die es die getrennte Bewertung gibt.

Beim Zusammenfassen trägt die Zeile **einen** Preis: Haben beide Käufe einen,
wird mengengewichtet gemittelt — dieselbe Rechnung, mit der die Zeilen später
ohnehin verdichtet werden.

**Was daran vorher schon halb da war.** Die Mengenänderung im Set-Dialog fasste
am selben Tag zusammen, die Datumsänderung wies einen zweiten Eintrag am selben
Tag ab — und die Anlege-Pfade schrieben munter eine zweite Zeile. Der
Anlege-Pfad konnte damit einen Zustand herstellen, den der Bearbeiten-Pfad
ablehnt. Alle zehn Schreibstellen (Anlegen, Zweiterfassung, Mengenerhöhung,
CSV-Import — je für Teile und Minifiguren, dazu `recordAcquisition` für Sets)
laufen jetzt über den einen Helfer; die handgeschriebenen `isToday_`-Prüfungen
sind weg.

Mitgezogen: Die Kollisionsprüfung beim Ändern des Kaufdatums berücksichtigt
jetzt ebenfalls den Zustand.

**Finanzen-Reiter.** `computePartsValuation()` und `computeMinifigsValuation()`
liefern `acquisitions[]` wie die Sets, und die beiden Tabellen zeigen eine
vollständige Zeile je Kaufpreis mit Zustands-Plakette, Erfassungsdatum,
Marktpreis dieses Zustands und eigener Entwicklung. Die vierte Spalte war
bisher ein reiner Platzhalter für die Spaltenbreite und trägt jetzt dasselbe
wie in der Sets-Tabelle: das Erfassungsdatum.

**Tests.** Drei neue in `test/manual-acq-refresh.test.js` (Tagesregel samt
Zustand im Schlüssel, kein direktes `INSERT INTO *_acquisitions` mehr in den
Routen, Zeilen je Kaufpreis in allen drei Bewertungen). Vier bestehende
Prüfungen bildeten die alte Schreibform ab und sind auf den Helfer
umgeschrieben — die geschützte Absicht ist dieselbe geblieben.

**Nicht angefasst:** `adjustAcquisitionsToQuantity()` in `routes/sets.ts` fasst
weiterhin nach Tag *ohne* Zustand zusammen. Für Sets mit gemischten Erfassungen
kann eine Mengenerhöhung damit auf der falschen Zeile landen. Das ist älter als
diese Änderung und gehört in einen eigenen Durchgang — sag Bescheid, wenn ich
es gleich mitnehmen soll.

Stand: `tsc --noEmit` sauber, 311 Tests, 0 Fehler (4 übersprungen mangels
Postgres).

---

## Korrektur: pro Tag EINE Erfassung — ohne Zustand im Schlüssel

Die Fassung aus hardened-93 hatte den Zustand im Tagesschlüssel: Ein neu und
ein gebraucht gekaufter Eintrag am selben Tag blieben zwei Zeilen. Das war
falsch gedacht — die Datums-Endpunkte für Sets, Teile und Minifiguren weisen
einen zweiten Eintrag am selben Tag ohnehin alle drei ab, ohne den Zustand
anzusehen. Anlegen und Bearbeiten hätten damit weiterhin verschiedene Regeln
gehabt, nur an einer anderen Stelle als vorher.

Der Schlüssel ist jetzt Eintrag + Tag. Trifft am selben Tag ein Kauf im anderen
Zustand ein, wächst dieselbe Zeile, und ihr Zustand wird nach der Regel des
Projekts aufgelöst: **„gebraucht" gewinnt**, sobald einer der beiden Käufe
gebraucht war (dieselbe Regel wie `conditionFromAcquisitions` in
`utils/handlers.ts`). Der Preis bleibt der mengengewichtete Schnitt.

Die Kollisionsprüfung in `routes/sets.ts` ist damit wieder die alte (Tag ohne
Zustand) und stimmt mit `routes/parts.ts` und `routes/minifigs.ts` überein. Ein
Test hält jetzt fest, dass alle drei dieselbe Prüfung haben.

**Altbestand.** Die Regel greift erst beim nächsten Schreiben — bestehende
Doppelzeilen verschwinden nicht von selbst. `db/migrations/0004-erfassung-pro-tag.sql`
fasst sie einmalig zusammen, für alle drei Tabellen: Menge summiert, Preis
mengengewichtet über die Zeilen mit Preis, Zustand „gebraucht" sobald eine
gebraucht war, Zeitstempel der früheste des Tages; behalten wird die Zeile mit
der kleinsten id.

Der Lauf ist verlustbehaftet — zwei Zustände am selben Tag werden zu einem. Das
ist die Vorgabe; ohne diesen Schritt bliebe der Bestand in einem Zustand, den
der Code nicht mehr erzeugen kann. Käufe an verschiedenen Tagen werden nicht
angefasst.

**Keine Datenbank-Sperre.** Ein UNIQUE-Index auf `(user_id, …, created_at::date)`
ginge nicht: `timestamptz::date` hängt von der Zeitzone der Sitzung ab und ist
damit nicht IMMUTABLE, also nicht indizierbar. Die Regel hängt deshalb daran,
dass `recordAcquisitionForDay()` der einzige Schreibweg bleibt — ein Test hält
fest, dass keine Route mehr direkt in eine `*_acquisitions`-Tabelle schreibt.

Stand: `tsc --noEmit` sauber, 312 Tests, 0 Fehler (4 übersprungen mangels
Postgres). Die Migration selbst konnte ich hier nicht laufen lassen.

---

## Minifiguren ohne BrickLink-Nummer: Teile-Schätzung je Zustand

`estimateFigPriceFromParts()` lief fest mit `DEFAULT_PRICE_CONDITION` und
lieferte damit **einen** Wert, egal ob die Figur neu oder gebraucht geführt
wird.

Das Ärgerliche daran: Für Figuren MIT BrickLink-Nummer war der Zustand längst
berücksichtigt (`fetchMinifigPrice` fragt je Zustand ab). Durchgefallen ist
genau der Fall, in dem die Schätzung überhaupt greift — die Figur ohne Nummer,
bei der sie der einzige Preis ist, den es gibt. Eine gebraucht erfasste Figur
bekam den Neupreis ihrer Teile, und seit der Bewertung je Erfassung zeigten
zwei Zeilen mit verschiedenen Zuständen denselben Marktpreis.

Die Teilepreise kennen den Zustand ohnehin: `fetchPartPrice()` fragt BrickLink
je Zustand ab und fällt bei leerem Price Guide auf den anderen zurück. Er
musste nur durchgereicht werden — die Funktion nimmt jetzt einen dritten
Parameter.

Beide Aufrufer geben ihn mit:

* `getCurrentFigMarketPrice()` reicht den bereits ermittelten `effCond` weiter
  (eine Gebraucht-Erfassung genügt → `'U'`, sonst `'N'`, ohne Erfassungen der
  User-Default). Damit stimmen auch alle indirekten Aufrufer — Anlegen,
  CSV-Import, Mengenerhöhung, Kaufpreis-Nachtrag — ohne eigene Änderung.
* `computeMinifigsValuation()` ruft je vorkommendem Zustand einmal auf.

**Kosten.** Eine Figur mit Erfassungen in beiden Zuständen und ohne
BrickLink-Nummer bepreist ihre Teile zweimal. Der Teile-Preiscache greift je
Zustand, der zweite Durchlauf holt also nur, was noch nicht dasteht. Figuren mit
nur einem Zustand — der Normalfall — kosten unverändert einen Durchlauf.

**Test.** Erweitert um: der ermittelte Zustand geht in die Schätzung, die
Teilepreise werden damit geholt, kein fester Standardzustand mehr in der
Funktion, und die Bewertung ruft je Zustand auf.

Stand: `tsc --noEmit` sauber, 312 Tests, 0 Fehler (4 übersprungen mangels
Postgres).

---

## Preisverlauf für Teile und Minifiguren auch in der Android-API

Beide Verlaufs-Routen gab es nur für die Webapp — in `api-inventory.test.js`
ausdrücklich als `nur-web` geführt. Der Detail-Dialog der App zeigte deshalb
weder Marktpreis je Zustand noch ein Diagramm; es fehlte nicht die Aufteilung,
sondern die Zeile überhaupt.

**Erst zusammengeführt, dann ausgeliefert.** Die Logik stand vollständig in
`routes/finance.ts`. Sie einfach ein zweites Mal nach `routes/api_v1/` zu
kopieren wäre genau das Muster, an dem der Set-Verlauf schon einmal
auseinandergelaufen ist (zwei Fassungen, unterschiedliche Zustandsauflösung,
„−32 %" bei unverändertem Preis). Sie liegt jetzt in `utils/priceHistory.ts`
neben der Set-Fassung:

* `getPartPriceHistory(uid, partNumber, colorId, currency)`
* `getMinifigPriceHistory(uid, figNumber, currency)`
* `conditionRows()` von dort mitgezogen

Beide Arten teilen sich intern `manualPriceHistory()` — die vier Routen
(zweimal Webapp, zweimal `/api/v1`) sind dünne Adapter.

**Neu:** `GET /api/v1/parts/:partNumber/:colorId/price-history` und
`GET /api/v1/minifigs/:figNumber/price-history`. Die Teile-Route steht ganz
unten in der Datei: Express probiert der Reihe nach, und ein Muster mit zwei
Platzhaltern würde sonst auch auf feste Pfade passen.

**Parität.** Beide Paare in `api-inventory.test.js` auf `paritaet` umgestellt
und in `api-parity.test.js` geprüft — Feld für Feld, nicht nur „ähnlich".

Dabei aufgefallen: Die bestehende Set-Paritätsprüfung las noch `v1.history`,
das Feld gibt es seit hardened-89 nicht mehr. Sie lief seither ins Leere und
fiel nur nicht auf, weil sie ohne Postgres übersprungen wird. Sie vergleicht
jetzt `history_new`, `history_used`, `by_condition` und `chart`.

Stand: `tsc --noEmit` sauber, 312 Tests, 0 Fehler (4 übersprungen mangels
Postgres) — die beiden neuen Paritätsprüfungen sind darin ebenfalls
übersprungen.

---

## Finanztabelle: Detail-Dialog auch für Teile und Minifiguren

Die Set-Zeilen öffnen den Detail-Dialog (`openModal`); die Zeilen manueller
Teile und Minifiguren waren die einzigen in dieser Tabelle, die auf einen Klick
nicht reagierten. Sie tragen jetzt dieselben `data-click`-Angaben wie die
Kacheln im jeweiligen Reiter (`openManDetail`).

**Dabei einen stillen Fehler gefunden.** `openManDetail()` las den Eintrag aus
`manualPartsCache` / `manualFigsCache` — und die füllen die Reiter Teile und
Minifiguren. Aus der Finanztabelle heraus ist der passende Reiter oft nie
geöffnet worden; dann war der Eintrag nicht im Cache, und die Funktion stieg
mit `if (!item) return;` aus. Der Dialog wäre also gar nicht aufgegangen, ohne
Meldung, ohne Spur in der Konsole. Fehlt der Eintrag, wird die jeweilige Liste
jetzt einmal nachgeladen und erneut gesucht.

**Test angepasst, nicht umgangen:** Die Prüfung „Detail-Dialog lädt Bilder über
den Proxy" schnitt 1300 Zeichen ab `G('man-detail-img')` heraus. Der
Nachladepfad hat die geprüfte Zuweisung aus diesem Fenster geschoben — das
Fenster ist jetzt grosszügiger. Ein knapp bemessener Ausschnitt macht die
Prüfung von jeder Zeile abhängig, die jemand dazwischen einfügt, und meldet
dann einen Fehler, den es nicht gibt.

Stand: 312 Tests, 0 Fehler (4 übersprungen mangels Postgres).

---

## Minifiguren ohne BrickLink-Nummer: geschätzter Preis wurde nirgends abgelegt

**Gemeldet** (Screenshot, `fig-015788` „Anthony", BrickLink-Nr. leer): Im
Detail-Dialog standen bei „Marktpreis (Neu)" und „Marktpreis (Gebraucht)" nur
Striche, der Preisverlauf meldete „Noch keine Verlaufsdaten" — obwohl in beiden
Zuständen ein Kaufpreis erfasst war.

**Ursache.** Für Figuren ohne BrickLink-Nummer kommt der Marktpreis aus
`estimateFigPriceFromParts()`. Die Funktion rechnete bei jedem Aufruf frisch
und legte das Ergebnis **nirgends** ab. Marktpreis-Zeile und Diagramm lesen
aber `minifig_price_cache` bzw. `minifig_price_history` (über
`utils/priceHistory.ts`) — und für genau diese Figuren blieb dort für immer
alles leer.

Ein echter BrickLink-Abruf schreibt beide Tabellen seit jeher
(`fetchMinifigPrice`). Der Schätzpfad war der einzige, der es nicht tat: Die
Zahl existierte nur so lange, wie die Bewertung lief.

Er schreibt jetzt dieselben zwei Tabellen — je Zustand einen Eintrag, nur bei
mindestens einem bepreisten Teil (ein Nullpunkt sähe im Diagramm aus wie ein
Kurssturz). Beide Tabellen sind benutzerunabhängig, was passt: Die Schätzung
stammt aus BrickLink-Teilepreisen, nicht aus dem Bestand. Nur die Währung kommt
aus den Nutzereinstellungen und steht deshalb im Schlüssel.

**Sichtbar wird es nach dem nächsten Bewertungslauf** — beim Öffnen der Reiter
Minifiguren oder Finanzen. Der Dialog selbst holt keine Preise, er zeigt nur,
was abgelegt ist.

**Falls die Striche bleiben:** Dann liefert die Schätzung selbst nichts, weil
Rebrickable für die Figur keine Teile-Zusammensetzung kennt oder kein Teil
einen Preis hat. Die Logzeile sagt, welcher Fall vorliegt:
`[minifig-price-estimate] fig-015788 (N): 0/7 Teile bepreist, geschätzt=—`.

Stand: `tsc --noEmit` sauber, 313 Tests, 0 Fehler (4 übersprungen mangels
Postgres).

---

## Anmelden mit E-Mail-Adresse ging nicht — obwohl es überall so steht

**Gemeldet.** Wer im Login-Feld seine E-Mail-Adresse eintippte, bekam
„Benutzername darf nur Buchstaben, Zahlen und _.- enthalten (3–32 Zeichen)."

Über dem Feld steht „Benutzername oder E-Mail", und die Abfrage sucht auch in
beiden Spalten (`LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)`).
Dazwischen sass ein Wächter, der **nur** das Benutzernamen-Muster zuliess: Das
`@` fällt durch, und ein 3-Zeichen-Minimum passt zu Adressen ohnehin nicht. Die
Anmeldung per E-Mail war damit seit jeher unmöglich — die Abfrage dahinter kam
nie zum Zug.

**Der Wächter bleibt**, er kennt jetzt beide Formen: `isValidLoginIdentifier()`
in `utils/auth.ts` akzeptiert das Benutzernamen-Muster **oder** eine
E-Mail-Adresse. Ganz weglassen wäre falsch — er hält Unsinn von der Abfrage und
vom Brute-Force-Zähler fern, der je Kombination aus IP und Anmeldename zählt.

Die Meldung heisst jetzt „Bitte Benutzername oder E-Mail-Adresse eingeben." Die
alte sprach von erlaubten Zeichen im Benutzernamen und schickte damit in die
falsche Richtung.

**Beide Login-Wege**, Webapp und `/api/v1` (Android), benutzen denselben
Prüfer. Ein Test hält fest, dass keiner von beiden eine eigene Kopie des
Musters zurückbekommt — sonst funktionierte die Anmeldung per E-Mail nur auf
einem der beiden Wegen.

**Registrieren und Profil-Update bleiben beim Benutzernamen-Muster.** Sonst
könnte jemand die E-Mail-Adresse eines anderen als Benutzernamen eintragen und
dessen Anmeldung an sich ziehen — der Login sucht ja in beiden Spalten. Auch
das hält ein Test fest.

**Nebenbei:** Die E-Mail-Regex stand dreimal wortgleich im Projekt; die
Registrierung benutzt jetzt `EMAIL_RE` und `USERNAME_RE` aus `utils/auth.ts`.

Stand: `tsc --noEmit` sauber, 317 Tests, 0 Fehler (4 übersprungen mangels
Postgres).

---

## Haushalt, Durchgang 1: Konten verknüpfen

Fundament für die Familiensicht. Diese Runde bringt Verknüpfung, Regeln und
Einstellungsseite — die zusammengefassten Ansichten kommen in Durchgang 2.

**Ablauf.** Das Hauptkonto erzeugt in den Einstellungen einen Einladungscode,
das andere Konto gibt ihn in **seinen** Einstellungen ein. Damit haben beide
Seiten zugestimmt: der eine durch Erzeugen, der andere durch Einlösen. Eine
Verknüpfung ohne Zutun der Gegenseite gibt es nicht.

**`utils/household.ts` ist die eine Stelle**, an der „wessen Daten?"
beantwortet wird — `resolveHousehold()` liefert das Blickfeld, alles Weitere
baut darauf auf. Die Routen fragen den Helfer und nie selbst `account_links`
ab; ein Test hält das fest. Bei der Zustandsauflösung ist genau diese Streuung
schon einmal passiert (fünf Fundorte, leicht verschieden).

**Die Grenzen** stecken im Helfer, nicht in den Routen:

* **Eine Stufe, beide Richtungen.** Wer Unterkonten hat, kann nicht Unterkonto
  werden; wer Unterkonto ist, kann weder einladen noch aufnehmen. Fehlte eine
  der drei Prüfungen, entstünde eine Kette, für die jede Abfrage eine rekursive
  Auflösung samt Zyklusschutz bräuchte.
* **Gleiche Währung**, geprüft beim Einlösen. Sonst summierte die Haushaltssicht
  CHF und EUR — kommentarlos falsch, und der Zahl sieht man es nicht an.
* **Ein Konto gehört zu höchstens einem Haushalt** (UNIQUE auf `sub_user_id`).
* **Lesen weit, Schreiben eng.** Der Haushalt erweitert das Blickfeld. Ob jemand
  etwas ändern darf, beantwortet `canWriteFor()` ausdrücklich — nicht als
  Nebenwirkung des Blickfelds. Ein Unterkonto hat das Hauptkonto **nicht** im
  Blickfeld; der Hauptaccount ist eine Sicht, kein gemeinsamer Topf.

**Der Code** steht nur als SHA-256 in der Datenbank (wie API-Tokens und
QR-Anmeldecodes), gilt 24 Stunden und ist einmalig einlösbar. Er wird atomar
entwertet — zwei gleichzeitige Versuche können nicht beide durchkommen — und
bei jeder abgelehnten Regel **wieder freigegeben**: Sonst wäre er nach einem
Währungsfehler verbraucht, obwohl niemand verknüpft wurde.

**Entkoppeln dürfen beide Seiten.** Ein Unterkonto, das nicht mehr mitmachen
will, wäre sonst auf das Wohlwollen des Hauptkontos angewiesen. Daten bleiben,
wo sie sind.

**Oberfläche.** Neue Karte „👪 Haushalt" in den Einstellungen, die je nach
Rolle nur den passenden Kasten zeigt — ein Knopf, der immer eine Fehlermeldung
erzeugt, ist schlimmer als keiner. Vollständig DE/EN.

**Endpunkte** (Webapp und `/api/v1` gleichermassen, in der Inventur als
`paritaet` geführt): `GET household`, `POST household/invite`,
`POST household/redeem`, `POST household/unlink`.

**Tests.** `test/household.test.js` mit 10 Prüfungen — jede Regel einzeln, dazu
die Freigabe des Codes bei Ablehnung und die Rollenlogik der Oberfläche.

Zwei Funde beim Bauen: Mein `onclick="this.select()"` am Code-Feld hätte die
geschlossene CSP unterlaufen (jetzt `data-click`), und ein `t()` in einem Toast
hätte „Marco &amp; Co" angezeigt statt „Marco & Co" (jetzt `tRaw()`). Beides
fanden die bestehenden Tests.

Stand: `tsc --noEmit` sauber, 327 Tests, 0 Fehler (4 übersprungen mangels
Postgres). Die Migration selbst konnte ich hier nicht laufen lassen.

---

## Haushalt, Durchgänge 2–5: zusammengefasste Sicht, Finanzen, Verschieben, Schreibrechte

Serverseite und Webapp. Die Android-App zieht später nach.

### Kein Umschalter

`scopeIds(uid)` liefert das Blickfeld, und dieses ist zugleich der
Schreibbereich: Ein Hauptkonto sieht und ändert seinen Haushalt, alle anderen
nur sich selbst. Ein Schalter „Haushaltssicht ein/aus" wäre eine zweite
Wahrheit darüber, was gerade auf dem Schirm steht — jede Summe, jeder Zähler
und jedes Diagramm müsste ihn kennen.

`canWriteFor()` bleibt trotzdem: Wenn ein Zielkonto **ausdrücklich** benannt
wird (Erfassen mit Kontoauswahl, Verschieben), genügt „steht im Blickfeld"
nicht — dort muss die Richtung stimmen. Ein Unterkonto darf nicht ins
Nachbarkonto schreiben, auch wenn beide im selben Haushalt sind.

### Listen (Durchgang 2)

36 Vergleiche in `utils/handlers.ts` auf `user_id = ANY($1)` umgestellt, 15
Handler normalisieren die ID zu einer Liste.

**Ein Set, eine Zeile.** Besitzen zwei Kinder dasselbe Set, erscheint es
einmal — mit der Summe der Mengen und den Kaufpreisen aller Besitzer. Das
Verdichten steckt in einer Unterabfrage, die dieselben Spaltennamen liefert wie
die Tabelle; Filter, Sortierung, Seitenaufteilung und der Erfassungs-JOIN
bleiben dadurch unverändert, nur die Quelle ist eine andere. Ohne Haushalt wird
gar nicht erst gruppiert — dann ist es wörtlich die alte Abfrage.

`owners` (IDs plus Namen, eine Abfrage für die ganze Seite) hängt nur im
Haushalt an der Antwort. Im Einzelkonto stünde an jeder Kachel „gehört mir",
und das ist Rauschen.

### Finanzen und Portfolio (Durchgang 3)

Alle vier Rechner und `resolveSetCondition` nehmen das Blickfeld.

Die **Portfoliokurve** umgeht für Haushalte bewusst die Schnappschüsse: Die
liegen je Konto unter `__portfolio__<id>` und werden geschrieben, wann der
jeweilige Lauf lief. Sie zu addieren hiesse, Punkte verschiedener Tage zu
summieren — wo einem Konto ein Tag fehlt, fiele die Kurve ein, ohne dass etwas
passiert wäre. Stattdessen wird aus dem Preisverlauf **je Set** rekonstruiert;
der ist nicht kontogebunden, die Haushaltskurve stimmt damit **rückwirkend**
auch für die Zeit vor der Verknüpfung.

### Verschieben (Durchgang 4)

`POST /api/sets/:sn/move`. Verschieben heisst oft Verschmelzen: `sets` ist je
Konto und Setnummer eindeutig. Mengen werden addiert, die Erfassungen wandern
**einzeln** über `recordAcquisitionForDay()` — treffen dabei zwei Erfassungen
desselben Tages aufeinander, fasst der Helfer sie mengengewichtet zusammen.
Ein direktes `UPDATE user_id` hinterliesse zwei Zeilen desselben Tages, also
genau den Zustand, den der Bearbeiten-Pfad ablehnt.

Serialisiert per Advisory-Lock auf dem Quellkonto. Anleitungen bleiben, wo sie
sind — sie hängen an Datei und Konto, nicht am Exemplar.

### Schreibrechte (Durchgang 5)

`owner_user_id` bei `POST /api/sets` und `/add-stream`, geprüft über
`resolveOwner()` → `canWriteFor()`. Ohne Angabe bleibt es beim eigenen Konto;
ohne Recht kommt 403 statt stillschweigend das eigene Konto.

### Oberfläche

Besitzer-Plakette auf der Galerie-Kachel, Kontoauswahl im Erfassen-Formular
(verborgen, solange es nichts zu wählen gibt), Verschieben-Auswahl im
Set-Dialog. Die Quellliste enthält nur Konten, die das Set **tatsächlich**
besitzen — sonst böte die Oberfläche eine Auswahl an, die der Server mit 404
beantwortet. „Verschmolzen" bekommt eine eigene Meldung: Wer danach zwei Zeilen
erwartet, würde sonst einen Fehler vermuten.

### Bewusst zurückgestellt

`parts_summary` ist ein Cache **je Konto**. Ein Haushalt müsste ihn über alle
Konten verdichten und für jedes einzeln frisch halten — beides ist nicht
gebaut, deshalb nimmt der Haushalt den Live-Pfad: langsamer, aber richtig.
`ensureFresh()` meldet für eine Liste mit mehr als einem Konto grundsätzlich
`false`; „eines von drei ist frisch" als „frisch" zu melden wäre die Art
Halbwahrheit, die später als falsche Zahl erscheint.

### Tests

`test/household.test.js` auf 17 Prüfungen erweitert (Blickfeld ohne
Umschalter, Verdichtung, rückwirkende Kurve, Verschieben über die Tagesregel,
Schreibrichtung, Live-Pfad, Oberflächenregeln). Vier bestehende Prüfungen
bildeten Namen oder Zeilenabstände ab, die der Umbau verschoben hat, und sind
angepasst — die geschützte Absicht blieb jeweils dieselbe.

Neue Endpunkte in der Inventur: `POST /api/sets/:sn/move` und
`GET /api/sets/household-members`, beide als `nur-web` — die Android-App
bekommt sie, wenn die Haushaltssicht dort ankommt.

Stand: `tsc --noEmit` sauber, 334 Tests, 0 Fehler (4 übersprungen mangels
Postgres).

---

## Die Kaufpreis-Regel im Wortlaut — und an genau einer Stelle

> **Pro Tag, Element und Benutzer gibt es genau EINEN Kaufpreis.**
>
> Ein Element ist ein Set, ein manuell erfasstes Teil oder eine manuell
> erfasste Minifigur — dieselbe Regel, nur ein anderer Schlüssel.

Der Satz steht jetzt so am Anfang von `utils/acquisitions.ts`, und die
Schlüssel je Art (`set_number` / `part_number` + `color_id` / `fig_number`)
stehen dort in `SHAPES` an einer Stelle. Sonst hiesse „Element" je nach
Aufrufer etwas anderes — ein Teil ist erst mit der Farbe eindeutig.

**Vier Kopien der Regel zusammengeführt.** Die drei Datums-Endpunkte hatten je
eine wortgleiche Kollisionsabfrage; sie laufen jetzt über
`findSameDayAcquisition(kind, …)`. Ein Test lässt keine eigene Kopie mehr durch.

**Die vierte Kopie steckte in `adjustAcquisitionsToQuantity()`** — und war
nicht nur eine Doppelung, sondern falsch: Ist die neueste Erfassung von heute,
erhöhte der Zweig **nur die Menge** und liess den Kaufpreis stehen. Ein heute
dazugekauftes Exemplar zum aktuellen Marktpreis verschwand damit im alten
Stückpreis — die Zeile zeigte zwei Stück zum Preis des ersten. Jetzt läuft auch
die Erhöhung über `recordAcquisitionForDay()`, das mengengewichtet mittelt wie
überall sonst; der Marktpreis wird dafür immer ermittelt, nicht nur beim
Neuanlegen. Die Hilfsfunktion `isToday()` ist entfallen.

**Beim Verschieben** galt die Regel schon: Die Erfassungen wandern einzeln
durch denselben Helfer, und weil er je Benutzer greift, entsteht im Zielkonto
auch dann nur eine Tageszeile, wenn beide Konten am selben Tag gekauft haben.

**Tests.** Zwei neue in `test/manual-acq-refresh.test.js` (Regel im Wortlaut
und Schlüssel je Art; Erhöhung mittelt statt stehen zu lassen), eine bestehende
auf den gemeinsamen Prüfer umgeschrieben.

Stand: `tsc --noEmit` sauber, 336 Tests, 0 Fehler (4 übersprungen mangels
Postgres).

---

## Haushalt: Kontoauswahl und Besitzer auch bei Teilen und Minifiguren

Zwei Lücken aus dem letzten Durchgang.

**1. Erfassen für ein anderes Konto ging nur bei Sets.** `owner_user_id` gab es
an `POST /api/sets` und `/add-stream` — die Anlege-Pfade für manuelle Teile und
Minifiguren nicht. Ein Elternteil konnte ein Set für ein Kind erfassen, ein
einzelnes Teil aber nicht; die Regel „Hauptkonto wählt beim Erfassen das Konto"
war damit nur zur Hälfte wahr.

Die Auflösung ist dabei von `routes/sets.ts` nach `utils/household.ts` gewandert
(`resolveWriteTarget`). Drei Kopien einer Rechteprüfung sind die Sorte
Doppelung, bei der irgendwann eine grosszügiger ist als die anderen. Alle drei
Routen antworten jetzt mit 403 statt stillschweigend auf das eigene Konto
zurückzufallen; ohne Angabe bleibt alles wie vor der Haushaltssicht.

In der Oberfläche haben alle drei Erfassen-Formulare dieselbe Auswahl, gefüllt
aus einer Liste (`loadHouseholdMembers`), und verborgen, solange es nichts zu
wählen gibt.

**2. Besitzer-Plakette gab es nur auf der Galerie-Kachel.** Jetzt auch auf den
Kacheln manuell erfasster Teile und Minifiguren sowie in allen Finanzzeilen.

Dabei eine bewusste Abweichung von den Sets: **Manuelle Teile und Minifiguren
werden NICHT verdichtet.** Zwei Konten mit demselben Teil sind zwei Bestände
mit eigener Menge und eigenem Kaufpreis, und jeder Bearbeiten-Weg (Menge,
Preis, Löschen) führt auf genau eine Zeile. Sie zusammenzufalten hiesse, für
jede Änderung wieder auseinanderzunehmen, wem was gehört. Die Plakette macht
sichtbar, warum dasselbe Teil zweimal erscheint. Bei Sets ist das anders, weil
dort das Verschieben ohnehin je Besitzer aufgelöst wird.

`withOwners()` (Listen) und `withOwnerNames()` (Bewertung) hängen die Namen mit
**einer** Abfrage je Liste an, nicht einer je Zeile — und nur im Haushalt.

**Dabei einen eigenen Fehler gefunden:** Beim Verschieben der Auflösung aus
`routes/sets.ts` hatte mein Löschschnitt die Route `POST /api/sets/:sn/move`
mitgenommen. Aufgefallen ist es nicht beim Lesen, sondern durch
`api-inventory.test.js` — „klassifizierte Endpunkte existieren nicht mehr". Die
Route ist wiederhergestellt.

**Tests.** `test/household.test.js` auf 18 Prüfungen: Schreibrichtung jetzt über
alle drei Anlege-Pfade, Besitzer in Listen und Bewertung, Kontoauswahl in allen
drei Formularen.

Stand: `tsc --noEmit` sauber, 337 Tests, 0 Fehler (4 übersprungen mangels
Postgres).

---

## Teile-Zusammenfassung im Haushalt — und Kontofilter je Ansicht

### Die Zusammenfassung trägt jetzt über mehrere Konten

Bisher nahm ein Haushalt für die Teileliste den Live-Pfad: korrekt, aber
langsam. Die Tabelle `parts_summary` ist je Konto aufgebaut (Schlüssel
`user_id, part_key, color_id`) — für den Haushalt wird jetzt über alle
beteiligten Konten gelesen und **über `part_key` verdichtet**. Dasselbe Teil in
zwei Konten ergibt eine Zeile mit der Summe, genau wie dasselbe Teil aus zwei
Sets innerhalb eines Kontos.

Zwei Fallen dabei, beide per Test festgehalten: Ohne `GROUP BY` erschiene das
Teil je Konto einmal, und die Gesamtzahl zählte Konten statt Teile — deshalb
zählt auch `COUNT(*)` über eine gruppierte Unterabfrage, und die Farbstatistik
über `COUNT(DISTINCT part_key)`.

`ensureFresh()` prüft jedes Konto einzeln und meldet nur frisch, wenn **alle**
es sind. „Zwei von drei sind aktuell" ergäbe eine Summe aus frischen und alten
Beständen, und der Zahl sieht man das nicht an. Fehlende Konten werden im
Hintergrund aufgebaut; bis dahin greift wie bisher der Live-Pfad.

### Kontofilter je Ansicht

Ein Hauptkonto schaltet in Galerie, Teilen, Minifiguren und Finanzen zwischen
**Alle Konten / Eigene / Unterkonten** um — je Ansicht getrennt. Wer in der
Galerie den ganzen Haushalt sieht, will in den Finanzen womöglich nur die
eigenen Zahlen.

Das korrigiert meine frühere Festlegung („kein Umschalter"). Der Einwand von
damals bleibt aber gültig und bestimmt die Umsetzung: Der Wert reist als
`accounts=` mit der Anfrage und wird an **einer** Stelle in Konto-IDs
übersetzt (`scopeIds(uid, mode)`). Dadurch kennt ihn jede Zahl derselben
Antwort automatisch — Liste, Gesamtzahl, Kennzahlen und Summen entstehen aus
derselben ID-Liste. Clientseitig zu filtern hätte zwar die Kachelwand
ausgesiebt, aber weder die Gesamtzahl darunter noch die Bewertung im
Finanzreiter.

Ein Test lässt keinen `scopeIds`-Aufruf ohne Filter mehr durch: Ein Lesepfad,
der ihn vergisst, zeigte stumm den ganzen Haushalt, während die Ansicht daneben
gefiltert ist.

Weitere Festlegungen:

* Für ein Konto **ohne** Unterkonten ist der Filter wirkungslos, und die
  Auswahl bleibt verborgen — ein Filter mit einer möglichen Antwort ist keine
  Wahl.
* `'subs'` bei einem Konto ohne Unterkonten ergäbe eine leere Ansicht ohne
  erkennbaren Grund; `scopeIds()` fängt das ab.
* Unbekannte Werte fallen auf `'all'` zurück statt die Ansicht zu leeren.
* Die Wahl liegt im `localStorage`, nicht auf dem Server: Sie ist eine
  Ansichtseinstellung wie „Kachel oder Tabelle" — am Telefon will man sie
  womöglich anders als am Rechner.
* Umgeschaltet wird **nur die betroffene Ansicht** neu geladen. Alle vier
  gleichzeitig anzufassen würde drei Ansichten neu laden, die niemand ansieht,
  und dabei Preisabrufe auslösen.

Im Finanzreiter tragen alle fünf Abfragen den Filter — die vier Bewertungen und
die Portfoliokurve. Sonst stünde eine Summe aus einem Blickfeld neben einer
Aufstellung aus einem anderen.

**Tests.** `test/household.test.js` auf 22 Prüfungen; zwei bestehende auf das
neue Verhalten umgeschrieben (die Zusammenfassung nimmt nicht mehr den
Live-Pfad, und aus „kein Umschalter" ist „der Filter wird am Server in IDs
übersetzt" geworden).

Stand: `tsc --noEmit` sauber, 339 Tests, 0 Fehler (4 übersprungen mangels
Postgres).

---

## Gegen eine echte Datenbank getestet — drei stille Fehler gefunden

Bis hierher liefen alle Haushalts-Änderungen nur als Quelltext-Prüfungen. In
diesem Durchgang lief die Suite erstmals gegen ein echtes Postgres: **391
Tests, 0 Fehler, 0 übersprungen** (vorher 339 mit 4 übersprungenen Dateien).

**Fund 1 — alle vier Finanz-Endpunkte antworteten mit 500.**
`invalid input syntax for type integer: "{"2"}"`. Bei der Umstellung auf
`user_id = ANY($1)` bekam `getSetting(uid, …)` die ID-**Liste** statt einer ID.

Das war mehr als ein Tippfehler: In `uid` steckten zwei verschiedene Dinge. Die
Rechner nehmen jetzt beide getrennt entgegen — `viewerId` (wessen
Einstellungen gelten: Währung, Cache-Dauer, Preisart) und `ids` (wessen Daten
gerechnet werden). Sie fallen auseinander, sobald der Kontofilter auf
„Unterkonten" steht: Dann enthält `ids` das fragende Konto gar nicht, und
`ids[0]` wäre die Währung eines Kindes gewesen. Dasselbe in
`getPortfolioHistory()`.

**Fund 2 — der API-Paritätstest war seit hardened-59 tot.** Er lud
`routes/api_v1/index.js` aus dem Quellordner; das Kompilat liegt seither unter
`dist/`. Ergebnis `MODULE_NOT_FOUND` — unbemerkt, weil die ganze Suite ohne
Postgres übersprungen wird.

**Fund 3 — derselbe Test seedete einen unbrauchbaren Token.** Der Kommentar
versprach, `validateToken()` migriere Klartext beim ersten Treffer auf den
Hash. Diesen Rückfallpfad gibt es längst nicht mehr (er hätte einen erratenen
Token dauerhaft gültig gemacht); der Kommentar blieb stehen, der Test seedete
weiter Klartext. Jetzt als Hash.

Dazu zwei Hygienefunde: `parts-summary` und `schema-init` schlossen ihren
Verbindungspool nie — mit Datenbank hing der Prozess danach, und der Läufer
meldete beide Dateien rot, obwohl jede Prüfung grün war.

### Neu: `test/household-db.test.js`

Neun Prüfungen gegen echtes Schema und echte Abfragen, mit drei Konten:
Verknüpfen samt Währungsprüfung und Einmal-Einlösung, Blickfeld und
Kontofilter, eine Stufe in beide Richtungen, Verdichtung zweier Bestände zu
einer Zeile (Menge addiert, Kaufpreis gewichtet: 1×100 + 2×160 → 140),
Kennzahlen unter dem Filter, Verschieben über die **echte Route**, Rechte, und
Entkoppeln.

Der Seed führt `runMigrations()` aus: `initSchema()` legt nur die
Grundtabellen an, `account_links` kommt aus `db/migrations/0005`. Ohne den
Schritt liefe der Test gegen ein Schema, das es im Betrieb nicht gibt.

## Verschieben nimmt Teile, Minifiguren und Anleitungen mit

Sie gehören zum Exemplar, nicht zum Konto: Wandert das Set, wandert sein
Inhalt. Bliebe er zurück, hätte das Quellkonto Teile aus einem Set, das es
nicht mehr besitzt — sichtbar in der Teileliste, aber ohne Herkunft — und im
Zielkonto fehlten sie.

Hier genügt ein `UPDATE` der `user_id`: Anders als bei den Erfassungen gibt es
keine Regel „eine Zeile pro Tag und Element", und die Tabellen haben keinen
eindeutigen Schlüssel über `(user_id, set_number, …)`. Besitzt das Zielkonto
dasselbe Set schon, stehen seine Teile danach doppelt — richtig so, es sind
zwei Exemplare.

`COALESCE(source,'set') <> 'manual'` schützt manuell erfasste Teile und
Minifiguren: Sie hängen an keinem Set und dürfen nie mitwandern. Ein Test prüft
das an **beiden** Anweisungen einzeln, nicht per Zählung — der Kommentar
darüber nennt dieselbe Bedingung.

**Anleitungen ebenfalls**, obwohl nicht ausdrücklich verlangt: Sie hängen an
(Konto, Setnummer), und die Galerie zeigt sie nur zu Sets, die das Konto
besitzt. Bliebe die Zeile stehen, wäre sie für die Quelle unsichtbar und im
Ziel nicht vorhanden, obwohl die Datei auf der Platte liegt. Sag Bescheid,
falls sie stattdessen beim alten Konto bleiben sollen.

Die Erfolgsmeldung nennt jetzt die Zahlen — dass Teile mitwandern, sieht man in
der Galerie nicht, und wer es nicht erwartet, sucht sie später im falschen
Konto.

---

## Nachtrag: die 500er im Finanzen-Reiter sind hardened-106

Gemeldet aus der Browser-Konsole: fünfmal 500 auf `/api/finance/valuation`,
`parts-valuation`, `minifigs-valuation` und `pnl` — der Finanzen-Reiter blieb
leer.

Das ist derselbe Fehler, den der erste Datenbanklauf gefunden hat: `getSetting()`
bekam nach der Umstellung auf `user_id = ANY($1)` die ID-**Liste** statt einer
ID. Er traf **jedes** Konto, nicht nur Haushalte — `scopeIds()` liefert immer
eine Liste. Behoben in hardened-106 (viewerId und ids getrennt); Stände 102–105
sind davon betroffen.

Alle `getSetting()`-Aufrufe im Projekt noch einmal durchgesehen: Die übrigen
bekommen durchweg eine einzelne ID (`req.session.userId`, `req.apiUser.user_id`
oder ein daraus abgeleitetes `uid`).

**Neue Prüfung**, damit diese Klasse nicht wiederkommt: Der Datenbanktest ruft
jetzt alle fünf Finanz-Endpunkte in **jedem** Kontofilter auf (`all`, `own`,
`subs`) und erwartet 200. Der Paritätstest deckte nur den Fall ohne Filter ab —
und `accounts=subs` ist der heikelste, weil dort das fragende Konto gar nicht in
der ID-Liste steht. Zusätzlich wird geprüft, dass die Währung in genau diesem
Fall vom fragenden Konto stammt und nicht aus einem Unterkonto.

Stand: 392 Tests, 0 Fehler, 0 übersprungen.

---

## Build: `python3`, `make` und `g++` entfernt

Die Zeile stand als Vorsorge für `node-gyp` im Build-Stage: Ein Paket mit
nativer Erweiterung baut beim Installieren aus C++-Quellen, und auf Alpine ist
nichts davon vorinstalliert — `npm ci` bricht dann mit einer schwer lesbaren
Meldung ab.

Gebraucht wird sie nicht: keine einzige `binding.gyp` im Abhängigkeitsbaum, und
die einzigen Pakete mit Install-Skript sind `esbuild` (lädt eine fertige
Binärdatei für die Plattform) und `fsevents` (macOS-only, auf Linux gar nicht
installiert). Die üblichen Verdächtigen liegen alle in der reinen
JavaScript-Variante vor: `bcryptjs` statt `bcrypt`, `pg` ohne `pg-native`,
`jimp`, `pdfkit`.

**Nachgewiesen, nicht angenommen:** `npm ci`, `build-ts`, `build-frontend` und
`tsc --noEmit` laufen mit `python3`, `make`, `g++`, `gcc` und `cc` durch
Platzhalter ersetzt, die mit Exit-Code 127 abbrechen — nichts davon greift
danach.

Das Laufzeit-Image wird dadurch nicht kleiner (es ist ein eigenes Stage und
installierte nur `su-exec`); gespart werden rund 200 MB Bauzeit-Ballast bei
jedem Build ohne Layer-Cache.

**Damit es auffällt, wenn sich das ändert:** `test/dockerfile.test.js` prüft
beides zusammen — die Werkzeuge dürfen nur fehlen, solange auch wirklich nichts
kompiliert. Kommt eine Abhängigkeit mit `binding.gyp` oder einem unbekannten
Install-Skript dazu, wird der Test rot und nennt die Zeile, die dann zurück ins
Build-Stage gehört. Ein `npm ci`, das mit „gyp ERR! find Python" abbricht, ist
deutlich schwerer zu deuten.

Die Zeile selbst steht als Kommentar im Dockerfile — zum Zurückholen genügt
Einfügen.

Stand: 394 Tests, 0 Fehler, 0 übersprungen (gegen echtes Postgres).

---

## Verschieben auf Kaufpreis-Ebene, in beide Richtungen

**Der Kaufpreis ist die Ebene, auf der ein Exemplar wirklich existiert.** Ein
Set mit drei Erfassungen sind drei Käufe, die verschiedenen Kindern gehören
können. Deshalb steht der Eigentümer jetzt **je Zeile im Kaufpreis-Dialog** —
als Auswahlfeld, wie vorgeschlagen. Das ganze Set auf einmal geht weiterhin
über den Dialog-Fuss.

Beides läuft durch **eine** Umsetzung (`utils/setMove.ts`): Der Teilfall ist
kein Sonderweg, sondern der allgemeine Fall mit einer Auswahl
(`acquisition_ids`). Ein Test hält fest, dass beide Routen denselben Helfer
rufen.

Richtung Hauptkonto funktioniert damit ebenfalls: `resolveWriteTarget()` prüft
Quelle **und** Ziel, und für das eigene Konto ist die Antwort immer ja. Ein
Unterkonto kann weiterhin nichts umhängen — auch nicht ins Geschwisterkonto.

### Teile kopieren statt umhängen

Beim Teilverschieben behält der Absender Exemplare — und damit auch deren
Teile. `parts.quantity` ist die Menge für **ein** Set; die Gesamtmenge entsteht
erst durch Multiplikation mit `sets.quantity`. Das Zielkonto bekommt deshalb
eine **Kopie** der Zeilen, keine Verschiebung. Erst wenn beim Absender das
letzte Exemplar geht, verschwinden Set und Inhalt dort.

Das korrigiert die Fassung aus hardened-106, die schlicht `user_id`
umgeschrieben hat — beim Teilfall wäre die Quelle mit Exemplaren ohne Teile
zurückgeblieben.

**Ein Fehler, den erst der Datenbanktest fand:** Die erste Kopierregel prüfte,
ob das Ziel *das Set* schon hat, und übersprang dann das Kopieren. Ein Set kann
aber sehr wohl ohne Teile im Bestand stehen (Erfassung ohne Teile-Import,
abgebrochener Import). Dann wurde nichts kopiert — und anschliessend beim
Absender gelöscht. Die Teile wären weg gewesen. Jetzt wird **je Tabelle**
geprüft, ob das Ziel für dieses Set schon Zeilen hat.

### Migration 0006 für früher verschobene Sets

Bis hardened-105 wanderte beim Verschieben nur das Set. Zurück blieben Zeilen,
die auf ein Set zeigen, das ihr Konto nicht mehr besitzt — beim Absender
sichtbar, aber ohne Herkunft, und im Zielkonto fehlten sie.

`db/migrations/0006` hängt sie um, aber nur wenn **alle drei** Bedingungen
gelten: die Zeile ist verwaist (eigenes Konto hat das Set nicht),
**genau ein** anderes Konto **desselben Haushalts** besitzt es, und dieses
Konto hat noch keine eigenen Zeilen dieser Art. Der Haushaltsbezug ist keine
Kosmetik — ohne ihn wäre „irgendwer besitzt dieses Set" ein Datenleck; ein Test
prüft, dass ein fremdes Konto mit demselben Set nichts abbekommt. Bei zwei
möglichen Zielen im Haushalt bleibt die Zeile liegen: Dann ist nicht
entscheidbar, wem sie gehört, und ein geratenes Ziel wäre schlimmer als ein
Rest zum Nachsehen.

### Nebenwirkung an der Erfassungsliste

`GET /api/sets/:sn/acquisitions` liefert jetzt das Blickfeld statt nur des
eigenen Kontos und je Zeile `owner_user_id` — sonst wüsste die Auswahl nicht,
worauf sie steht. Die `/api/v1`-Route zieht mit; der Paritätstest hätte die
Abweichung ohnehin nicht durchgelassen.

Stand: `tsc --noEmit` sauber, **397 Tests, 0 Fehler, 0 übersprungen** — gegen
echtes Postgres, inklusive drei neuer Prüfungen zum Eigentümerwechsel, zur
verweigerten Geschwister-Verschiebung und zur Migration.

---

## Nachweis: Teilverschiebung kopiert, sie verschiebt nicht

Angefragt: Wird einer von mehreren Kaufpreisen umgehängt, sollen Set, Teile und
Minifiguren in **beiden** Konten existieren.

Das tut hardened-109 bereits — belegt war es aber nur für die Teile. Der
Datenbanktest prüft jetzt alle vier Tabellen (`sets`, `parts`, `minifigs`,
`instructions`) auf beiden Seiten, und zwar auf **genau eine** Zeile je Konto:
Doppelte Zeilen zählte die Teile-Zusammenfassung zweimal, denn die Menge steckt
in `sets.quantity`, nicht in der Zahl der Zeilen.

Zusätzlich hält ein Struktur-Test fest, dass im Teilfall beim Absender **nichts
gelöscht** wird — nur die Stückzahl sinkt. Das ist die Stelle, an der ein
späterer Umbau am leichtesten Schaden anrichtet: Ein `DELETE` aus dem
Vollständig-Zweig, versehentlich eine Ebene zu hoch gezogen, liesse den
Absender mit einem Exemplar ohne Teile zurück — und das fällt erst auf, wenn
jemand seine Teileliste durchsieht.

Zur Klarheit: Beim vollständigen Verschieben (letztes Exemplar) verschwindet
alles beim Absender, das bleibt unverändert.

Stand: 397 Tests, 0 Fehler, 0 übersprungen gegen echtes Postgres.

---

## Kontofilter: jedes Unterkonto einzeln — und er greift jetzt überall

### Ein Eintrag je Unterkonto

Die Auswahl führt jetzt **Alle Konten**, **Eigene** und dann jedes Unterkonto
**namentlich**. Der Sammelposten „Unterkonten" bleibt, erscheint aber nur ab
zwei Kindern — bei einem einzigen wäre er dasselbe wie dessen Name, also eine
Wahl ohne Unterschied.

Serverseitig reist dann die Konto-ID mit (`accounts=<id>`). `scopeIds()` prüft,
ob sie zum Haushalt gehört, und fällt sonst auf das ganze Blickfeld zurück:
**Der Filter ist eine Ansichtshilfe, kein Zugriffsweg.** Ein Test hält fest,
dass eine kontofremde ID nichts freischaltet und ein Unterkonto sich damit
nicht ins Geschwisterkonto sehen kann.

Die Optionen baut jetzt das Frontend (`initScopeSelects`), nicht mehr das
Markup — die Namen kennt erst der Server. Zeigt eine gespeicherte Wahl auf ein
inzwischen entkoppeltes Konto, fällt sie auf „Alle" zurück statt eine leere
Auswahl anzuzeigen.

### Gemeldet: der Filter griff bei manuellen Teilen und Minifiguren nicht

Zwei Ursachen, beide in der Webapp:

**1. Der Umschalter lud die falsche Liste neu.** Die Reiter Teile und
Minifiguren haben je **zwei** Listen — die aus Sets und die manuell erfassten,
die über einen eigenen Endpunkt lädt. `onScopeChange` rief für Teile nur
`loadParts()`; der manuelle Bereich darüber blieb stehen, wie er war. Jetzt
wird auch `loadManualParts()` gerufen (bei den Minifiguren erledigt das
`loadMinifigs()` bereits).

**2. Vier Bewertungsabfragen liefen ungefiltert.** Die Wertangaben neben den
manuellen Listen und die beiden Banner im Finanzreiter holten ihre Summen ohne
`accounts=`. Dadurch stand ein Zähler aus einem Blickfeld neben einer Summe aus
einem anderen — schlimmer als gar kein Filter, weil es nach einer stimmigen
Zahl aussieht. Wichtig dabei: Die Banner im Finanzreiter tragen den Filter der
**Finanzen**, die Angaben neben den Listen den ihres eigenen Reiters.

### Tests

Neu gegen echtes Postgres: einzelne Konto-IDs im Filter, die Abweisung einer
kontofremden ID, und dass `getManualParts`/`getManualMinifigs` unter dem Filter
nur die Einträge des gewählten Kontos liefern.

Stand: `tsc --noEmit` sauber, 398 Tests, 0 Fehler, 0 übersprungen.

---

## Haushalt: die letzten Endpunkte für die Android-App

Damit die App alles erreichen kann, was die Webapp seit hardened-101 kann:

* `GET /api/v1/sets/household-members` — Konten für Kontofilter, Kontoauswahl
  und Verschieben. Steht **vor** `/sets/:setNumber`: Express probiert der Reihe
  nach, und der Platzhalter würde „household-members" sonst als Setnummer lesen.
* `POST /api/v1/sets/:sn/move` — ganzes Set oder einzelne Kaufpreise
  (`acquisition_ids`), über dieselbe Umsetzung wie die Webapp-Route.
* `owner_user_id` an `POST /api/v1/sets`, `/parts` und `/minifigs` — Erfassen
  für ein Unterkonto. Ohne Angabe bleibt es beim eigenen Konto;
  `resolveWriteTarget()` prüft die Richtung, nicht bloss die Mitgliedschaft im
  Blickfeld.

Alle vier in der Inventur auf `paritaet` gestellt.

Stand: `tsc --noEmit` sauber, 398 Tests, 0 Fehler, 0 übersprungen gegen echtes
Postgres.

---

## Verschieben nur noch über den Kaufpreis

Der Verschieben-Kasten im Set-Dialog ist entfernt — in Webapp und App. Bestand
wandert ausschliesslich über die **Eigentümer-Auswahl je Kaufpreis-Zeile**. Wer
ein ganzes Set verschieben will, ändert jede Zeile einzeln.

Der Grund ist nicht Bequemlichkeit, sondern Ehrlichkeit der Anzeige: Ein Set
mit drei Erfassungen sind drei Käufe, und im Haushalt können sie verschiedenen
Kindern gehören. „Das Set verschieben" verdeckt, was tatsächlich wandert — beim
Ändern jeder Zeile sieht man, wie viele es sind.

**Die Regel hängt am Server, nicht an der Oberfläche.**
`POST /api/sets/:sn/move` (und die v1-Route) antwortet ohne `acquisition_ids`
mit 400. Ein Klient, der die Oberfläche umgeht, bekommt keine Ausnahme. Der
Helfer `moveSetBetweenAccounts()` bleibt unverändert — er konnte den Teilfall
schon immer, jetzt ist er der einzige Fall.

**Manuelle Teile und Minifiguren können es jetzt auch.** Bisher liessen sie
sich gar nicht zwischen Konten verschieben; die Regel „nur über den Kaufpreis"
gilt für alle drei Arten, also brauchen sie denselben Weg.
`moveManualAcquisition()` in `utils/setMove.ts` ist die Umsetzung — deutlich
einfacher als bei Sets, weil ein manuell erfasstes Teil keinen Inhalt hat:
keine Unterteile, keine Minifiguren, keine Anleitungen. Es wandern nur Menge
und Erfassung, letztere durch `recordAcquisitionForDay()`, damit im Zielkonto
keine zwei Zeilen desselben Tages entstehen. Bleiben dem Absender Exemplare,
sinkt nur die Stückzahl; geht das letzte, verschwindet seine Stammzeile — eine
Zeile mit Menge 0 ist bei einem manuellen Eintrag kein Bestand, sondern
Ballast.

Angebunden an `PUT /parts/:partNumber/:colorId/acquisitions/:id` und
`PUT /minifigs/:figNumber/acquisitions/:id` über `owner_user_id`, genau wie bei
Sets. Läuft vor allen anderen Feldern und beendet die Anfrage: Preis oder Datum
derselben Zeile im selben Aufruf zu ändern hiesse, sie zweimal zu suchen —
einmal beim Absender, einmal beim Empfänger, wo sie womöglich schon mit einer
Tageszeile verschmolzen ist.

**Nebenwirkung:** Beide Erfassungslisten (Teile und Minifiguren) liefern jetzt
das Blickfeld statt nur des eigenen Kontos und je Zeile `owner_user_id` — sonst
wüsste die Auswahl nicht, worauf sie steht. Webapp und `/api/v1` gleichermassen.

**Tests.** Zwei Struktur-Prüfungen (400 ohne `acquisition_ids`, kein
Verschieben-Kasten mehr in Markup und JS; manuelle Arten über denselben Helfer
mit 403 ohne Schreibrecht) und eine gegen die Datenbank, die den 400er
tatsächlich abholt.

Stand: `tsc --noEmit` sauber, 401 Tests, 0 Fehler, 0 übersprungen gegen echtes
Postgres.

---

## Kaufpreis-Dialog breiter

Seit der Eigentümer-Spalte hat die Tabelle sechs Spalten — Menge, Datum,
Zustand, Preis, Eigentümer, Löschen. Bei den bisherigen 560px lag darüber ein
waagerechter Rollbalken, und ein Dialog, in dem man seitwärts scrollen muss, um
den Löschknopf zu sehen, ist eine Falle.

Jetzt 780px, dazu eine eigene Klasse `.acq-wide`, die etwas Innenabstand
wegnimmt und die Zellen enger setzt — der Platz gehört der Tabelle. Preis- und
Mengenfeld sind ein paar Pixel schmaler.

Der Rollbalken (`.tw{overflow-x:auto}`) bleibt als Rückfall für schmale
Telefone. Dort hilft keine Breite mehr, und die Alternative wäre, Spalten zu
verstecken — was bei einer Tabelle zum Bearbeiten schlechter ist als scrollen.

Gilt für beide Dialoge: Sets und manuelle Einträge teilen sich dieses Fenster.


---

# Review-Reihe hardened-115 bis 125

Elf Durchgänge über Security, Architektur, Performance und
Benutzerfreundlichkeit, ursprünglich in CHANGELOG-hardened-115.md gesammelt.
Hierher überführt, als die Datei bei zehn Nachträgen angekommen war: Ein
Changelog, der nur noch angehängt wird, liest irgendwann niemand mehr — und
die Punkte sind abgeschlossen und verifiziert (zuletzt 428 Tests gegen echtes
Postgres 16).

Die Reihenfolge ist chronologisch, nicht nach Wichtigkeit. Wer nur die
Sicherheitspunkte sucht: Nachtrag 3 (Sitzungen überlebten den
Passwortwechsel), Nachtrag 9 (Anleitungen im Haushalt) und Punkt 27 (jedes
Konto konnte den Preis-Cache leeren).

## Review hardened-115 — Eigentümerwechsel, Build-Artefakte, Mengensperre, CSP

Verifiziert mit `npm run typecheck` (sauber) und `npm test` gegen echtes
Postgres 16 (407 Tests, 0 Fehler, 0 übersprungen).

---

### 1. Eigentümerwechsel griff die falsche Zeile (Webapp) — Fehler

`utils/household.ts`, `routes/sets.ts`, `routes/parts.ts`, `routes/minifigs.ts`,
`public/js/07-admin.js`

Beide Kaufpreis-Dialoge schickten `from_user_id = _acqOwnerId` mit — und das ist
die Dialog-Ebene, also der **Betrachter**. Der Eigentümer der einzelnen Zeile
stand in `a.owner_user_id`, wurde aber nur zum Vorauswählen des Selects benutzt.

Folge im Haushalt: Zog das Hauptkonto eine Zeile, die einem Unterkonto gehört,
zu sich, kam beim Server `from = to = Hauptkonto` an — und der Zweig
`if (from === to) return res.json({ success: true, unchanged: true })` antwortete
mit **Erfolg, ohne dass irgendetwas wanderte**. Kein Fehler, keine Meldung, die
Zeile blieb liegen. Die Android-App war nicht betroffen (`acq.ownerUserId`).

Neu: `acquisitionMoveSource(actorId, kind, acqId)` in `utils/household.ts`
ermittelt den Absender aus der **Zeile**; ein mitgeschicktes `from_user_id` wird
ignoriert. Die Richtungsprüfung bleibt (`canWriteFor`) — eine fremde Zeile
antwortet 403, eine nicht existierende 404. Die Webapp schickt `from_user_id`
gar nicht mehr.

Der Server ist damit die einzige Stelle, die weiss, wem eine Erfassung gehört —
ein Dialog kann die Frage nicht mehr falsch beantworten.

### 2. Eigentümerwechsel über die App war ein stiller No-op — Fehler

`routes/api_v1/acquisitions.ts`

Die Android-App schickt `owner_user_id` an die v1-PUT-Routen. Die gemeinsame
Fabrik dort las aber nur Menge, Preis und Zustand: Die Anfrage lief als **leeres
Update** durch und antwortete `success: true`. Der Wechsel sah in der App aus wie
erledigt (die Liste lud neu), tatsächlich bewegte sich nichts.

Neu: derselbe Eigentümer-Zweig wie in den Session-Routen, für alle drei Arten,
über dieselbe Umsetzung (`utils/setMove.ts`) und mit demselben Sperrschlüssel —
Webapp- und App-Verschiebungen desselben Bestands warten damit aufeinander.

### 3. Rund 60 veraltete Build-Artefakte im Quellbaum

Ein `node scripts/build-ts.js` **ohne** `--outdir` hatte die `.js` wieder neben
ihre Quellen geschrieben (`server.js`, `db/`, `jobs/`, `routes/`, `utils/`).
Sie waren nachweislich alt: `utils/setMove.js` fehlte, der Lauf lag also vor
hardened-109.

Das ist mehr als Unordnung: `server.ts` lädt Module per `require()` ohne Endung,
und Node nimmt eine vorhandene `.js` vor der `.ts` — `npm run dev` konnte
stillschweigend veralteten Code ausführen. Dateien entfernt;
`test/build-tooling.test.js` lässt keine `.js` mehr neben den Quellen zu.

### 4. Mengenänderung lief ohne Sperre und verschluckte Fehler

`routes/sets.ts`

`updateSet()` setzte `sets.quantity` und rief danach
`adjustAcquisitionsToQuantity(…).catch(() => {})` — zwei lose Statements, ohne
Transaktion, ohne Advisory-Lock, mit verschlucktem Fehler. Scheiterte der zweite
Schritt, blieb die Menge erhöht, während die Erfassungen auf dem alten Stand
standen: genau der Drift, gegen den es `utils/txLock.ts` gibt, nur ohne jede
Logzeile. Alle anderen Schreibwege am Bestand laufen längst unter der Sperre.

Neu: beides in **einer** gesperrten Transaktion. Damit der Netzaufruf nicht in
der offenen Transaktion hängt, ist die Preisermittlung als
`priceForNewAcquisition()` herausgezogen und läuft **vor** der Sperre — dasselbe
Muster wie in `routes/api_v1/acquisitions.ts`. Reihenfolge (Cache → BrickLink →
Historie) und Ergebnis unverändert, gegen echtes Postgres nachgestellt:
Erhöhung legt die Tageszeile an, Reduktion bleibt LIFO.

### 5. CSP: `img-src` ohne fremde Hosts

`server.ts`

`img-src` trug ein pauschales `https:` mit der Begründung, Set-Bilder kämen
direkt von den CDNs. Seit hardened-69 stimmt das nicht mehr: `imgUrl()` schickt
jede absolute Adresse durch `/api/img-proxy`, und alle Bilder verlangen
Anmeldung. Die Erlaubnis blieb nur stehen — und ein eingeschleustes
`<img src="https://fremd/?daten">` ist eine Anfrage nach draussen, auch ohne
ausführbares Skript. Genau den Kanal schliesst `connect-src 'self'` auf der
anderen Seite. Jetzt `img-src 'self' data: blob:`, per Test festgehalten.

### 6. Aufräumen (Android)

`ui/screens/PartsScreen.kt`: `ManualItemCard` entfernt — die Composable wurde
nirgends mehr aufgerufen (seit die Kacheln über `ManualItemComposables.kt`
laufen) und trug den gemeldeten ungenutzten `purchasePrice`.

---

### Offen

**Google Fonts kommen weiterhin von `fonts.googleapis.com`** (`public/index.html`).
Das ist die letzte Fremdquelle, nachdem qrcodejs genau deswegen nach
`public/vendor/` gezogen ist. Im reinen LAN-/Offline-Betrieb fällt die Typografie
auf Systemschriften zurück. Selbst hosten würde zusätzlich `style-src` und
`font-src` auf `'self'` bringen — dafür müssen die Schriftdateien einmal
heruntergeladen und ins Repo gelegt werden.

---

## Nachtrag — die beiden offenen Punkte

Verifiziert mit `npm run typecheck` (sauber) und `npm test` gegen echtes
Postgres 16 (411 Tests, 0 Fehler, 0 übersprungen).

### 7. Google Fonts sind weg — die Oberfläche lädt von keinem Fremdhost mehr

`public/vendor/fonts/`, `public/index.html`, `server.ts`

Die Schriften liegen jetzt im Haus: vier woff2 unter
`public/vendor/fonts/files/` plus `fonts.css` und beide OFL-Lizenztexte,
genau wie qrcodejs unter `vendor/qrcode/`. Bezogen als variable Schnitte über
`npm pack @fontsource-variable/plus-jakarta-sans @fontsource-variable/jetbrains-mono` —
eine Datei je Familie deckt den ganzen Gewichtsbereich ab, statt fünf
Einzelgewichten für Jakarta und zwei für Mono. Latein und Latein-erweitert,
zusammen rund 104 KB; die -ext-Datei lädt der Browser nur, wenn ein Zeichen
daraus vorkommt.

Die Familien sind bewusst ohne den Zusatz „Variable“ deklariert — `styles.css`
(`--font`, `--mono`) bleibt dadurch unverändert. In `index.html` ersetzt ein
`preload` der beiden Latein-Dateien die früheren `preconnect`-Zeilen; die
Cache-Busting-Versionierung greift automatisch, weil `scripts/bump-version.js`
alle `.css?v=`-Referenzen umschreibt.

`style-src` und `font-src` stehen damit auf `'self'`. Zusammen mit dem
`img-src`-Fix oben erlaubt die CSP jetzt **keinen einzigen fremden Host** mehr.
Zwei Tests halten das fest: kein ladendes Element mit fremdem Host in
`index.html` (ein `<a href>` zu rebrickable/brickset bleibt erlaubt — ein
Verweis holt nichts nach), und die in `fonts.css` referenzierten Dateien müssen
existieren.

### 8. Stille Schreibfehler auf den Bestandstabellen

Die „~20“ aus dem ersten Review waren eine gefilterte Teilmenge; im Baum stehen
217 `.catch(() => {})`. Die pauschal zu entfernen wäre falsch — die meisten
sitzen auf Bild-Caches, Aufräumschritten und Fremd-APIs, wo Weiterlaufen
richtig ist. Sortiert nach Schadensklasse:

**Fehler durchreichen** — Zustands- und Preis-Spiegelungen in `sets.ts`,
`parts.ts`, `minifigs.ts`, auch die Stellen *innerhalb* von Transaktionen. Dort
ist ein verschluckter Fehler besonders teuer: Postgres bricht beim ersten
Fehler ab, alle folgenden Statements laufen ins Leere — und der Aufrufer bekommt
trotzdem `success: true`.

**Datenintegrität** — das Löschen der Kaufpreis-Historie nach dem Löschen eines
manuellen Teils oder einer Minifigur, in allen vier Routen (Session und v1).
Verschluckt hiess: Stammzeile weg, Erfassungen bleiben. Finanzsummen und
Portfoliokurve lesen die *Erfassungen* — ein gelöschtes Teil hätte dort
dauerhaft weitergezählt, und zwar unsichtbar, weil keine Ansicht verwaiste
Erfassungen zeigt. Nachgestellt gegen echtes Postgres: Erfassungen sind nach dem
Löschen weg.

**Loggen statt schweigen** — neuer Helfer `logAndContinue(kontext)` in
`utils/httpError.ts` für Schritte, die tatsächlich weiterlaufen sollen:
Bild-Cache-Pflege, Brickset-Metadaten beim Import, CSV-Kaufdatum, Einzelzeilen
des Minifiguren-Imports, die beiden Backfill-Jobs. Begründung im Helfer: Ein
leerer Catch sagt „darf scheitern“ *und* „niemand erfährt davon“. Das erste ist
oft richtig, das zweite fast nie — ein Job, der bei jeder Zeile scheitert, sah
im Log genauso aus wie einer, der sauber durchläuft.

Ein Test hält den Zustand: Auf `sets`, `parts`, `minifigs`, den drei
Erfassungstabellen und `instructions` ist ein leerer Catch nicht mehr erlaubt —
entweder durchreichen oder `logAndContinue()`. Anderswo bleibt er zulässig.

---

## Nachtrag 2 — Anmeldeweg und Android-Aufräumen

Verifiziert mit `npm run typecheck` (sauber) und `npm test` gegen echtes
Postgres 16 (412 Tests, 0 Fehler); Login/Logout zusätzlich end-to-end
nachgestellt, inklusive des Falls, in dem das Token-INSERT scheitert.

### 9. Stille Fehler im Anmeldeweg — Sicherheitsrelevant

`routes/auth.ts`, `utils/auth.ts`

Drei Stellen trugen `.catch(() => {})` an Schritten, die scheitern dürfen — nur
eben nicht unbemerkt:

**Der Web-Token beim Login.** Scheiterte das INSERT in `api_tokens`, galt die
Anmeldung trotzdem als erfolgreich, und der Client legte einen Token in den
`sessionStorage`, den die Datenbank nie gesehen hatte. Für den SSE-Kanal des
CSV-Imports (`?token=…`, weil `EventSource` keine Header setzen kann) hiess das
ein 401 — obwohl die Cookie-Session funktioniert hätte. Jetzt wird der Token bei
einem Fehler **weggelassen** und der Grund geloggt; ohne Feld fällt der Client
auf die Session zurück, den ohnehin vorgesehenen Weg für Alt-Clients.
Nachgestellt: Mit umbenannter Tabelle meldet der Login weiterhin Erfolg, liefert
aber kein `webToken` und schreibt eine Warnung.

**Sessions und Tokens nach einem Passwortwechsel.** Beide DELETEs waren
verschluckt — das Passwort war neu, die alten Zugänge liefen weiter, und der
Vorgang meldete Erfolg. Der Rückfall für eine fehlende `session`-Tabelle war
zusätzlich überflüssig: Ihre Existenz wird zwei Zeilen darüber bereits geprüft.
Dasselbe in `revokeAllTokens()`, der zentralen Stelle.

**Der Token beim Logout** wird jetzt über `logAndContinue()` geloggt statt
übergangen — sonst bleibt genau der Fall unbemerkt, den der Kommentar dort
verhindern will: ein Token, der die bewusste Abmeldung überlebt.

Ausserdem auf `logAndContinue()` umgestellt (echte Kann-Schritte): `last_used`
am Token, das Aufräumen abgelaufener QR-Nonces, der Scheduler-Anstoss nach
einem Einstellungsimport und die Fortschritts-/Abbruchvermerke des CSV-Imports.

### 10. Android: `from_user_id` beim Eigentümerwechsel entfernt

`Models.kt`, `BrickRepository.kt`, `HouseholdFeature.kt`,
`AcquisitionManagementScreen.kt`

Die App schickte den Absender korrekt mit — der Server ermittelt ihn seit
Punkt 1 aber aus der Zeile selbst und ignoriert das Feld. Ein Feld, das nichts
mehr bewirkt, gehört nicht in den Vertrag: `UpdateAcquisitionRequest` hat es
nicht mehr, ebenso wenig `repo.updateAcquisition()` und
`changeAcquisitionOwner()`. `acq.ownerUserId` bleibt in der Oberfläche — dort
nur noch für den Vergleich „hat sich überhaupt etwas geändert".

`MoveSetRequest` behält `from_user_id`: Dort geht es um mehrere Zeilen auf
einmal, und der Absender ist Teil der Auswahl, nicht eine Frage, die die
Datenbank beantworten könnte.

### Weiterhin offen

Rund 165 `.catch(() => {})` stehen noch im Baum — auf Bild-Caches,
Katalog-Anreicherung, Fremd-API-Abrufen und Dateisystem-Aufräumarbeiten. Dort
ist Weiterlaufen richtig, und ein pauschaler Umbau brächte mehr Risiko als
Nutzen. Wer sie angehen will, nimmt sinnvollerweise als nächstes die
Dateisystem-Gruppe (~8 Stellen in `imgProxy.ts`): Ein fehlgeschlagenes `unlink`
lässt temporäre Dateien liegen, und das fällt erst auf, wenn die Platte voll ist.

---

## Nachtrag 3 — Sitzungen überlebten den Passwortwechsel

Verifiziert mit `npm run typecheck` (sauber), `npm test` gegen echtes
Postgres 16 (413 Tests, 0 Fehler) und einem End-to-End-Versuch mit echtem
Session-Store.

### 11. Ein zurückgesetztes Passwort beendete die Sitzung nicht — Sicherheitslücke

`routes/auth.ts`, `utils/auth.ts`

Der Admin-Reset suchte die offenen Sitzungen so:

    SELECT to_regclass('public.session')      →  immer NULL
    if (hasSession?.t) DELETE FROM session …  →  lief nie

Die Tabelle heisst `user_sessions` (`server.ts`, `tableName`), und
`db/database.ts` legt sie im Schema an — die Begründung im Kommentar („der
Store legt sie zur Laufzeit an, deshalb erst prüfen") stimmte nicht. Der
Existenztest war damit immer negativ und das DELETE ein toter Zweig.

Folge: Ein Administrator setzt das Passwort eines übernommenen Kontos zurück,
die Bearer-Tokens verfallen — und das offene Browser-Fenster des Angreifers
bleibt angemeldet. Genau der Fall, für den man die Funktion benutzt.

Nachgestellt mit echtem Store (`connect-pg-simple` auf `user_sessions`):

    vorher   Sitzungen nach dem Reset: 1   alte Sitzung noch gültig: ja
    nachher  Sitzungen nach dem Reset: 0   alte Sitzung noch gültig: nein

Bitter daran: Ein bestehender Test hat die Lücke **festgeschrieben** statt sie
zu finden — er verlangte ausdrücklich den `to_regclass`-Test. Ein Test, der
eine Implementierung nachzeichnet statt ein Verhalten zu prüfen, bestätigt auch
den Fehler. Er prüft jetzt, dass Sitzungen und Tokens enden, nicht wie.

Behoben über einen zentralen Helfer `revokeAllSessions(userId)` neben
`revokeAllTokens()`. Alle drei Wege, die ein Passwort ändern, rufen jetzt beide:

  * `PUT /auth/users/:id/password` (Admin-Reset) — traf die falsche Tabelle
  * `POST /auth/reset-password` (Link per E-Mail) — traf die richtige Tabelle,
    aber mit einem eigenen Ausdruck und verschlucktem Fehler
  * `POST /auth/change-password` (selbst geändert) — schloss bisher nur die
    Tokens, die Sitzungen liefen weiter

Beim selbst ausgelösten Wechsel werden alle Sitzungen verworfen und danach die
eigene über `establishSession()` neu aufgebaut — sonst flöge man aus dem
eigenen Tab. Die neue Session-ID ist dabei erwünscht: Rotation nach einem
Passwortwechsel ist ohnehin die richtige Antwort auf Session Fixation.

`sess::jsonb->>'userId'` statt `(sess -> 'userId')::text`: Beide treffen eine
Zahl, aber `->>` liefert den blanken Wert, während `::text` bei einem String
die Anführungszeichen mitbrächte (`'"42"'` statt `'42'`) und dann nicht mehr
passt.

---

## Nachtrag 4 — Token-Liste, Zähler je Konto, Linkhärtung

Verifiziert mit `npm run typecheck` (sauber), `npm test` gegen echtes
Postgres 16 (415 Tests, 0 Fehler) und zwei Laufproben gegen die Datenbank.

### 12. Eine Stelle entscheidet, wo ein Token in der URL reiten darf

`utils/auth.ts`, `routes/sets.ts`

`utils/auth.ts` führt eine Liste der Pfade, auf denen `?token=` als
Anmeldung zählt, und schreibt dazu: „alles andere verlangt einen
Authorization-Header". Das stimmte nicht — `routes/sets.ts` hatte eine
**zweite** Fassung von `requireLoginOrToken`, die `?token=` bedingungslos
akzeptierte. Der Bedarf dahinter ist echt (EventSource kann keine Kopfzeilen
setzen), die zweite Fassung war es nicht: Wer in `utils/auth.ts` nachliest, wo
ein Token in der URL erlaubt ist, bekam eine unvollständige Antwort — und der
Datei sieht man das nicht an.

`/api/sets/import/csv/stream` und `/status` stehen jetzt in der Liste (der
Polling-Rückfall greift, sobald EventSource fehlt — derselbe Client, dieselbe
Einschränkung), die Prüfung kommt von der zentralen Stelle. Das 3s-Zeitlimit
bleibt erhalten, jetzt als Option `loginOrTokenGuard({ timeoutMs })`: Während
eines Imports kann die Datenbank ausgelastet sein, und ein Client mit einer
klaren 503-Absage versucht es gleich wieder, statt minutenlang zu hängen.

Laufprobe gegen die Datenbank:

    CSV-Status ?token=<gültig>     200
    CSV-Status Bearer              200
    CSV-Status ohne alles          401
    CSV-Status ?token=falsch       401
    /api/parts?token=<gültig>      401   ← Liste greift

`/api/v1` bekam bewusst keinen Eintrag: Dort gibt es keinen CSV-Kanal, und der
PDF-SSE läuft über `requireToken` mit Kopfzeile.

### 13. Der Versionszähler der Teile-Zusammenfassung hängt jetzt am Konto

`utils/partsSummary.ts`

Ein einziger globaler Zähler entwertete die Zusammenfassung **aller** Konten,
sobald irgendjemand etwas schrieb. Im Haushalt heisst das: Trägt ein Kind ein
Teil nach, gilt die Zusammenfassung der Eltern als veraltet, und die Kennzahlen
(`ensureFresh` mit `strict`) weichen bis zum Ende des Neuaufbaus auf die
Live-Abfrage aus. Gemessen an 800 Sets / 60'000 Teilen: rund 300 ms Neuaufbau,
ausgelöst von einer Änderung, die mit diesen Daten nichts zu tun hat. Der
Kommentar nannte das einen bewussten Tausch — nötig ist er nicht.

Jetzt zählt `parts_version_user` je Konto. Die Zeilen kommen aus den
Übergangstabellen des Triggers (`REFERENCING … TABLE`), womit auch klar ist,
warum es drei Trigger sind statt einem: Die Tabellen gibt es nur passend zur
Operation — beim INSERT nur NEW, beim DELETE nur OLD. `FOR EACH STATEMENT`
bleibt, ein CSV-Import kostet weiterhin einen Zähler-Update je Anweisung.

Beim UPDATE zählen **beide** Seiten: Wandert eine Zeile im Haushalt zwischen
Konten, sind die Zusammenfassungen von Absender und Ziel veraltet.

Laufprobe:

    eigene Zusammenfassung frisch (strict)          true
    nach Schreibvorgang eines FREMDEN Kontos        true    ← vorher false
    nach EIGENEM Schreibvorgang                     false

Migration läuft von selbst: Beim ersten Lesen nach dem Update passt der
gespeicherte Stand nicht zum neuen Zähler, jede Zusammenfassung wird genau
einmal neu gebaut, danach ist der Zustand konsistent. Die alte Tabelle
`parts_version` bleibt unangetastet stehen; nur die alte Trigger-Funktion wird
entfernt, damit sie nicht weiter mitzählt.

### 14. Externe Links ohne Zugriff aufs Öffnerfenster

`public/index.html`

Die beiden Links zu rebrickable und brickset in den Einstellungen hatten
`target="_blank"` ohne `rel="noopener"` — überall sonst im Code ist es gesetzt.
Moderne Browser ergänzen es bei `_blank` inzwischen von selbst, ältere und
eingebettete WebViews nicht. Ein Test hält den Zustand für alle künftigen Links.

---

## Nachtrag 5 — Seitengrösse, Bild-Typen, Fehlermeldungen

Verifiziert mit `npm run typecheck` (sauber), `npm test` gegen echtes
Postgres 16 (419 Tests, 0 Fehler) und drei Laufproben.

### 15. Dieselbe Anfrage lieferte unterschiedlich viele Zeilen

`utils/handlers.ts`

`getParts` hat zwei Wege, und nur einer begrenzte `page_size`: Die
Live-Abfrage deckelte bei 500, `tryPartsSummary` reichte den Wert ungeprüft
ins `LIMIT` durch. An 5000 Teilen mit `page_size=100000`:

    ohne Zusammenfassung: db      → 500 Zeilen
    mit  Zusammenfassung: summary → 5000 Zeilen     ← jetzt 500

Das Ergebnis hing also davon ab, ob die Zusammenfassung gerade frisch war —
ein Unterschied, den beim Suchen eines Fehlers niemand vermutet. Nebenbei war
es ein Weg, sich beliebig grosse Antworten bauen zu lassen.

Die 500 stand ausserdem fünfmal als Literal im Code. Jetzt `MAX_PAGE_SIZE` und
`clampPageSize()` an einer Stelle; ein Test lässt das Literal nicht zurück.

### 16. Der Bild-Proxy liefert nur noch Bilder aus

`routes/imgProxy.ts`

Der Content-Type kam ungeprüft aus der CDN-Antwort und wurde so gesetzt **und**
als Sidecar im Cache abgelegt. Die Host-Liste ist eng und `https2.get` folgt
keinen Weiterleitungen (kein SSRF) — aber auf den erlaubten CDNs liegen teils
von Nutzern hochgeladene Dateien. Käme dort ein SVG oder HTML zurück, läge es
anschliessend unter der eigenen Herkunft, und ein SVG ist ein Dokument, das
Skript enthalten kann. `nosniff` und die CSP fangen den Ernstfall ab; eine
Route namens `img-proxy` sollte trotzdem nichts anderes ausliefern.

Alles ausser `image/*` bekommt jetzt 415, SVG ausdrücklich eingeschlossen — das
einzige Bildformat, das als Dokument geöffnet aktiv wird, und keines der
angebundenen CDNs liefert Teile- oder Setbilder als SVG. Die Prüfung greift
auch beim Ausliefern aus dem Cache, weil dort ungeprüfte Einträge von vorher
liegen können.

Unverändert nachgewiesen: ohne Anmeldung 401, fremder Host 403, echte
Subdomain erlaubt, ohne https 400.

### 17. Fehlgeschlagene Anfragen sind nicht mehr stumm

`public/js/01-core.js`, `public/js/08-init.js`, `public/locales/*.js`

`api()` war `return (await fetch(...)).json()` — ohne Blick auf `res.ok`. Jede
nicht-JSON-Antwort (502/504 vom Reverse Proxy, 413, HTML-Fehlerseite) liess
`.json()` werfen:

    Unexpected token '<', "<html>502 "... is not valid JSON

Bei rund 88 Aufrufstellen ist längst nicht jede in `try/catch`. Für den
Benutzer hiess das: klicken, nichts passiert, keine Meldung. Die
Fehlerbehandlung war da — sie prüft `d.success` und zeigt `d.error` —, sie
bekam nur nie ein Objekt zu sehen.

`api()` liefert jetzt in jedem Fall die Form, die auch der Server liefern
würde. Damit greifen alle bestehenden Pfade unverändert, ohne 88 Stellen
anzufassen:

    /ok         {"success":true,"wert":42,"status":200}
    /html502    {"success":false,"status":502,"error":"…"}
    /json500    {"success":false,"error":"kaputt","status":500}   ← Servertext bleibt
    /bare500    {"message":"oops","success":false,"status":500,"error":"…"}
    /netzfehler {"success":false,"error":"…","networkError":true,"status":0}

Dazu ein Auffangnetz in `startApp()` für das, was `api()` nicht abdeckt: ein
Fehler in einem Rückruf, eine Zusage, die niemand einsammelt. Kurze Meldung,
Einzelheiten in der Konsole, höchstens eine alle fünf Sekunden — ein Fehler in
einer Schleife soll den Bildschirm nicht zupflastern. Drei neue Textschlüssel
in beiden Sprachen, über `tRaw()` (Textziel, siehe `frontend-escaping.test.js`).

### Nicht umgesetzt: Ablauf für App-Tokens

`createToken` und der QR-Login setzen bewusst `expires_at NULL`, damit die
Android-App nicht ständig neu anmelden muss. Ein Token auf einem verlorenen
Telefon gilt damit unbegrenzt; `last_used` wird bereits gepflegt, ein
Aufräumjob könnte 90 Tage ungenutzte Tokens mitnehmen. Das ist eine
Produktentscheidung und wartet auf Marcos Wort.

---

## Nachtrag 6 — App-Tokens verfallen bei Nichtnutzung

Verifiziert mit `npm run typecheck` (sauber), `npm test` gegen echtes
Postgres 16 (420 Tests, 0 Fehler) und einer Laufprobe mit sechs Tokens.

### 18. Ungenutzte Tokens werden aufgeräumt

`utils/auth.ts`, `db/database.ts`, `README.md`

Tokens der Android-App und des QR-Logins werden bewusst ohne Ablaufdatum
angelegt — wer die App öffnet, soll nicht ständig sein Passwort eintippen. Der
Preis war: Ein Token auf einem verlorenen oder verkauften Telefon gilt
unbegrenzt, und ausser einem Passwortwechsel (der seit Nachtrag 3 alle Tokens
verwirft) gibt es keinen Weg, ihn loszuwerden.

Das Mass ist **ungenutzt**, nicht **alt**: Ein Telefon, das täglich
synchronisiert, wird nie ausgesperrt, egal wie lange es das Konto schon hat.
Verfallen kann nur, was ohnehin niemand mehr benutzt — dort ist eine erneute
Anmeldung zumutbar. `last_used` wird bei jeder Anfrage gepflegt (gedrosselt auf
alle fünf Minuten) und taugt genau dafür.

`TOKEN_IDLE_DAYS` steuert die Frist: Vorgabe 90 Tage, `0` schaltet sie ab, ein
unbrauchbarer Wert fällt mit einer Warnung auf die Vorgabe zurück. In der
README dokumentiert.

`COALESCE(last_used, created_at)`, weil Zeilen aus der Zeit vor der
`last_used`-Spalte dort NULL hätten — und `NULL < NOW()` ist unbekannt, sie
wären also für immer ausgenommen, ausgerechnet die ältesten.

Laufprobe mit sechs Tokens:

    [tokens] 2 Token seit über 90 Tagen ungenutzt — entfernt
    entfernt: 3
    übrig:    app 89 Tage, app aktiv, webapp gültig
    aktiver App-Token gilt noch:   ja
    ungenutzter gilt nicht mehr:   ja

Mit `TOKEN_IDLE_DAYS=30` fallen zusätzlich die 89-Tage-Zeile und die Altzeile,
mit `0` nur der abgelaufene Webapp-Token — die Regel lässt sich also wirklich
abschalten.

Ein passender Teilindex (`idx_api_tokens_idle` auf `last_used` WHERE
`expires_at IS NULL`) ergänzt den bestehenden für die erste Regel.

### 19. Nebenfund: gelöschte Zeilen wurden falsch gezählt

`utils/auth.ts`, `routes/parts.ts`

`purgeExpiredTokens()` las `r?.rowCount`. `db.run()` liefert aber
`{ changes, lastID }` — die Zahl war deshalb **immer 0**, und die Meldung
„n abgelaufene Token entfernt" ist nie erschienen. Aufgeräumt wurde trotzdem;
man sah es nur nicht. Beim Nachsehen fand sich dieselbe Verwechslung in
`syncBlPartNumbers()`: Dort war die Summe zusätzlich nirgends verwendet, die
Zeile also vollständig wirkungslos. Jetzt beide auf `changes`, und die zweite
Stelle schreibt eine Logzeile, die etwas aussagt.

---

## Nachtrag 7 — Herunterfahren, abgelaufene Sitzungen, Bedienelemente ohne Namen

Verifiziert mit `npm run typecheck` (sauber), `npm test` gegen echtes
Postgres 16 (422 Tests, 0 Fehler) und drei Laufproben.

### 20. Jeder Neustart wartete acht Sekunden und meldete einen Fehlschlag

`utils/sseRegistry.ts` (neu), `server.ts`, `routes/sets.ts`,
`routes/api_v1/pdf.ts`

`shutdown()` wartete auf `httpServer.close()`. Dessen Rückruf kommt erst, wenn
die **letzte** Verbindung weg ist — und ein SSE-Strom geht von sich aus nie weg:

    SSE-Strom offen
    nach 2500 ms: close() zurück? false

Jeder Neustart lief deshalb in die Frist von acht Sekunden und endete über die
Reissleine mit `process.exit(1)`. Für Docker sah damit jedes `compose down` und
jedes Deploy aus wie ein Absturz.

Der Kommentar dort nannte das einen Ausnahmefall („bleibt eine Verbindung
hängen, typischerweise ein SSE-Strom"). Es war der Regelfall: Der
Fortschrittskanal der Webapp bleibt ausdrücklich dauerhaft offen, auch wenn gar
kein Import läuft.

Neu meldet jede der drei SSE-Routen ihre Antwort bei `utils/sseRegistry.ts` an;
das Herunterfahren beendet sie, **bevor** es auf `close()` wartet — mit einem
letzten `event: shutdown`, damit der Client weiss, dass hier nicht die
Verbindung abgerissen ist, sondern der Server geht. Gemessen:

    closeAllSse() beendet 1 Strom
    close() zurück nach 2 ms

Die Reissleine quittiert jetzt mit `exit(0)`: Sie ist eine Notbremse für
hängende Verbindungen, kein Fehler. Ein echter Fehler beim Beenden wird
weiterhin mit 1 quittiert.

Reine Keep-Alive-Verbindungen brauchten das übrigens nicht — die beendet Node
beim Schliessen des Servers von selbst; nachgemessen, bevor die Registry
gebaut wurde.

### 21. Eine abgelaufene Sitzung führt zurück zur Anmeldung

`public/js/01-core.js`, `public/locales/*.js`

Ein 401 wurde zu einem Hinweis pro Klick („Nicht angemeldet"), während die
Oberfläche weiter alte Daten zeigte und sich nicht mehr bedienen liess. Die
Android-App macht es längst richtig: Ihr Interceptor meldet jeden 401, die App
zeigt „Sitzung abgelaufen" und führt zur Anmeldung.

Wahrscheinlicher geworden ist der Fall durch Nachtrag 3: Seitdem verwerfen alle
drei Passwort-Wege sämtliche Sitzungen des Kontos — offene Tabs auf anderen
Geräten landen also genau hier.

`api()` behandelt den 401 jetzt zentral. Zwei Ausnahmen: `/auth/me` beantwortet
mit 401 die Frage „bin ich angemeldet?" (das behandelt `checkAuth()`), und
`/auth/login` meldet damit ein falsches Passwort. Wer gar nicht angemeldet ist,
löst nichts aus — sonst gäbe es eine Schleife auf der Anmeldemaske.

Gegen einen kleinen Server nachgestellt:

    abgemeldet + 401 → login-screen unverändert
    angemeldet + 401 → login-screen: flex, app: none

### 22. Zehn Bedienelemente ohne Namen (Android)

`ui/screens/*.kt`, `res/values*/strings.xml`, `IconButtonLabelTest.kt` (neu)

Vier `IconButton` trugen `contentDescription = null`: Suche leeren (Katalog und
Teileliste), Passwort ein-/ausblenden, Dreipunkt-Menü der Galerie-Kachel.
TalkBack liest dort nur „Schaltfläche" — ein Knopf ohne Funktion.

Der dazu geschriebene Test förderte sechs weitere zutage, an die vorher niemand
dachte: `FilledTonalIconButton` heisst auch „IconButton". Die Mengen-Knöpfe in
beiden Detail-Ansichten trugen `"+"` und `"−"` als Beschreibung — TalkBack liest
das als „Plus", nicht als „Menge erhöhen" —, und zwei Bearbeiten-Knöpfe im
Monitoring waren ganz ohne.

Acht neue Texte in beiden Sprachen. Symbole NEBEN einem Text behalten
ausdrücklich `null`: Sonst liest TalkBack dieselbe Sache zweimal.

Aufgefallen ist die Lücke im Vergleich zur Webapp, die in hardened-62 einen
eigenen Barrierefreiheits-Durchgang bekam. Der Test hält den Stand jetzt auch
für die App; die Gegenprobe (eine Beschriftung entfernt) meldet die Stelle.

Beim Schreiben des Tests fiel er selbst einmal auf die Nase: Ein Fenster von
300 Zeichen ab `Icon(` schnitt die Beschriftung des Passwort-Knopfes ab, weil
zwei Kommentarzeilen dazwischen standen. Ein Test, der korrekten Code
anmeckert, wird abgeschaltet statt befolgt — deshalb jetzt ein Fenster über
zehn Zeilen.

---

## Nachtrag 8 — Bedingte Bildabrufe und ein Aufräumlauf zu viel

Verifiziert mit `npm run typecheck` (sauber), `npm test` gegen echtes
Postgres 16 (424 Tests, 0 Fehler) und einer Laufprobe gegen den echten Proxy.

### 23. Der ETag des Bild-Proxys wurde nie ausgewertet

`routes/imgProxy.ts`

Beide Auslieferpfade (Original und Vorschaubild) setzten einen ETag und
`Cache-Control: max-age=86400, must-revalidate` — prüften aber kein
`If-None-Match`. Nach Ablauf der 24 Stunden fragt der Browser nach und bekam
jedes Mal das **vollständige** Bild zurück. Bei einer Kachelwand mit hundert
Teilen ist das täglich einmal die ganze Wand statt hundert leerer Antworten.
Der berechnete ETag sah aus, als täte er etwas, war aber wirkungslos.

Die Route `/images/*` hatte das Problem nie, weil `res.sendFile` die Prüfung
selbst übernimmt — die beiden Bildwege verhielten sich also unterschiedlich.

Jetzt `if (req.fresh) return res.status(304).end();` an beiden Stellen, nach
dem Setzen der Kopfzeilen (davor gäbe es nichts zu vergleichen). Gegen den
echten Proxy nachgestellt:

    1. Abruf                        200   ETag "c-2048-…"   2048 Bytes
    2. mit If-None-Match            304                        0 Bytes
    3. mit ALTEM ETag               200                     2048 Bytes
    4. mit no-cache (Shift-Neuladen) 200                    2048 Bytes

Beim Prüfen fiel eine Falle auf, die im Test festgehalten ist: Node's `fetch`
hängt bei manuell gesetztem `If-None-Match` automatisch
`Cache-Control: no-cache` an — worauf `req.fresh` korrekt `false` liefert. Die
erste Messung zeigte deshalb 200 und sah aus wie ein Fehlschlag, obwohl der
Code stimmte. Die Laufprobe benutzt jetzt rohe HTTP-Anfragen.

### 24. Der Cache-Aufräumlauf lief in jedem Cluster-Worker

`routes/imgProxy.ts`, `server.ts`

Das tägliche Aufräumen von `data/img_proxy_cache` stand in
`registerImgProxy()` — und die wird von **jedem** Worker aufgerufen. Bei acht
Workern hiess das acht vollständige Durchläufe über das Verzeichnis (`readdir`
plus `stat` je Datei) und acht Prozesse, die sich beim `unlink` gegenseitig ins
Gehege kamen; unbemerkt, weil die Fehler ohnehin verworfen werden.

Alle übrigen wiederkehrenden Arbeiten — Preis-Job, Token-Aufräumen,
Log-Bereinigung — hängen längst hinter `isPrimaryWorker`. Der Lauf ist jetzt
als `startImgCacheCleanup()` herausgezogen und wird dort mitgestartet.

Der Kommentar zur Bedingung ist dabei präzisiert worden: Geprüft werden atime
UND mtime, weil ein mit `noatime` eingehängtes Dateisystem (in Containern
verbreitet) die atime auf dem Erstellungszeitpunkt stehen lässt.

### Nebenbei geprüft und in Ordnung: die Android-App

Release-Build mit `minifyEnabled` und ProGuard, praktisch kein Debug-Logging,
`allowBackup="false"` **plus** `data_extraction_rules`, die den DataStore auch
vom Geräte-zu-Geräte-Transfer ausschliessen, nur die Launcher-Activity
exportiert, Klartext-Sperre für öffentliche Hosts im Interceptor, eigener
SSE-Client mit `readTimeout(0)`, Coil mit Speicher- und Plattencache, stabile
Keys in den Lazy-Listen.

Eine Kleinigkeit: Der Kommentar in `data_extraction_rules.xml` sagt „der Token
hat serverseitig kein Ablaufdatum" — seit `TOKEN_IDLE_DAYS` (Nachtrag 6) stimmt
das nicht mehr ganz. Die Regel selbst bleibt richtig, der Satz ist beim
nächsten Android-Paket einen Halbsatz wert.

---

## Nachtrag 9 — Hochgeladene Anleitungen im Haushalt

Verifiziert mit `npm run typecheck` (sauber), `npm test` gegen echtes
Postgres 16 (426 Tests, 0 Fehler) und zwei Laufproben gegen echte Daten.

### 25. Der Dateipfad war die Zugriffsregel — und passte nicht mehr

`server.ts`

`serveDataFile()` verglich das erste Pfadsegment stur mit der eigenen
Benutzer-ID. Richtig, solange ein Konto für sich stand; nach dem Haushalt an
zwei Stellen falsch:

  * `getSet` listet Anleitungen mit `user_id = ANY(uids)`, also haushaltsweit.
    Das Hauptkonto **sah** die Anleitung eines Unterkontos im Set-Detail und
    bekam beim Klick 403.
  * `moveSetBetweenAccounts` kopiert `local_path` wörtlich. Nach dem
    Verschieben eines Sets gehörte die Anleitungs-Zeile dem neuen Konto, der
    Pfad zeigte aber weiter in den Ordner des alten — 403 auf die **eigene**
    Zeile.

Jetzt entscheidet `scopeIds()`, dieselbe Stelle, die überall sonst beantwortet,
wessen Daten jemand sehen darf. Die Benutzer-ID im Pfad ist damit das, was sie
ohnehin schon war: eine Ablagestruktur, keine Zugriffsregel.

Die Asymmetrie bleibt: Ein Unterkonto hat nur sich selbst im Blickfeld
(`resolveHousehold`: `memberIds = [self, …eigene Subs]`), kommt also **nicht**
an die Uploads des Hauptkontos. Geprüft wird gegen eine Liste erlaubter IDs,
nicht gegen „irgendwer im System".

Gegen echte Daten, vorher → nachher:

    Hauptkonto liest Anleitung des Unterkontos   403 → 200
    Hauptkonto liest seine verschobene Zeile     403 → 200
    Unterkonto liest Datei des Hauptkontos       403 → 403   (unverändert)

Der zweite Weg — Datei beim Verschieben mitkopieren und `local_path` anpassen —
wurde verworfen: Er bringt Dateisystemarbeit in eine Transaktion und löst den
ersten Fall (Haushalt liest fremde Anleitung) gar nicht.

### 26. Eine geteilte Anleitungsdatei überlebt, bis die letzte Zeile weg ist

`routes/sets.ts`

Weil beim Verschieben die Zeile kopiert und der Pfad übernommen wird, teilen
sich zwei Konten eine Datei. Das Löschen stand **vor** dem `DELETE` und fragte
niemanden: Entfernte das eine Konto seine Anleitung, zeigte die Zeile des
anderen ins Leere — ein Eintrag im Set-Detail, der beim Klick 404 gibt.

Reihenfolge umgedreht: erst die eigene Zeile entfernen, dann zählen, ob noch
jemand auf den Pfad zeigt. Bleibt eine Zeile übrig, bleibt die Datei liegen.
Im Zweifel (Abfrage scheitert) bleibt sie ebenfalls liegen — eine verwaiste
Datei ist ärgerlich, eine fehlende ist weg.

    Kind löscht seine Zeile     → Datei bleibt
    Eltern löschen ihre Zeile   → Datei weg

### Nicht angefasst

Zwei Kleinigkeiten aus derselben Ecke, bewusst liegen gelassen:

  * Der Upload filtert nach dem vom Client geschickten `Content-Type` statt
    nach dem tatsächlichen Inhalt. Wegen `nosniff` und der aus der Endung
    abgeleiteten Auslieferung ist das ungefährlich — eine als PDF deklarierte
    Datei darf aber beliebigen Inhalt haben.
  * Das `ON CONFLICT DO NOTHING` beim Anleitungs-Insert läuft ins Leere: Auf
    der Tabelle gibt es keinen passenden Unique-Index, doppelte Uploads
    derselben Datei legen also zwei Zeilen an.

---

## Nachtrag 10 — Der Preis-Cache gehört dem Administrator

Verifiziert mit `npm run typecheck` (sauber), `npm test` gegen echtes
Postgres 16 (428 Tests, 0 Fehler) und einer Laufprobe mit beiden Rollen.

### 27. Jedes Konto konnte den globalen Preis-Cache leeren

`routes/settings.ts`

`POST /api/settings/import` führte am Ende ein unbedingtes
`DELETE FROM price_cache` aus — der Router trägt aber nur `requireLogin`. Jedes
Konto, auch ein Unterkonto im Haushalt, konnte damit eine Ein-Zeilen-Datei
hochladen …

    {"user_settings":{"currency":"CHF"}}

… und den Preis-Cache der **ganzen Installation** leeren. Beliebig oft. Der
nächste Bewertungslauf holt dann alle Preise neu bei BrickLink, und deren
Tageskontingent ist endlich.

Dieselbe Lücke war in `routes/finance.ts` schon einmal geschlossen worden —
`POST /refresh` trägt seitdem `requireAdmin`, mit einer Notiz im Code über das
„von aussen verbrannte" Kontingent. Der Import-Weg wurde dabei übersehen; er
sieht ja auch nicht nach „Cache leeren" aus.

**Ersatzlos gestrichen statt hinter `isAdmin` geschoben.** `price_cache` ist
über `set_number`, `condition` **und** `currency_code` verschlüsselt: Einträge
in der alten Währung passen nach einem Wechsel schlicht nicht mehr auf die
Abfrage, und für die neue wird ohnehin frisch geholt. Das Leeren hatte also nie
eine Wirkung auf die Richtigkeit — nur eine auf das Kontingent. Wer den Cache
wirklich leeren will, hat dafür `POST /api/finance/refresh` (Admin).

Nachgeprüft: Alle sechs lesenden Abfragen auf `price_cache` filtern nach
`currency_code`.

Laufprobe mit beiden Rollen:

    Cache vorher                                        50
    Unterkonto importiert  → „Nur Benutzer-Einstellungen importiert",
                             Währung gesetzt, Cache      50
    Admin importiert       → globaler Wert gesetzt, Cache 50

Zwei Tests halten das fest, und zwar als **Regel** statt an einer Route:

  * Wer `DELETE FROM price_cache` ausführt, braucht `requireAdmin` — geprüft
    über alle sechs Router, die den Cache anfassen könnten. Ein neuer Weg mit
    demselben Muster fällt damit sofort auf.
  * Jede lesende Abfrage auf `price_cache` filtert nach `currency_code`. Bricht
    jemand diese Eigenschaft, wäre die gestrichene Zeile wieder nötig — dann
    wird hier etwas rot, statt dass still Währungen durcheinandergeraten.


---

## Nachtrag 11 — Aufräumen und ein Blick auf die Tests selbst

Verifiziert mit `npm run typecheck` (sauber) und `npm test` gegen echtes
Postgres 16 (432 Tests, 0 Fehler).

### Changelog zusammengeführt

`CHANGELOG-hardened-115.md` war bei zehn Nachträgen angekommen — ein Changelog,
der nur noch angehängt wird, liest irgendwann niemand mehr. Die elf Durchgänge
stehen jetzt hier (Abschnitt „Review-Reihe hardened-115 bis 125"), die
Einzeldatei ist entfallen.

### Android: überholter Kommentar

`res/xml/data_extraction_rules.xml` begründete den Ausschluss des DataStore
damit, dass der Token „serverseitig kein Ablaufdatum" habe. Seit
`TOKEN_IDLE_DAYS` stimmt das nicht mehr. Die Regel selbst bleibt richtig, und
der Kommentar sagt jetzt auch warum: Ein mitgewanderter Token ist auf dem neuen
Gerät sofort gültig, und „läuft irgendwann ab" ist kein Ersatz für „kommt gar
nicht erst dorthin".

### Die Tests selbst angesehen

Ausgangspunkt war der teuerste Fund dieser Reihe: In Durchgang 118 hatte ein
Test eine Sicherheitslücke **festgeschrieben**, statt sie zu finden — er
verlangte einen Ausdruck (`to_regclass('public.session')`), der auf eine
Tabelle zeigte, die es nie gab. Also die Frage: Wie viele Tests zeichnen
Implementierung nach statt Verhalten zu prüfen?

Von 352 Top-Level-Tests lesen die meisten Quelltext; sechs Suiten führen Code
gegen echtes Postgres aus. Zwei Messungen dazu:

**Erste Richtung — schlägt ein Test an, obwohl nichts kaputt ist?** Eine reine
Umbenennung in `utils/household.ts` (`subState` → `zustandUnterkonto`,
`curMain` → `waehrungHaupt`) machte zwei Tests rot, während die Datenbank-Suite
grün blieb. Beide sind jetzt auf die Struktur gezielt statt auf die
Schreibweise; nach derselben Umbenennung bleiben sie grün.

**Zweite Richtung — bleibt ein Test grün, obwohl etwas kaputt ist?** Das ist
die gefährliche. Hängt man an die Währungsprüfung ein `&& false`, bleiben alle
Quelltext-Prüfungen grün und nur der Datenbanktest wird rot. Und beim
Passwortwechsel: Klammert man `revokeAllSessions` und `revokeAllTokens` in ein
`if (false)`, bleiben **alle 13** statischen Prüfungen in `auth-parity` grün —
die Zeichenketten stehen ja noch da —, während die Sicherheitsregel tot ist.

Genau diese Lücke schliesst die neue Suite **test/auth-sessions-db.test.js**:
echter `connect-pg-simple`-Store, echte Routen, echte Cookies. Drei Fälle —
Admin-Reset wirft das übernommene Fenster hinaus; der eigene Passwortwechsel
wirft die *anderen* Fenster hinaus, nicht das eigene; Bearer-Token verfallen
mit. Mit dem `if (false)` oben wird sie rot.

Die README hat dazu einen Abschnitt bekommen („Zwei Arten von Tests"), der die
Grenze benennt und zwei Regeln festhält: Sicherheitsregeln brauchen einen
Verhaltenstest, und Namen von Zwischenvariablen gehören nicht in ein
Testmuster. Dazu die Gegenprobe als Gewohnheit — Regel im Code brechen und
schauen, ob der Test rot wird; wird er es nicht, prüft er etwas anderes als
gedacht.

---

## Nachtrag 12 — Das Rebrickable-Tageskontingent zählt jetzt einmal

Verifiziert mit `npm run typecheck` (sauber), `npm test` gegen echtes
Postgres 16 (433 Tests, 0 Fehler) und einer Laufprobe mit simuliertem zweitem
Worker.

### Drei APIs, zwei Zählweisen — jetzt eine

`utils/rateLimiter.ts`, `utils/financeCalc.ts`, `routes/rebrickable.ts`,
`routes/parts.ts`, `routes/api_v1/admin.ts`, `jobs/*`, `server.ts`

BrickLink und Brickset zählten ihre Tagesaufrufe über
`checkAndIncrementRateLimit()` — eine Transaktion mit `SELECT … FOR UPDATE`,
also einmal für die ganze Installation. Rebrickable hatte einen eigenen Weg:
`DailyLimiter` mit `this.count` im Prozessspeicher.

Der Server läuft im Cluster. Jeder Worker legte seine eigene Instanz an und
zählte für sich bis zum Limit — bei `WORKERS = max(2, CPU-Kerne)` waren auf
einem Vierkerner 100'000 Aufrufe möglich, wo 25'000 eingestellt sind. Die
DB-Schreibvorgänge in `tryConsume()` täuschten Gemeinsamkeit vor, waren aber
`SET value = <lokaler Stand>`: Der letzte Worker überschrieb den Wert des
vorigen, statt zu addieren. Die Anzeige im Monitoring zeigte den Stand eines
beliebigen Workers, und nach einem Neustart stand sie wieder auf 0, während der
Tag weiterlief.

**Das ist die dritte Instanz desselben Musters.** Beim Login-Zähler war es
schon behoben (`utils/loginLimiter.ts`, mit der Notiz „bei N Cluster-Workern
werden aus 5 Fehlversuchen sonst N×5"), beim Bild-Cache-Aufräumlauf ebenfalls
(Nachtrag 8). Hier traf es ausgerechnet das Kontingent, das die anderen
Massnahmen schützen sollten.

Alle sechs Aufrufstellen laufen jetzt über `consumeRebrickableDaily()`, das an
`checkAndIncrementRateLimit('rebrickable')` weiterreicht. Damit entfallen auch
`loadDailyLimitsFromDb()` beim Start und `setMax()` im Admin-Handler: Die
Grenze wird bei jedem Aufruf aus `global_settings` gelesen, statt in jeden
Prozess kopiert und beim Ändern nachgezogen zu werden — vorher galt ein neu
gesetztes Limit nur in dem Worker, der die Anfrage bearbeitet hatte.

Beim Umbau gefunden: `getLimitForApi()` führte einen eigenen Rückfallwert von
**4000** für Rebrickable, während `REBRICKABLE_DEFAULT_DAILY` (und der Seed in
`db/database.ts`) 25'000 sagt. Solange Rebrickable seinen eigenen Zähler hatte,
sah es diese Tabelle nie — nach der Umstellung wäre es eine stille Kürzung auf
ein Sechstel gewesen. Der Wert kommt jetzt aus derselben Quelle.

Der Kurzstrecken-Limiter (ein Aufruf je 1,5 s) bleibt bewusst prozesslokal:
Drosselung pro Prozess ist etwas anderes als ein Tagesbudget.

Laufprobe (Limit auf 3 gesetzt):

    Standard ohne Eintrag: 25000
    Aufrufe 1–3: erlaubt      Aufruf 4: abgelehnt
    zweiter Modulzustand (= zweiter Worker): abgelehnt, Stand 3/3

Vorher hätte der zweite Worker wieder bei null angefangen.

### Bei DB-Ausfall wird durchgelassen

`consumeRebrickableDaily()` gibt bei einem Fehler `true` zurück. Umgekehrte
Abwägung als beim Login-Zähler, wo der Rückfall sperrt: Ein überschrittenes
Tageskontingent kostet Aufrufe, ein blockierter Bildabruf kostet die
Benutzbarkeit.

---

## Nachtrag 13 — Der Preis-Job konnte mehrfach parallel laufen

Verifiziert mit `npm run typecheck` (sauber), `npm test` gegen echtes
Postgres 16 (434 Tests, 0 Fehler) und einer Laufprobe mit einem echten zweiten
Prozess.

### Vierte Instanz desselben Musters

`jobs/priceJob.ts`, `routes/finance.ts`, `routes/api_v1/admin.ts`

Der Schutz gegen Doppelläufe war `state.running` — eine Variable im Speicher
EINES Prozesses. Geplant läuft der Job nur im Primary-Worker
(`priceJob.start()` steht im `isPrimaryWorker`-Block), aber die beiden
manuellen Auslöser (`POST /api/finance/job-trigger` und
`POST /api/v1/admin/trigger-price-job`) laufen in dem Worker, der die Anfrage
gerade bearbeitet. Dort war `state.running` false — also startete ein
vollständiger Lauf über alle Sets, unabhängig davon, ob im Primary gerade einer
lief.

Zwei Folgen: Zwei Klicks auf verschiedenen Workern ergaben zwei komplette
Durchgänge mit eigenen BrickLink-Aufrufen (der Tageszähler aus Nachtrag 12
begrenzt den Schaden, aber das Kontingent ist doppelt weg), und beide Läufe
schrieben in dasselbe `jobMonitor`-Feld — die Fortschrittsanzeige sprang
zwischen den Ständen hin und her.

Das ist nach Login-Zähler, Bild-Cache-Aufräumlauf (Nachtrag 8) und
Rebrickable-Tageskontingent (Nachtrag 12) die **vierte** Instanz. Auffällig:
Die Werkzeuge lagen längst bereit — `partsCatalogEnrich` nimmt
`pg_try_advisory_lock(42, …)`, `partsSummary` die 77, `txLock` die Benutzer-ID.
Nur der Preis-Job hatte keine.

`runPriceRefresh()` holt jetzt eine prozessübergreifende Sperre im eigenen
Namensraum (55), auf einer **eigenen Verbindung** aus dem Pool statt
transaktionsgebunden: Der Lauf dauert Minuten, `pg_try_advisory_xact_lock`
hiesse eine minutenlang offene Transaktion. Freigabe im `finally` — sonst
blockierte ein abgestürzter Lauf alle folgenden bis zum Neustart. Bekommt der
Lauf die Sperre nicht, meldet er das im Log und plant den nächsten Termin.

`state.running` bleibt als billige Vorprüfung im selben Prozess; die Sperre ist
die belastbare Antwort.

### triggerNow() meldet nicht mehr Erfolg, wenn keiner startet

Der manuelle Anstoss holt die Sperre selbst, statt sie dem Lauf zu überlassen.
Vorher gab die Route `started: true` zurück, sobald der eigene Prozess nicht
beschäftigt war — lief anderswo schon ein Durchgang, stimmte die Meldung nicht.
`triggerNow()` ist dadurch asynchron geworden; beide Routen warten das Ergebnis
ab.

### Nachgestellt mit einem echten zweiten Prozess

Zwei Modulinstanzen im selben Prozess reichen als Nachweis nicht: Sie teilen
sich `state`, und dann hätte schon `state.running` das `false` erklärt. Deshalb
ein echter zweiter Node-Prozess mit eigenem Speicher:

    [Worker A] triggerNow: true          Sperren gehalten: 1
    [Worker B] state.running lokal: false   ← eigener Prozess, leerer Zustand
    [Worker B] triggerNow: false            ← das kann nur die Sperre gewesen sein

Ohne die Sperre in `triggerNow()` meldet Worker B `true` und startet einen
zweiten kompletten Lauf — gegengeprüft.

Der Test dazu prüft die **Regel**, nicht diese eine Stelle: eigene Verbindung
statt Transaktionssperre, Freigabe im `finally`, `await` an beiden Routen, und
ein Namensraum, der noch nicht vergeben ist.

## Nachtrag 14 — Die Anleitungs-Warteschlange lief in jedem Worker

Fünfte Instanz desselben Musters: prozesslokaler Zustand, der eine Regel für
den ganzen Cluster durchsetzen sollte. Nach dem Login-Zähler, dem
Bild-Cache-Aufräumlauf, dem Rebrickable-Tageskontingent und dem Preis-Job jetzt
`jobs/instructionQueue.ts` — und, beim Nachsehen „wo gibt es das noch?", der
Nachlauf für fehlende Bilder.

### Was falsch lief

`_running`, `_timer` und der Cloudflare-Backoff liegen im Speicher EINES
Prozesses. Der geplante Antrieb läuft nur im Primary — aber die Warteschlange
wurde aus drei Request-Handlern heraus direkt angestossen:

* `addSet()` in `routes/sets.ts` (Set erfassen),
* das Ende des CSV-Imports,
* `POST /api/v1/admin/reimport-instructions`.

Diese laufen in dem Worker, der die Anfrage gerade bearbeitet. Dort war
`_running` false, also startete eine zweite Abarbeitung derselben
Warteschlange. Zwei der drei Stellen trugen sogar den Kommentar „direkter
processNext() falls DIESER Prozess der Primary ist" — geprüft hat das nie
jemand, `processNext()` kannte den Primary gar nicht.

Folgen, alle am Code nachvollzogen:

* Zwei Prozesse zogen mit `WHERE status='pending' … LIMIT 1` **dieselbe** Zeile
  und holten die Anleitung zweimal: doppelt verbrauchtes
  Brickset-Tageskontingent, zwei Downloads auf denselben Dateinamen. (Doppelte
  Zeilen in `shared_instructions` entstanden dabei NICHT — dort greift
  `UNIQUE(set_number, url)`.)
* Der Cloudflare-Backoff galt nur im Prozess, der die 1015 gesehen hat. Der
  andere lief weiter und holte sich die nächste Sperre.
* Die 15-Sekunden-Drossel halbierte sich, weil zwei Zeitgeber-Ketten
  unabhängig voneinander takteten.

### Was jetzt gilt

1. **`requestRun()`** setzt nur das Flag `instr_queue_trigger`, das der Primary
   ohnehin alle 3 s abfragt. Alle drei Request-Handler gehen darüber; kein
   Direktaufruf mehr aus einem Request.
2. **`processNext()` hält eine prozessübergreifende Sperre** für die Dauer
   EINES Eintrags: `pg_try_advisory_lock(56, 0)` auf einer eigenen Verbindung
   (Advisory-Locks hängen an der Session — über den Pool landen Sperren und
   Freigeben sonst auf verschiedenen Verbindungen; ausführlich begründet in
   `routes/brickset.ts`). Damit hängt die Regel am Job, nicht an den
   Aufrufstellen: Ein künftiger Direktaufruf kann nichts mehr verdoppeln.
3. **Die Cloudflare-Pause steht in der Datenbank** (`global_settings`, Schlüssel
   `instr_queue_block`, JSON `{until, retries}`) statt im Prozessspeicher. Sie
   überlebt damit auch einen Neustart — vorher nahm ein Neustart die laufende
   Sperre nicht zur Kenntnis und lief 3 Sekunden später wieder los.
4. **Die Nachfolge-Zeitgeber laufen nur dort, wo `start()` lief** (`_driver`).
   Sonst würde ein Direktaufruf in einem Request-Worker dort eine zweite Kette
   eröffnen: durch die Sperre zwar keine gleichzeitige Arbeit, aber zwei
   unabhängig taktende Drosseln.

### Dieselbe Sache beim Bilder-Nachlauf

`redownloadMissingImages()` in `jobs/partsCatalogEnrich.ts` wird
**ausschliesslich** aus einem Request-Handler ausgelöst
(`POST /api/v1/admin/redownload-missing-images`) und war nur durch
`_redlRunning` geschützt. Zwei Klicks auf den Knopf im Monitoring landeten in
verschiedenen Workern: zwei vollständige Läufe, dieselben Dateien nebenläufig
vom CDN auf denselben Pfad geschrieben, und beide überschrieben im
Sekundentakt `imgredl_status` — die Fortschrittsanzeige sprang zwischen zwei
Ständen hin und her.

`downloadSetImages()` hat für genau dieses Problem längst einen Lock (42 je
Set); dieser Weg lädt über `downloadFile()` direkt und lief ungeschützt. Jetzt
`pg_try_advisory_lock(57, 0)`, Rückgabe `{ alreadyRunning: true }` ohne Sperre;
die Route antwortet unverändert.

### Nachweis ohne zweiten Node-Prozess

Für den Preis-Job (Nachtrag 13) brauchte der Nachweis noch einen echten zweiten
Prozess. Das geht einfacher: Ein Advisory-Lock hängt an der **Session**, nicht
am Prozess — eine zweite Pool-Verbindung im selben Test wirkt für den Job wie
ein zweiter Worker.

`test/job-locks-db.test.js` prüft deshalb Verhalten statt Quelltext (ein
`if (false)` um den Lock-Aufruf hätte eine statische Prüfung grün gelassen —
siehe Nachtrag 11). Fünf Prüfungen gegen echtes Postgres, jede mit Gegenprobe:

* Gegenprobe: ohne fremde Sperre wird der Eintrag abgehakt (sonst prüfte der
  Rest der Suite nichts).
* Fremde Sperre gehalten → der Eintrag bleibt `pending`.
* Persistierte Cloudflare-Pause → der Eintrag bleibt `pending`.
* `requestRun()` setzt das Flag und arbeitet selbst nichts ab.
* Bilder-Nachlauf: mit fremder Sperre `alreadyRunning`, ohne Sperre läuft er.

Der Eintrag wird so vorbereitet, dass die Bearbeitung ohne Netzaufruf auskommt
(Anleitung liegt schon in `shared_instructions`, `processNext()` hakt nur ab) —
geprüft wird die Sperre, nicht Brickset.

Alle drei Regeln einzeln gebrochen: jede machte genau ihren Test rot und nur
ihren. 440 Tests grün gegen echtes Postgres 16, 0 übersprungen.

### Geprüft und in Ordnung

`processRetryQueue` (Sperre 11223344), `downloadSetImages` (42 je Set),
`partsSummary` (77 je Nutzer), Login-Zähler und Rebrickable-Kontingent
(DB-atomar), CSV-Sync und Scheduler (nur der Primary registriert). Der
Token-Cache in `utils/auth.ts` hält einen widerrufenen Token in einem anderen
Worker noch bis zu 60 s für gültig — bewusste TTL-Abwägung, unverändert.

## Nachtrag 15 — Zwei Zeichen, die niemand erklärt hat

Die letzte Spalte der Finanztabelle zeigte drei Zustände: ⚡ für „Preis aus dem
Cache", 🔴 für „gerade frisch von BrickLink geholt" und ein rotes „Err". Nirgends
stand, was das bedeutet — kein `title`, kein `aria-label`, keine Legende, kein
Spaltenkopf. Marco hat gefragt, was die Zeichen sollen; das ist die Antwort auf
die Frage, nicht bloss eine Beschriftung hinterher.

### Warum jetzt nur noch zwei Zustände

Cache oder frisch geholt ist eine **Innensicht des Servers**. Für die Frage, um
die es in der Zeile geht — stimmt diese Zahl? — macht sie keinen Unterschied,
beide Wege liefern denselben Preis. Dazu kam die Farbwahl: Der Normalfall
(Cache) bekam einen Blitz, der seltene Fall einen roten Punkt, der wie eine
Warnung aussieht. Wer die Tabelle überflog, las Alarm, wo alles in Ordnung war.

Jetzt:

* **✓** (grün) — Marktpreis vorhanden, egal woher.
* **⚠** (rot) — Marktpreis konnte nicht geladen werden.

Beide tragen `title` UND `aria-label`; Vorleseprogramme sagten vorher nur
„Blitz" bzw. „roter Kreis". Beim Fehlerfall hängt die Servermeldung mit im
Tooltip — sichtbar steht sie ohnehin in der Summenspalte. `cursor:help` zeigt,
dass überhaupt ein Tooltip dranhängt.

Der Spaltenkopf war leer und bleibt es optisch; er trägt jetzt den Text
„Preisstatus" in einer nur für Vorleseprogramme sichtbaren Auszeichnung
(`.vh` — `position:absolute` + `clip`, NICHT `display:none`, das nähme der
Sprachausgabe den Text ebenfalls).

Neue Schlüssel in beiden Sprachdateien: `finance.price_status`,
`finance.price_loaded`, `finance.price_failed`. Die alten Pillen-Klassen `.lv`
und `.lc` bleiben unverändert — sie sind allgemeine Plaketten und werden in der
Anleitungsliste weiterverwendet.

### Test

`test/a11y.test.js` prüft als Regel, nicht als Schreibweise: In der
Preisstatus-Spalte stehen GENAU zwei Zustände, jeder mit `title` und
`aria-label`, und die Texte kommen aus den Sprachdateien statt als Literal im
Code. Kommentare werden vor der Prüfung ausgeblendet — sonst hätte der
Erklärtext über der Prüfung sie selbst grün gehalten (derselbe Eigenfehler wie
in Nachtrag 11). Gegenprobe: `title` entfernt → genau dieser Test rot.

441 Tests grün gegen echtes Postgres 16, 0 übersprungen.

## Nachtrag 16 — Zwei require(), die ins Leere griffen

Zwei Aufrufe holten aus einem Modul einen Namen, den dieses Modul nie
exportiert hat. Das Ergebnis war jeweils `undefined`, der Aufruf ein
TypeError — beide in Zweigen, die selten dran sind, deshalb jahrelang
unbemerkt.

### 1. Die Teile-Rückfallebene für fremde Sets

`utils/handlers.ts` holte `fetchRebrickableParts` aus `routes/parts.ts`; die
Exportliste dort führt den Namen nicht. Betroffen ist `getParts()` mit
Set-Filter, wenn der Nutzer selbst keine Teile hat und das Set nicht im
CSV-Bestand liegt. Nachgestellt gegen echtes Postgres:

    FEHLER: TypeError fetchRebrickableParts is not a function

Das `.catch(() => [])` daneben fing nichts: Der TypeError fliegt SYNCHRON,
bevor es ein Promise gibt. Die Anfrage endete mit 500 statt mit einer leeren
Liste.

Statt den Namen nachzutragen, geht der Weg jetzt über `getAllSetParts()` in
`routes/rebrickable.ts`. Die Funktion kann alles, was die 90-zeilige
Zweitfassung nachbaute — und mehr: CSV zuerst, Tageskontingent über
`consumeRebrickableDaily()`, Drossel über den Limiter, Antwort im
`subsets_cache`. Die Zweitfassung ist entfallen; sie holte ohne all das.

### 2. Die Bestellnummern-Suche der App

`routes/api_v1/sets.ts` holte `getSetByItemNumber` aus `routes/brickset.ts` —
die Funktion dort heisst `getSetByBarcode` und wurde nirgends verwendet. Eine
gescannte 5–8-stellige Nummer, die nicht im `catalog_cache` liegt, endete
deshalb im 500er statt in der Rebrickable-Rückfallebene zwei Zeilen darunter.

`getSetByEan` und `getSetByBarcode` waren ausserdem Zeichen für Zeichen
gleich bis auf die Log-Beschriftung (Brickset kennt für beides keinen eigenen
Parameter). Jetzt eine Umsetzung `findSetByQuery(query, herkunft)`, die beiden
Namen bleiben als dünne Hüllen.

### Warum der Compiler das nicht gefunden hat

Das Projekt löst Require-Zyklen mit späten `require()`-Aufrufen mitten im Code
— rund 340 Stück. Für `import` prüft TypeScript den Namen, für `require()`
nicht: Das Ergebnis ist `any`. **`test/require-exports.test.js`** schliesst die
Lücke und lädt jedes Zielmodul aus `dist/`, um nachzusehen, was `require()`
wirklich liefert. Über 300 Namen geprüft; ausser diesen beiden war nichts
offen.

### Das Tageskontingent hatte eine zweite Tür

Die Barcode-Route hatte ein eigenes `rbGet()` ohne `consumeRebrickableDaily()`
und ohne Drossel. Ein einziger Scan konnte bis zu acht ungezählte Aufrufe
auslösen (EAN-Suche, je Treffer ein Detailabruf, zwei in `enrichResult`) —
dasselbe Muster wie beim Rebrickable-Zähler, nur an einer Datei, die damals
nicht dran war. Ist das Kontingent erschöpft, liefert `rbGet` jetzt null, und
die Route nimmt den Weg wie bei einem fehlgeschlagenen Abruf.

### downloadSetImage(): drei offene Enden

* Weiterleitungen wurden per Rekursion OHNE Tiefenbegrenzung verfolgt — eine
  Kette im Kreis lief endlos. Jetzt höchstens fünf Sprünge.
* Keine Grössenbegrenzung; jetzt 5 MB wie im Bild-Proxy.
* `fs.existsSync` + `fs.writeFileSync` blockierten den Event-Loop. Genau das
  ist in `routes/parts.ts` längst behoben, mitsamt Erklärkommentar — diese
  Stelle war übersehen worden.

### Drei Kleinigkeiten aus früheren Durchgängen

* **Doppelte Middleware:** Zwei aufeinanderfolgende Middlewares zogen beide
  mehrfache Schrägstriche zusammen; die erste war von der zweiten vollständig
  abgedeckt und ist entfallen.
* **SESSION_SECRET:** Der Fail-fast prüfte nur, OB die Variable gesetzt ist.
  Wer `docker compose up` ungelesen ausführte, lief mit dem öffentlich
  bekannten Beispielwert in Produktion — ein damit signiertes Cookie kann
  jeder selbst erzeugen. In Produktion werden jetzt die bekannten Platzhalter
  UND Werte unter 32 Zeichen abgewiesen; `compose.yaml` nennt
  `openssl rand -base64 48` als Weg zum eigenen Wert.
* **qr-login** trägt `ipThrottle` wie register/forgot/reset (30/Stunde).

### Zwei Tests, die an der Umsetzung klebten

Beim Aufräumen wurden zwei bestehende Prüfungen rot, obwohl sich am Verhalten
nichts geändert hat: Eine hing am Wortlaut der entfallenen Middleware, die
andere zählte `family: 4`-Stellen in `routes/parts.ts` (eine davon lag in der
gelöschten Zweitfassung). Beide sind auf das umgestellt, was sie eigentlich
meinen. Das ist dieselbe Sorte Test, die schon einmal eine Sicherheitslücke
festgeschrieben hat.

### Und eine Falle im Kommentar-Filter selbst

Der Filter, der vor Quelltextprüfungen die Kommentare ausblendet, war naiv:
`app.get('/images/*', …)` in `server.ts` eröffnet mit dem `/*` für die
Ersetzung einen Blockkommentar, den erst das nächste echte Kommentarende
schliesst — 28 von 53 KB verschwanden, und drei neue Prüfungen wurden grundlos
rot. `ohneKommentare()` in `test/helpers/sources.js` entfernt jetzt nur noch
Kommentare, die eine ZEILE beginnen, und ist die gemeinsame Fassung für alle
Tests.

450 Tests grün gegen echtes Postgres 16, 0 übersprungen. Alle sechs neuen
Regeln einzeln gebrochen — jede machte genau ihren Test rot.

## Nachtrag 17 — Der Katalog war täglich für Minuten leer

Sechs Punkte aus dem Durchgang über den täglichen CSV-Abgleich — der war bis
jetzt nie dran gewesen.

### 1. Import ohne leeres Fenster

Jeder Import begann mit `TRUNCATE`/`DELETE` OHNE Transaktion, danach liefen
minutenlang die Chunk-Inserts (`rb_inventory_parts`: rund 1,5 Mio. Zeilen). Mit
zwei Verbindungen gegen echtes Postgres nachgestellt — der Leser sah sofort
`0` Zeilen, und zwar für die volle Importdauer. Für die Anwendung: Sets ohne
Teile, fehlende Farb- und Teilenamen, täglich. Brach der Import ab, blieb die
Tabelle bis zum nächsten Tageslauf unvollständig.

Der naheliegende Griff — eine Transaktion drumherum — macht es schlimmer:
`TRUNCATE` nimmt eine ACCESS-EXCLUSIVE-Sperre, Leser blockieren dann für die
volle Importdauer (ebenfalls nachgestellt: die Leseabfrage hing).

Jetzt `importiereMitTausch()`: Daten zuerst vollständig in eine UNLOGGED
Schattentabelle (`LIKE … INCLUDING ALL`, damit die ON-CONFLICT-Klauseln ihre
Schlüssel behalten), dann EINE Transaktion mit `DELETE` + `INSERT … SELECT`.
Das `DELETE` nimmt nur Zeilensperren — dank MVCC sehen Leser bis zum COMMIT den
alten vollständigen Bestand und danach den neuen. Nie einen leeren. Alle acht
Importe laufen darüber; aus je zwölf Zeilen Task-Code wurde eine Beschreibung.

Dazu eine Plausibilitätsbremse: 0 gelesene Zeilen bricht ab, statt den Katalog
durch nichts zu ersetzen (abgebrochener Download, kaputte Datei).

### 2. Insert-Fehler brechen ab

`mkInsert()` endete auf `.catch(() => {})`. Ein abgewiesener Block verlor bis
zu 100 Zeilen, der Import meldete Erfolg und setzte den Tagesmarker — der
Katalog war still unvollständig. Jetzt bricht der Task ab.

### 3. Zeitlimit für den Download

`downloadToTmp()` rief `https.get` ohne Frist. Eine hängende Verbindung liess
den Abgleich für immer stehen — und weil er beim Erststart läuft, blieb die
Startanzeige ewig auf „Lade…". Jetzt 60 s Untätigkeitsfrist (`setTimeout` misst
die Pause zwischen Datenpaketen, grosse Dateien dürfen also beliebig lange
laden).

### 4. Zwischendateien werden aufgeräumt

Nach dem Import löschte niemand die entpackten `.tmp`-Dateien;
`inventory_parts.csv.tmp` liegt bei rund einem Gigabyte. Jetzt `unlink` im
`finally` von `runWorker`, auch bei Abbruch.

### 5. Sechs Funktionen ohne Aufrufer

`downloadCsv`, `streamCsvToDB` und `fetchBlIds` (`rebrickableCsvSync.ts`),
`extractSetFromEan`, `partIsToday`, `probeBrickInstructions` — rund 250 Zeilen,
darunter eine dritte Kopie der CSV-Zerlegung und eine dritte der
BrickInstructions-Prüfung. Mit ihnen entfielen die nur noch dort benutzten
Importe (`https`, `http`, `zlib`, `readline`, Ratenbegrenzer).

Toter Code war in drei Durchgängen hintereinander der Ausgangspunkt eines
echten Fehlers — solche Fassungen bekommen keine Korrekturen, keine Sperren,
keine Kontingentprüfung, und irgendwann ruft sie doch jemand auf. Deshalb
`test/dead-code.test.js` als Dauerprüfung.

### 6. Verdoppelte Anführungszeichen

`parseCsvLine` schaltete bei jedem `"` nur den Zustand um und verwarf das
Zeichen: Aus `3 "Zoll"` wurde `3 Zoll`. Kommas in Anführungszeichen waren nie
betroffen, deshalb fiel es lange nicht auf. Jetzt wird `""` zu einem `"`.

### Nachweise

`test/csv-import-db.test.js` prüft gegen echtes Postgres: Eine zweite
Verbindung zählt während des laufenden Imports mit und schlägt Alarm, wenn sie
je 0 Zeilen sieht; dazu leere Datei, fehlerhafter Block, Anführungszeichen und
„keine Schattentabelle bleibt liegen". Gegenprobe mit dem alten `DELETE`
vorweg: sofort rot.

Punkt 3 ist als einzige eine Quelltextregel — ein echter Nachweis bräuchte
einen TLS-Server, der annimmt und dann schweigt. Die Regel ist wenigstens gegen
`if (false)` abgesichert (der Aufruf muss eine eigene Anweisung sein).

### Und wieder ein Test, der an der Umsetzung klebte

Die IPv4-Prüfung zählte je Datei eine feste Anzahl `family: 4`-Fundstellen und
wurde durch das Aufräumen rot (5 statt 1), obwohl sich am Verhalten nichts
änderte — dasselbe wie in Nachtrag 16. Sie prüft jetzt die Regel: Jeder
ausgehende `get`/`request`-Aufruf trägt `family: 4` oder den geprüften
`_cdnAgent`, unabhängig von der Anzahl.

459 Tests grün gegen echtes Postgres 16, 0 übersprungen.

## Nachtrag 18 — PDF-Aufträge ohne Besitzer

Vier Punkte aus dem Durchgang über den PDF-Export und den CSV-Export.

### 1. Wem gehört ein Auftrag?

`pdfJobWrite()` legte `{status, error, missingImages, etaSeconds}` ab — keine
Benutzer-ID. Alle drei Abrufrouten (`status`, `stream`, `download`) verlangten
einen gültigen Token, prüften aber nie, WESSEN Auftrag das ist. Wer eine fremde
`jobId` kannte, lud deren PDF herunter; weil der Download die Datei danach
löscht, bekam der eigentliche Besteller anschliessend ein „PDF nicht mehr
verfügbar". Dieselbe Regel wie bei `serveDataFile` in Nachtrag 10: Die
Zugehörigkeit gehört auf den Server, nicht in die Unkenntnis der ID.

Jetzt trägt jeder Auftrag `user_id`, und die drei Routen kommen nur noch über
`pdfJobReadFor(id, userId)` an ihn. Ein fremder Auftrag antwortet mit demselben
404 wie ein unbekannter — wer nicht berechtigt ist, soll nicht erfahren, ob es
die ID gibt.

Dazu die Kennung selbst: Sie kam aus `Math.random().toString(36)`. Jeder andere
Schlüssel im Projekt kommt aus `crypto.randomBytes` (sechs Stellen in
`routes/auth.ts`); hier war die Ausnahme ohne Grund. Jetzt sechs Zufallsbytes
als Hex. Das Prüfmuster lässt die alte Form weiter zu, damit Aufträge über ein
Update hinweg abrufbar bleiben.

### 2. Deckel auf gleichzeitige Läufe

Jeder POST startete über `setImmediate` einen Lauf im bearbeitenden Web-Worker,
der hunderte Bilder nachlädt und das PDF im Arbeitsspeicher aufbaut. Zehnmal
auf den Knopf getippt hiess zehn parallele Läufe in einem Prozess. Jetzt zwei
gleichzeitige Aufträge je Benutzer, darüber 429 mit Klartext-Hinweis.

Gezählt wird über die Auftragsdateien im gemeinsamen Verzeichnis, nicht über
einen Zähler im Prozessspeicher — der lag in dieser Sammlung schon sechsmal
daneben. Abgelaufene Aufträge zählen nicht mit: Stürzt ein Worker mitten im
Lauf ab, bleibt die Datei auf `running` stehen, und ohne diese Frist wäre der
Benutzer dauerhaft ausgesperrt.

### 3. Aufräumen hängt nicht mehr am nächsten Export

`cleanOldPdfJobs()` lief ausschliesslich im POST. Wer einen Export abbrach und
nie wieder einen startete, liess PDF und Auftragsdatei dauerhaft liegen. Jetzt
stündlich im Primary (`startPdfJobCleanup()`), direkt neben dem Bild-Cache, der
aus demselben Grund dorthin gewandert ist.

### 4. Formeln im CSV-Export

`csvField()` zitierte korrekt, entschärfte aber führende `=`, `+`, `-`, `@`,
Tabulator und Wagenrücklauf nicht — eine Notiz oder ein Setname wie
`=HYPERLINK(…)` wird beim Öffnen in Excel, LibreOffice oder Google Sheets
AUSGEFÜHRT. Der Inhalt kommt aus Feldern, die auch ein Unterkonto im Haushalt
schreiben kann.

Der Zielkonflikt war real: Die Exporte sind ausdrücklich so gebaut, dass der
eigene Importer sie wieder einliest. Deshalb zwei Hälften — `entschaerfe()`
setzt beim Export ein Hochkomma, `entschaerfungRueckgaengig()` entfernt es beim
Import wieder, und zwar NUR wenn danach ein Formelzeichen steht. Ein Feld, das
echt mit einem Hochkomma beginnt, bleibt unangetastet. Reine Zahlen sind
ausgenommen, sonst käme jeder negative Kaufpreis mit Hochkomma zurück. Alle
drei Importwege (Sets, Teile, Minifiguren) machen die Entschärfung rückgängig.

### Nachweise

`test/pdf-jobs-db.test.js` fährt echte Routen mit echten Tokens: eigener
Auftrag lesbar, fremder mit 404 und ohne PDF-Inhalt, der Fehlversuch
beschädigt den fremden Auftrag nicht, Deckel greift beim dritten Lauf und
bremst den zweiten Benutzer nicht, hängengebliebene Läufe sperren niemanden
aus, Kennung ist 6-Byte-Hex und wiederholt sich in 200 Ziehungen nicht.

Der Lauf selbst wird nicht gestartet (er ginge ins Netz) — die
Auftragsdateien legt der Test direkt. Geprüft wird der Abrufweg, und genau
dort fehlte es.

Gegenproben: Besitzprüfung deaktiviert, Deckel deaktiviert, Kennung zurück auf
`Math.random`, Formelschutz entfernt — jede machte genau ihren Test rot.

467 Tests grün gegen echtes Postgres 16, 0 übersprungen.

## Nachtrag 19 — Die Portfolio-Kurve rechnete im falschen Prozess

### 1. Rekonstruktion in der Datenbank statt im Node-Heap

`getPortfolioHistory()` lud JEDE `price_history`-Zeile aller Sets in den
Node-Prozess und gruppierte sie in JavaScript. Für den Haushalt ist das der
Normalfall, nicht die Ausnahme — der schnelle Schnappschuss-Weg gilt nur für
ein einzelnes Konto.

Gemessen mit 800 Sets und einem Jahr Tageswerten (292 000 Zeilen, 40 MB):

| Fall | Zeitraum | vorher | nachher |
|---|---|---|---|
| ein Konto | Monat | 264 ms / +4,9 MB | 144 ms / +1,1 MB |
| ein Konto | Max | 1199 ms / +41,8 MB | 487 ms / ±0 MB |
| Haushalt | Monat | 280 ms / +7,2 MB | 244 ms / ±0 MB |
| Haushalt | Max | 1741 ms / +34,0 MB | 931 ms / ±0 MB |

Zwei Änderungen stecken darin:

**Fortschreibung als Differenzrechnung.** Ein Set ohne neuen Wert behält seinen
letzten Preis — in der alten Schleife über ein `carry`-Objekt. In SQL wird je
Set nur die ÄNDERUNG zum Vorwert gezählt; die laufende Summe über die Tage
ergibt denselben Gesamtwert. Ein einfaches `GROUP BY Tag` wäre schneller
gewesen, hätte aber ANDERE Zahlen geliefert: Tage ohne Messwert fielen aus der
Summe.

**Monatsauflösung für Jahr und Max.** Die Verdichtung auf Monate passierte
ohnehin — nur eben erst NACH dem Laden aller Tageswerte. Jetzt gruppiert
Postgres gleich richtig, der Fensterlauf fällt von 292 000 auf 9 600 Zeilen
(203 ms statt 1478 ms für die reine Abfrage).

Zwei Feinheiten, die dabei erhalten bleiben mussten: Der erste Punkt zeigt den
Wert am ersten Tag MIT Daten, nicht am Monatsende (eigene kleine Abfrage,
129 ms) — sonst begänne die Jahreskurve höher als die Monatskurve. Und der
Zeitraumfilter gilt auch für diesen Startpunkt, sonst zählten Daten VOR dem
Fenster mit.

### 2. Ein Preiseintrag je Set, Zustand, Währung und Tag

Zwei Schreibwege (`priceJob.ts` beim Abruf, `financeCalc.ts`) tragen
`ON CONFLICT DO NOTHING` — die Tabelle hatte aber nur den Primärschlüssel auf
`id`. Ohne passenden Unique-Index kann die Klausel nie greifen: Sie liest sich
wie ein Schutz gegen Dubletten und ist keiner.

Jetzt gibt es den Index (`recorded_at` ausdrücklich in UTC, weil
`recorded_at::date` zeitzonenabhängig und damit nicht indizierbar wäre), und
die Migration räumt vorhandene Dubletten vorher weg — es gewinnt der jüngste
Eintrag des Tages, genau der, den die Auswertung ohnehin genommen hätte.

Dazu ein Aufräumlauf: `purgeAltePreise()` entfernt täglich im Primary Zeilen
älter als `PRICE_HISTORY_KEEP_DAYS` (Vorgabe 1095, 0 = aus). Die
Portfolio-Schnappschüsse (`__portfolio__<id>`) sind ausgenommen — daran hängt
der schnelle Weg für ein einzelnes Konto.

### 3. Der Mailer prüft wieder Zertifikate

`routes/mailer.ts` setzte fest verdrahtet `rejectUnauthorized: false` — die
einzige Stelle im Projekt, die eine TLS-Prüfung abschaltete. Damit gingen die
SMTP-Anmeldung und jeder Link zum Zurücksetzen eines Passworts über eine
Verbindung, deren Gegenstelle nicht überprüft wurde.

Vorgabe ist jetzt PRÜFEN. Für selbst signierte Zertifikate im Heimnetz bleibt
die Ausnahme möglich, aber als bewusste Entscheidung: `smtp_insecure_tls`
(Einstellungen → E-Mail, mit Warnung im Log bei jedem Verbindungsaufbau).

### Nachweise

`test/portfolio-history-db.test.js` bringt die ALTE JavaScript-Fassung als
Vergleich mit — wörtlich übernommen und bewusst als Kopie, damit sie sich nicht
mitändert. Beide rechnen auf denselben Daten, für alle vier Zeiträume, und die
Werte müssen bis auf einen Rappen übereinstimmen (die alte Fassung rechnete in
Gleitkomma, die neue in NUMERIC). Der Testbestand hat ausdrücklich LÜCKEN — ein
Set schreibt nur jeden dritten Tag — denn genau dort trennt sich Fortschreibung
von einfacher Tagessumme.

Gegenproben: Fortschreibung ausgehängt (alle vier Zeiträume rot), Unique-Index
nicht angelegt (beide Dubletten-Prüfungen rot), `rejectUnauthorized: false`
zurückgesetzt (Mailer-Prüfung rot).

479 Tests grün gegen echtes Postgres 16, 0 übersprungen.

## Nachtrag 20 — Drei gemeldete Fehler beim Eigentümerwechsel

Marco hat einen Bildschirmausschnitt der App, zwei Browser-Konsolenfehler und
drei Zeilen aus dem Serverprotokoll geschickt. Dahinter steckten vier
verschiedene Ursachen — alle am selben Vorgang: einen Kaufpreis in ein anderes
Konto des Haushalts verschieben.

### 1. „closeModal is not defined" (Browser-Konsole)

`07-admin.js` ruft nach dem Wechsel `closeModal()` auf. Die Funktion lag als
modul-LOKALE Funktion in `02-gallery.js` und war nur über `registerActions()`
für `data-click`-Knöpfe im HTML erreichbar — als Import gab es sie nie. Der
Wechsel war zu dem Zeitpunkt bereits gespeichert; sichtbar blieben ein offener
Dialog und eine Galerie mit altem Stand. Der Fehler kam aus dem `<select>` für
das Zielkonto, deshalb `at HTMLSelectElement` in der Konsole.

Jetzt exportiert und importiert. **`test/frontend-imports.test.js`** prüft das
künftig für alle Frontend-Module: Ruft eine Datei einen Namen auf, den ein
anderes Modul auf oberster Ebene deklariert, muss sie ihn importieren. Das ist
die Frontend-Fassung von `test/require-exports.test.js` — dort prüft TypeScript
die späten `require()` nicht, hier prüft niemand die Modulgrenzen.

### 2. 500er: „Cannot access 'onProgress' before initialization"

Im CSV-Fortschrittsstrom (SSE) stand der erste `send()` VOR den Anmeldungen.
Meldet der Client beim allerersten Schreiben Gegendruck — Handy im Funkloch,
halb tote Verbindung —, ruft `send()` sofort `cleanup()` auf, und das greift
auf `onProgress` zu, das als `const` erst weiter unten entsteht. Im Protokoll
standen beide Zeilen direkt hintereinander: erst der Gegendruck-Hinweis, dann
der Fehler.

Jetzt werden erst alle Rückrufe und Zeitgeber angelegt, dann der erste Stand
geschickt. Der Test prüft die Reihenfolge: Alles, was `cleanup()` anfasst, muss
vor dem ersten `send()` auf oberster Ebene stehen.

### 3. pg-Warnung: parallele Abfragen auf einer Verbindung

`copyContents()` in `utils/setMove.ts` prüfte per `Promise.all` drei Tabellen
gleichzeitig — auf DERSELBEN Transaktionsverbindung. pg warnt davor („will be
removed in pg@9.0"); in einer Transaktion ist die Reihenfolge von BEGIN,
Abfrage und COMMIT dann nicht mehr die, die im Code steht. Jetzt nacheinander;
zeitlich kostet es nichts (drei Indexzugriffe auf LIMIT 1).

**Zum Test:** Der erste Anlauf war eine Quelltextregel („kein Promise.all mit
mehreren `tx.`-Aufrufen"). Die hätte den echten Fehler NICHT gefunden — die
Abfragen standen hinter einem Helfer namens `has()`. Ersetzt durch
`test/set-move-db.test.js`, das den Lauf ausführt und die Warnungen von Node
mitschreibt. Gegenprobe mit `Promise.all`: sofort rot.

### 4. „0 Teile und 0 Minifiguren mitgenommen" (Android)

Kein Datenfehler — die Meldung log. In `AcquisitionManagementScreen.kt` stand

    val moveOkText = stringResource(R.string.household_move_ok, 0, 0)

mit fest verdrahteten Nullen. Der Server liefert `parts` und `minifigs` seit
jeher mit, `GenericResponse` hatte dafür aber keine Felder, und
`changeAcquisitionOwner` reichte nur `onDone(null)` durch. Jetzt trägt die
Antwort die Zahlen, der Rückruf gibt sie weiter, und die Meldung entsteht erst
dort.

Dass 0 auch die richtige Antwort sein kann, bleibt wahr: bei einem Set ohne
importierte Teile, und wenn das Zielkonto für dieses Set schon Zeilen hat
(dann kopiert der Server bewusst nichts). Beide Fälle sind jetzt als Verhalten
festgehalten.

### Noch ein Test, der an der Umsetzung klebte

`test/household.test.js` verlangte wörtlich `const [hasParts, hasFigs,
hasInstr]` — durch die Korrektur aus Punkt 3 wurde er rot, obwohl sich an der
geprüften Regel nichts geändert hat. Jetzt prüft er die Aussage: eine eigene
Prüfung je Tabelle.

486 Tests grün gegen echtes Postgres 16, 0 übersprungen.

## Nachtrag 21 — Geld war Gleitkomma, und das Erst-Passwort stand im Log

Beide Punkte kamen nicht aus dem Lesen, sondern daraus, den Server einmal zu
starten und die Endpunkte abzuklopfen.

### 1. Geldbeträge als NUMERIC statt REAL

27 Preisspalten lagen als REAL (32-Bit-Gleitkomma) in der Datenbank. Am
laufenden Server sichtbar:

    /api/sets       → "avg_purchase_price": 49.9000015258789
    /api/finance/…  → "value": 49.900001525878906

für einen eingegebenen Kaufpreis von 49.90. Schlimmer als die Anzeige ist das
Rechnen — in Postgres nachgestellt:

    SUM über 1000 Beträge à 0.07  →  69.99974   (exakt wären 70.00)
    12.34::real * 3               →  37.02000045776367

Der Fehler wächst mit der Zahl der Summanden, also mit der Sammlung. Genau
diese Summen zeigt der Finanzreiter.

`db/migrations/0007-geld-als-numeric.sql` stellt alle 27 Spalten auf
NUMERIC(12,4) um; `initSchema()` legt sie bei Neuinstallationen gleich so an.
Vier Nachkommastellen, weil Stückpreise einzelner Teile unter einem Rappen
liegen können. Der USING-Ausdruck rundet den Altbestand auf vier Stellen —
das REPARIERT: Aus gespeicherten 49.9000015258789 wird wieder 49.9000, denn
mehr Stellen hatte die Eingabe nie.

**Der Treiber liefert NUMERIC als Zeichenkette.** Ohne Gegenmassnahme würde aus
`preis * menge` an hunderten Stellen eine Zeichenketten-Rechnung, und ein Preis
von 0 wäre als `"0.0000"` in jeder if-Abfrage wahr — genau die Sorte stiller
Fehler, die diese Umstellung nicht eintauschen soll. `db/database.ts` setzt
deshalb einen Typ-Parser, der NUMERIC beim Lesen wieder zu einer
JavaScript-Zahl macht. Der Gewinn bleibt vollständig: Er liegt beim SPEICHERN
und beim RECHNEN IN DER DATENBANK, und dort ist jetzt alles exakt dezimal.

Nachher, gegen einen frisch gestarteten Server mit demselben Kaufpreis:

    {'purchase_price': 49.9, 'max_purchase_price': 49.9, 'avg_purchase_price': 49.9}
    Diagrammwert: 49.9

### 2. Das Erst-Passwort ging durch den Log-Abfänger

`initSchema()` gibt das erzeugte Admin-Passwort beim ersten Start auf der
Konsole aus — „NUR JETZT sichtbar". Das stimmte seit dem Log-Abfänger nicht
mehr: Der schreibt JEDE Konsolenzeile nach `app_logs`, und
`GET /api/v1/admin/logs` gab sie 48 Stunden lang im Klartext wieder aus —
mitsamt jedem Datenbank-Backup aus diesem Zeitraum. Über die echte Route
abgerufen und bestätigt.

Der Banner geht jetzt direkt über `process.stdout.write` und damit am Abfänger
vorbei: Er steht im Container-Log des ersten Starts, wo er hingehört. Ein
Filter im Abfänger wäre die Alternative gewesen — der hinge an einer
Zeichenkette, die jemand später umformuliert.

Gegengeprüft am laufenden Server: `NUR JETZT` steht einmal im Container-Log,
der Log-Viewer liefert null Treffer.

### Nachweise

`test/money-numeric-db.test.js`: keine Geldspalte mehr in Gleitkomma (weder bei
Neuinstallation noch nach der Migration einer alten Datenbank — die wird
ausdrücklich nachgestellt, indem eine Spalte auf REAL zurückgesetzt und die
Migration erneut angestossen wird), 1000 Beträge à 0.07 summieren sich exakt
auf 70, ein gespeicherter Kaufpreis kommt als 49.9 zurück, und die Werte
kommen als Zahl an, nicht als Zeichenkette.

Drei Gegenproben: Typ-Parser entfernt (Zahl-Prüfung rot), Spalten zurück auf
REAL samt entfernter Migration (vier Prüfungen rot), Banner zurück auf
`console.log` (Passwort-Prüfung rot).

Beim zweiten Gegenprobe-Anlauf fiel auf, dass der Bau die `.sql`-Dateien nach
`dist/` kopiert: Die gelöschte Migration lag dort noch und lief weiter — der
Test blieb grün, obwohl die Quelle weg war. Erst mit gelöschter Kopie wurde er
rot. Wer künftig eine Migration zurückzieht, muss `dist/` mit aufräumen.

493 Tests grün gegen echtes Postgres 16, 0 übersprungen.

## Nachtrag 22 — Gleichzeitiges Erfassen verlor Exemplare

### 1. Der Erfassen-Pfad lief ohne Sperre

Alle anderen Schreibwege (Mengenänderung, Verschieben, Eigentümerwechsel)
hielten die Bestandssperre aus `utils/txLock.ts` längst — ausgerechnet das
Erfassen nicht. `recordAcquisitionForDay()` liest erst und schreibt dann; zwei
gleichzeitige Anfragen lesen beide „keine Zeile für heute". Am laufenden Server
mit zehn parallelen Erfassungen desselben Sets:

    sets.quantity     = 10        (richtig)
    set_acquisitions  = 3 Zeilen, Summe 7

Drei Tageszeilen statt einer und drei verlorene Exemplare. Die Finanzzahlen
kommen aus den Erfassungen — der Bestand sagte 10, die Kaufpreise sagten 7.
Realistisch wird das beim Doppeltippen in der App, beim CSV-Import parallel zur
App oder bei zwei Geräten.

Beide Schreibzweige in `addSet()` laufen jetzt unter `withInventoryLock`. Der
Marktpreis wird davor geholt: Eine Sperre über einen Netzaufruf zu halten würde
jeden anderen Schreibvorgang auf diesem Set für die Dauer der Antwort
blockieren.

### 2. Die Tagesregel steht jetzt in der Datenbank

Im Code stand die Notiz, ein UNIQUE-Index sei unmöglich, weil
`timestamptz::date` nicht IMMUTABLE ist. Das stimmt — aber
`(created_at AT TIME ZONE 'UTC')::date` ist es, und genau dieser Kniff steht
seit Nachtrag 19 schon in `price_history`.

`db/migrations/0008` fasst doppelte Tageszeilen zusammen (Mengen addiert, Preis
mengengewichtet, gebraucht gewinnt — dieselbe Rechnung wie beim Aufstocken) und
legt für alle drei Erfassungstabellen den Unique-Index an. Der Tagesvergleich
in `utils/acquisitions.ts` läuft dafür auf UTC statt auf die Sitzungszeitzone;
der Server läuft ohnehin in UTC (`Etc/UTC` im Container), für die Installation
ändert sich nichts.

Die Sperre verhindert das Rennen, der Index ist das Netz darunter — er gilt
auch für Wege, die jemand später hinzufügt und dabei die Sperre vergisst.

### 3. Menge und Preis werden serverseitig geprüft

Über die API kam durch: `quantity: -5`, `quantity: 999999999` (stand danach als
999 999 995 in `sets`) und `purchase_price: -20` — letzteres an allen drei
Erfassen-Wegen. Ein Tippfehler mit Minuszeichen senkte damit stillschweigend
den Gesamtwert der Sammlung.

Neu in `utils/validate.ts`: `acquisitionQuantity()` (1 bis 10 000) und
`optionalPrice()` (nicht negativ, Komma als Dezimaltrenner, 0 bleibt ein
gültiger Preis). Angewandt in allen vier Erfassen-Wegen — Webapp und
Android-API, Sets wie manuelle Einträge. Die Weboberfläche verhinderte das mit
`min="0"`; die Regel gehört auf den Server, App und API gehen daran vorbei.

### Nachweise

`test/erfassen-parallel-db.test.js` fährt zehn echte parallele Aufrufe und
prüft: eine Tageszeile, Menge 10. Dazu der Index (zweite Tageszeile wird
abgewiesen, ein anderer Tag bleibt erlaubt) und die Prüffunktionen selbst.

Gegenproben: eine Sperre entfernt (Regel-Test rot), Migration entfernt (drei
Index-Prüfungen rot).

Zwei bestehende Tests verlangten wörtlich `created_at::date` und wurden durch
den UTC-Ausdruck rot, obwohl sich an der geprüften Regel nichts geändert hat —
auf die Aussage umformuliert.

500 Tests grün gegen echtes Postgres 16, 0 übersprungen.

## Nachtrag 23 — Ein krummer CSV-Eintrag kippte die ganze Datei

Gefunden beim Abklopfen des laufenden Servers: Eine Datei mit einer einzigen
fehlerhaften Zeile importierte **nichts**, und die Antwort war die rohe Ausgabe
des Parsers:

    CSV Parse Fehler: Invalid Record Length: columns length is 3, got 1 on line 3

Für eine 500-Zeilen-Liste aus einer Fremdquelle ist das die schlechteste
denkbare Antwort — nichts importiert, und wer die Meldung liest, weiss nicht,
was zu tun ist.

Neu ist `csvEinlesen()` in `utils/csvExport.ts`: `relax_column_count` und
`relax_quotes` lassen krumme Zeilen durch, wirklich leere Zeilen werden
übersprungen und ihre Zeilennummern kommen mit zurück — 1-basiert und inklusive
Kopfzeile, also so, wie sie im Editor stehen. Vollständig unlesbare Dateien
werfen weiterhin; dann stimmt etwas Grundsätzliches nicht.

Alle drei Importwege (Sets, manuelle Teile, manuelle Minifiguren) lesen jetzt
darüber, liefern `skipped` und `skipped_hint` in der Antwort, und beide
Oberflächen zeigen den Hinweis an — sonst sähe ein Import mit stillen Lücken
aus wie ein vollständiger. Findet sich gar keine brauchbare Zeile, sagt die
Fehlermeldung das jetzt in Klartext statt in Parser-Sprache.

Gegenprobe: `relax_column_count` entfernt → der Test wird rot.

502 Tests grün gegen echtes Postgres 16, 0 übersprungen.

## Nachtrag 24 — Die Teileliste eines Sets war in der App unvollständig

Punkt B aus dem letzten Durchgang lautete: „`/api/parts` liefert ohne
page_size alles auf einmal, und die Android-App ruft so auf". Der zweite Teil
stimmte nicht — die App schickt seit jeher `page_size=500` und blättert über
`onLoadMore` nach. Die Behauptung stammte aus einem veralteten Kommentar in
`utils/handlers.ts`, den ich ungeprüft übernommen hatte.

Beim Nachmessen kam dafür ein echter Fehler heraus, der schwerer wiegt.

### Die Set-Detailansicht bekam nur 500 Teile

Sie fragt `page_size=2000` und holt NUR Seite 1. `clampPageSize` deckelte auf
`MAX_PAGE_SIZE = 500`. Am laufenden Server mit einem Set aus 915 Teilezeilen:

    geliefert 500 von total 915 | page_size (gemeldet) 2000

Zwei Fehler in einem. Die App zeigte gut die Hälfte der Teile — und die
Antwort meldete die ANGEFRAGTE Seitengrösse zurück, nicht die gelieferte.
Damit konnte kein Client merken, dass etwas fehlt. Die PDF-Teileliste baut auf
derselben Antwort auf.

Jetzt:

* **`SET_PARTS_MAX_PAGE_SIZE = 5000`** gilt, wenn nach `set_number` gefiltert
  wird. Ein Set ist eine begrenzte Menge; die grössten liegen bei rund 12 000
  Teilen, nach Farbe gruppiert deutlich darunter. Für die allgemeine
  Teileliste bleibt es bei 500 — dort blättern beide Clients.
* **Die Antwort meldet die tatsächliche Seitengrösse.** Zusammen mit `total`
  lässt sich jetzt ablesen, ob eine weitere Seite nötig ist.
* **`UNPAGED_LIMIT = 2000`** greift, wenn ein Aufrufer gar kein `page_size`
  schickt — auf BEIDEN Abfragewegen. Dass Zusammenfassungs- und Live-Pfad sich
  unterschiedlich deckeln, war schon einmal ein Fehler (dieselbe Anfrage
  lieferte je nach Cache-Zustand 500 oder 5000 Zeilen).

### Was ausdrücklich NICHT gedeckelt wurde

Die SET-Liste. Ein erster Anlauf gab ihr dieselbe Grenze — falsch: Die App
blättert die Galerie nicht (`BrickApiService.getSets` kennt keinen
page-Parameter, so auch in `routes/api_v1/sets.ts` vermerkt). Eine Grenze hätte
ihr ab dem Grenzwert stillschweigend Sets unterschlagen, also genau den Fehler
erzeugt, der oben behoben wurde. Aufgefallen ist es an einem bestehenden Test,
der die unbegrenzte Set-Liste festhält.

### Nachweis

Am laufenden Server, alle vier Fälle:

    set_number, page_size=2000  →  915 von 915  | page_size 2000
    page_size=2000              →  500 von 3900 | page_size 500
    ohne page_size              → 2000 von 3900 | page_size 2000
    /api/v1/sets                →  801 von 801

Gegenprobe: Set-Grenze zurück auf MAX_PAGE_SIZE → Test rot.

Ein bestehender Test verlangte wörtlich `clampPageSize(o.page_size, 100)` im
Zusammenfassungs-Pfad und wurde rot, obwohl die Regel („beide Wege deckeln
gleich") unverändert gilt — auf die Aussage umformuliert.

503 Tests grün gegen echtes Postgres 16, 0 übersprungen.

## Nachtrag 25 — Der Sammelposten „Unterkonten" entfällt

Auf Marcos Wunsch: Der Eintrag „Unterkonten" fällt aus dem Kontofilter — in
allen vier Ansichten der Webapp und in der Android-App.

Begründung: Er beantwortete nur „nicht mir" und stand zwischen zwei Einträgen,
die dieselbe Frage genauer beantworten. Bei zwei Kindern war die Auswahl damit
fünf Zeilen lang, von denen eine nichts hinzufügte. Übrig bleiben: Alle Konten,
Eigene, dann jedes Unterkonto namentlich.

Entfallen sind auch die zugehörigen Texte (`household.scope_subs` in de/en,
`household_scope_subs` in beiden strings.xml) und der `labelSubs`-Parameter von
`ScopeFilter.options()`.

**Der Server versteht `accounts=subs` weiterhin.** Das ist Absicht und kein
vergessener Rest: Eine ältere Fassung der App auf einem Gerät schickt den Wert
sonst ins Leere. `parseScopeMode()` und `scopeIds()` bleiben deshalb
unverändert, und die bestehenden Prüfungen dazu ebenfalls.

Der Kotlin-Test „der Sammelposten erscheint erst ab zwei Kindern" ist zu „kein
Sammelposten Unterkonten mehr" geworden — er hält jetzt fest, dass der Eintrag
auch bei mehreren Kindern nicht wieder auftaucht.

503 Tests grün gegen echtes Postgres 16, 0 übersprungen.

## Nachtrag 26 (hardened-141) — Passwort-vergessen fand Gross-/Kleinschreibung nicht

**Der Fund.** `POST /api/auth/forgot-password` verglich die E-Mail als einzige
Stelle im Projekt case-SENSITIV (`WHERE email = $1`); Login, Registrierung und
Profil arbeiten überall mit `LOWER(...)` auf beiden Seiten. Die Registrierung
speichert die Adresse unverändert wie eingegeben — wer sich als
`Marco@Example.CH` registriert hatte und im Formular `marco@example.ch`
tippte, bekam die (bewusst neutrale) Erfolgsmeldung „Falls die E-Mail
existiert…", aber es wurde kein Token gesetzt und keine Mail verschickt. Von
aussen nicht von Erfolg zu unterscheiden; ohne funktionierendes Passwort ist
das Konto dauerhaft verloren. Am laufenden System nachgestellt, bevor es
gemeldet wurde. Wieder das bekannte Muster: eine Regel fehlt an einem ZWEITEN
Weg.

Fix: eine Zeile (`LOWER(email) = LOWER($1)`). Dazu
`test/forgot-password-db.test.js` als VERHALTENStest gegen die echte Route und
Tabelle — geprüft wird, ob `reset_token` gesetzt wurde, nicht die Antwort
(die ist absichtlich immer gleich). Gegenprobe bestanden: Regel im Code
zurückgedreht → genau dieser Test rot. Der Test räumt vorab den
`forgot-password|…`-Zähler in `rate_limit_attempts` — die Drossel (5/h)
überlebt Prozesse, und der Test macht vier Aufrufe von derselben Adresse.

**Nebenfund: Enumeration über die Antwortzeit.** Derselbe Endpunkt wartete mit
`await` auf den SMTP-Versand, bevor er antwortete. Die Meldung ist zwar in
beiden Fällen wortgleich, die ZEIT aber nicht: Bei unbekannter Adresse kam die
Antwort sofort, bei bekannter erst nach dem Versand (bis ~10 s laut den
Timeouts in `getTransporter`). Damit liess sich trotz neutraler Meldung messen,
welche Adressen ein Konto haben. Jetzt fire-and-forget mit Fehler-Log — die
Antwort hing inhaltlich nie vom Versandergebnis ab (`sendMail` fängt Fehler
selbst). Die Registrierung wartet weiterhin: Dort fliesst `result.mode` in die
Antwort ein (Konsolen-Hinweis ohne SMTP), und die Adresse ist ohnehin gerade
erst angelegt worden.

**Lehre für die Testkultur:** Die erste Fassung des neuen Tests liess den
DB-Pool offen. Der TEST war in 623 ms grün, die DATEI lief trotzdem in den
60-s-Timeout des Runners und riss die Suite-Statistik mit — ein offener Pool
hält den Prozess am Leben. Jeder DB-Test schliesst seinen Pool im `finally`
(Muster household-db/auth-sessions-db).

Geprüft und bewusst NICHT geändert: `GET /verify` hat als einziger
Token-Endpunkt keine `ipThrottle`. Der Token ist 32 Zufallsbytes und liegt nur
als SHA-256 in der DB — Durchprobieren ist aussichtslos, und der Endpunkt gibt
bei Misserfolg nur einen Redirect ohne Information zurück.

504 Tests grün gegen echtes Postgres 16, 0 übersprungen.

## Nachtrag 27 (hardened-142) — Ein Verbindungsabriss riss den ganzen Worker mit

**Der Fund — schwerer als die Vermutung.** Gesucht war eine Kleinigkeit
(doppelter Reconnect-Backoff in `utils/pgNotify.ts`). Gefunden wurde ein
Prozessabsturz.

Ein einzelner Abriss der LISTEN-Verbindung löst beim pg-Client DREI Ereignisse
aus, in dieser Reihenfolge (am laufenden Postgres 16 nachgemessen):

    error → error → end

Die bisherige Fassung hängte an `error` und `end` je einen Aufruf von
`scheduleReconnect()`, und der begann mit `removeAllListeners()`. Nach dem
ERSTEN Ereignis war damit auch der `error`-Zuhörer weg — und ein
`error`-Ereignis ohne Zuhörer ist in Node kein Logeintrag, sondern eine
geworfene Ausnahme. Das ZWEITE `error` landete deshalb im
`uncaughtException`-Handler von `server.ts`, der den Prozess pflichtgemäss
beendet:

    Error: Connection terminated unexpectedly   →   exit(1)

Ausgelöst hat das jeder Postgres-Neustart, jeder Netzaussetzer und jedes
Idle-Timeout eines vorgelagerten Proxys. Der Cluster forkt sofort Ersatz, aber
alles, was in diesem Worker lief, ist weg: offene SSE-Ströme (die hängen seit
dem NOTIFY-Umbau je Verbindung an einem Kanal), laufende Anfragen, ein gerade
erzeugtes PDF. Und weil bei einem Postgres-Neustart ALLE Worker gleichzeitig
ihre Verbindung verlieren, trifft es sie auch alle gleichzeitig.

**Der Fix.** `retire(c)` hängt dem toten Client dauerhaft einen leeren
`error`-Zuhörer an, BEVOR irgendetwas anderes passiert, und wirkt nur für den
gerade aktiven Client — die beiden Nachzügler desselben Abrisses laufen ins
Leere, statt den Backoff dreifach hochzuzählen und drei Timer zu stellen. Regel
fürs Nachschlagen: **nie `removeAllListeners()` ohne Ersatz für `error`.**
Dazu `_reconnectTimer` (nur ein wartender Timer, `unref()`) und `_closed`:
`close()` bricht einen wartenden Reconnect ab, ein neues `listen()` hebt das
wieder auf.

**Der Test.** `test/pg-notify-reconnect-db.test.js` erzwingt den Abriss per
`pg_terminate_backend()` in einem KINDPROZESS — nur so ist „der Prozess stirbt"
überhaupt beobachtbar; im Testprozess selbst hätte es den Testlauf mitgenommen.
Geprüft wird der Exitcode UND ob danach wieder ein LISTEN steht. Gegenprobe
bestanden: alte Fassung → Exitcode 7, Ausgabe `CRASH:Connection terminated
unexpectedly`. Eine Quelltext-Prüfung hätte das nie gefunden — der Fehler lag
nicht in einem fehlenden Aufruf, sondern in der REIHENFOLGE von Ereignissen
einer fremden Bibliothek.

## Nachtrag 27b — Lastprofil (`npm run loadtest`)

Die Messwerte aus Durchgang 119 waren EINZELabfragen auf einem untätigen
Server. `scripts/loadtest.js` beantwortet die andere Hälfte: Es seedet eine
Sammlung realistischer Grösse (Vorgabe 800 Sets / 60'000 Teile), fährt N
virtuelle Nutzer gleichzeitig und meldet p50/p95/max je Endpunkt sowie den
Faktor gegenüber der Einzelmessung.

    TEST_DATABASE_URL=… npm run loadtest -- --users 20 --dauer 10 --sets 800

Bewusst KEIN Test: Lastmessungen schwanken je nach Maschine, ein Schwellwert
darin wäre entweder nutzlos hoch oder ständig grundlos rot. Das Schema der
angegebenen Datenbank wird geleert; ein grober Schutz lehnt Verbindungen ab,
deren Name nach Produktion aussieht.

**Schon beim Bauen gefunden:** Steht im `price_cache` eine andere Währung als
die Nutzereinstellung (Vorgabe EUR), ist JEDER Zugriff ein Fehlschlag, und die
Bewertung versucht für JEDES Set einen Live-Abruf bei BrickLink — im ersten
Lauf 21 s statt 53 ms. Wer auf CHF umstellt, bevor der Preis-Job durchgelaufen
ist, erlebt genau das. Nicht geändert, aber notiert: Der Cache ist über
set_number + condition + currency_code verschlüsselt, das ist so gewollt.

**Zur Aussagekraft der Zahlen:** Gemessen wurde in einem Container mit EINEM
CPU-Kern, den sich Node und Postgres teilen — systemweit 99 % ausgelastet,
davon Node nur ~19 %. Der Durchsatz blieb von 1 bis 20 Nutzern flach bei
~17/s. Diese absoluten Werte sind ein Artefakt der Umgebung, nicht der
Software. Belastbar ist nur das Relative: `Teile-Liste` (~250 ms allein) und
`GuV` sind die teuersten Endpunkte, `Portfolio-Verlauf` und `Minifiguren`
degradieren unter Last am stärksten. Der Nutzen des Skripts entsteht erst auf
echter Hardware — dort ist auch die Frage zu beantworten, ob sich der
Durchsatz mit der Zahl der Worker vervielfacht (dann skaliert es sauber) oder
nicht (dann liegt der Engpass in der Datenbank).

505 Tests grün gegen echtes Postgres 16, 0 übersprungen.

## Nachtrag 28 (hardened-143) — Währungswechsel füllt den Preis-Cache selbst

**Der Fund aus dem Lastprofil, jetzt behoben.** Der Preis-Cache ist über
set_number + condition + currency_code verschlüsselt — nach einem
Währungswechsel ist deshalb JEDER Cache-Zugriff ein Fehlschlag, und die
Bewertung versucht je Set einen Live-Abruf bei BrickLink, im Anfragepfad
(gemessen: 21 s statt 53 ms für den Finanzreiter, dazu Tageskontingent).

Jetzt: `setUserSetting()` in utils/settings.ts ist die EINE Schreibstelle für
Benutzereinstellungen (Webapp-Formular, Einstellungs-Import und /api/v1 rufen
sie alle). Ändert sich die Währung TATSÄCHLICH — nicht bei jedem Speichern der
Einstellungsseite, das Formular schickt immer alle Felder —, wird der
Preis-Job sofort angestossen und füllt den Cache für die neue Währung im
Hintergrund. `runPriceRefresh()` liest je Nutzer die Währung und holt nur, was
fehlt; `triggerNow()` hält die Sperre 55 selbst, mehrfaches Anstossen ist
harmlos, egal in welchem Worker. setImmediate + spätes require: Die Antwort
wartet nicht, und es entsteht kein Import-Kreis settings ↔ priceJob.

Test `test/currency-change-db.test.js` gegen echte Routen: EUR→CHF stösst an,
ein No-op-Speichern nicht, /api/v1 verhält sich gleich (Parität). Gegenprobe
bestanden. ZWEI Testfallen dabei gelernt: (1) esbuild exportiert per Getter —
ein Monkeypatch auf `priceJob.triggerNow` verpufft STILL (der Zähler blieb 0,
obwohl der Anstoss lief); beobachtet wird stattdessen die Wirkung des echten
Laufs (Fake-Zugangsdaten + leere sets-Tabelle → "No sets"-Zweig setzt
state.lastRun, ablesbar über getJobStatus()). (2) Dieser Zweig ruft
scheduleNext() — ohne `priceJob.stop()` im finally hielte der Intervall-Timer
den Testprozess bis zu 60 Minuten am Leben.

## Nachtrag 28b — Backup/Restore: einmal wirklich durchgespielt

Die Mahnung am Ende von backup.sh („einmal ausprobieren, bevor man es
braucht") wurde eingelöst — gegen Postgres 16, mit dem Seed des Lastprofils
(50 Sets / 3'750 Teile / 2'250 Verlaufszeilen):

- Restore in die BESTEHENDE Datenbank (die sich nach dem Backup verändert
  hatte): der --clean-Dump räumt selbst auf, nachträglich angelegte Zeilen
  verschwinden, der gesicherte Stand kommt vollständig zurück. 0 Fehler.
- Restore in eine FRISCHE Datenbank (der Ernstfall, neuer Server):
  vollständig, inklusive der Trigramm-Indizes. Die App-Schema-Initialisierung
  lief danach durch, alle Daten sichtbar.

**Zwei stille Fallen gefunden und geschlossen (beide empirisch nachgestellt):**

1. `set -eu` fängt in POSIX-sh KEINEN Fehler am ANFANG einer Pipe. Scheiterte
   pg_dump (Datenbank down, Platte voll), lief gzip trotzdem durch und
   hinterliess eine kleine, formal GÜLTIGE .gz-Datei — das Skript meldete
   Erfolg, per Cron wären das wochenlang wertlose Sicherungen gewesen.
   backup.sh prüft jetzt die Endmarke jedes vollständigen Plain-Dumps
   ("PostgreSQL database dump complete"); fehlt sie, wird die Datei gelöscht
   und das Skript scheitert LAUT (Exit 1 → sichtbar in Cron-Mail/Log).

2. Der als Kommentar dokumentierte Restore-Befehl (`gunzip -c … | psql …`)
   meldete auch bei einem HALBEN Dump Exit 0 — psql bricht ohne
   ON_ERROR_STOP nicht ab (nachgestellt: abgeschnittener Dump → Exit 0; mit
   ON_ERROR_STOP=1 → Exit 3). Neu: `scripts/restore.sh` prüft die Endmarke
   BEVOR irgendetwas überschrieben wird, fragt einmal nach, spielt mit
   ON_ERROR_STOP=1 ein, entpackt optional das data-Archiv (Bilder und
   Anleitungen liegen NICHT in der Datenbank!) und startet den App-Container
   neu. backup.sh verweist am Ende darauf.

Kein automatischer Test für die beiden Shell-Skripte — sie hängen an docker
compose und wären nur mit Attrappen prüfbar; die Nachweise oben liefen gegen
das echte Postgres. Wie beim Lastprofil gilt: auf der eigenen Maschine einmal
`./scripts/restore.sh` gegen eine Kopie laufen lassen, nicht erst im Ernstfall.

506 Tests grün gegen echtes Postgres 16, 0 übersprungen.

## Nachtrag 29 (hardened-144) — Katalog-Import, Rollenwechsel, Job-Timer

Durchgang über bis dahin ungelesene Ecken (CSV-Import-Kette, Admin-Routen).
Drei Funde, alle am laufenden System nachgestellt BEVOR sie gemeldet wurden.

### 1. Gleichzeitige Katalog-Importe kollidieren

Der Name der Schattentabelle (`<tabelle>_import`) leitet sich allein vom
Tabellennamen ab, ist also für ALLE Läufe derselbe. Zwei gleichzeitige Importe
derselben Tabelle sind erreichbar: Der Tageslauf ruft `csvSync.run()`, ein
Admin kann parallel `/admin/trigger-csv-sync` auslösen — der Riegel
`_csvSyncRunning` in server.ts schützt nur den manuellen Weg gegen sich selbst
und liegt ohnehin im Speicher EINES Prozesses.

Nachgestellt gegen echtes Postgres 16: Bei gleichzeitigem Start scheitert ein
Lauf beim CREATE mit „duplicate key value violates unique constraint
pg_type_typname_nsp_index" — einem Fehler, der nichts über die Ursache
verrät. In `csvSync.run()` bricht das den ganzen Durchgang ab (`return`), der
Tagesmarker bleibt ungesetzt, die Folgeschritte entfallen.

Die DATEN bleiben dabei heil — auch das geprüft, mit versetztem Start und
unterscheidbaren Daten: Der Endbestand entsprach immer genau EINEM Lauf, nie
einer Mischung. Das Tausch-Verfahren aus Nachtrag 21 trägt also auch diesen
Fall; der Fund ist ein Verfügbarkeits-, kein Integritätsproblem.

Fix: Beratungssperre je Tabelle (`pg_advisory_lock(56, hash(tabelle))`).
Blockierend statt `try`, damit der zweite Lauf WARTET und danach sauber
durchläuft, statt auszufallen. Verschiedene Tabellen bleiben parallel — auch
nachgemessen (Sperre für rb_colors belegt, für rb_parts frei). Schlüssel 56
grenzt an PRICE_JOB_LOCK = 55; neue Sperren dürfen sich nicht überschneiden.
Test: `test/csv-import-concurrent-db.test.js`, Gegenprobe bestanden.

### 2. Adminrechte liessen sich nicht zuverlässig entziehen

Beide Rollen-Endpunkte lasen den Wunsch mit `is_admin ? 1 : 0`. In JavaScript
ist die ZEICHENKETTE "false" wahr. Am laufenden Endpunkt nachgestellt:

    {"is_admin": false}     → HTTP 200, Rechte entzogen       ✓
    {"is_admin": "false"}   → HTTP 200, Rechte NICHT entzogen ⚠
    {"is_admin": "0"}       → HTTP 200, Rechte NICHT entzogen ⚠

Der Admin bekommt „erfolgreich" gemeldet und glaubt, jemandem die Rechte
genommen zu haben — sie bestehen weiter. Ein Client, der Wahrheitswerte als
Text schickt (Formulare, manche HTTP-Bibliotheken), trifft das sofort. Der
Selbstschutz („eigene Admin-Rolle kann nicht entfernt werden") hing an
derselben Prüfung und lief mit "false" ebenfalls ins Leere.

Wieder das bekannte Muster „dieselbe Lücke an ZWEI Wegen": Webapp
(`PUT /api/auth/users/:id/admin`) und Android-API
(`PUT /api/v1/admin/users/:id/role`) hatten beide denselben Fehler.

Fix: `strictBool()` in utils/validate.ts — true/false/1/0, als Wert oder als
Text; alles andere wird mit 400 abgewiesen, statt still das Gegenteil zu tun.
Zusätzlich 404 statt Erfolg bei unbekannter Benutzer-ID (auch das meldete
vorher „success"). Test: `test/admin-role-db.test.js` prüft BEIDE Wege,
Gegenprobe bestanden.

### 3. Jeder Job-Lauf ohne Sets hinterliess zwei Intervall-Timer

Aufgefallen als Testproblem, entpuppt als Betriebsfehler. Im Zweig „keine Sets
vorhanden" rief `runPriceRefresh()` `scheduleNext()` direkt — und der
finally-Block tat es anschliessend nochmal. Am laufenden Job nachgezählt: zwei
Timer à 3600000 ms für EINEN Lauf.

Weil jeder gefeuerte Timer wieder einen Lauf startet und jeder Lauf wieder
Timer stellt, wächst die Zahl der geplanten Läufe mit der Zeit, statt konstant
zu bleiben. Der Job liefe irgendwann deutlich häufiger als eingestellt und
verbrennt das BrickLink-Tageskontingent. Im Testlauf hielten die überzähligen
Timer ausserdem den Prozess am Leben: Der TEST war grün, die DATEI lief
trotzdem in den 60-s-Timeout des Runners — dieselbe Klasse wie der offene
DB-Pool aus Nachtrag 26.

Fix: `scheduleNext()` nur noch im finally-Block (er läuft für JEDEN Ausgang,
auch für ein `return` im try). Zusätzlich räumt `scheduleNext()` jetzt AUCH im
Rückruf ab: Zwischen `clearTimeout` und dem Setzen liegt eine Datenbankabfrage,
und ein in dieser Lücke durchlaufender zweiter Aufruf würde den Verweis auf den
ersten Timer überschreiben — der liefe dann unkündbar weiter.
Test: `test/price-job-timer-db.test.js`, Gegenprobe bestanden (2 statt 1).

509 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

Weiterhin ungelesen: die PDF-Job-Kette und der grösste Teil des Frontend-JS.

## Nachtrag 30 (hardened-145) — PDF-Kette, Bild-Proxy, Frontend; Prüfung abgeschlossen

Damit sind alle Bereiche mindestens einmal gelesen. Drei Funde plus eine
Aufräumarbeit.

### 0. Sperrschlüssel korrigiert (Nachtrag 29 nachgebessert)

`CSV_IMPORT_LOCK` bekam in Nachtrag 29 die 56 — den Schlüssel der
Anleitungs-Warteschlange. Praktisch kollidierte das nicht: Die Warteschlange
nimmt `(56, 0)`, der Import `(56, Tabellen-Hash)`, und keiner der acht
Katalog-Tabellennamen hasht auf 0 (nachgemessen). Verlassen sollte man sich
darauf nicht — ein neuer Tabellenname könnte den Import künftig hinter der
Warteschlange blockieren, und der Fehler wäre kaum auffindbar. Jetzt 58; die
Liste in jobs/instructionQueue.ts ist der Ort, an dem der Namensraum gepflegt
wird, und führt 58 nun mit.

### 1. `createReadStream(...).pipe(res)` konnte den Worker abschiessen

Dieselbe Falle wie beim pgNotify-Absturz (Nachtrag 27), nur an anderer Stelle:
`.pipe()` hängt KEINEN 'error'-Zuhörer an die Quelle, und ein 'error' ohne
Zuhörer ist in Node kein Logeintrag, sondern eine geworfene Ausnahme.
Nachgestellt: Lesestrom auf eine fehlende Datei → ENOENT → uncaughtException →
Prozessende.

Betroffen waren drei Stellen im ANFRAGEpfad — PDF-Download und Bild-Proxy
(Vorschau und Cache). Alle drei prüfen erst, ob die Datei da ist, und öffnen
sie danach; dazwischen vergeht Zeit, in der cleanOldPdfJobs (10-Minuten-Frist)
bzw. die Cache-Pflege sie entfernen kann. Ein voller Datenträger oder
entzogene Rechte lösen dasselbe aus.

Neu: `streamFileToResponse()` in utils/httpError.ts — protokolliert, antwortet
mit 404 solange noch keine Kopfzeilen raus sind, und beendet sonst die
Verbindung sauber, statt den Worker mitzunehmen. Aufgeräumt wird nur bei
VOLLSTÄNDIGER Auslieferung. Test `test/stream-guard.test.js` (Kindprozess —
„der Prozess stirbt" ist anders nicht beobachtbar), Gegenprobe bestanden.

Nebenbei: Die erste Fassung des Helfers rief `res.status(404)` und stürzte an
einer nackten http-Antwort selbst ab — gefunden vom eigenen Test, bevor das
Paket entstand. Jetzt mit Rückfall auf `res.statusCode`.

### 2. Fremder Antworttext landete unmaskiert im DOM

Die Finanztabelle setzte den Fehlertext eines Sets roh in innerHTML:
`<td …>${s.error ? s.error : fmtN(total, cur)}</td>`. Diese Meldung stammt
nicht aus dem eigenen Haus: routes/bricklink.ts baut sie bei einer
Nicht-JSON-Antwort aus dem ANTWORTKÖRPER —
`BrickLink non-JSON (HTTP ${status}): ${body.substring(0, 200)}`.

Liefert BrickLink (oder ein Proxy, ein Portal, eine CDN-Fehlerseite) HTML
statt JSON, landen dessen erste 200 Zeichen unmaskiert in der Seite. Mit
`<img src=x onerror=…>` darin ist das ein aktiver Handler im Browser des
Nutzers. Die Kette wurde durchgespielt, bevor sie gemeldet wurde.

Fix: `esc(s.error)` an der Einsetzstelle — dort, wo die Regel im Frontend
ohnehin überall gilt. Die bestehenden Escaping-Tests deckten Attribut- und
Handler-Kontexte ab, den TEXTkontext bisher nicht; die neue Regel in
`test/frontend-escaping.test.js` schliesst das für Felder, deren Inhalt von
aussen kommen kann (.error/.message), und meldet bewusst nichts bei
Bedingungsstellung, Übersetzungsschlüsseln und Zeilen ohne HTML-Tag.
Gegenprobe bestanden.

Geprüft und als sicher befunden (deshalb NICHT geändert): `addCsvLog` in
02-gallery.js schreibt über textContent, und `priceStatusBadge` in
04-finance.js maskiert seinen Titel an beiden Einsetzstellen.

### 3. Was am PDF-Weg gut ist

Der Rest der PDF-Kette hielt der Prüfung stand: jobId streng validiert
(JOB_ID_RE) bevor daraus ein Pfad wird, Auftragskennung aus
crypto.randomBytes, und `pdfJobReadFor()` prüft die Zugehörigkeit als einziger
Weg für alle drei Abrufrouten — bei fremdem Auftrag dasselbe 404 wie bei einem
unbekannten.

511 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

Damit ist die Prüfung abgeschlossen: Alle Bereiche sind mindestens einmal
gelesen. Was jetzt noch fehlt, liegt nicht mehr im Code — Lastprofil auf
echter Hardware, restore.sh einmal gegen eine Kopie, Renovate-PRs einspielen,
und einer fremden Person beim Benutzen zuschauen.

## Nachtrag 31 (hardened-146) — Marcos Fehlerbericht: Marktpreis fehlt in der App-Detailansicht

Erster Fund aus dem BETRIEB statt aus dem Lesen — und er bestätigt die
Vermutung, dass ab jetzt die Realität die besseren Anlässe liefert.

**Symptom (gemeldet):** Die Android-App zeigt in der Detailansicht teilweise
keinen Marktpreis; Finanzübersicht und Galerie-Kachel zeigen ihn.

**Ursache-Kette (am laufenden Server nachgestellt):**
1. Die App speichert die Währung lokal (DataStore), Startwert "EUR". Vom
   Server übernommen wird sie an genau EINER Stelle: beim ersten Laden der
   Finanzübersicht (FinanceFeature → prefs.saveCurrency).
2. Die Detailansicht schickte diesen lokalen Wert als `?currency=` mit.
3. `GET /api/v1/sets/:sn/price` liess den Parameter GEWINNEN
   (`req.query.currency || getSetting(…)`).
4. price_cache ist über set_number + condition + currency_code verschlüsselt:
   Die EUR-Anfrage traf den CHF-Cache nie → Live-Versuch (bis zu ZWEI
   BrickLink-Abrufe je Detailansicht!) → häufig no_price → leere Kachel.

Finanzübersicht und Galerie fragen ohne Parameter → Nutzereinstellung →
Preis da. Identischer Nutzer, identisches Set, nur der Parameter unterschied
`no_price=true` von `avg_price=629.90`. „Teilweise" erklärt sich so: Sobald
die Finanzübersicht einmal geladen wurde, steht lokal die richtige Währung —
bis zur Neuinstallation oder einem weiteren Gerät. Und wo der EUR-Live-Abruf
GELANG, zeigte die Kachel still einen Betrag in der falschen Währung.

**Fix am Server (die eigentliche Regel):** Die Route ignoriert den Parameter
und nimmt die Nutzereinstellung — wie es die Schwester-Route /price-history
aus demselben Grund immer getan hat. Damit sind auch ALTE App-Fassungen ohne
Update geheilt. Die Antwort nennt die Währung weiterhin, damit Clients den
Betrag korrekt beschriften statt ihr lokales Kürzel zu raten.
Test `test/price-currency-db.test.js`, Gegenprobe bestanden.

**Aufräumen in der App (brickinventory-android):** getSetPrice und
getSetPriceHistory schicken keinen currency-Parameter mehr (BrickApiService,
BrickRepository, SetDetailFeature). Die beiden WIDERSPRÜCHLICHEN Vorgabewerte
— "EUR" beim Preis, "CHF" beim Verlauf — entfallen damit. Hinweis zur
Ehrlichkeit: Die Kotlin-Änderung ist hier nur quellgeprüft (kein Android-SDK
im Container); der Server-Fix wirkt aber unabhängig davon.

**Webapp:** nutzt diese v1-Route nicht (Finanzreiter läuft über
/api/finance/*, serverseitige Währung) — dort bestand das Problem nie.

**Beifang aus dem Suite-Lauf: der JSON-Typ von total_quantity hing am
Cache-Zustand.** Der Paritätstest wurde beim Verifizieren rot — „20 gegen
'20'" zwischen /api/parts/colors und /api/v1/parts/colors, und zwar nur im
Verbund, einzeln grün: Die beiden Aufrufe lagen zufällig auf verschiedenen
Seiten einer Frische-Grenze der Teile-Zusammenfassung. Ursache: Postgres gibt
SUM(BIGINT) als NUMERIC zurück (der Parser in db/database.ts macht daraus eine
ZAHL), SUM(INTEGER) und eine roh gelesene BIGINT-Spalte dagegen als TEXT.
Dieselbe Route lieferte also je nach Zweig (Zusammenfassung frisch, Haushalt,
Live-Abfrage) verschiedene JSON-Typen. Fix: `::int` an jedem Zählwert ALLER
Zweige in getPartsColors und der Teile-Liste (getPartsStats normalisierte
schon immer mit parseInt). Der quelltextlesende Haushalt-Test, der den alten
Wortlaut `COUNT(DISTINCT ps.part_key) AS unique_parts` pinnte, wurde auf die
neue Formulierung nachgezogen — die geschützte Regel (Teile zählen, nicht
Konten) ist unverändert, und die Fehlermeldung nennt jetzt auch den Grund für
das ::int.

512 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 32 (hardened-147) — Webapp-Reiter: Filter unter die Erfassung

**Marcos Wunsch aus dem Betrieb:** Die Filter-Bedienelemente sollen nach der
Erfassung kommen — nicht mehr im Kopf des Reiters, sondern zwischen
Erfassen-Box und Liste.

Umgesetzt auf den drei Reitern mit diesem Muster: **Galerie**
(Suche/Thema/Sortierung/Kontenauswahl/Ansichtsumschalter), **Teile**
(Suche/Ersatzteile/Konten/Ansicht) und **Minifiguren**
(Suche/Quelle/Konten/Ansicht). Die Reihenfolge ist jetzt überall: Titel →
Statistik-Kacheln → Erfassen-Box → Filterleiste → Liste. Die Leiste steht
damit direkt über der Liste, auf die sie wirkt.

Nicht angefasst, mit Grund: **Finanzen** (ausdrücklich ausgenommen),
**Teileliste** (hat keine Filter — die Kopfzeile IST die Erfassung),
**Katalog** (hat keine Erfassung — die Filter stehen dort schon direkt über
der Liste), Einstellungen/Monitoring (weder noch).

Nur die Container wurden bewegt; jede Bedienelement-ID existiert weiterhin
genau einmal — die IDs sind der Vertrag mit dem JS, kein Handler wurde
angefasst. Neuer Strukturtest `test/tab-layout.test.js` pinnt die Reihenfolge
(Erfassen vor Filter vor Liste), dass die Reiterköpfe filterfrei bleiben, und
die Einmaligkeit der IDs. Gegenprobe bestanden: Galerie-Leiste probeweise
zurück in den Kopf gesetzt → Test rot.

515 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 33 (hardened-148) — Haushalts-Sets: Marktpreis 404, Verlauf ohne Kaufbezug

**Marcos Fehlerbericht mit Screenshots:** Set 42200-1 gehört dem Unterkonto,
das Hauptkonto öffnet die App-Detailansicht — Marktpreis „—", kein Preischart.
Finanzübersicht und Galerie-Kachel zeigen denselben Preis. In der Webapp
„funktioniert es einwandfrei" (dort: die über scopeIds laufende Bewertung).

**Ursache, am laufenden System nachgestellt:** Die Detailroute nutzt
scopeIds() seit jeher — die PREISroute (`GET /api/v1/sets/:sn/price`) prüfte
stur `user_id = eigene ID` und gab für JEDES fremde Haushalts-Set **404 „Set
not found"** zurück, bevor irgendeine Preislogik lief (Reproduktion: Detail
200, Preis 404, identische Sitzung). Und `getSetPriceHistory()` las Set und
Erfassungen nur mit der Betrachter-ID: by_condition leer, kein
Kaufpreis-Punkt. Wieder das Muster „Regel fehlt am zweiten Weg" (Klasse von
125/141) — `resolveSetCondition()` konnte das Blickfeld immer schon, es kam
nur nie an.

**Fix an der gemeinsamen Logik (Marcos ausdrücklicher Wunsch: Webapp und App
teilen dieselbe):** utils/priceHistory.ts nimmt jetzt das Blickfeld (eine ID
oder die Liste aus scopeIds), Mehrbesitzer werden wie in der Bewertung
verdichtet (älteste Erfassung als Bezug, Kaufpreise je Zustand
mengengewichtet über alle Besitzer). ALLE sechs Aufrufer reichen scopeIds()
durch — Webapp und v1, Sets/Teile/Minifiguren; damit war die Webapp-
Detailansicht im Haushalt nämlich genauso betroffen, nur fiel es dort weniger
auf. Die Preisroute selbst sucht das Set über das Blickfeld und löst den
Zustand darüber auf.

Test `test/household-price-db.test.js` (Hauptkonto sieht Preis, Chartpunkte
und by_condition.U mit dem Kaufpreis des Unterkontos; Migrationen für
account_links wie in household-db). Gegenprobe bestanden: Blickfeld in der
Preisroute zurück auf die nackte ID → 404-Schritt rot.

**Zum Chart im Betrieb:** Der Preisjob holt die Sets jedes Kontos in DESSEN
Währung. Hat ein Unterkonto keine Währung gesetzt, gilt die Vorgabe EUR — der
Verlauf entsteht dann in EUR und bleibt für den CHF-Betrachter unsichtbar.
Nach diesem Fix füllt jeder Detailabruf den Cache in der Betrachter-Währung,
der Tages-Schnappschuss schreibt daraus den Verlauf: ein Punkt nach dem
nächsten Lauf, Linie ab dem übernächsten Tag. Empfehlung: im Unterkonto
dieselbe Währung einstellen, dann arbeitet auch der Job direkt richtig.

**Android-App (brickinventory-android, Etiketten auf den Kacheln):** Am
BottomStart der Galerie-Kachel lagen ConditionBadges und OwnerBadges in einer
Box — eine Box STAPELT ihre Kinder, die Besitzer-Etiketten verdeckten die
Zustandsplakette (auf dem Screenshot lugte das „N/G" zwischen den Namen
hervor). Jetzt Column (untereinander), wie es der Minifiguren-Reiter samt
Erklärkommentar längst vormachte. Zusätzlich OwnerBadges als FlowRow: zwei
lange Namen sind breiter als die Kachel, statt sich zu überschieben brechen
sie jetzt in die nächste Zeile um — alle Etiketten bleiben lesbar (Marcos
Vorgabe: alles sichtbar; Weglassen war nicht nötig). Nur quellgeprüft, kein
Android-SDK im Container.

516 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 34 (hardened-149) — Scrollposition nach dem Dialog, Reiter-Aufteilung

### 1. Der Sprung nach oben nach dem Eigentümerwechsel (Marcos Fehlerbericht)

Beschrieben: „Ich ändere ein Set auf Zeile 50, beim Verlassen des Dialogs
springt die Ansicht auf Zeile 40, und ich muss erst auf Zeile 39 hochscrollen,
damit es weitergeht." Beide Teile haben je eine eigene Ursache:

**Der Sprung.** Nach dem Wechsel rief der Dialog schlicht `loadGallery()`. Das
setzt `_galPage` auf 1 zurück — wer sich bis Zeile 50 durchgescrollt hatte,
stand plötzlich vor 60 statt 300 Kacheln. Das Dokument schrumpft, der Browser
klemmt den Scrollbalken ans neue Ende: der gefühlte Sprung. Nachgerechnet für
eine typische Lage (5 geladene Seiten, Rasterhöhe 320px): Dokument von 32'000
auf 6'400px, Scrollposition zwangsweise auf 5'500px.

**Das Nicht-Nachladen.** IntersectionObserver meldet nur ÜBERGÄNGE. Der
Sentinel war vor dem Neuladen sichtbar und blieb es danach — kein Übergang,
also kein Ereignis, also kein Nachladen. Erst Hochscrollen (Sentinel raus) und
Zurückscrollen (Sentinel rein) erzeugte wieder eines. Exakt das beschriebene
„auf Zeile 39 hochscrollen".

Fix: `loadGallery({ restore: true })` merkt sich Tiefe und Scrollposition,
holt die volle Tiefe in EINER Anfrage zurück (der Server deckelt page_size bei
500; die geholte Menge ist ein Vielfaches der Seitengrösse, damit die
Folgeseiten am richtigen Versatz ansetzen) und stellt die Position nach dem
Zeichnen wieder her. Dazu `kickGallerySentinel()`: nach jedem Anhängen selbst
nachsehen, ob der Sentinel im Sichtfeld steht, statt auf einen Übergang zu
warten. `restore` gilt an allen drei Stellen, die aus dem Kaufpreis-Dialog neu
laden (Eigentümerwechsel, Preis-/Mengenänderung, Löschen einer Erfassung) —
die anderen Aufrufer (Reiterwechsel, Filter, Import) sollen bewusst oben
beginnen.

### 2. Teile und Minifiguren: der Filter betrifft BEIDE Listen

Marcos Hinweis: Der Filter wirkt auch auf die manuell erfassten Elemente,
stand aber unter deren Liste — es sah aus, als beträfe er nur die Set-Einträge.

Neue Aufteilung auf beiden Reitern:

    Titel
    Erfassen-Box   ("Neues Teil erfassen" / "Neue Minifigur erfassen", mit CSV)
    Filterleiste
    Manuell erfasste Teile/Minifiguren   (Liste)
    Teile aus Sets / Minifiguren aus Sets

Die Erfassen-Box trägt jetzt den Titel der Erfassung statt „Manuell erfasste
…"; die Liste bekam ihren eigenen Abschnitt mit dieser Überschrift. Beide
Wortlaute kommen aus vorhandenen Übersetzungsschlüsseln (parts.new_section /
parts.manual_section, figs.new_section / figs.manual_section) — keine neuen
Schlüssel, beide Sprachen bleiben vollständig.

### 3. Katalog und Abstände

Der Katalogtitel steht jetzt allein auf seiner Zeile, die Suche darunter —
analog zu den anderen Reitern. Und der Zwischenraum zwischen Filterleiste und
Liste ist auf allen vier Reitern von 1rem auf 1.5rem gewachsen.

`test/tab-layout.test.js` deckt die neuen Regeln mit ab: manuelle Liste unter
der Filterleiste, Katalogtitel allein, Mindestabstand 1.5rem für alle vier
Leisten. Der quelltextlesende Spinner-Test in no-reload-flicker.test.js suchte
`loadGallery()` wörtlich und wurde auf die neue Signatur nachgezogen — die
geprüfte Regel ist unverändert.

519 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 36 (hardened-150) — Bild fehlt ganz: Rückfall auf den gemeinsamen Katalog

**Marcos Bericht:** Bei einem neu erfassten Set wird das Bild NIRGENDS
angezeigt — weder App noch Webapp, weder Liste noch Detailansicht. Seine
Erwartung, wörtlich: „Wenn das Bild lokal noch nicht vorhanden ist, soll
dieses direkt via Proxy vom CDN geholt und angezeigt werden."

**Ursache.** Die Set-Liste las die Bildadresse ausschliesslich aus der EIGENEN
sets-Zeile (`SET_COLS` enthielt schlicht `s.image_url`). Steht dort nichts,
lieferte die API `image_url: null` UND `image_local: null` — beide Clients
hatten damit nichts in der Hand und zeigten den Platzhalter. Dass die
CDN-Adresse im `set_catalog` längst bekannt war, half niemandem, weil sie nie
abgefragt wurde. Am laufenden Server nachgestellt: sets-Zeile ohne
Bildangaben + Katalogeintrag mit CDN-Adresse → vorher zweimal null.

Warum die eigene Zeile leer sein kann: Der Bild-Download beim Erfassen läuft
mit 15-Sekunden-Frist und kann scheitern; Sets aus CSV-Import oder
Barcode-Scan durchlaufen andere Wege; ältere Zeilen haben das Feld nie
gefüllt.

**Fix.** `COALESCE(s.image_url, sc.image_url)` über einen LEFT JOIN auf
`set_catalog`. Der Katalog wird beim Erfassen jedes Sets gefüllt und ist
kontoübergreifend — der Rückfall greift damit auch für Sets, die ein anderes
Haushaltsmitglied zuerst erfasst hat. Eine vorhandene eigene Adresse behält
Vorrang. Die Auflösung zum Proxy machen die Clients danach selbst
(`imgUrl()` in der Webapp, `resolveThumbUrl()` in der App) — beide brauchen
dafür nur eine nicht-leere Adresse, also wirkt der Fix OHNE App-Update.

Was dieser Fix NICHT ändert: Der Fall „image_local gesetzt, Datei fehlt" war
schon vorher abgedeckt (server.ts leitet im sendFile-Fehlerzweig auf den
Bild-Proxy um). Neu ist allein der Fall „gar keine Adresse".

Test `test/image-fallback-db.test.js` (Rückfall greift; eigene Adresse wird
NICHT überschrieben), Gegenprobe bestanden.

520 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 37 (hardened-151 + Android) — Bilder: nachfragen statt blind behalten

**Marcos Anforderung:** „Wenn ein falsches Bild in der Android-App
heruntergeladen wurde, soll diese jeweils prüfen, ob ein neues auf dem Server
vorhanden ist […]. Wenn der Server nicht erreichbar ist, sollen alle aus dem
Cache kommen."

Es gab dafür ZWEI Sperren, je eine auf jeder Seite — einzeln behoben hätte
keine davon etwas gebracht.

**Server: eine Woche ohne Rückfrage.** `/images/*` schickte
`private, max-age=604800`. Ein einmal geladenes falsches oder veraltetes Bild
blieb damit sieben Tage stehen, auch wenn der Server längst ein neues hatte
(Bild-Nachlauf, erneuter Download, ausgetauschte Datei). Jetzt
`private, no-cache` — das heisst NICHT „nicht zwischenspeichern", sondern „vor
jeder Verwendung rückfragen": Der Client behält seine Kopie und stellt eine
BEDINGTE Anfrage. Am laufenden Server nachgemessen: Erstabruf 200 mit ETag,
bedingte Anfrage 304 ohne Rumpf, nach Dateiwechsel 200 mit neuem ETag. Teuer
ist das nicht — ein 304 trägt keinen Rumpf.

**App: Coil fragte grundsätzlich nie nach.** Im ImageLoader stand
`respectCacheHeaders(false)` mit der Begründung „auch dann zwischenspeichern,
wenn der Server no-cache schickt". Die Folge war die andere Hälfte davon: Ein
einmal geladenes Bild kam AUF IMMER aus dem Plattencache; ein falsches Bild
liess sich nur durch Löschen der App-Daten beseitigen. Jetzt `true` — Coil
stellt die bedingte Anfrage mit dem ETag.

**Offline (die Sorge, die hinter dem alten `false` stand):** Der Bild-Client
bekommt einen eigenen HTTP-Zwischenspeicher (50 MB) und einen Rückfall auf
`FORCE_CACHE`. Der hängt bewusst am tatsächlichen FEHLER (IOException) statt
am gemeldeten Verbindungsstatus des Geräts: Ein Gerät kann im WLAN sein und
den Heimserver trotzdem nicht erreichen — unterwegs, VPN aus, Server startet
neu. FORCE_CACHE liefert die gespeicherte Kopie ohne Netzanfrage und ohne
Rücksicht auf ihr Ablaufdatum; gibt es keine, bleibt es beim Platzhalter wie
bisher.

`provideImageOkHttpClient` bekam dafür einen Context-Parameter (gleiche
Schreibweise wie `provideImageLoader` in derselben Datei); direkte Aufrufer
gibt es keine, Hilt injiziert.

Neuer Kotlin-Test `ImageCacheContractTest` hält die drei Teile zusammen fest —
sie sind einzeln wertlos. Serverseitig wurde der bestehende
`data-layout`-Test angepasst: Er schnitt 2000 Zeichen ab dem Routenanfang, und
der neue Erklärtext schob die geprüfte Zeile aus dem Fenster. Jetzt werden die
Kommentare vor dem Schneiden entfernt (`strip()` gab es in der Datei schon) —
die geprüfte Regel ist unverändert.

520 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 40 (hardened-152) — Fehlt die Vorschau, kommt sofort das grosse Bild

**Marcos Anforderung:** „Der Client soll das Bild jeweils direkt erhalten und
nicht warten, bis noch das Thumbs-Image generiert wurde. Ist kein Thumb
vorhanden, soll das grosse Bild zurückgeliefert werden."

Der Bild-Proxy hielt es für CDN-Bilder längst so — Original sofort raus, die
Verkleinerung entsteht in der Warteschlange (routes/imgProxy.ts, mit der
Begründung „vorher hing hier jede Anfrage an rund 150 ms Jimp"). Die LOKALE
Route `/images/*` tat es nicht: Bei fehlender `_thumb`-Datei sprang sie direkt
zum CDN-Umweg oder endete in 404 — obwohl das grosse Bild einen Ordner weiter
lag.

Getroffen hat das genau das Zeitfenster nach dem Erfassen: Die Vorschau
entsteht im Hintergrund (setImmediate → generateThumb), und wer in diesen
Sekunden die Galerie öffnete, bekam nichts. Zusammen mit Nachtrag 36 (fehlende
Bildadresse) und 37 (Zwischenspeicher ohne Rückfrage) war das die dritte
Ursache derselben leeren Kachel.

**Fix:** Im sendFile-Fehlerzweig wird zuerst geprüft, ob eine VORSCHAU
angefragt war (`_thumb` im Pfad) und ob das Original daneben liegt — dann geht
das raus. Erst danach der CDN-Umweg, erst danach 404. Die Reihenfolge ist
Absicht: Ein lokal vorhandenes Original ist immer besser als ein Umweg über
einen fremden Dienst.

Bewusst NICHT: die Vorschau im Anfragepfad erzeugen. Das kostete rund 150 ms
je Anfrage und summierte sich bei einer Kachelwand zu Sekunden — dieselbe
Falle, die im Proxy schon einmal beseitigt wurde.

Am laufenden Server nachgemessen: Vorschau fehlt → HTTP 200 mit dem Original
in 25 ms; nach dem Hintergrundlauf → die Vorschau; ohne Original → weiterhin
404. Test `test/image-thumb-fallback.test.js` prüft beides — das Verhalten der
Routenlogik und (als zweite Prüfung) dass der Rückfall in server.ts VOR dem
CDN-Umweg steht. Gegenprobe bestanden.

522 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 41 (hardened-153) — Halb geschriebene Vorschau: Kachel leer, Detail heil

**Marcos Beobachtung, die den Fall gelöst hat:** „Das Bild wird nach wie vor
nicht geladen. Wenn ich das Detail öffne, wird das Bild aber geladen via
Proxy." Das trennt den Fehler scharf: Die Kachel fragt dieselbe Datei MIT
`thumb=1` an, die Detailansicht OHNE. Der Fehler musste also im
Vorschau-Zweig liegen — und nicht bei der Bildadresse (Nachtrag 36), beim
Zwischenspeicher (37) oder bei der fehlenden Vorschau (40).

**Ursache: nicht atomares Schreiben.** `makeProxyThumb()` schrieb direkt auf
den ENDGÜLTIGEN Dateinamen. Eine Anfrage, die in genau diesem Moment
hereinkommt, sieht die Datei bereits (`access()` gelingt), liest per `stat()`
eine TEILgrösse und setzt sie als Content-Length — der Browser bekommt ein
abgeschnittenes JPEG und zeigt nichts. Hinterher liegt die Datei heil auf der
Platte, der Fehler ist also unsichtbar; im Browser bleibt er stehen, weil das
kaputte Bild mitsamt ETag im Zwischenspeicher landet. Genau das Bild:
dauerhaft leere Kachel, einwandfreie Detailansicht.

Empirisch nachgestellt: Die parallele Anfrage sah 4'000 von 12'000 Bytes.
Nach der Umstellung sieht sie entweder nichts (und fällt sauber auf das
Original zurück) oder die fertige Datei.

Warum es gerade neue Sets trifft: Die Vorschau entsteht genau EINMAL — beim
ersten Aufruf. Während die Kachelwand lädt, treffen mehrere Anfragen auf
dasselbe Bild; eine erzeugt, die anderen lesen mit.

**Fix.** Beide Erzeuger schreiben jetzt über eine temporäre Datei und
benennen anschliessend um (`rename()` innerhalb desselben Dateisystems ist
unteilbar): `routes/imgProxy.ts` für CDN-Bilder und `routes/thumbs.ts` für
lokale. Der Bild-Cache daneben machte es seit jeher so — nur bei den
Vorschauen fehlte es.

**Zweite Verteidigungslinie:** Eine Vorschau unter 200 Bytes wird beim
Ausliefern verworfen und neu angestossen, statt sie auszuliefern. Das räumt
die Altbestände auf, die in der Zeit davor entstanden sind — ohne sie bliebe
Marcos Kachel auch nach dem Update leer.

Test `test/thumb-atomic.test.js`: beide Erzeuger schreiben temporär, die
Rumpf-Prüfung ist vorhanden, und das unteilbare Umbenennen wird als VERHALTEN
geprüft (paralleler Leser sieht nie einen Zwischenstand). Gegenprobe
bestanden.

525 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 43 (hardened-154) — Bilder über 5 MB fielen in ein schwarzes Loch

**Marcos Fund, und diesmal stand die Lösung in seinem Netzwerk-Protokoll:**
Der direkte Aufruf von `…/api/img-proxy?url=…60445-1/149141.jpg&thumb=1` lädt
„endlos" und zeigt das Bild nie vollständig. Die entscheidende Zahl:
**5'243 kB übertragen** — knapp ÜBER der damaligen 5-MB-Grenze des
Cache-Zweigs.

**Warum das so zäh war.** Die Grenze bricht nur den CACHE-Strom ab, nicht die
Auslieferung. Es fehlte also nicht das Bild, sondern alles darum herum:

- `aborted` verhindert das rename → die Datei landet NIE im Cache
- `queueThumb()` steht hinter genau diesem rename → es entsteht NIE eine
  Vorschau
- jede Kachel holt daraufhin bei JEDEM Aufruf erneut die vollen 5 MB vom CDN,
  mehrfach parallel, während die Kachelwand lädt

Für dieses eine Set wiederholte sich das endlos. Die Kachel blieb leer, weil
sie mit `&thumb=1` fragt und nie eine Verkleinerung bekam; die Detailansicht
funktionierte, weil sie ohne `thumb=1` fragt und das Original einfach
durchgereicht wird. Damit erklärt sich auch, warum die Nachträge 36, 37, 40
und 41 das Bild NICHT geheilt haben: Sie betrafen andere Glieder derselben
Kette — dieses Set fiel an einer fünften Stelle heraus.

Erschwerend: Der Abbruch geschah STILL. Kein Logeintrag, kein Zähler. Ohne
Marcos Netzwerk-Protokoll wäre der Fall nicht auffindbar gewesen.

**Fix.** Die Grenze steht jetzt als benannte Konstante `PROXY_CACHE_MAX_BYTES`
und liegt bei 20 MB. Rebrickable liefert für neuere Sets hochauflösende
Bilder; 5 MB waren zu knapp bemessen. Der Plattenplatz ist dadurch nicht in
Gefahr — der Aufräumlauf begrenzt den Cache ohnehin —, und gerade bei grossen
Bildern ist die Vorschau am wertvollsten: Sie ersetzt in der Kachel mehrere
Megabyte durch wenige Kilobyte. Wird die Grenze doch überschritten, steht das
ab sofort im Log und in der Fehlerzählung der Diagnose-Endpunkte.

Test `test/img-proxy-size.test.js`: Grenze deckt Katalogbilder ab, der Abbruch
wird protokolliert, und die Abhängigkeit „Vorschau entsteht nur nach
erfolgreichem Cache-Schreiben" ist festgehalten. Gegenprobe bestanden.

**Für Marco nach dem Update:** Das Bild wird beim ersten Aufruf einmal geholt
und gecacht, die Vorschau entsteht dabei. Falls die Kachel noch leer bleibt,
einmal Strg+F5 — der Browser hält sonst die alte, abgebrochene Antwort fest.

528 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 45 (hardened-155) — Kaufpreis liess sich im Haushalt nicht speichern

**Marcos Fehlerbericht:** „Wenn ich den Kaufpreis im Kaufpreis-Dialog anpasse
(Android oder Webapp), wird er nicht gespeichert. In der Webapp kommt die
Meldung Not found." Sein Server-Log nannte beide Stellen:

    routes/sets.js:1225             404: Error: Not found
    routes/api_v1/acquisitions.js   404: Error: Erfassung nicht gefunden

**Ursache.** Beide Wege suchten die Zeile mit `WHERE id=$1 AND user_id=$2` und
der EIGENEN Betrachter-ID. Im Haushalt gehört die Erfassung aber oft einem
Unterkonto — das Hauptkonto darf sie sehen UND ändern, fand sie so aber nicht.
Wieder das Muster „Regel fehlt am zweiten Weg", diesmal an vier Stellen
gleichzeitig: Ändern und Löschen, je Webapp und App.

**Fix.** Neuer Helfer `writableIds(uid)` in utils/household.ts — eigene ID plus
bestätigte Unterkonten. Bewusst NICHT `scopeIds()`: Das ist das LESE-Blickfeld
und enthält für ein Unterkonto auch dessen Hauptkonto; damit dürfte ein
Unterkonto rückwärts schreiben. Die Asymmetrie „Lesen weit, Schreiben eng"
bleibt erhalten und wird im Test ausdrücklich mitgeprüft.

**Der zweite, weniger offensichtliche Teil:** Nach dem Finden zählt der
BESITZER der Zeile, nicht der Betrachter. Sonst liefe die Spiegelung nach
`sets` (Menge, Preis, Zustand) in das falsche Konto. Beim ersten Anlauf hatte
ich genau das übersehen — drei `latest`-Abfragen suchten weiter mit der
Betrachter-ID, das Speichern meldete Erfolg, und `sets.purchase_price` blieb
still auf dem alten Wert. Aufgefallen ist es erst beim Nachmessen am laufenden
System (25.50 gespeichert, Spiegelung weiterhin 18.20).

Am laufenden Server nachgestellt und danach nachgemessen: Webapp-Route 200 mit
25.50, Android-Route 200 mit 31.00, Spiegelung zieht mit. Test
`test/acquisition-scope-db.test.js` prüft beide Routenfamilien, die Spiegelung
und die Gegenrichtung (Unterkonto darf die Erfassung des Hauptkontos NICHT
ändern → 404, Wert unverändert). Gegenprobe bestanden.

529 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 46 (hardened-156 + Android) — Kontofilter beginnt bei jeder Anmeldung mit „Alle"

**Marcos Frage und Wunsch:** „Wird der Filter des Eigentümers gespeichert? Wenn
ja, bitte entfernen, damit bei einem neuen Login immer Alle ausgewählt ist."

Ja, er wurde gespeichert — in der Webapp unter `bim_scope_<ansicht>` im
localStorage, in der App im DataStore unter `scope_<ansicht>`. Beides bewusst,
mit der damaligen Begründung: Der Filter ist eine Ansichtseinstellung wie
„Kachel oder Tabelle", und am Telefon will man sie womöglich anders als am
Rechner.

Genau das machte ihn aber zur Falle: Er überlebte Abmelden und Anmelden. Wer
zuletzt auf ein einzelnes Konto gefiltert hatte, sah nach dem nächsten Login
wieder nur dessen Sets — ohne dass etwas darauf hinwies. Das sah nicht nach
einem Filter aus, sondern danach, als sei die halbe Sammlung verschwunden.

**Umgesetzt:** Jede ANMELDUNG beginnt mit „Alle Konten", in beiden Clients.
Webapp: `resetScopeModes()` in doLogin, VOR showApp() — sonst entstünden die
Auswahlfelder noch mit dem alten Wert. App: `ScopeFilter.resetAll(ctx)` an
beiden Anmeldewegen (Passwort und QR-Login).

Bewusst NICHT bei jedem Seitenaufbau: Innerhalb einer Sitzung soll eine
getroffene Wahl auch ein F5 überleben — sonst wäre der Filter unbrauchbar.
Die Persistenz an sich bleibt also erhalten; nur die Anmeldung räumt auf.
`test/scope-reset.test.js` hält alle drei Punkte fest (Helfer räumt ALLE
Ansichten, Aufruf steht vor showApp, das Speichern bleibt), Gegenprobe
bestanden.

532 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 47 (hardened-157) — Die ZWEITE 5-MB-Grenze

**Marcos Rückmeldung nach Nachtrag 43:** „Das Bild wird nach wie vor nicht auf
dem Server gespeichert und auch kein Thumbs-Image erstellt. Wenn ich die Seite
neu lade, lädt die App noch immer über /api/img-proxy?…&thumb=1."

**Mein Fehler in 43: Ich habe nur EINE der beiden Grenzen angehoben.**
`PROXY_CACHE_MAX_BYTES` (routes/imgProxy.ts) ging auf 20 MB —
`SET_IMG_MAX_BYTES` (routes/sets.ts, Zeile 79) blieb bei 5 MB stehen. Beide
kappen bei derselben Bildgrösse, aber an verschiedenen Wegen, und Marcos Bild
wiegt 5'243 kB. Die Folge am lokalen Weg:

- `downloadSetImage()` bricht über der Grenze ab und liefert `null`
- damit bleibt `sets.image_local` leer
- `generateThumb()` arbeitet auf der lokalen Datei — ohne sie keine Vorschau
- also holen beide Clients das Bild weiterhin über den Proxy

Genau das beschreibt Marcos Satz. Dass der Proxy es seit 43 cacht, ändert
daran nichts: Der Proxy-Cache ist eine andere Ablage als `data/images/sets/`.

Erschwerend, wie schon beim Proxy: Der Abbruch geschah STILL — kein Log, keine
Spur. Niemand konnte erklären, warum ausgerechnet dieses Set kein lokales Bild
bekam.

**Fix.** `SET_IMG_MAX_BYTES` ebenfalls auf 20 MB, plus eine Logzeile beim
Überschreiten. Am laufenden HTTP-Server mit Marcos Bildgrösse nachgemessen:
mit 5 MB → `null`, mit 20 MB → 5.25 MB geladen und `image_local` wird gesetzt.

**Und damit es nicht ein drittes Mal passiert:** Der Test prüft jetzt, dass
BEIDE Zahlen gleich sind. Laufen sie auseinander, bekommt ein Bild einen
Cache-Eintrag ohne lokale Datei oder umgekehrt — genau die Halbheit, die
diesen Nachtrag nötig gemacht hat. Gegenprobe bestanden.

**Für Marco:** Für bereits erfasste Sets holt das den Rückstand nicht von
selbst nach — die lokale Datei entsteht beim Erfassen. Im Monitoring gibt es
dafür den Bilder-Nachlauf („fehlende Bilder neu laden"); ein Lauf davon holt
das Bild und erzeugt die Vorschau. Danach lädt die App über
`/images/sets/…` statt über den Proxy.

534 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 48 (hardened-158) — Seit Nachtrag 41 entstand GAR KEINE Vorschau mehr

**Marcos Beobachtung:** „In der Setgalerie werden für neue Sets keine Thumbs
angezeigt, sondern immer die grossen Bilder. Bei älter erfassten Sets wird das
Thumb korrekt genutzt." Und auf Nachfrage: `60445-1_thumb.jpg` existiert auf
dem Server gar nicht.

**Der eigentliche Fund — mein Fehler aus Nachtrag 41.** Beim Umbau auf
atomares Schreiben bekam die temporäre Datei den Namen
`<ziel>.<pid>.<zeit>.tmp`. Jimp leitet das Zielformat aber aus der
DATEIENDUNG ab: `.tmp` ergibt „Unsupported MIME type: null". Der Fehler landete
im umgebenden `catch` und wurde zu einem stillen `return null`.

Seither entstand **überhaupt keine Vorschau mehr** — weder lokal
(routes/thumbs.ts) noch im Bild-Proxy (routes/imgProxy.ts). Dass es niemandem
auffiel, liegt daran, dass ältere Sets ihre vor 41 erzeugte Vorschau behielten;
sichtbar wurde es erst an neu erfassten. Genau das beschreibt Marcos Satz.

Bitter daran: Der Test aus 41 prüfte die Regel („schreibt temporär, benennt
um") und war grün — er prüfte nie, ob am Ende eine Datei liegt. Ein
Verhaltenstest hätte den Fehler sofort gefunden. Der neue Test tut das jetzt:
Er erzeugt ein echtes JPEG, ruft generateThumb() auf und verlangt eine
tatsächlich vorhandene, KLEINERE Datei.

**Zweiter Teil: fehlende Vorschauen heilen sich jetzt selbst.** Die Erzeugung
war bisher ein reines Erfassungs-Ereignis — nur direkt nach dem Download. Ging
dabei etwas schief (bei Marcos Set scheiterte der Download bis Nachtrag 47 an
der Grössengrenze), entstand sie nie mehr: Der Bilder-Nachlauf deckt
`set_parts_catalog`, `set_minifigs_catalog` und `parts` ab, aber NICHT `sets`,
und er repariert ohnehin nur physisch fehlende Dateien, keine fehlenden
Vorschauen.

Jetzt stösst die Bildroute die Erzeugung an, wenn sie beim Ausliefern bemerkt,
dass die Vorschau fehlt und das Original vorliegt — nebenher, nicht im
Anfragepfad. Am laufenden Ablauf nachgemessen: erste Anfrage 200 mit dem
Original in 21 ms, danach liegt die Vorschau (1'709 statt 13'743 Bytes), zweite
Anfrage liefert sie.

Test `test/thumb-generation.test.js` (Verhalten + beide Erzeuger + Selbstheilung
in der Route), Gegenprobe bestanden.

**Für Marco:** Kein Handgriff nötig. Beim nächsten Öffnen der Galerie entsteht
für jedes betroffene Set die Vorschau von selbst; ab dem zweiten Laden ist sie
in Gebrauch.

537 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 49 (hardened-159 + Android) — Vier Punkte aus der Nachschau

Nach dem .tmp-Fehler (Nachtrag 48) blieben vier Punkte offen, die alle zur
selben Familie gehören: Fehler, die niemand sieht.

**1. Die Vorschau-Erzeugung schwieg bei jedem Fehlschlag.** In
routes/thumbs.ts stand `catch (e) { return null; }`, im Bild-Proxy
`catch (_) { return false; }`. Genau das hat den .tmp-Fehler SIEBEN Nachträge
lang verdeckt: Die Erzeugung scheiterte bei jedem einzelnen Aufruf, und weder
Log noch Zähler sagten ein Wort — gefunden wurde es erst, weil einem Nutzer
auffiel, dass neue Sets keine Vorschau bekommen. Beide melden jetzt mit Pfad
und Grund; der Proxy zählt es zusätzlich in seine Fehlerstatistik. Dazu räumt
thumbs.ts liegengebliebene `.tmp.jpg` weg.

**2. Der Bilder-Nachlauf war doppelt lückenhaft.**
`_fsPathFromLocal()` liess alles ausser `/images/parts/` fallen — Set- und
Minifiguren-Bilder wurden schon beim Auflösen des Pfades verworfen, noch bevor
irgendetwas geprüft wurde; der Lauf meldete trotzdem „fertig". Und repariert
wurden ausschliesslich fehlende DATEIEN: Lag das Bild vor und fehlte nur die
Verkleinerung, tat er nichts. Beides zusammen hiess, dass „fehlende Bilder neu
laden" für Set-Bilder wirkungslos war. Jetzt kennt der Auflöser alle drei
Bildarten (Schutz gegen `..` bleibt), `sets` ist in Bestand und Aufräumen
aufgenommen, und fehlende Vorschauen werden vor dem Download-Teil erzeugt —
sie brauchen kein Netz und wirken sofort. Der Lauf meldet die Zahl mit.

Am laufenden System nachgemessen: Set-Bild vorhanden, Vorschau fehlt → Lauf
erzeugt sie (`thumbs: 1`). Test `test/image-catchup-db.test.js`, Gegenprobe
bestanden (Sets-Pfad entfernt → 0 Vorschauen).

**3. Die App-Detailansicht hatte gar keine Fehlerbehandlung beim Bild** — kein
`onState`, also weder Wiederholversuch noch Rückfall, anders als die
Galerie-Kachel. Schlug der erste Ladeversuch fehl (direkt nach dem Erfassen
ist die Datei oft noch nicht fertig), blieb die Fläche leer, bis man den
Bildschirm verliess und neu öffnete; Coil versucht von sich aus nie erneut.
Jetzt derselbe einmalige, verzögerte Versuch wie in der Kachel.

**4. 14 stille `catch`-Blöcke in der App durchgesehen.** Acht sind legitimes
Aufräumen (Scanner schliessen, WLAN-Sperre freigeben) und bleiben. Zwei sind
Hintergrund-Statusabfragen — dort wäre eine Logzeile eher Lärm als Hilfe.
ZWEI aber waren echte Sackgassen: „Bei BrickLink kaufen" (CatalogDetailScreen)
und „Anleitung öffnen" (SetDetailScreen) riefen `startActivity` und
verschluckten jeden Fehler. Ist kein Browser da oder scheitert der Aufruf,
tippte der Nutzer auf den Knopf und es passierte NICHTS — dieselbe Sorte
Sackgasse wie „klicken, nichts passiert" in der Webapp (Nachtrag 120). Beide
zeigen jetzt eine kurze Meldung; neuer Textbaustein in beiden Sprachdateien.

540 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 50 (hardened-160) — Der Bild-Download spricht, und es gibt ein Diagnosewerkzeug

**1. `downloadSetImage()` verschluckte weiterhin fast alles.** Nachtrag 47 gab
nur der Grössengrenze eine Logzeile. Vier weitere Fehlerwege blieben stumm:
ein Statuscode ungleich 200, jeder Netzwerkfehler (Zeitüberschreitung, DNS,
Abbruch), eine zu kleine Antwort (fast immer eine Fehlerseite) und der
umschliessende `catch`, der auch Schreibfehler und volle Platten schluckte.
Alle enden jetzt mit einer Meldung, die Setnummer, Grund und Adresse nennt.

Warum das zählt: „404 vom CDN" und „403 wegen Bot-Erkennung" verlangen völlig
verschiedene Massnahmen — vorher waren beide dasselbe schweigende `null`.

**2. Neuer Endpunkt `GET /api/v1/admin/image-diag/:setNumber`.** Er beantwortet
in EINER Antwort die Fragen, die in dieser Woche fünfmal einzeln von Hand
beantwortet werden mussten: Was weiss die Datenbank (eigene Zeile UND
gemeinsamer Katalog)? Liegt das Original auf der Platte, wie gross, wie alt?
Die Vorschau? Kennt der Bild-Proxy die CDN-Adresse schon? Dazu ein
Klartext-Hinweis — das ist der eigentliche Nutzen, denn die Zahlen allein
lagen schon vorher irgendwo herum, nur an drei verschiedenen Orten.

Bewusst nur BEOBACHTUNG: Der Endpunkt lädt nichts nach und erzeugt nichts. Wer
reparieren will, nimmt den Bilder-Nachlauf. Ein Diagnosewerkzeug, das nebenbei
Zustand verändert, macht die nächste Fehlersuche schwerer statt leichter — der
Test prüft das ausdrücklich mit.

Dafür wanderte die Cache-Pfad-Regel des Proxys (SHA1 der Adresse) aus der Route
in die exportierte Funktion `proxyCachePathFor()`. Eine abgeschriebene zweite
Fassung wäre genau die Sorte Duplikat, die irgendwann auseinanderläuft und dann
falsche Auskunft gibt.

Am laufenden System in drei Lagen nachgemessen: Original da/Vorschau fehlt,
gar nichts bekannt, alles vorhanden — jedes Mal mit passendem Klartext. Test
`test/image-diag-db.test.js`, Gegenprobe bestanden.

**3. Die übrigen sechs stillen `catch` in Preis- und Katalogpfaden** wurden
angesehen und bewusst NICHT geändert: Dort ist „kein Preis" bzw. „nichts
gefunden" ein normaler Ausgang, kein Fehlschlag. Eine Meldung wäre dort Lärm,
der die echten Meldungen unauffindbar macht.

542 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 51 (hardened-161) — Kaufpreis erreichte die Kachel nicht (nur App)

**Marcos Screenshot:** In der Erfassung steht 107.00 CHF, die Kachel oben zeigt
weiterhin 108.00 CHF. Der Preis wurde also gespeichert, die Anzeige blieb alt.

**Ursache.** In der Konfiguration der v1-Erfassungsrouten stand für SETS
`parentPriceSql: null` — als einzige der drei Elementarten. Teile und
Minifiguren spiegeln seit jeher in ihre Elternzeile, und die Webapp-Route tut
es für Sets ebenfalls (routes/sets.ts). Nur der Android-Weg liess
`sets.purchase_price` stehen.

Das wirkt weiter als es klingt: Galerie-Kachel, Finanzübersicht und
Detail-Kachel lesen alle aus `sets.purchase_price`. Nach einer Änderung über
die App zeigte damit die ganze Anwendung dauerhaft den alten Wert — auch die
Webapp, auch nach dem Neuladen. Nur die Erfassungsliste selbst stimmte.

Wieder das Muster „dieselbe Regel fehlt am zweiten Weg". Die Bedingung („nur
wenn die geänderte Erfassung die neueste ist") steckt bereits im gemeinsamen
Ablauf und gilt damit automatisch mit — der Test prüft auch diese
Gegenrichtung: Eine ältere Erfassung darf die Kachel NICHT überschreiben.

Am laufenden Server gemessen, beide Wege nebeneinander: vorher Webapp 107 /
Android 108, nachher beide 107. Test
`test/acquisition-price-mirror-db.test.js`, Gegenprobe bestanden.

**Eigene Falle beim Messen, als Warnung notiert:** Mein erster Aufbau leerte
zwischen den beiden Läufen nur `sets`, nicht `set_acquisitions`. Die Erfassung
aus dem ersten Lauf blieb liegen, „die neueste Erfassung" war dadurch eine
andere Zeile — und die Messung zeigte den Fehler noch, als er längst behoben
war. Beinahe hätte ich an der falschen Stelle weitergesucht. Erst die
Gegenprobe (Fix zurückdrehen) trennte Artefakt von Befund sauber.

543 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 52 (hardened-162 + Android) — Menge im Haushalt, und höhere Kacheln

**1. Marcos Bericht:** „Wenn die Anzahl eines Sets erhöht wird, welches einem
Unterkonto gehört, funktioniert die ganze Logik nicht mit dem Kaufpreis und die
Anzahl wird nicht gespeichert."

`updateSet()` suchte das Set mit `WHERE user_id=$1` und der EIGENEN
Betrachter-ID — 404 für jedes Set des Unterkontos. Beim Nachmessen zeigte sich:
Es trifft BEIDE Wege, auch die Webapp, die Marco noch nicht getestet hatte.

Dieselbe Klasse wie Nachtrag 45 (dort der Kaufpreis, hier die Menge) — und
weil die Mengenänderung über `adjustAcquisitionsToQuantity()` auch Erfassungen
anlegt und Preise bestimmt, blieb gleich die ganze Kette wirkungslos. Genau das
meint Marcos „die ganze Logik mit dem Kaufpreis".

Fix: `writableIds()` statt eigener ID, danach durchgehend der BESITZER der
Zeile (sonst entstünden die Erfassungen im falschen Konto). Am laufenden Server
gemessen: vorher beide Wege 404 und Menge unverändert 1, nachher beide 200 mit
Menge 3 und mitgezogener Erfassung. Test `test/set-quantity-scope-db.test.js`
prüft zusätzlich, dass KEINE Erfassung im Konto des Betrachters entsteht.
Gegenprobe bestanden.

**2. Zur Frage „nur eine Erfassung, alter Preis müsste ersetzt werden":** Das
ist genau der Fix aus Nachtrag 51 (hardened-161) — bei einer einzigen Erfassung
ist diese immer die neueste, und die Kachel übernimmt den neuen Preis. Ist auf
Marcos Screenshot noch der alte Stand zu sehen, fehlt dort schlicht das Update.

**3. Android, Kachelhöhe:** Die Etiketten (Zustand, Besitzer) liegen am unteren
Rand ÜBER dem Bild und verdeckten es bei Fotos, die die Fläche ausfüllen. Die
Kachel ist jetzt 272 statt 232 dp hoch, der Bildbereich 154/170 statt 114/130 —
und das Bild lässt unten 44 dp frei, genau den Streifen, in dem die Etiketten
sitzen. `ContentScale.Fit` skaliert in den verbleibenden Raum, das Bild wird
also nicht beschnitten, sondern rückt nach oben. Die Textzeilen darunter
bleiben unverändert.

544 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 53 (hardened-163) — Löschen im Haushalt (Marcos Rückfrage)

**Marco fragte, ob ich die Löschlogik ebenfalls geprüft habe.** Hatte ich
nicht — und sie hatte dieselbe Lücke wie Kaufpreis (45) und Menge (52): Beide
Wege suchten mit der eigenen Betrachter-ID und gaben für jedes Set des
Unterkontos 404. Nachgemessen: Set blieb stehen, Teile und Erfassungen
ebenfalls.

Immerhin war die Lücke ungefährlich — es wurde nie fälschlich etwas gelöscht.
Aber im Haushalt liess sich schlicht nichts entfernen.

Zwei Auffälligkeiten kamen dabei ans Licht:

- `deleteSet()` in utils/handlers.ts KONNTE das Blickfeld längst (asIds + ANY,
  aus einem früheren Durchgang) — es bekam vom Aufrufer nur eine nackte ID.
  Die Fähigkeit lag also brach.
- Die Webapp-Route führte vier einzelne DELETEs OHNE Transaktion aus, obwohl
  der andere Weg dafür längst eine hatte (mit genau der Begründung, dass sonst
  Teile und Minifiguren ohne Set zurückbleiben). Jetzt läuft auch sie in EINER
  Transaktion.

Fix: `writableIds()` an beiden Wegen, danach der BESITZER der Zeile — sonst
löschte die Anweisung im Konto des Betrachters, wo nichts steht, und die Teile
des Unterkontos blieben als Waisen zurück.

Bewusst `writableIds()` und NICHT `scopeIds()`: Löschen ist der Schritt, bei
dem „Lesen weit, Schreiben eng" am meisten zählt. Nachgemessen und im Test
festgehalten: vorwärts 200 und alles weg, rückwärts (Unterkonto → Set des
Hauptkontos) 404 und nichts angetastet. Test
`test/set-delete-scope-db.test.js`, Gegenprobe bestanden.

**Damit sind alle vier Änderungswege am Set im Haushalt geprüft:** Kaufpreis
(45), Menge (52), Löschen (53) — und der Eigentümerwechsel, der schon in
Durchgang 115 auf die Zeile statt den Betrachter umgestellt wurde.

545 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 54 (hardened-164) — pgweb im compose-File

Marcos Wunsch: pgweb einbinden, um die Datenbank im Browser ansehen zu können.

Umgesetzt als **optionaler** Dienst — drei Entscheidungen, die alle demselben
Gedanken folgen:

**1. Profil statt Dauerbetrieb.** `docker compose up -d` startet weiterhin nur
Datenbank und App. pgweb kommt nur auf Anforderung:

    docker compose --profile tools up -d pgweb    # → http://localhost:8081
    docker compose --profile tools down pgweb

Ein Werkzeug, das man dreimal im Jahr braucht, soll nicht dauerhaft mitlaufen —
schon gar keins ohne Anmeldung.

**2. Bindung an 127.0.0.1.** Das ist der wichtigste Punkt: **pgweb bringt keine
Anmeldung mit.** Wer die Seite erreicht, hat vollen Zugriff auf alle Konten,
Sitzungen und Daten — und kann sie ändern. Mit `127.0.0.1:8081:8081` ist der
Dienst nur auf dem Server selbst erreichbar; ein blosses `8081:8081` würde ihn
an alle Schnittstellen binden und wäre je nach Router von aussen offen. Zugriff
von einem anderen Rechner gehört durch einen SSH-Tunnel.

**3. `--readonly` als Voreinstellung.** Zum Nachsehen ist das die richtige
Einstellung; für Reparaturen kann die Zeile auskommentiert werden. Lieber
bewusst freischalten als versehentlich ein UPDATE ohne WHERE absetzen.

Neuer Test `test/compose-pgweb.test.js` hält die drei Eigenschaften fest —
Bindung, Profil, kein Volume — und prüft dabei die YAML-STRUKTUR, nicht den
Wortlaut: Eine Prüfung auf Zeichenketten wäre zu leicht auszuhebeln, ein
Kommentar mit der richtigen Zeichenfolge genügte. Der Test prüft zusätzlich die
Gegenrichtung: Datenbank und App dürfen KEIN Profil tragen, sonst startet der
normale Aufruf gar nichts mehr. Gegenproben bestanden (offene Bindung → rot,
Profil entfernt → rot).

Dazu ein README-Abschnitt mit den Befehlen und dem SSH-Tunnel.

549 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 55 (hardened-165) — Erfassungen im Haushalt: die restlichen FÜNF Wege

**Marcos Bericht:** Kaufpreis eines Unterkontos löschen → `404 Nicht gefunden`
aus `routes/sets.js:1345`, die Zeile bleibt stehen.

**Beim Nachsehen war der gemeldete Fall nur einer von sechs.** Nachtrag 45
hatte dieselbe Lücke geschlossen, aber nur an zwei Stellen: der v1-Fabrik und
der Webapp-Route zum ÄNDERN einer Set-Erfassung. Offen geblieben waren:

- Set-Erfassung **löschen** (Marcos Fall)
- Teil-Erfassung ändern **und** löschen
- Minifiguren-Erfassung ändern **und** löschen

Alle suchten mit `WHERE id=$1 AND user_id=$2` und der eigenen Betrachter-ID.

**Zwei der Löschwege waren dabei schlimmer als 404:** Sie prüften gar nicht, ob
eine Zeile getroffen wurde. Das DELETE lief ins Leere, die Antwort meldete
trotzdem `success: true` — der Nutzer sah „gelöscht", die Zeile blieb stehen.
Beide geben jetzt 404, wenn es nichts zu löschen gibt.

Fix überall gleich: `writableIds()` zum Finden, danach der BESITZER der Zeile
für alles Weitere (Löschung, Mengensumme, Rückspiegelung nach `parts`/
`minifigs`/`sets`). Am laufenden Server alle sechs Wege nebeneinander gemessen:
vorher 404, nachher 200.

**Das hätte ich in Nachtrag 53 schon tun sollen.** Dort stand die Lehre bereits
im Changelog — nach zwei Funden derselben Klasse sofort die ganze Familie
durchgehen. Ich habe sie auf die Set-Routen angewandt und die anderen beiden
Elementarten übersehen. Der neue Test deckt deshalb ALLE sechs Wege ab, nicht
nur den gemeldeten.

Test `test/acquisition-all-paths-db.test.js`, Gegenprobe bestanden.

550 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 66 (hardened-166) — Kontowahl im Katalog-Dialog, Finanz-Filter rechts

**1. Marcos Fund:** Katalog → Set → „In Galerie aufnehmen" → im Zwischendialog
(Anzahl, Kaufpreis, Zustand) fehlte die Kontowahl.

Der Katalog-Dialog war der **vierte** Erfassungsweg. Galerie-Formular,
manuelles Teil und manuelle Minifigur fragen das Konto längst ab — hier war es
nie angeschlossen. Der Aufruf schickte schlicht kein `owner_user_id` mit, also
landete jedes so aufgenommene Set stillschweigend beim eigenen Konto. Wieder
dasselbe Muster wie durch die ganze Reihe.

Fix: Auswahlfeld `cat-m-owner` im Dialog (blendet sich ohne Haushalt selbst
aus, wie die anderen drei), `selectedOwner()` beim Hinzufügen, und der Katalog
steht jetzt in derselben Liste, die die Mitglieder einträgt.

Der bestehende Test pinnte die Liste als GANZES („alle drei Formulare") und
wurde dadurch rot, obwohl die Regel erfüllt war. Jetzt prüft er jeden
Erfassungsweg EINZELN: Er wird rot, wenn einer fehlt, aber nicht, wenn ein
weiterer dazukommt — dieselbe Umformulierung wie bei den Tests aus 131.

**2. Finanz-Filter rechts.** Die Kopfzeile ist flex mit `space-between`, also
stand der Filter auf breiten Fenstern schon rechts. Sie bricht aber um, und
nach einem Umbruch beginnt die neue Zeile wieder links — genau das sieht man
auf schmalen Fenstern und auf dem Handy. `margin-left:auto` hält ihn in beiden
Fällen am rechten Rand.

WICHTIG nach Frontend-Änderungen: `npm run build:frontend` — sonst bleibt
public/js/app.bundle.js alt. Nachgeprüft, dass beide Katalog-Stellen im Bündel
angekommen sind.

550 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 68 (hardened-167) — Geleerter Kaufpreis blieb leer (nur App)

**Marcos Bericht:** „Wenn ich bei einem bestehenden Set die Anzahl erhöhe und
dann den Kaufpreis lösche (bei einem anderen Besitzer), wird der aktuelle Preis
nicht von BrickLink abgefüllt." Auf seinem Screenshot stand in der
Kaufpreis-Kachel ein Strich, obwohl der Marktpreis (12.55 CHF) bekannt war.

**Ursache.** In der Konfiguration der v1-Erfassungsrouten stand für SETS
`resolvePrice: null` — als einzige der drei Elementarten. Teile und Minifiguren
holen den Marktpreis seit jeher, die Webapp-Route tut es für Sets ebenfalls.
Nur der Android-Weg liess das Feld leer. Und weil die Kachel aus
`sets.purchase_price` liest und die Spiegelung den leeren Wert übernimmt, stand
danach in der ganzen App ein Strich.

Das ist dieselbe Zeile in derselben Konfiguration wie schon bei
`parentPriceSql` (Nachtrag 51) — beim damaligen Fix habe ich nur die eine
Zeile angefasst und die Nachbarzeile nicht geprüft. Genau deshalb steht die
Regel jetzt zum zweiten Mal hier: bei einem Fund in einer Konfigurationstabelle
die GANZE Zeile durchgehen, nicht nur das gemeldete Feld.

**Zustand zählt.** Der Auflöser bekommt jetzt den Zustand der Zeile mit
(bzw. den neuen aus dem Rumpf, falls er mitgeändert wird): Ein „Neu"-Eintrag
muss den Neu-Preis bekommen, nicht den der Gebraucht-Erfassung daneben. Der
Test hat dafür bewusst zwei verschiedene Preise im Cache.

Am laufenden Server in Marcos Lage gemessen (Set des Unterkontos, zwei
Erfassungen, Hauptkonto leert den Preis der Neu-Zeile): vorher Webapp 12.55 /
Android leer, nachher beide 12.55 — in Erfassung UND Kachel. Test
`test/acquisition-price-refill-db.test.js`, Gegenprobe bestanden.

551 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 69 (hardened-168) — EINE Preisregel statt zweier

**Marcos Befund:** „Android füllt 12.55 CHF, die Webapp 18.90 CHF — anscheinend
nicht dieselbe Logik." Genau so war es.

Der Webapp-Weg hatte eine ZWEITE, eigene Fassung der Preisregel: Sie las
`price_cache` mit der GLOBALEN Währung aus `global_settings` statt mit der des
Kontos. Steht dort noch EUR, während Marco CHF nutzt, trifft die Abfrage einen
anderen Cache-Eintrag — daher zwei verschiedene Zahlen für denselben Vorgang.
Zusätzlich holte sie nichts nach, wenn der Cache leer war.

Jetzt nutzen beide Wege dieselbe Funktion: `getCurrentMarketPrice(setNummer,
BESITZER, Zustand)` — Währung des Kontos, ausdrücklicher Zustand, frischer
Abruf bei leerem Cache. Nachgestellt mit abweichender globaler Währung: vorher
Webapp 18.90 / Android 12.55, nachher beide 12.55.

Der Test setzt diese abweichende globale Währung jetzt DAUERHAFT und
vergleicht am Ende die beiden Ergebnisse miteinander. Läuft irgendwann wieder
eine zweite Fassung mit, fallen die Wege sofort auseinander und der Test wird
rot — die Regel „gleiches Verhalten" ist damit nicht mehr nur Absicht, sondern
geprüft.

**Zur strukturellen Frage (Marco: „Können die beiden Apps nicht dieselben APIs
nutzen?").** Stand heute: 80 Endpunkte in der App-Familie, 67 in der
Session-Familie, aber nur 17 gemeinsame Handler. Der Boden ist also gelegt,
aber die Mehrheit der Wege ist doppelt implementiert — und genau daher stammen
die letzten zwölf Fehlermeldungen (Kaufpreis, Menge, Löschen, Erfassungen,
Kontowahl, Preisauffüllung). Die Empfehlung steht im Antworttext: EIN Router,
zwei Authentifizierungen davor.

551 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 70 (hardened-169) — Erfassungen: EINE Route für beide Clients

Marcos Vorgabe: „Können die beiden Apps nicht die gleichen APIs nutzen (mit
unterschiedlichen Authentifizierungsarten), damit die Logik nur einmal
implementiert werden muss und das Verhalten immer gleich ist?" — erste Etappe
umgesetzt, für die Erfassungen (dort kamen die meisten Fehler her).

**Neun doppelte Routen entfernt** (GET/PUT/DELETE × Sets/Teile/Minifiguren).
Sie leben nur noch in routes/api_v1/acquisitions.ts. Möglich war das ohne neue
Schicht, weil `requireToken` BEIDE Ausweise akzeptiert: Sitzungs-Cookie ODER
Bearer-Token. Es brauchte also nur das Entfernen der Zweitfassung. Das
Frontend ruft an allen zehn Stellen `/api/v1/...`.

**FAST VERLORENGEGANGEN — und der wichtigste Punkt dieses Nachtrags:** Die
Fabrik kannte das Feld `date` gar nicht. Die Änderung des Kaufdatums samt
Tagesregel („pro Tag, Element und Konto genau EIN Eintrag") gab es nur in den
Webapp-Routen. Mit dem Entfernen wäre die Fähigkeit stillschweigend
verschwunden — die App schickt `date` nicht, es wäre also nie aufgefallen.
Gefunden hat es ein bestehender Test, der den gemeinsamen Tagesprüfer
verlangte. Genau dafür sind solche Tests da.

Die Datumsänderung ist jetzt generisch in der Fabrik (cfg.kind), inklusive
Neubestimmung der neuesten Erfassung danach — sonst zeigte die Kachel den Preis
der falschen Zeile.

**Tests: fünf Gruppen umformuliert, nicht abgeschaltet.** Sie schrieben die
Doppelung fest („beide Routenfamilien liefern dasselbe"). Nach dem Umbau lautet
die richtige Aussage anders und ist SCHÄRFER: dieselbe Route, mit Sitzung UND
mit Token aufgerufen, muss dasselbe liefern. Genau das prüft die Parität jetzt
— plus eine Gegenrichtung, die rot wird, falls die alten Zweitfassungen je
zurückkehren.

Am laufenden Server nachgemessen: Sitzung 200, Token 200, gemeinsamer Stand;
Datum ändern 200, ungültiges Datum 400.

**Nächste Etappen** (gleiches Muster): Sets/Teile/Minifiguren als Ganzes, dann
Finanzen und Einstellungen. Nach jeder Etappe volle Suite und ein Paket.

552 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 72 (hardened-170) — Minifiguren: eine Route für beide Clients

Zweite Etappe des Umbaus, bewusst mit der kleinsten Familie begonnen, damit
sich der Ablauf an wenigen Routen bewährt.

**Erst gemessen, dann entfernt** — auf Marcos ausdrückliche Nachfrage, ob die
Endpunkte dasselbe liefern. Alle fünf Paare (GET Liste, GET manuell, POST, PUT,
DELETE) wurden vorher gegeneinander geprüft: Antwort UND Wirkung auf die
Datenbank, jeweils identisch. Erst danach ist die Zweitfassung gefallen.

**Fünf doppelte Routen entfernt**; sie leben nur noch in
routes/api_v1/minifigs.ts. Das Frontend ruft an sieben Stellen /api/v1/….

**Drei Routen sind bewusst geblieben:** /stats, /export/csv und /import/csv gibt
es nur an einem Ort — sie können gar nicht auseinanderlaufen. Sie zu
verschieben wäre Umzug ohne Gewinn.

Tests: Die Kontofilter- und Schreibrecht-Regeln prüfen jetzt
routes/api_v1/minifigs.ts statt der entfernten Session-Route (Regel unverändert,
nur der Ort). Die beiden Paritäts-Paare wurden zu „eine Adresse, beide Ausweise"
umgeformt, und die alten Adressen stehen in der 404-Gegenprobe.

Nachgemessen: POST mit Sitzung 200, POST mit Token 200, beide Figuren angelegt.

**Eigene Panne beim Prüfen:** Mein Kontrollskript schickte zuerst PUT statt POST
und meldete 404 — das sah nach einem echten Fehler aus. Erst der Blick in die
Route zeigte, dass es dort gar kein PUT auf die Sammeladresse gibt. Merke: bei
einer überraschenden 404 zuerst prüfen, ob die eigene Anfrage zur Route passt.

552 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 73 (hardened-171) — Teile: eine Route für beide Clients

Dritte Etappe. NEUN doppelte Routen entfernt (Liste, manuelle Liste, Farben,
Statistik, BrickLink-Farbtabelle, Steinfarben, Anlegen, Ändern, Löschen); sie
leben nur noch in routes/api_v1/parts.ts. Frontend an neun Stellen umgestellt.

**Erst gemessen, dann entfernt — und danach nochmal gemessen** (Marcos
Vorgabe). 18 Fälle gegen den gesicherten Vorher-Stand, jeweils HTTP-Antwort UND
vollständiger Datenbankzustand (alle Spalten aus `parts` und
`part_acquisitions`):

- lesend: Liste, manuelle Liste, Farben, Statistik, beide Farbtabellen
- schreibend: neues Teil, bestehendes Teil (Mengenaddition), ohne Preis, ohne
  Teilenummer (Fehlerfall), Menge ändern, Preis+Zustand ändern, Menge 0,
  unbekanntes Teil, löschen (vorhanden und unbekannt)
- Haushalt: für das Unterkonto anlegen, für ein fremdes Konto anlegen (abgelehnt)

Ergebnis: **18 von 18 identisch.**

Zwei gemeldete Abweichungen entpuppten sich als Messartefakte, was ich erst
beim Aufschlüsseln der einzelnen FELDER sah: Die Liste nennt zusätzlich `page`
(mehr Information, keine andere Auswahl — beide Wege nutzen denselben Handler),
und in der manuellen Liste unterschieden sich Zeilen-IDs und Zeitstempel, weil
mein Prüfaufbau vor jedem Aufruf neue Zeilen anlegt. MERKE für die nächste
Etappe: Beim Vorher/Nachher-Vergleich IDs und Zeitstempel von vornherein
ausblenden, sonst meldet der Vergleich Unterschiede, die keine sind.

**Geblieben** sind /categories, /import/csv und /export/csv — die gibt es nur an
einem Ort.

552 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 74 (hardened-172) — Sets: letzte Etappe des API-Umbaus

SIEBEN doppelte Routen entfernt (Liste, Detail, Anlegen, Ändern, Löschen,
Eigentümerwechsel, Haushaltsmitglieder); sie leben nur noch in
routes/api_v1/sets.ts. Frontend an zehn Stellen umgestellt.

**Verifikation gegen den gesicherten Vorher-Stand** (11 Fälle, jeweils Antwort
UND vollständiger Datenbankzustand): Liste, Detail, unbekanntes Set,
Haushaltsmitglieder, Menge ändern, Menge 0, unbekanntes Set ändern,
Eigentümerwechsel zum Unterkonto, Wechsel zu einem fremden Konto (abgelehnt),
Löschen vorhanden und unbekannt. **Alle schreibenden Fälle identisch.**

Einziger Unterschied: Die Liste nennt zusätzlich `count`. Nachgeprüft, dass die
Webapp `total` liest — das liefert die neue Route unverändert. Ein Feld MEHR,
keines fehlt.

**Bewusst NICHT zusammengelegt** (existiert je nur einmal, kann also nicht
auseinanderlaufen): add-stream und der CSV-Import samt Status, Abbruch und
Fortschritts-Strom (SSE statt einzelner Antwort), die drei Anleitungs-Routen und
/:setNumber/parts (Datei-Uploads), sowie info/:setNumber, export/csv und
export/rebrickable.

**Damit ist der Umbau abgeschlossen.** Über vier Etappen sind 30 doppelte
Routen verschwunden: 9 Erfassungen (70), 5 Minifiguren (72), 9 Teile (73),
7 Sets (74). Jede Etappe wurde vor UND nach dem Zusammenlegen gegen den
Vorher-Stand gemessen.

Tests: zwölf Gruppen umformuliert statt abgeschaltet. Die Paritätsprüfung sagt
jetzt durchgehend „dieselbe Route, mit Sitzung UND mit Token, liefert dasselbe"
— und eine Gegenprobe wird rot, falls eine der alten Zweitfassungen je
zurückkehrt.

**Eigene Falle dabei:** Beim Massen-Umstellen der Test-URLs traf mein Muster
auch die MOUNT-Pfade (`app.use('/api/sets', …)` wurde zu `/api/v1/sets`), was
sieben Testdateien auf einen Schlag rot färbte. Aufgefallen an einer 404, die
inhaltlich keinen Sinn ergab. MERKE: Bei solchen Ersetzungen Mount-Zeilen
ausdrücklich ausnehmen — sie sehen aus wie Aufrufe, sind aber das Gegenteil.

552 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 75 (hardened-173) — Kaufpreis gelöscht, Kachel blieb stehen

**Marcos Screenshot:** Die verbliebene Erfassung zeigt 7.41 CHF, die Kachel
oben weiterhin 9.48 — den Preis der GELÖSCHTEN Zeile.

**Ursache.** Der Lösch-Weg der gemeinsamen Fabrik aktualisierte nur die MENGE
(parentQuantitySql). Preis und Zustand der Elternzeile blieben stehen. Wer die
neueste Erfassung löschte, behielt damit deren Preis in `sets.purchase_price` —
und daraus lesen Kachel, Galerie UND Finanzübersicht.

Der ÄNDERN-Weg macht es seit jeher richtig („es gilt der Wert der neuesten
Erfassung"); der LÖSCHEN-Weg hatte diese Regel nie. Wieder „dieselbe Regel fehlt
am zweiten Weg" — diesmal zwischen zwei Zweigen derselben Datei, also auch nach
dem Zusammenlegen der Routen noch möglich. Das Zusammenlegen beseitigt die
Doppelung ZWISCHEN den Clients, nicht die zwischen Ändern und Löschen.

Fix: Nach dem Löschen wird die jetzt neueste verbliebene Erfassung bestimmt und
ihr Preis samt Zustand in die Elternzeile geschrieben. Bleibt keine übrig, wird
nichts überschrieben — dann ist der Bestand ohnehin leer.

Am laufenden Server in Marcos Lage nachgestellt: vorher Kachel 9.48 bei
verbliebener Erfassung 7.41, nachher 7.41. Test
`test/acquisition-delete-refresh-db.test.js` prüft zusätzlich die Gegenrichtung
(eine ÄLTERE Erfassung löschen darf den Preis NICHT ändern) und den Fall ohne
verbliebene Erfassung. Gegenprobe bestanden.

553 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 78 (hardened-174) — Portfoliokurve ignorierte den Kontofilter

**Marcos Fund:** „Wenn ich meinen Account wähle oder ein anderes Unterkonto,
wird immer -0,5 % angezeigt."

**Ursache.** Der Schlüssel des Portfolio-Schnappschusses hing an der ID des
BETRACHTERS (`'__portfolio__' + viewerId`). Wählte das Hauptkonto im Filter ein
Unterkonto, wurde trotzdem der eigene Schnappschuss gelesen — gleiche Kurve,
gleicher Prozentwert, egal was im Filter stand. Der Filter sah aus, als täte er
nichts, und genau so hat Marco es beschrieben.

Bei genau EINEM Konto gilt jetzt dessen Schnappschuss. Bei mehreren wird die
Kurve ohnehin aus dem Preisverlauf je Set rekonstruiert.

Nachgemessen mit zwei deutlich verschiedenen Schnappschüssen (1000 gegen 5000):
vorher zeigten beide Konten 1003→1000, nachher das Unterkonto korrekt
5003→5000. Test `test/portfolio-scope-db.test.js`, Gegenprobe bestanden.

**NOCH OFFEN — Marcos zweiter Punkt (+712 %).** Bei „Alle Konten" wird die
Kurve aus dem Preisverlauf je Set rekonstruiert, und sie beginnt am ersten Tag
bei nahezu null: Sets, für die an diesem Tag noch kein Preis aufgezeichnet war,
zählen mit 0 und kommen später dazu. Der Sprung von 0 auf ~24 000 ergibt die
712 %. Der Schnappschuss-Weg hat das Problem nicht, weil er den Gesamtwert
speichert.

Das ist eine ANDERE Ursache als der Filter-Fehler oben und braucht eine eigene
Entscheidung: führende Tage mit unvollständiger Preisabdeckung verwerfen, oder
den ersten Wert je Set rückwärts fortschreiben. Beides ändert die Kurve
sichtbar, deshalb hier bewusst NICHT im Vorbeigehen entschieden.

554 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 79 (hardened-175) — Geheimnisse, Blickfeld, und die Etappen 5 und 6

Ausgangspunkt war Marcos Frage, ob es zwischen Webapp und App noch Logik gibt,
die unterschiedlich funktioniert oder doppelt existiert. Aus der Durchsicht
sind vier Punkte umgesetzt, zwei davon Fehler.

### 1. SICHERHEITSLÜCKE: `GET /api/settings/raw` gab Geheimnisse im Klartext

`GET /api/settings/` maskiert die API-Zugangsdaten seit Langem, und der
Kommentar über `sanitizeGlobal()` erklärt genau warum: Der Router trägt nur
`requireLogin`, LESEN darf also jedes angemeldete Konto — im Haushalt auch
jedes Unterkonto.

`/raw` war eine zweite Fassung derselben Abfrage, nur anders verpackt, und
hatte die Maskierung nie bekommen. Sie spreizte `global_settings` roh, samt
`bricklink_consumer_secret`, `bricklink_token_secret`, `brickset_api_key`,
`rebrickable_api_key` und `smtp_pass`. Und ausgerechnet `/raw` ist die Route,
über die die Einstellungsseite lädt (`loadSettings()` in `05-settings.js`) —
die Maskierung war damit für ihren eigentlichen Konsumenten wirkungslos, und
die Werte landeten im Browser-Speicher, wo jede XSS-Lücke sie mitnimmt.

Fix: Beide Leserouten gehen durch `readSettings(userId, isAdmin)`. Eine neue
Verpackung kann die Maskierung nicht mehr umgehen.

Test `test/settings-secrets-db.test.js` — bewusst als REGEL über die Liste der
Leserouten, nicht als Prüfung der einen reparierten Stelle: Sonst hätte er
denselben Wert wie der bisherige Zustand. Dazu die Gegenrichtung, dass die
Maske überhaupt ankommt (sonst wäre er auch bei leerer Antwort grün).
Gegenprobe bestanden.

### 2. Kontofilter fehlte beim Minifiguren-Preisverlauf — auf BEIDEN Wegen

`conditionRows()` filtert die Erfassungen mit `user_id = ANY(...)`. Der
Set-Verlauf bekam sein Blickfeld in Nachtrag 33, das manuelle Teil in 96/97 —
die Minifigur fiel durch: Beide Routen reichten die nackte Betrachter-ID
durch. Für eine Minifigur des Unterkontos fand die Abfrage keine Erfassung,
und ohne Erfassung entsteht gar keine Zeile: Marktpreis, Kaufpreis und
Prozentangabe blieben leer, `accounts=` wirkte dort überhaupt nicht.

Weil BEIDE Routen denselben Stand hatten, war die Paritätsprüfung grün — sie
vergleicht die Clients miteinander, nicht gegen die Regel.

Nebenbefund: Der Parametertyp stand auf `number`, obwohl die Teile-Routen
längst eine Liste übergaben. Aufgefallen ist das nie, weil alle Aufrufer über
ein spätes `require()` kommen und TypeScript dort nichts prüft.

Test `test/manual-price-history-scope-db.test.js` über ALLE DREI Arten statt
nur die reparierte — genau diese Familie ist in dieser Reihe schon dreimal
einzeln aufgefallen. Gegenprobe bestanden.

### 3. Etappe 5: die Finanz-Routen zusammengelegt

Neun doppelte Routen entfernt: Bewertung (Sets/Teile/Minifiguren), GuV,
Portfolio-Verlauf und die drei Preisverlaufs-Routen. Die Rechnung lag längst
gemeinsam in `utils/financeCalc.ts`, `utils/priceHistory.ts` und
`utils/portfolioHistory.ts` — doppelt waren nur die Routen davor, und genau
dort sind die Zahlen auseinandergelaufen: zuletzt fehlte das Blickfeld beim
Minifiguren-Verlauf auf beiden Wegen (Punkt 2), und die Bewertung lieferte auf
dem einen Weg ein Feld weniger als auf dem anderen.

`/combined-valuation` ist ersatzlos entfallen: eine DRITTE Bewertungsfassung,
die weder Frontend noch App aufrief und die ausserdem mit der eigenen
Benutzer-ID statt mit `scopeIds()` arbeitete — im Haushalt hätte sie falsch
gerechnet, sobald jemand sie wieder angeschlossen hätte.

### 4. Etappe 6: Einstellungen, Haushalt, Statistik

Acht weitere Doppelungen weg: die vier Haushalts-Routen, `/stats` und die drei
Zustands-Routen. Die Auflösung „eigener Wert → globaler Standard → 'N'" stand
dreimal im Baum und steht jetzt einmal in `utils/settings.ts`
(`effectiveCondition()` / `globalDefaultCondition()`). Der v1-Schreibweg für
`user_default_condition` benutzt `setUserSetting()` statt eines eigenen
`ON CONFLICT` — die Regel „genau EINE Schreibstelle" aus Nachtrag 43 gilt nur,
wenn sie ausnahmslos gilt.

**Bewusst NICHT zusammengelegt: `GET/POST /api/settings`.** Die Route trägt die
globalen Schlüssel samt Geheimnissen und die Admin-Felder. Das ist eine ANDERE
Antwort als die kuratierte Sicht der App, keine zweite Fassung derselben — und
die App soll die Geheimnisse gar nicht erst angeboten bekommen. Der
Paritätstest sagt das jetzt ausdrücklich und prüft nur die gemeinsamen Werte.

### Tests

Sechs Gruppen umformuliert statt abgeschaltet (`household`, `household-db`,
`set-condition-aggregate`, `api-parity`, `api-inventory`). `PAIRS` in
`api-parity` ist LEER — es gibt kein Lese-Paar mehr; die Liste bleibt stehen,
damit ein künftiges Paar dort wieder auftaucht statt still ungeprüft zu
bleiben. Die alten Adressen stehen in der Gegenprobe „dürfen nicht
zurückkehren".

Seit Nachtrag 70 sind damit 47 doppelte Routen verschwunden.

561 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 80 (hardened-176) — Rechnen gehört auf den Server, die GUI zeichnet

Marcos Frage: „Kannst du sicherstellen, dass Berechnungen zentral in einer
Komponente für Webapp und Android-App durchgeführt werden, damit die GUIs nur
das Rendering übernehmen müssen?"

Beide Clients durchgesehen. Zwei Rechnungen standen noch in den Oberflächen —
und beide waren bereits auseinandergelaufen.

### 1. Die Summenzeile der Erfassungen stand VIERMAL

Zweimal in `public/js/07-admin.js` (Set-Dialog und Dialog für manuelle
Einträge), zweimal in der App (`AcquisitionManagementScreen`,
`ManualItemComposables`). Und die vier waren sich nicht einig, aus welchem Feld
der Preis kommt: Die Webapp las je nach Dialog fest `purchase_price` ODER fest
`unit_price`, die App hatte dafür eine Rückfallregel
(`purchasePrice ?: unitPrice`), die es in der Webapp gar nicht gibt. Dass die
Zahlen heute übereinstimmen, liegt allein daran, dass die Abfragen je Art nur
EINES der beiden Felder füllen — kommt einmal beides mit, zeigen die zwei
Clients Verschiedenes.

Neu: `acquisitionTotals()` in `utils/acquisitions.ts`, mitgeliefert als
`totals` an allen drei Erfassungs-Routen.

Die Regel: Die MENGE zählt über alle Zeilen — auch über die ohne Preis, denn
die Stücke sind da. Der BETRAG nur über die bepreisten. Gibt es keine einzige,
ist der Betrag `null` und nicht 0: „nichts erfasst" ist etwas anderes als „für
null Franken gekauft", und nur mit `null` kann die Oberfläche den
Gedankenstrich zeigen, ohne selbst zu raten. Ein Preis von 0 ist dagegen ein
Preis — sonst verschwände ein geschenktes Set aus der Zählung.

Auch die beiden Mengen-Schleifen für den Stückzahl-Stepper lesen jetzt dieselbe
Serversumme; sonst stünde über der Summenzeile eine zweite Zählung.

### 2. Die Kennzahlen des Minifiguren-Reiters, mit zwei Fehlern

`GET /api/minifigs/stats` zählte `COUNT(DISTINCT LOWER(TRIM(fig_number)))`, die
Liste daneben gruppiert aber nach Nummer UND Quelle: Eine Figur, die einmal aus
einem Set und einmal manuell erfasst ist, steht in der Liste zweimal und zählte
oben einmal — die Kachel widersprach der Liste darunter. Und die Abfrage las
`WHERE m.user_id = $1`, also ohne Blickfeld und ohne Kontofilter: Im Haushalt
zeigte die Kachel die eigenen Zahlen, während die Liste alle Konten zeigte, und
das Umschalten des Filters änderte oben nichts (dieselbe Klasse wie
Nachtrag 111).

Neu: `getMinifigStats()` in `utils/handlers.ts` zählt über GENAU DIESELBE
Gruppierung wie `getMinifigs()` und über dasselbe Blickfeld, erreichbar als
`GET /api/v1/minifigs/stats`. Die Webapp-Route ist entfallen.

Nachgemessen mit einem Haushalt (Set mit Menge 2 samt Figur, dazu zwei manuelle
Figuren auf beiden Konten): Kachel und Liste liefern in JEDEM Kontofilter
dieselben drei Zahlen — vorher wich die Kachel in allen drei Fällen ab.

**Achtung bei der Routenreihenfolge:** `/minifigs/stats` steht VOR
`/minifigs/:figNumber/…`, sonst nähme Express `stats` für eine Figurennummer.

### Tests

`test/acquisition-totals.test.js` prüft beides getrennt: die RECHNUNG mit ihren
Randfällen (NUMERIC kommt als Text aus Postgres, Preis 0 gegen fehlender Preis,
gemischte Zeilen, Rundung) UND die REGEL, dass keine Oberfläche sie noch einmal
anstellt. Ohne den zweiten Teil wäre der erste in dem Moment wertlos, in dem
jemand die Summe „schnell im Frontend" wieder einbaut. Beide Gegenproben
bestanden.

### Vorher-Nachher-Messung zu den Etappen 5 und 6

Der Stand hardened-174 und der neue liefen gleichzeitig gegen dieselbe
Datenbank, mit Haupt- und Unterkonto, Sets, manuellen Teilen und Minifiguren,
Kaufpreisen, Marktpreisen und Verlauf. 20 von 22 Antworten sind byte-gleich,
in jedem Kontofilter. Die zwei Abweichungen sind gewollt: Der Set-Preisverlauf
trägt zusätzlich `set_number` (das Feld hatte die v1-Route schon immer), und
der Minifiguren-Verlauf liefert jetzt `by_condition` statt eines leeren
Objekts — das ist der Fund aus Nachtrag 79.

570 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 81 (hardened-177) — Marcos zwei Entscheide

### A. „Set schon vorhanden" — die Regel steht jetzt auf dem Server

Marcos Festlegung: „Besitzt der Account oder einer der Unteraccounts das Set
bereits, soll sich nur der Detail-Dialog des Sets öffnen. Egal ob die Erfassung
via Barcodescanner, OCR oder per Nummer-Erfassung erfolgt. Einziger Unterschied:
beim Barcodescanner oder OCR erscheint auch dann ein Zwischendialog, wenn das
Set nicht vorhanden ist — um prüfen zu können, dass das richtige Set erkannt
wurde."

Vorher hing das am CLIENT: Die App prüfte seit Nachtrag 57 selbst vor dem
Anlegen, die Webapp gar nicht — dort erhöhte der Server still die Menge und
meldete „aktualisiert". Dieselbe Eingabe, zwei Ausgänge.

Neu `utils/setAdd.ts`:

* `findSetInScope(viewerId, nummer)` sucht im BLICKFELD — eigenes Konto und
  Haushalt. Bewusst scopeIds() und nicht writableIds(): Die Frage lautet „habe
  ich das schon?", und sichtbar ist sichtbar.
* Die Nummer wird VOR der Suche normalisiert. Ohne das gälte „75192" als neu,
  obwohl „75192-1" längst da ist — daran hängt die ganze Regel. Ein Test hält
  `normalizeSetNumber` und `sanitizeSetNumber` zusammen; weichen sie ab, prüft
  die Regel eine andere Nummer als die, die danach geschrieben wird.
* Bei zwei Besitzern gewinnt die EIGENE Zeile: Die Detailansicht soll die
  eigene zeigen, nicht die eines Geschwisterkontos.

Beide Erfassungs-Routen fragen sie und antworten mit `action: 'exists'`, ohne
zu schreiben. Der add-stream-Weg antwortet dabei mit gewöhnlichem JSON statt
einem Ereignisstrom — es gibt nichts zu verfolgen. `readSSE()` im Frontend
erkennt das am Content-Type und reicht die eine Antwort wie ein einzelnes
Ereignis durch; ohne diesen Zweig liefe der Leser über JSON-Text, fände keine
`data:`-Zeile und die Anzeige bliebe hängen.

Neu `GET /api/v1/sets/exists/:setNumber` für Scanner und Texterkennung: Dort
muss die Antwort VOR dem Erfassen bekannt sein, weil sie über den
Zwischendialog entscheidet. Die App las das bisher aus dem FEHLER von
`GET /sets/:nummer` — das vermischt „nicht vorhanden" mit „nicht erreichbar".

**Ausdrücklich ausgenommen: der CSV-Import.** Er ruft addSet() direkt und fasst
weiterhin zusammen; wer 500 Zeilen einliest, will keine 500 Rückfragen. Die
Regel hängt deshalb an den INTERAKTIVEN Routen, nicht in addSet(). Der Test
prüft das mit — sonst schöbe ein späterer Umbau sie hinein und legte den Import
still lahm.

Am laufenden Server nachgemessen, mit einem Set des UNTERKONTOS und der Eingabe
ohne Suffix: Beide Wege antworten 200 mit `action=exists`, nennen das
Unterkonto als Besitzer, und die Menge bleibt bei 1. Die Vorabfrage sagt
dasselbe. Test `test/set-add-exists-db.test.js`, Gegenprobe bestanden (ohne den
Zweig: `action=updated`, Menge 1 → 2).

### B. Galerie-Filter serverseitig — auch in der App

Marcos Vorgabe: „Beide Apps sollen den Filter auf dem Server anwenden. Passt
zur vorherigen Frage, dass Logiken immer zentral sein sollen."

Der Server konnte das längst; die App holte trotzdem alles und filterte im
Gerät. Diese zweite Fassung konnte weniger: kein Jahr im Suchtext (die Webapp
findet mit „2019" die Sets des Jahres), keine Sortierung, und die Themenliste
entstand aus der geladenen Liste statt aus dem Bestand.

Serverseitig war nur eine Notiz zu korrigieren: Der Kommentar „die Android-App
sendet kein page_size" stimmte nicht mehr. Ein Test pinnte seinen Wortlaut und
wurde rot — er prüft jetzt die AUSSAGE (die Route reicht alle vier Parameter
durch) statt einen Satz. Dieselbe Sorte Test, die in Durchgang 118 eine
Sicherheitslücke festgeschrieben hat.

572 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 82 (hardened-178) — Die Portfolio-Kurve mass Zukäufe statt Preise

### Marcos Befund

„Die Berechnung scheint nicht korrekt zu sein. Neu hinzugefügte Sets sollen
nicht dazu führen, dass sich der %-Wert ändert. Die +850.2% sind offensichtlich
nicht korrekt."

Auf seinem Bild: 26 Sets, davon 24 am selben Tag erfasst, Kopfzeile +850,2 % —
und direkt darunter die Kachel „Gesamt G&V" mit −2,8 %. Zwei Zahlen über
dieselbe Sammlung, die einander widersprechen.

### Ursache

Die Kurve zeigte „Wert dessen, was zu diesem Zeitpunkt erfasst WAR". Ein Set
trat an dem Tag in die Summe ein, an dem sein Preisverlauf begann. Wer an einem
Tag zwei Dutzend Sets erfasst, sieht dort einen Sprung — und die Prozentzahl,
die den ersten Punkt mit dem letzten vergleicht, meldet den Zuwachs der
SAMMLUNG als Wertentwicklung.

Nachgestellt (2 Sets seit einer Woche, 24 gestern dazu, Preise leicht FALLEND):
**+264,24 %**. Nach dem Fix: **−0,18 %** — die tatsächliche Preisbewegung.

### Die neue Bedeutung

Die Kurve zeigt jetzt „was der HEUTIGE Bestand über die Zeit wert gewesen
wäre". Ein Set, dessen Preisverlauf später beginnt, wird mit seinem ERSTEN
bekannten Preis zurückgeschrieben: Es steht von Anfang an im Korb und trägt zur
Veränderung nichts bei, bis sich sein Preis wirklich bewegt. Das ist die
einzige Lesart, in der die Prozentzahl etwas über Wertentwicklung aussagt statt
über Kaufverhalten.

In SQL: Der Ersteintrag eines Sets wird auf den Anfang der Reihe umgehängt
(`CASE WHEN vortag IS NULL THEN erstes_bucket`). Die Beschriftungen kommen
seither aus einer eigenen CTE — ein `max(tag)` über umgehängte Zeilen hätte dem
ersten Punkt ein späteres Datum gegeben. Der price_cache-Rückfall und die
Startpunkt-Korrektur der Monatsauflösung machen dasselbe.

### Der Schnappschuss-Weg ist entfallen

Der Preis-Job legte je Konto und Tag einen Gesamtwert unter dem Pseudo-Set
'__portfolio__<id>' ab; für ein einzelnes Konto las die Kurve daraus. Ein
Schnappschuss hält fest, was AN JENEM TAG erfasst war — die Frage „was wäre der
heutige Bestand damals wert gewesen" lässt sich daraus grundsätzlich nicht
beantworten. Marcos Bild zeigte ein Unterkonto, also genau diesen Weg.

Es war ausserdem eine ZWEITE Fassung derselben Kurve: Ein einzelnes Konto bekam
eine anders gerechnete Linie als ein Haushalt, und beim Wechsel des
Kontofilters sprang die Form. Schreiber und Aufbewahrungs-Ausnahme sind mit
entfernt; gespart wird nebenbei eine price_cache-Abfrage je Set und Konto bei
JEDEM Preislauf.

### Zweiter Fund: die Zeiträume waren sich uneinig

Bei kurzer Historie fällt der ganze Verlauf in EINEN Monatsabschnitt. Die
Monatsauflösung von „Jahr" und „Max" ergab damit genau einen Punkt und meldete
0 %, während „Woche" auf denselben Daten +102,86 % auswies. Gleiche Sammlung,
vier Knöpfe, zwei Antworten. Liefert die Monatsabfrage weniger als zwei Punkte,
wird jetzt auf Tagesauflösung zurückgeschaltet.

### Was der Fix NICHT behauptet

Dass die Zahl bei einem Zukauf exakt stehen bleibt. Gemessen: zwei Sets mit
+10 % ergeben +10 %; kommen 24 unbewegte dazu, sind es +1,43 %. Das ist
Verwässerung, kein Fehler — die 24 gehören ab jetzt zum Bestand und haben sich
nicht bewegt. Die Prozentzahl ist der gewichtete Mittelwert der
Preisbewegungen; sie kann durch Zukäufe nicht steigen und das Vorzeichen nicht
drehen. Wer die HISTORISCHE Rendite unverändert lassen will, braucht eine
verkettete Tagesrendite über die jeweils an beiden Tagen gehaltenen Sets — eine
andere Kennzahl und eine eigene Entscheidung.

### Tests

Neu `test/portfolio-additions-db.test.js`: Zukäufe erhöhen die Prozentzahl
nicht, drehen kein Vorzeichen, und keine Summe zeigt mehr, als sich ein
einzelnes Set bewegt hat; Preisbewegungen zeigen sich weiterhin; die vier
Zeiträume sind sich einig. Gegenprobe bestanden (ohne Rückschreibung: 10 →
610 %).

Drei bestehende Gruppen umformuliert statt abgeschaltet: die Vergleichsfassung
in `portfolio-history-db` bildet jetzt die NEUE Regel ab (Unterschied ist die
Vorbelegung von `carry`), `portfolio-scope-db` prüft die Kontotreue an den
Beständen statt an Schnappschüssen, und die Aufräum-Prüfung verlangt, dass alte
Schnappschuss-Zeilen jetzt mit wegkommen.

573 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 83 (hardened-179) — Diagramm und Besitzer-Label folgen dem Bestand

Zwei Befunde von Marco am Set 60481-1, beide serverseitig behoben und damit in
Webapp und App zugleich wirksam.

### 1. Das Diagramm zeigte einen Zustand, den es im Bestand nicht gibt

„Das Diagramm sollte nur den Wert der eingetragenen Status anzeigen. In diesem
Fall ist nur ein gebrauchtes. Somit sollte der Verlauf von Neu nicht angezeigt
werden."

Die Regel gab es bereits — ein paar Zeilen weiter unten, für `by_condition`:
Eine Zeile erscheint nur, wenn für diesen Zustand auch eine Erfassung
existiert. Der Diagramm-Aufbau stand DAVOR und kannte sie nicht; er nahm immer
beide Reihen. Dieselbe Regel, zwei Stellen, eine davon vergessen — dasselbe
Muster wie schon mehrfach in dieser Reihe. Der Aufbau steht jetzt hinter der
Stelle, die weiss, was im Bestand liegt.

Es hing mehr daran als die Legende: In der App speisen sich „Tief", „Aktuell"
und „Hoch" aus den Diagrammwerten. Bei einem nur gebraucht vorhandenen Set
standen dort die Neupreise (3.94 / 7.99 / 7.99), während die Zeile darüber
korrekt CHF 3.94 auswies — zwei Antworten auf dieselbe Frage, untereinander.

Ohne JEDE Erfassung bleibt der Zustand des Bestandes übrig: Ein Set ohne
erfassten Kaufpreis hat trotzdem einen Marktwert, und ein leeres Diagramm wäre
schlimmer als eine Reihe zu viel. Der Test prüft beide Richtungen.

### 2. Ein Konto ohne Exemplar stand weiter als Besitzer auf der Kachel

„Ich habe den Kaufpreis für den Marco gelöscht. Somit sollte auch das Label auf
der Kachel von Marco nicht mehr angezeigt werden."

Beim Löschen der letzten Erfassung setzt `parentQuantitySql` die Menge auf 0
und lässt die sets-Zeile stehen — bewusst, denn 0 ist ein gültiger Zustand
(Mengenregler). `array_agg(DISTINCT s.user_id)` nahm sie trotzdem mit.

Jetzt mit `FILTER (WHERE s.quantity > 0)`. Hält das Konto wieder ein Exemplar,
kommt das Label zurück; der Test prüft auch das, sonst wäre er bei einem ganz
verschwundenen Label ebenfalls grün.

### Tests

Neu `test/holdings-display-db.test.js` mit fünf Teilschritten in Marcos
Konstellation (Hauptkonto Menge 0 ohne Erfassung, Unterkonto ein gebrauchtes
Exemplar, Preisverlauf für BEIDE Zustände — der Preis-Job schreibt sie
unabhängig vom Bestand). Beide Gegenproben bestanden.

Zwei bestehende Prüfungen umformuliert: Die Haushalts-Regel nagelt jetzt das
`FILTER` mit fest, und `set-value` verlangte wörtlich `buildChart([` — der
Set-Verlauf übergibt seit diesem Nachtrag eine ZUSAMMENGESTELLTE Liste statt
eines festen Arrays. Diese Prüfung hätte die Verbesserung verhindert, ohne
etwas Zusätzliches zu sichern; sie zählt jetzt die Aufrufe statt die Klammer.

579 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 84 (hardened-180) — Der Geistereintrag nach dem Löschen eines Kaufpreises

Marcos Frage: „Gibt es noch ein Problem, wenn ein Kaufpreis entfernt wird, dass
der Eintrag noch sichtbar war?"

Ja — das Besitzer-Label aus Nachtrag 83 war nur die Spitze. `parentQuantitySql`
setzte die Menge auf 0 und liess die Elternzeile stehen. Nachgemessen mit einem
einzelnen Konto und zwei Sets, bei einem davon der Kaufpreis gelöscht:

| | vorher | nachher |
|---|---|---|
| Galerie | beide Sets, das leere mit „Menge 0" | nur das echte |
| Statistik | Sets=2, Einheiten=1 | Sets=1, Einheiten=1 |
| Bewertung | das leere Set **mit ×1**, Summe 40.00 | nur das echte, Summe 20.00 |

Der letzte Punkt ist der eigentliche Schaden: `set.quantity || 1` in
utils/financeCalc.ts macht aus einer Menge von 0 eine 1. Als Schutz gegen NULL
gedacht, trifft es den echten Wert 0 — das Portfolio wuchs um ein Set, das
niemand mehr besitzt. Dieselbe Verwechslung steckt an achtzehn Stellen in
dieser Datei.

### Warum die Ursache und nicht die achtzehn Stellen

Achtzehn `|| 1` einzeln zu reparieren hiesse, achtzehnmal dieselbe Regel zu
pflegen — und die neunzehnte wird vergessen. Stattdessen entsteht eine Menge
von 0 gar nicht mehr.

Sie war ohnehin kein Zustand, den jemand absichtlich herstellen kann: Beide
Mengenregler halten bei 1 (`min="1"` in der Webapp, `if (qty > 1)` in der App).
Sie entstand ausschliesslich beim Löschen der letzten Erfassung.

Neu `cleanupWhenEmpty` in der Erfassungs-Fabrik: Bleibt nach dem Löschen keine
Erfassung übrig, verschwindet die Elternzeile — in DERSELBEN Transaktion, sonst
bliebe bei einem Abbruch genau der Geistereintrag zurück, den das verhindern
soll. Für Sets gehen Teile und Minifiguren des Sets mit; sonst stünden sie ohne
Set in Teileliste und Finanzsummen.

Die Löschliste steht dafür jetzt EINMAL in utils/handlers.ts
(`deleteSetRows`) und wird von beiden Anlässen benutzt — ausdrückliches Löschen
und Wegfall der letzten Erfassung. Zwei Listen wären genau die Doppelung, an
der in dieser Reihe schon mehrfach eine Regel nur an einer Stelle nachgezogen
wurde.

### Nebenbefund: eine tote Zeile in updateSetQuantity

`asIds()` normalisierte die Kennung, das Ergebnis wurde aber nicht benutzt —
`ANY($2)` bekam den rohen Parameter. Mit einer nackten Zahl statt eines Feldes
bricht die Abfrage ab, und die Mengenänderung fiel still aus. Jetzt `uids`.

### Tests

Neu `test/empty-holding-cleanup-db.test.js` mit sechs Teilschritten, bewusst
über die API statt über die Funktion — genau dazwischen sass der Fehler: Die
Erfassung war gelöscht, die Elternzeile blieb. Geprüft werden Galerie,
Statistik, Bewertung und die Datenbankzeilen, dazu zwei Gegenrichtungen: Ein
zweites Set bleibt unberührt, und das Löschen EINER von mehreren Erfassungen
ändert nichts am Bestand. Gegenprobe bestanden (ohne cleanupWhenEmpty werden
vier Teilschritte rot).

`acquisition-delete-refresh-db` nagelte „Ohne Erfassungen ist die Menge 0"
fest — genau den Zustand, der jetzt nicht mehr entstehen soll. Umformuliert:
Es darf keine Zeile zurückbleiben.

586 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 85 (hardened-181) — Anzahl: Anzeige = Haushalt, Änderung = eigenes Konto

Marcos Vorgabe: „Die Anzahl soll immer von allen angezeigt werden. Wenn ich
diese erhöhe, soll es für meinen Account einen neuen Kaufpreis-Eintrag
erstellen. Analog der bestehenden Logik. Jeweils die Logik im Server
implementieren."

### Zwei Stellen, die sich widersprachen

**Das Detail** las `SELECT * FROM sets WHERE user_id = ANY(blickfeld)` und nahm
IRGENDEINE Zeile — welche, entschied die Reihenfolge in der Tabelle. Daher
Marcos „Anzahl 0" für ein Set, von dem das Unterkonto ein Exemplar hält. Die
LISTE summierte längst (getSets gruppiert für Haushalte); nur das Detail nicht.
Dieselbe Frage, zwei Antworten.

**Die Änderung** schrieb auf den Besitzer eben dieser Zeile. Nachgemessen mit
einem Set, das nur das Unterkonto hält: `PUT quantity=2` machte daraus
`Alessio=2` — der eigene Bestand blieb bei 0, und die neue Erfassung entstand
in einem fremden Konto.

### Die Regel

Angezeigt wird die Summe über das Blickfeld. Gesendet wird eine Gesamtmenge;
geschrieben wird die DIFFERENZ, und zwar auf das eigene Konto. Fehlt dort noch
eine Zeile, wird sie angelegt (Stammdaten aus der vorhandenen).

Nach unten bei den eigenen Exemplaren gedeckelt: Die eines anderen Kontos sind
nicht meine. Die Antwort trägt deshalb die TATSÄCHLICHE Gesamtmenge zurück —
sonst liesse die Oberfläche eine Zahl stehen, die es nicht gibt.

Bleibt das eigene Konto bei 0, verschwindet die eigene Zeile ganz — dieselbe
Regel wie beim Löschen des letzten Kaufpreises (Nachtrag 84), sonst entstünde
hier wieder ein Eintrag mit Menge 0.

„Analog der bestehenden Logik" heisst wörtlich dieselbe Funktion:
`adjustAcquisitionsToQuantity()` legt die Erfassung an, holt den Marktpreis
über `priceForNewAcquisition()` und beachtet die Tagesregel — unverändert, nur
mit dem eigenen Konto als Ziel.

Gemessen, Ausgangslage „nur das Unterkonto hält 1":

    +1        Marco=1 Alessio=1, Erfassung Marco ×1 U 3.94   Gesamt 2
    +2        Marco=3 Alessio=1                              Gesamt 4
    auf 1     Marco weg, Alessio=1                           Gesamt 1
    auf 0     unverändert (gedeckelt)                        Gesamt 1

### Nebenbefund: der Preisplan wurde ignoriert

`adjustAcquisitionsToQuantity()` nahm für die ERSTE Erfassung eines Kontos den
Preis aus der sets-Zeile und liess den übergebenen Plan liegen. Solange die
Zeile einen Kaufpreis hatte, fiel das nicht auf. Seit die Mengenänderung eine
FRISCHE Zeile im eigenen Konto anlegen kann, fiel es sofort auf: Die Erfassung
entstand ohne Preis. Jetzt gilt der Preis der Zeile als Vorgabe und der
Marktpreis springt ein, wenn dort keiner steht.

Der Test hält ausdrücklich fest, dass es der MARKTPREIS ist (77) und nicht der
Kaufpreis des anderen Kontos (108) — dessen Kauf ist nicht meiner.

### Tests

Neu `test/set-quantity-household-db.test.js` mit fünf Teilschritten über die
API: Anzeige, Erhöhen mit Preis und Zustand, Tagesregel beim zweiten Erhöhen,
Verringern zuerst am eigenen Bestand, Deckelung nach unten. Gegenprobe
bestanden.

`set-quantity-scope-db` verlangte bisher das GEGENTEIL — „es darf KEINE
Erfassung im Konto des Betrachters entstehen" (Nachtrag 52). Umformuliert auf
die neue Regel; was bleibt, ist die Aussage von damals: kein 404, und die
Änderung wirkt. Zwei quelltextlesende Prüfungen in `manual-acq-refresh` nannten
`ownerId` wörtlich und wurden auf `uid` gezogen; dazu neu die Forderung, dass
die Ausgangsmenge über das Blickfeld SUMMIERT wird.

592 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 86 — Aufräum-Skripte für die Altbestände mit Menge 0

Der Fix aus hardened-180 verhindert NEUE Geistereinträge. Für die, die schon in
der Datenbank liegen, gibt es jetzt zwei Skripte unter `scripts/`:

* `befund-menge-null.sql` — reines Lesen. Zeigt je Konto, welche Zeilen
  betroffen sind, was daran hängt und wie viele es insgesamt sind.
* `korrektur-menge-null.sql` — die Bereinigung, in EINER Transaktion.

Die Trennung ist Absicht: Ein Skript, das löscht, sollte man vorher gelesen
haben, und die Ausgabe des Befunds sagt genau, was passieren wird.

### Zwei Fälle, zwei Behandlungen

**Reparieren**, wenn zu einer Zeile mit Menge 0 noch Erfassungen gehören: Die
Menge bekommt deren Summe. Hier geht nichts verloren, die Zahl stand nur falsch.

**Löschen**, wenn Menge 0 UND keine Erfassung. Bei Sets gehen die daran
hängenden Teile, Minifiguren und Erfassungen mit — dieselben vier Tabellen wie
beim regulären Löschen (`deleteSetRows`).

### Die gefährliche Zeile, die es NICHT anfasst

Ein Set aus einem alten Import kann eine Menge OHNE Erfassungen haben. Würde
das Skript pauschal `quantity = SUM(acquisitions)` setzen, käme dort 0 heraus
und ein echter Bestand wäre vernichtet. Deshalb steht `quantity <= 0` in JEDER
Bedingung — positive Mengen werden nie berührt.

Die Geisterliste wird ausserdem einmal in einer Temp-Tabelle festgehalten und
von allen vier DELETEs benutzt. Werteten sie ihre Bedingung je selbst aus,
hätte das erste (auf `sets`) den folgenden bereits die Grundlage entzogen und
die Teile blieben liegen.

### Gemessen

An einer Bühne mit sechs Fällen: Geist mit abgeleiteten Teilen, Zeile mit
Mengendrift, gesundes Set, Altimport mit Menge 3 ohne Erfassung, manuelles Teil
und manuelle Minifigur mit Menge 0.

    Probelauf (ROLLBACK)  meldet die Änderungen, ändert nichts (2 Zeilen bleiben)
    echter Lauf           Geist weg samt Teil und Minifigur; Drift 0 -> 2;
                          manuelles Teil 0 -> 5; gesundes Set und Altimport
                          unberührt
    zweiter Lauf          keine einzige Zeile mit Wirkung (idempotent)

## Nachtrag 87 (hardened-183) — Beide Oberflächen lesen die Menge aus der Antwort

Nachgezogen, was in Nachtrag 85 offenblieb: Der Server liefert seit dort die
tatsächliche Gesamtmenge in der PUT-Antwort — gelesen hat sie niemand.

Das fällt beim VERRINGERN auf. Angezeigt wird die Menge aller Konten,
geschrieben wird die Differenz auf das eigene; unter den eigenen Bestand
deckelt der Server, weil fremde Exemplare nicht wegzunehmen sind. Beide Regler
zählen ihre Zahl vorher hoch und schicken sie. Ohne die Übernahme stand danach
die eigene Annahme auf dem Bildschirm, bis jemand die Ansicht neu öffnete: Der
Server hat recht, die Oberfläche zeigt etwas anderes, und niemand merkt es.

* **Webapp** (`autosaveSet`): übernimmt `d.quantity`, korrigiert das
  Eingabefeld und merkt sich die BESTÄTIGTE Zahl statt der gesendeten. Die
  Erfassungsliste wird jetzt anhand der bestätigten Menge nachgeladen — bei
  einer gedeckelten Änderung hätte der alte Vergleich sie sonst umsonst geholt.
* **App**: `GenericResponse.quantity` (nullable), Übernahme in den Zustand VOR
  dem Nachladen — der Abruf läuft ohnehin gleich, aber er braucht eine
  Rundreise, und genau in der Zeit sieht man die falsche Zahl. Der Mengenregler
  hängt sein `remember` jetzt an `set.setNumber` UND `set.quantity`; hinge es
  nur an der Nummer, behielte er seinen alten Wert, obwohl der Zustand längst
  korrigiert ist.

Der Rückfall ist absichtlich lautlos: Fehlt das Feld, gilt die gesendete Zahl
wie bisher. Ein älterer Server soll keine Fehlermeldung erzeugen.

### Tests

Neu `test/quantity-response-echo.test.js`: Die Webapp liest das Feld und merkt
sich nicht die gesendete Zahl; und die Route liefert es überhaupt — inklusive
der Forderung, dass die zurückgegebene Menge über das Blickfeld SUMMIERT ist.
Gerade weil der Rückfall lautlos ist, braucht es diese zweite Prüfung: Ohne sie
könnte das Feld serverseitig verschwinden und beide Clients fielen still auf
ihre Annahme zurück.

In der App dazu ein Teilschritt in `ServerComputedValuesTest`: Modellfeld
vorhanden, Übernahme vor dem Nachladen, Regler an die Menge gekoppelt.

Diese Lücke ist in dieser Reihe die dritte ihrer Art — die Verschiebe-Zahlen
und das Zustands-Aggregat lieferte der Server ebenfalls seit jeher mit, und die
App las sie nie.

594 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 88 (hardened-184) — Eine Rückfrage beim Löschen; Mengen nachgemessen

Marcos Befund: „Wenn ich in der Webapp ein Set lösche, erscheinen 2 Rückfragen.
In beiden Fällen soll nur eine Rückfrage erscheinen und das Set direkt gelöscht
werden inkl. Teile und Minifiguren."

### Die zweite Rückfrage

Der Löschknopf im Detail-Dialog fragte selbst nach und rief danach `delSet()`,
das ein zweites Mal fragte. Von der Kachel und aus der Listenzeile kam nur eine
— dieselbe Handlung, drei Einstiege, zwei verschiedene Erlebnisse.

Die Rückfrage steht jetzt NUR in `delSet()`, an der einen Stelle, die auch
löscht. Sie nennt weiterhin den Namen, wenn er bekannt ist (das war der einzige
Vorzug der Extra-Rückfrage im Dialog), und `delSet()` gibt zurück, ob wirklich
gelöscht wurde — der Dialog schliesst nur dann, sonst stünde er nach einem
„Abbrechen" leer da.

Nebenbei: Nach dem Löschen fehlte `loadStats()`. Die Kennzahlen im Kopf blieben
auf dem alten Stand, obwohl die Teile und Minifiguren des Sets mit weg sind.

Serverseitig war nichts zu tun — `deleteSetRows()` räumt Set, Teile,
Minifiguren und Kaufpreise in einer Transaktion ab. Der Test prüft es jetzt
ausdrücklich.

### Die Mengen — hier war NICHTS zu reparieren

Nachgemessen mit einem Set aus 10 Teilen und 1 Minifigur:

    Menge 1 → Teile 10, Minifiguren 1
    Menge 3 → Teile 30, Minifiguren 3
    zurück  → Teile 10, Minifiguren 1

Und zwar in allen vier Abfragen: Kennzahlen, Teileliste, Minifigurenliste und
Minifiguren-Kennzahlen. Die Teile liegen mit ihrer Menge JE EXEMPLAR in der
Tabelle; multipliziert wird beim LESEN. Der Test hält auch das fest — stünde in
der Zeile die multiplizierte Menge, rechnete die nächste Änderung auf einem
schon multiplizierten Wert weiter.

Der stille Kandidat war die Zusammenfassungstabelle (utils/partsSummary.ts),
die vorberechnete Mengen hält. Ihre Versionszähler hängen an `parts` UND
`sets` — fiele `sets` weg, bliebe die Teilezahl nach einer Mengenänderung
stehen, ohne dass irgendetwas falsch aussähe. Der Test nagelt das fest;
Gegenprobe durchgeführt.

600 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 89 (hardened-185) — Teile-Symbol überall; Grundlage für den Jahres-Sprung

### 1. Das Puzzleteil-Emoji ist weg

Marco: „Kannst du das rot markierte Icon ersetzen durch das Teileicon? Bitte
vollständig und überall."

Es war 🧩 — ein Puzzleteil, das mit LEGO nichts zu tun hat und dessen
Darstellung ausserdem an der Schriftart des Geräts hängt. Ersetzt durch das
Teile-Symbol, das die Anwendung ohnehin schon führt (PARTS_ICON_SVG in der
Webapp, ic_parts_bricks in der App — dasselbe Bild wie im Reiter „Teile").

Fünf Stellen in der Webapp: Katalog-Kachel, Platzhalter der Teile-Kachel,
Platzhalter in der Teileliste, Knopf „Teile neu importieren" in der Listenzeile
und der Fortschritts-Schritt in index.html. Zwei in der App: Katalog-Kachel und
Platzhalter der Teileliste. Das Figuren-Emoji daneben bleibt — dafür gibt es
kein eigenes Symbol.

### 2. GET /api/v1/catalog/year-offset

Marcos zweite Vorgabe: „Im Katalog die Zeitleiste rechts anpassen. Diese soll
nicht ein Filter sein, sondern zum Schnellscrollen verwendet werden können."

Der Unterschied ist wesentlich: Ein Filter WIRFT die anderen Jahre weg. Ein
Schnell-Scroll springt nur hin — davor und danach bleibt alles erreichbar.

Dafür muss jemand wissen, an welcher STELLE der Liste ein Jahr beginnt. Der
Katalog hat rund 25 000 Sets und wird seitenweise geliefert; die Clients kennen
immer nur die geladenen Seiten. Die Antwort kann nur die Datenbank geben — und
beide Oberflächen sollen dieselbe Stelle treffen.

Die neue Route zählt mit DENSELBEN Filtern und DERSELBEN Sortierung wie die
Liste und liefert `offset`, `page` und `total`. Ein Jahr, das es (durch Filter
oder Lücke) nicht gibt, bekommt den nächsten erreichbaren Platz — springen soll
immer etwas.

Nachgemessen an 135 Sets über 27 Jahre: In allen fünf geprüften Kombinationen
landet der Sprung auf der ERSTEN Zeile des Jahres, und die Zeile davor gehört
noch zum Nachbarjahr. Der Test prüft genau das, statt eine Zahl festzunageln —
„offset ist 30" hätte jede Verschiebung um eins mitgemacht.

609 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 90 (hardened-186) — Katalog der Webapp: Jahres-Leiste statt Schieber

Der Rest von Marcos Vorgabe, nachdem die App in Nachtrag 86 umgestellt war:
„Dies bitte sowohl in der Android-App als auch in der Webapp umsetzen. Der
Slider in der Webapp kann dann entsprechend entfernt werden."

### Fensterladen statt Endlos-Scroll

Derselbe Umbau wie in der App, und aus demselben Grund: Mit einer angehängten
Liste kann eine Leiste nirgendwohin springen — wer auf 2005 zielt, landet mitten
im Bestand, und dort ist nichts geladen. Deshalb KONNTE der Schieber bisher nur
filtern.

Die Liste führt jetzt einen Block je Seite über das GANZE Ergebnis. Geladen wird
der Block, der ins Bild kommt — vorwärts wie rückwärts, über einen
IntersectionObserver auf ALLEN Blöcken statt eines Sentinels am Ende. Nicht
geladene Blöcke halten ihre Höhe mit Platzhaltern frei; ohne das verschöbe sich
beim Nachladen alles darunter und ein Sprung landete daneben.

Entfallen: `loadCatalogMore()`, der Sentinel und der Nachlade-Spinner.

### Die Leiste

Schmale Spur am rechten Rand, beim Ziehen ein kleines Etikett mit dem Jahr —
dieselbe Gestalt wie in der App. Sie erscheint nur bei Jahres-Sortierung: Bei
„Name A–Z" liegen die Jahre verstreut, ein Sprung wäre dort sinnlos.

Wohin gesprungen wird, rechnet der Server (`/api/v1/catalog/year-offset`, aus
Nachtrag 89) — mit denselben Filtern und derselben Sortierung wie die Liste.
Beide Oberflächen benutzen dieselbe Route und treffen damit dieselbe Stelle.

Der Von-Bis-Schieber ist weg, samt seinen fünf Hilfsfunktionen und dem
CSS-Block. Der ausdrückliche Jahresfilter über die beiden Auswahlfelder BLEIBT —
Marco wollte die Leiste anders, nicht das Filtern abschaffen. Genau dieselbe
Aufteilung wie in der App (dort Chip und Auswahlblatt).

### Test

`catalog-frontend` war ganz um den Schieber gebaut und ist auf die neuen Regeln
umgeschrieben: Seitenblöcke mit Platzhaltern, Nachladen über den Block statt
über einen Sentinel, keine Doppelabrufe, der Jahresfilter wirkt weiterhin — und
für den Sprung die entscheidende Prüfung: Danach ist die Liste NICHT gefiltert
und alle Jahre bleiben erreichbar. Das Mini-Backend im Test beantwortet
`year-offset` mit derselben Regel wie der Server.

Zwei Gegenproben: ohne die Doppelabruf-Sperre und ohne Platzhalter wird der Test
rot.

609 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 91 (hardened-187) — Etappe 7 (Admin) und ein echter Scrollbalken

### 1. Die Admin-Familie war noch doppelt

Marcos Frage „Nutzen die beiden Apps nach wie vor die gleichen APIs?" hat eine
Lücke aufgedeckt, die ich nach Etappe 6 zu vollmundig als erledigt gemeldet
hatte: Cache-Statistik, Cache-Dauer, Preis-Job und der globale Standard-Zustand
standen weiter je zweimal da — einmal unter /api/settings bzw. /api/finance,
einmal unter /api/v1/admin.

Sie fielen nicht auf, weil das Inventar sie als `nur-web` und `nur-v1` führte:
Der Paritätstest prüft nur, was als PAAR deklariert ist. Derselbe blinde Fleck
wie beim Minifiguren-Preisverlauf.

Und sie waren bereits auseinandergelaufen: `/api/finance/cache-stats` lieferte
`db_pool`, `/api/v1/admin/cache-stats` nicht.

Zusammengelegt, alles unter /api/v1/admin:

* `cache-stats` — mit `db_pool`, sonst verlöre die Überwachungsseite die
  Pool-Anzeige
* `job-status` (neu) als Gegenstück zu `trigger-price-job`
* `cache-clear` (neu, `{all:true}` für Teile- und Katalog-Caches) — ersetzt
  `/api/finance/refresh` und `/refresh-all`
* `cache-ttl`, `default-condition`

Acht Webapp-Routen entfernt. Damit sind seit Nachtrag 70 **55 doppelte Routen**
verschwunden.

**Nebenbefund: zwei tote Aufrufe.** Die Webapp rief
`POST /api/admin/brickset-queue/:nr/retry` und `DELETE /api/admin/…` — diese
Adressen gibt es serverseitig gar nicht (die Routen liegen unter /api/v1/admin).
Beide Knöpfe der Überwachungsseite liefen also ins Leere. Ein Aufruf daneben, in
derselben Datei, zeigte korrekt auf `/v1/…` — dieselbe Handlung, zwei
Schreibweisen. Korrigiert.

Ein quelltextlesender Test verlangte `await triggerNow()` in `routes/finance.ts`
UND `routes/api_v1/admin.ts` — die Doppelung, bei der eine Seite das `await`
verlieren kann, ohne dass es auffällt. Jetzt nur noch die eine Stelle.

### 2. Der Katalog-Scrollbalken

Marco: „Ich hätte diesen gerne als Scrollbalken im Fenster (der normale
Scrollbalken vom Browser soll nicht ersichtlich sein)."

Meine erste Fassung war eine Jahres-Leiste zum Springen — nicht, was gemeint
war. Jetzt rollt die Liste in IHREM Bereich (`#cat-scroller`), und der Balken
rechts ist dessen echter Scrollbalken, nur selbst gezeichnet: Griffgrösse und
-lage folgen dem Rollzustand, beim Ziehen steht das Jahr als Etikett daneben.
Der Balken des Browsers ist ausgeblendet (Firefox, WebKit und altes Edge),
sonst stünden zwei nebeneinander.

Das Jahr im Etikett wird aus der obersten SICHTBAREN Kachel gelesen — dafür
tragen die Kacheln jetzt `data-year`. Nur für noch ungeladene Bereiche wird
linear geschätzt; dort weiss der Browser es nicht. Eine rein lineare Rechnung
wäre falsch, sobald ein Jahr mehr Sets hat als ein anderes.

Wichtig dabei: Der Beobachter, der die Seiten nachlädt, misst jetzt gegen
`#cat-scroller` statt gegen das Browserfenster. Ohne `root` käme beim Rollen
INNERHALB des Bereichs nie eine Seite nach.

`springeZuJahr()` ist entfallen — Ziehen IST Scrollen. Die Route
`/api/v1/catalog/year-offset` bleibt: Die Android-App springt weiterhin, dort
gibt es keinen Balken zum Ziehen.

609 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 92 (hardened-188) — Scrollbalken für die ganze Anwendung; Nachladen repariert

Marcos Meldung: „Wenn ich nach unten scrolle, erscheinen keine Einträge. Bitte
den Scrollbalken nach rechts verschieben — der rechte ist der vom Browser, der
durch den eigenen ersetzt werden soll. Gerne gleich in der ganzen App."

Beides hing an derselben Fehlentscheidung aus Nachtrag 91.

### Der Fehler

Ich hatte für den Katalog einen EIGENEN Scrollkasten gebaut (`#cat-scroller`).
Zwei Folgen:

1. Der Balken sass mitten im Fenster statt am Rand — daneben stand weiter der
   des Browsers. Genau das, was Marco rot eingekreist hat.
2. Der Beobachter, der die Seiten nachlädt, mass gegen DIESEN Kasten
   (`root: #cat-scroller`). Wo das nicht griff, kam beim Scrollen nach unten
   nichts nach: leere Fläche statt Kacheln.

### Jetzt

Die Liste rollt wieder mit der SEITE. Den Balken zeichnet die Anwendung selbst,
für die ganze Seite: `#app-scrollbar`, fest am rechten Fensterrand, Griffgrösse
und -lage aus dem Rollzustand. Der Balken des Browsers ist per CSS ausgeblendet
(Firefox, WebKit, altes Edge) — sonst stünden zwei nebeneinander.

Er beobachtet die Seitenhöhe mit einem `ResizeObserver`: Beim Nachladen von
Kacheln wächst die Seite, ohne dass gerollt wird — ohne das bliebe der Griff auf
seiner alten Grösse.

Das Etikett neben dem Griff füllt, wer es braucht. Der Katalog trägt über
`setScrollLabel()` eine Funktion ein, die das Jahr an der aktuellen Stelle
liefert; ausserhalb bleibt es leer und der Balken ist ein gewöhnlicher
Scrollbalken. Bei „Name A–Z" meldet der Katalog gar nichts an — dort liegen die
Jahre verstreut.

### Zweiter Weg zum Nachladen

Neben dem Beobachter rechnet `_ladeSichtbareSeiten()` aus den Blockpositionen,
was gerade (oder fast) im Bild ist — beim Aufbau, nach jedem Füllen und
unabhängig davon, ob der Beobachter greift. Genau diese Absicherung fehlte, und
genau deshalb blieb die Liste leer.

### Test

`catalog-frontend` auf die neue Aufteilung umgeschrieben: Browser-Balken
ausgeblendet, eigener Balken am Fensterrand, er rollt die Seite und folgt der
wachsenden Höhe; im Katalog kein eigener Scrollkasten mehr, Beobachter ohne
eigene Wurzel, der zweite Ladeweg vorhanden und nach dem Füllen erneut
angestossen, Etikett angemeldet.

Dabei eine Eigenheit der Prüfumgebung dokumentiert: jsdom rechnet kein Layout,
`getBoundingClientRect()` liefert überall Nullen — der zweite Ladeweg hält
deshalb JEDEN Block für sichtbar und lädt sofort alles. Im Browser passiert das
nicht. Der Test prüft dort das Ergebnis; dass Platzhalter eine feste Höhe
bekommen, sichert eine Quelltextregel.

Gegenprobe: den zweiten Ladeweg entfernt → der Test wird rot.

609 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 93 (hardened-189) — Nachladen hängt nicht mehr am Beobachter

Marcos Meldung kam ein zweites Mal: „Wenn ich nach unten scrolle, erscheinen
keine Einträge."

Ich weiss nicht, ob sie den Stand aus Nachtrag 92 schon meinte oder noch den
davor — das Bild kam beide Male nicht mit an. Statt zu raten, habe ich die
verbleibenden Ursachen beseitigt, die im aktuellen Stand noch möglich waren.

### 1. Das Nachladen hing allein am IntersectionObserver

Der meldet nur ÄNDERUNGEN der Sichtbarkeit. Bleibt ein grosser Block
durchgehend sichtbar, oder greift die Wurzel nicht wie gedacht, kommt nie wieder
ein Aufruf — und die Liste bleibt leer, obwohl alles richtig aussieht.

Jetzt hängt das Laden am Scroll-Ereignis selbst: `_ladeSichtbareSeiten()`
rechnet aus den Blockpositionen, was im Bild ist, gedrosselt über
`requestAnimationFrame` (ein Scroll-Ereignis feuert dutzende Male je Sekunde,
und die Rechnung liest Layout). Der Beobachter bleibt als zweiter Weg.

### 2. Über 25 000 Platzhalter-Elemente auf einmal

Ungeladene Seiten bekamen je 60 Kachel-Platzhalter — bei 25 000 Sets über 25 000
Elemente in einem einzigen `innerHTML`. Der Browser baut das, aber langsam, und
jeder Scroll-Schritt kostet danach.

Eine ungeladene Seite ist jetzt EIN leerer Block. Seine Höhe wird an der ersten,
echten Seite GEMESSEN statt gerechnet: Wie viele Kacheln nebeneinander passen,
entscheidet die Fensterbreite. Eine falsche Höhe ist hier teuer — die Liste
springt beim Nachladen, und man verliert die Stelle.

### Test

Vier neue Regeln in `catalog-frontend`: leere Seite als einzelner Block, Höhe
gemessen statt geraten, Scrollen löst das Nachladen aus, und zwar gedrosselt.
Gegenprobe: den Scroll-Weg entfernt → der Test wird rot.

609 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 94 (hardened-190) — Der Scrollbalken erschien nie

Marcos Meldung: „Der Scrollbalken des Browsers ist nun ausgeblendet, aber die
App hat keinen eigenen. Im Reiter Katalog fehlt zudem der Scrollbalken mit den
Jahren."

### Die Ursache

`app.bundle.js` ist ein KLASSISCHES Skript — kein Modul, kein `defer`. Es läuft,
sobald der Parser es erreicht, und das ist VOR allem, was danach im Markup
steht. Ich hatte das `<div id="app-scrollbar">` ans Ende des Body gesetzt,
hinter das Skript. Beim Start gab es das Element also noch nicht,
`initScrollbalken()` kehrte still um (`if (!bar) return`) — und weil der Balken
des Browsers per CSS verborgen ist, hatte die Anwendung GAR KEINEN mehr.

Ein stiller Rückzug an einer Stelle, die nur einmal beim Start durchlaufen wird:
keine Fehlermeldung, kein Konsoleneintrag, nichts zu sehen ausser dem fehlenden
Balken. Das Jahres-Etikett im Katalog fehlte aus demselben Grund — es hängt am
Balken.

Die Anwendung erzeugt das Element jetzt SELBST. Damit hängt der Balken an keiner
Reihenfolge im HTML mehr.

### Gemessen statt vermutet

An einer kleinen jsdom-Bühne mit vorgetäuschtem Layout (jsdom rechnet keines):
Balken erzeugt, sichtbar, Griffhöhe 32px; bei einer Seite, die ins Fenster
passt, wieder verborgen.

### Nebenbei: das Neuzeichnen war ungedrosselt

`zeichneScrollbalken()` LIEST Layout (`scrollHeight`). Am Scroll-Ereignis hängend
erzwang das dutzende Neuberechnungen je Sekunde. Das passt zu Marcos Beobachtung
davor („dauert viel länger, als könnte der Server weniger gleichzeitig") — eine
blockierte Seite sieht aus wie ein langsamer Server. Jetzt über
`requestAnimationFrame` gedrosselt.

### Tests

Neu `test/app-scrollbar.test.js`: Der Balken wird erzeugt und erscheint bei
rollbarer Seite, verschwindet ohne Rollbereich, das Neuzeichnen ist gedrosselt,
und das Etikett bleibt leer, solange es niemand anmeldet. Gegenprobe bestanden.

Der bestehende Prüfer `dom-ids` meldete `app-scrollbar` als fehlend: Er kannte
nur ausgezeichnete Elemente (`<div id="…">`), nicht solche, die der Code selbst
erzeugt (`el.id = '…'`). Erweitert — sonst hätte man sich angewöhnt, ihn zu
übergehen.

613 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 95 (hardened-191) — Der Katalog liess den Server Bilder ohne Ende vorbereiten

Marcos Meldung: „Die App scheint den Server seit der vorletzten Version sehr
stark auszulasten. Die CPU ist praktisch non-Stop auf 100 % Auslastung."

Es ist eine Folge meines Katalog-Umbaus, und sie hätte mir auffallen müssen.

### Was passiert ist

Die Katalogliste bereitet Bilder vor: Zu jedem Set ohne lokale Datei wird ein
Download eingereiht, und zu jedem Download gehört das Erzeugen eines
Vorschaubildes — das ist die teure Arbeit.

Bis zum Umbau holte die Webapp die Seiten EINE nach der anderen; wer zehn Seiten
weit scrollte, stiess zehn Seiten Bilder an. Seit dem Fensterladen
(Nachtrag 90) kann ein einziger Scroll-Vorgang viele Seiten anfordern, ein
Sprung ans Jahresende erst recht. Bei rund 25 000 Katalog-Sets lief der Server
damit lange nach dem Scrollen weiter auf Anschlag — genau das Bild, das Marco
beschreibt.

Begrenzt war die PARALLELITÄT (zwei gleichzeitig), nicht die WARTESCHLANGE. Der
Kommentar an dieser Stelle sprach ausdrücklich von „schnellem Scrollen durch
mehrere Seiten" — geschrieben für eine Liste, die höchstens ein paar Seiten weit
kam. Der Umbau hat die Voraussetzung dieser Begrenzung aufgehoben, und ich habe
die Stelle nicht mitgeprüft. Das ist dieselbe Lehre wie schon mehrfach in dieser
Reihe: Wer eine Annahme ändert, muss suchen, wer auf ihr aufbaut.

### Der Deckel

Höchstens 60 wartende Bilder. Was darüber hinausgeht, wird VERWORFEN — nicht
aufgeschoben: Wer schnell durchscrollt, will diese Bilder nicht, er kommt nur
vorbei. Fehlende Vorschaubilder holt der Bild-Proxy ohnehin bei Bedarf; der
Vorablauf ist eine Beschleunigung, keine Voraussetzung.

Verworfene Sets bleiben NICHT in der „schon gesehen"-Liste — sonst gälten sie
als erledigt und bekämen nie ein lokales Bild, auch wenn man später wirklich bei
ihnen stehen bleibt.

### Gemessen

Zehn Seiten in schneller Folge (600 Sets), Downloader abgefangen:

    ohne Deckel   600 Aufträge
    mit Deckel    104 Aufträge

Der Test misst dasselbe an der ECHTEN Route, nicht an der Hilfsfunktion — genau
dazwischen sass der Fehler: Die Route reiht je Seite bis zu 60 Sets ein, und
niemand begrenzte die Summe. Gegenprobe bestanden.

614 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 96 (hardened-192) — Der Zug über die Leiste blockierte alles

Marcos Meldung mit Bild: „Wenn ich im Katalog zu einem Jahr scrolle, hängt die
Applikation wieder (CPU auf 100 %)." Das Bild zeigt eine leere Liste und das
Etikett 1962 — also ein Zug vom oberen bis zum unteren Ende der Leiste.

Der Deckel auf der Bild-Warteschlange (Nachtrag 95) war richtig, aber er
behandelte die Folge. Die Ursache lag im Ziehen selbst, und sie hat zwei
Hälften.

### 1. Jedes Bild fragte über vierhundert Blöcke nach ihrer Lage

`_ladeSichtbareSeiten()` lief über ALLE Seitenblöcke und rief für jeden
`getBoundingClientRect()`. Bei rund 25 000 Sets sind das über vierhundert
Abfragen — und jede zwingt den Browser zu einer Layout-Neuberechnung. Beim
Ziehen passiert das sechzigmal je Sekunde. Der Balken tat damit genau das,
wogegen er helfen sollte.

Die Lagen werden jetzt EINMAL gemessen und gemerkt. Neu gemessen wird nur, wenn
eine Seite eintrifft oder sich das Fenster ändert.

### 2. Geladen wurde an JEDER Stelle, an der man vorbeikam

Wer von oben nach unten zieht, kommt an jeder Stelle der Liste vorbei — und
löste dort eine Seitenabfrage aus. Ein paar hundert Abfragen über 25 000 Zeilen,
jede mit bis zu sechzig Bildern im Schlepptau, von denen nur die letzte je
angesehen wird.

Jetzt wird erst geladen, wenn das Rollen 150 ms zur Ruhe gekommen ist. Beim
gewöhnlichen Scrollen merkt man das nicht; ein Zug über die ganze Leiste löst
genau EINEN Abruf aus — am Ziel. Was beim Aufbau schon im Bild steht, kommt
weiterhin sofort.

### Der IntersectionObserver ist entfallen

Er war ein zweiter Weg zum selben Ziel, meldete nur ÄNDERUNGEN der Sichtbarkeit
(weshalb bei grossen Blöcken nichts nachkam — Marcos Meldung von vorhin) und
feuerte zusätzlich zur Lagenrechnung. Ein Weg, der immer greift, ist besser als
zwei, die sich ergänzen sollen.

### Tests

Vier neue Regeln in `catalog-frontend`: Blocklagen aus dem Gedächtnis, beim
Rollen wird NICHT neu gemessen, Laden wartet auf Ruhe, kein zweiter Ladeweg.
Beide Gegenproben bestanden.

614 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 97 (hardened-193) — Das Jahres-Etikett log

Marcos Befund: „Wenn dann die Bilder geladen werden, erscheinen sie von einem
anderen Jahr, als rechts im Scrollbalken angezeigt wird. Es wurden die Sets von
1999 geladen, obwohl rechts 1965 steht."

### Eine Annahme, die niemand ausgesprochen hatte

Das Etikett rechnete die Position LINEAR auf den Jahresbereich um — als läge
zwischen 1949 und 2027 in jedem Jahr gleich viel. Tatsächlich stammt der weitaus
grösste Teil des Katalogs aus den letzten Jahrzehnten. Wer neun Zehntel
hinunterzieht, ist deshalb noch lange nicht bei den Sechzigern.

Ich hatte die Rechnung selbst als „Schätzung für noch leere Bereiche"
kommentiert und dabei übersehen, dass genau dort — beim Ziehen über viele
ungeladene Seiten — das Etikett fast ausschliesslich gebraucht wird.

### Jetzt

Neu `GET /api/v1/catalog/year-verteilung`: Anzahl je Jahr, MIT den aktuellen
Filtern und in der Reihenfolge der Sortierung. Aus der Position wird eine
laufende Nummer und daraus das Jahr, in dem diese Nummer wirklich liegt.

Vom SERVER, weil nur er die Filter kennt: Eine Verteilung über den ganzen
Katalog läge bei gesetztem Thema oder Suchtext genauso daneben wie die lineare
Schätzung. Geholt wird sie einmal je Listenaufbau, nicht beim Rollen.

Die erste Wahl bleibt die oberste sichtbare Kachel — sobald die Seite geladen
ist, ist das die Wahrheit und keine Rechnung.

### Gemessen

Schiefe Verteilung wie im echten Katalog (1960–1969 je 2 Sets, 1990–1999 je 20,
2010–2019 je 100):

    Position   dort steht   Etikett neu   Etikett alt (linear)
         25%         2016          2016                   2004
         50%         2013          2013                   1990
         75%         2010          2010                   1975
         90%         1995          1995                   1966

### Test

Neu `test/catalog-year-label-db.test.js`: Zu jeder Position wird das Set an
dieser laufenden Nummer aus der ECHTEN Liste geholt und sein Jahr mit dem
Etikett verglichen — in beiden Sortierungen und mit Themenfilter. Ein Test auf
„die Route liefert Jahre" hätte die lineare Schätzung nie auffliegen lassen.

Der vierte Teilschritt ist eine Gegenprobe im Test selbst: Er stellt sicher,
dass die Bühne SCHIEF ist. Bei gleicher Anzahl je Jahr wäre auch die lineare
Fassung richtig gewesen, und der Test wertlos.

Eigene Falle dabei: Der Test lief allein grün und im vollen Durchlauf rot —
`rb_sets` ist eine globale Tabelle, andere Tests legen dort eigene Zeilen an.
Jetzt schränken alle Abfragen über die Suche auf die eigenen Sets ein.

619 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 98 (hardened-194) — Fehlende Bilder wurden immer wieder gesucht

Marcos Befund: „Beim ersten Scrollen im Katalog funktioniert es einwandfrei,
wenn ich dann weiter scrolle zu 1958, ist es wieder das gleiche Problem."
Dazu der Log — seitenweise `[set-img] HTTP 404 vom Bildserver` für Sets aus den
Fünfzigern und Sechzigern — und `docker stats` mit **142 % CPU im Container**.

Damit war endlich klar, auf welcher Seite die Last sitzt. Meine bisherigen
Anläufe hatten das Laden gedrosselt; die eigentliche Arbeit lag woanders.

### Was der Server tat

Für alte Sets hat Rebrickable meist gar kein Bild. Jede Kachel dort löste einen
Roundtrip zum CDN aus, der ins Leere ging.

Es GAB zwei Merker dagegen: Der Bild-Proxy hielt 404er fünfzehn Minuten fest,
der Katalog merkte sich versuchte Sets. Beide lagen im Arbeitsspeicher EINES
Prozesses — und der Server läuft im Cluster mit mehreren Arbeitsprozessen (im
Log: 16, 22, 23, 24). Dasselbe fehlende Bild wurde deshalb einmal je Prozess
geholt, nach jedem Neustart erneut, und nach fünfzehn Minuten wieder.

Das ist die Klasse Fehler, die in dieser Reihe schon mehrfach vorkam: Ein Schutz
existiert, aber sein Geltungsbereich ist enger als das Problem. Der Kommentar am
Negativ-Merker begründete die kurze Frist ausführlich — für einen einzelnen
Prozess war sie auch richtig.

### Jetzt

Neu `utils/imageMisses.ts`: eine Tabelle `image_misses`, gelesen und geschrieben
von BEIDEN Wegen — der Katalog-Warteschlange und dem Bild-Proxy. Sie überlebt
den Neustart, und alle Arbeitsprozesse teilen sie. Davor ein Merker im
Arbeitsspeicher, damit häufige Treffer nicht je Bildanfrage in die Datenbank
müssen.

Nach sieben Tagen wird erneut geprüft: Ein Bild, das seit Jahrzehnten fehlt,
taucht nicht über Nacht auf, und ein nachgereichtes bleibt nicht für immer
ausgesperrt.

### Gemessen

Ein Jahrgang mit 60 bildlosen Sets:

    1. Besuch          60 Versuche
    2. Besuch           0 weitere
    frischer Prozess    weiss Bescheid

### Tests

Neu `test/image-misses-db.test.js` — über die ECHTE Route, mit abgefangenem
Downloader. Der entscheidende Teilschritt leert den Arbeitsspeicher-Merker und
prüft, dass die Auskunft trotzdem stimmt: Genau dort lag der Fehler. Dazu die
Gegenrichtung, dass ein vorhandenes Bild nicht als fehlend gilt — sonst wäre
der Test auch grün, wenn pauschal alles ausgesperrt würde.

`set-value` nagelte die alte Fassung fest („Fenster 15 Minuten"). Umformuliert:
Die Aussage „nur 404, kein 403" gilt unverändert, geprüft wird jetzt am
gemeinsamen Merker.

622 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 99 (hardened-195) — Die Vorschaubilder waren die Last

Marcos Messung: **329 % CPU** im Container bei **15 MB** Netzverkehr. Das ist
die Zahl, die alles entschieden hat: keine Warterei auf fremde Server, sondern
Rechnen — und die teuerste Rechnung im Server ist das Verkleinern von Bildern.

Meine bisherigen Anläufe haben das LADEN gedrosselt (Nachtrag 95, 96) und
vergebliche CDN-Roundtrips abgestellt (98). Alles richtig, aber daneben: Die
Arbeit steckte im Bild-Proxy.

### Warum es so teuer ist

`Jimp` ist reines JavaScript. Ein JPEG zu entpacken und zu verkleinern kostet
auf schwacher Hardware — Marcos Installation läuft auf einem Raspberry Pi —
spürbar Zeit.

Die Grenze `THUMB_MAX_PARALLEL = 2` stand da, aber sie gilt JE ARBEITSPROZESS,
und der Server läuft im Cluster mit vier davon: acht gleichzeitige Läufe. 329 %
sind gut drei Kerne. Die Warteschlange davor hatte gar keine Grenze.

Wieder derselbe Befund wie beim Merker für fehlende Bilder: Ein Schutz
existiert, aber sein Geltungsbereich ist enger als das Problem.

Bis zum Umbau der Katalogliste fiel das nicht auf — sie zeigte nur, wozu man
sich hingescrollt hatte. Seit dem Fensterladen kommen bei jedem Sprung hunderte
neuer Bilder ins Blickfeld, und für jedes wurde eine Vorschau gerechnet. Der
Rückstau lief lange nach dem Scrollen weiter.

### Jetzt

* `THUMB_MAX_PARALLEL = 1` — einer je Prozess. Die Vorschau ist eine
  Beschleunigung für später, nichts, worauf jemand wartet: Bis sie fertig ist,
  liefert der Proxy das Originalbild aus.
* `THUMB_MAX_QUEUE = 40` — dieselbe Überlegung wie bei den Katalog-Bildern: Wer
  schnell durchscrollt, WILL diese Vorschauen nicht, er kommt nur vorbei.
  Verworfen statt aufgeschoben; wer stehen bleibt, bekommt sie beim nächsten
  Aufruf.

### Test

`set-value` prüft beide Grenzen mit dem Grund im Text: dass sich die
Parallelität im Cluster je Arbeitsprozess vervielfacht, und dass eine
Warteschlange ohne Ende den halben Katalog aufstaut.

623 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 100 (hardened-196) — Die Grenze galt je Prozess, nicht für den Server

Marcos Beobachtung, und damit war es klar: „Es rechnen alle gleichzeitig und
beginnen erst, wenn ich das erste Mal richtig scrolle."

Genau das war der fehlende Zusatz zu den 329 % aus der Messung davor.

### Warum die Grenze aus Nachtrag 99 nicht reichte

`THUMB_MAX_PARALLEL = 1` gilt je ARBEITSPROZESS. Der Server läuft im Cluster mit
vier davon — vier Prozesse mal ein Lauf sind immer noch vier gleichzeitige
Jimp-Verkleinerungen, auf einem Raspberry Pi praktisch alle Kerne. Eine Grenze
im Arbeitsspeicher KANN das nicht lösen, weil kein Prozess von den anderen
weiss.

Dasselbe Muster nun zum dritten Mal in Folge: der Merker für fehlende Bilder
(98), die Vorschau-Parallelität (99), und jetzt sie noch einmal. Jedes Mal
existierte ein Schutz, und jedes Mal war sein Geltungsbereich enger als das
Problem. Die Lehre gehört an den Anfang jeder Begrenzung in diesem Projekt:
**Im Cluster zählt nur, was alle Prozesse sehen.**

### Jetzt

`pg_try_advisory_lock` gibt den Zuschlag genau einem Prozess. Wer ihn nicht
bekommt, lässt es — kein Warten, kein Aufstauen: Die Vorschau ist eine
Beschleunigung für später, und beim nächsten Aufruf des Bildes wird es erneut
versucht. Ein WARTENDER Lock hielte stattdessen eine Datenbankverbindung fest
und staute die Arbeit nur an anderer Stelle auf.

Damit läuft serverweit höchstens EINE Verkleinerung zur Zeit.

### Gemessen

Zwei Verbindungen als zwei „Prozesse": Der erste bekommt die Sperre, der zweite
nicht; nach der Freigabe bekommt sie der zweite.

### Test

`set-value` prüft alle drei Teile: die Sperre existiert, sie WARTET nicht
(`pg_try_...`, nicht `pg_advisory_lock`), und sie wird wieder freigegeben — ohne
das blockierte der erste Lauf alle folgenden bis zum Neustart. Gegenprobe
bestanden.

623 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 101 (hardened-197) — Der Katalog erzeugt gar keine Vorschauen mehr

Marcos Frage: „Der Proxy sollte das Bild, wenn er es vom CDN holen muss, in
Originalgrösse weitergeben und die Bilder mit einem Job nachladen und das Thumb
erstellen. Dadurch sollte die Last doch klein bleiben?"

Sein Modell ist richtig — und der Proxy hält es bereits ein. Nachgesehen:

    // Original liegt vor, Verkleinerung fehlt noch. NICHT darauf warten:
    // Das Original geht sofort raus, die Verkleinerung entsteht in der
    // Warteschlange und steht ab dem nächsten Aufruf bereit.

Keine Anfrage wartet also auf Jimp. Die Last kam von einer anderen Stelle:
Der Proxy stiess für JEDES neue Bild eine Verkleinerung an — und der Katalog
zeigt rund 25 000 fremde Sets. Der „Job im Hintergrund" lief, er hatte nur
25 000 Aufträge.

### Die Frage, die ich nie gestellt hatte

Wofür genau ist die Verkleinerung da? Für einen Bestand von ein paar hundert
Bildern, die man täglich wiedersieht, lohnt sie: einmal rechnen, oft sparen.
Für 25 000 Katalog-Sets, an denen man vorbeiscrollt, lohnt sie nie — man sieht
jedes davon höchstens ein Mal.

`imgUrl(src, thumb)` kennt jetzt einen dritten Wert:

    false   volle Auflösung
    true    Vorschau; fehlt sie, wird sie erzeugt   → eigener Bestand
    'nur'   Vorschau NUTZEN, aber keine erzeugen    → Katalog

Serverseitig entspricht dem `&gen=0`. Damit löst Blättern im Katalog KEINE
Verkleinerung mehr aus; wo eine existiert (weil das Set im Bestand ist), wird
sie weiter benutzt. Das Original geht ohnehin sofort raus.

### Zusammen mit den Nachträgen davor

    95   Bild-Warteschlange des Katalogs gedeckelt
    98   fehlende Bilder prozessübergreifend gemerkt
    99   Vorschau-Parallelität von 2 auf 1
    100  Sperre über die Datenbank — EINE Verkleinerung serverweit
    101  Katalog erzeugt gar keine mehr

Die ersten vier haben die Arbeit begrenzt. Diese hier lässt sie weg.

### Test

`set-value` prüft beide Hälften: dass der Proxy das „nutzen, nicht erzeugen"
überhaupt kennt, dass die Katalog-Kachel es benutzt — und dass die Galerie es
NICHT tut, dort lohnt die Verkleinerung ja.

`catalog-local-images` nagelte `true` fest; umformuliert auf `'nur'`. Die
geprüfte Aussage bleibt dieselbe: Kachel über den Proxy, nicht roh vom CDN.

623 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 102 (hardened-198) — Bilder und Vorschauen entstehen im Hintergrund

Marcos Vorgabe: „Ich fänd es sinnvoll, wenn die Bilder lokal gecached werden
inkl. Thumbs. Bitte aber die Bilder im Hintergrund mit dem Bilder-Download-Job
herunterladen und das Thumb erstellen, sobald sie einmal via Proxy geladen
wurden. Das sollte das gleiche Prinzip wie bei den anderen Reitern sein."

Das ist die richtige Aufteilung, und sie korrigiert meinen letzten Nachtrag: Da
hatte ich die Verkleinerung im Katalog GANZ abgeschaltet. Zu grob — wer ein Set
zweimal ansieht, soll beim zweiten Mal das kleine Bild bekommen.

### Was an der Anfrage hing

Der Proxy holte das Bild UND stiess sofort die Verkleinerung an. Bei den eigenen
Sets fiel das nie auf: ein paar hundert Bilder, einmalig. Im Katalog mit 25 000
fremden Sets wurde daraus eine Rechenlawine, die lange nach dem Scrollen
weiterlief.

### Jetzt

* Die Anfrage liefert sofort aus — Vorschau, wenn es sie gibt, sonst das
  Original — und hinterlässt nur eine NOTIZ.
* `jobs/imageQueue.ts` arbeitet die Notizen gestapelt ab: fünf je Durchgang,
  alle 20 Sekunden, nur auf dem Primärprozess. Original ablegen, verkleinern,
  Notiz entfernen.

Die Notizen stehen in der DATENBANK (`image_wanted`), nicht im Arbeitsspeicher.
Sie überleben den Neustart, alle Arbeitsprozesse schreiben in dieselbe, und
dieselbe Adresse zweimal zu notieren kostet nichts. Das ist die Lehre aus den
Nachträgen 98 bis 100, wo Grenzen je Prozess galten und deshalb nicht wirkten.

Fehlschläge werden nicht wiederholt: Die Notiz verschwindet, und der Merker für
fehlende Bilder (Nachtrag 98) hält fest, dass es dieses Bild nicht gibt.

### Gemessen

Acht Notizen, davon eine doppelt:

    Notizen in der DB      8   (die doppelte fällt weg)
    1. Durchgang           5   Bilder geholt, 5 verkleinert
    Notizen danach         3
    2. Durchgang           3
    Notizen am Ende        0

### Tests

Neu `test/image-queue-db.test.js`: Entdopplung, gestapelte Abarbeitung, keine
Notiz bleibt liegen. Dazu zwei Quelltextregeln — der Proxy notiert im
gen=0-Fall, statt zu rechnen, und der Job steht im Primärprozess-Block. Ohne die
zweite liefe er in jedem Arbeitsprozess, und die Drosselung wäre wirkungslos;
genau dieser Fehler steckte in den Nachträgen 99 und 100. Gegenprobe bestanden.

628 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 103 (hardened-199) — Ich hatte den Verbindungspool leergezogen

Marcos Log, und damit war es endlich klar:

    [route-error] 500: Error: timeout exceeded when trying to connect
        at pg-pool
        at getStats

und gleichzeitig `docker logs | grep -c img-proxy` → praktisch null.

Beide Zeilen zusammen kehren die Diagnose um: NICHT die Bildarbeit war die
Last — es scheiterte eine ganz andere Route daran, keine Datenbankverbindung
mehr zu bekommen. Das erklärt auch Marcos frühere Beobachtung „als könnte der
Server weniger Requests gleichzeitig bearbeiten". Genau das war es.

### Was ich falsch gemacht habe

In Nachtrag 98 und 102 habe ich zwei Nachschläge aus dem Arbeitsspeicher in die
Datenbank verlegt — mit gutem Grund: Im Cluster teilen sich die Prozesse nichts,
und genau daran waren die Nachträge 98 bis 100 gescheitert.

Übersehen habe ich, WIE OFT sie laufen. Bildanfragen sind der häufigste Vorgang
der ganzen Anwendung; eine Kachelwand sind dutzende gleichzeitig. Jede belegte
eine Verbindung aus dem Pool (10–15 je Arbeitsprozess). Ein richtiger Gedanke
am falschen Ort — im heissesten Pfad.

Der Unterschied Android/Webapp, den Marco gemeldet hat, passt dazu: Ein
Telefon zeigt ~8 Kacheln gleichzeitig, ein Desktop-Browser leicht 36.

### Jetzt

Lesen aus dem Arbeitsspeicher, Schreiben gebündelt im Takt:

* `istBekanntFehlend()` ist SYNCHRON und ohne Datenbank. Der Bestand liegt
  vollständig im Speicher und wird alle fünf Minuten aufgefrischt — eine
  Abfrage je Prozess und Intervall statt einer je Bild.
* `merkeFehlend()` und `merkeGebraucht()` puffern; weggeschrieben wird in EINEM
  Statement.

Gemessen:

    60 Kacheln       vorher 120 Abfragen   →   jetzt 0
    Wegschreiben                            →   1 Abfrage
    40 Fehlanzeigen                         →   1 Abfrage

### Nebenbefund: die Sitzungssperre war kaputt

`mitVorschauSperre` (Nachtrag 100) nahm `pg_try_advisory_lock` über den Pool und
gab es über den Pool wieder frei — womöglich auf einer ANDEREN Verbindung. Eine
Sitzungssperre gehört aber der Verbindung, die sie genommen hat: Das Freigeben
auf einer anderen tut nichts, die Sperre bleibt für immer bestehen, und ab dann
entstünde nie wieder ein Vorschaubild. Jetzt eine feste Verbindung für Nehmen,
Arbeiten und Freigeben.

### Tests

Neu `test/image-pool-db.test.js` — er zählt ABFRAGEN, nicht Ergebnisse: 60
Kacheln dürfen null auslösen, das Wegschreiben höchstens eines, und nach
geleertem Speicher muss das Wissen aus der Tabelle zurückkommen. Dazu eine
Quelltextregel für die Sperre auf fester Verbindung. Beide Gegenproben
bestanden.

Drei bestehende Tests umformuliert: Sie riefen `await istBekanntFehlend(...)`
und verliessen sich darauf, dass geschrieben wird, sobald gemerkt wird. Beides
gilt nicht mehr; sie stossen das Wegschreiben jetzt ausdrücklich an.

634 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 104 (hardened-200) — Webp-Bilder wurden bei jedem Ansehen neu versucht

Marcos Log, dieselbe Zeile wieder und wieder:

    [thumb] Vorschau fehlgeschlagen für /images/sets/40393-1.jpg:
            Mime type image/webp does not support decoding

Jimp kann webp nicht entpacken. Scheitert der Versuch, entsteht KEINE Datei —
und beim nächsten Aufruf desselben Bildes sah der Proxy „keine Vorschau da" und
versuchte es erneut. Für jedes webp-Bild also bei jedem Ansehen ein
vergeblicher Anlauf, der das Bild erst einliest und dann aufgibt.

Der vorhandene Schutz `_thumbInFlight` galt nur für die Dauer eines Laufs —
wieder ein Geltungsbereich, der enger ist als das Problem. Dass Rebrickable
webp ausliefert, war dabei nicht der Fehler; der Fehler war, aus einem
Fehlschlag nichts zu lernen.

Jetzt landet er im gemeinsamen Merker (`utils/imageMisses`, Schlüssel
`thumb:<datei>`): prozessübergreifend, über den Neustart hinweg, und nach sieben
Tagen wird es wieder versucht — falls die Bibliothek inzwischen mehr kann.

Gemessen (Ablauf nachgestellt): Fünf Seitenaufrufe ergaben vorher fünf
Versuche, jetzt einen. Nach geleertem Speicher und Nachladen aus der Tabelle
bleibt es bei null.

### Test

`image-pool-db` um eine Regel erweitert: `queueThumb()` fragt den Merker ab, und
der Fehlschlag wird an BEIDEN Stellen festgehalten, an denen er auftreten kann —
in der Vorprüfung (`isDecodable`) und im `catch`. Gegenprobe bestanden.

635 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 105 (hardened-201) — Der zweite, ungebremste Erzeuger

Marcos Zuordnung: „Die CPU ist seit der Umstellung des Katalogs mit dem
Scrolling so stark ausgelastet." Damit war die Suche endlich am richtigen Ort.

### Der Befund

`routes/api_v1/catalog.ts` hatte eine EIGENE Bild-Warteschlange. Sie holte zu
jedem gelisteten Set das Bild und rief `generateThumb()` DIREKT auf — vorbei an
allem, was ich in fünf Nachträgen gedrosselt hatte:

* nicht an `THUMB_MAX_PARALLEL` (das gilt im Bild-Proxy),
* nicht an der Sitzungssperre aus Nachtrag 100 (dito),
* mit eigener Parallelität 2 — bei vier Arbeitsprozessen acht gleichzeitige
  Jimp-Läufe. Das sind die über 300 %.

Dazu ein zweiter direkter Aufruf im Detail-Zweig derselben Datei.

Vor dem Umbau der Liste fiel das nicht auf: Sie zeigte nur, wozu man sich
hingescrollt hatte, also ein paar Seiten. Seit dem Fensterladen kommen bei
jedem Sprung hunderte Sets vorbei — genau der Zusammenhang, den Marco benannt
hat.

### Was ich daraus lerne

Ich habe fünf Nachträge lang die Drosselung des EINEN Erzeugers verfeinert,
während der zweite ungebremst danebenlief. Gefunden hat ihn nicht meine
Vermutung darüber, WAS rechnet, sondern Marcos Hinweis, WANN es angefangen hat.

Die Regel dazu: Bevor man eine Begrenzung verschärft, erst zählen, wie viele
Stellen die begrenzte Arbeit überhaupt anstossen. `grep generateThumb` hätte den
zweiten Erzeuger in zehn Sekunden gezeigt.

### Jetzt

Die Warteschlange ist ersatzlos entfallen, beide direkten Aufrufe ebenso. Der
lokale Cache baut sich weiter auf, nur über den anderen Weg: Bildanfrage über
den Proxy → Notiz → `jobs/imageQueue.ts` legt Bild UND Vorschau an, gebündelt
und nur auf dem Primärprozess. EIN Erzeuger statt zweier, und dieser ist
gedrosselt.

### Tests

Drei bestehende umformuliert, alle in dieselbe Richtung — aus „begrenzt" wird
„gar nicht":

* `catalog-local-images`: Die Datei darf `generateThumb` nicht mehr enthalten;
  der Detail-Zweig meldet beim Job an.
* `catalog-image-queue-db`: Die Liste löst NULL Bild-Aufträge aus (vorher:
  weniger als 200).
* `image-misses-db`: prüft den Merker selbst statt über die Liste.

635 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 106 (hardened-202) — Die Notizen erreichten die Datenbank nie

Marcos Befund: „Ich habe das Gefühl, die Bilder aus dem Katalog werden nicht
heruntergeladen im Hintergrund. Der ‚Bild-Download (CDN)' unter Monitoring zeigt
nicht an, dass er was herunterlädt, und es sind immer gleich viele Bilder im
Ordner images/sets."

Er hatte recht, und es war mein eigener Fix von zwei Nachträgen zuvor.

### Der Fehler

`merkeGebraucht()` puffert die Notizen im ARBEITSSPEICHER — das war richtig, ein
INSERT je Bildanfrage hatte den Verbindungspool geleert (Nachtrag 103). Das
Wegschreiben hing aber an `start()`, und `start()` läuft nur auf dem
PRIMÄRPROZESS.

Bildanfragen verteilen sich über alle vier Arbeitsprozesse. Drei Viertel aller
Notizen wurden also nie geschrieben — und was der Primär notierte, nur wenn er
die Anfrage zufällig selbst bediente. Da die Warteschlange in Nachtrag 105
ausserdem der einzige verbliebene Weg war, kam gar nichts mehr an.

Derselbe Geltungsbereichs-Fehler wie in den Nachträgen 98 bis 100 und 105:
Etwas Prozess-LOKALES an etwas Prozess-GLOBALES gehängt. Diesmal habe ich ihn
selbst eingebaut, in genau der Änderung, mit der ich einen anderen Fall davon
behoben habe.

### Jetzt

Der Takt zum Wegschreiben steht in `initImageQueue()` — das läuft beim Aufbau
der Datenbank und damit in JEDEM Arbeitsprozess. `start()` bleibt für das
ABARBEITEN zuständig und damit beim Primär: Der Puffer ist je Prozess, das
Abarbeiten ist es nicht.

### Gemessen

Ganze Kette, Notiz in einem Prozess, der `start()` NIE aufgerufen hat:

    Notizen sofort in der DB   0   (gepuffert, wie gewollt)
    nach dem Takt              6
    Bilder geholt/verkleinert  6 / 6
    Notizen übrig              0

### Test

`image-queue-db` um eine Regel erweitert: Das Wegschreiben steht in
`initImageQueue()`, diese wird beim Datenbankaufbau gerufen, und das Abarbeiten
steht im Primärprozess-Block. Gegenprobe bestanden.

636 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 107 (hardened-203) — Die Tabellen wurden nie angelegt

Marcos Ausgabe, auf einem Server mit der AKTUELLEN App-Version:

    ERROR:  relation "image_wanted" does not exist

### Warum

Ich hatte die Tabellen am Ende von `initSchema()` angelegt. Die läuft aber nur,
wenn sich die App-VERSION geändert hat (`schema_meta`) — und der Aufruf stand
hinter einem `.catch(...)`, das Fehler bloss protokolliert.

Schlug er beim ersten Start einer Version fehl, wurde die Version trotzdem als
„angewandt" vermerkt. Danach wurde `initSchema()` nie wieder ausgeführt, und
damit auch der Tabellenaufbau nie wieder versucht. Ein einziger stiller
Fehlschlag schaltete den Bild-Job dauerhaft ab — und alles, was ich seither
gebaut habe, lief bei Marco ins Leere.

Die Datei `db/migrate.ts` beschreibt in ihrem Kopf genau dieses Problem und
bietet die Lösung an: nummerierte Migrationen, die IMMER laufen und EINZELN
vermerkt werden. Ich hatte den vorgesehenen Weg nicht benutzt.

### Jetzt

`db/migrations/0009-bild-tabellen.sql` legt beide Tabellen an. Die
init-Funktionen legen nichts mehr an; sie laden nur noch den Bestand in den
Speicher und setzen ihre Takte — und sie laufen NACH den Migrationen (sonst
fehlte die Tabelle beim Laden) und AUSSERHALB von `initSchema()` (sonst nur in
dem einen Worker, der gerade migriert).

### Gemessen

Marcos Lage nachgestellt — Tabellen gelöscht, Version als angewandt vermerkt:

    ✅ Migration angewandt: 0009-bild-tabellen.sql
    image_wanted -> angelegt
    image_misses -> angelegt

### Test

`image-queue-db` um eine Regel erweitert: Die Tabellen stehen in der Migration
und NIRGENDWO sonst; die init-Aufrufe laufen nach `runMigrations` und ausserhalb
von `initSchema()`.

637 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 108 (hardened-204) — Katalog-Bilder in der Kachel; Rate auf 60/min

Zwei Wünsche von Marco, nachdem die Kette endlich lief.

### 1. Die Kachel sagte nichts über den Katalog

„Ich fände es sprechend, wenn diese in der Kachel ‚Bild-Download (CDN)'
enthalten sind, da der Titel nichts von meinen Sets aussagt."

Er hat recht: Die Kachel zählte ausschliesslich Bilder des eigenen BESTANDES
und meldete „Alle 62 170 Bilder gecacht", während der Hintergrund-Job gerade
hunderte Katalogbilder nachlud. Der Titel verspricht aber alles, was vom CDN
kommt.

Jetzt kommt die Warteschlange aus `image_wanted` dazu:

    ohne offene Bilder   status=done     "Alle 62170 Bilder gecacht"
    mit 137 offenen      status=running  "Bestand: … · 137 Katalog-Bilder in
                                          Warteschlange"

Drei Details, die daran hängen:

* „Bestand:" steht nur davor, wenn Katalogzahlen daneben stehen — sonst liesse
  sich nicht sagen, worauf sich welche Zahl bezieht.
* Der Status wird `running`, sobald etwas in der Warteschlange steht. Vorher
  hätte die Kachel „fertig" gemeldet, während sie lud.
* Der Balken bezieht die Warteschlange in `total` ein, sonst stünde er auf
  100 %, während noch hunderte Bilder ausstehen.

### 2. Rate von 15 auf 60 Bilder je Minute

Marcos Messung: CPU im Leerlauf bei 0 %. `STAPEL` von 5 auf 20 (alle 20
Sekunden). Die ursprünglichen 5 waren bewusst zurückhaltend, solange unklar
war, woher die Last kam — diese Frage ist mit den Nachträgen 103 bis 107
beantwortet.

### Tests

Neu in `image-queue-db`: die Kachel in beiden Zuständen (leer und mit 137
offenen), samt Status, Beschriftung und Balkengrundlage. Gegenprobe bestanden.

Der bestehende Stapel-Test verlangte „weniger als 8 in einem Durchgang" — eine
Zahl, die zur alten Stapelgrösse gehörte. Er liest sie jetzt aus der Quelle:
Die geprüfte REGEL ist „nicht alles auf einmal", nicht „genau fünf".

Eigene Falle dabei: Der erste Test der Datei schloss den Verbindungspool in
seinem `finally`. Der neue Kachel-Test lief danach ins Leere („Cannot use a pool
after calling end"). Jetzt schliesst der LETZTE DB-Test.

638 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 109 (hardened-205) — Ein Wettlauf im Dialog, und vermeidbare 404er

Aus Marcos Browser-Konsole zwei Funde.

### 1. TypeError beim Schliessen des Set-Dialogs

    [promise] TypeError: Cannot read properties of null (reading 'minifigs')

Als `[promise]` gemeldet, also aus einer Fortsetzung. `openModal()` fragt die
Minifiguren-Zahl nach, NACHDEM der Dialog schon steht — die Abfrage geht über
alle Minifiguren und dauert. Wer den Dialog vorher schliesst, setzt `curSet` auf
null, und die späte Antwort läuft in den Fehler.

Die vorhandene Prüfung auf das ELEMENT genügte nicht: Öffnet man ein ANDERES
Set, gibt es das Element weiterhin — die Zahl landete dann im falschen Dialog.
Ein Fehler, den man nicht als Absturz sieht, sondern als falsche Zahl.

Verglichen wird jetzt die Setnummer: Nur wenn noch dasselbe Set offen ist,
gehört das Ergebnis dorthin.

### 2. Dieselben 404er immer wieder

In der Konsole steht dieselbe Adresse mehrfach hintereinander, etwa
`9780241838570-1.jpg` gleich zweimal.

Ein 404 OHNE `Cache-Control` ist für den Browser nicht zwischenspeicherbar: Er
fragt bei jedem Rendern der Kachel erneut. Beim Blättern durch alte Jahrgänge,
wo fast jedes Bild fehlt, ist das ein voller Satz Anfragen je Bildschirm — bis
zum Server, dort in den Merker und wieder zurück.

Jetzt trägt der 404 eine Stunde Gültigkeit. Bewusst kurz: Wird ein Bild
nachgereicht, soll es nicht einen Tag lang unsichtbar bleiben. Der SERVER merkt
sich die Fehlanzeige länger (sieben Tage) — dort kostet ein erneuter Versuch ja
auch mehr.

Ein 403 bekommt den Hinweis NICHT: Das ist eine Drosselung, kein fehlendes Bild
— dasselbe Argument wie beim serverseitigen Merker.

### Tests

Zwei neue Regeln, beide mit bestandener Gegenprobe: Die späte Antwort prüft die
Setnummer, und der 404 trägt den Cache-Hinweis auf BEIDEN Wegen (Treffer im
Merker und Absage vom CDN), der 403 nicht.

640 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 110 (hardened-206) — Das Jahres-Etikett klebte in allen Reitern

Marcos Bild: „2027" steht in der GALERIE oben rechts, ohne dass jemand zieht.

Zwei Ursachen, beide in meinem Code.

### 1. Eine Inline-Angabe schlägt jede CSS-Regel

Die Regel zeigt das Etikett nur während `.dragging`. `rollen()` setzt aber
`style.display` DIREKT am Element — und eine Inline-Angabe gewinnt gegen jede
Regel. Nach dem Loslassen blieb sie stehen, also blieb auch das Etikett stehen,
in JEDEM Reiter und an der Stelle, wo man zuletzt losgelassen hat.

Der Ende-Handler nimmt sie jetzt wieder weg (`style.display = ''`), damit die
Regel wieder zuständig ist.

### 2. Der Katalog meldete sich nie ab

`setScrollLabel()` wurde beim Betreten des Katalogs gesetzt und nie
zurückgenommen. Die Funktion lieferte weiter ein Jahr — auch in der Galerie, wo
die Zahl nichts bedeutet. Beim Reiterwechsel wird jetzt abgemeldet.

Beide zusammen: Ohne (1) klebt das Etikett, ohne (2) enthält es beim nächsten
Ziehen eine Zahl aus dem falschen Zusammenhang. Deshalb sind beide nötig.

### Test

Zwei Regeln in `app-scrollbar`, beide mit bestandener Gegenprobe.

Eigene Falle dabei, und ausgerechnet die bekannteste: Der erste Entwurf schnitt
den Ende-Handler mit einem festen Zeichenfenster aus und traf die geprüfte Zeile
nicht, weil die Begründung im Kommentar länger ist als das Fenster. Jetzt wird
bis zum Ende des Handlers geschnitten — dieselbe Lehre wie bei den
Kotlin-Prüfungen: nie nach fester Länge, immer bis zur Struktur.

642 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 111 (hardened-207) — Knopf „Katalogbilder holen", und die Vorschauen dazu

Marcos Wunsch: „Kannst du im Monitoring beim Bilder-Download-Job noch einen
Button erstellen. Wenn dieser geklickt wird, sollen alle fehlenden Bilder des
Katalogs heruntergeladen werden resp. in die Queue gestellt werden. Bitte auch
prüfen, dass für Katalogbilder jeweils ein Thumbs-Image erstellt wird."

### Der Knopf

Bisher füllte sich der lokale Bildbestand nur beim Blättern: Was man nie
ansieht, wird nie geholt. Für ein gezieltes Vorbefüllen — etwa über Nacht —
fehlte der Anstoss.

Neu `POST /api/v1/admin/catalog-images`. Er REIHT NUR EIN, in einer einzigen
Anweisung, ohne je Datei zu prüfen: Bei 25 000 Sets wären das ebenso viele
Dateizugriffe in einer Anfrage — auf einem Raspberry Pi eine spürbare Blockade.
Sets ohne Bildadresse und solche mit bekannter Fehlanzeige bleiben aussen vor.

Die Rückmeldung nennt die Zahl der WARTENDEN Bilder, nicht „gestartet": Bei
gedrosselten 60 Bildern je Minute dauert ein voller Katalog Stunden, und eine
Erfolgsmeldung wäre irreführend.

### Die Vorschauen

Marcos zweite Frage war berechtigt. Der Job erzeugte sie nur nach einem
Download — für Bilder, die schon vorher lokal lagen (etwa aus der alten
Katalog-Warteschlange), fehlte sie womöglich für immer.

Jetzt prüft der Job beides: Liegt die Datei schon, wird NICHT erneut geladen —
fehlt aber die Vorschau, wird sie nachgeholt. Damit heilt der Knopf zugleich
alle Altbestände ohne Vorschau.

### Gemessen

Zehn Katalog-Sets; eines mit Bild ohne Vorschau, eines mit beidem, eines mit
bekannter Fehlanzeige:

    eingereiht     9   (die Fehlanzeige bleibt aussen vor)
    Downloads      7   (die beiden vorhandenen übersprungen)
    Vorschau nachgeholt für das Bild ohne Vorschau: ja
    Vorschau erneut gerechnet für das mit Vorschau: nein

### Tests

Neu `test/catalog-images-button-db.test.js` mit drei Teilschritten gegen die
echten Routen, dazu eine Prüfung der Verdrahtung: Knopf in der Kachel,
Klick-Handler, Registrierung in der Aktions-Liste und beide Übersetzungen. Ohne
die letzte tut ein Klick nichts, und das fällt erst am Gerät auf. Gegenprobe
bestanden.

647 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 112 (hardened-208) — Drosselung ist keine Fehlanzeige

Marcos Frage: „Wie schätzt du den CDN ein, können so viele Requests abgefragt
werden, oder wird da Cloudflare die IP sperren?"

Die Frage hat einen Fehler aufgedeckt, der ohne sie unbemerkt geblieben wäre.

### Der Fund

`downloadSetImage()` antwortet auf JEDEN Fehlschlag mit `null` — bei 404
(„dieses Bild gibt es nicht") ebenso wie bei 403 („du fragst zu schnell"). Der
Hintergrund-Job leitete daraus eine Fehlanzeige ab und sperrte das Bild für
sieben Tage.

Bei einer Drosselung ist das genau falsch herum: Dann sind die Bilder
VORHANDEN, und ausgerechnet der Ansturm, der die Drosselung auslöst, hätte
hunderte davon dauerhaft ausgesperrt. Ein Knopf, der 25 000 Bilder einreiht,
wäre damit der sicherste Weg gewesen, den halben Katalog dauerhaft bildlos zu
machen.

Der Bild-Proxy unterscheidet die beiden Fälle längst (nur 404 wird gemerkt,
403 nicht) — dem Job fehlte schlicht die Auskunft. `downloadSetImage()` nimmt
jetzt ein optionales Feld entgegen, in das es den Statuscode schreibt;
bestehende Aufrufer bleiben unberührt.

### Was jetzt gilt

    404      → Fehlanzeige, nicht wieder versuchen
    403/429  → fünf Minuten Pause, alle unbearbeiteten Notizen zurück in die
               Warteschlange

Stur weiterzufragen ist genau das Verhalten, das eine Sperre verlängert.

### Eigener Fehler beim Bauen

Der erste Entwurf legte beim Abbruch nur die AKTUELLE Notiz zurück. Der Stapel
wird aber mit `DELETE … RETURNING` geholt — die übrigen neunzehn waren damit
still verloren. Gemessen: 10 Notizen rein, nach der Drosselung war 1 übrig.
Jetzt geht der ganze Rest zurück.

### Gemessen

    403:  0 abgearbeitet, 1 Versuch, 10 Notizen erhalten, 0 Fehlanzeigen
          nächster Lauf: kein weiterer Versuch (Pause greift)
    404: 10 Versuche, 10 Fehlanzeigen

### Test

Neu `test/image-throttle-db.test.js` mit drei Teilschritten. Gegenprobe
bestanden.

651 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 113 (hardened-209) — Schonender Umgang mit dem Bildserver

Marcos vier Vorgaben, alle umgesetzt und gemessen.

    Bilder im Durchgang       10
    gleichzeitige Downloads    1
    Abstände (ms)              754 … 1002
    Rate                       10 je 20 s = 30 je Minute

### Im Einzelnen

**Verzögerung 500–1000 ms.** Zufällig gestreut, nicht fest: Ein exakt gleicher
Abstand ist selbst ein Muster — eine Heuristik, die nach Maschinen sucht,
erkennt Gleichmass leichter als Unregelmässigkeit. Die Pause liegt ZWISCHEN den
Anfragen, nicht vor der ersten, und nur zwischen solchen, die wirklich ans CDN
gehen: Sets mit bereits vorhandener Datei werden vorher abgekürzt und kosten
dort nichts.

**Sequenziell.** War es bereits (`for` mit `await`), ist jetzt aber geprüft —
der Test zählt die Gleichzeitigkeit und verlangt 1.

**30 Anfragen je Minute.** `STAPEL` von 20 auf 10, Takt unverändert 20 s.

**User-Agent.** Hier stand eine vorgetäuschte Chrome-Kennung. Das ist die
schlechteste aller Möglichkeiten: Sie sagt nicht, wer wir sind, und ein
„Browser", der tausende Bilder ohne die üblichen Begleitanfragen holt, fällt
einer Heuristik gerade dadurch auf. Jetzt eine ehrliche Produktkennung mit
Version.

Umschaltbar über `IMG_USER_AGENT`: Ich kann von hier aus nicht ausprobieren, wie
der echte Bildserver auf die neue Kennung reagiert. Sollte er ausgerechnet
Produktkennungen abweisen, lässt sich das ohne neuen Build zurücknehmen.

### Warum unbedingt und nicht erst ab 200 Bildern

Marco hatte die Vorgaben für Läufe über 200 Bildern gestellt. Zwei Verhalten
einzubauen hiesse, beide zu pflegen und zu prüfen — für den Gewinn, beim
Blättern drei Bilder eine Sekunde früher zu haben. Der Vorablauf ist ohnehin
nichts, worauf jemand wartet.

### Was das für einen vollen Durchlauf bedeutet

25 000 Bilder bei 30 je Minute sind rund 14 Stunden. Das ist der Preis der
Vorsicht — und angesichts dessen, dass eine Sperre den Bildbestand für Tage
lahmlegen würde, der richtige.

### Tests

Neu `test/image-politeness-db.test.js` mit vier Teilschritten plus einer Prüfung
des User-Agent: Produktkennung, Version, umschaltbar, und die alte Tarnung darf
nicht zurückkommen. Beide Gegenproben bestanden.

657 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 114 (hardened-210) — Die Version im User-Agent stimmte nicht

Marcos Frage: „Was wird neu als user_agent gesendet?"

Beim Nachsehen — und die Frage war der einzige Grund, warum ich nachgesehen
habe — kam heraus:

    BrickInventoryManager/3.0 (self-hosted; +https://github.com/brickinventory)

„3.0" ist ein Vorgabewert, der seit Jahren nicht stimmt. Gesendet werden sollte
die Version der Installation.

### Die Ursache

`require('../package.json')` löst vom Ordner des MODULS aus auf, nicht vom
Projekt. Übersetzt liegt das Modul unter `dist/routes/`, sucht also
`dist/package.json` — die gibt es nicht, weder hier noch im Container. Der
Fehler landete im `catch`, übrig blieb der Vorgabewert.

Ich hatte diese Zeile aus `db/database.ts` übernommen, wo sie dasselbe Problem
hat. Dort fällt es nicht auf: Für die Schemaversion genügt „unknown", um
Migrationen auszulösen.

Neu `utils/appVersion.ts`: EINE Stelle, die mehrere Orte durchprobiert.

### Gemessen

    BrickInventoryManager/2026.08.23.1015 (self-hosted; +https://github.com/brickinventory)

### Test

Der Test prüft jetzt am ÜBERSETZTEN Stand statt an der Quelle — genau zwischen
beiden lag der Fehler. Er lädt `dist/routes/sets.js`, führt die Funktion mit dem
richtigen Modulkontext aus und vergleicht mit der Version aus package.json.

Gegenprobe: den zweiten Suchort entfernt → „BrickInventoryManager/unbekannt",
Test rot.

Eine Lehre, die ich mir merken sollte: Ein Test, der die QUELLE liest, sieht
nicht, was der übersetzte Stand tut. Bei allem, was von Dateipfaden abhängt,
muss gegen dist/ geprüft werden.

657 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 115 (hardened-211) — Die Vorschau-Sperre nahm dem Pool Verbindungen weg

Marcos Log:

    timeout exceeded when trying to connect … at getSets

Nicht die Bildarbeit scheiterte, sondern eine gewöhnliche Anfrage bekam keine
Datenbankverbindung mehr.

### Die Ursache — mein eigener Fix von Nachtrag 100

`mitVorschauSperre` lieh sich für die Dauer JEDER Verkleinerung eine
Pool-Verbindung. Das war die Korrektur eines echten Fehlers (Nehmen und
Freigeben müssen auf DERSELBEN Verbindung laufen) — nur am falschen Ort geholt.

Der Pool ist auf 10–15 Verbindungen je Arbeitsprozess ausgelegt und dafür da,
ANFRAGEN zu bedienen. Auf dem Primärprozess halten Preis-Job,
Anleitungs-Warteschlange und Teile-Anreicherung ohnehin schon je eine dauerhaft
fest — und dieser Prozess bedient nebenbei Anfragen. Eine weitere, die über die
ganze Jimp-Arbeit gehalten wird, war zu viel.

Dasselbe Muster wie in Nachtrag 103: ein richtiger Gedanke im heissesten Pfad.

Neu `db.eigeneVerbindung()`: eine Verbindung AUSSERHALB des Pools, einmal
aufgebaut und wiederverwendet. Sie kostet eine zusätzlich, dauerhaft — das ist
der Preis dafür, dass eine Sitzungssperre an ihrer Sitzung hängt.

### Dazu: ein fehlender Index

Der Job sucht alle 20 Sekunden die ÄLTESTEN Einträge der Warteschlange. Mit ein
paar Dutzend Zeilen gleichgültig; mit rund 25 000 (nach „Katalogbilder holen")
bedeutet jeder Lauf einen vollständigen Durchgang samt Sortierung — dreimal je
Minute. `db/migrations/0010-image-wanted-index.sql`.

### Gemessen

    Pool vor der Sperre : {"total":2,"idle":2,"active":0}
    Sperre genommen     : true
    Pool mit Sperre     : {"total":2,"idle":2,"active":0}   ← unverändert

### Tests

Zwei neue Regeln (Sperre ohne Pool-Verbindung, Index vorhanden), die alte Regel
aus Nachtrag 100 auf die neue Fassung gezogen. Gegenprobe bestanden.

Eigene Falle, zum zweiten Mal in dieser Reihe: Der erste Test der Datei schloss
den Pool in seinem `finally`, der neue lief danach ins Leere. Jetzt schliesst
der LETZTE DB-Test.

659 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 116 (hardened-212) — Die Pause galt für den billigen Teil, nicht für den teuren

Marcos Log: Zeile um Zeile „[image-queue] N Bilder lokal abgelegt", dazwischen
`Connection terminated due to connection timeout` — bis hin zum
Sitzungsspeicher, der keine Verbindung mehr bekam.

### Der Fehler

Die Verzögerung aus Nachtrag 113 hing an einem Zähler, der nur echte DOWNLOADS
zählte. Lag ein Bild bereits lokal, fehlte ihm aber die Vorschau, lief ein
anderer Zweig: Vorschau rechnen, `continue` — OHNE Pause.

Nach dem Knopf „Katalogbilder holen" ist genau das der Normalfall: Bei Marco
lagen 16 000 Bilder bereits, ihnen fehlte nur die Vorschau. Der Job rechnete
also zehn Verkleinerungen je Durchgang am Stück, ohne Atempause, auf einem
Raspberry Pi.

Eine Verkleinerung ist die TEUERSTE Einzelarbeit im Server. Dass die Pause
ausgerechnet den teuren Teil nicht betraf, war der Fehler — und dass „Bilder
lokal abgelegt" im Log auch dann steht, wenn gar nichts geladen wurde, hat mich
die Lage falsch einschätzen lassen.

### Jetzt

Der Zähler heisst `arbeit` und zählt beides: einen Download ODER eine
Verkleinerung. Zwischen je zwei Schritten liegt die Pause von 500–1000 ms.

### Gemessen

Zehn Sets, Bilder vorhanden, Vorschauen fehlend — Marcos Lage:

    Vorschauen gerechnet   10
    Abstände (ms)          535 … 862
    Dauer                  6691 ms   (vorher: wenige hundert)

### Test

Neuer Teilschritt in `image-politeness-db`, der genau diesen Fall nachstellt.
Gegenprobe bestanden (ohne die Pause: kleinster Abstand 0 ms).

### Zum dritten Mal dieselbe Falle im Test

Der erste Test einer Datei schloss den Pool und nahm das Abfangen zurück; der
neue lief danach ins Leere. Das ist mir jetzt dreimal passiert
(Nachträge 108, 115, 116). Die Regel dazu, damit sie hier steht: In einer
Testdatei mit mehreren DB-Tests räumt NUR DER LETZTE auf — Pool schliessen und
`Module.prototype.require` zurücksetzen gehören dorthin, nirgendwo sonst.

660 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 117 (hardened-213) — Der webp-Merker galt nur im Proxy

Marcos Log, immer wieder dieselben Sets:

    [thumb] Vorschau fehlgeschlagen für /images/sets/5007579-1.jpg:
            Mime type image/webp does not support decoding

### Der Fehler

Jimp kann webp nicht entpacken. In Nachtrag 104 habe ich das gemerkt — aber nur
im Bild-Proxy. Der JOB ruft `generateThumb()` direkt auf und verschluckte den
Fehler (`.catch(() => {})`). Also:

* Es entsteht keine Datei.
* Beim nächsten Durchgang gilt „Bild da, Vorschau fehlt" — erneuter Versuch.
* Nach jedem Klick auf „Katalogbilder holen" wieder.

Für jedes webp-Bild also ein vergeblicher Jimp-Lauf, der die Datei erst einliest
und dann aufgibt. Zum wiederholten Mal derselbe Befund: Der Schutz existierte,
sein Geltungsbereich war zu eng.

### Gemessen

Drei Durchgänge über dasselbe Set, dessen Vorschau nicht gelingen kann:

    vorher   3 Versuche
    jetzt    1 Versuch, Fehlanzeige dauerhaft gespeichert

### Was das NICHT löst

Marcos Zeitfehler kommen von einer ausgelasteten Maschine — `Connection
terminated due to connection timeout` heisst, dass schon der VERBINDUNGSAUFBAU
zu Postgres nicht durchkommt, nicht dass der Pool leer wäre. Dieser Nachtrag
nimmt eine Quelle vergeblicher Rechenarbeit weg; die grundsätzliche Frage
bleibt, ob Jimp auf einem Raspberry Pi das richtige Werkzeug ist. Siehe die
Anmerkung am Ende.

661 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 118 (hardened-214) — Vorschaubilder mit sharp statt Jimp

Marcos Auftrag, nachdem fünf Nachträge Drosselung nicht gereicht hatten.

### Warum

Jimp ist reines JavaScript. Jede Verkleinerung läuft im selben Thread wie alles
andere — auf einem Raspberry Pi die teuerste Einzelarbeit im ganzen Server. Ich
habe sie in den Nachträgen 95, 99, 100, 113 und 116 immer weiter gedrosselt, und
am Ende blieb: dreissig Läufe je Minute sind immer noch zu viel, weil jeder
einzelne teuer ist.

Die Drosselung war jedes Mal richtig — sie hat nur ein Werkzeugproblem
verwaltet.

### Gemessen (PNG 1200×900 mit Transparenz)

    sharp     16 ms
    Jimp     566 ms          → Faktor 35

    webp:  sharp  12 ms
           Jimp   „Mime type image/webp does not support decoding"

Der webp-Fehler ist genau der, der in Marcos Log immer wieder auftauchte
(Nachträge 104 und 117 haben ihn nur GEMERKT, damit er nicht wiederholt wird —
jetzt tritt er gar nicht mehr auf).

sharp rechnet ausserdem im libuv-Threadpool, also AUSSERHALB des Event-Loops.
Das ist der eigentliche Gewinn: nicht nur schneller, sondern nicht mehr im Weg.
Genau daran hingen Marcos `Connection terminated due to connection timeout` —
selbst der Verbindungsaufbau zu Postgres kam nicht mehr durch.

### Jimp bleibt als Rückfall

sharp lädt eine fertige Binärdatei für Plattform und C-Bibliothek. Steht für
eine Plattform keine bereit, wäre der Ausfall sonst total — keine Vorschau mehr,
nirgends. `verkleinern()` fällt dann auf den alten Weg zurück und schreibt eine
Warnung ins Log.

Der Rückfall greift NUR beim Laden von sharp, nicht bei einem defekten Bild:
Ein defektes Bild soll scheitern und gemerkt werden, nicht zweimal gerechnet.

### Erhalten geblieben

Die drei Eigenschaften, die über Jahre erkämpft wurden, prüft der Test
ausdrücklich: mittiger Zuschnitt (`fit: 'cover'`), weisser Grund statt schwarz
bei Transparenz (`flatten`), und das unteilbare Schreiben über eine temporäre
Datei mit `rename` (Nachträge 41 und 48).

### Dockerfile

Der Kommentar dort beschrieb ausdrücklich, dass NICHTS im Abhängigkeitsbaum
nativ ist. Das stimmt nicht mehr und ist nachgezogen — samt der Warnung, dass
`npm ci` hier ohne `--ignore-scripts` laufen muss, weil sharp sonst seine
Binärdatei nicht lädt und jede Vorschau still über den langsamen Rückfall liefe.

### Drosselung vorerst unverändert

`STAPEL = 10`, Takt 20 s — 30 Bilder je Minute. Die Zahlen können jetzt deutlich
hoch, aber das gehört gemessen und nicht geraten: erst einspielen, `docker
stats` ansehen, dann entscheiden.

Ein bestehender Test verlangte wörtlich `await bg.write(tmpThumb` in BEIDEN
Erzeugern. Umformuliert auf die Aussage — geschrieben wird auf den temporären
Namen — statt auf eine bestimmte Bibliothek.

664 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 119 (hardened-215) — Der Knopf reihte immer den ganzen Katalog ein

Marcos Befund: „Wenn ich auf den Button klicke, werden immer ca. 29 000 Bilder
eingereiht. Auch wenn der Job bereits einmal erfolgreich durchgelaufen ist."

### Warum

Die Route reihte alles ein, was eine Bildadresse hatte und keine Fehlanzeige
trug — ob die Datei schon lokal liegt, prüfte sie NICHT.

Die Begründung, die ich in Nachtrag 111 dafür notiert habe, war zu kurz
gedacht: Ich wollte 25 000 einzelne Dateizugriffe in einer Anfrage vermeiden —
das ist richtig — und habe daraus geschlossen, gar nicht zu prüfen. Dabei geht
es EINMAL: Ein Verzeichnis lesen liefert alle Namen in einem Zug.

Der Job arbeitete das Ergebnis korrekt ab (Datei da → überspringen), aber die
Kachel zeigte Zehntausende offene Bilder, und jede Notiz kostete einen
Durchgang.

### Jetzt

Ein Verzeichnislesen, daraus die Menge der FERTIGEN Sets — Original UND
Vorschau. Fehlt die Vorschau, gehört das Set weiter in die Warteschlange; der
Job holt sie dann nach, ohne erneut zu laden.

Verglichen wird mit derselben Namensregel wie in `downloadSetImage()`
(`[^a-z0-9-]` → `_`). Ohne die verglichen wir Setnummern mit Dateinamen und
fänden nie eine Übereinstimmung.

### Gemessen

Zwanzig Sets, dann „Job läuft durch": 15 mit Bild und Vorschau, 3 nur mit Bild:

    1. Klick   queued 20, skipped  0
    2. Klick   queued  5, skipped 15

Die fünf sind die drei halben und die zwei unberührten — genau richtig.

### Rückmeldung

Der Toast nennt jetzt beide Zahlen. Ohne die zweite sähe „0 Bilder in der
Warteschlange" nach einem Fehlschlag aus, obwohl es die beste aller Meldungen
ist: alles ist da.

### Tests

Zwei neue Teilschritte, darunter der entscheidende: Nach einem vollständigen
Durchlauf reiht ein Klick NICHTS mehr ein. Gegenprobe bestanden (ohne die
Prüfung: 9 statt 0).

Eigene Falle: Mein neuer Teilschritt leerte die Warteschlange, und der darauf
folgende fand nichts mehr zu tun. Er stellt sie jetzt am Ende wieder her —
Teilschritte in einer Datei laufen der Reihe nach und teilen den Zustand.

665 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

## Nachtrag 120 (hardened-216) — Der Job arbeitete, sagte es aber nicht

Marcos Befund: „Der Bild-CDN-Job scheint zu laufen laut Monitoring und
Fortschrittsbalken, aber im Log sind keine Einträge dazu zu finden."

Zwei Ursachen, beide von mir gebaut.

### 1. Das Schweigen war eingebaut

Der Takt meldete nur, wenn etwas GELADEN wurde. Ein Durchgang, der zehn Notizen
abarbeitet und alle überspringt — weil Bild und Vorschau längst liegen —, sagte
nichts.

Ausgerechnet wenn der Job am schnellsten arbeitet, schwieg er am lautesten. Von
aussen sah das aus wie ein hängender Job, obwohl die Warteschlange schrumpfte.

Der Durchgang liefert jetzt eine Aufschlüsselung statt einer nackten Zahl, und
der Takt meldet jeden Durchgang mit Inhalt:

    [image-queue] 10 bearbeitet: 3 geladen, 2 Vorschau erzeugt, 5 bereits vorhanden

### 2. Die Kachel meldete Betrieb, den sie nicht kannte

„läuft" hiess seit Nachtrag 108: die Warteschlange ist nicht leer. Das ist keine
Aussage über TÄTIGKEIT — eine steckengebliebene Warteschlange sah genauso aus
wie eine, die abgearbeitet wird. Die Anzeige konnte den Unterschied gar nicht
kennen, und genau daran ist Marco hängengeblieben.

Jetzt zählt der Zeitpunkt des letzten Durchgangs. Bleibt er aus, steht die
Kachel auf „idle" UND nennt den Grund: „Job noch nicht gelaufen" oder „seit
N min kein Durchgang".

Festgehalten wird er im Durchgang selbst, nicht im Takt: Wer ihn ausführt, hat
gearbeitet — gleich, von wo er gerufen wurde.

### Tests

Neu: Der Takt meldet auch reine Übersprünge; die Kachel unterscheidet
„Warteschlange gefüllt" von „Job tätig". Beide Gegenproben bestanden.

Vier bestehende Testdateien lasen den Rückgabewert als Zahl. Sie lesen jetzt
das Feld, das ihre jeweilige Aussage trägt (`.gesamt`) — umformuliert, nicht
abgeschaltet.

666 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

---

## Nachtrag 121 (hardened-217) — Das Kontingent galt für Notizen statt für Anfragen

Marcos Log, fünfmal hintereinander:

    [image-queue] 10 bearbeitet: 0 geladen, 0 Vorschau erzeugt, 10 bereits vorhanden

daneben in der Kachel: `1113 Katalog-Bilder in Warteschlange · Job noch nicht
gelaufen`. Seine Frage: „Wieso ist die Verarbeitung so langsam? Anscheinend wird
ja nichts abgearbeitet?"

Abgearbeitet wurde durchaus — die Warteschlange schrumpfte um zehn je Durchgang.
Es war nur die langsamste denkbare Art, nichts zu tun.

### 1. Übersprünge verbrauchten das CDN-Kontingent

`jobs/imageQueue.ts`

Die Taktung stand fest: `STAPEL = 10` Notizen je `TAKT_MS = 20_000`. Das sind
dreissig je Minute, also gut 37 Minuten für Marcos 1113 — davon praktisch die
ganze Zeit Warten.

Die Dreissiger-Grenze ist Marcos Vorgabe gegen eine Sperre durch das CDN („nur
30 Requests pro Minute", Nachtrag 113). Gezählt wurden aber NOTIZEN. In diesen
fünf Durchgängen gab es null CDN-Anfragen: Für alle zehn lagen Bild und Vorschau
längst in `data/images/sets/`. Zwanzig `existsSync`-Aufrufe, wenige
Millisekunden, danach knapp zwanzig Sekunden Stillstand.

Innerhalb eines Stapels war der Zuschnitt längst richtig — der Zähler `arbeit`
sorgt seit Nachtrag 116 dafür, dass Übersprünge keine Höflichkeitspause kosten.
Nur auf den NÄCHSTEN Stapel wirkte er nicht.

Neu `taktDurchgang()`: Ein Takt holt so lange Stapel nach, bis `STAPEL` echte
Arbeitsschritte getan sind (Download oder Verkleinerung), die Warteschlange leer
ist oder `DURCHGANG_MAX_NOTIZEN = 500` erreicht sind. Die Rate am CDN bleibt
damit unverändert bei zehn je zwanzig Sekunden; Marcos 1113 fertige Bilder sind
in gut einer Minute abgeräumt statt in 37.

Der Deckel ist kein Zierrat: `existsSync` ist synchron. Ohne ihn liefe eine
Warteschlange aus 25 000 fertigen Bildern in einem Zug durch und hielte den
Event-Loop des Arbeitsprozesses in Schüben auf.

Die Höflichkeitspause misst jetzt den Abstand zwischen zwei ARBEITSSCHRITTEN,
gleich in welchem Stapel sie liegen (`_letzteArbeit` modulweit statt eines
Zählers je Stapel). Ohne das wäre der erste Arbeitsschritt jedes Folgestapels
ohne Abstand gelaufen — zwei CDN-Anfragen unmittelbar hintereinander, genau das
Muster, das die Vorgabe vermeiden soll.

### 2. „Job noch nicht gelaufen", während im Log Durchgänge stehen

`jobs/imageQueue.ts`, `routes/api_v1/admin.ts`

Der Stand des letzten Durchgangs lag als `letzterLauf` im Arbeitsspeicher des
Moduls. Gesetzt wird er dort, wo der Job läuft (Primär-Worker); gelesen wurde er
in der Monitoring-Route von dem Worker, der die Anfrage zufällig bediente. Bei
vier Workern sah die Kachel in drei von vier Fällen `null` und schloss daraus
auf „noch nicht gelaufen".

Siebte Instanz desselben Musters dieser Reihe: prozesslokaler Zustand im
Cluster. Bitter ist, dass es für genau diesen Zweck `utils/jobMonitor.ts` gibt
(„stores status in PostgreSQL so all cluster workers share state") — die
vorgesehene Ablage wurde umgangen.

Der Takt legt den Stand jetzt unter `global_settings.imgqueue_last_run` ab, die
Route liest von dort. Einmal je Takt und nicht je Stapel: Ein Takt besteht jetzt
aus bis zu fünfzig Stapeln, und ein Schreibvorgang alle paar Millisekunden ist
auf der SD-Karte eines Raspberry Pi keine gute Idee.

### 3. Der Verfall verfiel nicht

Bei `NOTIZ_GILT_MS` stand „Ältere Notizen als diese verfallen". Sie verfielen
nicht: Die Abfrage des Stapels grenzt nur ein, was sie AUSWÄHLT — gelöscht wurde
nie etwas. Notizen älter als drei Tage blieben für immer liegen, zählten weiter
in der Kachel (`COUNT(*)` ohne Frist) und liessen den Job verstummen, weil die
Logzeile an `gesamt > 0` hängt. Von aussen sah das aus wie eine Warteschlange,
die bei einer Zahl stehenbleibt.

Neu `loescheVerfallene()`, stündlich im Takt, mit Logzeile.

### Tests

Neu `test/image-queue-pace-db.test.js` mit sechs Prüfungen: ein Takt räumt
fertige Notizen ab; das Kontingent gilt für echte Arbeit; Übersprünge
verbrauchen es nicht (Marcos gemischte Warteschlange); der Deckel greift;
verfallene Notizen werden gelöscht; und ein ANDERER Prozess sieht den Durchgang
bis hinauf zur Kachel — der Job läuft dafür in einem Kindprozess, gefragt wird
im Elternteil.

EIGENER FEHLER beim Bauen dieses Tests: Die erste Fassung des Kontingent-Tests
reihte zehn zu ladende Bilder ein — die lagen alle im ERSTEN Stapel, also wurde
nie eine Stapelgrenze gemessen. Die Gegenprobe „Pause nur innerhalb eines
Stapels" blieb dadurch grün. Jetzt muss jeder dritte Eintrag geladen werden, der
Rest liegt fertig da, und eine Vorbedingung im Test wird rot, falls die Anfragen
doch wieder in einen Stapel fallen.

ZWEITER Fund dabei: Ein einzelnes `INSERT … generate_series` trägt für ALLE
Zeilen dasselbe `NOW()` ein — `ORDER BY requested_at ASC` ist dann beliebig, und
ein Test, der auf Stapelgrenzen zielt, misst Zufall. Der Einreih-Helfer setzt
`requested_at` jetzt zeilenweise aufsteigend.

Sechs Gegenproben bestanden: nur ein Stapel je Takt; Kontingent auf Notizen;
Pause ganz entfernt; Pause nur innerhalb eines Stapels; Verfall löscht nichts;
Route liest wieder den Modulspeicher; `speichereLauf` entfernt.

Im bestehenden Kachel-Test (`image-queue-db.test.js`) ersetzt ein Löschen der
DB-Zeile das frühere `letzterLauf.zeit = null` — genau diese Zeile hat
mitverdeckt, dass die Kachel eine prozesslokale Zahl las.

675 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

---

## Nachtrag 122 (hardened-218) — Vier stille Ausgänge, ein Zähler für alle

Marcos Log:

    [image-queue] 2 bearbeitet: 0 geladen, 0 Vorschau erzeugt, 0 bereits vorhanden
    [image-queue] 2 bearbeitet: 0 geladen, 0 Vorschau erzeugt, 0 bereits vorhanden

und seine Frage: „Wieso werden die 2 Bilder nicht geladen?"

Die Zahlen gehen nicht auf, und das war kein Zufall. VIER Wege durch die
Schleife in `arbeiteStapel()` endeten, ohne einen der drei Zähler zu erhöhen:

1. Notiz ohne Setnummer (`if (!r.set_number) continue`)
2. Verkleinerung gescheitert (der Erfolgsfall zählt, der Fehlschlag nicht)
3. Download gescheitert (404, Netzwerkfehler, zu kleine Antwort)
4. Abbruch nach einer Drosselung durch das CDN

Die Meldung konnte die vier nicht unterscheiden und meldete für alle dasselbe
Nichts. Aus dieser Zeile ist die Frage nicht zu beantworten — und das ist der
eigentliche Fehler, nicht die zwei Bilder.

Das ist derselbe Befund wie in Nachtrag 120, eine Ebene tiefer: Dort schwieg der
Job, wenn nichts GETAN wurde; hier schweigt er, wenn etwas SCHIEFGING.

### 1. Ein Zähler je Ausgang

`jobs/imageQueue.ts`

`StapelErgebnis` bekommt `nichtGeladen`, `keineVorschau`, `bekanntFehlend`,
`ohneNummer` und `zurueckgelegt`. Neu `meldung(e)` als EINZIGE Stelle, die den
Text baut — genannt wird, was nicht null ist:

    [image-queue] 2 bearbeitet: 0 geladen, 0 Vorschau erzeugt, 0 bereits vorhanden, 2 Download fehlgeschlagen

Bei wenigen Fällen (bis fünf) nennt eine zweite Zeile die Setnummern beim Namen:

    [image-queue] 4287-1: Download fehlgeschlagen (HTTP 404) · 6285-1: Vorschau fehlgeschlagen

Eine Zahl sagt „zwei sind gescheitert", nicht WELCHE. Mit der Setnummer
beantwortet `GET /api/v1/admin/image-diag/:setNumber` (Nachtrag 50) den Rest in
einer Antwort.

Neu `leeresErgebnis()` als einzige Stelle, an der die Zähler aufgezählt werden —
sonst wird beim nächsten Zähler eine der drei Fundstellen vergessen.

### 2. Zurückgelegt ist nicht bearbeitet

`erg.gesamt` stand auf `rows.length` — auch dann, wenn der Stapel schon an der
ERSTEN Zeile in eine Drosselung lief und alle zehn Notizen zurück in die
Warteschlange gingen. Im Log stand dann „10 bearbeitet", obwohl null Zeilen
verbraucht waren. Genau diese Kombination erklärt Marcos zwei identische Zeilen
im Abstand der Drosselpause. Jetzt `rows.length - zurueckgelegt`, und der Takt
meldet auch einen Durchgang, der NUR zurückgelegt hat.

### 3. Bekannt Aussichtsloses kostet weder Kontingent noch Wartezeit

`merkeFehlend('set:…')` wurde geschrieben, aber im Job nirgends gelesen — der
Knopf „Katalogbilder holen" achtet darauf (per SQL), der Job nicht. Eine Notiz,
die über den Proxy erneut entsteht, löste deshalb bei jedem Durchgang wieder
einen Roundtrip zu einem Bild aus, von dem längst feststand, dass der CDN es
nicht hat. Jetzt `istBekanntFehlend('set:…')` VOR der Pause.

Dasselbe bei den Vorschauen: Die Prüfung stand INNERHALB von
`vorschauErzeugen()`, also hinter Pause und Kontingent. Eine Verkleinerung, die
nie gelingen kann, kostete bei jedem Durchgang eine Höflichkeitspause UND einen
Platz im CDN-Kontingent — für einen Aufruf, der sofort `false` zurückgibt. Zehn
solcher Notizen verbrauchten einen ganzen Takt mit reinem Schlafen. Beide
Prüfungen stehen jetzt vor beidem: Was den CDN nichts kostet, darf ihn auch
nichts kosten.

### Tests

`test/image-queue-pace-db.test.js` um „jeder Ausgang der Schleife hat einen
Zähler" erweitert (Notiz ohne Setnummer, gescheiterter Download, bekannt
fehlendes Bild ohne Kontingent und ohne Wartezeit).
`test/image-throttle-db.test.js` prüft im 403-Fall jetzt auch, dass `gesamt` auf
null steht und `zurueckgelegt` die zehn nennt.

EIGENE FALLE: Der erste Anlauf stellte `downloadSetImage` im Teilschritt per
`Object.defineProperty` auf null um — wirkungslos, weil der require-Abfang oben
in der Testdatei für diesen Namen IMMER seinen eigenen Ersatz liefert und den
Patch stillschweigend überschreibt. Dieselbe Klasse wie die esbuild-Getter aus
Nachtrag 143. Aufgefallen ist es nur, weil der Test die WIRKUNG prüft und nicht
den Patch. Der Ersatz trägt den Schalter jetzt selbst.

UMFORMULIERT: „der Job meldet auch reine Übersprünge" (Nachtrag 120) hing am
WORTLAUT der Takt-Funktion — `if (e.gesamt)` und der Name `uebersprungen` im
Meldungstext. Als die Meldung nach `meldung()` wanderte, wurde der Test rot,
ohne dass sich seine Aussage geändert hätte; dieselbe Sorte Test, die in
Nachtrag 118 eine Sicherheitslücke festgeschrieben hat. Geprüft wird jetzt, was
der Text SAGT, plus die Gegenrichtung, dass der Takt nicht auf `e.geholt` gatet
und den Text nicht selbst zusammenbaut.

Zehn Gegenproben bestanden (die sechs aus Nachtrag 121 plus: `ohneNummer` zählt
nicht, `nichtGeladen` zählt nicht, bekannt fehlendes Bild wird doch geholt,
`gesamt` zählt Zurückgelegtes mit).

679 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

---

## Nachtrag 123 (hardened-219) — Job und Proxy waren sich uneinig, was „fehlend" heisst

Marcos Log, jetzt mit den Zählern aus Nachtrag 122:

    [image-queue] 2 bearbeitet: 0 geladen, 0 Vorschau erzeugt, 0 bereits vorhanden, 2 als fehlend bekannt

Damit war der Ausgang benannt: Die beiden Bilder stehen in `image_misses` und
werden deshalb gar nicht mehr versucht. Offen blieb, wie sie dorthin kamen — und
das ist die Frage, die zählt.

### 1. Jeder Fehlschlag galt als „Bild existiert nicht"

`jobs/imageQueue.ts`

Der Job vermerkte JEDEN gescheiterten Download ausser 403/429: eine
Zeitüberschreitung, einen DNS-Aussetzer, eine abgebrochene Verbindung, „Antwort
zu klein", „zu viele Weiterleitungen", ein zu grosses Bild — und über den
umgebenden catch sogar einen Schreibfehler auf der eigenen Platte. Alles davon
sperrte das Bild SIEBEN TAGE aus, und von aussen war nicht einmal zu erkennen,
dass es je einen Versuch gab.

Der Bild-Proxy macht es längst richtig und begründet es im Code: dort wird nur
bei 404 gemerkt, weil ein 403 beim CDN auch als Drosselung vorkommt. Zwei
Bauteile, DIESELBE Tabelle, zwei verschiedene Auslegungen von „fehlend" — wieder
„Regel fehlt am zweiten Weg", diesmal als Widerspruch statt als Lücke.

Jetzt gilt auch im Job: nur 404 und 410 heissen „das Bild gibt es nicht". Ein
vorübergehender Fehler wird gezählt und benannt, aber nicht vermerkt; entsteht
die Notiz über den Proxy neu, wird es erneut versucht.

### 2. Der Grund wird festgehalten

`db/migrations/0011-image-misses-grund.sql`, `utils/imageMisses.ts`

`image_misses` bekommt eine Spalte `reason`; `merkeFehlend(key, grund)` schreibt
sie mit, `grundFuer(key)` liest sie. Ohne den Grund ist „gilt als fehlend" keine
Auskunft, sondern nur eine andere Formulierung derselben Frage. Altbestände
bleiben NULL — dafür sagt es der Hinweis in image-diag ausdrücklich.

Die Meldung des Jobs nennt jetzt auch bei bekannt fehlenden Bildern die
Setnummer samt Grund. Ohne Setnummer führt kein Weg zu image-diag.

### 3. image-diag sah ausgerechnet diese Tabelle nicht an

`GET /api/v1/admin/image-diag/:setNumber` sollte seit Nachtrag 50 „warum fehlt
das Bild für Set X?" in EINER Antwort beantworten. Es prüfte Datenbank, Platte
und Proxy-Cache — nur nicht die Tabelle, die den Abruf VERHINDERT. Steht dort
ein Eintrag, ist jede andere Auskunft gegenstandslos. Neu im Ergebnis:
`merker: { seit, grund }` plus ein Klartext-Hinweis.

### 4. Zurücknehmen war gar nicht vorgesehen

Neu `POST /api/v1/admin/forget-image-misses` (`set_numbers` optional, sonst alle
Set-Vermerke; `thumbs: true` nimmt die Vorschau-Vermerke mit).

Bis hierher gab es keinen Weg, eine Fehlanzeige zurückzunehmen — man konnte nur
sieben Tage warten. Der Knopf „Fehlende neu laden" hilft dabei nicht: Er sieht
ausschliesslich Zeilen mit gesetztem `image_local` an, also Bilder, die schon
einmal da waren. Ein Katalogbild, das nie ankam, fiel durch jedes Raster.

Ohne Angabe werden bewusst NUR die `set:`-Vermerke entfernt: Die
Vorschau-Vermerke halten fest, dass eine Verkleinerung nicht gelingen KANN, und
haben damit einen anderen Zweck. Der Merker der übrigen Arbeitsprozesse liegt im
Speicher und frischt sich im Fünf-Minuten-Takt vollständig aus der Tabelle auf —
länger dauert es dort also nicht.

### Tests

Neu `test/image-misses-reason-db.test.js`: 404 wird mit Grund gemerkt; eine
Zeitüberschreitung sperrt NICHT aus; Job und Proxy legen denselben Massstab an;
image-diag nennt Merker und Grund; Zurücknehmen wirkt auch im Arbeitsspeicher;
Vorschau-Vermerke bleiben bei einem Lauf ohne Angabe unangetastet.

Fünf Gegenproben bestanden (unbedingtes Merken zurück; Grund nicht mitschreiben;
image-diag ohne Merker; Rücknahme leert den Speicher nicht; Rücknahme ohne
Angabe nimmt alles mit). Zwei davon trafen im ersten Anlauf ihre Zeile gar nicht
und liefen deshalb grün durch — MERKE: Bei einer Gegenprobe per Textersetzung
gehört ein `assert alt in s` davor, sonst prüft man nichts und hält es für einen
Erfolg.

687 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

---

## Nachtrag 124 (hardened-220) — „Katalogbilder holen" nimmt Fehlanzeigen zurück

Marcos Wunsch: „Kannst du die Logik von ‚Alle fehlenden Katalogbilder' so
anpassen, dass er die image_misses löscht und sie erneut versucht? Aktuell
stehen in der Tabelle sehr viele Einträge."

Die vielen Einträge sind mein Fehler aus Nachtrag 123: Bis dahin vermerkte der
Job JEDEN gescheiterten Download als „dieses Bild gibt es nicht" — auch eine
Zeitüberschreitung, einen DNS-Aussetzer oder einen Schreibfehler auf der eigenen
Platte. Diese Einträge sind schlicht falsch, und der Knopf war die einzige
Stelle, an der sie jemandem im Weg standen: Er nahm Sets mit Fehlanzeige
ausdrücklich aus.

### Welche zurückgenommen werden

Nicht alle — und das ist die eigentliche Entscheidung. Ein bestätigter 404
heisst wirklich „kein Bild vorhanden"; für alte Sets hat Rebrickable meist
keines, das sind Tausende. Die alle erneut zu holen wäre bei dreissig Anfragen
je Minute ein halber Tag reiner 404-Verkehr — und beim nächsten Klick wieder.
Genau davor schützt `image_misses` seit ihrer Einführung.

Zurückgenommen wird deshalb, was NICHT als bestätigter 404 vermerkt ist: die
Altbestände ohne Grund und alles, was vorübergehend gescheitert ist. Seit
Nachtrag 123 trägt ein echter 404 seinen Grund in der Spalte `reason`, und die
Sache heilt sich selbst: Ein Altbestand, der beim erneuten Versuch wieder 404
liefert, wird diesmal richtig vermerkt und bleibt beim nächsten Klick draussen.
Nach ein, zwei Durchläufen enthält die Tabelle nur noch, was hineingehört.

`{ "alle_erneut": true }` nimmt auch die bestätigten 404er zurück — für den
Fall, dass der CDN Bilder nachgereicht hat. Bewusst nicht die Vorgabe.

### Die Rückmeldung sagt jetzt, was passiert

Neu in der Antwort: `verworfen` (zurückgenommene Fehlanzeigen) und
`dauer_minuten`. Ohne die erste Zahl bliebe unklar, warum plötzlich wieder
Bilder anstehen, die zuletzt als fehlend galten; ohne die zweite ist „29 000 in
der Warteschlange" keine Auskunft darüber, ob das Minuten oder Stunden dauert.
Die Rate kommt aus `anfragenJeMinute()` im Job selbst, damit sie nicht an zwei
Stellen gepflegt wird und beim nächsten Ändern von STAPEL oder TAKT_MS
auseinanderläuft.

Neue Schlüssel `monitor.catalog_images_retried` und `monitor.catalog_images_eta`
in de und en; beide werden nur genannt, wenn sie ungleich null sind.

### Tests

`test/catalog-images-button-db.test.js` umgestellt: Die Bühne trägt jetzt eine
Fehlanzeige MIT bestätigtem 404 (bleibt draussen) und eine OHNE Grund (wird
zurückgenommen). Dazu ein Teilschritt für `alle_erneut`. Drei Gegenproben
bestanden (keine Rücknahme; auch bestätigte 404er zurücknehmen; `alle_erneut`
wirkungslos).

ZWEI EIGENE FEHLER dabei, beide vom Test gefunden:
- Erwartung auf neun statt acht eingereihte Sets — schlicht falsch gezählt.
- Der neue Teilschritt stand ZUERST und nahm die Fehlanzeige von `_3` zurück.
  Die Job-Prüfungen darunter sahen dadurch einen Download mehr als erwartet. Die
  Teilschritte dieser Datei teilen sich eine Bühne; wer sie verändert, gehört
  ans Ende. Steht jetzt als Begründung im Test.

688 Tests grün gegen echtes Postgres 16, 0 übersprungen, 0 abgebrochen.

---

## Nachtrag 125/126 (hardened-221) — Aufräumen, Durchgang 1 und 2

Marcos Frage: „Gibt es noch Dinge, die man softwaretechnisch verbessern könnte?
Klassen abstrahieren, Funktionen auslagern?" Gemessen ergaben sich fünf Punkte;
dies sind die ersten zwei Durchgänge am grössten davon.

### Der Befund

247 späte `require()` (157 in Funktionsrümpfen) und **129 Import-Zyklen**. Die
Ursache ist mechanisch: Router-Dateien exportieren Hilfsfunktionen. Wer die
braucht, importiert den Router, das schliesst einen Kreis, und der Kreis
erzwingt das späte `require()`.

Der Preis ist nicht theoretisch: `require()` liefert `any`, tsc prüft den NAMEN
also nicht. Genau daran hingen die beiden 500er aus Nachtrag 131.

### Durchgang 1 — Helfer aus routes/sets.ts

| Was | Wohin | Aufrufer |
|---|---|---|
| `getUserDefaultCondition` | gelöscht — Dublette | 11 |
| `downloadSetImage`, `bildUserAgent`, `SET_IMG_MAX_BYTES` | `utils/setImages.ts` | 20 |
| `getCurrentMarketPrice` | `utils/marketPrice.ts` | 7 |

`getUserDefaultCondition` war eine wortgleiche Zweitfassung von
`effectiveCondition()` in utils/settings.ts — dieselben zwei Abfragen, dieselben
Schlüssel. Ein Unterschied: Die Router-Fassung reichte einen ungültigen globalen
Wert durch (`|| 'N'`), die Utils-Fassung normalisiert. Die strengere gewinnt.

### Durchgang 2 — zwei Bauteile am falschen Platz

**routes/finance.ts war eine Durchreiche.** Im Anhang standen dreizehn Namen,
von denen die Datei KEINEN selbst herstellt: elf leben in utils/financeCalc.ts,
je einer in utils/settings.ts und utils/images.ts. Bezahlt wurde das mit
siebzehn späten `require('./finance')` in acht Dateien. Jetzt `export = router`.

**clients/ statt routes/.** `rebrickable.ts` und `brickset.ts` enthalten NULL
Routen und werden nirgends montiert — reine API-Clients, in routes/ nur aus
Gewohnheit. Wer sie importierte, importierte scheinbar einen Router.

### Zwei eigene Fehler, beide gefangen

**server.ts hätte geworfen.** Ich hatte 19 der 20 Aufrufer von
`downloadSetImage` umgestellt und einen übersehen — ein spätes `require()` auf
einen Namen, den es dort nicht mehr gab. Gefunden von
`test/require-exports.test.js`, also von dem Test, den es nur wegen dieses
Musters gibt.

**Ein API-Name ist kein Pfad.** Beim Umzug nach clients/ hat meine
Textersetzung auch das getroffen:

    checkAndIncrementRateLimit('rebrickable')  →  ('../clients/rebrickable')

Das sind die Schlüssel der TAGESKONTINGENTE. Unter einem neuen Schlüssel hätte
jede API bei null zu zählen begonnen — lautlos, ohne Absturz, nur ein
Kontingent, das nie mehr erreicht wird. Neun Stellen in vier Dateien. Beim
Zurückdrehen habe ich dann prompt zu breit ersetzt und drei echte Modulpfade
mitgenommen (500er: „Cannot find module 'rebrickable'").

Neu `test/module-layout.test.js` mit drei Prüfungen, die genau diese beiden
Verwechslungen fangen (plus: clients/ enthält keine Routen und steht im
Bauskript). Alle drei per Gegenprobe gegen meine echten Fehler verifiziert.

### Beinahe-Fehler

`scripts/build-ts.js` kennt eine feste Liste `SRC_DIRS`. Ohne den Eintrag
`'clients'` wäre kein `dist/clients/` entstanden und JEDER Import darauf beim
Start ins Leere gelaufen — derselbe Fehler, den das Projekt bei `jobs/` schon
einmal hatte (siehe test/jobs-typescript.test.js). Der neue Test hält es fest.

### Wirkung

| | vorher | nachher |
|---|---|---|
| Import-Zyklen | 129 | **27** |
| späte `require()` in Rümpfen | 247 | 210 |

691 Tests grün gegen echtes Postgres 16, 0 übersprungen.

### Testarbeit

27 Tests wurden nach Durchgang 1 rot, keiner wegen geänderten Verhaltens: acht
`Module.prototype.require`-Abfänge zeigten auf `routes/sets` und liefen ins
Leere (hätten also still den echten CDN-Download gemessen), der Rest waren
quelltextlesende Prüfungen am alten Fundort. Aussagen unverändert, Pfade
nachgezogen, Begründung jeweils im Test.

EIGENE FALLE dabei: In review-131.test.js habe ich per Massenersetzung BEIDE
Verweise auf routes/sets.ts umgezogen — der zweite gehörte zur
CSV-Fortschrittsprüfung, die weiterhin im Router lebt.

### Offen in Punkt 1

`addSet` (139 Z.), `updateSet` (156 Z.), `buildSetsCsv` und die
Anleitungs-Kette (`downloadSetInstructions` + `collectAndBuildPDF`, zusammen
~180 Zeilen) stehen weiter in routes/sets.ts. Die Punkte 2 bis 5 (initSchema
als .sql, registerImgProxy aufteilen, Frontend-Dateien, Android-Signaturen)
sind noch nicht angefasst.

---

## Nachtrag 127 — Aufräumen, Durchgang 3: die Anleitungs-Kette

Vier Funktionen aus `routes/sets.ts` nach `utils/instructions.ts` (221 Zeilen):
`downloadSetInstructions`, `scrapeInstructionsFromFallback`, `collectAndBuildPDF`
und `buildImagePDF_fromBuffers`.

Sie hatten drei Aufrufer ausserhalb, und keiner konnte sie importieren. Der
Brickset-Client holte sie per `require('../routes/sets')` — Kreis
`sets → brickset → sets`. Die Anleitungs-Warteschlange ging weiter:

    let fetchInstructions;
    try { fetchInstructions = require('../routes/sets').fetchInstructions; } catch(_) {}
    if (typeof fetchInstructions !== 'function') { scheduleNext(2000); return; }

Ein try/catch, eine typeof-Prüfung und ein stiller Abbruchpfad — nötig nur,
weil niemand garantieren konnte, dass der Name zur Laufzeit existiert. Genau
dieser Fall ist in Nachtrag 131 zweimal eingetreten. Mit dem echten Import
prüft tsc den Namen; die drei Zeilen entfallen ersatzlos.

Der Aliasname `fetchInstructions`, unter dem der Router die Funktion nach aussen
gab, entfällt ebenfalls — sie heisst überall `downloadSetInstructions`.

### MEIN FEHLER: ein neuer Kreis, diesmal einer, der knallt

`utils/instructions.ts` braucht den Brickset-Client. Der Client holte am Ende
seiner Wiederholungsschlange Bauanleitungen nach. Also:

    instructions → brickset → instructions

Ein spätes `require()` hätte das überlebt — es läuft erst beim Aufruf. Eine
`import`-Anweisung nicht: Zur Ladezeit ist eine der beiden Seiten `undefined`,
und das fällt erst im Betrieb auf. **Beim Umbau von require() auf import wird
aus einem harmlosen Kreis ein Fehler.** Das ist die eigentliche Lehre dieses
Durchgangs.

Aufgelöst, indem `processRetryQueue` als `jobs/bricksetRetry.ts` eigenständig
wurde: Sie ist Ablaufsteuerung (Tabelle lesen, Client rufen, Anleitungen
nachholen), keine API-Anfrage. Beim Herauslösen zuerst nur den Wrapper
erwischt und den inneren `_processRetryQueue` stehen gelassen — tsc hat es
gemeldet.

### Diagnose-Falle

Der erste Suitelauf nach dem Umzug meldete 64 rote Tests bei nur 525 statt 691
gefundenen. Das sah nach dem Kreis aus, war aber die Umgebung: Postgres war
zwischen zwei Läufen gestorben. Genau das Symptom aus der Warnung von Nachtrag
149 — plötzlich ~100 Tests WENIGER und viele rote DB-Tests auf einmal.
`pg_ctl status` zuerst, dann Ursachenforschung.

### Neue Prüfung

`test/module-layout.test.js` um „keine Zyklen über echte import-Anweisungen"
erweitert. Späte `require()` sind bewusst NICHT mitgezählt — sie abzubauen ist
das laufende Vorhaben, zur Ladezeit sind sie ungefährlich. Gegenprobe: meinen
echten Kreis wiederhergestellt → rot.

### Stand

| | Anfang | jetzt |
|---|---|---|
| Zyklen über `import` | — | **0** |
| Zyklen inkl. `require()` | 129 | 31 |
| `routes/sets.ts` | 1674 Z. | **1333 Z.** |
| Export-Anhang von sets.ts | 8 Namen | 3 (`addSet`, `updateSet`, `buildSetsCsv`) |

692 Tests grün gegen echtes Postgres 16.

---

## Nachträge 128–130 (hardened-222) — Aufräumen, Punkte 2 bis 4

### Nachtrag 128 — das Grundschema als .sql

426 Zeilen reines SQL (kein einziges `${…}`) aus `initSchema()` nach
`db/schema.sql`. `db/database.ts` von 1655 auf 824 Zeilen.

In der Funktion blieb alles mit Bedingung: nachträgliche Spalten-Migrationen,
das Anlegen des ersten Verwalters, die pg_trgm-Behandlung (CREATE EXTENSION darf
fehlschlagen) und das Aufräumen alter Token.

ZWEI BEINAHE-AUSFÄLLE:

1. Mein `ladeSchema()` nahm zuerst APP_ROOT. Im Container gibt es die Quellen
   nicht — das Laufzeit-Image enthält nur `dist/`. Richtig ist `__dirname`;
   dass die .sql überhaupt dorthin kommt, besorgt `scripts/build-ts.js`
   (ASSET_EXT). `db/migrate.ts` macht es aus demselben Grund genauso.
2. Das **Dockerfile kopierte `clients/` gar nicht** — aus Nachtrag 126
   mitgeschleppt. Im Container wäre der Server beim ersten Import gescheitert.

Neue Prüfung: Jeder Ordner mit Laufzeit-TypeScript muss in SRC_DIRS UND im
Dockerfile stehen. Reine `.d.ts`-Ordner (types/) sind ausgenommen — das hat mir
der Test selbst beigebracht, indem er beim ersten Lauf darauf ansprang.

### Nachtrag 129 — die Vorschau-Maschinerie des Bild-Proxys

`registerImgProxy()` von 729 auf 665 Zeilen; Warteschlange,
prozessübergreifende Sperre und Verkleinern liegen in `utils/proxyThumbs.ts`.

Dabei fiel eine Globalvariable: Der Fehlerzähler war eine Closure und wurde über
`(global as any).__imgProxyFailures` an die Monitoring-Route gereicht. Mit dem
Aufteilen hätte ihn auch das neue Modul über `global` holen müssen — ein
zweiter ungeprüfter Umweg. Jetzt `utils/imgProxyStats.ts`, ein gewöhnlicher
Import.

EIGENER FEHLER, ZUM DRITTEN MAL DERSELBE: Beim Umbiegen der Testpfade habe ich
`tst0.size < 200` mit auf das neue Modul gezeigt — diese Prüfung gehört zur
AUSLIEFERUNG und ist im Proxy geblieben. Gegenmittel: der Helfer
`proxyThumbQuelle()`. Tests nennen jetzt den GEGENSTAND („der Vorschau-Weg des
Proxys") statt den Ablageort; `serverAll()` umfasst beide Dateien.

### Nachtrag 130 — die zwei Frontend-Grossdateien

`js/01-core.js` (1479 Z.) nannte als Inhalt „Utils, i18n-Glue, Auth & Panels,
Login/Logout, CSV-Import-Fortschrittsbalken" — und enthielt einen kompletten
PDF-Betrachter. `js/07-admin.js` (1492 Z.) nannte „Confirm-Dialog,
Config-Export/Import, API-Tokens, Job-Status" — und enthielt das Kaufpreis-Modal
und das Detailfenster für manuelle Einträge. Beide hiessen nach ihrer
Geschichte, nicht nach ihrem Inhalt.

| neu | Zeilen | aus |
|---|---|---|
| `js/12-pdfviewer.js` | 127 | 01-core.js |
| `js/13-acquisition-modals.js` | 749 | 07-admin.js |

| | vorher | nachher |
|---|---|---|
| 01-core.js | 1479 | 1368 |
| 07-admin.js | 1492 | 775 |

Die Schnittstelle war schmal und schon vorher schmal: Der Modal-Block braucht
drei Helfer aus 07-admin (confirmDelete, renderMarketRows, priceChartSVG) und
gibt einen zurück (renderAcquisitionSummary). Genau das machte den Schnitt
möglich, ohne etwas umzubauen. Die elf Handler der beiden Fenster melden sich
jetzt dort beim Dispatcher an, wo sie umgesetzt werden.

`test/frontend-imports.test.js` fing prompt zwei fehlende Importe („ruft
fullUrl() aus 01-core.js ohne Import") — genau der Zweck dieser Prüfung.

Zwölf weitere Prüfungen lasen `07-admin.js` und meinten „irgendwo in der
Oberfläche rund um Erfassungen". Neuer Helfer `adminQuelle()`, gleiche
Begründung wie bei `proxyThumbQuelle()`.

### Stand

696 Tests grün gegen echtes Postgres 16, 0 übersprungen.

Offen: Punkt 5 (Android-Screens mit 20–26 Parametern auf das
ViewModel-lesende Muster), und aus Punkt 1 weiterhin `addSet`/`updateSet` in
routes/sets.ts.

---

## Nachtrag 131 (hardened-223) — addSet und updateSet, der Abschluss von Punkt 1

Marcos Auftrag: „Kannst du das addSet und updateSet noch abschliessen?"

Die beiden blieben durch die Nachträge 125 bis 127 als einzige in
routes/sets.ts liegen, und der Grund war kein Zufall.

### Warum es nicht ging — und was zuerst musste

`addSet()` ruft `importPartsForSet()` und `importMinifigsForSet()`. Die standen
in routes/parts.ts und routes/minifigs.ts. Ein Modul unter utils/ hätte also
ROUTER importieren müssen — die falsche Richtung: utils/ ist die Schicht, auf
der Routen aufsetzen, nicht umgekehrt. Und ein Kreis über echte
`import`-Anweisungen ist seit Nachtrag 127 als das erkannt, was er ist: ein
Fehler, der zur Ladezeit `undefined` liefert.

Also ging dem Umzug ein Unterbau voraus:

| neu | Zeilen | aus |
|---|---|---|
| `utils/partsImport.ts` | 246 | routes/parts.ts |
| `utils/minifigsImport.ts` | 60 | routes/minifigs.ts |
| `clients/bricklink.ts` | — | routes/bricklink.ts |

`routes/bricklink.ts` hat wie rebrickable und brickset (Nachtrag 126) **null
Routen** und war nie montiert. Aufgefallen ist es erst jetzt, weil
utils/setService.ts von dort `getItemImageUrl()` braucht.

### Der Umzug

`utils/setService.ts` (569 Zeilen): `addSet`, `updateSet`, `buildSetsCsv`,
`recordAcquisition`, `adjustAcquisitionsToQuantity`, `priceForNewAcquisition`,
`recomputeSetCondition`, `sanitizeSetNumber`, `addSetWithDate`.

Das ist Ablaufsteuerung: was passiert, wenn ein Set dazukommt (Bild holen, Teile
und Minifiguren übernehmen, Anleitung einreihen, Preis anstossen) und was, wenn
es sich ändert. Die HTTP-Routen bleiben in routes/sets.ts und rufen von hier.

`routes/sets.ts` ist damit von 1674 (vor Nachtrag 125) auf **813 Zeilen**
geschrumpft, und sein Export-Anhang ist leer: `export = router`.

### MEIN FEHLER — ein echter Laufzeitfehler

Mit `addSet` wanderte diese Zeile wortgleich mit:

    require('./parts').fetchMissingBlIds().catch(() => {});

Aus utils/ gesehen gibt es `./parts` nicht. Der Aufruf steht in einem
`setImmediate(...)`, also wäre der Fehler erst beim Anlegen eines Sets geflogen
— und ausserhalb jedes `.catch()`. Im Test tauchte er nur als „asynchronous
activity after the test ended" auf.

`require-exports.test.js` sieht das NICHT: Es prüft, ob ein Modul den NAMEN
exportiert, nicht ob es das Modul überhaupt gibt. Neu in
`test/module-layout.test.js`: „jedes späte require() zeigt auf eine Datei, die
es gibt". Verwandt mit „kein Modul unter blossem Namen", aber die andere Hälfte
— dort war der Pfad zu kurz, hier zeigt er ins Leere.

Beim Aufräumen sind gleich acht weitere späte `require()` in setService durch
die ohnehin vorhandenen Importe ersetzt worden.

### Neuer Testhelfer

Zwölf Prüfungen lasen `routes/sets.ts` und meinten „irgendwo im Weg, auf dem ein
Set entsteht oder sich ändert". Neu `setKernQuelle()` — dieselbe Begründung wie
bei `proxyThumbQuelle()` und `adminQuelle()`: den GEGENSTAND nennen, nicht den
Ablageort.

### Stand

| | vor Nachtrag 125 | jetzt |
|---|---|---|
| Zyklen über echte `import` | — | **0** |
| Zyklen inkl. `require()` | 129 | 35 |
| späte `require()` in Rümpfen | 247 | 204 |
| `routes/sets.ts` | 1674 | **813** |

Zwei Gegenproben nachgespielt: mein `require('./parts')` wiederhergestellt →
rot; utils importiert wieder einen Router → Zyklusprüfung rot.

697 Tests grün gegen echtes Postgres 16, 0 übersprungen. Damit ist Punkt 1 des
Aufräumens abgeschlossen und alle fünf Punkte sind umgesetzt.

---

## Nachträge 132–134 (hardened-224) — die drei Punkte aus der zweiten Messung

### Nachtrag 132 — späte require() zu echten import

**204 → 88.** Umgewandelt wurde mit einem Werkzeug, das nur anfasst, was ALLE
Bedingungen erfüllt: relativer Pfad, Ziel existiert, Name wird dort wirklich
exportiert, kein Kreis, Name nicht anderweitig belegt. 126 Umwandlungen; 14
bewusst übersprungen (7 Umbenennungen, 5 bereits importiert, 1 echter Kreis, 1
ohne Ankerpunkt).

Und genau darum ging es: `require()` liefert `any`, `import` liefert Typen. Vier
Fehler, die jahrelang verborgen waren, meldete tsc sofort:

**1. `clearSubsetsCache()` — „erwartet 1 Argument, bekam 0".** Der Parameter war
ohne Vorgabe deklariert, obwohl der else-Zweig GENAU den Aufruf ohne Argument
bedient (Verwaltung → „Alle Caches leeren").

**2. `string | string[]` an drei Stellen.** `@types/express@5` typisiert
Routen-Parameter so, und Abfrageparameter SIND es zur Laufzeit:
`?accounts=a&accounts=b` liefert ein Array. Neuer Helfer `einzelwert()` in
utils/validate.ts — bei mehreren Werten gewinnt der erste, weil ein
zusammengefügtes „a,b" eine Setnummer wäre, die es nicht gibt.

**3. `page_size` fehlte an zwei von drei Rückgabewegen von `getParts()`.** Der
Kommentar über der Route erklärt, dass genau dieses Feld dem Client sagt, ob
Teile fehlen — auf der CSV- und der Rebrickable-Ausweichebene stand dort
`undefined`, und die Prüfung „total > page_size" konnte nie greifen.

NEBENBEFUND, nicht behoben: Die Anwendung läuft auf Express 4, hat aber
`@types/express@5`. Die Typen sind strenger als die Laufzeit — kein akutes
Problem, gehört aber notiert.

### Nachtrag 133 — utils/handlers.ts nach Domänen

1313 Zeilen → `utils/handlers/{shared,parts,sets,minifigs,stats}.ts`. Die
Abhängigkeiten laufen in EINE Richtung (minifigs → sets → parts), es entsteht
kein Kreis. `getStats` spannt über alle drei und steht deshalb allein.

### Nachtrag 134 — die Startstaffel aus server.ts

`startup/backgroundJobs.ts` (168 Zeilen), server.ts von 1174 auf **1043**.

Der Grund ist die STAFFELUNG: Katalogabgleich nach 10 s, Anleitungen nach 15,
Brickset-Wiederholung nach 20, Bilder und Kaufpreis-Nachtrag nach 45. Bewusst
gewählt, aber über hundertdreissig Zeilen verstreut liess sie sich nur
rekonstruieren, indem man jedes `setTimeout` einzeln suchte. Die Bedingung
„nur im Primär-Worker" steht weiterhin an EINER Stelle, im Aufrufer.

Der Test aus Nachtrag 128 („jeder Quellordner kommt auch im Container an")
schlug prompt an: `startup/` fehlte in SRC_DIRS und im Dockerfile. Genau dafür
gibt es ihn — beim Vorgänger clients/ hatte ich denselben Fehler von Hand
gefunden.

### Testarbeit

19 + 5 Tests wurden rot, keiner wegen geänderten Verhaltens. Zwei neue Helfer,
`handlerQuelle()` und `startQuelle()` — die vierte und fünfte Anwendung
desselben Musters: den GEGENSTAND nennen, nicht den Ablageort. `serverOnly()`
bleibt bewusst nur server.ts, für Prüfungen, die „was ist dort GEBLIEBEN"
meinen.

Zwei Tests brauchten mehr als einen neuen Pfad:

- Einer schnitt „von Funktion A bis Funktion B" heraus — nach der Aufteilung
  liegen A und B in verschiedenen Dateien.
- Einer prüfte den WORTLAUT einer require()-Zeile statt ihrer Aussage.

Und einer schlug korrekt an: `require-exports.test.js` bewacht sich selbst mit
„mindestens 100 Namen geprüft, sonst greift mein Muster nicht mehr". Beim Umbau
fiel die Zahl planmässig darunter. Die Schwelle sinkt auf 60 — sie darf nicht
auf 0, sonst wäre der Selbstschutz weg.

### Stand

| | vorher | jetzt |
|---|---|---|
| späte `require()` in Rümpfen | 204 | **88** |
| `utils/handlers.ts` | 1313 | 5 Dateien, max. 509 |
| `server.ts` | 1174 | **1043** |

697 Tests grün gegen echtes Postgres 16, 0 übersprungen.

---

## Nachtrag 135 (hardened-225) — die zwei grossen Funktionen aufgeteilt

Beide standen in der zweiten Messung als „Schönheit ohne Anlass" auf der Liste;
Marco hat sie beauftragt.

### getPortfolioHistory: 449 → 182 Zeilen

| neu | Zeilen | Inhalt |
|---|---|---|
| `utils/portfolio/kurve.ts` | 222 | Rekonstruktion aus dem Preisverlauf JE SET |
| `utils/portfolio/diagrammdaten.ts` | 120 | Wertebereich, Y-Beschriftung, X-Beschriftung, Prozentänderung |

Die Funktion tat drei Dinge nacheinander: entscheiden, in welcher Auflösung
gerechnet wird; die Kurve rekonstruieren; daraus Achsen machen. Nur das dritte
ist reine Rechnung ohne Datenbank — und damit der Teil, den man beim Suchen
nach einem Achsenfehler nicht hinter zweihundert Zeilen SQL-Rekonstruktion
finden sollte.

`fmtX` (X-Beschriftung) zog mit, `downsampled` wurde zum Parameter. Bei der
Kurve blieb `bucketExpr` bewusst ein `let`: Es wird unterwegs umgestellt, wenn
verdichtet wird.

### registerImgProxy: 665 → 596 Zeilen

`utils/imgCacheServe.ts` (120 Zeilen): das Ausliefern aus dem Platten-Cache,
Original wie Verkleinerung.

Der Route-Handler ist ein langer linearer Ablauf — anmelden, Adresse prüfen,
Host zulassen, Cache-Pfad bauen, ausliefern, sonst beim CDN holen. Der
Cache-Treffer ist davon das am klarsten abgegrenzte Stück und zugleich der
HEISSESTE Pfad: Bei einer Kachelwand läuft praktisch jede Anfrage hier durch
und nirgendwo sonst.

BEINAHE-FEHLER beim Herauslösen: Aus `return res.status(304).end();` wurde beim
mechanischen Umschreiben zunächst ein blosses `res.status(304).end();` — der
Ablauf wäre weitergelaufen und hätte in eine bereits beendete Antwort
geschrieben. Jetzt `{ res.status(304).end(); return true; }`, wobei `true` dem
Aufrufer „beantwortet" meldet.

### Testarbeit

Vier Prüfungen rot, keine wegen geänderten Verhaltens. Neuer Helfer
`portfolioQuelle()` (sechster desselben Musters), `proxyThumbQuelle()` um die
neue Datei erweitert.

Zwei Prüfungen hingen wieder am WORTLAUT statt an der Aussage: eine zählte
`if (req.fresh) return res.status(304).end();` wörtlich, eine schnitt 6000
Zeichen ab `app.get('/api/img-proxy'` heraus — beides zeigte nach dem Umzug ins
Leere. Umformuliert auf „beide Auslieferpfade prüfen req.fresh und antworten
mit 304" bzw. auf die Datei, die der Ausliefer-Pfad jetzt IST.

EIGENE FALLE dabei: Der 304-Test zählte in KOMMENTAREN mit. Mein eigener
Erklärtext („aus `return res.status(304).end();` darf kein blosses … werden")
trieb die Zahl von zwei auf vier. Die Prüfung nimmt jetzt den kommentarfreien
Quelltext, den die Datei ohnehin schon vorhielt.

697 Tests grün gegen echtes Postgres 16, 0 übersprungen.

---

## Nachtrag 136 (hardened-226) — Kontofilter und Scrollbalken aus 01-core.js

Auf Marcos Frage, ob es in der Webapp ähnliche Punkte gibt wie in der
Android-App, war die gemessene Antwort: im Wesentlichen nein. Die längste
Funktion hat 191 Zeilen (`loadFinance`), keine einzige über 200 — bei Android
waren es 526, 482, 339 und 289. Als einziger Kandidat blieb `js/01-core.js` mit
1368 Zeilen.

| neu | Zeilen | Inhalt |
|---|---|---|
| `js/14-scope.js` | 68 | Kontofilter (Haushalt), je Ansicht |
| `js/15-scrollbar.js` | 147 | eigener Scrollbalken |

`01-core.js` von 1368 auf **1167**. Beide Abschnitte gehören zu keinem der
Themen, die die Kopfzeile der Datei nennt („Utils, i18n-Glue, Auth & Panels,
Login/Logout, CSV-Import-Fortschrittsbalken").

Der Kontofilter hängt an KEINEM anderen Modul, nur am localStorage; der
Scrollbalken braucht von aussen einzig `G()`. Das machte beide zu klaren
Schnitten.

### Ein Messfehler auf dem Weg dorthin

Mein Werkzeug für Funktionslängen meldete zuerst `esc` mit 498 Zeilen, dann
`tableRow` mit 493 — beide sind unter 20. Ursache waren Klammern in regulären
Ausdrücken und Zeichenketten, die meine Heuristik falsch behandelte.

Das ist derselbe Fehler wie bei Android, nur andersherum: Dort meldete der
Zähler zu WENIG und verdeckte die 526 Zeilen von SetDetailScreen. Die Zahlen
oben stammen aus einer rohen Zählung ohne Heuristik, gegengeprüft an tableRow.

### Testarbeit

16 Testdateien lasen `public/js/01-core.js`. Neuer Helfer `coreQuelle()` —
siebter desselben Musters.

`app-scrollbar.test.js` brauchte mehr: Er schnitt den Abschnitt an der
Kommentarmarke „═══ Eigener Scrollbalken" aus 01-core.js heraus, weil der Rest
der Datei beim Auswerten an die ganze Oberfläche bindet. Seit dem Umzug IST
js/15-scrollbar.js genau dieser Abschnitt — der Schnitt entfällt, dafür muss
die Importzeile weg (im Test läuft kein Modulsystem).

`frontend-imports.test.js` fing prompt einen fehlenden Import: 01-core.js ruft
`resetScopeModes()` beim Abmelden.

Zwei Gegenproben: Import in 15-scrollbar.js entfernt → rot; 14-scope.js nicht
in main.js eingetragen → das Bauskript bricht mit „Nicht im Modulgraphen" ab.

699 Tests grün gegen echtes Postgres 16, 0 übersprungen.

---

## Nachtrag 137 (hardened-227) — jpeg-exif: die Warnung kam über pdfkit

Marcos Installationslog:

    npm warn deprecated jpeg-exif@1.1.4: Package no longer supported.

`jpeg-exif` steht nirgends in package.json — es kam über **pdfkit 0.15.2**, wo
es der JPEG-Leser war. In pdfkit 0.20.1 ist es ersatzlos entfallen.

    pdfkit ^0.15.0 → ^0.20.1

Danach: keine einzige `deprecated`-Warnung mehr bei `npm ci`, 0 Schwachstellen,
44 Pakete weniger.

### Warum das mehr verlangte als „npm install"

Ein Sprung über fünf Minor-Versionen einer Bibliothek, die PDFs ZEICHNET, ist
nicht dasselbe wie ein Sicherheitsupdate. Die vorhandenen Tests prüfen die
AUFTRAGSVERWALTUNG (pdf-jobs-db) — nicht das Zeichnen. Ein pdfkit, das seine API
stillschweigend ändert, wäre grün durchgelaufen und erst bei Marcos erstem
Export aufgefallen.

Genutzt werden (ermittelt aus routes/api_v1/pdf.ts und utils/instructions.ts):
`addPage`, `circle`, `currentLineHeight`, `end`, `font`, `fontSize`, `image`,
`moveDown`, `moveTo`, `on`, `text` — durchweg Kern-API.

### Neuer Test

`test/pdfkit-render.test.js` mit drei Prüfungen:

1. Der Teilelisten-Export zeichnet ein gültiges PDF (Kopf `%PDF-`, `%%EOF`,
   plausible Grösse) — mit genau dem Methodensatz von oben.
2. Bilder werden eingebettet, JPEG UND PNG. Das ist die Stelle, an der ein
   Bruch am wahrscheinlichsten wäre: jpeg-exif WAR der JPEG-Leser, und
   Bauanleitungen bestehen ausschliesslich aus Bildseiten. Geprüft wird auf
   `/DCTDecode` und `/FlateDecode` im Dokument, nicht nur auf „es kam etwas
   heraus".
3. jpeg-exif ist nicht mehr im Abhängigkeitsbaum. Wandert es über eine andere
   Bibliothek zurück, fällt es auf — die Warnung im Installationslog liest
   niemand zuverlässig.

Zwei Gegenproben: jpeg-exif künstlich in die Lock-Datei eingetragen → Prüfung 3
rot; Erwartung der JPEG-Einbettung verfälscht → Prüfung 2 rot.

699 Tests grün gegen echtes Postgres 16 (+3 neue = 702).

---

## Nachtrag 138 (hardened-228) — ReferenceError: t is not defined

Marcos Browser-Konsole nach dem Klick auf einen Anleitungs-Link:

    Uncaught (in promise) ReferenceError: t is not defined

`js/12-pdfviewer.js` rief `t('pdf.loading')` und `t('pdf.error')` ohne Import.
Beim Herauslösen aus 01-core.js (Nachtrag 130) blieb der Import zurück — dort
war `t` über den Dateikopf verfügbar.

### Warum es so spät auffiel

Der Fehler flog erst beim ÖFFNEN eines PDFs, nicht beim Laden der Seite. Das
Bündeln bemerkt so etwas nicht (esbuild löst nur Modulpfade auf, keine freien
Namen), und die Testsuite fasst den Betrachter nicht an.

### Die eigentliche Lücke: i18n.js war unsichtbar

`test/frontend-imports.test.js` ist genau für diese Fehlerklasse gebaut und war
grün. Grund: Sie liest ausschliesslich `public/js/`. **i18n.js liegt eine Ebene
höher** (`public/i18n.js`) und war damit gar nicht in der Liste — ihre Exporte
galten als „unbekannter Name" und wurden übersprungen.

Betroffen war also nicht nur `t`, sondern jeder i18n-Export: `tRaw`, `locale`,
`applyLang`, `LANG`, `I18N`. Die Prüfung nimmt i18n.js jetzt mit auf.

Gegenprobe: Import wieder entfernt → rot, mit der richtigen Meldung
(„12-pdfviewer.js: ruft t() aus ../i18n.js ohne Import").

### Kontrolle des ganzen Frontends

Mit einem eigenständigen Werkzeug alle Dateien unter public/js/ plus i18n.js
gegen ALLE Frontend-Exporte gehalten: Ausser diesem einen Fall gibt es keinen
weiteren nicht importierten Namen.

702 Tests grün gegen echtes Postgres 16.

---

## Nachtrag 139 (hardened-229) — Kein einziger Hintergrundjob lief mehr

Marcos Befund: „Die Jobs scheinen nicht zu laufen in der webapp."

### Was passiert war

Beim Auslagern der Startstaffel nach `startup/backgroundJobs.ts` (Nachtrag 134)
wanderten ZEHN `require('./jobs/…')` und `require('./routes/…')` wortgleich mit.
Aus `startup/` gesehen gibt es `./jobs` nicht — jeder dieser Aufrufe warf sofort.

Und weil sie in `setTimeout(...)` und `.catch(() => {})` stecken, blieb es
STILL: Preis-Job, Anleitungs-Warteschlange, Bild-Warteschlange, Cache-Aufräumen,
PDF-Aufräumen, Kaufpreis-Nachtrag, Katalogabgleich, Brickset-Wiederholung —
nichts lief an, und im Log stand kein Wort.

Dieselbe Bauart wie in Nachtrag 131. Alle zehn sind jetzt echte Importe.

### Die eigentliche Lücke: eine zweite Liste von Quellordnern

`test/module-layout.test.js` hat seit Nachtrag 131 die Prüfung „jedes späte
require() zeigt auf eine Datei, die es gibt" — sie war grün.

Grund: Ihr Helfer `quellen()` durchlief eine FEST VERDRAHTETE Liste
`['db','utils','routes','jobs','clients']`. `startup/` kam in Nachtrag 134 dazu
und fehlte hier. Sämtliche sieben Prüfungen dieser Datei übersprangen den
Ordner stillschweigend.

Die Liste kommt jetzt aus `SRC_DIRS` in scripts/build-ts.js — eine zweite
Wahrheit neben der ersten war genau das Problem. Mit Untergrenze, damit ein
kaputtes Muster nicht wieder zu einer leeren Prüfung führt.

**Das ist das vierte Mal in Folge, dass eine Prüfung grün war, weil ihr
Umfang zu eng gezogen war** (Wildcards ohne `*`, `private` als Sichtbarkeit
statt Import, i18n.js ausserhalb des Ordners, jetzt startup/). Nicht die Regel
war falsch, sondern wo gesucht wurde.

### Neuer Test — zur Laufzeit, nicht im Quelltext

`test/background-jobs-start.test.js` lädt `startup/backgroundJobs.ts`, fängt die
Jobs ab und ruft `starteHintergrundlaeufe()` auf. Geprüft wird, dass die fünf
sofort startenden Läufe WIRKLICH ankommen — nicht, dass ihr Name irgendwo im
Quelltext steht.

Gegenproben: zwei require() zurückgestellt → rot; startup/ aus SRC_DIRS
entfernt → die Ordner-Prüfung rot.

### Zwei Tests umformuliert

Beide hingen am WORTLAUT `require('./jobs/imageQueue').start()` und wurden durch
den echten Import rot, ohne dass sich ihre Aussage geändert hätte. Was sie
prüfen — der Job läuft nur im Primärprozess — bleibt; DASS er läuft, prüft jetzt
der Laufzeittest.

### Und ein Fund im Prüfwerkzeug

`async-routes.test.js` entfernte Kommentare mit zwei Regex-Ersetzungen. Die
Zeilen-Variante schneidet an einem `//` INNERHALB eines Blockkommentars (etwa in
einer URL) dessen `*/` mit weg; der folgende Ausdruck lief dann über
zwanzigtausend Zeichen und frass alle Router-Requires. Jetzt `ohneKommentare()`,
den das Projekt längst hat — und `serverOnly()` statt `startQuelle()`, denn die
Aussage betrifft die Reihenfolge INNERHALB von server.ts.

703 Tests grün gegen echtes Postgres 16.

---

## Nachtrag 140 (hardened-230) — glob: der naheliegende Weg wäre ein Bruch gewesen

Marcos Installationslog:

    npm warn deprecated glob@10.5.0: Old versions of glob are not supported…

glob ist keine eigene Abhängigkeit: **archiver → archiver-utils → glob**.

### Der naheliegende Weg und warum er ausschied

`archiver` auf 8 heben — so wie bei pdfkit in Nachtrag 137. Dort war es richtig,
hier nicht:

**archiver 8 ist reines ESM und exportiert KEINE Funktion mehr**, sondern die
Klassen `Archiver`, `ZipArchive`, `TarArchive`, `JsonArchive`.
`require('archiver')` liefert kein aufrufbares Modul, und der Server ist
CommonJS. `routes/settings.ts` müsste umgeschrieben werden — für eine
Deprecation-Warnung an einer transitiven Abhängigkeit.

Bemerkt habe ich das nur, weil ich nach dem Update ein ZIP ERZEUGT habe statt
bloss die Tests laufen zu lassen. Der Export hatte keinen Test, der ihn
ausführt; `npm test` wäre grün geblieben und der Datenexport in der Verwaltung
hätte 500 geliefert.

### Gewählt: overrides auf glob ^13

    "overrides": { "glob": "^13.0.0" }

archiver bleibt bei 7, glob 10 verschwindet. glob 13 verlangt Node `20 || >=22`
— das Image ist node:20-alpine, passt.

Geprüft, dass es trägt: `archiver-utils` lädt mit glob 13, und der Export
erzeugt ein ZIP, das sich mit `unzip` wirklich entpacken lässt — samt BOM, das
Excel für die Umlaute braucht.

Nach `npm ci`: **keine einzige Deprecation-Warnung mehr**, 0 Schwachstellen,
33 Pakete weniger.

### Neuer Test

`test/zip-export.test.js`:

1. `archiver` ist als CommonJS-FUNKTION aufrufbar — fängt genau den Sprung auf
   8.x ab, in den ich fast gelaufen wäre.
2. Der Export erzeugt ein entpackbares ZIP: ZIP-Kopf, alle drei Dateinamen im
   zentralen Verzeichnis, und dann wirklich `unzip` — mit Prüfung auf BOM und
   Inhalt.
3. Kein glob unter Version 11 mehr im Baum.

Zwei Gegenproben: archiver als Objekt statt Funktion → Prüfung 1 rot; glob 10 in
die Lock-Datei geschrieben → Prüfung 3 rot.

### Anmerkung zu overrides

Ein `overrides`-Eintrag greift in einen FREMDEN Abhängigkeitsbaum ein — er
zwingt archiver-utils eine Version auf, gegen die es nie getestet wurde. Genau
deshalb steht der Export jetzt unter einem Test, der ihn ausführt. Hebt archiver
irgendwann selbst auf ein neueres glob, kann der Eintrag ersatzlos weg.

706 Tests grün gegen echtes Postgres 16.

---

## Nachtrag 141 (hardened-231) — Kaufpreis „—" im Detailfenster manueller Einträge

Marcos Befund: Auf der Kachel steht der Kaufpreis korrekt, im Detailfenster ein
„—", und die Tabelle unter „Kaufpreise bearbeiten" ist leer.

### Ursache

Elf Aufrufe in `js/13-acquisition-modals.js` sprachen

    /api/parts/…/acquisitions      /api/minifigs/…/acquisitions
    /api/parts/…/price-history     /api/minifigs/…/price-history

an. Diese Routen gibt es **nur unter /api/v1/** — `routes/parts.ts` und
`routes/minifigs.ts` haben gar keine Acquisitions-Route. `api()` hängt lediglich
`/api` davor.

Die Anfragen liefen also ins Leere. Sichtbar wurde daraus ein „—" statt einer
Fehlermeldung, weil der Aufruf ein `.catch(() => null)` trägt — der Dialog
verhält sich, als gäbe es keine Erfassungen.

Die Kachel zeigt den Preis richtig, weil sie ihn aus der LISTE bekommt
(getManualParts/getManualMinifigs), nicht über diesen Weg.

**Der Fehler ist ALT.** In hardened-221 — vor dem Aufteilen der Datei — stehen
dieselben Pfade. Nicht durch den Umbau entstanden.

### Neue Prüfung: Frontend-Pfade gegen Server-Routen

`test/frontend-api-paths.test.js` sammelt alle Routen (inklusive der von
`registerAcquisitionRoutes()` erzeugten) und hält jeden API-Pfad des Frontends
dagegen.

ZWEI ANLÄUFE: Der erste sah nur `api('GET', '/…')` — und schwieg bei der
Gegenprobe. Denn genau die kaputten Pfade entstehen vorher in einer Variablen:

    const acqUrl = type === 'fig' ? `/minifigs/…` : `/parts/…`;
    const ad = await api('GET', acqUrl);

Jetzt werden zusätzlich alle Pfad-Literale geprüft, deren erstes Segment der
Server unter /api kennt. Ihre Methode ist unbekannt; es genügt, dass irgendeine
sie bedient.

Gegenprobe: die alten Pfade wiederhergestellt → rot, mit allen sechs Stellen.

### Zum fehlenden Marktpreis bei Teilen

Der Verlaufs-Endpunkt war schon vorher richtig adressiert (`/v1/…`), scheiterte
aber am selben fehlenden `/v1/`? Nein — dort stand es. Der Marktpreis kommt aus
`part_price_cache`, und die füllt der Preis-Job. Der lief seit Nachtrag 134
nicht mehr (siehe Nachtrag 139). Nach dem Einspielen von hardened-229 und einem
Durchlauf sollte er erscheinen; falls nicht, ist es ein eigener Befund.

707 Tests grün gegen echtes Postgres 16.

---

## Nachtrag 142 (hardened-232) — Der Anleitungs-Job war extrem langsam

Marcos Befund: „Der Job, der die Handbücher herunterlädt, ist extrem langsam."

### Erster Fund: Der Takt hing am Durchgang, nicht am Abruf

Die Warteschlange wartete nach JEDEM Set 15 Sekunden. Die Pause schont Brickset
und brickinstructions.com — aber ein Set, das schon eine Anleitung hat, fällt in
`downloadSetInstructions()` sofort heraus, OHNE eine Verbindung zu öffnen.

Gemessen gegen echtes Postgres: **0 ms Arbeit, 15 Sekunden Pause.**

Das ist wörtlich derselbe Fehler wie beim Bild-Job in Nachtrag 217: Dort wurde
das CDN-Kontingent auf NOTIZEN angewandt statt auf CDN-Anfragen, und Übersprünge
bremsten wie Downloads — 37 Minuten für „10 bearbeitet: 0/0/0".

`utils/instructions.ts` meldet jetzt über `letzterAbrufWarExtern()`, ob wirklich
gefragt wurde; die Schlange wartet 15 s nur dann, sonst 250 ms.

### Zweiter Fund: Die Pause lief doppelt

Nach dem BDP-Rückfallweg legt `downloadSetInstructions()` 5 Sekunden ein —
und danach wartet die Schlange nochmal 15. Zusammen 20, ohne dass ein Server
dadurch besser geschont würde: Der nächste Abruf kommt so oder so frühestens
nach 15 Sekunden.

Neuer Parameter `eigenerTakt`. Die beiden anderen Aufrufer (Set erfassen,
Brickset-Wiederholung) haben KEINEN Takt über sich — für die bleiben die
Pausen. Deshalb ein Schalter und kein Löschen.

### Wirkung

Bei 800 Sets, von denen 700 bereits versorgt sind:

| | vorher | nachher |
|---|---|---|
| Gesamtdauer | **3 h 28 min** | **28 min** |

Im ungünstigsten Fall (alle 800 unversorgt): 4 h 26 min → 3 h 20 min. Dort
bleibt die Bremse absichtlich stehen — sie verhindert die Cloudflare-Sperre, die
weiter unten im Job eigens behandelt wird.

### Was ich NICHT angefasst habe

Die 15 Sekunden selbst und die 500 ms je Bildseite in `collectAndBuildPDF()`.
Beide begrenzen die Last auf fremden Servern; sie zu senken ist eine
Abwägung, die Marco gehört, nicht eine Aufräumarbeit. Die Seitenschleife läuft
zudem in einem `setImmediate` und blockiert die Schlange nicht.

### Tests

`test/instruction-queue-pace-db.test.js` mit drei Prüfungen: ein versorgtes Set
löst keinen Abruf aus (gegen echte DB, mit Zeitmessung), die Schlange bremst nur
nach einem echten Abruf, und der Job verzichtet auf die Pausen, die er selbst
einhält — wobei beide Pausen für die übrigen Aufrufer erhalten bleiben müssen.

Vier Gegenproben nachgespielt: Takt zurück am Durchgang → rot; Merker meldet
fälschlich einen Abruf → rot; Job meldet den eigenen Takt nicht → rot; eine
Pause ganz gelöscht statt abschaltbar → rot.

710 Tests grün gegen echtes Postgres 16.

---

## Nachtrag 143 (hardened-233) — Marktpreis fehlt im Detailfenster manueller Teile

Marcos Befund: Auf der Finanzseite steht für „Primo Brick 1 x 1 (Blau)" ein
Marktpreis von CHF 0.13. Im Detailfenster desselben Teils: „—".

### Zwei Schlüsselräume, die man nicht mischen darf

`part_price_cache` und `part_price_history` schreibt `fetchPartPrice()` — unter
der **BrickLink**-Teilenummer und der **BrickLink**-Farbnummer. BrickLink
antwortet auf Rebrickable-Nummern mit 404, deshalb wird vor dem Abruf übersetzt
(`resolveBlPartNumber` / `resolveBlColorId`), und der Cache erbt diesen Schlüssel.

`part_acquisitions` trägt dagegen die **Rebrickable**-Nummer — so hat der
Benutzer sie eingegeben.

`getPartPriceHistory()` nahm die Rebrickable-Werte für BEIDES. Für Teile ohne
Zuordnung stimmen die Schlüssel zufällig überein; für alle anderen fand die
Preisabfrage nichts, und die Zeile blieb leer.

Die Finanzseite war nie betroffen: `computePartsValuation()` übersetzt selbst
(`part.bl_part_number || part.part_number`). Genau deshalb standen zwei
verschiedene Antworten für dasselbe Teil auf zwei Seiten derselben Anwendung.

### Behebung

`manualPriceHistory()` und `conditionRows()` nehmen jetzt ZWEI Schlüssel: einen
für die Preise, einen für die Erfassungen. Ohne Angabe sind sie identisch — bei
Minifiguren stimmen sie überein, dort ändert sich nichts.

Nachgewiesen gegen echtes Postgres mit Marcos Lage (RB `31000`/Farbe 1 ↔ BL
`bl31000`/Farbe 7): Marktpreis 0.13, Kaufpreis 0.11, G&V +18.2 %.

### Tests

`test/part-price-keys-db.test.js` prüft beide Richtungen. Gegenproben:
Rebrickable-Nummer für die Preise → rot (Marcos Fehler); Erfassungen fälschlich
mit übersetzt → rot („Für den erfassten Zustand fehlt die Zeile ganz").

Eine bestehende Prüfung wurde umformuliert: Sie las die Importzeile von
priceHistory.ts WÖRTLICH und wurde rot, weil dort jetzt zwei weitere Namen
stehen. Es zählt, DASS der gemeinsame Helfer von dort kommt.

711 Tests grün gegen echtes Postgres 16.

---

## Nachtrag 144 (hardened-234) — Der geschätzte Minifiguren-Preis wurde nie gelesen

Marcos Auftrag: „Der geschätzte Marktpreis einer Minifigur soll ebenfalls im
Cache gespeichert werden, damit er nicht jedes Mal neu geholt werden muss.
Weiter soll er auch sonst gespeichert werden, damit der Preisverlauf angezeigt
werden kann."

### Der Befund war halb erfüllt — und die fehlende Hälfte kostete am meisten

GESCHRIEBEN wurde der Schätzwert längst: in `minifig_price_cache` UND
`minifig_price_history`. GELESEN wurde er nie.

Jeder Aufruf holte deshalb erneut die Teile-Zusammensetzung von Rebrickable und
danach den BrickLink-Preis JE TEIL. Eine Minifigur mit fünfzehn Teilen kostete
fünfzehn Preisabfragen — bei jedem Öffnen der Finanzseite, für jede Figur ohne
BrickLink-Nummer.

`estimateFigPriceFromParts()` sieht jetzt zuerst im Cache nach. Gemessen gegen
echtes Postgres: **2 ms statt fünfzehn Abfragen.**

### Zur Frist

Dieselbe wie beim echten Abruf (`price_cache_ttl`, Vorgabe 24 h). Der Wert ist
derselbe Marktpreis, nur anders ermittelt — er soll nicht länger gelten als ein
von BrickLink geholter. Ein 48 Stunden alter Eintrag wird übergangen und neu
gerechnet.

Dass innerhalb der Frist KEIN neuer Verlaufspunkt entsteht, ist richtig: Ein
zweiter Punkt mit demselben Wert am selben Tag trägt nichts bei. Nach Ablauf
wird gerechnet und geschrieben — dieselbe Taktung wie bei Sets.

### Tests

`test/minifig-estimate-cache-db.test.js` mit drei Prüfungen gegen echte
Datenbank: frischer Eintrag ersetzt die Neuberechnung (mit Zeitmessung und der
Kontrolle, dass kein zweiter Verlaufspunkt entsteht), veralteter Eintrag wird
übergangen, und beide Tabellen werden beschrieben.

Gegenproben: Lesepfad wieder entfernt → rot; Frist auf 1000 Stunden aufgeweitet
→ die Prüfung für den veralteten Eintrag rot.

714 Tests grün gegen echtes Postgres 16.

---

## Nachtrag 145 (hardened-235) — Gesamtwert und Teilsummen kommen vom Server

Marcos Frage: „Ist nach wie vor sichergestellt, dass die ganze Logik im Server
zentral ist und die Webapp sowie die Android-App die Daten gleich beziehen und
nur das Rendering übernehmen?"

Nachgesehen statt behauptet. Weitgehend ja — mit zwei Ausnahmen.

### 1. Eine Divergenz ZWISCHEN den Clients

Der Server liefert `total_value` für Teile und Minifiguren. Android las es von
dort; die Webapp summierte stattdessen `display_value` über alle Zeilen.

Heute kam dasselbe heraus — beide Werte stammen ja vom Server. Sobald der
Server aber entscheidet, Zeilen ohne Preis anders zu behandeln, zeigen die
beiden Clients verschiedene Summen. Die Webapp liest jetzt `total_value`.

### 2. Der Gesamtwert stand an drei Stellen

`sets.totals.avg + parts.total_value + figs.total_value` rechneten BEIDE
Clients selbst.

Derselbe Wert steckte längst in `computePnl()` als `totals.current` — dort aus
den Preisen JE ZEILE gebildet, also belastbarer als eine Addition dreier
gerundeter Endsummen. Er heisst jetzt zusätzlich `grand_total` und wird von
beiden gelesen. Kein zusätzlicher Abruf: Beide holen /finance/pnl ohnehin.

Der Rückfall auf die eigene Addition bleibt in beiden Clients — für den Fall,
dass die pnl-Abfrage scheitert oder ein älterer Server antwortet.

### Warum die bestehende Prüfung das nicht fand

`keine Oberfläche rechnet die Summe noch einmal` sucht nach zwei konkreten
Feldnamen (`purchase_price`, `unit_price`, `quantity`). `display_value` stand
nicht auf der Liste, und die Android-Seite sah sie überhaupt nicht an.

Die Regel war richtig, der Suchraum zu eng — **zum sechsten Mal in dieser
Reihe dasselbe Muster** (vgl. Nachträge 100 bis 105 und 139).

### Neue Prüfungen — nach der FORM, nicht nach Feldnamen

`test/clients-render-only.test.js` sucht `reduce(… => … .<geldfeld>)` mit einer
Liste von Feldnamen, die auf Geld deuten, und verlangt für jede Fundstelle
einen ausdrücklichen Freibrief in einer Ausnahmeliste. Dazu: Der Server MUSS
`grand_total` liefern, sonst ist die Regel nicht erfüllbar.

`ClientRendersOnlyTest` (Android) macht dasselbe für `sumOf`. Summen über
Stückzahlen bleiben erlaubt — „x7" neben einer Zeile ist Anzeige, keine
Geschäftsregel.

Fünf Gegenproben nachgespielt: Webapp summiert display_value → rot; Webapp
addiert den Gesamtwert → rot; Server liefert grand_total nicht → rot; Android
addiert selbst → rot; Geldsumme in der Android-Oberfläche → rot.

717 Tests grün gegen echtes Postgres 16.

---

## Nachtrag 146 (hardened-236) — Der Zustand der Zeile wurde verworfen

Marcos Befund: „Wenn ich bei der Minifigur einen zweiten Preis mit einem
anderen Zustand erfasse, z.B. gebraucht, wird der Marktpreis dieses Zustands
nicht angezeigt. Der Preis ist ebenfalls identisch, wenn ich das Feld leer
lasse. Es sieht so aus, als würde der Preis vom anderen Zustand übernommen."

Die Beobachtung traf genau zu.

### Ein Parameter, den zwei von drei Fassungen nicht annahmen

Wird das Kaufpreisfeld geleert, füllt `resolvePrice()` den Marktpreis nach. Der
Aufrufer reicht dafür seit Nachtrag 68 den Zustand DIESER Zeile durch:

    p = await cfg.resolvePrice(uid, keys, cond);

Die SETS-Fassung nimmt ihn entgegen. Teile und Minifiguren deklarierten den
dritten Parameter nicht und liessen ihn fallen:

    resolvePrice: async (uid, [fn]) => { … getCurrentFigMarketPrice(fn, uid, bl) }

Beide leiteten stattdessen einen Zustand aus ALLEN Erfassungen des Eintrags ab
(„eine Gebraucht-Erfassung genügt → U"). Das kann nicht stimmen, sobald zwei
Erfassungen verschiedene Zustände haben — es gibt dann keinen einen Zustand des
Eintrags mehr.

Folge: Die Gebraucht-Zeile bekam den Preis des Sammelzustands, und für
„Gebraucht" wurde nie ein Marktpreis ermittelt. Deshalb blieb die Zeile im
Detailfenster leer, während „Neu" einen Wert zeigte.

Beide Ermittler hatten den Parameter längst
(`getCurrentFigMarketPrice(…, condition = null)`,
`getCurrentPartMarketPrice(…, condition = null)`) und geben ihm auch Vorrang vor
dem abgeleiteten. Er kam nur nie an. Die Behebung sind zwei Zeilen.

### Warum das die leere Zeile mit erklärt

`getCurrentFigMarketPrice()` schreibt über `fetchMinifigPrice()` bzw. — ohne
BrickLink-Treffer — über `estimateFigPriceFromParts()` in
`minifig_price_cache`, und zwar unter dem ERMITTELTEN Zustand. Kam dort nie ein
„U" an, entstand auch nie ein U-Eintrag; und genau den liest das Detailfenster.

### Tests

`test/acquisition-condition-price-db.test.js` mit drei Prüfungen: alle drei
Erfassungsarten reichen den Zustand durch, die Ermittler nehmen ihn entgegen und
geben ihm Vorrang, und die Schätzung legt je Zustand einen eigenen Eintrag ab.

Gegenproben: Minifiguren verwerfen den Zustand wieder → rot; Teile ebenso → rot.

720 Tests grün gegen echtes Postgres 16.

---

## Nachtrag 147 (hardened-237) — Dieselbe Lücke, nur beim Erfassen

Marcos Befund: Zwei heute angelegte Einträge derselben Minifigur, einer „Neu",
einer „Gebraucht" — beide Kaufpreise CHF 2.18, obwohl die Marktpreise 2.18
(Neu) und 2.20 (Gebraucht) sind.

### Nachtrag 146 hat nur die Hälfte behoben

Dort ging es um das BEARBEITEN (`resolvePrice` in den Erfassungsrouten). Das
ERFASSEN ist ein anderer Weg, und dort stand derselbe Fehler an vier Stellen:

| Datei | Stelle |
|---|---|
| routes/minifigs.ts | Mengen-Erhöhung → neue Tageserfassung |
| routes/minifigs.ts | Kaufpreis leer → Marktpreis einsetzen |
| routes/parts.ts | dieselbe Mengen-Erhöhung |
| routes/parts.ts | derselbe leere Kaufpreis |

Bei der Mengen-Erhöhung war es besonders auffällig: Der Preis wurde geholt, und
ZWEI ZEILEN SPÄTER der Zustand bestimmt, mit dem die Erfassung dann geschrieben
wurde. Jetzt zuerst der Zustand, dann der Preis dazu.

Beim Anlegen der zweiten Zeile gab es erst die erste — der ohne Zustand geholte
Preis leitete sich also aus ihr ab. Genau Marcos 2.18 für beide.

### Warum ich es beim ersten Mal übersehen habe

Ich habe nur die Stellen angesehen, die im Fehlerbericht vorkamen. Das ist
inzwischen das siebte Mal in dieser Reihe, dass eine Prüfung oder eine Suche zu
eng gezogen war.

Deshalb prüft `acquisition-condition-price-db.test.js` jetzt JEDEN Aufruf von
`getCurrentFigMarketPrice` und `getCurrentPartMarketPrice` in routes/ und
utils/ auf die Zustandsangabe — nicht die vier, die ich gerade repariert habe.

Gegenproben: Minifiguren-Aufruf ohne Zustand → rot mit Datei und Zeile; Teile
ebenso.

721 Tests grün gegen echtes Postgres 16.
