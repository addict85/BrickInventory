# Begründungen zu `test/api-inventory.test.js`

Die ausführlichen Kommentare aus `test/api-inventory.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
API-Inventar: JEDER Endpunkt beider Router-Familien muss hier klassifiziert
sein. Der Test parst die Routen-Dateien; taucht ein neuer Endpunkt auf, der
hier fehlt, wird die Suite rot — so kann keine API mehr ungeprüft/undoku-
mentiert dazukommen. Umgekehrt melden verwaiste Einträge entfernte Routen.

Kategorien:
  paritaet         — Lese-Paar Webapp↔Android, deep-verglichen in api-parity
  paritaet-schreib — Schreib-Paar, Effekt-Vergleich in api-parity
  paar-extern      — Paar existiert, ruft aber externe APIs (Rebrickable/
                     Brickset/BrickLink) — nicht automatisiert vergleichbar
  nur-v1           — nur unter /api/v1 implementiert; wird von BEIDEN
                     Clients genutzt (requireToken akzeptiert Sessions) oder
                     ist Android-spezifisch (z.B. Barcode)
  nur-web          — Webapp-spezifisch (Session-Auth-Flows, Datei-Exporte,
                     Uploads, SSE-Streams, Admin-UI der Webapp)

── Was dieser Test NICHT prueft ────────────────────────────────────────────
Ob die Kategorie in JEDE Richtung stimmt. Geprueft wird, dass jeder Endpunkt
eine hat, dass kein Eintrag verwaist ist — und seit Nachtrag 137, dass kein
`nur-web` in Wahrheit von der Android-App gerufen wird.

Diese eine Richtung ist die, die messbar falsch WAR: NACHGEMESSEN trugen
NEUNZEHN Eintraege die Beschriftung `nur-web`, obwohl BrickApiService.kt sie
aufruft — Registrieren, Profil, Passwort aendern, alle drei CSV-Importe, die
Anleitungen, die Farb- und Kategoriefilter, das Design. Jeder einzelne war
einmal richtig und ist es geworden, als die App die Funktion bekam; niemand
ist danach hierher zurueckgegangen. Genau das ist die Bauart, gegen die
dieser Baum seine Pruefungen baut: eine Wahrheit, die an zwei Stellen steht,
und nur eine wird gepflegt.

Die andere Richtung — ein `nur-v1`, das gar niemand ruft — bleibt
ungeprueft; dafuer gibt es test/api-aufrufer.test.js.

Wer wen wirklich ruft, prueft test/api-aufrufer.test.js; dass keine Adresse
unbegruendet auf beiden Oberflaechen steht, test/api-oberflaechen.test.js.
```

<a id="stelle"></a>
## `'GET /api/v1/sets/household-members': 'paritaet',`

```text
Preisverlauf manueller Teile und Minifiguren. Webapp-seitig; die
Android-App zeichnet dort (noch) kein Diagramm — deshalb kein v1-Gegenstück.
Seit hardened-96 gibt es beide auch für die Android-App — der
Detail-Dialog dort zeigte vorher weder Marktpreis je Zustand noch Verlauf.
Set in ein anderes Konto des Haushalts verschieben und die Kontoliste für
die Auswahl beim Erfassen. Beides bisher nur in der Webapp — die
Android-App bekommt sie, wenn die Haushaltssicht dort ankommt.
```

<a id="stelle-2"></a>
## `'DELETE /api/v1/sets/:setNumber/instructions/:instrId': 'nur-v1',`

```text
── Beide Clients, frueher nur die Webapp (Nachtrag 137) ──────────────────

Diese neunzehn standen als `nur-web` unten und waren es einmal auch. Sie
sind es nicht mehr, seit die Android-App Registrieren, Profil, Passwort,
die drei CSV-Importe, die Anleitungen, die Farb- und Kategoriefilter und
das Design bekommen hat — jeder Umzug hat die Beschriftung hier
zurueckgelassen. Aufgefallen ist es erst, als die Beschriftung selbst
geprueft wurde (Test „kein nur-web wird in Wahrheit von der Android-App
gerufen"); vorher war sie eine Behauptung, die niemand nachmisst.
```

<a id="stelle-3"></a>
## `'GET /api/v1/alerts/pending': 'nur-v1',`

```text
Lagerort (Nachtrag 175) — beide Oberflaechen, nie eine Zweitfassung
unter /api. GET /storage spannt Sets UND Teile und gehoert deshalb zu
keiner der beiden Familien allein.
Preisalarm (Nachtrag 176) — beide Oberflaechen. Ohne Kontofilter: Ein
Alarm gehoert genau EINEM Konto (siehe src/finanzen/preisalarm.ts).
Abholung der ausgeloesten Alarme (Nachtrag 177) — beide Oberflaechen.
```

<a id="stelle-4"></a>
## `'GET /api/v1/vouchers': 'nur-v1',`

```text
── Gutscheine ───────────────────────────────────────────────────────────

Durchweg `nur-v1`, und zwar auf Marcos ausdrueckliche Vorgabe: „Bitte die
Login jeweils nur 1x im Backend bauen. Beide Apps sollen die gleichen
Services des Backends verwenden." Es gibt deshalb KEINEN Zwilling unter
routes/ — die Webapp ruft dieselben Adressen wie die Android-App, und
requireToken nimmt Sitzungscookie wie Bearer-Token.
```

<a id="stelle-5"></a>
## `'PUT /api/v1/parts/:partNumber/:colorId/color': 'nur-v1',`

```text
Die Farbe eines manuell erfassten Teils nachtraeglich aendern (Marcos
Bitte vom 19.10., nach dem Import mehrerer Wanted-Listen). nur-v1 wie der
Lagerort darueber: Beide Oberflaechen rufen dieselbe Adresse, eine
Sitzungs-Entsprechung gibt es nicht. Was sie TUT — Umziehen oder
Zusammenlegen, Erfassungen vom gleichen Tag addieren, ein Set-Teil
abweisen — prueft test/teil-farbe-aendern-db.test.js gegen die Datenbank.
```

<a id="stelle-6"></a>
## `'POST /api/v1/auth/reset-password': 'nur-web',`

```text
Nur Webapp

Alle Anmelde-Adressen sind von /api/auth nach /api/v1/auth umgezogen; es
gibt nur noch eine API-Oberflaeche. Die Kategorien haben sich dabei
verschoben, und zwar nicht nur formal:
 * login, logout, me und token-create sind jetzt EINE Umsetzung fuer
   beide Clients — also nur-v1 statt zweimal.
 * qr-login stand hier als nur-web und war es nie: Die App ruft es
   (BrickApiService.qrLogin). Beim Umzug aufgefallen, weil beide
   Eintraege danebenlagen.
```

<a id="androidadressen"></a>
## `function androidAdressen() {`

```text
Jede Adresse, die die Android-App ruft.

Zwei Schreibweisen, weil es zwei gibt: die Retrofit-Anmerkungen im
Dienst-Interface und die von Hand gebauten Adressen fuer SSE, Bilder und
PDF (`"${baseUrl}/api/v1/…"`). Nur die erste zu lesen hiesse, den halben
Client zu kennen — und ein `nur-web` fuer eine Adresse, die die App per SSE
ruft, waere weiterhin unbemerkt falsch.
```
