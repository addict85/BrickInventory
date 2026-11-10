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
