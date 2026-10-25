# Begründungen zu `routes/api_v1/index.ts`

Die ausführlichen Kommentare aus `routes/api_v1/index.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
/api/v1 — Kompositions-Router.

Der frühere Monolith routes/api_v1.ts (~1.800 Zeilen) ist in Fach-Module
aufgeteilt; jedes Modul bringt seine eigenen Routen mit und nutzt die
gemeinsame Middleware aus ./middleware.ts. Die Mount-Reihenfolge ist
unkritisch (keine überlappenden Pfad-Muster zwischen den Modulen).

Die Anmeldung ist NICHT dabei. Sie hängt als eigener Router unter
/api/v1/auth (routes/auth.ts) — dort steht sie vollständig, statt auf zwei
Dateien verteilt zu sein. Siehe die Begründung an der Einhängung in
server.ts.
```
