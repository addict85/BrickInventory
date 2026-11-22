package ch.brickinventoryapp.state

import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.session.followUpRights
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestDienste

/**
 * After a 403 `nur_admins` the session catches up on its admin right from
 * /auth/me — once, not per rejected request. The chain before that
 * (ServerWaechter only reports on `nur_admins` for a token) is checked by
 * ServerGuardTest; the management's query loop by
 * MonitoringViewModelBehaviorTest.
 *
 * Counter-checks:
 *   A  the check `if (!state.value.isAdmin) return false` removed → red
 *      „ein entzogenes Recht wird einmal nachgezogen …“ (second /me fetch)
 *   B  without a response, keeps the right (`me !is Erfolg -> return false`) → red
 *      „ohne Antwort von /auth/me gilt das 403“
 */
class RightsFollowUpTest {

    private val paths = PfadServer()
    private val t = TestDienste(paths.server)
    private val konto = testAccountRepository(t.api)

    @After
    fun zu() { t.aufraeumen(); paths.server.shutdown() }

    @Test
    fun `a revoked right is followed up once, then no longer asked`() = runBlocking {
        paths.antworten["/api/v1/auth/me"] = """{"success":true,"user":{"id":1,"username":"marco","is_admin":false}}"""
        t.sitzung.angemeldet(admin = true)
        assertTrue("Beim Übergang gibt es eine Meldung", t.sitzung.followUpRights(konto))
        assertFalse(t.sitzung.state.value.isAdmin)
        assertTrue("Angemeldet bleibt man", t.sitzung.state.value.isLoggedIn)
        assertFalse("Ein zweites 403 meldet nichts mehr", t.sitzung.followUpRights(konto))
        assertEquals("Höchstens ein /auth/me je Übergang", 1, paths.requestsAn("/auth/me").size)
    }

    @Test
    fun `without a response from auth me the 403 applies`() = runBlocking {
        paths.codes["/api/v1/auth/me"] = 500
        t.sitzung.angemeldet(admin = true)
        assertTrue(t.sitzung.followUpRights(konto))
        assertFalse(t.sitzung.state.value.isAdmin)
    }

    @Test
    fun `if auth me still reports the right, it stays`() = runBlocking {
        paths.antworten["/api/v1/auth/me"] = """{"success":true,"user":{"id":1,"username":"marco","is_admin":true}}"""
        t.sitzung.angemeldet(admin = true)
        assertFalse(t.sitzung.followUpRights(konto))
        assertTrue(t.sitzung.state.value.isAdmin)
    }
}
