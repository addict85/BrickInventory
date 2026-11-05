# Begründungen zu `core-data/data/SessionExpiredSignal.kt`

Die ausführlichen Kommentare aus `core-data/src/main/java/ch/brickinventoryapp/data/SessionExpiredSignal.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="constructor"></a>
## `constructor`

```text
Verbindet den OkHttp-Interceptor (sieht als Erstes, dass der Server einen
401 zurückgibt) mit dem AppViewModel (der Einzige, der abmelden darf).

Der Interceptor läuft auf einem OkHttp-Dispatcher-Thread und kennt weder
ViewModel noch Compose — er kann also nicht selbst ausloggen. Er meldet den
abgelaufenen Token stattdessen hier; das AppViewModel sammelt [events] und
ruft dann logout() auf.

extraBufferCapacity = 1 + DROP_OLDEST: Ein einzelner "Sitzung abgelaufen"-
Puffer reicht — meldet der Interceptor mehrere 401 kurz hintereinander
(mehrere parallele Requests scheitern gleichzeitig), zählt nur, dass es
mindestens einmal passiert ist. Es soll nicht mehrfach hintereinander
ausgeloggt/gesnackbart werden.
```
