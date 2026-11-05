# Begründungen zu `test/pdf-jobs-db.test.js`

Die ausführlichen Kommentare aus `test/pdf-jobs-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
PDF-Aufträge gegen echte Routen: Wem gehört ein Auftrag, und wie viele darf
einer gleichzeitig starten?

── Warum Verhalten und nicht Quelltext ─────────────────────────────────────
Die Regel lautet „ein fremder Auftrag ist nicht abrufbar". Am Quelltext wäre
das die Frage, ob irgendwo `user_id` vorkommt — und genau diese Sorte
Prüfung hat in dieser Sammlung schon einmal eine Lücke festgeschrieben statt
sie zu finden. Hier laufen deshalb echte Routen mit echten Tokens.

Der Auftrag selbst wird NICHT gestartet (er würde Bilder aus dem Netz laden
und ein PDF bauen); die Auftragszeilen werden direkt gelegt. Geprüft wird
der Abrufweg, und der ist genau der, an dem es fehlte.
```
