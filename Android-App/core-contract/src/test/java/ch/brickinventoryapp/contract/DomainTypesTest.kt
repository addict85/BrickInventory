package ch.brickinventoryapp.contract

import ch.brickinventoryapp.contract.testing.decodeCompleted
import ch.brickinventoryapp.contract.testing.testAppThemeResponse
import ch.brickinventoryapp.contract.testing.testCsvImportStatus
import ch.brickinventoryapp.contract.testing.testUserSettings
import ch.brickinventoryapp.model.appearance.Design
import ch.brickinventoryapp.model.domain.CatalogSort
import ch.brickinventoryapp.model.domain.CategoryChoice
import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.RunStatus
import ch.brickinventoryapp.model.domain.SetSort
import ch.brickinventoryapp.model.domain.WantedSort
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The domain types read what the server sends and write what it expects: the
 * wire stays text, unknown values discard no response.
 *
 * Counter-checks (patches under counter-checks/, measured with kotlinc over core-model):
 *   theme-unknown-becomes-default   DesignOrNothing reads unknown as default
 *                                   → red “an empty or unknown design …”
 *   sorting-without-fallback       Setsortierung.aus does not fall back to the default
 *                                   → red “an unknown sorting …”
 *   currency-as-object             Waehrung without value class → red “a currency travels …”
 *   color-choice-empty-is-color         Farbwahl.aus also takes empty as a color → red “empty means all …”
 */
class DomainTypesTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `an empty or unknown design of the server means no information`() {
        for (raw in listOf("\"\"", "\"neonlila\"", "null")) {
            val a = decodeCompleted(AppThemeResponse.serializer(), """{"success":true,"theme":$raw,"preset":"noppe"}""")
            assertNull(raw, a.theme)
            assertEquals(Design.STUD, a.preset)
        }
        assertNull(decodeCompleted(UserSettings.serializer(), """{"app_theme":"neonlila"}""").appTheme)
    }

    @Test
    fun `a design travels as its identifier`() {
        for (d in Design.entries) {
            val text = json.encodeToString(AppThemeResponse.serializer(), testAppThemeResponse(success = true, theme = d))
            assertTrue(text, "\"theme\":\"${d.identifier}\"" in text)
            assertEquals(d, decodeCompleted(AppThemeResponse.serializer(), text).theme)
        }
    }

    @Test
    fun `an unknown sorting counts as the default as on the server`() {
        assertEquals(SetSort.NEWEST, SetSort.from("schraeg_asc"))
        assertEquals(SetSort.NEWEST, SetSort.from(null))
        assertEquals("the watchlist knows no quantity", WantedSort.NEWEST, WantedSort.from("qty_desc"))
        assertEquals(CatalogSort.YEAR_DESCENDING, CatalogSort.from(""))
        for (s in SetSort.entries) assertEquals(s, SetSort.from(s.identifier))
        for (s in WantedSort.entries) assertEquals(s, WantedSort.from(s.identifier))
        for (s in CatalogSort.entries) assertEquals(s, CatalogSort.from(s.identifier))
    }

    @Test
    fun `a currency travels as plain text and may be unknown`() {
        val s = decodeCompleted(UserSettings.serializer(), """{"currency":"XAU"}""")
        assertEquals(CurrencyCode("XAU"), s.currency)
        val text = json.encodeToString(UserSettings.serializer(), testUserSettings(currency = CurrencyCode.CHF))
        assertTrue(text, "\"currency\":\"CHF\"" in text)
        assertEquals("CHF", "${CurrencyCode.CHF}")
    }

    @Test
    fun `an unknown run status does not run and aborts nothing`() {
        val s = decodeCompleted(CsvImportStatus.serializer(), """{"success":true,"status":"finished"}""")
        assertEquals(RunStatus.UNKNOWN, s.status)
        assertTrue(!s.status.running)
        assertTrue(RunStatus.from("pending").running && RunStatus.from("running").running)
        // The server always sends the state; if it is missing after all, nothing runs.
        assertEquals(RunStatus.UNKNOWN, decodeCompleted(CsvImportStatus.serializer(), """{"success":true}""").status)
        val text = json.encodeToString(CsvImportStatus.serializer(), testCsvImportStatus(success = true, status = RunStatus.ERROR))
        assertTrue(text, "\"status\":\"error\"" in text)
    }

    @Test
    fun `empty means all colors and categories, otherwise the choice carries the value`() {
        assertEquals(ColorPicker.All, ColorPicker.from(""))
        assertEquals(ColorPicker.All, ColorPicker.from("  "))
        assertEquals(ColorPicker.All, ColorPicker.from(null))
        assertEquals("Red", ColorPicker.from("Red").value)
        assertNull(ColorPicker.All.value)
        assertEquals(CategoryChoice.All, CategoryChoice.from(""))
        assertEquals("11", CategoryChoice.from("11").value)
    }
}
