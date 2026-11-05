# Begründungen zu `public/js/25-navigation.js`

Die ausführlichen Kommentare aus `public/js/25-navigation.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="sichten"></a>
## `SICHTEN`

```text
── DIE SICHTEN HINTER DEM BENUTZERMENÜ ───────────────

── Marcos Vorgabe vom 16.10. ──────────────────────────────────────────────

  „Kannst du in der Webapp die Punkte analog der Android-App in
   verschiedenen Sichten aufteilen? Gerne den Reiter Einstellungen mit den
   Punkten belassen die nur der Administrator setzen kann, und die
   restlichen Seiten oben Rechts hinter dem Benutzernamen als Aufklappbares
   Menu mit 3 - anzeigen."

Die sieben Sichten sind gewöhnliche `.tab`-Flächen wie die der Reiter —
nur ohne Eintrag in der Leiste. Damit gelten für sie dieselben Regeln
(eine ist sichtbar, der Rest nicht), und bindTabs() oben schaltet sie
genauso wieder ab, wenn jemand einen Reiter anklickt.

── Warum jede Sicht ihr eigenes Laden mitbringt ───────────────────────────

Vorher holte der Einstellungs-Reiter bei JEDEM Öffnen alles: Profil,
Gutscheine, Geräte, Alarme, Lagerorte. Das waren fünf Abfragen für eine
Seite, von der man meist nur eine Rubrik sehen wollte. Jetzt holt jede
Sicht, was sie zeigt — dieselbe Regel wie in der Android-App.
```
