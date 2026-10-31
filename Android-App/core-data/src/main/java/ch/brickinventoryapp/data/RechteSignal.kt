package ch.brickinventoryapp.data

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Vom ServerWaechter (403 `nur_admins` auf einen Token) zum AppViewModel, das
 * das Verwalterrecht nachzieht. Wie [SessionExpiredSignal]: Mehrere 403 kurz
 * hintereinander zählen einmal — eine pollende Verwaltungsseite soll keine
 * Folge von /auth/me-Abrufen auslösen.
 */
@Singleton
class RechteSignal @Inject constructor() {
    private val _entzogen = MutableSharedFlow<Unit>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val entzogen: SharedFlow<Unit> = _entzogen.asSharedFlow()

    fun melde() { _entzogen.tryEmit(Unit) }
}
