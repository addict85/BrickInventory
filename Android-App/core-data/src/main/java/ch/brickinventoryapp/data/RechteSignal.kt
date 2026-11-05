package ch.brickinventoryapp.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Vom ServerWaechter (403 `nur_admins` auf einen Token) zum SitzungsDienst, der
 * das Verwalterrecht nachzieht. Ein Zustand bis zur Quittung: Mehrere 403 kurz
 * hintereinander zählen einmal — eine pollende Verwaltungsseite soll keine
 * Folge von /auth/me-Abrufen auslösen —, und ohne Sammler geht keiner verloren.
 */
@Singleton
class RechteSignal @Inject constructor() {
    private val _entzogen = MutableStateFlow(false)
    val entzogen: StateFlow<Boolean> = _entzogen.asStateFlow()

    fun melde() { _entzogen.value = true }

    fun quittiere() { _entzogen.value = false }
}
