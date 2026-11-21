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
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestDienste

/**
 * Admin rights without a second factor: sign-in and /auth/me name the field
 * `zweiterFaktorPflicht`; after signing in, the session takes it over from /me and
 * reports the requirement, so the setup screen appears. The path via a
 * 403 is checked by ServerGuardTest.
 *
 * Counter-checks:
 *   faktorpflicht-aus-me-ignoriert   adoptAccount() doesn't report → red „auth me mit Pflicht …“
 *   faktorpflicht-immer              adoptAccount() always reports → red „auth me ohne Pflicht …“
 *   faktorpflicht-feld-umbenannt     User reads `zweiter_faktor_pflicht` → red „Anmeldung und auth me …“
 */
class SecondFactorTakeoverTest {

    private val paths = PfadServer()
    private val t = TestDienste(paths.server)
    private val konto = testAccountRepository(t.api)

    @After
    fun zu() { t.aufraeumen(); paths.server.shutdown() }

    @Test
    fun `auth me with obligation shows the setup and keeps the admin right`() = runBlocking {
        paths.antworten["/api/v1/auth/me"] =
            """{"success":true,"user":{"id":1,"username":"marco","is_admin":true,"zweiterFaktorPflicht":true}}"""
        val pflicht = SecondFactorRequired()
        t.sitzung.adoptAccount(konto, pflicht)
        assertTrue("Die Maske für den zweiten Faktor erscheint", pflicht.noetig.value)
        assertTrue("/auth/me nennt das Recht weiter", t.sitzung.state.value.isAdmin)
    }

    @Test
    fun `auth me without obligation leaves the app open`() = runBlocking {
        paths.antworten["/api/v1/auth/me"] = """{"success":true,"user":{"id":1,"username":"marco","is_admin":true}}"""
        val pflicht = SecondFactorRequired()
        t.sitzung.adoptAccount(konto, pflicht)
        assertFalse("Ohne Feld keine Pflicht", pflicht.noetig.value)
        assertTrue(t.sitzung.state.value.isAdmin)

        paths.antworten["/api/v1/auth/me"] =
            """{"success":true,"user":{"id":1,"username":"marco","is_admin":true,"zweiterFaktorPflicht":false}}"""
        t.sitzung.adoptAccount(konto, pflicht)
        assertFalse("false heisst keine Pflicht", pflicht.noetig.value)
        assertEquals(2, paths.requestsAn("/auth/me").size)
    }

    @Test
    fun `sign-in and auth me read the field zweiterFaktorPflicht`() = runBlocking {
        val anmeldung = BrickJson.decodeFromString(LoginResponse.serializer(),
            """{"success":true,"token":"t","user":{"id":1,"username":"marco","is_admin":true,"zweiterFaktorPflicht":true}}""")
        assertTrue("aus der Anmeldung", anmeldung.user?.zweiterFaktorPflicht == true)
        val ohne = BrickJson.decodeFromString(LoginResponse.serializer(),
            """{"success":true,"token":"t","user":{"id":1,"username":"marco"}}""")
        assertFalse("ein älterer Server nennt es nicht", ohne.user?.zweiterFaktorPflicht == true)

        paths.antworten["/api/v1/auth/me"] =
            """{"success":true,"user":{"id":1,"username":"marco","is_admin":true,"zweiterFaktorPflicht":true}}"""
        val me = konto.getMe()
        assertTrue("aus /auth/me", me is Ergebnis.Erfolg &&
            me.data?.zweiterFaktorPflicht == true)
    }
}
