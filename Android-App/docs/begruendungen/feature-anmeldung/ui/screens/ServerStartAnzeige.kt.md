# Begründungen zu `feature-anmeldung/ui/screens/ServerStartAnzeige.kt`

Die ausführlichen Kommentare aus `feature-anmeldung/src/main/java/ch/brickinventoryapp/ui/screens/ServerStartAnzeige.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="serverstartanzeige"></a>
## `ServerStartAnzeige`

```text
„Der Server startet gerade“ — mit Fortschritt statt einer Fehlermeldung, wie die
Webapp über /v1/startup-status. Der erste Start einer Neuinstallation holt den
Rebrickable-Katalog und dauert viele Minuten; eine allgemeine Netzmeldung liesse
dabei App oder Server kaputt aussehen, obwohl alles richtig läuft.

Kein Kringel: Ein unbestimmter Kringel sagt „ich weiss nichts“, der Server nennt
aber Schritt und Anzahl. Bei 0 von 0 — er hat noch nicht gezählt — steht ein
unbestimmter Balken, sonst der echte Anteil.

@param status Der zuletzt gemeldete Stand; nie `ready`, sonst zeigt der Aufrufer
        diese Anzeige gar nicht erst.
```
