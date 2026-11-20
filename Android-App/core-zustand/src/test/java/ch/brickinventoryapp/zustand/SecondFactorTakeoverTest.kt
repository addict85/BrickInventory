package ch.brickinventoryapp.zustand

import ch.brickinventoryapp.data.SecondFactorRequired
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.vertrag.LoginResponse
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.sitzung.adoptAccount
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
 * Verwalterrechte ohne zweiten Faktor: Anmeldung und /auth/me nennen das Feld
 * `zweiterFaktorPflicht`; nach dem Anmelden übernimmt die Sitzung es aus /me und
 * meldet die Pflicht, damit die Einrichtungsmaske erscheint. Den Weg über ein
 * 403 prüft ServerGuardTest.
 *
 * Gegenproben:
 *   faktorpflicht-aus-me-ignoriert   adoptAccount() meldet nicht → rot „auth me mit Pflicht …“
 *   faktorpflicht-immer              adoptAccount() meldet immer → rot „auth me ohne Pflicht …“
 *   faktorpflicht-feld-umbenannt     User liest `zweiter_faktor_pflicht` → rot „Anmeldung und auth me …“
 */
class SecondFactorTakeoverTest {

    private val paths = PfadServer()
    private val t = TestDienste(paths.server)
    private val konto = testAccountRepository(t.api)

    @After
    fun zu() { t.aufraeumen(); paths.server.shutdown() }

    @Test
    fun `auth me mit Pflicht zeigt die Einrichtung und behaelt das Verwalterrecht`() = runBlocking {
        paths.antworten["/api/v1/auth/me"] =
            """{"success":true,"user":{"id":1,"username":"marco","is_admin":true,"zweiterFaktorPflicht":true}}"""
        val pflicht = SecondFactorRequired()
        t.sitzung.adoptAccount(konto, pflicht)
        assertTrue("Die Maske für den zweiten Faktor erscheint", pflicht.noetig.value)
        assertTrue("/auth/me nennt das Recht weiter", t.sitzung.state.value.isAdmin)
    }

    @Test
    fun `auth me ohne Pflicht laesst die App offen`() = runBlocking {
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
    fun `Anmeldung und auth me lesen das Feld zweiterFaktorPflicht`() = runBlocking {
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
