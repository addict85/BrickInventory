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
@Singleton
class PasswortPflicht @Inject constructor() {
    private val _noetig = MutableStateFlow(false)
    val noetig: StateFlow<Boolean> = _noetig.asStateFlow()

    fun melde() { _noetig.value = true }
    fun erledigt() { _noetig.value = false }
}
