package ch.brickinventoryapp.app

import ch.brickinventoryapp.app.widget.WIDGET_HIDDEN
import ch.brickinventoryapp.app.widget.WidgetNumbers
import ch.brickinventoryapp.app.widget.WithoutToken
import ch.brickinventoryapp.app.widget.gvText
import ch.brickinventoryapp.app.widget.widgetDisplay
import ch.brickinventoryapp.app.widget.widgetNumbers
import ch.brickinventoryapp.app.widget.widgetValues
import ch.brickinventoryapp.app.widget.withoutToken
import ch.brickinventoryapp.contract.PnlResponse
import ch.brickinventoryapp.contract.PortfolioHistoryResponse
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.json.BrickJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The numbers of the home screen widget, computed from real responses of the
 * server (P&L overview and weekly history), and their storage as text.
 *
 * Counter-checks:
 *   A  today from the FIRST instead of the second-to-last point → red “today is the
 *      difference of the last two days”
 *   B  total = value instead of value - purchase → red “total is value minus purchase price“
 *   C  in gvText() the plus sign removed → red “a profit carries a plus”
 *   D  widgetDisplay() always returns `stored` → red
 *      “signed out the widget shows no numbers“
 *   E  widgetValues() without the query of
 *      `show` → red “without permission the amounts are hidden“;
 *      counter-checks/widget-shows-amounts.patch
 *   F  counter-checks/widget-profit-loss-from-all.patch: basis
 *      skipped → red “with a basis value and P&L stand as in the finance card“
 *      (32.40 instead of 212.40)
 *   G  withoutToken() always LEEREN → red “without a token the worker clears only when signed out …”;
 *      counter-checks/widget-clears-on-lock.patch
 */
class WidgetNumbersTest {

    private val pnl = BrickJson.decodeFromString(PnlResponse.serializer(),
        """{"success":true,"currency":"CHF","totals":{"purchase":"1000.00","current":"1250.50","pnl_percent":25.05}}""").asView()
    private val history = BrickJson.decodeFromString(PortfolioHistoryResponse.serializer(),
        """{"success":true,"currency":"CHF","period":"week","points":[{"value":1200.0},{"value":1240.0},{"value":1250.5}]}""").asView()

    @Test
    fun `signed out the widget shows no numbers`() {
        val z = widgetNumbers(pnl, history, now = 7)!!
        assertNull("the store still holds numbers, they are not shown", widgetDisplay(z, loggedIn = false))
        assertEquals(z, widgetDisplay(z, loggedIn = true))
    }

    @Test
    fun `without a token the worker clears only when signed out, with a locked device it waits`() {
        assertEquals(WithoutToken.CLEAR, withoutToken(deviceLocked = false))
        assertEquals(WithoutToken.LATER, withoutToken(deviceLocked = true))
    }

    @Test
    fun `total is value minus purchase price`() {
        val z = widgetNumbers(pnl, history, now = 7)!!
        assertEquals(1250.5, z.value!!, 1e-9)
        assertEquals(250.5, z.total!!, 1e-9)
        assertEquals(25.05, z.totalPercent!!, 1e-9)
        assertEquals(CurrencyCode.CHF, z.currency)
        assertEquals(7L, z.state)
    }

    @Test
    fun `today is the difference of the last two days`() {
        val z = widgetNumbers(pnl, history, now = 0)!!
        assertEquals(10.5, z.today!!, 1e-9)
        assertEquals(10.5 / 1240.0 * 100, z.todayPercent!!, 1e-9)
    }

    @Test
    fun `without responses there is nothing to show, without history no today`() {
        assertNull(widgetNumbers(null, null, 0))
        val z = widgetNumbers(pnl, null, 0)!!
        assertNull(z.today)
        assertEquals("—", gvText(z.today, z.todayPercent, z.currency))
    }

    @Test
    fun `a profit carries a plus, a loss its minus`() {
        assertTrue(gvText(250.5, 25.05, CurrencyCode("CHF")).startsWith("+"))
        assertTrue(gvText(250.5, 25.05, CurrencyCode("CHF")).contains("%"))
        assertTrue(gvText(-3.0, null, CurrencyCode("CHF")).contains("3.00") || gvText(-3.0, null, CurrencyCode("CHF")).contains("3,00"))
        assertTrue(!gvText(-3.0, null, CurrencyCode("CHF")).startsWith("+"))
    }

    @Test
    fun `without permission the amounts are hidden`() {
        val z = widgetNumbers(pnl, history, now = 7)!!
        val obscured = widgetValues(z, show = false)
        assertEquals(Triple(WIDGET_HIDDEN, WIDGET_HIDDEN, WIDGET_HIDDEN), obscured)
        val open = widgetValues(z, show = true)
        assertTrue("with permission the value is shown", open.first.contains("1") && open.first != WIDGET_HIDDEN)
        assertTrue(open.third.startsWith("+"))
    }

    /** The server computes the percentage on the basis; the amount next to it must too. */
    @Test
    fun `with a basis value and P&L stand as in the finance card`() {
        val basis = BrickJson.decodeFromString(PnlResponse.serializer(), """{"success":true,"currency":"CHF","totals":{
            "purchase":"1680.00","current":"1712.40","pnl_percent":14.2,"positions":3,"positions_valued":2,
            "positions_without_market_price":1,"positions_without_purchase_price":0,"baseline_cost":"1500.00",
            "baseline_market_value":"1712.40","baseline_pnl_amount":"212.40","cost_without_market_price":"180.00",
            "market_value_without_purchase_price":"0.00"}}""").asView()
        val z = widgetNumbers(basis, history, now = 7)!!
        assertEquals(1712.4, z.value!!, 1e-9)
        assertEquals(212.4, z.total!!, 1e-9)
        assertEquals(14.2, z.totalPercent!!, 1e-9)
    }

    @Test
    fun `the store reads back what it wrote`() {
        val z = widgetNumbers(pnl, history, 42)!!
        val text = BrickJson.encodeToString(WidgetNumbers.serializer(), z)
        assertEquals(z, BrickJson.decodeFromString(WidgetNumbers.serializer(), text))
    }
}
