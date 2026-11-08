package ch.brickinventoryapp.model

import ch.brickinventoryapp.model.data.model.DashboardStats
import ch.brickinventoryapp.model.data.model.PartsStatsResponse
import ch.brickinventoryapp.model.data.model.StatsResponse
import ch.brickinventoryapp.model.ui.model.alsAnsicht
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Sammlung (/stats) und Teile-Reiter (/parts/stats) zeigen dieselbe
 * Gesamtzahl samt Aufschlüsselung, wie die Webapp („394 — 144 aus Sets · 250
 * einzeln“). Gelesen wird aus echten Antworten des Servers (Stand 45210d5).
 *
 * Gegenproben:
 *   A  in PartsStats.alsAnsicht() `+ (manualParts ?: 0)` entfernt → rot
 *      „Teile-Reiter und Sammlung zeigen dieselbe Zahl“ (144 statt 394)
 *   B  in DashboardStats.alsAnsicht() den Rückfall `?: manualParts?.let …`
 *      entfernt → rot „ohne set_parts kommt die Aufschlüsselung aus der Differenz“
 */
class TeileGesamtzahlTest {

    private val json = Json { ignoreUnknownKeys = true }

    private fun teile(text: String) = json.decodeFromString(PartsStatsResponse.serializer(), text).stats!!.alsAnsicht()
    private fun stats(text: String) = json.decodeFromString(StatsResponse.serializer(), text).stats!!.alsAnsicht()

    private val stand = """{"total_sets":3,"total_quantity":4,"total_pieces":394,"total_instructions":0,
        "total_minifigs":0,"total_parts":394"""

    @Test
    fun `Teile-Reiter und Sammlung zeigen dieselbe Zahl`() {
        val reiter = teile("""{"success":true,"stats":{"unique_parts":40,"unique_colors":9,"total_parts":144,"manual_parts":250}}""")
        val sammlung = stats("""{"success":true,"stats":$stand,"set_parts":144,"manual_parts":250}}""")
        assertEquals(394, reiter.teileGesamt)
        assertEquals(sammlung.totalParts, reiter.teileGesamt)
        assertEquals(144 to 250, reiter.teileAusSets to reiter.teileEinzeln)
        assertEquals(144 to 250, sammlung.teileAusSets to sammlung.teileEinzeln)
    }

    @Test
    fun `ohne set_parts kommt die Aufschluesselung aus der Differenz`() {
        val sammlung = stats("""{"success":true,"stats":$stand,"manual_parts":250}}""")
        assertEquals(144, sammlung.teileAusSets)
    }

    @Test
    fun `ein aelterer Server ohne die Felder zeigt die Zahl ohne Aufschluesselung`() {
        val reiter = teile("""{"success":true,"stats":{"unique_parts":40,"unique_colors":9,"total_parts":144}}""")
        val sammlung = stats("""{"success":true,"stats":$stand}}""")
        assertEquals(144, reiter.teileGesamt)
        assertNull(reiter.teileEinzeln)
        assertNull(sammlung.teileAusSets)
        assertEquals(394, DashboardStats(3, 4, 394, 0, 394, 0).alsAnsicht().totalParts)
    }
}
