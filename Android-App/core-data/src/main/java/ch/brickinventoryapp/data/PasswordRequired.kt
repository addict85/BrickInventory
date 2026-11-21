package ch.brickinventoryapp.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The account still signs in with its start password: until it is replaced,
 * the server rejects every fetch with 403 `passwort_wechsel_noetig`. The
 * ServerWaechter sets the state, the app then shows the form „Startpasswort
 * ersetzen“ instead of a chain of error messages.
 */
interface PasswordRequired {
    val noetig: StateFlow<Boolean>
    fun melde()
    fun erledigt()

    /** For tests without Hilt. */
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
