package ch.brickinventoryapp.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The account still signs in with its start password: until it is replaced,
 * the server rejects every fetch with 403 `password_switch_needed`. The
 * ServerGuard sets the state, the app then shows the form „Startpasswort
 * ersetzen“ instead of a chain of error messages.
 */
interface PasswordRequired {
    val needed: StateFlow<Boolean>
    fun report()
    fun done()

    /** The one way to build it, for Hilt and tests alike; the implementation stays internal. */
    companion object {
        operator fun invoke(): PasswordRequired = PasswordRequiredState()
    }
}

internal class PasswordRequiredState : PasswordRequired {
    private val _needed = MutableStateFlow(false)
    override val needed: StateFlow<Boolean> = _needed.asStateFlow()

    override fun report() { _needed.value = true }
    override fun done() { _needed.value = false }
}
