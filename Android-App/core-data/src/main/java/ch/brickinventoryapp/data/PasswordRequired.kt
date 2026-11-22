package ch.brickinventoryapp.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

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

    /** For tests without Hilt. */
    companion object {
        operator fun invoke(): PasswordRequired = PasswordRequiredState()
    }
}

@Singleton
internal class PasswordRequiredState @Inject constructor() : PasswordRequired {
    private val _needed = MutableStateFlow(false)
    override val needed: StateFlow<Boolean> = _needed.asStateFlow()

    override fun report() { _needed.value = true }
    override fun done() { _needed.value = false }
}
