package ch.brickinventoryapp.state

import ch.brickinventoryapp.contract.LoginResponse
import ch.brickinventoryapp.contract.testing.decodeCompleted
import ch.brickinventoryapp.data.SecondFactorRequired
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.session.adoptAccount
import ch.brickinventoryapp.state.testing.TestServices
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Admin rights without a second factor: sign-in and /auth/me name the field
 * `secondFactorRequired`; after signing in, the session takes it over from /me and
 * reports the requirement, so the setup screen appears. The path via a
 * 403 is checked by ServerGuardTest.
 *
 * Counter-checks:
 *   factor-required-from-me-ignored   adoptAccount() doesn't report → red „auth me mit Pflicht …“
 *   factor-required-always              adoptAccount() always reports → red „auth me ohne Pflicht …“
 *   factor-required-field-renamed     User reads `second_factor_required` → red „Anmeldung und auth me …“
 */
class SecondFactorTakeoverTest {

    private val paths = PathServer()
    private val t = TestServices(paths.server)
    private val account = testAccountRepository(t.api)

    @After
    fun tearDown() { t.cleanUp(); paths.server.shutdown() }

    @Test
    fun `auth me with obligation shows the setup and keeps the admin right`() = runBlocking {
        paths.responses["/api/v2/auth/me"] =
            """{"success":true,"user":{"id":1,"username":"marco","is_admin":true,"secondFactorRequired":true}}"""
        val required = SecondFactorRequired()
        t.session.adoptAccount(account, required)
        assertTrue("the mask for the second factor appears", required.needed.value)
        assertTrue("/auth/me passes the right on", t.session.state.value.isAdmin)
    }

    @Test
    fun `auth me without obligation leaves the app open`() = runBlocking {
        paths.responses["/api/v2/auth/me"] = """{"success":true,"user":{"id":1,"username":"marco","is_admin":true}}"""
        val required = SecondFactorRequired()
        t.session.adoptAccount(account, required)
        assertFalse("without a field no obligation", required.needed.value)
        assertTrue(t.session.state.value.isAdmin)

        paths.responses["/api/v2/auth/me"] =
            """{"success":true,"user":{"id":1,"username":"marco","is_admin":true,"secondFactorRequired":false}}"""
        t.session.adoptAccount(account, required)
        assertFalse("false means no obligation", required.needed.value)
        assertEquals(2, paths.requestsTo("/auth/me").size)
    }

    @Test
    fun `sign-in and auth me read the field secondFactorRequired`() = runBlocking {
        val login = decodeCompleted(LoginResponse.serializer(),
            """{"success":true,"token":"t","user":{"id":1,"username":"marco","is_admin":true,"secondFactorRequired":true}}""")
        assertTrue("from the sign-in", login.user?.secondFactorRequired == true)
        val without = decodeCompleted(LoginResponse.serializer(),
            """{"success":true,"token":"t","user":{"id":1,"username":"marco"}}""")
        assertFalse("an older server does not name it", without.user?.secondFactorRequired == true)

        paths.responses["/api/v2/auth/me"] =
            """{"success":true,"user":{"id":1,"username":"marco","is_admin":true,"secondFactorRequired":true}}"""
        val me = account.getMe()
        assertTrue("from /auth/me", me is Outcome.Success &&
            me.data?.secondFactorRequired == true)
    }
}
