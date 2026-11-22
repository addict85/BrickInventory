package ch.brickinventoryapp.app

import ch.brickinventoryapp.app.testing.Examples
import ch.brickinventoryapp.finances.ui.financeTotals
import ch.brickinventoryapp.finances.ui.setRows
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.shared.ui.localAxis
import ch.brickinventoryapp.shared.ui.localValues
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.Locale

/**
 * Sample data for screenshots and UI tests: a PathServer in ticks with
 * real responses and the ViewModels of the main screens against it. This test
 * checks on the JVM that every list really arrives — a screenshot of an
 * empty list showed nothing.
 *
 * Counter-check: in [Examples.RESPONSES] the path
 * "/api/v1/wanted" mistyped → red “every main screen gets content“.
 * Counter-checks: in the detail price avg_price 799 instead of 812.5 →
 * red “the samples are consistent“; „chart“ removed from the value development →
 * red as well (the server's Swiss axis texts stayed).
 * Counter-checks: for the figures again "name" instead of
 * "fig_name" → red “parts and figures carry real names“; the path
 * /api/v1/minifigs/stats removed → red as well (no key figures).
 * Counter-checks: for the Falcon every "wert_gesamt" removed → red
 * “every finance row carries …” (value=null); in the FinanceViewModel the points again
 * translated with Locale.getDefault() when loading → red “the finance axis is formatted
 * only when drawing” ([10/27, , 10/29]) and “the samples are consistent“.
 * Counter-check: for the parts again "quantity" instead of
 * "total_quantity" → red “the parts tiles add up to the total“ (82 against 0).
 * Counter-check: for part 3039 "image_local" removed → red
 * “every tile has a sample image“ ([(3039, null)]).
 * Counter-check: the tree house removed from
 * /finance/valuation → red “every finance row carries …” (2 instead of 3 rows).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SampleDataTest {

    private lateinit var world: Examples.World

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        world = Examples.World()
    }

    @After
    fun tearDown() {
        world.close()
        Dispatchers.resetMain()
    }

    /** In ticks everything is already loaded when the call returns. */
    private fun whenReady(was: String, condition: () -> Boolean) = assertTrue(was, condition())

    @Test
    fun `every main screen gets content`() {
        val gallery = world.gallery().also { it.loadSets() }
        val parts = world.parts().also { it.loadParts() }
        val figures = world.figures().also { it.loadMinifigs() }
        val finances = world.finances().also { it.loadValuation() }
        val wantedList = world.wantedList().also { it.loadWanted() }
        val detail = world.setDetail()
        whenReady("gallery") { gallery.galleryState.value.sets.size == 3 }
        whenReady("parts") { parts.partsState.value.parts.isNotEmpty() }
        whenReady("figures") { figures.minifigsState.value.minifigs.isNotEmpty() }
        whenReady("finances") { finances.financeState.value.valuation != null }
        whenReady("watchlist") { wantedList.wantedState.value.wantedItem.isNotEmpty() }
        whenReady("detail") { detail.setDetailState.value.setDetail != null }
        assertEquals("Millennium Falcon", detail.setDetailState.value.setDetail?.name)
        assertTrue(finances.financeState.value.valuation!!.sets.isNotEmpty())
    }

    /** The photos of parts and figures show names and key figures, not „Name unbekannt“. */
    @Test
    fun `parts and figures carry real names`() {
        val parts = world.parts().also { it.loadParts() }
        val figures = world.figures().also { it.loadMinifigs() }
        whenReady("parts and figures") { parts.partsState.value.parts.isNotEmpty() && figures.minifigsState.value.let {
            it.minifigs.isNotEmpty() && it.minifigStats.types > 0 } }
        val z = parts.partsState.value
        val f = figures.minifigsState.value
        assertTrue(z.parts.toString(), z.parts.all { !it.partName.isNullOrBlank() })
        assertTrue(f.minifigs.toString(), f.minifigs.all { !it.figName.isNullOrBlank() })
        assertTrue("a name is long enough to be shortened", f.minifigs.any { (it.figName?.length ?: 0) > 30 })
    }

    /**
     * The same numbers on every screen: a photo on which the Falcon costs differently
     * in the gallery than in the detail would look like an error of the app.
     */
    @Test
    fun `the samples are consistent`() {
        val finances = world.finances().also { it.loadValuation(); it.loadPortfolioHistory("week") }
        val detail = world.setDetail()
        whenReady("finances") { finances.financeState.value.let { it.valuation != null && it.historyPoints.isNotEmpty() } }
        whenReady("detail") { detail.setDetailState.value.let { it.setPrice != null && it.acquisitions.isNotEmpty() } }
        val falcon = finances.financeState.value.valuation!!.sets.first { it.setNumber == Examples.SET }
        assertEquals(falcon.avgPrice, detail.setDetailState.value.setPrice?.avgPrice)
        assertEquals(listOf(CurrencyCode.CHF), listOf(world.t.session.state.value.currency))
        assertTrue("every purchase has an amount", detail.setDetailState.value.acquisitions.all { it.effectivePrice != null })
        // The axis carries dates, not weekdays — chart.x matches point by point, and
        // translating happens only in the display language.
        val f = finances.financeState.value
        val de = localAxis(f.historyPoints, f.historyDays, Locale.forLanguageTag("de-CH"))
        val en = localAxis(f.historyPoints, f.historyDays, Locale.forLanguageTag("en-GB"))
        assertEquals(listOf("27.10.", "29.10."), de.map { it.xLabel }.filter { it.isNotBlank() })
        assertEquals(listOf("27 Oct", "29 Oct"), en.map { it.xLabel }.filter { it.isNotBlank() })
    }

    /**
     * The state holds the axis raw; formatting happens when drawing. If text in the
     * language of loading already stood there, a language switch would keep showing the old form.
     */
    @Test
    fun `the finance axis is formatted only when drawing`() {
        val before = Locale.getDefault()
        Locale.setDefault(Locale.US)
        try {
            val finances = world.finances().also { it.loadValuation(); it.loadPortfolioHistory("week") }
            whenReady("history") { finances.financeState.value.historyPoints.isNotEmpty() }
            val f = finances.financeState.value
            assertEquals(listOf("27.10", "", "29.10"), f.historyPoints.map { it.xLabel })
            assertEquals(CurrencyCode.CHF, f.historyCurrency)
            val y = localValues(f.historyYAxis, f.historyCurrency!!, Locale.forLanguageTag("de-CH"))
            val label = y.last().label.replace(' ', ' ')
            assertTrue(label, label == "CHF 1’720" || label == "CHF 1'720")
        } finally {
            Locale.setDefault(before)
        }
    }

    /**
     * Every tile of the photos shows an image: its address names a sample image that
     * SampleImages delivers without network. Otherwise the placeholder would stand everywhere.
     */
    @Test
    fun `every tile has a sample image`() {
        val gallery = world.gallery().also { it.loadSets() }
        val parts = world.parts().also { it.loadParts() }
        val figures = world.figures().also { it.loadMinifigs() }
        val wantedList = world.wantedList().also { it.loadWanted() }
        val finances = world.finances().also { it.loadValuation() }
        whenReady("alles") {
            gallery.galleryState.value.sets.isNotEmpty() && parts.partsState.value.parts.isNotEmpty() &&
                figures.minifigsState.value.minifigs.isNotEmpty() && wantedList.wantedState.value.wantedItem.isNotEmpty() &&
                finances.financeState.value.valuation != null
        }
        val addresses = gallery.galleryState.value.sets.map { it.setNumber to it.imageLocal } +
            parts.partsState.value.parts.map { it.partNumber to it.imageLocal } +
            figures.minifigsState.value.minifigs.map { it.figNumber to it.imageLocal } +
            wantedList.wantedState.value.wantedItem.map { it.setNumber to it.imageLocal } +
            finances.financeState.value.valuation!!.sets.map { it.setNumber to it.imageLocal }
        val without = addresses.filter { (_, a) -> a == null || SampleImages.resource(a) == null }
        assertTrue("without a sample image: $without", addresses.size >= 12 && without.isEmpty())
    }

    /**
     * The quantities of the parts tiles add up to the key figure „Stück gesamt“ — a photo with
     * „82“ at the top and „×1“ on every tile looked like a calculation error.
     */
    @Test
    fun `the parts tiles add up to the total`() {
        val parts = world.parts().also { it.loadParts() }
        whenReady("parts") { parts.partsState.value.let { it.parts.isNotEmpty() && it.partsStats != null } }
        val z = parts.partsState.value
        assertEquals(z.partsStats!!.partsTotal, z.parts.sumOf { it.totalQuantity })
    }

    /**
     * The finance photo shows the normal case: every set row with market value, purchase price,
     * condition and P&L, and the rows together add up to the header tile.
     */
    @Test
    fun `every finance row carries price, purchase price, condition and P&L`() {
        val finances = world.finances().also { it.loadValuation() }
        whenReady("finances") { finances.financeState.value.let { it.valuation != null && it.pnl != null } }
        val z = finances.financeState.value
        val rows = setRows(z.valuation!!.sets).map { it.second }
        // Two valued rows and the tree house without market price — the case of the basis row.
        assertEquals(3, rows.size)
        val valued = rows.filter { it.value != null }
        assertEquals(2, valued.size)
        assertTrue(valued.toString(), valued.all { it.purchasePrice != null && it.condition != null && it.pnlPercent != null })
        assertTrue("without market price, with purchase price", rows.single { it.value == null }.purchasePrice != null)
        val header = financeTotals(z.valuation!!, z.partsValuation, z.figsValuation, z.pnl).total
        assertEquals(0, header.compareTo(valued.sumOf { it.value!!.asBigDecimal() }))
    }
}
