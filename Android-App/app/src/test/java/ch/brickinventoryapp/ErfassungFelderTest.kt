package ch.brickinventoryapp

import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.data.model.AcquisitionsResponse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Die App liest Schätzkennzeichen und Währung einer Erfassung so, wie der
 * Server sie schickt (GET …/acquisitions, Migration 0047).
 *
 * Ein falscher Feldname fällt sonst nirgends auf: Das Feld hat einen
 * Standardwert, und ApiJson übergeht unbekannte Schlüssel.
 *
 * Gegenprobe (am 28.10.2026 gemessen, kotlinc mit Serialisierungs-Plugin):
 *   A  @SerialName("price_estimated") in "preis_geschaetzt" geändert → rot:
 *      „Schaetzkennzeichen und Waehrung kommen an"
 */
class ErfassungFelderTest {
    private val antwort = """
        {"success":true,"acquisitions":[
          {"id":7,"quantity":2,"unit_price":3.5,"condition":"U","price_estimated":true,
           "currency":"CHF","created_at":"2026-10-28T08:00:00Z","owner_user_id":3},
          {"id":8,"quantity":1,"unit_price":null,"condition":"N","price_estimated":false,
           "currency":"EUR","created_at":"2026-10-27T08:00:00Z","owner_user_id":3}
        ],"totals":{"quantity":3,"amount":7.0,"priced_rows":1}}
    """.trimIndent()

    @Test
    fun `Schaetzkennzeichen und Waehrung kommen an`() {
        val r = ApiJson.decodeFromString(AcquisitionsResponse.serializer(), antwort)
        assertTrue(r.acquisitions[0].priceEstimated)
        assertEquals("CHF", r.acquisitions[0].currency)
        assertFalse(r.acquisitions[1].priceEstimated)
        assertEquals("EUR", r.acquisitions[1].currency)
    }

    @Test
    fun `ein aelterer Server ohne die Felder gilt als bezahlt und ohne Waehrung`() {
        val alt = """{"success":true,"acquisitions":[{"id":1,"quantity":1,"purchase_price":10.0}]}"""
        val a = ApiJson.decodeFromString(AcquisitionsResponse.serializer(), alt).acquisitions.single()
        assertFalse(a.priceEstimated)
        assertNull(a.currency)
    }
}
