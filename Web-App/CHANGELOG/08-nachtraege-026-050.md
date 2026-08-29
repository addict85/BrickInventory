# Nachträge 26–50

Teil der Fix-Historie — Übersicht in [CHANGELOG-fixes.md](../CHANGELOG-fixes.md).

---

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
