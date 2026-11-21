package ch.brickinventoryapp.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Connects the OkHttp interceptor (sees first that the server returns a
 * 401) with the SitzungsDienst (the only one allowed to sign out).
 * A state until acknowledgement instead of an event: a 401 before the first
 * collector (cold start, worker) would otherwise get lost.
 */
@Singleton
class SessionExpiredSignal @Inject constructor() {
    private val _expired = MutableStateFlow(false)
    val abgelaufen: StateFlow<Boolean> = _expired.asStateFlow()

    fun notifyExpired() {
        _expired.value = true
    }

    /** The consumer has reacted; a further 401 reports again. */
    fun acknowledge() {
        _expired.value = false
    }
}
