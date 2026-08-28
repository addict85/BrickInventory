package ch.brickinventoryapp.data

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Verbindet den OkHttp-Interceptor (sieht als Erstes, dass der Server einen
 * 401 zurückgibt) mit dem MainViewModel (der Einzige, der abmelden darf).
 *
 * Der Interceptor läuft auf einem OkHttp-Dispatcher-Thread und kennt weder
 * ViewModel noch Compose — er kann also nicht selbst ausloggen. Er meldet den
 * abgelaufenen Token stattdessen hier; MainViewModel sammelt [events] und
 * ruft dann logout() auf (siehe SessionFeature.kt).
 *
 * extraBufferCapacity = 1 + DROP_OLDEST: Ein einzelner "Sitzung abgelaufen"-
 * Puffer reicht — meldet der Interceptor mehrere 401 kurz hintereinander
 * (mehrere parallele Requests scheitern gleichzeitig), zählt nur, dass es
 * mindestens einmal passiert ist. Es soll nicht mehrfach hintereinander
 * ausgeloggt/gesnackbart werden.
 */
@Singleton
class SessionExpiredSignal @Inject constructor() {
    private val _events = MutableSharedFlow<Unit>(
        replay = 0,
        extraBufferCapacity = 1,
        onBufferOverflow = kotlinx.coroutines.channels.BufferOverflow.DROP_OLDEST
    )
    val events: SharedFlow<Unit> = _events.asSharedFlow()

    fun notifyExpired() {
        _events.tryEmit(Unit)
    }
}
