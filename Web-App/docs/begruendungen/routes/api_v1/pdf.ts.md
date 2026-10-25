# Begründungen zu `routes/api_v1/pdf.ts`

Die ausführlichen Kommentare aus `routes/api_v1/pdf.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
/api/v1/sets/partslist-pdf — asynchrone PDF-Erzeugung.

Job-Status liegt im Dateisystem (data/pdf-jobs), damit alle Cluster-Worker
denselben Stand sehen. Datei-I/O läuft asynchron (fs/promises) — vorher
blockierten readFileSync/writeFileSync den Event-Loop, u. a. im
3-Sekunden-SSE-Fallback-Poll pro verbundenem Client.

SECURITY: jobId wird strikt validiert (JOB_ID_RE), bevor daraus ein
Dateipfad gebaut wird — Express dekodiert URL-Parameter, d. h. ohne
Validierung liesse sich per ..%2F aus data/pdf-jobs ausbrechen
(beliebige *.json lesen, *.pdf/*.json löschen).

SECURITY: Jeder Auftrag trägt seinen Besteller (user_id), und status,
stream und download prüfen ihn. Vorher stand im Auftrag nur der Status —
ein gültiger Token genügte, um mit einer fremden jobId deren PDF zu holen,
und weil der Download die Datei danach löscht, bekam der eigentliche
Besteller ein „PDF nicht mehr verfügbar". Die Zugehörigkeit gehört auf den
Server, nicht in die Unkenntnis der ID (dieselbe Regel wie bei
serveDataFile in server.ts).
```

<a id="abschnitt-2"></a>
## Abschnitt

```text
Auftragskennung.

Vorher `Math.random().toString(36)` — kein kryptografischer Zufall, und wer
eigene Aufträge startet, sammelt beliebig viele Ausgaben derselben Quelle.
Jeder andere Schlüssel im Projekt kommt aus crypto.randomBytes (siehe
routes/auth.ts); hier war die Ausnahme ohne Grund. Der Zeitstempel bleibt
vorn, weil cleanOldPdfJobs und die Fehlersuche im Log davon leben.
```

<a id="pdfjobstatus"></a>
## `PdfJobStatus`

```text
Ein Auftragszustand, wie ihn der Ereignisstrom weiterreicht.

`status?: string | undefined` und nicht nur `status?: string`: Der Strom baut
bei onStatus() ausdruecklich `{ status: data.status, … }`, und data.status
KANN undefined sein. Mit exactOptionalPropertyTypes ist das ein Unterschied —
„Feld fehlt" und „Feld ist undefined" sind dann nicht mehr dasselbe, und hier
kommt das zweite vor.
```

<a id="pdfjobreadfor"></a>
## `pdfJobReadFor`

```text
Auftrag lesen UND die Zugehörigkeit prüfen — der einzige Weg, auf dem die
drei Abrufrouten an einen Auftrag kommen.

Antwortet bei fremdem Auftrag mit demselben 404 wie bei einem unbekannten:
Wer nicht berechtigt ist, soll nicht erfahren, ob es die ID überhaupt gibt.

Aufträge ohne user_id stammen aus der Zeit vor dieser Prüfung (höchstens
zehn Minuten alt, siehe PDF_JOB_TTL) und werden abgewiesen — bis zum
nächsten Export ist das Feld überall gesetzt.
```

<a id="laufendejobs"></a>
## `laufendeJobs`

```text
Wie viele Aufträge dieses Benutzers laufen gerade?

Der Stand liegt als Datei im gemeinsamen Verzeichnis, die Zählung sieht also
auch Aufträge anderer Cluster-Worker — anders als ein Zähler im
Prozessspeicher, der in dieser Sammlung schon sechsmal danebenlag.

Abgelaufene Aufträge (älter als PDF_JOB_TTL) zählen nicht mit: Stürzt ein
Worker mitten im Lauf ab, bleibt die Datei auf `running` stehen, und ohne
diese Frist wäre der Benutzer dauerhaft ausgesperrt.
```

<a id="post-sets-partslist-pdf-img-dir"></a>
## `IMG_DIR`

```text
VORHER: _pdfPath.join(__dirname, '..', 'data', 'part_images') — nur EIN
'..'. Von routes/api_v1/ aus zeigte das auf routes/data/part_images,
ein Verzeichnis, das es nie gab. Die Existenzprüfungen darunter
schlugen deshalb immer fehl, und Figurenbilder fielen im PDF still
auf den Ersatzpfad zurück. Ein Tippfehler, der nichts abstürzen
lässt und sich nur als "die Bilder fehlen manchmal" äussert.
MINIFIG_IMAGES_DIR, nicht PART_IMAGES_DIR: Dieser Block sucht
FIGUREN-Bilder. Bei der Aufteilung von data/part_images/ in
parts/ und minifigs/ ist die Ersetzung hier mechanisch auf das
Teile-Verzeichnis gelaufen — die Suche hätte dort nie etwas
gefunden, und der Eintrag wäre mit einem falschen Pfad
(/images/parts/…) in set_minifigs_catalog gelandet.
```
