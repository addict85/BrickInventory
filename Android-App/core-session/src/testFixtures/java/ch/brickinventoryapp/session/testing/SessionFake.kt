package ch.brickinventoryapp.session.testing

import ch.brickinventoryapp.session.SessionRepository
import kotlinx.coroutines.Job

/**
 * The SessionService for tests of ViewModels that trigger a sign-out: it only
 * counts along, so a test can check whether and when a sign-out happened.
 */
class SessionFake(private val logoutOn: () -> Unit = {}) : SessionRepository {
    var logouts = 0
        private set

    override fun launch() = Unit
    override fun logout(): Job {
        logouts++
        logoutOn()
        return Job().apply { complete() }
    }
    override fun secondFactorConfigured() = Unit
    override fun loadSettings() = Unit
    override fun loadMembers() = Unit
    override fun fetchStorageLocations() = Unit
}
