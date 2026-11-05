package ch.brickinventoryapp.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Verwalterrechte ohne eingerichteten zweiten Faktor: Bis er bestätigt ist, weist
 * der Server fast jeden Abruf mit 403 `zweiter_faktor_pflicht` ab. Gesetzt vom
 * ServerWaechter und aus /auth/me; die App zeigt dann nur die Einrichtungsmaske.
 */
@Singleton
class ZweiterFaktorPflicht @Inject constructor() {
    private val _noetig = MutableStateFlow(false)
    val noetig: StateFlow<Boolean> = _noetig.asStateFlow()

    fun melde() { _noetig.value = true }
    fun erledigt() { _noetig.value = false }
}
