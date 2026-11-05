# Begründungen zu `test/merkliste-zeile-beide.test.js`

Die ausführlichen Kommentare aus `test/merkliste-zeile-beide.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Merklisten-Zeile: kein Übernahme-Knopf, dafür der Marktpreis — in BEIDEN
Oberflächen. Und der Lagerort steht im Detail der manuellen Einträge.

── Marcos Vorgaben vom 24.09. ──────────────────────────────────────────────

  „Auf dem Detail Dialog der manuell erfassten Teile ist der Lagerort nicht
   ersichtlich. Auf dem Detaildialog der manuell erfassten Minifiguren ist
   das Lagerort nicht ersichtlich. Zumindest in der Android App, evtl auch
   in der Webapp."

  „Bitte in der Tabelle der Merkliste der Button In die Galerie aufnehme
   entfernen und dafuer den Marktpreis anzeigen. Dies ebenfalls in der
   Android und Webapp Umsetzen."

── Warum eine Regel über beide ─────────────────────────────────────────────

„Zumindest in der Android App, evtl auch in der Webapp" beschreibt das
Muster, das diesen Baum durchzieht: Eine Änderung landet in einer der beiden
Oberflächen, die andere bleibt zurück. Diese Prüfung liest beide Quellbäume
und verlangt dasselbe von beiden.

Gelesen wird OHNE Kommentarzeilen. Sonst genügte ein Absatz, der den
entfernten Knopf ERKLÄRT, und die Regel hielte ihn für vorhanden — dieselbe
Falle, die in diesem Projekt schon mehrfach zugeschlagen hat.
```

<a id="stelle"></a>
## `// ── Webapp: auf den Kacheln UND in der Merklisten-Zeile ────────────`

```text
── Marcos zwei Vorgaben vom 24.09., in dieser Reihenfolge ───────────────

  „Den Papierkorb auf den Kacheln der manuell erfassten Teilen und manuell
   erfassten Minifiguren entfernen. Der Button löschen ebenfalls in der
   Tabelle der merkliste entfernen. Auf den Detail Seiten soll jeweils der
   Papierkorb angezeigt werden wie in der Detailseite der sets."

  „Im der Webapp soll auf den Kacheln bei den manuell erfassten Minifiguren
   und den manuell erfassten Teilen sowie bei den Merkliste einträgen der
   Papierkorb oben rechts angezeigt werden analog den Kacheln bei den Sets.
   Dies aber nur in der webapp."

Die zweite nimmt die erste für EINE der beiden Oberflächen zurück. Das
Ergebnis ist deshalb kein Gleichstand, und genau darum steht es hier:
Diese Prüfung ist sonst die Wächterin darüber, dass beide Oberflächen
dasselbe tun. Eine gewollte Abweichung muss benannt sein, sonst zieht sie
beim nächsten Abgleich jemand versehentlich glatt.

Der Grund für die Abweichung liegt in der Bedienung: Am Zeigegerät blendet
sich der Knopf beim Überfahren ein und kostet nichts; auf dem Telefon
stünde er dauerhaft im Bild und läge unter dem Daumen.
```

<a id="ohnesql"></a>
## `const ohneSql = (q) => q.split('\n')`

```text
Die halbe Ursache von Marcos Befund: getManualParts() zählt seine Spalten
auf, und storage fehlte in der Liste. Selbst mit einer Zeile in der
Oberfläche wäre sie leer geblieben. Die Schwesterfunktion
getManualMinifigs() macht SELECT * und hatte den Fehler nie — genau die
Doppelung, vor der der Kommentar an derselben Stelle schon wegen der
Spalte condition warnt.

── ohneKommentare() reicht hier NICHT ────────────────────────────────────

Es entfernt JavaScript-Kommentare (//), nicht die SQL-Kommentare (--)
innerhalb des Template-Literals. Die Gegenprobe hat das gezeigt: Spalte
entfernt, Regel blieb grün — mein eigener Erklärungstext daneben nennt
das Wort. Das ist die bekannte Falle dieses Projekts in neuer Farbe, und
sie fällt genau dann auf, wenn man die Gegenprobe wirklich durchführt.
```
