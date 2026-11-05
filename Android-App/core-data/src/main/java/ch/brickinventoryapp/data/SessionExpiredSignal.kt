package ch.brickinventoryapp.data

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Verbindet den OkHttp-Interceptor (sieht als Erstes, dass der Server einen
 * 401 zurückgibt) mit dem AppViewModel (der Einzige, der abmelden darf).
 * Ausführlich: docs/begruendungen/core-data/data/SessionExpiredSignal.kt.md#constructor
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
