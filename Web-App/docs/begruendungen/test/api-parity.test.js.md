# Begründungen zu `test/api-parity.test.js`

Die ausführlichen Kommentare aus `test/api-parity.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
EINE Adresse, BEIDE Ausweise: Sitzung (Weboberfläche) und Bearer-Token
(Android-App) müssen für dieselbe Route dasselbe liefern. Doppelte Routen
gibt es nicht mehr; geprüft wird, dass keine Route nur an einer Ausweisart
hängt.

Der echte Stack läuft (routes/ und routes/api_v1/ unter /api/v1, das echte
db-Modul gegen die Test-DB), nichts ist gestubbt. Verglichen wird ohne die
Envelope-Felder (success, count, page, page_size) per deep-equal.

Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
```

<a id="client"></a>
## `const client = await db.pool.connect();`

```text
── Und die Migrationen, nicht nur initSchema() ──────────────────────────

Hier endete der Aufbau nach initSchema(). Das ergab ein Schema, das KEINE
echte Installation hat: initSchema() laeuft nur bei einer
Versionsaenderung, die nummerierten Migrationen laufen IMMER. Neun
Tabellen gibt es ueberhaupt nur in ihrer Migration (account_links,
wishlist, vouchers, price_alerts, …), und Spalten, die eine Migration
LOESCHT, standen hier noch.

Das ist nicht theoretisch: Genau daran ist GET /api/v1/sets zerbrochen.
schema.sql legt sets.name an, damit Migration 0014 sie anfassen kann, und
Migration 0033 loescht sie am Ende der Kette. Auf DIESEM halben Schema gab
es sie noch — und `SELECT s.*, c.name` hatte damit zwei Spalten namens
name. GEMESSEN: „column reference \"name\" is ambiguous", die ganze
Set-Liste antwortete mit 500, und der Fehler war nur hier zu sehen.

Eine Paritaetspruefung muss gegen das Schema laufen, das die Nutzer haben.
```

<a id="stelle"></a>
## `await db.run('INSERT INTO api_tokens (token, user_id, label) VALUES ($`

```text
Bearer-Token wie ihn die Android-App nutzt — als HASH abgelegt.

Der Kommentar hier versprach früher, validateToken() migriere einen
Klartext-Token beim ersten Treffer selbst. Diesen Rückfallpfad gibt es
nicht mehr (er hätte einen erratenen Token dauerhaft gültig gemacht), und
seither seedete dieser Test einen Token, mit dem man sich nicht anmelden
kann. Aufgefallen ist es nie, weil der ganze Test ohne Postgres
übersprungen wird.
```

<a id="stelle-2"></a>
## `await db.run(`

```text
── Einstellungen: die Vorlage muss BEIDE Wege abdecken ────────────────────

Vorher stand price_cache_ttl hier als BENUTZER-Einstellung. Damit lasen
beide APIs dieselbe Tabelle, und der globale Weg wurde nie berührt — die
v1-Route las ausschliesslich user_settings und lieferte sonst ihre fest
verdrahtete 24. Gemessen: global 48 → Webapp 48, App 24. Der Test war
grün, weil seine Vorlage die einzige Zeile schrieb, die den Fehler
verdeckt.

Jetzt trägt die Vorlage beide Fälle:
  price_cache_ttl  NUR global   → ein globaler Wert muss die App erreichen
  currency         beides       → der Wert des Nutzers muss gewinnen

DO UPDATE statt DO NOTHING ist hier Bedingung: initSchema() legt
price_cache_ttl bereits global mit '24' an — ausgerechnet dem Wert, den
die v1-Route fest verdrahtet hatte. Mit DO NOTHING bliebe die 24 stehen,
beide APIs lieferten 24, und der Vergleich wäre wieder grün, ohne den
globalen Weg berührt zu haben. Kein Wert der Vorlage darf mit einer
Vorgabe übereinstimmen, sonst prüft die Zusicherung nur die Vorgabe.
```

<a id="stelle-3"></a>
## `app.use('/api/v1',       _req('routes/api_v1/index.js'));`

```text
── Die Einhaengepunkte kommen aus server.ts ─────────────────────────────

Sie standen hier als vier feste Zeilen. Beim Zusammenlegen der
API-Oberflaechen sind sie still falsch geworden: Der Pruefstand sprach
weiter /api/settings an, waehrend der Server das laengst unter
/api/v1/settings ausliefert. Ein Pruefstand, der die Verdrahtung
ABSCHREIBT, prueft eine Verdrahtung, die es nicht gibt.
── Die REIHENFOLGE ist Teil der Verdrahtung ─────────────────────────────

/api/v1 (der Index) muss ZUERST stehen, genau wie in server.ts. Sonst
faengt der sitzungsgebundene Router unter /api/v1/sets die Anfragen ab,
die eigentlich die Token-Fassung beantworten soll — gemessen: 401
„Nicht angemeldet" auf /api/v1/sets/…/acquisitions mit gueltigem Token.

_req() statt require(ROOT/...): Die kompilierten Dateien liegen seit
hardened-59 unter dist/, nicht mehr neben den .ts-Quellen. Diese eine
Zeile lud noch aus dem Quellordner und warf MODULE_NOT_FOUND — bemerkt
hat es niemand, weil der ganze Test ohne Postgres übersprungen wird.
```

<a id="for-stelle"></a>
## `for (const [name, pfad] of [`

```text
── Zusammengelegte Routen: EINE Adresse, BEIDE Ausweise (Nachtrag 70) ────

Die Erfassungs-Routen standen bis hierher doppelt — je einmal für Sitzung
und Token — und wurden oben paarweise gegeneinander geprüft. Genau diese
Doppelung war die Fehlerquelle: Sechs der letzten Meldungen kamen daher,
zuletzt zwei verschiedene Marktpreise für denselben Vorgang.

Jetzt gibt es nur noch eine Adresse. Die Frage „verhalten sich beide
Clients gleich?" wird dadurch nicht hinfällig, sondern schärfer: Dieselbe
Route muss mit BEIDEN Ausweisen erreichbar sein und dasselbe liefern.
Genau das prüft dieser Block — und er würde rot, wenn jemand die Route
versehentlich an eine der beiden Auth-Arten bindet.
```

<a id="web-stelle"></a>
## `const web = (await get('/api/v1/settings/raw')).body.settings;`

```text
Die Webapp-Sicht und die kuratierte Sicht der App sind NICHT
zusammengelegt, und das mit Absicht: Die eine trägt die globalen
Schlüssel und die Admin-Felder, die die App weder braucht noch bekommen
soll. Zwei verschiedene Antworten, nicht zwei Fassungen derselben —
geprüft wird deshalb, dass die GEMEINSAMEN Werte übereinstimmen.

Gelesen wird über /settings/raw: Die frühere Adresse GET /api/settings/
lieferte dasselbe in einer anderen Hülle und hatte keinen Aufrufer; sie
ist beim Zusammenlegen der API-Oberflächen entfallen.
```

<a id="mitsitzung"></a>
## `const mitSitzung = (await get('/api/v1/finance/valuation')).body;`

```text
── Was hier vorher stand, und warum es weg ist ─────────────────────────

Diese Prüfung hiess „Bewertung liefert rate_limit" und begründete sich
mit: „Die Webapp zeigt daraus den API-Verbrauch an." Das stimmte nicht.
Nachgemessen über beide Clients in dieser Ablage: Den API-Verbrauch
zeigen Einstellungsseite und Android aus `rate_limits` (PLURAL) von
/v1/admin/cache-stats — den Singular aus der Bewertung las niemand.
Auch die zweite Behauptung im Quelltext („wie in /api/finance/valuation,
Parität") war falsch: Dort gab es das Feld gar nicht.

Gekostet hat es drei Datenbankabfragen JE AUFRUF (gemessen), bei jedem
Öffnen des Finanzreiters und nach jedem Erfassen. Das Feld ist raus;
scripts/check-antwortfelder.js hält es künftig draussen.

Die eigentliche Aussage dieser Prüfung — Sitzung und Token bekommen
DASSELBE — bleibt, jetzt an der ganzen Antwortform statt an einem Feld.
Sie ist damit sogar breiter als vorher.
```

<a id="b-stelle"></a>
## `const b = (await get('/api/v1/sets/75192-1/price-history')).body;`

```text
Vorher verglich diese Prüfung die Webapp-Route gegen die v1-Route. Nach
dem Zusammenlegen gibt es nur eine; die Gleichwertigkeit der Ausweise
steht oben. Was hier bleibt, ist die INHALTLICHE Aussage: Der Verlauf
liefert überhaupt Punkte, und zwar je Zustand getrennt (seit
hardened-89 gibt es kein Feld `history` mehr — die frühere Fassung las
genau das und lief ins Leere).
```

<a id="ra-stelle"></a>
## `const rA = await fetch(base + '/api/v1/sets/40567-1/acquisitions/${awa`

```text
Zusammengelegt (Nachtrag 70): Es gibt nur noch EINE Schreibroute. Geprüft
wird deshalb, dass sie über BEIDE Ausweise dieselbe Wirkung hat — mit
Sitzung am einen Set, mit Token am anderen, danach müssen beide Sets
denselben Stand zeigen. Das ist die Aussage, die nach dem Umbau zählt:
nicht „zwei Routen sind sich einig", sondern „eine Route behandelt beide
Clients gleich".
```

<a id="mittoken"></a>
## `const mitToken = await get('/api/v1/sets', { 'x-no-session': '1' });`

```text
Hier stand `/api/sets/` gegen `/api/v1/sets` — „beide Familien". Seit
dem Zusammenlegen der API-Oberflaechen gibt es nur noch EINEN
Adressraum; die alte Adresse antwortet gar nicht mehr, und der Test
haette einen 404 fuer eine bestandene Abweisung gehalten.

Was WEITER gilt und hier geprueft wird: Es gibt zwei Absicherungen im
Baum — requireToken (nimmt Sitzung ODER Bearer) und requireLogin (nur
Sitzung). Ohne Ausweis muss JEDE davon mit 401 abweisen, nicht mit 200
und nicht mit einer Weiterleitung auf eine HTML-Seite.
```
