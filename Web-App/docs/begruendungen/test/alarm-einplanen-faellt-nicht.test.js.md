# Begründungen zu `test/alarm-einplanen-faellt-nicht.test.js`

Die ausführlichen Kommentare aus `test/alarm-einplanen-faellt-nicht.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Den Preisalarm einzuplanen darf die App nicht schliessen.

── Marcos Befund vom 25.09. ────────────────────────────────────────────────

  „Sobald ich den Schalter Preisalarm in der App aktivieren will, wird die
   App geschlossen."

── Was dort stand ──────────────────────────────────────────────────────────

Derselbe Aufruf an zwei Stellen, einmal abgesichert und einmal nicht:

    BrickInventoryApp.onCreate   runCatching { … einplanen(…) }
    SettingsScreen, am Schalter  einplanen(context, neu)

Das runCatching am Start gibt es nicht ohne Grund: WorkManager ist auf
Marcos Gerät schon einmal beim Hochfahren gescheitert — der Manifest-Eintrag
dazu schliesst mit „WARUM er gescheitert ist, weiss bis heute niemand".
Seither fährt WorkManager beim ERSTEN Zugriff hoch, und dieser Zugriff ist
einplanen(). Am Start fängt ihn das runCatching ab; am Schalter fing ihn
nichts ab, und das ist der Hauptthread einer sichtbaren Oberfläche.

── Warum die Regel an der FUNKTION hängt, nicht an den Aufrufern ───────────

Eine Regel „jeder Aufruf steht in einem runCatching" wäre die naheliegende
und die schwächere: Sie muss jede neue Aufrufstelle einzeln einfangen, und
genau das ist hier schiefgegangen — die zweite Stelle kam später dazu und
niemand sah, dass die erste eine Absicherung trug.

Geprüft wird deshalb die Form, die das Problem unmöglich macht:
einplanen() fängt selbst und GIBT DEN FEHLER ZURÜCK. Ein Rückgabewert
`Throwable?` lässt sich nicht versehentlich werfen — und dass er nicht
stillschweigend weggeworfen wird, prüft Schritt 3.
```
