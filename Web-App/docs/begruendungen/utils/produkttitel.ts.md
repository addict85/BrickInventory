# Begründungen zu `utils/produkttitel.ts`

Die ausführlichen Kommentare aus `utils/produkttitel.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Setnummer aus einem PRODUKTTITEL lesen (UPCitemdb).

── Der Befund ──────────────────────────────────────────────────────────────

Hier stand:

    const m = (item.title||'').match(/(?:#\s*)?(\d{4,6})/i);
    resolve(m ? { set_number: `${m[1]}-1`, name: item.title } : null);

Also: die ERSTE 4- bis 6-stellige Zahl im Titel, egal welche. Titel kommen
von Händlern und sind Fliesstext:

    „LEGO City 2023 Feuerwehrstation 60320"          → 2023
    „LEGO Star Wars Millennium Falcon 7541 Teile"    → 7541
    „LEGO Technic 42115 Lamborghini Sián 3696 Pcs"   → 42115  (zufällig richtig)

In zwei von drei Fällen gewinnt die falsche Zahl, und die Antwort ging als
gültige Setnummer an die App.

── Der zweite Befund: dreistellige Sets waren unsichtbar ───────────────────

NACHGEMESSEN an 15 Händlertiteln: 14 richtig an erster Stelle. Der eine
Fehlschlag war

    „LEGO 1978 Vintage Castle 375"   → ['1978']

`\d{4,7}` sieht die 375 gar nicht, also blieb das JAHR als einziger Kandidat
stehen. Dieselbe Messung auf der App-Seite (Kartonaufdrucke) fiel bei
„375 YELLOW CASTLE 1978" und „928 GALAXY EXPLORER" durch — einmal gewann das
Jahr, einmal kam gar nichts. Alte Sets haben dreistellige Nummern; sie waren
in beiden Apps nicht erreichbar.

Dreistellige Zahlen sind dafür häufiger Rauschen (Seitenzahl, Teilezahl).
Deshalb stehen sie in der Güte GANZ HINTEN: Solange irgendeine vier- bis
siebenstellige Zahl übrig ist, ändert sich nichts an der Antwort.

── Die Regeln, und warum genau diese ───────────────────────────────────────

Es wird NICHT versucht, die richtige Zahl sicher zu erraten — das geht aus
einem Fliesstext nicht. Es werden nur die ausgeschlossen, die nachweislich
etwas anderes sind, alles andere wird nur GEORDNET. Der Aufrufer prüft die
Kandidaten dann gegen den Katalog; erst dieser Abgleich entscheidet.

 1. Eine Zahl, auf die ein MENGENWORT folgt, ist eine Teilezahl und fällt
    weg. („3696 Pcs", „7541 Teile", „1250 Steinen")
 2. Ein Variantenzusatz (`60445-1`) ist die einzige EINDEUTIGE Schreibweise
    einer Setnummer — er steht vorn.
 3. Eine Zahl direkt hinter `#` ist bevorzugt — so schreiben Händler die
    Artikelnummer aus.
 4. Eine vierstellige Zahl zwischen 1949 und dem nächsten Jahr ist
    wahrscheinlich ein Jahr und wird ZURÜCKGESTUFT — nicht verworfen.
    LEGO-Sets mit vierstelliger Nummer in diesem Bereich gibt es wirklich
    (z. B. 1978er Serien). Verwerfen hiesse, dem Katalogabgleich eine
    mögliche Antwort vorzuenthalten; Zurückstufen kostet nichts.
    1949 ist das Gründungsjahr der Steine; früher datierte Zahlen sind keine
    Jahresangaben in einem LEGO-Titel.
 5. Danach nach Stellenzahl in der Reihenfolge 5, 4, 6, 7, 3 — das ist die
    Häufigkeit echter Setnummern, nicht ihre Grösse.
 6. Bei Gleichstand die Reihenfolge im Text.

── Dieselbe Frage steht in Kotlin ──────────────────────────────────────────
`setNumberCandidates()` in Android-App/…/ui/screens/BarcodeScannerScreen.kt
beantwortet sie für die Texterkennung, offline in der Kameraschleife — sie
kann diese Datei nicht aufrufen. Damit die beiden nicht auseinanderlaufen,
prüfen BEIDE Seiten denselben Korpus: shared/setnummer-korpus.json.
```
