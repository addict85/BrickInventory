package ch.brickinventoryapp

import ch.brickinventoryapp.data.ZweiterFaktorPflicht
import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.data.model.LoginResponse
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.ui.kontoUebernehmen
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import ch.brickinventoryapp.data.repository.Ergebnis

/**
 * Verwalterrechte ohne zweiten Faktor: Anmeldung und /auth/me nennen das Feld
 * `zweiterFaktorPflicht`; nach dem Anmelden übernimmt die Sitzung es aus /me und
 * meldet die Pflicht, damit die Einrichtungsmaske erscheint. Den Weg über ein
 * 403 prüft ServerWaechterTest.
 *
 * Gegenproben:
 *   faktorpflicht-aus-me-ignoriert   kontoUebernehmen() meldet nicht → rot „auth me mit Pflicht …“
 *   faktorpflicht-immer              kontoUebernehmen() meldet immer → rot „auth me ohne Pflicht …“
 *   faktorpflicht-feld-umbenannt     User liest `zweiter_faktor_pflicht` → rot „Anmeldung und auth me …“
 */
class ZweiterFaktorUebernahmeTest {

    private val pfade = PfadServer()
    private val t = TestDienste(pfade.server)
    private val konto = KontoRepository(t.api, t.cache)

    @After
    fun zu() { t.aufraeumen(); pfade.server.shutdown() }

    @Test
    fun `auth me mit Pflicht zeigt die Einrichtung und behaelt das Verwalterrecht`() = runBlocking {
        pfade.antworten["/api/v1/auth/me"] =
            """{"success":true,"user":{"id":1,"username":"marco","is_admin":true,"zweiterFaktorPflicht":true}}"""
        val pflicht = ZweiterFaktorPflicht()
        t.sitzung.kontoUebernehmen(konto, pflicht)
        assertTrue("Die Maske für den zweiten Faktor erscheint", pflicht.noetig.value)
        assertTrue("/auth/me nennt das Recht weiter", t.sitzung.state.value.isAdmin)
    }

    @Test
    fun `auth me ohne Pflicht laesst die App offen`() = runBlocking {
        pfade.antworten["/api/v1/auth/me"] = """{"success":true,"user":{"id":1,"username":"marco","is_admin":true}}"""
        val pflicht = ZweiterFaktorPflicht()
        t.sitzung.kontoUebernehmen(konto, pflicht)
        assertFalse("Ohne Feld keine Pflicht", pflicht.noetig.value)
        assertTrue(t.sitzung.state.value.isAdmin)

        pfade.antworten["/api/v1/auth/me"] =
            """{"success":true,"user":{"id":1,"username":"marco","is_admin":true,"zweiterFaktorPflicht":false}}"""
        t.sitzung.kontoUebernehmen(konto, pflicht)
        assertFalse("false heisst keine Pflicht", pflicht.noetig.value)
        assertEquals(2, pfade.anfragenAn("/auth/me").size)
    }

    @Test
    fun `Anmeldung und auth me lesen das Feld zweiterFaktorPflicht`() = runBlocking {
        val anmeldung = ApiJson.decodeFromString(LoginResponse.serializer(),
            """{"success":true,"token":"t","user":{"id":1,"username":"marco","is_admin":true,"zweiterFaktorPflicht":true}}""")
        assertTrue("aus der Anmeldung", anmeldung.user?.zweiterFaktorPflicht == true)
        val ohne = ApiJson.decodeFromString(LoginResponse.serializer(),
            """{"success":true,"token":"t","user":{"id":1,"username":"marco"}}""")
        assertFalse("ein älterer Server nennt es nicht", ohne.user?.zweiterFaktorPflicht == true)

        pfade.antworten["/api/v1/auth/me"] =
            """{"success":true,"user":{"id":1,"username":"marco","is_admin":true,"zweiterFaktorPflicht":true}}"""
        val me = konto.getMe()
        assertTrue("aus /auth/me", me is Ergebnis.Success &&
            me.data.user?.zweiterFaktorPflicht == true)
    }
}
