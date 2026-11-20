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
interface SecondFactorRequired {
    val noetig: StateFlow<Boolean>
    fun melde()
    fun erledigt()

    /** Für Tests ohne Hilt. */
    companion object {
        operator fun invoke(): SecondFactorRequired = SecondFactorState()
    }
}

@Singleton
internal class SecondFactorState @Inject constructor() : SecondFactorRequired {
    private val _needed = MutableStateFlow(false)
    override val noetig: StateFlow<Boolean> = _needed.asStateFlow()

    override fun melde() { _needed.value = true }
    override fun erledigt() { _needed.value = false }
}
