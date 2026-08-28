package ch.brickinventoryapp

import ch.brickinventoryapp.data.model.PriceHistoryResponse
import ch.brickinventoryapp.data.model.MinifigsResponse
import ch.brickinventoryapp.data.model.PartsValuationResponse
import ch.brickinventoryapp.data.model.SetsResponse
import ch.brickinventoryapp.data.model.ValuationResponse
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Client-seitiger API-Vertrag für den Preisverlauf und die Bewertung.
 *
 * Der Verlaufs-Endpunkt hat sich mit Server-Stand hardened-89 GEBROCHEN
 * geändert: statt einer zusammengefalteten `history` kommen beide Zustände
 * getrennt, dazu fertige Diagrammdaten. Ohne diesen Test fällt eine solche
 * Änderung erst am Gerät auf — und dort als leeres Diagramm ohne Fehlermeldung.
 *
 * Die Beträge stehen bewusst teils als STRING im Testdatensatz: Postgres
 * liefert NUMERIC als Zeichenkette, und der Server reicht die Verlaufszeilen
 * unverändert durch. Der Json-Parser der App ist deshalb lenient konfiguriert —
 * genau das wird hier mitgeprüft.
 */
class PriceHistorySerializationTest {

    // Gleiche Konfiguration wie AppModule.provideJson()
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
        coerceInputValues = true
    }

    private val payload = """{
        "success": true,
        "set_number": "75192-1",
        "currency": "CHF",
        "condition": "N",
        "by_condition": {
            "N": {"market_price": 812.5, "purchase_price": 700.0, "pnl_pct": 16.1},
            "U": {"market_price": 640.0, "purchase_price": 600.0, "pnl_pct": 6.7}
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
    fun `beide Verlaufsreihen kommen getrennt an`() {
        val r = json.decodeFromString<PriceHistoryResponse>(payload)
        assertEquals(2, r.historyNew.size)
        assertEquals(1, r.historyUsed.size)
        assertEquals(780.0, r.historyNew[1].avgPrice!!, 0.0001)
        assertTrue("der vorangestellte Kaufpreis ist markiert", r.historyNew[0].isPurchasePrice)
    }

    @Test
    fun `die Diagrammdaten tragen firstRealIndex`() {
        val chart = json.decodeFromString<PriceHistoryResponse>(payload).chart
        assertEquals(listOf("2026-01-01", "2026-02-01"), chart.x)
        val used = chart.values.first { it.name == "U" }
        assertEquals("der Schlüssel heisst camelCase, nicht first_real_index",
            1, used.firstRealIndex)
        assertEquals(0.0, used.values[0].y, 0.0001)
    }

    @Test
    fun `Marktpreis und Entwicklung je Zustand`() {
        val r = json.decodeFromString<PriceHistoryResponse>(payload)
        assertEquals(812.5, r.byCondition.new!!.marketPrice!!, 0.0001)
        assertEquals(6.7, r.byCondition.used!!.pnlPct!!, 0.0001)
        assertEquals(2, r.byCondition.present().size)
        assertEquals(640.0, r.current.used!!.avgPrice!!, 0.0001)
    }

    @Test
    fun `nur ein Zustand erfasst ergibt genau eine Zeile`() {
        // Der Server liefert keinen Eintrag für Zustände ohne Erfassung —
        // sonst stünde dort ein Marktpreis ohne Bezugsgrösse und die
        // Prozentangabe daneben wäre gegen nichts gerechnet.
        val r = json.decodeFromString<PriceHistoryResponse>("""{
            "success": true, "set_number": "10290-1", "currency": "CHF", "condition": "N",
            "by_condition": {"N": {"market_price": 148.72, "purchase_price": 120.0, "pnl_pct": 23.9}},
            "history_new": [], "history_used": [],
            "current": {"N": {"condition": "N", "avg_price": "148.72"}, "U": null},
            "chart": {"x": [], "values": []}
        }""")
        assertEquals(1, r.byCondition.present().size)
        assertEquals("N", r.byCondition.present()[0].first)
        assertNull(r.byCondition.used)
        assertNull(r.current.used)
        assertTrue(r.chart.values.isEmpty())
    }

    @Test
    fun `eine alte Antwort ohne die neuen Felder bricht nicht`() {
        // Falls App und Server einmal auseinanderlaufen: lieber ein leeres
        // Diagramm als ein Absturz im Detail-Dialog.
        val r = json.decodeFromString<PriceHistoryResponse>(
            """{"success": true, "set_number": "75192-1", "currency": "CHF"}""")
        assertTrue(r.historyNew.isEmpty())
        assertTrue(r.chart.values.isEmpty())
        assertTrue(r.byCondition.present().isEmpty())
    }

    @Test
    fun `die Bewertung liefert eine Zeile je Kaufpreis`() {
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
        // Das ist der Kern: Die Neu-Erfassung wird NICHT mit dem
        // Gebrauchtpreis bewertet, obwohl das Set als gebraucht geführt wird.
        assertEquals(250.0, set.acquisitions[0].avgPrice!!, 0.0001)
        assertEquals(140.0, set.acquisitions[1].avgPrice!!, 0.0001)
        // Und die Zeilensummen ergeben zusammen die Set-Summe.
        val sum = set.acquisitions.sumOf { it.totalAvg!!.toDouble() }
        assertEquals(set.totalAvg!!.toDouble(), sum, 0.0001)
    }

    @Test
    fun `ein Set ohne Erfassungen bleibt eine einzige Zeile`() {
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
    fun `die Kachel bekommt eine Liste der erfassten Zustaende`() {
        // Ein Exemplar neu, eines gebraucht: Die Kachel zeigte bisher nur
        // „Gebraucht", weil `condition` ein Aggregat ist und nur einen Wert
        // kennt. `conditions` trägt beide — entschieden wird das auf dem
        // Server, die App rechnet nichts nach.
        val r = json.decodeFromString<SetsResponse>("""{
            "success": true, "count": 1,
            "sets": [{"set_number": "75192-1", "condition": "U",
                      "conditions": ["N", "U"], "acq_count": 2, "used_count": 1,
                      "max_purchase_price": 160.0, "avg_purchase_price": 120.0}]
        }""")
        val set = r.sets.first()
        assertEquals(listOf("N", "U"), set.conditions)
        assertEquals("U", set.condition)
        // Der gewichtete Kaufpreis, nicht das Maximum: 2x100 und 1x160 → 120.
        assertEquals(120.0, set.avgPurchasePrice!!, 0.0001)
    }

    @Test
    fun `eine alte Antwort ohne conditions bleibt brauchbar`() {
        // Dann sieht die Kachel aus wie bisher — eine Plakette aus `condition`.
        val r = json.decodeFromString<SetsResponse>("""{
            "success": true, "sets": [{"set_number": "10290-1", "condition": "N"}]
        }""")
        assertTrue(r.sets.first().conditions.isEmpty())
    }

    @Test
    fun `manuelle Minifiguren tragen die Zustandsliste ebenfalls`() {
        val r = json.decodeFromString<MinifigsResponse>("""{
            "success": true,
            "figs": [{"fig_number": "sw0001", "condition": "U",
                      "conditions": ["N", "U"], "source": "manual",
                      "avg_purchase_price": 12.5}]
        }""")
        assertEquals(listOf("N", "U"), r.figs.first().conditions)
        assertEquals(12.5, r.figs.first().avgPurchasePrice!!, 0.0001)
    }

    @Test
    fun `manuelle Teile liefern ebenfalls eine Zeile je Kaufpreis`() {
        // Dieselbe Form wie bei Sets — der Finanzen-Reiter zeigt für alle drei
        // Arten dasselbe Muster.
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
        assertEquals(listOf("N", "U"), part.conditions)
        // Menge 2 in EINER Zeile — zwei Erfassungen am selben Tag im selben
        // Zustand fasst der Server zusammen (utils/acquisitions.ts).
        assertEquals(2, part.acquisitions[0].quantity)
        val sum = part.acquisitions.sumOf { it.totalAvg!!.toDouble() }
        assertEquals(part.displayValue!!.toDouble(), sum, 0.0001)
    }

    @Test
    fun `der Verlauf eines Teils passt in dasselbe Modell wie der eines Sets`() {
        // Die neuen Routen /api/v1/parts/…/price-history und
        // /api/v1/minifigs/…/price-history liefern denselben Umschlag ohne die
        // Set-Felder. Die müssen auf ihren Vorgaben landen statt zu werfen —
        // sonst bliebe der Dialog leer, ohne dass jemand sähe warum.
        val r = json.decodeFromString<PriceHistoryResponse>("""{
            "success": true, "currency": "CHF",
            "by_condition": {"N": {"market_price": 0.6, "purchase_price": 0.5, "pnl_pct": 20.0}},
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
        // Set-Felder bleiben leer, ohne dass das Parsen scheitert.
        assertEquals("", r.setNumber)
        assertNull(r.pnlPct)
        assertNull(r.purchasePrice)
    }
}
