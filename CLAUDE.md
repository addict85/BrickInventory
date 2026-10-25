# Arbeitsregeln für dieses Repository

## Kommentare

Ein Kommentar sagt, **warum** der Code so ist — in zwei bis fünf Zeilen.
Die **Geschichte** (wer was gemeldet hat, was vorher dastand, wie gemessen
wurde, welche Gegenproben liefen) gehört in die **Commit-Nachricht**, nicht in
den Code. `git log -p` und `git blame` finden sie dort wieder.

Gemessen am 25.10.2026: 50,5 % der Zeilen in `server.ts`, `routes/` und
`utils/` waren Kommentare. Der Inhalt war gut, die Form nicht: Ein Diff aus
40 Zeilen Logik und 200 Zeilen Erzählung ist nicht prüfbar.

- Neue Kommentare halten sich daran.
- Bestehende lange Kommentare werden gekürzt, **wenn** die Stelle ohnehin
  angefasst wird — nicht in eigenen Aufräum-Commits.
- Testdateien dürfen im Kopf die Gegenproben aufzählen; das ist dort Teil
  der Prüfung, nicht Geschichte.

## Sprache

Commit-Nachrichten, Kommentare, Testnamen und Oberflächentexte sind Deutsch.

## Prüfen vor dem Push

- `npm test` im Verzeichnis `Web-App/` braucht eine Test-Datenbank
  (`TEST_DATABASE_URL`, `REQUIRE_DB=1`) und läuft seriell.
- Während eines Volllaufs **keine Dateien ändern**: Viele Wächter lesen den
  Arbeitsbaum, ein halbfertiger Stand ergibt falsche Fehlschläge.
- Ein roter Lauf ist erst dann ein Ausrutscher, wenn der Test einzeln grün
  läuft **und** die CI auf demselben Stand grün ist.

## Merge auf `main`

Nur auf ausdrückliche Anweisung.
