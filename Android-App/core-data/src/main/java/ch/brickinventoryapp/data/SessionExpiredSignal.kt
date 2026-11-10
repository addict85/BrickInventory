package ch.brickinventoryapp.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Verbindet den OkHttp-Interceptor (sieht als Erstes, dass der Server einen
 * 401 zurückgibt) mit dem SitzungsDienst (der Einzige, der abmelden darf).
 * Ein Zustand bis zur Quittung statt eines Ereignisses: Ein 401 vor dem ersten
 * Sammler (Kaltstart, Worker) ginge sonst verloren.
 */
@Singleton
class SessionExpiredSignal @Inject constructor() {
    private val _abgelaufen = MutableStateFlow(false)
    val abgelaufen: StateFlow<Boolean> = _abgelaufen.asStateFlow()

    fun notifyExpired() {
        _abgelaufen.value = true
    }

    /** Der Verbraucher hat reagiert; ein weiterer 401 meldet erneut. */
    fun quittiere() {
        _abgelaufen.value = false
    }
}
