package ch.brickinventoryapp.state

import ch.brickinventoryapp.data.SecondFactorRequired
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.contract.LoginResponse
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.session.adoptAccount
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.testing.PathServer
import ch.brickinventoryapp.testing.TestServices

/**
 * Admin rights without a second factor: sign-in and /auth/me name the field
 * `secondFactorRequired`; after signing in, the session takes it over from /me and
 * reports the requirement, so the setup screen appears. The path via a
 * 403 is checked by ServerGuardTest.
 *
 * Counter-checks:
 *   faktorpflicht-aus-me-ignoriert   adoptAccount() doesn't report → red „auth me mit Pflicht …“
 *   faktorpflicht-immer              adoptAccount() always reports → red „auth me ohne Pflicht …“
 *   faktorpflicht-feld-umbenannt     User reads `second_factor_required` → red „Anmeldung und auth me …“
 */
class SecondFactorTakeoverTest {

    private val paths = PathServer()
    private val t = TestServices(paths.server)
    private val account = testAccountRepository(t.api)

    @After
    fun tearDown() { t.cleanUp(); paths.server.shutdown() }

    @Test
    fun `auth me with obligation shows the setup and keeps the admin right`() = runBlocking {
        paths.responses["/api/v1/auth/me"] =
            """{"success":true,"user":{"id":1,"username":"marco","is_admin":true,"zweiterFaktorPflicht":true}}"""
        val required = SecondFactorRequired()
        t.session.adoptAccount(account, required)
        assertTrue("Die Maske für den zweiten Faktor erscheint", required.needed.value)
        assertTrue("/auth/me nennt das Recht weiter", t.session.state.value.isAdmin)
    }

    @Test
    fun `auth me without obligation leaves the app open`() = runBlocking {
        paths.responses["/api/v1/auth/me"] = """{"success":true,"user":{"id":1,"username":"marco","is_admin":true}}"""
        val required = SecondFactorRequired()
        t.session.adoptAccount(account, required)
        assertFalse("Ohne Feld keine Pflicht", required.needed.value)
        assertTrue(t.session.state.value.isAdmin)

        paths.responses["/api/v1/auth/me"] =
            """{"success":true,"user":{"id":1,"username":"marco","is_admin":true,"zweiterFaktorPflicht":false}}"""
        t.session.adoptAccount(account, required)
        assertFalse("false heisst keine Pflicht", required.needed.value)
        assertEquals(2, paths.requestsTo("/auth/me").size)
    }

    @Test
    fun `sign-in and auth me read the field secondFactorRequired`() = runBlocking {
        val login = BrickJson.decodeFromString(LoginResponse.serializer(),
            """{"success":true,"token":"t","user":{"id":1,"username":"marco","is_admin":true,"zweiterFaktorPflicht":true}}""")
        assertTrue("aus der Anmeldung", login.user?.zweiterFaktorPflicht == true)
        val without = BrickJson.decodeFromString(LoginResponse.serializer(),
            """{"success":true,"token":"t","user":{"id":1,"username":"marco"}}""")
        assertFalse("ein älterer Server nennt es nicht", without.user?.zweiterFaktorPflicht == true)

        paths.responses["/api/v1/auth/me"] =
            """{"success":true,"user":{"id":1,"username":"marco","is_admin":true,"zweiterFaktorPflicht":true}}"""
        val me = account.getMe()
        assertTrue("aus /auth/me", me is Outcome.Success &&
            me.data?.secondFactorRequired == true)
    }
}
