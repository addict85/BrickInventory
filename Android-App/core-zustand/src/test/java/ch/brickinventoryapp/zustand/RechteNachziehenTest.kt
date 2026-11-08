package ch.brickinventoryapp.zustand

import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.testing.KontoRepository
import ch.brickinventoryapp.zustand.ui.rechteNachziehen
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestDienste

/**
 * Nach einem 403 `nur_admins` zieht die Sitzung ihr Verwalterrecht aus
 * /auth/me nach — einmal, nicht je abgewiesener Anfrage. Die Kette davor
 * (ServerWaechter meldet nur bei `nur_admins` auf einen Token) prüft
 * ServerWaechterTest; die Abfrageschleife der Verwaltung
 * MonitoringViewModelVerhaltenTest.
 *
 * Gegenproben:
 *   A  die Abfrage `if (!state.value.isAdmin) return false` entfernt → rot
 *      „ein entzogenes Recht wird einmal nachgezogen …“ (zweiter /me-Abruf)
 *   B  ohne Antwort das Recht behalten (`me !is Success -> return false`) → rot
 *      „ohne Antwort von /auth/me gilt das 403“
 */
class RechteNachziehenTest {

    private val pfade = PfadServer()
    private val t = TestDienste(pfade.server)
    private val konto = KontoRepository(t.api, t.cache)

    @After
    fun zu() { t.aufraeumen(); pfade.server.shutdown() }

    @Test
    fun `ein entzogenes Recht wird einmal nachgezogen, dann nicht mehr gefragt`() = runBlocking {
        pfade.antworten["/api/v1/auth/me"] = """{"success":true,"user":{"id":1,"username":"marco","is_admin":false}}"""
        t.sitzung.angemeldet(admin = true)
        assertTrue("Beim Übergang gibt es eine Meldung", t.sitzung.rechteNachziehen(konto))
        assertFalse(t.sitzung.state.value.isAdmin)
        assertTrue("Angemeldet bleibt man", t.sitzung.state.value.isLoggedIn)
        assertFalse("Ein zweites 403 meldet nichts mehr", t.sitzung.rechteNachziehen(konto))
        assertEquals("Höchstens ein /auth/me je Übergang", 1, pfade.anfragenAn("/auth/me").size)
    }

    @Test
    fun `ohne Antwort von auth me gilt das 403`() = runBlocking {
        pfade.codes["/api/v1/auth/me"] = 500
        t.sitzung.angemeldet(admin = true)
        assertTrue(t.sitzung.rechteNachziehen(konto))
        assertFalse(t.sitzung.state.value.isAdmin)
    }

    @Test
    fun `meldet auth me das Recht noch, bleibt es`() = runBlocking {
        pfade.antworten["/api/v1/auth/me"] = """{"success":true,"user":{"id":1,"username":"marco","is_admin":true}}"""
        t.sitzung.angemeldet(admin = true)
        assertFalse(t.sitzung.rechteNachziehen(konto))
        assertTrue(t.sitzung.state.value.isAdmin)
    }
}
