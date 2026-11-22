package ch.brickinventoryapp.state

import ch.brickinventoryapp.data.LogoutState
import ch.brickinventoryapp.data.SessionCleanup
import ch.brickinventoryapp.data.testing.FakeApi
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.data.testing.testHouseholdRepository
import ch.brickinventoryapp.data.testing.testPartsRepository
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.session.testing.testSession
import ch.brickinventoryapp.state.testing.StorageStore
import ch.brickinventoryapp.state.ui.Logout
import ch.brickinventoryapp.state.ui.LogoutHook
import ch.brickinventoryapp.state.ui.ScopeService
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * Signing out in order: device cleanup first, then widget, session and scope — and a
 * broken widget hook must not leave the session signed in. What the cleanup removes on
 * the device is LogoutCleansEverythingTest in core-data.
 *
 * Counter-check: `catchUnlessCancelled` around `logoutHook.loggedOut()` removed in Logout.kt
 * → red "a failing widget hook does not keep the session signed in" (IllegalStateException).
 */
class LogoutOrderTest {

    private val fake = FakeApi()
    private val steps = mutableListOf<String>()
    private val session = testSession().apply { loggedIn(admin = false) }
    private val scope = ScopeService(StorageStore(), testHouseholdRepository(fake.api), testPartsRepository(fake.api))

    private fun logout(hook: LogoutHook) = Logout(
        SessionCleanup { steps += "cleanup" }, hook, session, scope,
        LogoutState(testAccountRepository(fake.api), { null }) { },
    )

    @Test
    fun `the device is cleaned before widget and session forget the account`() = runTest {
        scope.setAccount(ScopeFilter.View.GALLERY, "7")
        logout { steps += "widget" }.execute()

        assertEquals(listOf("cleanup", "widget"), steps)
        assertFalse(session.state.value.isLoggedIn)
        assertEquals(1L, session.logouts.value)
        assertEquals(ScopeFilter.ALL, scope.accounts.value.scopeModes[ScopeFilter.View.GALLERY] ?: ScopeFilter.ALL)
    }

    @Test
    fun `a failing widget hook does not keep the session signed in`() = runTest {
        logout { error("widget gone") }.execute()

        assertEquals(listOf("cleanup"), steps)
        assertFalse(session.state.value.isLoggedIn)
    }
}
