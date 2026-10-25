# Begründungen zu `utils/minifigsImport.ts`

Die ausführlichen Kommentare aus `utils/minifigsImport.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="figurenauskatalog"></a>
## `figurenAusKatalog`

```text
Die Figuren eines Sets aus dem gemeinsamen Katalog.

Stand zweimal da — hier und in routes/api_v1/sets.ts. Nicht wortgleich: Der
zweite Kandidat war hier `setNumber` (die ROHE Eingabe) statt der blanken
Nummer. Fuer eine Eingabe MIT Versionsanhang ergab das zweimal denselben
Wert, und die blanke Schreibweise wurde nie geprueft — dieselbe entartete
Paarbildung wie schon in utils/handlers/parts.ts und jobs/catalogSync.ts.
beideSchreibweisen() liefert immer zwei verschiedene.
```
