package ch.brickinventoryapp.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Das Konto meldet sich noch mit seinem Startpasswort an: Bis es ersetzt ist,
 * weist der Server jeden Abruf mit 403 `passwort_wechsel_noetig` ab. Der
 * ServerWaechter setzt den Zustand, die App zeigt dann die Maske „Startpasswort
 * ersetzen“ statt einer Kette von Fehlermeldungen.
 */
interface PasswortPflicht {
    val noetig: StateFlow<Boolean>
    fun melde()
    fun erledigt()

    /** Für Tests ohne Hilt. */
    companion object {
        operator fun invoke(): PasswortPflicht = PasswortPflichtZustand()
    }
}

@Singleton
internal class PasswortPflichtZustand @Inject constructor() : PasswortPflicht {
    private val _noetig = MutableStateFlow(false)
    override val noetig: StateFlow<Boolean> = _noetig.asStateFlow()

    override fun melde() { _noetig.value = true }
    override fun erledigt() { _noetig.value = false }
}
