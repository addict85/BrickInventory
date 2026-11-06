# Begründungen zu `test/acquisition-all-paths-db.test.js`

Die ausführlichen Kommentare aus `test/acquisition-all-paths-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
ALLE Erfassungs-Wege im Haushalt — Sets, Teile, Minifiguren, je Ändern und
Löschen.

── Woher dieser Test kommt (Marcos Bericht, Nachtrag 55) ───────────────────
„Wenn ich in den Kaufpreisen einen Kaufpreis löschen will (für ein
Unterkonto), erscheint 404 Nicht gefunden — die Zeile wird nicht gelöscht."

Beim Nachsehen war der gemeldete Fall nur einer von SECHS. Nachtrag 45 hatte
dieselbe Lücke geschlossen, aber nur an zwei Stellen: der v1-Fabrik und der
Webapp-Route zum ÄNDERN einer Set-Erfassung. Offen blieben:
  • Set-Erfassung löschen (Marcos Fall)
  • Teil-Erfassung ändern und löschen
  • Minifiguren-Erfassung ändern und löschen

Alle suchten mit `WHERE id=$1 AND user_id=$2` und der eigenen Betrachter-ID.
Zwei der Löschwege waren dabei besonders unangenehm: Sie prüften gar nicht,
ob eine Zeile getroffen wurde — das DELETE lief ins Leere und die Antwort
meldete trotzdem Erfolg. Der Nutzer sah „gelöscht", die Zeile blieb stehen.

Deshalb prüft dieser Test bewusst ALLE sechs Wege statt nur den gemeldeten:
Die Lehre aus Nachtrag 53 lautete, nach zwei Funden derselben Klasse sofort
die ganze Familie durchzugehen. Genau das ist hier der Fall.
```
