package ch.brickinventoryapp.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Admin rights without a set-up second factor: until it is confirmed, the server
 * rejects almost every fetch with 403 `zweiter_faktor_pflicht`. Set by the
 * ServerWaechter and from /auth/me; the app then shows only the setup form.
 */
interface SecondFactorRequired {
    val noetig: StateFlow<Boolean>
    fun melde()
    fun erledigt()

    /** For tests without Hilt. */
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
