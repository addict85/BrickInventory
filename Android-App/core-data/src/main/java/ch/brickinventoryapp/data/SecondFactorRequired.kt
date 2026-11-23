package ch.brickinventoryapp.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Admin rights without a set-up second factor: until it is confirmed, the server
 * rejects almost every fetch with 403 `second_factor_required`. Set by the
 * ServerGuard and from /auth/me; the app then shows only the setup form.
 */
interface SecondFactorRequired {
    val needed: StateFlow<Boolean>
    fun report()
    fun done()

    /** The one way to build it, for Hilt and tests alike; the implementation stays internal. */
    companion object {
        operator fun invoke(): SecondFactorRequired = SecondFactorState()
    }
}

internal class SecondFactorState : SecondFactorRequired {
    private val _needed = MutableStateFlow(false)
    override val needed: StateFlow<Boolean> = _needed.asStateFlow()

    override fun report() { _needed.value = true }
    override fun done() { _needed.value = false }
}
