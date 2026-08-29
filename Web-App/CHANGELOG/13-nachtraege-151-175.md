# Nachträge 151–175

Teil der Fix-Historie — Übersicht in [CHANGELOG-fixes.md](../CHANGELOG-fixes.md).

---

## Nachtrag 151 (hardened-240) — Wortlaut gegen Aussage, zum siebten Mal

Zwölf weitere Prüfungen nagelten ganze Signaturen wörtlich fest. Neuer Helfer
`pruefeParameter(src, name, params, hinweis)` prüft die Parameter der Reihe
nach, ohne Rücksicht auf Typannotationen, Vorgabewerte oder Umbrüche.

Wo die VORGABE der eigentliche Punkt war — `theme = MAIL_THEMES.classic`,
`condition = 'N'` —, steht sie jetzt als eigene, gezielte Prüfung daneben.

**Gegenproben in beide Richtungen:** Parameter entfernt → rot mit dem echten
Kopf in der Meldung. Typannotation ergänzt → grün. Vorher war es andersherum.

Ein dreizehnter Fall (`resolveIfExists`) fiel erst beim vollen Testlauf auf —
mein `grep` hatte ihn übersehen, weil er nur EINEN Parameter nennt. Ein Muster
ist eben nicht dasselbe wie ein Testlauf.

`noImplicitAny` von 631 auf 556, 44 auf 30 offene Dateien. Der
Ausnahmelisten-Wächter hat dabei zweimal angehalten, weil ich Dateien bereinigt
und die Liste nicht nachgezogen hatte — genau die Richtung, für die er da ist.

Alle semver-verträglichen Abhängigkeiten aktualisiert (`pg` 8.23, `sharp`
0.35.4, `nodemailer` 9.0.6, `multer` 2.3). Die Hauptversionssprünge (Express
4→5, archiver, csv-parse, jsdom, esbuild) bleiben liegen — die gehören einzeln
angefasst.

746 Tests grün.

## Nachtrag 152 (hardened-241) — Node 20 war seit vier Monaten ohne Patches

Das Dockerfile lief an beiden Stufen auf `node:20-alpine`. Node 20 hat am
30.04.2026 sein Lebensende erreicht — seitdem gibt es keine Sicherheits-Patches
mehr, auch nicht für kritische CVEs in V8, den HTTP-Parsern oder OpenSSL. Das
ist keine alte Version, sondern eine ungepatchte Laufzeitumgebung.

Schlimmer: Der CI-Workflow aus Nachtrag 150 schrieb `node-version: '20'` mit
der Begründung „wie im Dockerfile". Die Begründung war richtig, die Zahl schon
damals falsch — der Lebenszyklus war nicht nachgesehen worden.

Umgestellt auf Node 24 (Active LTS). Der Wächter hält die drei Stellen zusammen
und prüft gegen eine Liste ABGELAUFENER Zeilen — bewusst eine Sperr- und keine
Erlaubnisliste, sonst müsste sie bei jeder neuen Node-Zeile nachgepflegt werden
und meldete einen Aufstieg als Fehler.

### Abdeckungs-Landkarte

`npm run coverage` (bewusst nicht in CI — sie lässt nichts durchfallen).
Ergebnis: 59,3 % der Zeilen, nur `server.ts` wird von keinem ausgeführten Test
berührt. Die interessante Hälfte ist die Rangliste:

| Anteil | Modul |
|---|---|
| 15 % | jobs/rebrickableCsvSync.ts |
| 18 % | clients/brickset.ts |
| **18 %** | **routes/sets.ts** (522 Zeilen) |
| 23 % | utils/instructions.ts |
| 24 % | routes/imgProxy.ts |

`routes/sets.ts` ist der Anlege- und Verschiebeweg für Sets — der Kern der App.

Die Zahl ist KEINE Zielgrösse. Eine Abdeckungsquote als Ziel führt zuverlässig
zu Tests, die Zeilen berühren, ohne etwas zu behaupten.

### Der Restore-Weg, einmal wirklich durchgespielt

Im README stand „Den Restore-Weg einmal ausprobieren". Genau die Sorte
Anweisung, die niemand befolgt — und ein Backup, das nie zurückgespielt wurde,
ist eine Vermutung, kein Backup.

`backup-restore-db.test.js` spielt gegen echtes Postgres durch: Daten anlegen →
`pg_dump` → Schema komplett verwerfen → zurückspielen → Feld für Feld
vergleichen. Die beiden Vorkehrungen aus den Skripten sind jetzt gemessen statt
behauptet — dass ein abgeschnittener Dump die Endmarke nicht trägt, und dass
`psql` ohne `ON_ERROR_STOP` einen fehlgeschlagenen Restore mit Exit 0
quittiert.

Die erste Gegenprobe blieb grün: Das Muster fand die Endmarke im ERKLÄRTEXT des
Skripts statt in der Befehlszeile. Derselbe Fehler wie beim CI-Wächter zwei
Durchgänge zuvor. Kommentarzeilen werden jetzt vorher herausgefiltert.

755 Tests grün.

## Nachtrag 153 (hardened-243) — Node 26 und ein Typpaket, das zufällig passte

Node 26 an allen drei Stellen. Bewusste Abweichung von der LTS-Empfehlung des
Node-Projekts, mit Begründung im Dockerfile: 26 wird im Oktober 2026 ohnehin zu
Active LTS, der Support läuft dann bis 30.04.2029 statt bis 2028, und der
Abhängigkeitsbaum hier ist klein genug, dass der Rückweg auf 24 eine Zeile ist.

Beim Prüfen fiel auf, dass `@types/node` bereits auf `^26` stand — rein
zufällig, weil `npm update` es in Nachtrag 151 hochgezogen hatte. Andersherum
wäre es unbemerkt geblieben: Der Übersetzer hätte gegen eine andere
Standardbibliothek geprüft als die laufende, und ein Aufruf, den es in der
ausgelieferten Fassung gar nicht gibt, wäre sauber durchgekommen.

Dafür gibt es jetzt eine eigene Regel. Die allgemeine „Typpaket und Paket in
derselben Hauptversion" aus Nachtrag 148 greift hier nicht — `node` ist gar
keine Abhängigkeit in der `package.json`, die Version steht im Dockerfile.

**Nach dem ersten Start zu prüfen:** `sharp` bringt libvips als native
Bibliothek mit und lädt eine fertige Binärdatei für Plattform und
C-Bibliothek. Genau dort geht ein Node-Sprung schief, wenn überhaupt — und zwar
leise, weil `routes/thumbs.ts` dann auf Jimp zurückfällt und weiterläuft.
Einmal eine Vorschau erzeugen und ins Log sehen. Taucht die Jimp-Warnung auf,
ist 24 der Rückweg.

756 Tests grün.

---

## Nachtrag 154 (hardened-244) — Eine Verifikation statt zwei, sechs Zusicherungen für sets.ts, und ein GET, das etwas anlegte

### 1. Doppelte E-Mail-Verifikation zusammengeführt

Dieselben acht Zeilen standen zweimal im Baum: in `server.ts` unter
`GET /verify` (der Link aus der Mail) und in `routes/auth.ts` unter
`GET /api/auth/verify`. Beide Kopien trugen die Hash-Regel, die Ablaufprüfung
und das Abräumen der Token-Felder. Wer eine änderte, übersah die andere —
gemerkt hätte man es erst, wenn sich jemand nicht mehr verifizieren kann.

Die Logik liegt jetzt in `utils/auth.verifiziereEmailToken(token)`. Geteilt
wird nur sie; die Antwortform bleibt Sache der Aufrufer.

Bewusst **nicht** unterschieden werden „abgelaufen" und „unbekannt": beides
ergibt `ungueltig`. Wer von aussen erfährt, ob ein Token existiert und bloss
abgelaufen ist, kann raten, ob eine Adresse ein Konto hat — dieselbe
Überlegung wie bei der neutralen Antwort in `/forgot-password`.

**Abweichung vom Auftrag, mit Begründung.** Der Auftrag beschrieb
`/api/auth/verify` als „antwortet mit JSON". Das traf nicht zu: Die Route
schickte auf dem Erfolgs- *und* dem Ungültig-Pfad ein
`res.redirect('/?verified=…')`, JSON nur bei fehlendem Token. Eine Route unter
`/api`, die mit 302 auf eine HTML-Seite verweist, ist für jeden
Programm-Aufrufer unbrauchbar — `fetch()` folgt und bekommt die ~189 KB
`index.html` statt einer Antwort. Umgestellt auf durchgängiges JSON
(200 / 400 fehlt / 410 ungültig). Gefahrlos, weil die Route **keinen**
Aufrufer hat: Der Link in der Verifikationsmail zeigt auf `/verify`
(`routes/mailer.ts:296`), Frontend und Android-App rufen sie nicht auf.

Geprüft mit `test/email-verify.test.js` (7 Regeln) und
`test/email-verify-db.test.js` (12 Verhaltensprüfungen gegen echtes Postgres:
gültig, abgelaufen, unbekannt, fehlend, zweimal eingelöst, bereits
verifiziert — je über die Funktion und über die echte API-Route).

Ein erster Entwurf der Regel suchte nur nach `verification_token = $1` und
schlug bei `GET /api/auth/check-token` an — zu Unrecht: Diese Route *prüft*
einen Token, sie löst ihn nicht ein, und lässt `email_verified = 0` deshalb
bewusst weg. Das Muster verlangt jetzt beides zusammen.

### 2. `routes/sets.ts` auf Verhalten geprüft

`npm run coverage` wies 18 % ausgeführte Zeilen bei 522 aus — der niedrigste
Wert unter den grossen Modulen. Ausgesucht wurde nach **Schadenshöhe**, nicht
nach Zeilenzahl: Der CSV-Import hat die meisten ungeprüften Zeilen, meldet
Fehler aber laut. Diese drei schreiben oder löschen still das Falsche:

1. **Fremde Anleitung löschen.** Ginge das, verlöre ein anderes Konto Daten,
   ohne dass irgendwo ein Fehler erscheint.
2. **Die geteilte Datei beim Löschen.** Beim Verschieben eines Sets wird die
   Anleitungs-Zeile kopiert und der Pfad wörtlich übernommen — zwei Konten
   teilen sich dann eine Datei. Der Kommentar in der Route hält das fest,
   geprüft hat es niemand.
3. **Die Gegenrichtung:** Zeigt keine Zeile mehr darauf, muss die Datei weg.

Sechs Prüfungen in `test/sets-routes-db.test.js`, jede mit einer echten
Zusicherung. Abdeckung `routes/sets.ts`: **18 % (94/522) → 21 % (112/522)**,
über alle Module 59,3 % → 59,5 %. Die Quote war nicht das Ziel.

`assertJobColumns()` bleibt ungeprüft: `jobSet`/`jobUpdate` werden nur intern
mit fest verdrahteten Objektliteralen gerufen, ein Verhaltenstest käme dort
nicht hin.

### 3. CSRF — Befund, damit er entscheidbar wird

Es gibt kein CSRF-Token. Der Schutz ruht allein auf `SameSite=lax` am
Session-Cookie (`server.ts:348`).

**Wie viele Routen hängen daran?** Von 60 zustandsändernden Routen
(POST/PUT/PATCH/DELETE) sind **54 mit dem Sitzungs-Cookie erreichbar**. Die
übrigen 6 sind bewusst offen (Login, Registrierung, Passwort vergessen und
zurücksetzen, QR-Login, Verifikation). Wichtig dabei: `requireToken` und
`requireApiAdmin` akzeptieren **Cookie ODER Bearer-Token** — auch die 14
Admin-Routen zählen also dazu, nicht nur die klassischen Session-Routen.

| Datei | betroffen |
| --- | --- |
| `routes/api_v1/admin.ts` | 14 |
| `routes/auth.ts` | 8 |
| `routes/sets.ts` | 7 |
| `routes/api_v1/settings.ts`, `routes/settings.ts` | je 5 |
| `routes/api_v1/sets.ts` | 4 |
| `routes/api_v1/minifigs.ts`, `routes/api_v1/parts.ts` | je 3 |
| übrige | 5 |

**Was `lax` offen lässt — und was dabei gefunden wurde.** `lax` schickt das
Cookie bei einer *Navigation* per GET von einer fremden Seite mit. Die Frage
war also: Gibt es eine zustandsändernde Route, die per GET erreichbar ist?

Ja, genau eine: **`GET /api/auth/qr-token`**. Sie legt eine QR-Login-Nonce an,
die fünf Minuten lang ein Konto öffnet. Lesen konnte ein Angreifer die Antwort
nicht — eine Navigation quer über Ursprünge hinweg gibt keinen Zugriff auf den
Rumpf —, *auslösen* aber schon. Und dasselbe tun Link-Vorschauen,
Virenscanner und die Vorab-Ladelogik der Browser: alles, was ein GET für
gefahrlos hält, weil GET gefahrlos sein soll.

Der Auftrag sah dafür ausdrücklich einen eigenen Befund vor. **Behoben:** Die
Route ist jetzt `POST`, der einzige Aufrufer (`public/js/05-settings.js`)
mitgeändert. Damit ist der Fall unabhängig von jeder CSRF-Entscheidung
erledigt. Festgehalten in `test/qr-token-method-db.test.js` — in beide
Richtungen: POST legt an, GET gibt es nicht mehr.

Alle acht anderen schreibenden GET-Routen hängen am Bearer-Token
(`requireToken`, kein Cookie) und sind damit nicht betroffen.

**Was ein Token kosten würde.** Das Frontend hat einen Engpass: `api(method,
path, body)` in `public/js/01-core.js` deckt **57** zustandsändernde Aufrufe
ab — dort genügte eine Zeile für den Header. Daneben stehen aber **9** rohe
`fetch()`-Aufrufe mit schreibendem Verb, davon **6 Datei-Uploads** mit
`FormData` (CSV-Import Sets/Teile/Minifiguren, Anleitungs-Upload,
Einstellungs-Import, PDF-Auftrag) sowie der Logout. Jeder davon bräuchte den
Header einzeln. `<form method="post">` gibt es nicht, ein verstecktes Feld
wäre also nirgends nötig.

Serverseitig käme eine Middleware dazu, die das Token ausgibt und prüft, plus
eine Ausnahme für die Bearer-Token-Aufrufe der Android-App — die schicken kein
Cookie und brauchen keinen CSRF-Schutz, würden von einer pauschalen Prüfung
aber mitgefangen.

**Empfehlung: vorerst nicht einführen.** Nach dem Umstellen von `/qr-token`
gibt es keine zustandsändernde Route mehr, die `lax` durchlässt. Der
verbleibende Gewinn wäre Tiefenstaffelung gegen einen Browser, der `lax` nicht
umsetzt — das sind Fassungen vor 2020. Dem stehen zehn Änderungsstellen im
Frontend gegenüber, jede mit der Möglichkeit, eine zu vergessen; und eine
vergessene Stelle fällt erst auf, wenn ein Nutzer eine Funktion nicht mehr
benutzen kann.

**Die Gegenposition, damit sie mitentschieden wird.** `SameSite=lax` ist eine
Verteidigungslinie, kein Gürtel *und* Hosenträger. Sie hängt vollständig am
Browser: Wer die App in einer eingebetteten WebView oder einem älteren Client
öffnet, hat sie unter Umständen nicht. Ausserdem wächst die Zahl der Routen
weiter — heute sind es 54, und die nächste zustandsändernde GET-Route ist nur
einen Nachtrag entfernt; die Regel „GET ändert nichts" steht nirgends
geschrieben und wird von nichts geprüft. Wer den Schutz will, führt ihn
billiger jetzt ein als nach den nächsten zwanzig Routen.

Ein Mittelweg wäre, die Regel selbst zu prüfen statt sie zu erzwingen: eine
Testregel, die jede zustandsändernde GET-Route meldet. Das kostet einmalig
wenig und fängt genau den Fall, der hier gefunden wurde.

**Diese Entscheidung liegt bei Marco, nicht hier.**

### Zahlen

Testzahl **757 → 785**, alle grün, 0 übersprungen (`REQUIRE_DB=1`).
`tsc --noEmit`: 0 Fehler. `typecheck:strict` und `npm run build`: sauber.

