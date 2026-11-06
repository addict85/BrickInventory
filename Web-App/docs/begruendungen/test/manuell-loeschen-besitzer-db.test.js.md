# Begründungen zu `test/manuell-loeschen-besitzer-db.test.js`

Die ausführlichen Kommentare aus `test/manuell-loeschen-besitzer-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Papierkorb löscht die Karte, auf die geklickt wurde.

── Der Befund ──────────────────────────────────────────────────────────────
Der manuelle Bereich zeigt im Haushalt die Einträge ALLER Konten — mit
Besitzer-Plakette und einem Papierkorb je Karte (getManualParts und
getManualMinifigs lesen `user_id = ANY(uids)`). Die Löschroute bekam aber
nur Nummer und Farbe und löschte damit immer die Zeile des AUFRUFERS.

NACHGEMESSEN mit zwei verknüpften Konten, beide mit einem manuellen Teil
3001/Farbe 4:

    Manueller Bereich zeigt 2 Karten: [{owner:2, ×5}, {owner:3, ×9}]
    Hauptkonto klickt den Papierkorb der Karte des Kindes
    DELETE /api/v1/parts/3001/4  ->  {"success":true}
    NACHHER: nur noch user 3: ×9

Geklickt war die fremde Karte, gelöscht wurde die eigene, und die Antwort
sagte „success". Die fremde Karte blieb stehen.

── Die Lösung, und warum sie so aussieht ───────────────────────────────────
`?owner=<id>` sagt, WESSEN Zeile gemeint ist; ob das erlaubt ist, entscheidet
resolveWriteTarget() über canWriteFor() — derselbe Helfer, den das ERFASSEN
schon benutzt (owner_user_id). Ohne den Parameter bleibt es beim eigenen
Konto, ein Client, der ihn nicht kennt, läuft also unverändert weiter.

Voraussetzung: Test-DB über TEST_DATABASE_URL (Inhalt wird geleert!).
```

<a id="stelle"></a>
## `{`

```text
── Und die MIGRATIONEN, nicht nur das Schema ───────────────────────────

Diese Datei loescht das Schema und baut es neu auf. initSchemaOnce()
laeuft dabei voll durch (die Marke in schema_meta ist mit weg), bleibt
aber auf dem Stand von db/schema.sql — also VOR allen Migrationen. Das
ist nicht nur fuer diese Datei falsch, sondern fuer jede danach: Sie erbt
eine halbe Datenbank.

GEMESSEN beim Umzug der Teilemengen (Migration 0038): db/schema.sql legt
`parts.quantity DEFAULT 1` an, die Katalogzeilen tragen die echte Zahl.
Die naechste Datei, die die Migrationen laufen liess, brach ab — „Bei 8
Set-Teilen weicht parts.quantity vom Katalog ab". Der Riegel hatte recht.
```

<a id="beide-bewertungen-fuehren-den-besitzer-m"></a>
## `test('beide Bewertungen fuehren den Besitzer mit', async (t) => {`

```text
Damit eine Ansicht den Besitzer MITGEBEN kann, muss sie ihn erst BEKOMMEN.

NACHGEMESSEN in einem Haushalt aus zwei Konten: Die Figuren-Bewertung trug
user_id und owners, die Teile-Bewertung weder das eine noch das andere —
computePartsValuation() zählt seine Felder einzeln auf und liess user_id
weg, während die Figuren-Fassung `{ ...fig }` streut. withOwnerNames()
hängt `owners` aber nur an Zeilen MIT user_id an.

Sichtbar war das in der Android-App: Die manuelle Teile-Kachel zeichnet
OwnerBadges(part.owners) — die Plakette blieb immer leer, während sie auf
der Figuren-Kachel erschien. Die Absicht stand im Code, der Wert kam nie an.
```

<a id="stelle-2"></a>
## `await db.initSchemaOnce();`

```text
KEIN zweites DROP SCHEMA: Der erste Test in dieser Datei hat das Schema
schon frisch aufgebaut, und jedes weitere Fallenlassen ist eine Sperre
mehr, die mit dem Verbindungspool einer gerade beendeten Testdatei
zusammentreffen kann. Die Vorlage hier benutzt deshalb eigene Namen (h2,
k2) und eigene Nummern, damit sie sich mit der ersten nicht ins Gehege
kommt. initSchemaOnce() bleibt, damit der Test auch einzeln läuft.
```

<a id="stelle-3"></a>
## `await haeltTeil(db, haupt, '3001', { menge: 5, colorId: 4, preis: 0.5 `

```text
Der Preis steht seit Migration 0035 in der Erfassung, nicht an der
Bestandszeile.
Menge UND Preis in einem Aufruf: haeltTeil/haeltFigur legen die Erfassung
selbst an. Ein zweites INSERT daneben verstiesse gegen idx_part_acq_tag_zustand
(Migration 0008 — je Konto, Position und TAG eine Erfassung) und zaehlte,
wo es durchkaeme, die Menge doppelt.
```
