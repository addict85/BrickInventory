package ch.brickinventoryapp.state

import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.session.followUpRights
import ch.brickinventoryapp.state.testing.TestServices
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * After a 403 `only_admins` the session catches up on its admin right from
 * /auth/me — once, not per rejected request. The chain before that
 * (ServerGuard only reports on `only_admins` for a token) is checked by
 * ServerGuardTest; the management's query loop by
 * MonitoringViewModelBehaviorTest.
 *
 * Counter-checks:
 *   A  the check `if (!state.value.isAdmin) return false` removed → red
 *      „ein entzogenes Recht wird einmal nachgezogen …“ (second /me fetch)
 *   B  without a response, keeps the right (`me !is Success -> return false`) → red
 *      „ohne Antwort von /auth/me gilt das 403“
 */
class RightsFollowUpTest {

    private val paths = PathServer()
    private val t = TestServices(paths.server)
    private val account = testAccountRepository(t.api)

    @After
    fun tearDown() { t.cleanUp(); paths.server.shutdown() }

    @Test
    fun `a revoked right is followed up once, then no longer asked`() = runBlocking {
        paths.responses["/api/v1/auth/me"] = """{"success":true,"user":{"id":1,"username":"marco","is_admin":false}}"""
        t.session.loggedIn(admin = true)
        assertTrue("Beim Übergang gibt es eine Meldung", t.session.followUpRights(account))
        assertFalse(t.session.state.value.isAdmin)
        assertTrue("Angemeldet bleibt man", t.session.state.value.isLoggedIn)
        assertFalse("Ein zweites 403 meldet nichts mehr", t.session.followUpRights(account))
        assertEquals("Höchstens ein /auth/me je Übergang", 1, paths.requestsTo("/auth/me").size)
    }

    @Test
    fun `without a response from auth me the 403 applies`() = runBlocking {
        paths.codes["/api/v1/auth/me"] = 500
        t.session.loggedIn(admin = true)
        assertTrue(t.session.followUpRights(account))
        assertFalse(t.session.state.value.isAdmin)
    }

    @Test
    fun `if auth me still reports the right, it stays`() = runBlocking {
        paths.responses["/api/v1/auth/me"] = """{"success":true,"user":{"id":1,"username":"marco","is_admin":true}}"""
        t.session.loggedIn(admin = true)
        assertFalse(t.session.followUpRights(account))
        assertTrue(t.session.state.value.isAdmin)
    }
}
