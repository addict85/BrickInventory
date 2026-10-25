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
- Die langen Kommentare des Servers stehen seit dem 25.10.2026 wörtlich in
  `Web-App/docs/begruendungen/<datei>.md`; im Code steht je Stelle der erste
  Absatz und ein Verweis `Ausführlich: docs/begruendungen/…#anker`. Die
  Kurzfassung ist maschinell gewählt — wer die Stelle anfasst, schreibt sie zu
  einem echten *Warum* um. Neues kommt nicht dorthin, sondern in den Commit.
- Ein Test prüft Code, nicht Kommentartext. Wo eine Begründung im Code stehen
  muss (z. B. eine bewusste Ausnahme), gehört sie in die Kurzfassung.
- Testdateien dürfen im Kopf die Gegenproben aufzählen; das ist dort Teil
  der Prüfung, nicht Geschichte.

## Sprache

Commit-Nachrichten, Kommentare, Testnamen und Oberflächentexte sind Deutsch.

## Tests

- Ein Test prüft **Verhalten**: Er führt den Code aus (`buildAndRequire`,
  `testServer`, notfalls der echte Server) und sieht auf das Ergebnis. Eine
  Regex auf den Quelltext bestätigt nur, dass eine Zeile dasteht — nicht, dass
  sie an der richtigen Stelle steht und wirkt.
- Quelltext-Prüfungen bleiben für **Struktur** (Dateien, Abhängigkeiten,
  Verbote). Wie viele Testdateien nur Quelltext lesen, hält
  `test/ratschen.test.js` fest: Die Zahl darf sinken, nie steigen.
- Jeder neue Test nennt im Kopf seine **Gegenprobe**: was kaputt gemacht wurde
  und welcher Teil dann rot war. Ein Test, der nie rot war, ist unbewiesen.
- Leere Listen prüfen nichts: Testdaten so anlegen, dass die geprüften Felder
  in der Antwort vorkommen.

## Prüfen vor dem Push

- `npm test` im Verzeichnis `Web-App/` braucht eine Test-Datenbank
  (`TEST_DATABASE_URL`, `REQUIRE_DB=1`) und läuft seriell.
- Während eines Volllaufs **keine Dateien ändern**: Viele Wächter lesen den
  Arbeitsbaum, ein halbfertiger Stand ergibt falsche Fehlschläge.
- Ein roter Lauf ist erst dann ein Ausrutscher, wenn der Test einzeln grün
  läuft **und** die CI auf demselben Stand grün ist.

## Merge auf `main`

Nur auf ausdrückliche Anweisung.
