package ch.brickinventoryapp.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * From the ServerGuard (403 `only_admins` on a token) to the SessionService, which
 * follows up the admin right. A state until acknowledgement: several 403s shortly
 * in a row count once — a polling management page should not trigger a
 * series of /auth/me fetches —, and without a collector none gets lost.
 */
@Singleton
class RightsSignal @Inject constructor() {
    private val _revoked = MutableStateFlow(false)
    val revoked: StateFlow<Boolean> = _revoked.asStateFlow()

    fun report() { _revoked.value = true }

    fun acknowledge() { _revoked.value = false }
}
