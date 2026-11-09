# Begründungen zu `src/konto/kontoEntfernen.ts`

Die ausführlichen Kommentare zu `src/konto/kontoEntfernen.ts`, wörtlich aus der früheren Stelle
übernommen. Im Code steht je Stelle der erste Absatz und ein Verweis hierher. Neue
Geschichte gehört in die Commit-Nachricht (siehe CLAUDE.md).

<a id="delete-users-id"></a>
## Abschnitt

```text
── Die Zeile ist weg, der Zugang war es nicht ─────────────────────────

Die Bearer-Tokens gehen per ON DELETE CASCADE mit (siehe db/schema.sql).
user_sessions dagegen ist der Tabellenraum des Session-Stores und hat
KEINEN Fremdschluessel auf users — die offene Sitzung des geloeschten
Kontos lief weiter, und war es ein Verwalter, blieb es einer.

Derselbe Aufruf steht schon beim Admin-Passwortreset, bei
/change-password und bei /reset-password. Er fehlte ausgerechnet dort,
wo das Konto ganz verschwindet.
```
