# Begründungen zu `routes/settings.ts`

Die ausführlichen Kommentare aus `routes/settings.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
── Angemeldete Geräte: Sitzung ODER Token ───────────────────────────────────

MUSS vor router.use(requireLogin) stehen — aus demselben Grund wie /theme
darüber, nur andersherum: Nicht weil gar keine Anmeldung nötig wäre,
sondern weil requireLogin NUR die Sitzung kennt. Die App hat keine; sie
weist sich mit einem Bearer-Token aus.

GEMESSEN: Mit den Routen hinter dem Gatter antwortete /tokens der App mit
401 — die Verwaltung der App-Zugänge war für die App selbst unerreichbar.
Die beiden Routen bringen ihre eigene Absicherung mit
(requireLoginOrToken), es fällt also nichts weg.
```

<a id="get-tokens"></a>
## `get-/tokens`

```text
GET /api/v1/settings/tokens — die eigenen Zugänge auflisten.

── Warum es das jetzt in der Oberfläche gibt ───────────────────────────────
Diese Route und ihr DELETE-Gegenstück gab es schon; einen WEG dorthin nicht.
Damit war ein verlorenes oder verkauftes Telefon nur loszuwerden, indem man
das Passwort ändert (das verwirft seit Nachtrag 3 alle Token). Wer nur EIN
Gerät aussperren will, musste alle anderen mit aussperren.

── Was herausgegeben wird, und was nicht ───────────────────────────────────
`token_id` sind die ersten 16 Zeichen des SHA-256-HASHES, nicht des Tokens.
Daraus lässt sich der Token nicht zurückrechnen; er reicht aber, um die
Zeile beim Löschen wiederzufinden. Der Klartext-Token existiert auf dem
Server ohnehin nicht mehr — er wurde einmal ausgegeben und nie gespeichert.

`aktuell` markiert den Zugang, mit dem GERADE gefragt wird. Ohne das kann
man sich mit dem eigenen Knopf selbst aussperren, ohne es zu merken. Der
Client schickt dafür seinen Token im Authorization-Header mit; die Sitzung
allein sagt nichts darüber, WELCHE Zeile zu ihr gehört.
```

<a id="get-tokens-tokens"></a>
## `tokens`

```text
LEAST ueber beide Fristen: `expires_at` ist die gleitende („so lange
ungenutzt"), `hard_expires_at` die feste, die beim QR-Code gewaehlt
wurde. Was den Nutzer interessiert, ist der FRUEHERE der beiden — der
Tag, an dem dieses Geraet ausgesperrt wird.

LEAST ist dafuer der richtige Griff und nicht bloss der kuerzere: Es
uebergeht NULL-Werte, statt selbst NULL zu werden (anders als eine
Addition oder ein CASE, den man von Hand schreiben muesste). Ohne feste
Frist kommt also weiterhin genau `expires_at` heraus.

`hard_expires_at` steht zusaetzlich in der Antwort, damit die
Oberflaeche „laeuft am … endgueltig ab" von „laeuft ab, wenn 90 Tage
lang ungenutzt" unterscheiden kann. Beides ist derselbe Balken, aber
nicht dieselbe Aussage.
```

<a id="delete-tokens-tokenid"></a>
## `delete-/tokens/:tokenId`

```text
DELETE /api/v1/settings/tokens/:tokenId — einen Zugang entwerten.

── Zur Wirkungsverzögerung, ehrlich gesagt ─────────────────────────────────
Die Zeile ist sofort weg. Der In-Memory-Cache in src/konto/auth.ts ist aber
nach dem KLARTEXT-Token indiziert, und den hat der Server nicht — gezielt
entfernen lässt er sich also nicht. Deshalb wird er hier ganz geleert, wie
beim Passwortwechsel (revokeAllTokens). Das wirkt sofort, allerdings nur im
Arbeitsprozess, der die Anfrage bearbeitet: Im Cluster können die übrigen
den Token noch bis zu TOKEN_TTL_MS (eine Minute) bedienen.

Für „Telefon verloren" ist eine Minute ohne Belang. Wer mehr braucht,
ändert das Passwort — das verwirft zusätzlich alle Sitzungen.
```

<a id="post"></a>
## `post-/`

```text
── GET /api/settings ist ENTFERNT ───────────────────────────────────────────

Sie lieferte GENAU DASSELBE wie GET /raw achtzig Zeilen weiter unten —
beide riefen readSettings(userId, isAdmin) —, nur in einer anderen Huelle:
hier ausgebreitet (`{ success, ...settings }`), dort verschachtelt
(`{ success, settings }`). Zwei Adressen, eine Abfrage, zwei Formen.

Aufrufer hatte nur die zweite: Die Webapp holt /settings/raw (01-core.js und
05-settings.js), die App /api/v1/settings. Nachgemessen ueber beide Baeume.

Nebeneffekt, der den Umzug erst moeglich macht: `GET /api/v1/settings` gibt
es bereits — mit der fuer die App kuratierten Auswahl. Waere diese Route
mitgezogen, staenden zwei verschiedene Antworten auf derselben Adresse.
```

<a id="get-export-data"></a>
## Abschnitt

```text
merkliste.csv kam dazu (Marcos Liste, Stueck 1): „Merklisten sollen
ebenfalls analog den anderen Seiten exportiert und importiert werden."
Im SELBEN Archiv und nicht als eigene Route — die drei einzelnen
/export/csv-Routen sind in diesem Baum ausdruecklich ENTFERNT worden
(„Kein Aufrufer; die Webapp exportiert ueber /api/settings/export/data",
siehe routes/parts.ts und routes/minifigs.ts). Eine neue einzelne Route
hiesse, diese Entscheidung rueckgaengig zu machen.
preisalarme.csv kam dazu (Marcos Liste, Stueck 2): „Preisalarme sollen in
den bestehenden Exporten und Importen ergaenzt werden (in allen)."

In ALLEN heisst hier: in diesem Archiv. Die beiden anderen Exporte des
Baums koennen sie nicht tragen, und das ist kein Versaeumnis:

  * /api/v1/settings/export ist die KONFIGURATION (Schluessel, Grenzen,
    Job-Zeiten). Ein Preisalarm ist eine Angabe ueber ein Set, kein
    Einstellungswert — er stuende dort als zweite Wahrheit neben dieser
    Datei, und der Import dort arbeitet mit einer Whitelist von
    Schluesselnamen, in die eine Tabelle nicht passt.
  * /api/v1/sets/export/rebrickable schreibt das Listenformat einer
    FREMDEN Firma („Set Number,Quantity"). Eine zusaetzliche Spalte
    macht die Datei bei Rebrickable unbrauchbar.
```

<a id="abschnitt-2"></a>
## Abschnitt

```text
── Hier stand `await db.run('DELETE FROM price_cache')` ────────────────

Ohne Admin-Prüfung, denn der Router trägt nur requireLogin. Jedes Konto —
auch ein Unterkonto im Haushalt — konnte damit eine Ein-Zeilen-Datei
({"user_settings":{"currency":"CHF"}}) hochladen und den Preis-Cache der
GANZEN Installation leeren. Beliebig oft. Der nächste Bewertungslauf holt
dann alle Preise neu bei BrickLink, und deren Tageskontingent ist endlich.

Genau diese Lücke ist in routes/finance.ts schon einmal geschlossen
worden (POST /refresh trägt seitdem requireAdmin, mit einer Notiz über
das verbrannte Kontingent). Dieser Weg wurde übersehen — er sieht ja
auch nicht nach „Cache leeren" aus.

Ersatzlos gestrichen statt hinter isAdmin geschoben: price_cache ist über
set_number, condition UND currency_code verschlüsselt. Einträge in der
alten Währung stören nicht, sie passen einfach nicht mehr auf die
Abfrage, und für die neue Währung wird ohnehin frisch geholt. Das Leeren
war also von Anfang an ohne Wirkung auf die Richtigkeit — nur mit einer
auf das Kontingent. Wer den Cache wirklich leeren will, hat dafür
POST /api/finance/refresh (Admin).
```
