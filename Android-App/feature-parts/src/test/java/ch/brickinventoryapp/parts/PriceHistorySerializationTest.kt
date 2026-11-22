package ch.brickinventoryapp.parts

import ch.brickinventoryapp.contract.MinifigsResponse
import ch.brickinventoryapp.contract.PartsValuationResponse
import ch.brickinventoryapp.contract.PriceHistoryResponse
import ch.brickinventoryapp.contract.SetsResponse
import ch.brickinventoryapp.contract.ValuationResponse
import ch.brickinventoryapp.contract.present
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.json.BrickJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Client-side API contract for the price history and the valuation.
 *
 * The history endpoint delivers both conditions separately, plus ready-made
 * chart data. If the shape changes, that would otherwise only show up on the device — and
 * there as an empty chart without an error message.
 *
 * The amounts deliberately stand partly as a STRING in the test data: Postgres
 * delivers NUMERIC as a string, and the server passes the history rows
 * through unchanged. The app's JSON parser is therefore configured to be lenient —
 * that is exactly what is checked here too.
 */
class PriceHistorySerializationTest {

    // Same configuration as AppModule.provideJson()
    private val json = BrickJson

    private val payload = """{
        "success": true,
        "set_number": "75192-1",
        "currency": "CHF",
        "condition": "N",
        "by_condition": {
            "N": {"market_price": 812.5, "purchase_price": 700.0, "pnl_pct": "16.1", "pnl_prozent": 16.1},
            "U": {"market_price": 640.0, "purchase_price": 600.0, "pnl_pct": "6.7", "pnl_prozent": 6.7}
        },
        "history_new": [
            {"recorded_at": "2026-01-01", "avg_price": "700.00", "qty_avg_price": "690.00",
             "min_price": null, "max_price": null, "is_purchase_price": true},
            {"recorded_at": "2026-02-01", "avg_price": "780.00", "qty_avg_price": "770.00",
             "min_price": "700.00", "max_price": "850.00"}
        ],
        "history_used": [
            {"recorded_at": "2026-02-01", "avg_price": "620.00", "qty_avg_price": "610.00"}
        ],
        "current": {
            "N": {"condition": "N", "avg_price": "812.50", "min_price": "760.00",
                  "max_price": "900.00", "fetched_at": "2026-08-09T06:00:00.000Z"},
            "U": {"condition": "U", "avg_price": "640.00", "min_price": "590.00",
                  "max_price": "700.00", "fetched_at": "2026-08-09T06:00:00.000Z"}
        },
        "pnl_pct": "16.1",
        "purchase_price": 700.0,
        "chart": {
            "x": ["2026-01-01", "2026-02-01"],
            "values": [
                {"name": "N", "firstRealIndex": 0,
                 "values": [{"x": "2026-01-01", "y": 700}, {"x": "2026-02-01", "y": 780}]},
                {"name": "U", "firstRealIndex": 1,
                 "values": [{"x": "2026-01-01", "y": 0}, {"x": "2026-02-01", "y": 620}]}
            ]
        }
    }"""

    @Test
    fun `both history series arrive separately`() {
        val r = json.decodeFromString<PriceHistoryResponse>(payload)
        assertEquals(2, r.historyNew.size)
        assertEquals(1, r.historyUsed.size)
        assertEquals(780.0, r.historyNew[1].avgPrice!!, 0.0001)
    }

    @Test
    fun `the chart data carry firstRealIndex`() {
        val chart = json.decodeFromString<PriceHistoryResponse>(payload).chart
        assertEquals(listOf("2026-01-01", "2026-02-01"), chart.x)
        val used = chart.values.first { it.name == "U" }
        assertEquals("der Schlüssel heisst camelCase, nicht first_real_index",
            1, used.firstRealIndex)
        assertEquals(0.0, used.values[0].y, 0.0001)
    }

    @Test
    fun `market price and development per condition`() {
        val r = json.decodeFromString<PriceHistoryResponse>(payload)
        assertEquals(812.5, r.byCondition.new!!.marketPrice!!, 0.0001)
        assertEquals(6.7, r.byCondition.used!!.pnlPct!!, 0.0001)
        assertEquals(2, r.byCondition.present().size)
    }

    @Test
    fun `only one condition added gives exactly one row`() {
        // The server delivers no entry for conditions without an entry —
        // otherwise there would be a market price without a reference figure, and the
        // percentage next to it would be computed against nothing.
        val r = json.decodeFromString<PriceHistoryResponse>("""{
            "success": true, "set_number": "10290-1", "currency": "CHF", "condition": "N",
            "by_condition": {"N": {"market_price": 148.72, "purchase_price": 120.0, "pnl_pct": "23.9", "pnl_prozent": 23.9}},
            "history_new": [], "history_used": [],
            "current": {"N": {"condition": "N", "avg_price": "148.72"}, "U": null},
            "chart": {"x": [], "values": []}
        }""")
        assertEquals(1, r.byCondition.present().size)
        assertEquals(Condition.NEW, r.byCondition.present()[0].first)
        assertNull(r.byCondition.used)
        assertTrue(r.chart.values.isEmpty())
    }

    @Test
    fun `an old response without the new fields does not break`() {
        // In case the app and the server ever drift apart: better an empty
        // chart than a crash in the detail dialog.
        val r = json.decodeFromString<PriceHistoryResponse>(
            """{"success": true, "set_number": "75192-1", "currency": "CHF"}""")
        assertTrue(r.historyNew.isEmpty())
        assertTrue(r.chart.values.isEmpty())
        assertTrue(r.byCondition.present().isEmpty())
    }

    @Test
    fun `the valuation delivers one row per purchase price`() {
        val v = json.decodeFromString<ValuationResponse>("""{
            "success": true, "currency": "CHF", "condition": "U",
            "totals": {"min": "0.00", "avg": "390.00", "max": "0.00", "qty_avg": "390.00"},
            "sets": [{
                "set_number": "75192-1", "name": "Millennium Falcon", "quantity": 2,
                "condition": "U", "conditions": ["N", "U"], "mixed": true,
                "purchase_price": 80.0, "avg_price": 195.0, "total_avg": "390.00",
                "acquisitions": [
                    {"id": 1, "condition": "N", "quantity": 1, "purchase_price": 100.0,
                     "avg_price": 250.0, "total_avg": "250.00", "pnl_pct": "150.0",
                     "created_at": "2026-01-05T12:00:00.000Z"},
                    {"id": 2, "condition": "U", "quantity": 1, "purchase_price": 60.0,
                     "avg_price": 140.0, "total_avg": "140.00", "pnl_pct": "133.3",
                     "created_at": "2026-03-05T12:00:00.000Z"}
                ]
            }]
        }""")
        val set = v.sets.first()
        assertEquals(2, set.acquisitions.size)
        assertTrue(set.mixed)
        // That is the core of it: the newly entered one is NOT valued at the
        // used price, even though the set is tracked as used.
        assertEquals(250.0, set.acquisitions[0].avgPrice!!, 0.0001)
        assertEquals(140.0, set.acquisitions[1].avgPrice!!, 0.0001)
        // And the row sums together add up to the set sum.
        val sum = set.acquisitions.sumOf { it.totalAvg!!.toDouble() }
        assertEquals(set.totalAvg!!.toDouble(), sum, 0.0001)
    }

    @Test
    fun `a set without acquisitions stays a single row`() {
        val v = json.decodeFromString<ValuationResponse>("""{
            "success": true, "currency": "CHF",
            "totals": {"min": "0.00", "avg": "50.00", "max": "0.00", "qty_avg": "50.00"},
            "sets": [{"set_number": "10290-1", "quantity": 1, "avg_price": 50.0,
                      "total_avg": "50.00"}]
        }""")
        assertTrue(v.sets.first().acquisitions.isEmpty())
        assertNotNull(v.sets.first().totalAvg)
    }

    @Test
    fun `the tile gets a list of the added conditions`() {
        // One copy new, one used: the tile previously only showed
        // "Gebraucht", because `condition` is an aggregate and knows only one
        // value. `conditions` carries both — that is decided on the
        // server, the app computes nothing itself.
        val r = json.decodeFromString<SetsResponse>("""{
            "success": true, "count": 1,
            "sets": [{"set_number": "75192-1", "condition": "U",
                      "conditions": ["N", "U"], "acq_count": 2, "used_count": 1,
                      "max_purchase_price": 160.0, "avg_purchase_price": 120.0}]
        }""")
        val set = r.sets.first()
        assertEquals(listOf(Condition.NEW, Condition.USED), set.conditions)
        assertEquals(Condition.USED, set.condition)
        // The weighted purchase price, not the maximum: 2x100 and 1x160 → 120.
        assertEquals(120.0, set.avgPurchasePrice!!, 0.0001)
    }

    @Test
    fun `an old response without conditions stays usable`() {
        // Then the tile looks as before — a badge from `condition`.
        val r = json.decodeFromString<SetsResponse>("""{
            "success": true, "sets": [{"set_number": "10290-1", "condition": "N"}]
        }""")
        assertTrue(r.sets.first().conditions.isEmpty())
    }

    @Test
    fun `manual minifigures also carry the condition list`() {
        val r = json.decodeFromString<MinifigsResponse>("""{
            "success": true,
            "figs": [{"fig_number": "sw0001", "condition": "U",
                      "conditions": ["N", "U"], "source": "manual",
                      "avg_purchase_price": 12.5}]
        }""")
        assertEquals(listOf(Condition.NEW, Condition.USED), r.figs.first().conditions)
        assertEquals(12.5, r.figs.first().avgPurchasePrice!!, 0.0001)
    }

    @Test
    fun `manual parts also deliver one row per purchase price`() {
        // The same shape as for sets — the finances tab shows the same pattern
        // for all three kinds.
        val v = json.decodeFromString<PartsValuationResponse>("""{
            "success": true, "currency": "CHF", "total_value": "3.20",
            "parts": [{
                "part_number": "6251", "part_name": "Kitten", "color_id": 0,
                "quantity": 3, "conditions": ["N", "U"], "condition": "U",
                "avg_price": 0.8, "display_value": "3.20",
                "acquisitions": [
                    {"id": 11, "condition": "N", "quantity": 2, "purchase_price": 0.6,
                     "avg_price": 1.0, "total_avg": "2.00", "pnl_pct": "66.7"},
                    {"id": 12, "condition": "U", "quantity": 1, "purchase_price": 0.4,
                     "avg_price": 1.2, "total_avg": "1.20", "pnl_pct": "200.0"}
                ]
            }]
        }""")
        val part = v.parts.first()
        assertEquals(2, part.acquisitions.size)
        assertEquals(listOf(Condition.NEW, Condition.USED), part.conditions)
        // Quantity 2 in ONE row — two entries on the same day in the same
        // condition are merged by the server (utils/acquisitions.ts).
        assertEquals(2, part.acquisitions[0].quantity)
        val sum = part.acquisitions.sumOf { it.totalAvg!!.toDouble() }
        assertEquals(part.displayValue!!.toDouble(), sum, 0.0001)
    }

    @Test
    fun `the history of a part fits into the same model as that of a set`() {
        // The new routes /api/v1/parts/…/price-history and
        // /api/v1/minifigs/…/price-history deliver the same envelope without the
        // set fields. Those must land on their defaults instead of throwing —
        // otherwise the dialog would stay empty, with nobody seeing why.
        val r = json.decodeFromString<PriceHistoryResponse>("""{
            "success": true, "currency": "CHF",
            "by_condition": {"N": {"market_price": 0.6, "purchase_price": 0.5, "pnl_pct": "20.0", "pnl_prozent": 20.0}},
            "history_new": [
                {"recorded_at": "2026-08-01", "avg_price": "0.55"},
                {"recorded_at": "2026-08-09", "avg_price": "0.60"}
            ],
            "history_used": [],
            "chart": {"x": ["2026-08-01", "2026-08-09"], "values": [
                {"name": "N", "firstRealIndex": 0,
                 "values": [{"x": "2026-08-01", "y": 0.55}, {"x": "2026-08-09", "y": 0.6}]}
            ]}
        }""")
        assertEquals(1, r.byCondition.present().size)
        assertEquals(2, r.historyNew.size)
        assertEquals(1, r.chart.values.size)
        // Set fields stay empty, without the parsing failing.
        assertNull(r.pnlPct)
        assertNull(r.purchasePrice)
    }
}
