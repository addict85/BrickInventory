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
interface ZweiterFaktorPflicht {
    val noetig: StateFlow<Boolean>
    fun melde()
    fun erledigt()
}

/** Für Tests ohne Hilt. */
fun ZweiterFaktorPflicht(): ZweiterFaktorPflicht = ZweiterFaktorZustand()

@Singleton
class ZweiterFaktorZustand @Inject constructor() : ZweiterFaktorPflicht {
    private val _noetig = MutableStateFlow(false)
    override val noetig: StateFlow<Boolean> = _noetig.asStateFlow()

    override fun melde() { _noetig.value = true }
    override fun erledigt() { _noetig.value = false }
}
