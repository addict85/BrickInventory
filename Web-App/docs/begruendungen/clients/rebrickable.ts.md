# Begründungen zu `clients/rebrickable.ts`

Die ausführlichen Kommentare aus `clients/rebrickable.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="rbsetteil"></a>
## `RbSetTeil`

```text
Eine Teilezeile, wie sie /lego/sets/{id}/parts liefert.

Steht HIER und nicht bei den zwei Aufrufern: Der Vertrag gehoert dem, der
ihn liefert. Zweimal hingeschrieben waere er eine zweite Wahrheit, die beim
naechsten Feld auseinanderlaeuft.

Alles Optionale ist als solches markiert; jedes `||`- oder `??`-Ausweichen
bei den Aufrufern entspricht genau einem `?` hier.
```

<a id="getrbkey"></a>
## `getRbKey`

```text
Der Rebrickable-Schluessel — aus der zentralen Einstellungs-Lesung.

Diese Funktion stand DREIMAL da (hier, jobs/partsCatalogEnrich,
jobs/backfillBlPartNumbers) und nicht gleich: Hier stand ein eigenes
`SELECT value FROM global_settings`, dort getGlobalSetting(). Der Rueckfall
unterschied sich ebenfalls — '' gegen null. Beides ist an den Aufrufstellen
gleich falsch-artig (`if (!key)`), aber es waren zwei Wege zu derselben
Zeile, und einer ging am Einstellungs-Modul vorbei.

Jetzt einer. null heisst: nicht eingerichtet.
```

<a id="httpsgetrobust"></a>
## Abschnitt

```text
Neun der zwoelf Aufrufer dieser Funktion schicken
`Authorization: key <REBRICKABLE_API_KEY>`. Bis hierher wurde der
Kopf beim Folgen unveraendert weitergereicht — eine Umleitung auf
einen fremden Host bekam damit den Schluessel, und eine Umleitung
von https auf http gab ihn im Klartext preis (die
Bibliothekswahl eine Zeile hoeher liess beides zu).

Die Regel dafuer steht in src/infra/fremdeAdressen.ts, gemeinsam mit
der des Dateidownloads darunter: Obergrenze, kein Downgrade,
Geheimnisse beim Hostwechsel abwerfen.

OHNE Host-Allowlist: Die Ausgangsadressen dieser Funktion sind
fest (rebrickable.com und lego.brickinstructions.com), und eine
Liste aus geratenen Hosts waere schlechter als keine — sie sperrte
Anleitungen aus, ohne dass jemand die Ursache saehe. Der
Dateidownload prueft den Host, WEIL er das Geholte ausliefert.
```

<a id="downloadfile"></a>
## Abschnitt

```text
── Warum der Host hier geprueft wird, und zwar bei JEDEM Sprung ──────────

Was diese Funktion holt, landet unter data/instructions/ bzw. im
Bild-Cache — und von dort liefert der Server es an jeden angemeldeten
Nutzer aus. Ein ungeprueftes Umleitungsziel wie http://127.0.0.1:5432/
waere damit nicht nur abgerufen, sondern auch zurueckgegeben worden.

Die Ausgangsadresse allein zu pruefen reicht nicht: Sie stammt teils aus
scrapeInstructions(), und dessen Muster
`https?://[^"]*lego\.com[^"]*\.pdf` trifft eine TEILZEICHENKETTE, also
auch `https://lego.com.angreifer.tld/x.pdf`. Die Pruefung am holenden Ende
faengt das mit ab — unabhaengig davon, wie die Adresse hierher kam.
```

<a id="lookuppart"></a>
## Abschnitt

```text
Bild soll den Stein immer in der gewählten Farbe zeigen: Rebrickable
liefert dafür ein eigenes Farb-Bild über den Parts/Colors-Endpoint.
(Der lokale set_parts_catalog-Cache ist meist leer, da er nur Farben
enthält, die bereits über ein importiertes Set gesehen wurden.)
0 IST eine Farbe — Schwarz.

Die Bedingung lautete `colorId && colorId !== 0` und schloss damit
ausgerechnet Schwarz aus: Das Farbbild wurde nie geholt, und es blieb
beim allgemeinen part_img_url (bei vielen Teilen die weisse Fassung).
"Keine Farbe" kommt jetzt als null herein (siehe public/js/06-minifigs.js),
ist also unterscheidbar.
```

<a id="abschnitt"></a>
## Abschnitt

```text
── BrickLink-Nummer → Rebrickable-Nummer ───────────────────────────────────

Fuer den Import von BrickLink-Wanted-Listen (Marcos Liste, Stueck 4). Die
Richtung ist die UNGEWOHNTE: Der ganze uebrige Baum geht von Rebrickable
nach BrickLink (external_ids), weil Rebrickable die Heimatnummer fuehrt.

── Warum JEDE Antwort gegengeprueft wird ──────────────────────────────────

Ob Rebrickables /lego/parts/ einen Filter `bricklink_id` annimmt, ist NICHT
belegt: Die Doku ist aus dieser Umgebung nicht erreichbar (ENOTFOUND), und
das Aenderungsprotokoll erwaehnt „external system filters in /lego/parts/"
ohne den Parameternamen zu nennen. Unbelegt heisst hier nicht „ausprobieren
und hoffen":

Jeder Treffer muss in seinen external_ids.BrickLink die GESUCHTE Nummer
tragen. Damit ist das Ergebnis richtig, UNABHAENGIG davon, ob der Filter
wirkt. Nimmt die API ihn nicht an, ignoriert sie ihn und liefert die erste
Seite des ganzen Katalogs — und die Gegenpruefung weist sie ab.

Dass der Filter ignoriert wird, ist ausserdem ERKENNBAR: Dann steht in
`count` die Groesse des ganzen Katalogs. Wird das einmal gesehen, bleibt
Weg 2 fuer den Rest des Laufs aus — sonst kostet jeder offene Posten einen
Abruf aus Marcos Tageskontingent, ohne je etwas zu finden.
```

<a id="traegtblnummer"></a>
## `traegtBlNummer`

```text
Traegt dieses Rebrickable-Teil die gesuchte BrickLink-Nummer?

`unknown` und nicht `any`: test/ratschen.test.js laesst die Zahl der `any`
im Baum nur sinken. Hier kostet es nichts — die Antwort wird ohnehin Feld um
Feld abgetastet, und genau das verlangt `unknown` auch.

Zwei Gestalten, weil Rebrickable sie beide liefert: Bei Teilen ist
external_ids.BrickLink ein Feld von Nummern (so liest es
utils/partsImport.ts), bei Farben steckt es eine Ebene tiefer in `ext_ids`
(so liest es utils/blZuordnung.ts). Beide Schreibweisen stehen im Baum
belegt, also fragt diese Pruefung beide.
```
