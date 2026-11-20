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
interface PasswordRequired {
    val noetig: StateFlow<Boolean>
    fun melde()
    fun erledigt()

    /** Für Tests ohne Hilt. */
    companion object {
        operator fun invoke(): PasswordRequired = PasswordRequiredState()
    }
}

@Singleton
internal class PasswordRequiredState @Inject constructor() : PasswordRequired {
    private val _needed = MutableStateFlow(false)
    override val noetig: StateFlow<Boolean> = _needed.asStateFlow()

    override fun melde() { _needed.value = true }
    override fun erledigt() { _needed.value = false }
}
