# Begründungen zu `test/lagerort-beide.test.js`

Die ausführlichen Kommentare aus `test/lagerort-beide.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Lagerort — dieselbe Antwort in beiden Oberflächen.

Wie test/bauabgleich-beide.test.js und aus demselben Grund: Marcos stehende
Vorgabe ist „zwei saubere Apps, in den Oberflächen einheitliche Ansichten,
ansonsten identische Funktion". Eine Erweiterung, die nur in der Webapp
landet, verletzt sie — und das fällt erst auf, wenn jemand am Telefon danach
sucht.

Geprüft wird die NAHT. Ob die Zahlen stimmen, beantwortet
test/lagerort-db.test.js gegen echte Daten.
```

<a id="kt-einst"></a>
## `const KT_EINST  = lies(path.join(__dirname, '..', '..', 'Android-App',`

```text
Die Einstellungen der App liegen in mehreren Dateien: Der Bildschirm
selbst traegt nur die Liste, jede Rubrik hat ihre eigene Seite
(EinstellungenUnterseiten.kt) mit der Karte in Einstellungen*.kt. Gelesen
werden deshalb alle, die es betrifft — die
Zusicherung lautet „die App tut das in ihren Einstellungen" und nicht
„in dieser Datei".
```

<a id="stelle"></a>
## `assert.match((web('public/js/02-detailfelder.js') + web('public/js/07-`

```text
Set-Detail und Teil-Detail, in beiden Oberflächen. NICHT bei Figuren:
Eine Minifigur steckt in ihrem Set, und dessen Ort steht im Set-Detail —
ein zweiter Ort für dieselbe Sache wäre eine Stelle, an der zwei
Antworten auseinanderlaufen können.
Beide Oberflaechen bauen das Feld aus EINEM Baustein (07-admin.js,
lagerortBlock) — vorher stand die Auszeichnung an jeder Stelle einzeln.
```

<a id="beide-sprechen-dieselben-vier-endpunkte"></a>
## `test('beide sprechen dieselben vier Endpunkte des Vorrats an', () => {`

```text
═══ Der VORRAT: auswählen ODER neu eintippen ═══════════════════════════════

Marcos Vorgabe: „Der Lagerort soll ein Auswahlfeld mit einem Dropdown sein,
bei dem man auch gleich neue Auswahlwerte erfassen kann. Die Werte sollen
pro User verwaltet werden können und sollen in den Einstellungen bearbeitbar
sein. Der Grossvater soll die Werte der Enkel für die entsprechenden Sets
sehen und wählen können."
```

<a id="geteilt"></a>
## `const geteilt = web('src/bestand/gemeinsam.ts');`

```text
── Was hier fehlte ──────────────────────────────────────────────────────

Der Teil-Dialog zeigte als EINZIGE Stelle im Baum die eigene Liste statt
der des Besitzers. Nicht aus Absicht: Der Kopf des Dialogs kannte die
Besitzer nicht. Eine gruppierte Teilezeile trägt keine Besitzerplakette
(withOwners lässt sie bewusst in Ruhe), und niemandem war aufgefallen,
dass der Dialog sie trotzdem braucht.

Sie kostet nichts: Die Set-Zeilen darunter tragen `owner_user_id` längst;
der Kopf verdichtet sie. Eine zweite Abfrage wäre eine zweite Wahrheit.
```

<a id="stelle-2"></a>
## `assert.match(web('src/bestand/repository/lagerort.ts'),`

```text
Und getippte Werte landen im Vorrat — sonst stünde der Ort am Set und
fehlte in der Liste, aus der er gewählt werden soll.
Hier stand `stelleOrteSicher(besitzerIds, ort)`. Die Funktion gibt es nicht
mehr: Mit der ID muss der Ort VOR dem Zuordnen im Vorrat stehen (ohne
Zeile keine ID), und beides laeuft deshalb in einer Transaktion in
setzeLagerort(). Gesucht wird jetzt die Anweisung selbst — die Aussage
bleibt, dass ein getippter Ort in den Vorrat kommt.
```
